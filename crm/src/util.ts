export interface Env {
  DB: D1Database;
  PHOTOS_KV: KVNamespace;
  ASSETS: Fetcher; // public/ (Mini App, region art), Workers Static Assets
  TG_BOT_TOKEN: string;
  TG_WEBHOOK_SECRET: string;
  SETUP_KEY: string;
  LINK_SECRET: string;
  PUBLIC_URL: string;
  BOT_USERNAME: string;
  SOURCES_URL?: string; // the sources registry (src/sources.ts) and this server's key to it; unset = only the packs' own lists
  SOURCES_KEY?: string;
  SOURCES_ADMIN_KEY?: string; // only on the registry owner's own server: proposals come to its admins in the bot
  OPEN_SIGNUP?: string; // "1" = anyone who starts the bot becomes a hunter (not recommended)
  CHAT_KEK?: string; // base64 of 32 random bytes: seals conversations at rest (src/vault.ts); unset = plain text
  AI_ON?: string; // "1" = the server runs its own assistant: the money limit is shown
  NO_FREE_TIER_LIMITS?: string; // "1" = not on Cloudflare's free tier (own server, node/server.mjs): no daily KV write cap, no per-tick cron budget
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

export const now = () => new Date().toISOString();

export function rid(prefix: string): string {
  const b = new Uint8Array(10);
  crypto.getRandomValues(b);
  return prefix + Array.from(b, (x) => (x % 36).toString(36)).join('');
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
  // Never echo raw error text (SQL, stack, upstream bodies): log it with a reference, return a generic code.
  const ref = rid('err_');
  console.error(ref, e);
  return json({ error: 'internal', message: 'Something went wrong', ref }, 500);
}

export async function body<T = any>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'bad_json', 'Body must be JSON');
  }
}

const enc = new TextEncoder();

export async function sha256hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return hex(new Uint8Array(d));
}

export function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export async function hmac(key: ArrayBuffer | Uint8Array | string, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    'raw',
    typeof key === 'string' ? enc.encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/** Turn a row's JSON text columns into values. */
export function inflate<T extends Record<string, any>>(row: T | null, cols: string[]): T | null {
  if (!row) return row;
  const out: any = { ...row };
  for (const c of cols) if (typeof out[c] === 'string') out[c] = parseJson(out[c], out[c]);
  return out;
}

export const LISTING_JSON = ['includes', 'fields', 'photos', 'checks', 'travel', 'location', 'flood'];

/** HTML escape for text and double/single-quoted attribute values (Telegram HTML accepts &quot; and numeric entities). */
export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Constant-time string comparison (secrets, signatures). Different lengths compare as unequal without early exit on content. */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = enc.encode(String(a ?? '')), y = enc.encode(String(b ?? ''));
  const len = Math.max(x.length, y.length, 1);
  const xa = new Uint8Array(len), ya = new Uint8Array(len);
  xa.set(x); ya.set(y);
  const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean };
  const same = typeof subtle.timingSafeEqual === 'function' ? subtle.timingSafeEqual(xa, ya) : xa.reduce((d, v, i) => d | (v ^ ya[i]), 0) === 0;
  return same && x.length === y.length;
}

/** An agent-provided link must be http(s); anything else (javascript:, data:, relative) becomes null or a 400. */
export function httpUrl(v: unknown, field = 'url', strict = true): string | null {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (/^https?:\/\/[^\s]+$/i.test(s)) return s.slice(0, 2000);
  if (strict) throw new HttpError(400, 'bad_url', `${field} must be an http(s) link`);
  return null;
}

export async function event(env: Env, search_id: string | null, kind: string, ref: string | null, actor: string, data: unknown = {}) {
  const at = now();
  const ins = env.DB.prepare('INSERT INTO events (search_id, kind, ref, actor, data, at) VALUES (?,?,?,?,?,?)').bind(search_id, kind, ref, actor, JSON.stringify(data), at);
  // The agent's last activity per search (the Mini App shows "agent was here"), kept on the search row instead of MAX() over events.
  if (actor === 'agent' && search_id) await env.DB.batch([ins, env.DB.prepare('UPDATE searches SET agent_seen_at=? WHERE id=?').bind(at, search_id)]);
  else await ins.run();
}

// ---------------------------------------------------------------- sensitive numbers (passport / ID / card)

// Ported from the MCP (plugins/hunt/mcp/hunt_core.py _PASSPORT_IN_TEXT) and extended for RU internal/foreign passports.
const PASSPORT_IN_TEXT = new RegExp(
  '(passport|паспорт[а-яё]*|paspor|pasport|\\bnik\\b|\\bktp\\b|id\\s*card|\\biin\\b|иин)\\s*' +
  '(no\\.?|number|num|#|№|номер|nomor)?\\s*[:#№-]?\\s*(\\d{13,16}|[A-Z]{0,2}\\s?\\d{6,12}|\\d{2}\\s?\\d{2}\\s?\\d{6}|\\d{2}\\s?\\d{7})(?!\\d)', 'i');
