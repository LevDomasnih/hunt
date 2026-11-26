// Hunt sources registry: a private list of listing sources that Hunt servers fetch on request, so that group and chat lists
// are not in the code. Readers: one key per Hunt server. Suggestions wait for the admin. It holds addresses of public
// places only: no listings, no messages, no private persons. Hunters' proposals (a new city, a correction: text files of a region
// pack) wait here too; what the admin approves goes to the hunt-data repository (scripts/proposals.py).

import { refuse, flags, type PackFile } from './inspect';

interface Env { DB: D1Database; ADMIN_KEY: string }
class Err extends Error { constructor(public status: number, public code: string, msg?: string) { super(msg ?? code); } }
const now = () => new Date().toISOString();
const json = (d: unknown, status = 200, h: Record<string, string> = {}) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...h } });
function rid(p: string, n = 12) { const b = new Uint8Array(n); crypto.getRandomValues(b); return p + Array.from(b, (x) => (x % 36).toString(36)).join(''); }
async function sha(s: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), (x) => x.toString(16).padStart(2, '0')).join(''); }
const bearer = (req: Request) => { const h = req.headers.get('authorization') ?? ''; return h.startsWith('Bearer ') ? h.slice(7).trim() : ''; };

export const SECTIONS = ['portals', 'telegram', 'facebook_groups', 'whatsapp_communities', 'instagram', 'line', 'agencies', 'official', 'guides', 'post_request_where'] as const;
const FIELDS = ['handle', 'name', 'title', 'url', 'cities', 'lang', 'type', 'contact', 'note', 'members', 'events', 'verified', 'text'];

function country(v: unknown): string {
  const c = String(v ?? '').trim().toLowerCase();
  if (!/^[a-z]{2,20}$/.test(c)) throw new Err(400, 'bad_country');
  return c;
}
const line = (v: unknown, max: number) => String(v).replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** One entry with known fields only. `trusted` = the admin's import; suggestions carry no phone numbers or personal contacts. */
export function cleanEntry(section: string, e: any, trusted: boolean): { data: Record<string, unknown>; key: string } {
  if (typeof e === 'string') e = { text: e };
  if (!e || typeof e !== 'object' || Array.isArray(e)) throw new Err(400, 'bad_entry');
  const d: Record<string, unknown> = {};
  for (const f of FIELDS) {
    const v = e[f];
    if (v == null || v === '') continue;
    if (f === 'contact' && !trusted) throw new Err(400, 'no_contacts', 'Suggestions carry no phones or personal contacts');
    if (f === 'cities' || (f === 'lang' && Array.isArray(v))) {
      if (!Array.isArray(v) || v.length > 12) throw new Err(400, 'bad_entry', f);
      d[f] = v.map((x) => line(x, 40)).filter(Boolean);
    } else if (typeof v === 'boolean') d[f] = v;
    else if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Err(400, 'bad_entry', f); d[f] = v; }
    else if (v instanceof Object) throw new Err(400, 'bad_entry', f);
    else d[f] = line(v, f === 'note' || f === 'text' ? 2000 : f === 'contact' ? 600 : 200);
  }
  if (d.url) {
    let u: URL; try { u = new URL(String(d.url)); } catch { throw new Err(400, 'bad_url'); }
    if (u.protocol !== 'https:' && !(trusted && u.protocol === 'http:')) throw new Err(400, 'bad_url', 'https only');
    if (u.username || u.password) throw new Err(400, 'bad_url');
  }
  if (d.handle && !/^@[A-Za-z0-9_]{4,32}$/.test(String(d.handle))) throw new Err(400, 'bad_handle');
  if (!trusted && /(\+|wa\.me\/)\s?\d[\d ()-]{7,}/.test(JSON.stringify(d))) throw new Err(400, 'no_contacts', 'Suggestions carry no phones or personal contacts');
  const id = d.handle ?? d.url ?? d.name ?? d.text ?? d.note;
  if (!id) throw new Err(400, 'bad_entry', 'handle, url, name or text is required');
  if (section === 'telegram' && !d.handle && !trusted) throw new Err(400, 'bad_handle');
  return { data: d, key: String(id).toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '').slice(0, 300) };
}

async function limit(env: Env, key: string, max: number) {
  const r = await env.DB.prepare('INSERT INTO counters (key, n, at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET n=n+1 RETURNING n').bind(`${key}:${now().slice(0, 10)}`, now()).first<{ n: number }>();
  if (Number(r?.n) > max) throw new Err(429, 'rate_limited');
}
async function reader(req: Request, env: Env): Promise<string> {
  const t = bearer(req);
  const k = t ? await env.DB.prepare('SELECT id FROM keys WHERE hash=? AND revoked_at IS NULL').bind(await sha(t)).first<{ id: string }>() : null;
  if (!k) throw new Err(401, 'bad_key');
  return k.id;
}
async function admin(req: Request, env: Env) {
  const a = await sha(bearer(req)), b = await sha(String(env.ADMIN_KEY ?? '').trim());
  if (!String(env.ADMIN_KEY ?? '').trim() || a !== b) throw new Err(401, 'bad_key');
}
async function body(req: Request): Promise<any> {
  const t = await req.text();
  if (t.length > 1_000_000) throw new Err(413, 'too_big');
  try { return JSON.parse(t); } catch { throw new Err(400, 'bad_json'); }
}

