# Website MAN 2 Grobogan (staging)

Mirror statis website MAN 2 Grobogan. Konten sumber: 5 blog Blogspot.
Build otomatis oleh GitHub Actions setiap hari (01:00 UTC) atau manual via
workflow "Sinkron Blogger".

## Struktur

- `index.html` — beranda (satu halaman, router hash + path statis)
- `jadwal/` — halaman jadwal pelajaran (`data.json` per 6 bulan)
- `site.config.json` — **sumber kebenaran domain + gambar default**
- `assets/` — logo & hero WebP lokal (logo: 16,7 KB, hero: 307,3 KB)
- `scripts/sync-blogger.mjs` — generator: `data/`, `a/`, `p/`, `sitemap.xml`, `robots.txt`
- `scripts/set-domain.mjs` — ganti domain satu langkah
- `a/` — artikel blog (Berita, Mading, Foto, Video) — dihasilkan
- `p/` — halaman profil/akademik — dihasilkan
- `data/` — cache JSON feed — dihasilkan

Folder `a/`, `p/`, `data/`, `sitemap.xml`, dan `robots.txt` **tidak diedit manual**;
selalu hasil build ulang.

## Pindah domain

Domain ada di satu tempat: `site.config.json`.

```bash
node scripts/set-domain.mjs https://domain-man2.sch.id/
```

Skrip itu menulis `site.config.json` lalu menjalankan sinkron, sehingga
canonical beranda, canonical tiap artikel, JSON-LD, `sitemap.xml`, dan `robots.txt`
semua ikut berubah. Setelah itu cukup commit & push.

Override sementara tanpa mengubah file:

```bash
SITE_URL=https://uji.sch.id/ node scripts/sync-blogger.mjs
```

## Alur Sync

1. Fetch feed JSON Blogger (`/feeds/posts/default?alt=json`).
2. Tulis `data/<blog>.json` + `data/<blog>/<id>.json`.
3. Render `a/<blog>/<id>/index.html` (halaman artikel lengkap + OG + JSON-LD).
4. Render `a/<blog>/index.html` (daftar Posting per blog).
5. Render `p/<slug>/index.html` dari `infomandaga.blogspot.com`.
6. Tulis `sitemap.xml` dan `robots.txt`.
7. Selaraskan domain di `index.html`.

## Catatan

- `staticShare: true` di `index.html` — tombol Bagikan memakai URL statis agar
  pratinjau WhatsApp/Telegram benar.
- Logo dan hero disimpan lokal di `assets/` dalam WebP. Tidak ada hotlink ke
  `i.ibb.co.com`; gambar artikel dari Blogger tetap memakai CDN Blogger.
- Link RDM (`wprdm.my.id/man2grobogan/`) masih ada di menu dan **sudah mati**
  (aplikasi RDM dihapus). Bersihkan sebelum domain produksi.
- Feed `fotomandaga` dan `videomandaga` masih kosong.
