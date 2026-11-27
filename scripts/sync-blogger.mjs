// Sinkron feed Blogger -> data/*.json + halaman artikel lengkap (a/... dan p/...) + sitemap.xml
// Dijalankan oleh GitHub Actions (Node 20+, tanpa dependensi).

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

/* ---------------------------------------------------------------------------
   KONFIGURASI SITUS (sumber kebenaran tunggal untuk domain)
   Isi site.config.json. Untuk pindah domain, ubah HANYA file itu.
   Env SITE_URL (opsional) untuk override sementara, mis. saat uji coba.
   --------------------------------------------------------------------------- */
const CONFIG_FILE = 'site.config.json';

async function loadSiteConfig() {
  let fileCfg = {};
  try {
    fileCfg = JSON.parse(await readFile(CONFIG_FILE, 'utf8'));
  } catch {
    console.warn(`${CONFIG_FILE} tidak terbaca, pakai default/env.`);
  }
  const siteUrl = (process.env.SITE_URL || fileCfg.siteUrl || '').trim().replace(/\/?$/, '/');
  if (!/^https:\/\//.test(siteUrl)) {
    console.error(`Domain situs belum diisi. Set siteUrl di ${CONFIG_FILE} (mis. https://domain.sch.id/) atau env SITE_URL.`);
    process.exit(1);
  }
  return {
    siteUrl,
    siteName: fileCfg.siteName || 'MAN 2 Grobogan',
    defaultImage: process.env.DEFAULT_IMAGE || fileCfg.defaultImage || 'assets/logo.webp'
  };
}

const cfg = await loadSiteConfig();
const SITE_URL = cfg.siteUrl;
// Path relatif diubah ke URL absolut memakai domain dari site.config.json,
// supaya og:image / favicon / JSON-LD tetap benar setelah pindah domain.
const DEFAULT_IMAGE = /^https?:\/\//.test(cfg.defaultImage)
  ? cfg.defaultImage
  : new URL(cfg.defaultImage, SITE_URL).href;
const SITE_NAME = cfg.siteName;

const BLOGS = {
  berita: 'beritamandaga.blogspot.com',
  mading: 'madingmandaga.blogspot.com',
  foto: 'fotomandaga.blogspot.com',
  video: 'videomandaga.blogspot.com'
};
const INFO_HOST = 'infomandaga.blogspot.com';
const POST_LIMIT = 300;

/* Tag bersama: font + design system. Halaman dalam WAJIB memuat Poppins;
   tanpa ini browser jatuh ke sans-serif default dan tampilan berbeda dari beranda. */
const FONT_LINKS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300..900&family=Poppins:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">`;
/* Design system dimuat dengan path RELATIF terhadap kedalaman halaman.
   Alasannya:
   - halaman dalam berada di /p/<slug>/ (2 level) dan /a/<kunci>/<id>/ (3 level);
   - URL absolut menggagalkan pratinjau lokal & domain uji,
   - path relatif tetap benar walau domain berubah.
   Fungsi ini menghasilkan "../../assets/theme.css" dsb. sesuai kedalaman. */
/* Tulis ulang src gambar lokal (assets/...) agar valid di kedalaman halaman.
   Di beranda & rute hash -> 'assets/...'; di p/<slug>/ (2 level) -> '../../assets/...'. */
function fixAssetSrc(html, depth) {
  const pre = depth ? '../'.repeat(depth) : '';
  return String(html || '').replace(
    /\b(src|href)="assets\//g,
    (_, attr) => `${attr}="${pre}assets/`
  );
}

