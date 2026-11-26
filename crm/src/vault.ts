// Conversations at rest. With CHAT_KEK (32 random bytes, base64) set, texts of messages, drafts and thread summaries are sealed with a
// key per owner (AES-GCM). The owner's key, wrapped by CHAT_KEK, lives in KV: D1's point-in-time backups keep ciphertext only, so once
// the KV value is gone, old copies cannot be read. Without CHAT_KEK everything works as plain text.
// The running server can still read what it serves: this protects copies of the database, not from whoever runs the server.
import { Env, HttpError, now, rid } from './util';

const PREFIX = 'enc1:';
const TTL = 60e3; // an erased key disappears from warm isolates within a minute
const cache = new Map<string, { key: CryptoKey; at: number }>();
const owners = new Map<string, { kid: string; at: number }>();
const b64 = (u: Uint8Array) => btoa(Array.from(u, (c) => String.fromCharCode(c)).join(''));
const un64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const enc = (s: string) => new TextEncoder().encode(s);

export const sealOn = (env: Env): boolean => !!env.CHAT_KEK;
export const isSealed = (s: unknown): boolean => typeof s === 'string' && s.startsWith(PREFIX);

async function kek(env: Env): Promise<CryptoKey> {
  const raw = un64(String(env.CHAT_KEK).trim());
  if (raw.length !== 32) throw new HttpError(500, 'bad_chat_kek');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function lock(key: CryptoKey, data: Uint8Array, aad: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc(aad) }, key, data));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return b64(out);
}
async function unlock(key: CryptoKey, s: string, aad: string): Promise<Uint8Array> {
  const raw = un64(s);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12), additionalData: enc(aad) }, key, raw.slice(12)));
}
async function keyOf(env: Env, kid: string): Promise<CryptoKey | null> {
  const hit = cache.get(kid);
  if (hit && Date.now() - hit.at < TTL) return hit.key;
  cache.delete(kid);
  const wrapped = await env.PHOTOS_KV.get(`ck/${kid}`);
  if (!wrapped) return null;
  const key = await crypto.subtle.importKey('raw', await unlock(await kek(env), wrapped, kid), 'AES-GCM', false, ['encrypt', 'decrypt']);
  cache.set(kid, { key, at: Date.now() });
  return key;
}
async function ownerKid(env: Env, owner: string): Promise<string> {
  const hit = owners.get(owner);
  if (hit && Date.now() - hit.at < TTL) return hit.kid;
  const row = await env.DB.prepare('SELECT kid FROM chat_keys WHERE owner_id=?').bind(owner).first<{ kid: string }>();
  let kid = row?.kid;
  if (!kid) {
    const fresh = rid('k_');
    await env.PHOTOS_KV.put(`ck/${fresh}`, await lock(await kek(env), crypto.getRandomValues(new Uint8Array(32)), fresh));
    await env.DB.prepare('INSERT OR IGNORE INTO chat_keys (owner_id, kid, created_at) VALUES (?,?,?)').bind(owner, fresh, now()).run();
    kid = (await env.DB.prepare('SELECT kid FROM chat_keys WHERE owner_id=?').bind(owner).first<{ kid: string }>())!.kid;
    if (kid !== fresh) await env.PHOTOS_KV.delete(`ck/${fresh}`); // another request was first
  }
  owners.set(owner, { kid, at: Date.now() });
  return kid;
}

/** Seals texts of one owner (null and empty stay as they are). */
export async function seal(env: Env, owner: string, text: string | null | undefined): Promise<string | null> {
  if (text == null || text === '') return text ?? null;
  if (!sealOn(env) || isSealed(text)) return text;
  const kid = await ownerKid(env, owner);
  let key = await keyOf(env, kid);
  if (!key) { await new Promise((f) => setTimeout(f, 400)); key = await keyOf(env, kid); }
  if (!key) throw new HttpError(503, 'key_unavailable', 'The key is not ready yet, try again in a minute');
  return `${PREFIX}${kid}:${await lock(key, enc(text), kid)}`;
}
/** Opens a sealed text; plain text passes through; a text whose key is erased is null. */
export async function unseal(env: Env, text: string | null | undefined): Promise<string | null> {
  if (text == null || !isSealed(text)) return text ?? null;
  const [kid, data] = text.slice(PREFIX.length).split(':');
  try {
    const key = sealOn(env) ? await keyOf(env, kid) : null;
    return key ? new TextDecoder().decode(await unlock(key, data, kid)) : null;
  } catch {
    return null;
  }
}
/** Opens the named fields of rows, in place. */
export async function openRows<T extends Record<string, any>>(env: Env, rows: T[], fields: string[]): Promise<T[]> {
  for (const r of rows) for (const f of fields) if (isSealed(r[f])) (r as any)[f] = await unseal(env, r[f]);
  return rows;
}
export const MSG = ['text', 'tr'], DRAFT = ['text', 'edited_text', 'tr'], THREAD = ['known', 'open', 'last'];
export async function openDraft<T extends Record<string, any> | null>(env: Env, d: T): Promise<T> {
  if (d) await openRows(env, [d], DRAFT);
  return d;
}
/** Forgets the owner's key: everything sealed with it, in the database and in its copies, becomes unreadable. */
export async function eraseKey(env: Env, owner: string): Promise<void> {
  const row = await env.DB.prepare('SELECT kid FROM chat_keys WHERE owner_id=?').bind(owner).first<{ kid: string }>();
  if (!row) return;
  await env.PHOTOS_KV.delete(`ck/${row.kid}`);
  await env.DB.prepare('DELETE FROM chat_keys WHERE owner_id=? AND kid=?').bind(owner, row.kid).run();
  cache.delete(row.kid);
  owners.delete(owner);
}
