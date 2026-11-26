// Listing sources (chats, groups, agencies) come from a separate registry, not from the code: this server asks it with its own
// key, so hunters need none and the key never reaches them. Without SOURCES_URL the region packs' own lists are used.
import { Env, HttpError, json, body } from './util';
import { rateLimit } from './media';

export interface RegistryAnswer { ok: boolean; status: number; data: any }
/** A caller for the registry with this server's key (admin = the registry owner's own server), or null when it is not set up. status 0 = no answer. */
export function registry(env: Env, admin = false): ((path: string, init?: RequestInit) => Promise<RegistryAnswer>) | null {
  const base = String(env.SOURCES_URL ?? '').trim().replace(/\/+$/, ''), key = String((admin ? env.SOURCES_ADMIN_KEY : env.SOURCES_KEY) ?? '').trim();
  if ((!/^https:\/\//.test(base) && !/^http:\/\/(127\.0\.0\.1|localhost)(:|$)/.test(base)) || !key) return null;
  return async (path, init = {}) => {
    const r = await fetch(base + path, { ...init, redirect: 'manual', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000) }).catch(() => null);
    const data: any = r ? await r.json().catch(() => null) : null;
    return r && data ? { ok: r.ok, status: r.status, data } : { ok: false, status: 0, data: null };
  };
}

export async function sourcesAgent(req: Request, env: Env, p: string[], uid: string): Promise<Response | null> {
  if (p[1] !== 'sources') return null;
  const ask = registry(env);
  if (!ask) throw new HttpError(404, 'sources_off', 'This Hunt server has no sources registry');
  const call = async (path: string, init: RequestInit = {}) => {
    const r = await ask(path, init), d = r.data;
    if (!r.status) throw new HttpError(502, 'sources_down', 'The sources registry did not answer');
    if (r.status === 401) throw new HttpError(502, 'sources_key', 'The sources registry refused this server\'s key');
    if (!r.ok) throw new HttpError(r.status >= 500 ? 502 : r.status, String(d.error ?? 'sources'), d.message);
    return json(d, r.status);
  };
  if (p.length === 2 && req.method === 'GET') {
    await rateLimit(env, 'sources', uid, 60);
    return call(`/v1/sources?country=${encodeURIComponent(new URL(req.url).searchParams.get('country') ?? '')}`);
  }
  if (p.length === 3 && (p[2] === 'suggest' || p[2] === 'report') && req.method === 'POST') {
    await rateLimit(env, 'sources-w', uid, 20);
    const b = await body(req);
    return call(`/v1/${p[2]}`, { method: 'POST', body: JSON.stringify(p[2] === 'suggest' ? { country: b.country, section: b.section, entry: b.entry } : { id: b.id, kind: b.kind }) });
  }
  return null;
}