function themeHref(relPath) {
  const depth = String(relPath || '').split('/').filter(Boolean).length;
  return depth ? '../'.repeat(depth) + 'assets/theme.css' : 'assets/theme.css';
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function textOf(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function thumbOf(e, html) {
  if (e['media$thumbnail']) return e['media$thumbnail'].url.replace(/\/s\d+(-c)?\//, '/w640/');
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (m) return m[1];
  const y = html.match(/youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{6,})/);
  if (y) return `https://img.youtube.com/vi/${y[1]}/hqdefault.jpg`;
  return DEFAULT_IMAGE;
}

function norm(e) {
  const html = (e.content && e.content.$t) || (e.summary && e.summary.$t) || '';
  const pid = ((e.id && e.id.$t) || '').match(/post-(\d+)/);
  const link = (e.link || []).find((l) => l.rel === 'alternate');
  const text = textOf(html);
  return {
    id: pid ? pid[1] : '',
    title: e.title.$t,
    published: e.published ? e.published.$t : '',
    url: link ? link.href : '',
    html,
    // Label Blogger (term = nama label). Dipakai untuk memilih headline.
    labels: (e.category || []).map((c) => c.term || ''),
    thumb: thumbOf(e, html).replace(
      // Blog lama memakai logo dari i.ibb.co.com; ganti dengan aset lokal.
      'https://i.ibb.co.com/KcywhB2N/logo.png',
      DEFAULT_IMAGE
    ),
    excerpt: text.length > 140 ? text.slice(0, 140).trim() + '…' : text,
    description: text.length > 200 ? text.slice(0, 200).trim() + '…' : text
  };
}

async function fetchAll(host, limit) {
  const out = [];
  const step = 100;
  for (let start = 1; out.length < limit; start += step) {
    const url = `https://${host}/feeds/posts/default?alt=json&max-results=${step}&start-index=${start}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${host}: HTTP ${res.status}`);
    const data = await res.json();
    const entries = (data.feed && data.feed.entry) || [];
    entries.forEach((e) => out.push(norm(e)));
    if (entries.length < step) break;
  }
  return out.slice(0, limit);
}

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return iso;
  }
}

function cleanBody(html) {
  return String(html || '').replace(/<script[\s\S]*?<\/script>/gi, '');
}

const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-src https://www.youtube.com https://www.youtube-nocookie.com https://drive.google.com https://docs.google.com https://www.google.com https://player.vimeo.com https://www.blogger.com; object-src 'none'; base-uri 'self'; form-action 'none'";

/* Skema JSON-LD.
   Halaman profil (p/…) BUKAN artikel berita — memakai NewsArticle di sana
   memberi sinyal yang salah ke mesin pencari. Samakan dengan tipe yang sebenarnya. */
function jsonLd({ title, description, image, pageUrl, date, type = 'NewsArticle', breadcrumb }) {
  const base = {
    '@context': 'https://schema.org',
    '@type': type,
    headline: title,
    name: title,
    description: description || SITE_NAME,
    image: [image],
    mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl },
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: SITE_URL }
  };
  if (type === 'NewsArticle' || type === 'BlogPosting') {
    base.datePublished = date;
    base.dateModified = date;
    base.author = { '@type': 'Organization', name: SITE_NAME, url: SITE_URL };
  }
  if (breadcrumb && breadcrumb.length) {
    base.breadcrumb = {
      '@type': 'BreadcrumbList',
      itemListElement: breadcrumb.map((b, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: b.name,
        item: b.url
      }))
    };
  }
  return JSON.stringify(base).replace(/</g, '\\u003c');
}

