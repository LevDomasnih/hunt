// Hunt on an ordinary server: the same Worker (src/index.ts) on Node 22.5+, with SQLite instead of D1 and KV, public/ served
// from disk and the 15-minute cron in-process. Built into dist/server.mjs by scripts/build-node.mjs; Dockerfile runs it.
//   node dist/server.mjs     settings from the environment: see crm/README.md, "Your own server without Cloudflare"
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import worker from '../src/index.ts';
import { NodeD1 } from './d1.mjs';
import { NodeKV } from './kv.mjs';
import { migrate } from './migrate.mjs';

const here = dirname(fileURLToPath(import.meta.url)); // dist/ once bundled
const E = process.env;
const PORT = Number(E.PORT || 8787);
const PUBLIC = resolve(E.HUNT_PUBLIC || join(here, '..', 'public'));
const MIGRATIONS = resolve(E.HUNT_MIGRATIONS || join(here, '..', 'migrations'));
const DB_FILE = resolve(E.HUNT_DB || join(here, '..', 'data', 'hunt.db'));
const TRUST_PROXY = E.TRUST_PROXY === '1'; // behind nginx / Caddy / a tunnel that sets X-Forwarded-For

// ---- database: SQLite in one file (D1 tables + the KV table), migrations applied at start
mkdirSync(dirname(DB_FILE), { recursive: true });
const d1 = new NodeD1(DB_FILE);
const sql = d1.db;
try { for (const f of migrate(sql, MIGRATIONS)) console.log('migration', f); } catch (e) { console.error(e.message); process.exit(1); }
const kv = new NodeKV(sql);

// ---- static files: like Workers Static Assets with html_handling = none (exact paths only, ETag, revalidate)
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.glb': 'model/gltf-binary', '.usdz': 'model/vnd.usdz+zip', '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf', '.wasm': 'application/wasm' };
function staticFile(pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch { return null; }
  if (p.includes('\0')) return null;
  const file = normalize(join(PUBLIC, p));
  if (file !== PUBLIC && !file.startsWith(PUBLIC + sep)) return null;
  try { const st = statSync(file); return st.isFile() ? { file, st } : null; } catch { return null; }
}
function staticResponse(hit, method, inm) {
  const etag = `"${hit.st.size.toString(36)}-${Math.floor(hit.st.mtimeMs).toString(36)}"`;
  const headers = { 'content-type': TYPES[extname(hit.file).toLowerCase()] || 'application/octet-stream', etag, 'cache-control': 'public, max-age=0, must-revalidate' };
  if (inm && inm === etag) return new Response(null, { status: 304, headers });
  headers['content-length'] = String(hit.st.size);
  return new Response(method === 'HEAD' ? null : Readable.toWeb(createReadStream(hit.file)), { status: 200, headers });
}
const ASSETS = {
  async fetch(input, init) {
    const req = input instanceof Request ? input : new Request(input, init);
    const hit = staticFile(new URL(req.url).pathname);
    return hit ? staticResponse(hit, req.method, req.headers.get('if-none-match')) : new Response('Not found', { status: 404 });
  },
};

// ---- the Worker's environment
const KEYS = ['TG_BOT_TOKEN', 'TG_WEBHOOK_SECRET', 'SETUP_KEY', 'LINK_SECRET', 'PUBLIC_URL', 'BOT_USERNAME', 'SOURCES_URL', 'SOURCES_KEY', 'SOURCES_ADMIN_KEY',
  'OPEN_SIGNUP', 'CHAT_KEK', 'AI_ON', 'NO_FREE_TIER_LIMITS'];
const env = { DB: d1, PHOTOS_KV: kv, ASSETS, NO_FREE_TIER_LIMITS: '1' };
for (const k of KEYS) if (E[k] != null && E[k] !== '') env[k] = E[k];
for (const k of ['TG_BOT_TOKEN', 'TG_WEBHOOK_SECRET', 'SETUP_KEY', 'LINK_SECRET', 'PUBLIC_URL', 'BOT_USERNAME']) if (!env[k]) console.warn(`warning: ${k} is not set`);
const BASE = env.PUBLIC_URL ? new URL(env.PUBLIC_URL).origin : `http://localhost:${PORT}`;

/** The client address the Worker reads from cf-connecting-ip (rate limits per IP): never taken from the client itself. */
function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (xff.length) return xff[xff.length - 1]; // the address our own proxy saw
    if (req.headers['x-real-ip']) return String(req.headers['x-real-ip']);
  }
  return (req.socket.remoteAddress ?? 'local').replace(/^::ffff:/, '');
}

// ---- HTTP
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', BASE);
    const method = req.method ?? 'GET';
    if (method === 'GET' || method === 'HEAD') {
      const hit = staticFile(url.pathname); // static files first, as on Cloudflare
      if (hit) return send(res, staticResponse(hit, method, req.headers['if-none-match']));
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v == null || k === 'cf-connecting-ip' || k === 'host') continue;
      for (const x of Array.isArray(v) ? v : [v]) headers.append(k, x);
    }
    headers.set('host', url.host);
    headers.set('cf-connecting-ip', clientIp(req));
    const hasBody = method !== 'GET' && method !== 'HEAD';
    const request = new Request(url, { method, headers, ...(hasBody ? { body: Readable.toWeb(req), duplex: 'half' } : {}) });
    await send(res, await worker.fetch(request, env, { waitUntil: (p) => p.catch((e) => console.error('waitUntil', e)), passThroughOnException() {} }));
  } catch (e) {
    console.error('request failed', e);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal' }));
  }
});
async function send(res, r) {
  const h = {};
  r.headers.forEach((v, k) => { if (k !== 'set-cookie') h[k] = v; });
  const cookies = r.headers.getSetCookie?.() ?? [];
  if (cookies.length) h['set-cookie'] = cookies;
  res.writeHead(r.status, h);
  if (!r.body) return res.end();
  await new Promise((ok, fail) => Readable.fromWeb(r.body).on('error', fail).pipe(res).on('finish', ok).on('error', fail));
}

// ---- cron: every 15 minutes on the quarter hour, never two at once
let cronBusy = false;
async function tick() {
  if (cronBusy) return;
  cronBusy = true;
  const waits = [];
  try {
    const ctl = { cron: '*/15 * * * *', scheduledTime: Date.now(), noRetry() {} };
    await worker.scheduled(ctl, env, { waitUntil: (p) => waits.push(p), passThroughOnException() {} });
    await Promise.allSettled(waits);
    kv.sweep();
  } catch (e) {
    console.error('cron failed', e);
  } finally {
    cronBusy = false;
  }
}
function schedule() {
  const q = 15 * 60 * 1000, wait = q - (Date.now() % q) + 1000;
  setTimeout(() => { tick().finally(schedule); }, wait).unref?.();
}
if (E.HUNT_CRON !== '0') schedule();
if (E.HUNT_CRON_NOW === '1') tick().then(() => console.log('cron: one tick done')); // a tick right away (checks, or after downtime)

server.listen(PORT, () => console.log(`hunt on :${PORT}  db ${DB_FILE}  public ${PUBLIC}${existsSync(PUBLIC) ? '' : ' (missing: run scripts/copy-art.mjs and build-web.mjs)'}`));
const stop = () => { server.close(() => { try { sql.close(); } catch { /* closed */ } process.exit(0); }); setTimeout(() => process.exit(0), 5000).unref(); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
