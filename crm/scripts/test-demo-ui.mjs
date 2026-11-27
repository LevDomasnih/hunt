#!/usr/bin/env node
// The Mini App in a real browser: every screen of the site's demo (invented data, no server) on a phone and on the desk,
// with no script errors and something on the screen. Needs public/ built (copy-art.mjs, build-web.mjs) and Chrome
// (installed Chrome, or HUNT_CHROME=<path>; GitHub's ubuntu runners have it).   node scripts/test-demo-ui.mjs
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const crm = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = join(crm, 'public');
if (!existsSync(join(PUB, 'app.js')) || !existsSync(join(PUB, 'art', 'regions.json'))) { console.log('demo ui: build public/ first (scripts/copy-art.mjs, scripts/build-web.mjs)'); process.exit(1); }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.map': 'application/json', '.woff2': 'font/woff2' };
// public/ as the Worker serves it, /app → index.html; anything else (the API) is not there: the demo never calls it
const web = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = p === '/app' || p === '/app/' ? join(PUB, 'index.html') : normalize(join(PUB, p));
  if (!file.startsWith(PUB + sep) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((ok) => web.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${web.address().port}`;

let pass = 0, fail = 0;
const ok = (c, name, x = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${name} ${JSON.stringify(x)?.slice(0, 400)}`); } };
const demo = JSON.parse(readFileSync(join(PUB, 'demo-home', 'demo.json'), 'utf8'));
const sids = [...new Set(Object.keys(demo).map((k) => (k.match(/[?&]s=(s_[a-z0-9]+)/) ?? [])[1]).filter(Boolean))];
const SCREENS = ['today', 'listings', 'map', 'plan', 'chats', 'money', 'afisha', 'more', 'orders', 'shop', 'basket', 'deal', 'docs', 'house', 'people',
  'surf', 'calendar', 'bikes', 'agent', 'access', 'path', 'useful', 'guide'];
// Errors that are not the app's: the map's tiles and sprites cut off by leaving a screen fast, blocked third-party fonts.
const NOISE = /AbortError|signal is aborted|AJAXError|tiles\.openfreemap|fonts\.(googleapis|gstatic)|Failed to load resource/;

const browser = await chromium.launch(process.env.HUNT_CHROME ? { executablePath: process.env.HUNT_CHROME } : { channel: 'chrome' });
try {
  for (const [label, view] of [['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }], ['desk', { viewport: { width: 1440, height: 900 } }]]) {
    const ctx = await browser.newContext({ ...view, locale: 'ru-RU' });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => (/unpkg\.com|openfreemap/.test(r.request().url()) ? r.continue() : r.abort())); // no Telegram, no fonts: offline-ish
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(m.text()); });
    await page.goto(`${BASE}/app`);
    await page.evaluate(() => sessionStorage.setItem('hunt.demo', '1'));
    await page.goto(`${BASE}/app#/searches`);
    await page.waitForFunction(() => (document.querySelector('#root')?.textContent ?? '').length > 20, null, { timeout: 15000 });
    ok(sids.length >= 2, `${label}: the demo has projects`, sids);
    const empty = [];
    for (const sid of sids) {
      for (const sc of SCREENS) {
        await page.evaluate((h) => { location.hash = h; }, `/s/${sid}/${sc}`);
        await page.waitForTimeout(250);
        const n = await page.evaluate(() => (document.querySelector('#root')?.textContent ?? '').trim().length);
        if (n < 10) empty.push(`${sid}/${sc}`);
      }
    }
    await page.evaluate(() => { location.hash = '/new'; });
    await page.waitForTimeout(300);
    ok(!empty.length, `${label}: every screen draws something`, empty);
    ok(!errors.length, `${label}: no script errors on ${sids.length * SCREENS.length + 1} screens`, errors.slice(0, 5));
    await ctx.close();
  }
} catch (e) { fail++; console.log('ERROR', e.stack?.slice(0, 600)); } finally { await browser.close(); web.close(); }
console.log(`demo ui: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