function articlePage({ title, description, image, pageUrl, date, body, type = 'NewsArticle', breadcrumb, showDate = true, assetPath, depth = 0 }) {
  const t = esc(title);
  const d = esc(description || SITE_NAME);
  const dt = fmtDate(date);
  const img = esc(image);
  const url = esc(pageUrl);
  const ld = jsonLd({ title, description, image, pageUrl, date, type, breadcrumb });
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>${t} - ${SITE_NAME}</title>
<meta name="description" content="${d}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:url" content="${esc(url)}">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${ld}</script>
<link rel="icon" href="${DEFAULT_IMAGE}" type="image/webp">
${FONT_LINKS}
<link rel="stylesheet" href="${assetPath || themeHref('')}">
<style>
  /* Penyesuaian khusus halaman artikel (selebihnya ada di assets/theme.css) */
  @media (max-width:600px){ .page-card { padding:22px 18px; } .page-title { font-size:1.25rem; } }
</style>
</head>
<body>
<a class="skip-link" href="#main">Lewati ke konten utama</a>
<div class="page-shell">
  <main class="page-main" id="main">
    <a href="${SITE_URL}" class="page-back">&larr; Kembali ke beranda</a>
    ${breadcrumb && breadcrumb.length ? `<nav class="breadcrumb" aria-label="Remah roti"><ol>${breadcrumb.map((b, i) => (i === breadcrumb.length - 1
      ? `<li aria-current="page">${esc(b.name)}</li>`
      : `<li><a href="${esc(b.url)}">${esc(b.name)}</a></li>`)).join('')}</ol></nav>` : ''}
    <article class="page-card">
      ${showDate && dt ? `<span class="page-date">${esc(dt)}</span>` : ''}
      <h1 class="page-title">${t}</h1>
      <div class="prose">${fixAssetSrc(cleanBody(body || ''), depth)}</div>
    </article>
    <p class="page-foot">&copy; ${new Date().getFullYear()} MAN 2 Grobogan. <a href="${SITE_URL}">Kunjungi situs utama</a></p>
  </main>
</div>
</body>
</html>
`;
}

function listPage({ title, description, image, pageUrl, items, assetPath }) {
  const t = esc(title);
  const d = esc(description || SITE_NAME);
  const rows = items.map((it) => {
    const u = esc(it.url);
    const dt = fmtDate(it.date);
    return `    <li class="item"><a href="${u}"><span class="date">${esc(dt)}</span><span class="t">${esc(it.title)}</span></a></li>`;
  }).join('\n');
  const ld = jsonLd({ title, description, image, pageUrl, type: 'CollectionPage', date: '' });
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>${t} - ${SITE_NAME}</title>
<meta name="description" content="${d}">
<link rel="canonical" href="${esc(pageUrl)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:url" content="${esc(pageUrl)}">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${ld}</script>
<link rel="icon" href="${DEFAULT_IMAGE}" type="image/webp">
${FONT_LINKS}
<link rel="stylesheet" href="${assetPath || themeHref('')}">
<style>
  @media (max-width:600px){ .page-card { padding:24px 18px; } }
</style>
</head>
<body>
<a class="skip-link" href="#main">Lewati ke konten utama</a>
<div class="page-shell">
  <main class="page-main" id="main">
    <a href="${SITE_URL}" class="page-back">&larr; Kembali ke beranda</a>
    <div class="page-card">
      <h1 class="page-title">${t}</h1>
      <ul class="page-list">
${rows}
      </ul>
    </div>
    <p class="page-foot">&copy; ${new Date().getFullYear()} MAN 2 Grobogan. <a href="${SITE_URL}">Kunjungi situs utama</a></p>
  </main>
</div>
</body>
</html>
`;
}

async function writePage(rel, html) {
  await mkdir(rel, { recursive: true });
  await writeFile(`${rel}/index.html`, html);
}

/* Ambil isi halaman dari folder content/ (sumber kebenaran lokal).
   Dipakai untuk halaman yang postingnya di Blogger sengaja dikosongkan. */
async function localContent(slug) {
  try {
    const html = await readFile(`content/${slug}.html`, 'utf8');
    return html.trim() ? html : null;
  } catch {
    return null;
  }
}

