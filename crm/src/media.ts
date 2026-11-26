// Media in Workers KV (listing albums, voice notes, on-site/receipt/meter/item photos) and the D1 counters that keep
// the free tier safe: KV writes per day, per-user rate limits. Also the purpose-bound photo token for <img> URLs.
import { Env, HttpError, now, hmac, hex, safeEqual } from './util';

// ---------------------------------------------------------------- counters (D1)

/** Add `by` to a counter row and return the new value (one statement). */
export async function bump(env: Env, key: string, by = 1): Promise<number> {
  const r = await env.DB.prepare('INSERT INTO counters (key, n, at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET n=n+excluded.n, at=excluded.at RETURNING n')
    .bind(key, by, now()).first<{ n: number }>();
  return Number(r?.n ?? by);
}

/** Basic per-user limit: at most `max` calls per `windowSec` in a bucket (429 above it). */
export async function rateLimit(env: Env, bucket: string, uid: string, max: number, windowSec = 3600): Promise<void> {
  const win = Math.floor(Date.now() / 1000 / windowSec);
  const n = await bump(env, `rl:${bucket}:${uid}:${win}`);
  if (n > max) throw new HttpError(429, 'rate_limited', `Too many requests (${bucket}); try again later.`);
}

export const KV_SOFT = 900; // agent albums wait above this many KV writes per UTC day
export const KV_HARD = 990; // nothing is written above this (free tier: 1,000 writes/day)

/** Reserve `n` KV writes for today; 429 when the day's budget is used up. */
export async function kvBudget(env: Env, n: number, limit = KV_HARD): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const used = await bump(env, `kv:${day}`, n);
  if (used > limit) {
    await bump(env, `kv:${day}`, -n);
    throw new HttpError(429, 'kv_budget', 'Storage writes for today are used up (Cloudflare free tier). Try again tomorrow (after 00:00 UTC).');
  }
}

/** Cron: drop counters older than two days. */
export async function pruneCounters(env: Env): Promise<void> {
  await env.DB.prepare('DELETE FROM counters WHERE at < ?').bind(new Date(Date.now() - 2 * 864e5).toISOString()).run();
}

// ---------------------------------------------------------------- uploads and serving

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
/** Types served inline; anything else is served as an attachment (never rendered by the browser). */
const INLINE_TYPES = new Set([...IMAGE_TYPES, 'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'application/pdf', 'model/gltf-binary', 'video/mp4', 'video/quicktime']);
export const AUDIO_TYPES = ['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/x-m4a'];

/** Headers for user/agent-provided bytes: sniffing off, sandboxed, inline only for whitelisted types. */
export function mediaHeaders(type: string | null | undefined, extra: Record<string, string> = {}, name = 'file'): Record<string, string> {
  const t = String(type ?? '').split(';')[0].trim().toLowerCase();
  const inline = INLINE_TYPES.has(t);
  return {
    'content-type': inline ? t : 'application/octet-stream',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    ...(inline ? {} : { 'content-disposition': `attachment; filename="${name.replace(/[^\w.\- ]+/g, '_')}"` }),
    ...extra,
  };
}

const KV_TTL = 180 * 86400; // listing photos expire after ~6 months (a search rarely lives longer; the home keeps its deal photos via Telegram)

/** Image body (≤ 10 MB, jpeg/png/webp/heic) into KV under `key`. */
export async function putImage(env: Env, req: Request, key: string, opts: { ttl?: number } = {}) {
  const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!IMAGE_TYPES.includes(type)) throw new HttpError(400, 'not_image', 'Send the photo as JPEG, PNG, WebP or HEIC');
  const buf = await req.arrayBuffer();
  if (!buf.byteLength) throw new HttpError(400, 'empty');
  if (buf.byteLength > 10 * 1024 * 1024) throw new HttpError(413, 'too_big', 'Photos up to 10 MB');
  await kvBudget(env, 1);
  await env.PHOTOS_KV.put(key, buf, { metadata: { type }, ...(opts.ttl ? { expirationTtl: opts.ttl } : {}) });
}

/**
 * A listing album as ONE KV value (free tier: 1,000 writes/day): the photos are concatenated, offsets and types sit in the
 * metadata, each photo is `{kv: 'a/<lid>/<ts>', i}` and is served as a slice. Expires after ~180 days.
 */
export async function putAlbum(env: Env, lid: string, files: File[]): Promise<{ kv: string; i: number }[]> {
  const parts: { buf: ArrayBuffer; type: string }[] = [];
  for (const f of files) {
    const type = String(f.type || 'image/jpeg').toLowerCase();
    if (!IMAGE_TYPES.includes(type)) throw new HttpError(400, 'not_image', `${f.name || 'a file'}: send JPEG, PNG, WebP or HEIC`);
    parts.push({ buf: await f.arrayBuffer(), type });
  }
  const total = parts.reduce((a, p) => a + p.buf.byteLength, 0);
  if (total > 24 * 1024 * 1024) throw new HttpError(413, 'album_too_big', 'The photos together must be under 24 MB: resize them first');
  await kvBudget(env, 1, KV_SOFT);
  const out = new Uint8Array(total);
  const o: [number, number][] = [];
  let off = 0;
  for (const p of parts) { out.set(new Uint8Array(p.buf), off); o.push([off, p.buf.byteLength]); off += p.buf.byteLength; }
  const key = `a/${lid}/${Date.now().toString(36)}`;
  await env.PHOTOS_KV.put(key, out, { metadata: { o, t: parts.map((p) => p.type) }, expirationTtl: KV_TTL });
  return parts.map((_, i) => ({ kv: key, i }));
}

export const EVENT_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const EVENT_PHOTO_MAX = 2 * 1024 * 1024;

/** The real type from the first bytes (the declared one is not trusted): jpeg / png / webp, else null. */
export function sniffImage(b: Uint8Array): string | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 12 && String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * An event photo (Афиша) as one KV value `e/<event id>/<ts>`: jpeg/png/webp checked by its bytes, ≤ 2 MB (the agent resizes
 * first), counted against the daily KV write budget like agent albums (waits above KV_SOFT), expires `ttl` seconds from now.
 */
export async function putEventPhoto(env: Env, eid: string, file: File, ttl: number): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (!buf.byteLength) throw new HttpError(400, 'empty', 'The photo file is empty');
  if (buf.byteLength > EVENT_PHOTO_MAX) throw new HttpError(413, 'too_big', 'Event photos up to 2 MB: resize to ≤ 1600 px, JPEG ~82 first');
  const type = sniffImage(buf);
  if (!type) throw new HttpError(400, 'not_image', 'Send the event photo as JPEG, PNG or WebP');
  await kvBudget(env, 1, KV_SOFT);
  const key = `e/${eid}/${Date.now().toString(36)}`;
  await env.PHOTOS_KV.put(key, buf, { metadata: { type }, expirationTtl: Math.max(86400, Math.round(ttl)) });
  return key;
}

