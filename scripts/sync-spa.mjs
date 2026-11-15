// Copies the static SPA (../luyenthuyettrinh) into public/ so Next.js serves it from the same origin
// as the API (session cookies work with no CORS). Run after any frontend change: npm run spa:sync
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, process.argv[2] ?? '../luyenthuyettrinh');
const out = resolve(root, 'public');
if (!existsSync(resolve(src, 'index.html'))) { console.error(`SPA source not found: ${src}`); process.exit(1); }

for (const d of ['css', 'js', 'img']) { rmSync(resolve(out, d), { recursive: true, force: true }); if (existsSync(resolve(src, d))) cpSync(resolve(src, d), resolve(out, d), { recursive: true }); }
mkdirSync(out, { recursive: true });

// Same wrapping as the SPA's build.sh: index.html is a fragment (head tags first, then the app shell).
const lines = readFileSync(resolve(src, 'index.html'), 'utf8').split('\n');
const isHead = (l) => /^<(title|meta|link)/.test(l);
const html = `<!doctype html>\n<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n${lines.filter(isHead).join('\n')}\n</head><body>\n${lines.filter((l) => !isHead(l)).join('\n')}\n</body></html>\n`;
writeFileSync(resolve(out, 'index.html'), html);
console.log(`SPA synced from ${src} → public/`);