/* ---------- Meta deskripsi per halaman profil ---------- */
const PAGE_DESC = {
  'sejarah-madrasah': 'Sejarah berdirinya MAN 2 Grobogan, Madrasah Aliyah Negeri di Gubug, Grobogan: perjalanan, tokoh, dan perkembangannya hingga kini.',
  'visi-misi-dan-tujuan': 'Visi dan misi MAN 2 Grobogan: arah pendidikan dan operasional berbasis nilai keislaman untuk membentuk insan yang unggul, mandiri, dan profetis.',
  'sambutan-kepala-madrasah': 'Sambutan Kepala Madrasah MAN 2 Grobogan: visi, arah pendidikan, dan harapan bagi peserta didik serta warga madrasah.',
  'struktur-organisasi': 'Struktur organisasi dan kepemimpinan MAN 2 Grobogan lengkap: kepala madrasah, komite sekolah, serta pembagian tugas.',
  'guru-dan-tenaga-kependidikan': 'Daftar guru dan tenaga kependidikan MAN 2 Grobogan: lengkap dengan jabatan, mata pelajaran yang diampu, dan kontak resmi madrasah.',
  'sarana-dan-prasarana': 'Sarana dan prasarana MAN 2 Grobogan: ruang kelas, laboratorium, masjid sekolah, perpustakaan, dan fasilitas pendukung kegiatan belajar.',
  'identitas-madrasah': 'Identitas resmi MAN 2 Grobogan: NPSN, kode POSIX, alamat, telepon, email, jam operasional, dan data resmi madrasah.',
  'kurikulum': 'Kurikulum MAN 2 Grobogan: struktur rompel, mata pelajaran, pembelajaran mikro, serta pendekatan yang dipakai di kelas.',
  'kalender-akademik': 'Kalender akademik MAN 2 Grobogan tahun pelajaran berjalan: semester, hari efektif, libur, dan agenda penting.',
  'program-pembelajaran': 'Program pembelajaran MAN 2 Grobogan: pembelajaran terdiferensiasi, penguatan karakter, dan pembelajaran berbasis proyek.',
  'dokumen-akademik': 'Dokumen akademik MAN 2 Grobogan: daftar dokumen kurikulum, perangkat pembelajaran, administrasi sekolah, dan panduan layanan.',
  'asesmen-dan-evaluasi': 'Asesmen dan evaluasi di MAN 2 Grobogan: format asesmen sumatif, ASAS berbasis gawai, serta pedoman penilaian.',
  'unduhan-akademik': 'Unduhan dokumen akademik MAN 2 Grobogan: berkas RPP, soal, jadwal, dan formulir yang dapat diunduh langsung.',
  'osim': 'OSIM MAN 2 Grobogan: struktur organisasi siswa, program kegiatan, agenda, dan cara bergabung ke kepengurusan.',
  'ekstrakurikuler': 'Ekstrakurikuler MAN 2 Grobogan: pilihan kegiatan minat dan bakat siswa, mulai pramuka, bulu tangkis, hingga olahraga dan seni.',
  'tata-tertib-siswa': 'Tata tertib siswa MAN 2 Grobogan: aturan kedisiplinan, seragam, kehadiran, dan konsekuensi bagi peserta didik.',
  'bkkonseling': 'Bimbingan dan konseling MAN 2 Grobogan: layanan BK, layanan homeroom, layanan konseling pribadi, dan rujukan kasus.',
  'prestasi-siswa': 'Prestasi siswa MAN 2 Grobogan: penghargaan akademik dan nonakademik, juara tingkat kabupaten, provinsi, hingga nasional.',
  'alumni': 'Alumni MAN 2 Grobogan: jejak angkatan, testimoni, dan program jejaring untuk menjaga kelanjutan alumni.',
  'pengumuman': 'Lowongan guru MAN 2 Grobogan 2026: formasi Sosiologi, Seni Budaya, dan Informatika. Pendaftaran 30 November - 12 Desember 2026, seleksi 14 Desember 2026.',
  'agenda': 'Agenda kegiatan MAN 2 Grobogan: jadwal acara, seminar, kegiatan madrasah, dan acara warga sekolah.',
  'prestasi': 'Prestasi MAN 2 Grobogan: rangkuman penghargaan madrasah dalam berbagai bidang, akademik dan nonakademik.',
  'arsip': 'Arsip publikasi MAN 2 Grobogan: kumpulan dokumen, laporan, dan publikasi madrasah yang dapat diunduh.'
};
/* Ringkasan isi + nama situs, untuk halaman tanpa deskripsi manual. */
function buildPageDesc(title, body) {
  const text = textOf(String(body || '').replace(/<[^>]+>/g, ' '));
  const core = text.length > 150 ? text.slice(0, 150).trim() + '…' : text.trim();
  const base = `${title} — MAN 2 Grobogan.`;
  return core ? `${core} ${base}` : base;
}

const sitemapUrls = [];
function addSitemap(url) { sitemapUrls.push(url); }

const BLOG_META = {
  berita: { title: 'Berita MAN 2 Grobogan', desc: 'Kabar terbaru, kegiatan, dan prestasi MAN 2 Grobogan.' },
  mading: { title: 'Mading MAN 2 Grobogan', desc: 'Karya dan informasi dari mading madrasah MAN 2 Grobogan.' },
  foto: { title: 'Galeri Foto MAN 2 Grobogan', desc: 'Dokumentasi foto kegiatan MAN 2 Grobogan.' },
  video: { title: 'Galeri Video MAN 2 Grobogan', desc: 'Dokumentasi video kegiatan MAN 2 Grobogan.' }
};

