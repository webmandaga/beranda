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

function jsonLd({ title, description, image, pageUrl, date }) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: title,
    description: description || SITE_NAME,
    image: [image],
    datePublished: date,
    dateModified: date,
    mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl },
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: SITE_URL }
  }).replace(/</g, '\\u003c');
}

function articlePage({ title, description, image, pageUrl, date, body }) {
  const t = esc(title);
  const d = esc(description || SITE_NAME);
  const dt = fmtDate(date);
  const img = esc(image);
  const url = esc(pageUrl);
  const ld = jsonLd({ title, description, image, pageUrl, date });
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
<style>
  :root { --primary:#673DE6; --accent:#08796E; --accent-light:#14C9B6; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Poppins',sans-serif; color:#fff; min-height:100vh; background:linear-gradient(135deg,#24125a 0%,#4c29bc 40%,#673DE6 70%,#3a1999 100%); }
  .wrap { max-width:820px; margin:0 auto; padding:100px 20px 60px; }
  .back { display:inline-flex; align-items:center; gap:8px; color:var(--accent-light); text-decoration:none; font-size:.9rem; font-weight:500; margin-bottom:18px; }
  .back:hover { text-decoration:underline; }
  .box { padding:40px 44px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); border-radius:28px; backdrop-filter:blur(16px); }
  .date { font-size:.8rem; color:var(--accent-light); font-weight:500; margin:0 0 8px; letter-spacing:.3px; }
  h1 { font-size:clamp(1.35rem,2.4vw,1.85rem); line-height:1.35; font-weight:700; margin-bottom:18px; text-align:left; }
  .body { font-size:1rem; line-height:1.85; color:#fff; overflow-wrap:break-word; }
  .body img { max-width:100%; height:auto; border-radius:16px; margin:14px auto; display:block; }
  .body iframe { max-width:100%; border:none; border-radius:16px; }
  .body a { color:var(--accent-light); text-decoration:underline; }
  .body table { width:100%; border-collapse:collapse; font-size:.92rem; margin:16px 0; display:block; overflow-x:auto; }
  .body table td,.body table th { border:1px solid rgba(255,255,255,0.25); padding:10px 12px; }
  .body table th { background:rgba(255,255,255,0.12); font-weight:600; }
  .foot { text-align:center; margin-top:40px; opacity:.8; font-size:.88rem; }
  .foot a { color:var(--accent-light); }
  @media (max-width:600px){ .box { padding:22px 18px; } h1 { font-size:1.25rem; } }
</style>
</head>
<body>
<div class="wrap">
  <a href="${SITE_URL}" class="back">&larr; Kembali ke beranda</a>
  <article class="box">
    ${dt ? `<span class="date">${esc(dt)}</span>` : ''}
    <h1>${t}</h1>
    <div class="body">${cleanBody(body || '')}</div>
  </article>
  <p class="foot">&copy; ${new Date().getFullYear()} MAN 2 Grobogan. <a href="${SITE_URL}">Kunjungi situs utama</a></p>
</div>
</body>
</html>
`;
}

function listPage({ title, description, image, pageUrl, items }) {
  const t = esc(title);
  const d = esc(description || SITE_NAME);
  const rows = items.map((it) => {
    const u = esc(it.url);
    const dt = fmtDate(it.date);
    return `    <li class="item"><a href="${u}"><span class="date">${esc(dt)}</span><span class="t">${esc(it.title)}</span></a></li>`;
  }).join('\n');
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
<link rel="icon" href="${DEFAULT_IMAGE}" type="image/webp">
<style>
  :root { --primary:#673DE6; --accent:#08796E; --accent-light:#14C9B6; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Poppins',sans-serif; color:#fff; min-height:100vh; background:linear-gradient(135deg,#24125a 0%,#4c29bc 40%,#673DE6 70%,#3a1999 100%); }
  .wrap { max-width:820px; margin:0 auto; padding:100px 20px 60px; }
  .back { display:inline-flex; align-items:center; gap:8px; color:var(--accent-light); text-decoration:none; font-size:.9rem; font-weight:500; margin-bottom:18px; }
  .back:hover { text-decoration:underline; }
  .box { padding:36px 40px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); border-radius:28px; backdrop-filter:blur(16px); }
  h1 { font-size:clamp(1.35rem,2.4vw,1.9rem); line-height:1.35; font-weight:700; margin-bottom:22px; }
  ul { list-style:none; }
  .item { border-top:1px solid rgba(255,255,255,0.14); }
  .item a { display:block; padding:16px 2px; color:#fff; text-decoration:none; }
  .item a:hover .t { color:var(--accent-light); }
  .item .date { display:block; font-size:.78rem; color:var(--accent-light); font-weight:500; margin-bottom:5px; }
  .item .t { font-size:1rem; line-height:1.5; font-weight:500; }
  .foot { text-align:center; margin-top:40px; opacity:.8; font-size:.88rem; }
  .foot a { color:var(--accent-light); }
  @media (max-width:600px){ .box { padding:24px 18px; } }
</style>
</head>
<body>
<div class="wrap">
  <a href="${SITE_URL}" class="back">&larr; Kembali ke beranda</a>
  <div class="box">
    <h1>${t}</h1>
    <ul>
${rows}
    </ul>
  </div>
  <p class="foot">&copy; ${new Date().getFullYear()} MAN 2 Grobogan. <a href="${SITE_URL}">Kunjungi situs utama</a></p>
</div>
</body>
</html>
`;
}

async function writePage(rel, html) {
  await mkdir(rel, { recursive: true });
  await writeFile(`${rel}/index.html`, html);
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

  for (const [key, host] of Object.entries(BLOGS)) {
    const posts = await fetchAll(host, POST_LIMIT);
    const index = posts.map(({ id, title, published, thumb, excerpt }) => ({ id, title, published, thumb, excerpt }));
    await writeFile(`data/${key}.json`, JSON.stringify(index));
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
        body: p.html
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
      items: posts.map((p) => ({ title: p.title, date: p.published, url: `${SITE_URL}a/${key}/${p.id}/` }))
    }));
    addSitemap(listUrl);
    console.log(`${key}: ${posts.length} postingan`);
  }

  const pages = await fetchAll(INFO_HOST, 500);
  const map = {};
  for (const p of pages) {
    const m = p.url.match(/\/([^\/]+)\.html$/);
    if (!m) continue;
    const slug = m[1];
    map[slug] = { title: p.title, published: p.published, url: p.url, html: p.html };
    const pageUrl = `${SITE_URL}p/${slug}/`;
    await writePage(`p/${slug}`, articlePage({
      title: p.title,
      description: p.description,
      image: p.thumb,
      pageUrl,
      date: p.published,
      body: p.html
    }));
    addSitemap(pageUrl);
  }
  await writeFile('data/info.json', JSON.stringify(map));
  console.log(`info: ${Object.keys(map).length} halaman`);

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
