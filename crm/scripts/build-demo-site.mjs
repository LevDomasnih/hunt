#!/usr/bin/env node
// The demo as a static site (no server, no API: invented data played back in the browser), for a link in the README and posts.
// Any static host serves it from the root of a domain: Cloudflare Pages, GitHub Pages with a custom domain, Netlify.
//   node scripts/copy-art.mjs --no-demo && node scripts/build-web.mjs && node scripts/build-demo-site.mjs   → dist-demo/
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const crm = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(crm, 'public'), out = join(crm, 'dist-demo');
if (!existsSync(join(pub, 'app.js')) || !existsSync(join(pub, 'art', 'regions.json'))) { console.log('build-demo-site: build public/ first (copy-art.mjs, build-web.mjs)'); process.exit(1); }
rmSync(out, { recursive: true, force: true });
// public/ minus local-only photos (public/demo comes from the private seed and never ships)
cpSync(pub, out, { recursive: true, filter: (src) => !src.startsWith(join(pub, 'demo') + '/') && src !== join(pub, 'demo') });
// The page starts in the demo: the flag the "See the demo" button sets, before the app reads it.
const html = readFileSync(join(pub, 'index.html'), 'utf8').replace('<div id="root"></div>',
  '<div id="root"></div>\n<script>try { sessionStorage.setItem("hunt.demo", "1"); } catch (e) {}</script>');
if (!html.includes('hunt.demo')) throw new Error('index.html changed: put the demo flag back in');
writeFileSync(join(out, 'index.html'), html);
mkdirSync(join(out, 'app'), { recursive: true });
writeFileSync(join(out, 'app', 'index.html'), html); // /app, as on a real server
writeFileSync(join(out, '_redirects'), '/app /index.html 200\n'); // Cloudflare Pages and Netlify
writeFileSync(join(out, 'robots.txt'), 'User-agent: *\nAllow: /\n');
console.log('build-demo-site: dist-demo/ (serve its root)');