async function main() {
  await rm('data', { recursive: true, force: true });
  await rm('a', { recursive: true, force: true });
  await rm('p', { recursive: true, force: true });
  await mkdir('data', { recursive: true });
  await mkdir('a', { recursive: true });
  await mkdir('p', { recursive: true });

  addSitemap(SITE_URL);

  /* Kandidat hero beranda: postingan berlabel "Headline" (case-insensitive).
     Dikumpulkan dari SEMUA blog, lalu diambil yang paling baru. Lihat Opsi B
     di catatan: label "Headline" di infomandaga pun bisa jadi hero global. */
  const heroCandidates = [];

  for (const [key, host] of Object.entries(BLOGS)) {
    const posts = await fetchAll(host, POST_LIMIT);
    const index = posts.map(({ id, title, published, thumb, excerpt }) => ({ id, title, published, thumb, excerpt }));
    await writeFile(`data/${key}.json`, JSON.stringify(index));
    // Artikel berlabel "Headline" dari blog berita/mading/foto/video jadi kandidat hero.
    {
      const byDate = posts.slice().sort((a, b) => new Date(b.published) - new Date(a.published));
      const pick = byDate.find((p) => (p.labels || []).some((l) => l.toLowerCase() === 'headline'));
      if (pick) {
        heroCandidates.push({
          id: pick.id,
          title: pick.title,
          published: pick.published,
          thumb: pick.thumb,
          excerpt: pick.excerpt,
          url: pick.id ? `${SITE_URL}a/${key}/${pick.id}/` : pick.url
        });
      }
    }
    await mkdir(`data/${key}`, { recursive: true });
    for (const p of posts) {
      if (!p.id) continue;
      await writeFile(`data/${key}/${p.id}.json`, JSON.stringify({ title: p.title, published: p.published, html: p.html }));
      const pageUrl = `${SITE_URL}a/${key}/${p.id}/`;
      await writePage(`a/${key}/${p.id}`, articlePage({
        title: p.title,
        description: p.description,
        image: p.thumb,
        pageUrl,
        date: p.published,
        body: p.html,
        assetPath: themeHref(`a/${key}/${p.id}`),
        depth: 2
      }));
      addSitemap(pageUrl);
    }
    const meta = BLOG_META[key] || { title: key, desc: '' };
    const listUrl = `${SITE_URL}a/${key}/`;
    await writePage(`a/${key}`, listPage({
      title: meta.title,
      description: meta.desc,
      image: DEFAULT_IMAGE,
      pageUrl: listUrl,
      items: posts.map((p) => ({ title: p.title, date: p.published, url: `${SITE_URL}a/${key}/${p.id}/` })),
      assetPath: themeHref(`a/${key}`)
    }));
    addSitemap(listUrl);
    console.log(`${key}: ${posts.length} postingan`);
  }

  /* Breadcrumb: tentukan induk halaman sesuai lokasi di menu, bukan asumsi
     semua halaman p/ berada di bawah "Profil Madrasah". */
  const MENU_PARENT = {
    profil: ['sejarah-madrasah', 'visi-misi-dan-tujuan', 'sambutan-kepala-madrasah',
             'struktur-organisasi', 'guru-dan-tenaga-kependidikan', 'sarana-dan-prasarana',
             'identitas-madrasah'],
    akademik: ['kurikulum', 'kalender-akademik', 'jadwal-pelajaran', 'jadwal-asesmen-summatif',
               'program-pembelajaran', 'dokumen-akademik', 'asesmen-dan-evaluasi', 'unduhan-akademik'],
    kesiswaan: ['osim', 'ekstrakurikuler', 'tata-tertib-siswa', 'bkkonseling', 'prestasi-siswa', 'alumni'],
    publikasi: ['pengumuman', 'agenda', 'prestasi', 'arsip']
  };
  const PARENT_INFO = {
    profil: { label: 'Profil Madrasah', url: `${SITE_URL}p/identitas-madrasah/` },
    akademik: { label: 'Akademik', url: `${SITE_URL}p/kurikulum/` },
    kesiswaan: { label: 'Kesiswaan', url: `${SITE_URL}p/osim/` },
    publikasi: { label: 'Publikasi', url: `${SITE_URL}p/pengumuman/` }
  };
  function parentKey(slug) {
    for (const [k, list] of Object.entries(MENU_PARENT)) {
      if (list.includes(slug)) return k;
    }
    return 'profil';
  }
  function parentLabel(slug) { return PARENT_INFO[parentKey(slug)].label; }
  function parentUrl(slug) { return PARENT_INFO[parentKey(slug)].url; }

  const pages = await fetchAll(INFO_HOST, 500);
  const map = {};
  for (const p of pages) {
    const m = p.url.match(/\/([^\/]+)\.html$/);
    if (!m) continue;
    const slug = m[1];
    // Override judul halaman statis bila perlu agar lebih ringkas/sesuai.
    const titleOverride = {
      'visi-misi-dan-tujuan': 'Visi dan Misi'
    };
    const title = titleOverride[slug] || p.title;
    // Isi lokal (content/<slug>.html) mengalahkan Blogger bila ada.
    const body = await localContent(slug) || p.html;
    map[slug] = { title, published: p.published, url: p.url, html: body };
    const pageUrl = `${SITE_URL}p/${slug}/`;
    // Halaman info berlabel "Headline" (mis. lowongan guru) juga kandidat hero.
    if ((p.labels || []).some((l) => l.toLowerCase() === 'headline')) {
      heroCandidates.push({
        id: slug,
        title,
        published: p.published,
        thumb: p.thumb,
        excerpt: p.excerpt || textOf(String(body || '').replace(/<[^>]+>/g, ' ')).slice(0, 200),
        url: pageUrl
      });
    }
    // Halaman profil BUKAN berita: meta description generik ("MAN 2 Grobogan")
    // untuk 24 halaman sekaligus merusak cuplikan di hasil pencarian.
    // Pakai deskripsi khusus per halaman; fallback = ringkasan isi + nama situs.
    const metaDesc = PAGE_DESC[slug] || buildPageDesc(title, body);
    await writePage(`p/${slug}`, articlePage({
      title,
      description: metaDesc,
      image: p.thumb,
      pageUrl,
      date: p.published,
      body,
      type: 'WebPage',
      showDate: false,
      assetPath: themeHref(`p/${slug}`),
      depth: 2,
      breadcrumb: [
        { name: 'Beranda', url: SITE_URL },
        { name: parentLabel(slug), url: parentUrl(slug) },
        { name: title, url: pageUrl }
      ]
    }));
    addSitemap(pageUrl);
  }
  await writeFile('data/info.json', JSON.stringify(map));
  console.log(`info: ${Object.keys(map).length} halaman`);

  // Pilih hero terbaru dari seluruh kandidat (berita + infomandaga).
  if (heroCandidates.length) {
    const hero = heroCandidates.slice().sort(
      (a, b) => new Date(b.published) - new Date(a.published)
    )[0];
    await writeFile('data/headline.json', JSON.stringify(hero));
    console.log(`headline: ${hero.title} (${hero.url})`);
  }

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join('\n')}\n</urlset>\n`;
  await writeFile('sitemap.xml', sitemap);
  console.log(`sitemap: ${sitemapUrls.length} URL`);

  await writeFile('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}sitemap.xml\n`);

  await applySiteUrlToIndex();
  console.log(`index.html: domain diselaraskan ke ${SITE_URL}`);
}

/* Selaraskan domain di index.html (canonical + siteUrl + og:image) dengan SITE_URL.
   Aset logo memakai path relatif sehingga ikut otomatis saat pindah domain. */
async function applySiteUrlToIndex() {
  const file = 'index.html';
  let html;
  try {
    html = await readFile(file, 'utf8');
  } catch {
    console.warn('index.html tidak ditemukan, dilewati.');
    return;
  }
  const updated = html
    .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${esc(SITE_URL)}">`)
    .replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${esc(new URL('assets/logo.webp', SITE_URL).href)}">`)
    .replace(/siteUrl:\s*'[^']*'/, `siteUrl: '${SITE_URL}'`);
  if (updated !== html) await writeFile(file, updated);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