const block = (v: unknown, max: number) => String(v ?? '').replace(/\r/g, '').replace(/[\u0000-\u0009\u000b-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]+/g, ' ').trim().slice(0, max);
async function propose(env: Env, k: string, b: any) {
  const c = country(b.country), ref = line(b.ref ?? '', 60), title = line(b.title ?? '', 120);
  if (!/^[A-Za-z0-9_-]{4,60}$/.test(ref) || !title) throw new Err(400, 'missing', 'ref and title');
  const files: PackFile[] = Array.isArray(b.files) ? b.files.map((f: any) => ({ path: f?.path, content: typeof f?.content === 'string' ? f.content.replace(/\r\n/g, '\n') : f?.content })) : [];
  const extra: any[] = Array.isArray(b.sources) ? b.sources.slice(0, 200) : [];
  if (files.length || !extra.length) { const bad = refuse(c, files); if (bad) throw new Err(400, 'bad_files', bad); }
  const src = extra.map((x) => {
    if (!(SECTIONS as readonly string[]).includes(x?.section)) throw new Err(400, 'bad_section', SECTIONS.join(', '));
    return { section: x.section, entry: cleanEntry(x.section, x.entry, false).data };
  });
  const old = await env.DB.prepare('SELECT id, status FROM proposals WHERE key_id=? AND ref=?').bind(k, ref).first<any>();
  if (old && !['pending', 'returned'].includes(old.status)) return json({ id: old.id, status: old.status, known: true });
  const id = old?.id ?? rid('prop_');
  const st: D1PreparedStatement[] = [
    env.DB.prepare(`INSERT INTO proposals (id, key_id, ref, country, title, note, author, base, sources, flags, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'pending',?,?)
      ON CONFLICT(key_id,ref) DO UPDATE SET title=excluded.title, note=excluded.note, author=excluded.author, base=excluded.base, sources=excluded.sources, flags=excluded.flags, status='pending', comment=NULL, updated_at=excluded.updated_at`)
      .bind(id, k, ref, c, title, block(b.note, 2000), b.author ? line(b.author, 40) : null, b.base ? line(b.base, 40) : null, JSON.stringify(src), JSON.stringify(flags(files)), now(), now()),
    env.DB.prepare('DELETE FROM proposal_files WHERE proposal_id=?').bind(id),
    ...files.map((f) => env.DB.prepare('INSERT INTO proposal_files (proposal_id, path, content) VALUES (?,?,?)').bind(id, f.path, f.content)),
  ];
  await env.DB.batch(st);
  return json({ id, status: 'pending', known: !!old }, old ? 200 : 201);
}
const view = (x: any) => ({ ...x, sources: JSON.parse(x.sources), flags: JSON.parse(x.flags) });

