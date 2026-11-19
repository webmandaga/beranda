// Ganti domain situs dalam satu langkah.
// Contoh: node scripts/set-domain.mjs https://domain-man2.sch.id/
//
// Yang terjadi:
//   1. site.config.json ditulis dengan domain baru (sumber kebenaran tunggal).
//   2. scripts/sync-blogger.mjs dijalankan -> artikel, daftar, sitemap, robots,
//      canonical index.html semuanya ikut memakai domain baru.
//
// Env SITE_URL, bila diisi, MENGGANTIKAN nilai di site.config.json
// (berguna untuk uji coba tanpa mengubah file).

import { readFile, writeFile } from 'node:fs/promises';

const CONFIG_FILE = 'site.config.json';

function normalize(u) {
  const s = String(u || '').trim();
  if (!s) throw new Error('URL domain kosong.');
  if (!/^https:\/\//.test(s)) throw new Error('URL harus diawali https://');
  return s.replace(/\/?$/, '/');
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    const cfg = JSON.parse(await readFile(CONFIG_FILE, 'utf8'));
    console.log(`Domain sekarang: ${cfg.siteUrl}`);
    console.log('Ganti dengan: node scripts/set-domain.mjs https://domain.sch.id/');
    return;
  }
  const siteUrl = normalize(arg);
  const raw = await readFile(CONFIG_FILE, 'utf8').catch(() => '{}');
  const cfg = { siteName: 'MAN 2 Grobogan', defaultImage: 'assets/logo.webp', ...JSON.parse(raw) };
  cfg.siteUrl = siteUrl;
  await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`${CONFIG_FILE} -> ${siteUrl}`);
  console.log('Menjalankan sinkron...');
  await import('./sync-blogger.mjs');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