// "серия 4510 номер 123456"
const RU_SERIES = /(серия|series)\s*\d{2}\s?\d{2}\s*[,;]?\s*(номер|№|no\.?|number)?\s*[:#№-]?\s*\d{6}(?!\d)/i;
// "загран 75 1234567", "загранпаспорт № 75 1234567"
const RU_FOREIGN = /загран[а-яё]*(\s+паспорт[а-яё]*)?\s*(№|номер|no\.?)?\s*[:#№-]?\s*\d{2}\s?\d{7}(?!\d)/i;
// Indonesian NIK/KTP without a keyword: 16 digits, province 11-94, birth day 01-31 (+40 for women), month 01-12.
const NIK_BARE = /(?<![\d+])(\d{16})(?!\d)/g;
// Digit groups separated by one space, dash or dot (cards are written 4-4-4-4, 4.4.4.4, 4-6-5, often followed by an expiry).
const DIGIT_RUN = /(?<![\d+.])\d+(?:[ .-]\d+)*/g;

function luhn(d: string): boolean {
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let x = Number(d[d.length - 1 - i]);
    if (i % 2) { x *= 2; if (x > 9) x -= 9; }
    sum += x;
  }
  return sum % 10 === 0;
}
function nikLike(d: string): boolean {
  const prov = Number(d.slice(0, 2)), day = Number(d.slice(6, 8)), month = Number(d.slice(8, 10));
  return prov >= 11 && prov <= 94 && ((day >= 1 && day <= 31) || (day >= 41 && day <= 71)) && month >= 1 && month <= 12;
}
/** A card number inside a run of digit groups: any window of whole groups with 13-19 digits that passes Luhn. */
function cardInRun(run: string): boolean {
  const groups = run.split(/[ .-]/);
  for (let i = 0; i < groups.length; i++) {
    let d = '';
    for (let j = i; j < groups.length; j++) {
      d += groups[j];
      if (d.length > 19) break;
      const thousands = j > i && groups.slice(i + 1, j + 1).every((g) => g.length === 3); // "25 000 000 22 000 000" is money
      if (d.length >= 13 && !thousands && new Set(d).size > 1 && luhn(d)) return true;
    }
  }
  return false;
}

/** Passport / ID numbers (near a keyword, RU series+number, bare NIK) or card numbers (Luhn over digit groups). Phones (+…), amounts and links pass. */
export function sensitive(text: string): string | null {
  const s = String(text ?? '').replace(/https?:\/\/\S+/gi, ' ');
  if (PASSPORT_IN_TEXT.test(s) || RU_SERIES.test(s) || RU_FOREIGN.test(s)) return 'a passport or ID number';
  for (const m of s.matchAll(NIK_BARE)) if (nikLike(m[1]) && !luhn(m[1])) return 'a passport or ID number';
  for (const m of s.matchAll(DIGIT_RUN)) {
    if (m[0].replace(/\D/g, '').length >= 13 && cardInRun(m[0])) return 'a card number';
  }
  return null;
}

/** Replace sensitive spans with a marker (for logs of messages from other people, which we keep but never with the numbers). */
export function redactSensitive(text: string | null | undefined): string | null {
  if (text == null) return null;
  let s = String(text);
  if (!sensitive(s)) return s;
  const mark = '[•••]';
  s = s.replace(new RegExp(PASSPORT_IN_TEXT.source, 'gi'), (x, kw) => `${kw} ${mark}`).replace(new RegExp(RU_SERIES.source, 'gi'), mark).replace(new RegExp(RU_FOREIGN.source, 'gi'), mark);
  s = s.replace(NIK_BARE, (x) => (nikLike(x) ? mark : x));
  s = s.replace(DIGIT_RUN, (x) => (x.replace(/\D/g, '').length >= 13 && cardInRun(x) ? mark : x));
  return sensitive(s) ? mark : s;
}

// Keys whose values are identifiers, links or storage keys, not free text (long digit ids would look like NIK/cards).
const NOT_TEXT_KEY = /(^|_)(id|ids|url|urls|key|kv|file_id|external_id|hash|token|photo|photos|receipt|voice|media|code|address|phone|lat|lng|at|date|from|to)$/i;

/** Walk a JSON body: the first free-text value that looks like a passport/ID/card number, as "field: what", or null. */
export function sensitiveIn(data: unknown, path = ''): string | null {
  if (data == null || typeof data === 'boolean') return null;
  if (typeof data === 'number') return Math.abs(data) >= 1e12 ? sensitiveIn(String(Math.trunc(data)), path) : null;
  if (typeof data === 'string') { const r = sensitive(data); return r ? `${path || 'text'}: ${r}` : null; }
  if (Array.isArray(data)) {
    for (let i = 0; i < data.length && i < 2000; i++) { const r = sensitiveIn(data[i], `${path}[${i}]`); if (r) return r; }
    return null;
  }
  if (typeof data === 'object') {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (NOT_TEXT_KEY.test(k) && (typeof v === 'string' || typeof v === 'number')) continue;
      const r = sensitiveIn(v, path ? `${path}.${k}` : k);
      if (r) return r;
    }
  }
  return null;
}

/** Central guard for write requests: rejects a JSON body that carries a passport/ID/card number in any free-text field. */
export async function guardBody(req: Request): Promise<void> {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return;
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) return;
  let data: unknown;
  try { data = await req.clone().json(); } catch { return; } // the route answers bad_json itself
  const hit = sensitiveIn(data);
  if (hit) throw new HttpError(400, 'sensitive', `${hit}. Hunt never stores passport, ID or card numbers: remove it.`);
}

// Intl.DateTimeFormat is expensive to build (CPU budget 10 ms): one per timezone and pattern per isolate.
const dtfCache = new Map<string, Intl.DateTimeFormat>();
export function dtf(locale: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = `${locale}|${JSON.stringify(opts)}`;
  let f = dtfCache.get(k);
  if (!f) { f = new Intl.DateTimeFormat(locale, opts); dtfCache.set(k, f); }
  return f;
}