async function list(env: Env, c: string) {
  const r = (await env.DB.prepare("SELECT id, section, data, updated_at FROM sources WHERE country=? AND status='approved' ORDER BY section, sort, created_at LIMIT 2000").bind(c).all<any>()).results ?? [];
  const sections: Record<string, unknown[]> = {};
  let updated: string | null = null;
  for (const x of r) { (sections[x.section] ??= []).push({ id: x.id, ...JSON.parse(x.data) }); if (!updated || x.updated_at > updated) updated = x.updated_at; }
  return { country: c, updated_at: updated, count: r.length, sections };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const u = new URL(req.url), p = u.pathname, m = req.method;
    try {
      if (p === '/health') return json({ ok: true, service: 'hunt-sources' });
      if (p === '/v1/sources' && m === 'GET') {
        const k = await reader(req, env);
        await limit(env, `r:${k}`, 5000);
        return json(await list(env, country(u.searchParams.get('country'))));
      }
      if (p === '/v1/suggest' && m === 'POST') {
        const k = await reader(req, env);
        await limit(env, `s:${k}`, 50);
        const b = await body(req);
        if (!(SECTIONS as readonly string[]).includes(b.section)) throw new Err(400, 'bad_section', SECTIONS.join(', '));
        const c = country(b.country), e = cleanEntry(b.section, b.entry, false);
        const old = await env.DB.prepare('SELECT status FROM sources WHERE country=? AND section=? AND key=?').bind(c, b.section, e.key).first<{ status: string }>();
        if (old) return json({ status: old.status === 'rejected' ? 'pending' : old.status, known: true });
        await env.DB.prepare("INSERT OR IGNORE INTO sources (id, country, section, key, data, status, added_by, created_at, updated_at) VALUES (?,?,?,?,?,'pending',?,?,?)")
          .bind(rid('src_'), c, b.section, e.key, JSON.stringify(e.data), k, now(), now()).run();
        return json({ status: 'pending', known: false }, 201);
      }
      if (p === '/v1/report' && m === 'POST') {
        const k = await reader(req, env);
        await limit(env, `p:${k}`, 200);
        const b = await body(req);
        if (!['dead', 'spam', 'ok'].includes(b.kind)) throw new Err(400, 'bad_kind');
        if (!(await env.DB.prepare("SELECT 1 FROM sources WHERE id=? AND status='approved'").bind(String(b.id ?? '')).first())) throw new Err(404, 'no_source');
        await env.DB.prepare('INSERT INTO reports (source_id, key_id, kind, at) VALUES (?,?,?,?) ON CONFLICT(source_id,key_id) DO UPDATE SET kind=excluded.kind, at=excluded.at').bind(b.id, k, b.kind, now()).run();
        return json({ ok: true });
      }
      if (p === '/v1/proposals' && m === 'POST') {
        const k = await reader(req, env);
        await limit(env, `pr:${k}`, 30);
        return await propose(env, k, await body(req));
      }
      if (p === '/v1/proposals' && m === 'GET') {
        const k = await reader(req, env);
        await limit(env, `r:${k}`, 5000);
        const refs = String(u.searchParams.get('refs') ?? '').split(',').filter((x) => /^[A-Za-z0-9_-]{4,60}$/.test(x)).slice(0, 50);
        if (!refs.length) return json({ proposals: [] });
        const r = await env.DB.prepare(`SELECT id, ref, status, comment, updated_at FROM proposals WHERE key_id=? AND ref IN (${refs.map(() => '?').join(',')})`).bind(k, ...refs).all();
        return json({ proposals: r.results ?? [] });
      }
      if (p.startsWith('/admin/')) {
        await admin(req, env);
        if (p === '/admin/proposals' && m === 'GET') {
          const st = u.searchParams.get('status') ?? 'pending';
          const r = (await env.DB.prepare(`SELECT p.id, p.country, p.title, p.note, p.author, p.base, p.sources, p.flags, p.status, p.comment, p.created_at, p.updated_at, k.label server,
            (SELECT COUNT(*) FROM proposal_files f WHERE f.proposal_id=p.id) files FROM proposals p JOIN keys k ON k.id=p.key_id WHERE p.status=? ORDER BY p.created_at LIMIT 100`).bind(st).all<any>()).results ?? [];
          return json({ proposals: r.map(view) });
        }
        const one = /^\/admin\/proposals\/(prop_[a-z0-9]+)$/.exec(p);
        if (one && m === 'GET') {
          const x = await env.DB.prepare('SELECT p.*, k.label server FROM proposals p JOIN keys k ON k.id=p.key_id WHERE p.id=?').bind(one[1]).first<any>();
          if (!x) throw new Err(404, 'no_proposal');
          const { key_id: _k, ref: _r, ...rest } = x;
          return json({ ...view(rest), files: (await env.DB.prepare('SELECT path, content FROM proposal_files WHERE proposal_id=? ORDER BY path').bind(one[1]).all()).results ?? [] });
        }
        if (p === '/admin/proposals/decide' && m === 'POST') {
          const b = await body(req), x = await env.DB.prepare('SELECT id, country, sources, status, updated_at FROM proposals WHERE id=?').bind(String(b.id ?? '')).first<any>();
          if (!x) throw new Err(404, 'no_proposal');
          const from: Record<string, string[]> = { approved: ['pending'], returned: ['pending'], rejected: ['pending', 'returned'], merged: ['approved'] };
          if (!from[b.status]) throw new Err(400, 'bad_status');
          if (!from[b.status].includes(x.status)) throw new Err(409, 'wrong_state', x.status);
          if (b.seen && b.seen !== x.updated_at) throw new Err(409, 'changed', 'The author sent a new version, look again');
          if (b.status === 'returned' && !block(b.comment, 1000)) throw new Err(400, 'missing', 'comment');
          const st: D1PreparedStatement[] = [env.DB.prepare('UPDATE proposals SET status=?, comment=COALESCE(?, comment), updated_at=? WHERE id=?').bind(b.status, b.comment ? block(b.comment, 1000) : null, now(), x.id)];
          if (b.status === 'approved') for (const s of JSON.parse(x.sources)) {
            const e = cleanEntry(s.section, s.entry, false);
            st.push(env.DB.prepare(`INSERT INTO sources (id, country, section, key, data, status, created_at, updated_at) VALUES (?,?,?,?,?,'approved',?,?) ON CONFLICT(country,section,key) DO UPDATE SET status='approved', updated_at=excluded.updated_at`)
              .bind(rid('src_'), x.country, s.section, e.key, JSON.stringify(e.data), now(), now()));
          }
          if (b.status === 'merged' || b.status === 'rejected') st.push(env.DB.prepare('DELETE FROM proposal_files WHERE proposal_id=?').bind(x.id));
          for (let i = 0; i < st.length; i += 50) await env.DB.batch(st.slice(i, i + 50));
          return json({ ok: true, status: b.status });
        }
        if (p === '/admin/keys' && m === 'POST') {
          const b = await body(req), label = line(b.label ?? '', 60);
          if (!label) throw new Err(400, 'missing', 'label');
          const raw = new Uint8Array(32); crypto.getRandomValues(raw);
          const key = 'hsrc_' + btoa(String.fromCharCode(...raw)).replace(/[+/=]/g, (x) => ({ '+': '-', '/': '_', '=': '' })[x]!);
          const id = rid('k_');
          await env.DB.prepare('INSERT INTO keys (id, hash, label, created_at) VALUES (?,?,?,?)').bind(id, await sha(key), label, now()).run();
          return json({ id, key }, 201); // shown once
        }
        if (p === '/admin/keys' && m === 'GET') return json({ keys: (await env.DB.prepare('SELECT id, label, created_at, revoked_at FROM keys ORDER BY created_at').all()).results });
        if (p === '/admin/keys/revoke' && m === 'POST') { const b = await body(req); await env.DB.prepare('UPDATE keys SET revoked_at=? WHERE id=? AND revoked_at IS NULL').bind(now(), String(b.id)).run(); return json({ ok: true }); }
        if (p === '/admin/import' && m === 'POST') {
          const b = await body(req), c = country(b.country), st: D1PreparedStatement[] = [];
          let n = 0;
          for (const [section, arr] of Object.entries(b.sections ?? {})) {
            if (!(SECTIONS as readonly string[]).includes(section) || !Array.isArray(arr)) throw new Err(400, 'bad_section', section);
            for (const [i, raw] of arr.entries()) {
              const e = cleanEntry(section, raw, true);
              st.push(env.DB.prepare(`INSERT INTO sources (id, country, section, key, data, status, sort, created_at, updated_at) VALUES (?,?,?,?,?,'approved',?,?,?)
                ON CONFLICT(country,section,key) DO UPDATE SET data=excluded.data, status='approved', sort=excluded.sort, updated_at=CASE WHEN data=excluded.data THEN updated_at ELSE excluded.updated_at END`)
                .bind(rid('src_'), c, section, e.key, JSON.stringify(e.data), i, now(), now()));
              n++;
            }
          }
          for (let i = 0; i < st.length; i += 50) await env.DB.batch(st.slice(i, i + 50));
          return json({ imported: n });
        }
        if (p === '/admin/pending' && m === 'GET') {
          const r = (await env.DB.prepare(`SELECT s.id, s.country, s.section, s.data, s.created_at, k.label added_by FROM sources s LEFT JOIN keys k ON k.id=s.added_by WHERE s.status='pending' ORDER BY s.created_at LIMIT 200`).all<any>()).results ?? [];
          const bad = (await env.DB.prepare(`SELECT s.id, s.country, s.section, s.data, SUM(r.kind='dead') dead, SUM(r.kind='spam') spam FROM reports r JOIN sources s ON s.id=r.source_id WHERE s.status='approved' GROUP BY s.id HAVING dead+spam>0 ORDER BY dead+spam DESC LIMIT 100`).all<any>()).results ?? [];
          const v = (x: any) => ({ ...x, data: JSON.parse(x.data) });
          return json({ pending: r.map(v), reported: bad.map(v) });
        }
        if (p === '/admin/decide' && m === 'POST') {
          const b = await body(req);
          if (!['approved', 'rejected'].includes(b.status)) throw new Err(400, 'bad_status');
          const r = await env.DB.prepare('UPDATE sources SET status=?, updated_at=? WHERE id=?').bind(b.status, now(), String(b.id)).run();
          if (!r.meta.changes) throw new Err(404, 'no_source');
          await env.DB.prepare('DELETE FROM reports WHERE source_id=?').bind(String(b.id)).run();
          return json({ ok: true });
        }
        if (p === '/admin/export' && m === 'GET') return json(await list(env, country(u.searchParams.get('country'))));
      }
      throw new Err(404, 'not_found');
    } catch (e) {
      if (e instanceof Err) return json({ error: e.code, message: e.message }, e.status);
      const ref = rid('err_'); console.error(ref, e);
      return json({ error: 'internal', ref }, 500);
    }
  },
};