/** Bytes and type of one stored photo: a legacy single value (`{kv}`) or a slice of an album (`{kv, i}`). */
export async function kvPhoto(env: Env, key: string, index?: number | null): Promise<{ body: ArrayBuffer | ReadableStream; type: string | null } | null> {
  if (index == null || !key.startsWith('a/')) {
    const { value, metadata } = await env.PHOTOS_KV.getWithMetadata<{ type?: string }>(key, { type: 'stream', cacheTtl: 86400 });
    return value ? { body: value, type: metadata?.type ?? null } : null;
  }
  const { value, metadata } = await env.PHOTOS_KV.getWithMetadata<{ o?: [number, number][]; t?: string[] }>(key, { type: 'arrayBuffer', cacheTtl: 86400 });
  const at = metadata?.o?.[index];
  if (!value || !at) return null;
  return { body: value.slice(at[0], at[0] + at[1]), type: metadata?.t?.[index] ?? 'image/jpeg' };
}

/** Photos as the Mini App gets them: an opaque `src` (album slice or listing photo by index), never a raw Telegram file_id. */
export function withSrc(lid: string, photos: any[] | null | undefined): any[] {
  return (Array.isArray(photos) ? photos : []).map((p, idx) => {
    if (!p || typeof p !== 'object') return p;
    const { file_id, ...rest } = p;
    if (p.kv) return { ...rest, src: `/app/kv/${encodeURIComponent(p.kv)}${p.i != null ? `?i=${Number(p.i)}` : ''}` };
    if (file_id) return { ...rest, src: `/app/photo/${encodeURIComponent(lid)}/${idx}` };
    return rest;
  });
}

// ---------------------------------------------------------------- photo token (<img> URLs cannot send headers)

const utcDay = (offsetDays = 0) => new Date(Date.now() + offsetDays * 864e5).toISOString().slice(0, 10).replace(/-/g, '');

/**
 * "photo|uid|day|gen|sid": stable for the UTC day (URLs stay cacheable), valid until the end of the next UTC day, never a session.
 * A token issued under a scoped link carries that search id and opens only that search's media.
 */
export async function photoToken(env: Env, uid: string, gen: number, sid?: string | null): Promise<string> {
  const day = utcDay();
  const sig = hex(await hmac(env.LINK_SECRET, `photo|${uid}|${day}|${gen}|${sid ?? ''}`)).slice(0, 32);
  return sid ? `${uid}.${day}.${sid}.${sig}` : `${uid}.${day}.${sig}`;
}

/** The user (and scope) of a photo token, after checking the signature with the user's current link generation. */
export async function verifyPhotoToken(env: Env, tok: string, genOf: (uid: string) => Promise<number | null>): Promise<{ uid: string; sid: string | null }> {
  const parts = String(tok ?? '').split('.');
  const [uid, day] = parts;
  const sid = parts.length === 4 ? parts[2] : null;
  const sig = parts[parts.length - 1];
  if (!uid || (parts.length !== 3 && parts.length !== 4) || !/^\d{8}$/.test(day ?? '') || !sig || (day !== utcDay() && day !== utcDay(-1))) throw new HttpError(401, 'bad_photo_token');
  const gen = await genOf(uid);
  if (gen == null) throw new HttpError(401, 'bad_photo_token');
  const good = hex(await hmac(env.LINK_SECRET, `photo|${uid}|${day}|${gen}|${sid ?? ''}`)).slice(0, 32);
  if (!safeEqual(good, sig)) throw new HttpError(401, 'bad_photo_token');
  return { uid, sid };
}
