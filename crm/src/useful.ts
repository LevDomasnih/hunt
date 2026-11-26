// Wave 6 · "Полезное": per-region useful links (Telegram chats and channels, apps, guides and maps).
// Two sources, one shape: the region pack's useful.yaml (exported by scripts/copy-art.mjs to /art/<country>/useful.json) and
// the instance-wide D1 table useful_links: links members suggested (pending → approved/rejected by the agent or by the owner
// of the search where it was suggested), links the agent added (approved), and annotations of pack items (pack_id: activity,
// last_checked). Approved rows show in every search of that country on the instance; pending ones only to the suggester and
// to the owner of that search. Guests see the pack and the approved links, read-only.
import { Env, HttpError, json, body, now, rid, parseJson, event, sensitive, httpUrl } from './util';
import { ownerOfSearch } from './household';
import { rateLimit } from './media';
import { countryOf } from './members';
import { member } from './roles';

export const USEFUL_CATS = ['chats_rent', 'flea', 'bikes', 'news', 'visas', 'medicine', 'food', 'apps', 'guides', 'maps', 'other'] as const;
export const USEFUL_KINDS = ['telegram', 'app', 'web', 'hunt'] as const;
const STATUSES = ['pending', 'approved', 'rejected'];
const LANG_RE = /^([a-z]{2,3}|multi)$/; // any language: packs are added by anyone
const DAY = /^\d{4}-\d{2}-\d{2}$/;

interface PackItem {
  id: string; city: string | null; name: string; url: string; kind: string; category: string; about: { ru: string | null; en: string | null };
  lang: string | null; last_checked: string | null; activity: any; events: boolean; attribution: string | null; icon?: string | null;
}
const packCache = new Map<string, { at: number; data: { verified: string | null; items: PackItem[] } | null }>();
/** The pack's useful.json (null when the country has none), cached for 10 minutes per isolate. */
async function packUseful(env: Env, country: string): Promise<{ verified: string | null; items: PackItem[] } | null> {
  const c = packCache.get(country);
  if (c && Date.now() - c.at < 600e3) return c.data;
  let data: { verified: string | null; items: PackItem[] } | null = null;
  try {
    const r = await env.ASSETS.fetch(new Request(`${env.PUBLIC_URL || 'https://hunt.local'}/art/${country}/useful.json`));
    data = r.ok ? ((await r.json()) as any) : null;
  } catch { data = null; }
  packCache.set(country, { at: Date.now(), data });
  return data;
}

/** A suggested/added link: "@handle" and "t.me/x" become https://t.me/x; otherwise only https:// links (no http, no tg:). */
export function cleanUsefulUrl(v: unknown): string {
  let s = String(v ?? '').trim();
  if (!s) throw new HttpError(400, 'missing', 'url is required');
  if (/^@[A-Za-z0-9_]{4,64}$/.test(s)) s = `https://t.me/${s.slice(1)}`;
  else if (/^(www\.)?(t\.me|telegram\.me)\//i.test(s)) s = `https://${s.replace(/^www\./i, '')}`;
  const u = httpUrl(s, 'url')!;
  if (!/^https:\/\//i.test(u)) throw new HttpError(400, 'bad_url', 'url must be an https:// link or a Telegram @handle');
  let host = '';
  try { host = new URL(u).hostname.toLowerCase(); } catch { throw new HttpError(400, 'bad_url', 'url is not a valid link'); }
  if (!host.includes('.')) throw new HttpError(400, 'bad_url', 'url is not a valid link');
  return u.replace(/^https:\/\/telegram\.me\//i, 'https://t.me/');
}
export function kindOfUrl(u: string): string {
  const host = (() => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } })();
  if (host === 't.me') return 'telegram';
  if (host === 'apps.apple.com' || host === 'play.google.com' || host === 'appgallery.huawei.com') return 'app';
  return 'web';
}
const sameUrl = (a: string, b: string) => a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase();
function text(v: unknown, field: string, max: number, required = false): string | null {
  const s = v == null ? '' : String(v).trim();
  if (!s) { if (required) throw new HttpError(400, 'missing', `${field} is required`); return null; }
  if (s.length > max) throw new HttpError(400, 'too_long', `${field} is longer than ${max} characters`);
  const sn = sensitive(s);
  if (sn) throw new HttpError(400, 'sensitive', `${field}: ${sn}. Hunt never stores passport, ID or card numbers: remove it.`);
  return s;
}
function cleanActivity(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'bad_activity', 'activity must be {members?, per_day?}');
  const a: any = v;
  const n = (x: unknown, k: string) => {
    if (x == null) return undefined;
    const num = Number(x);
    if (!Number.isFinite(num) || num < 0 || num > 1e8) throw new HttpError(400, 'bad_activity', `activity.${k} must be a non-negative number`);
    return Math.round(num * 10) / 10;
  };
  const out: any = { members: n(a.members, 'members'), per_day: n(a.per_day, 'per_day'), at: now().slice(0, 10) };
  if (out.members == null && out.per_day == null) throw new HttpError(400, 'bad_activity', 'activity needs members and/or per_day');
  return JSON.stringify(out);
}
const day = (v: unknown, field = 'last_checked') => {
  if (v == null || v === '') return null;
  if (!DAY.test(String(v))) throw new HttpError(400, 'bad_date', `${field} must be YYYY-MM-DD`);
  return String(v);
};

/** One shape for pack items and D1 rows. */
function rowView(r: any, uid: string | null) {
  return {
    id: r.id, source: 'crm' as const, pack_id: r.pack_id ?? null, country: r.country, city: r.city ?? null, name: r.name, url: r.url, kind: r.kind,
    category: r.category, about: { ru: r.about_ru ?? null, en: r.about_en ?? null }, lang: r.lang ?? null, last_checked: r.last_checked ?? null,
    activity: parseJson(r.activity, null), attribution: null, events: false, icon: null, status: r.status, mine: !!uid && r.suggested_by === uid,
    suggested_by: r.suggested_by ?? null, suggested_by_name: r.suggested_name ?? null, search_id: r.search_id ?? null, note: r.note ?? null,
    decided_by: r.decided_by ?? null, created_at: r.created_at, updated_at: r.updated_at,
  };
}
const packView = (it: PackItem, ann: any) => ({
  id: it.id, source: 'pack' as const, pack_id: it.id, city: it.city, name: it.name, url: it.url, kind: it.kind, category: it.category, about: it.about,
  lang: it.lang, last_checked: ann?.last_checked && (!it.last_checked || ann.last_checked > it.last_checked) ? ann.last_checked : it.last_checked,
  activity: (ann && parseJson(ann.activity, null)) ?? it.activity, attribution: it.attribution, events: it.events, icon: it.icon ?? null, status: 'approved', mine: false,
  annotation_id: ann?.id ?? null,
});

const ROW_SQL = `SELECT ul.*, u.display_name suggested_name FROM useful_links ul LEFT JOIN users u ON u.id=ul.suggested_by`;

/** A link everyone sees (added or approved by an admin, or a pack item's note), else only in the projects of the hunter it came from. Binds: owner, owner. */
const VISIBLE = `(ul.shared=1 OR ul.pack_id IS NOT NULL OR ul.suggested_by=? OR ul.search_id IN (SELECT id FROM searches WHERE owner_id=?))`;

/**
 * Items for a country (+ city): pack items (with their annotations), approved D1 links, and the pending ones the caller may
 * see (`pendingWhere`: SQL on ul with its binds, or null for none). `verified` = the latest check date among the shown items.
 */
async function collect(env: Env, country: string, city: string | null, uid: string | null, ownerId: string | null, pendingWhere: { sql: string; binds: unknown[] } | null) {
  const pack = await packUseful(env, country);
  const rows = (await env.DB.prepare(`${ROW_SQL} WHERE ul.country=? AND (ul.city IS NULL OR ul.city=?) AND ((ul.status='approved' AND ${VISIBLE})${pendingWhere ? ` OR (ul.status='pending' AND (${pendingWhere.sql}))` : ''})
      ORDER BY ul.created_at`).bind(country, city ?? '', ownerId ?? '', ownerId ?? '', ...(pendingWhere?.binds ?? [])).all<any>()).results ?? [];
  const ann = new Map<string, any>();
  for (const r of rows) if (r.pack_id && r.status === 'approved') ann.set(r.pack_id, r);
  const packItems = (pack?.items ?? []).filter((it) => !it.city || it.city === city);
  // A city item with the same id as a country one replaces it.
  const byId = new Map<string, PackItem>();
  for (const it of packItems) if (!byId.has(it.id) || it.city) byId.set(it.id, it);
  const items = [...byId.values()].map((it) => packView(it, ann.get(it.id)));
  const links = rows.filter((r) => !r.pack_id).map((r) => rowView(r, uid));
  const approved = links.filter((x) => x.status === 'approved');
  const pending = links.filter((x) => x.status === 'pending');
  const all = [...items, ...approved];
  const verified = all.map((x) => x.last_checked).filter(Boolean).sort().pop() ?? pack?.verified ?? null;
  return { country, city, verified, items: all, pending, has_pack: !!pack };
}

// ---------------------------------------------------------------- Mini App

export async function usefulApp(req: Request, env: Env, path: string, user: { id: string; display_name: string; lang: string }): Promise<Response | null> {
  const DB = env.DB;
  if (path === '/app/api/useful' && req.method === 'GET') {
    const q = new URL(req.url).searchParams;
    const sid = q.get('s') ?? q.get('search_id') ?? '';
    const a = await member(env, sid, user.id, ['owner', 'member', 'viewer', 'guest']);
    const country = countryOf(a.region), city = String(a.region).split('/')[1] || null;
    const full = a.role === 'owner' || a.role === 'member';
    // Pending: my own suggestions (any search of this country) and, for the owner, everything suggested in this search.
    const pw = !full ? null : a.role === 'owner' ? { sql: 'ul.suggested_by=? OR ul.search_id=?', binds: [user.id, sid] } : { sql: 'ul.suggested_by=?', binds: [user.id] };
    const v = await collect(env, country, city, full ? user.id : null, await ownerOfSearch(env, sid), pw);
    const pending = v.pending.map((x) => ({ ...x, can_decide: a.role === 'owner' && x.search_id === sid }));
    return json({ ...v, pending, role: a.role, can_suggest: full, can_decide: a.role === 'owner' });
  }
  if (path === '/app/api/useful-suggest' && req.method === 'POST') {
    const b = await body(req);
    const a = await member(env, b.search_id, user.id, ['owner', 'member']);
    await rateLimit(env, 'useful', user.id, 10);
    const country = countryOf(a.region);
    const name = text(b.name, 'name', 80, true)!;
    const about = text(b.about, 'about', 200);
    const url = cleanUsefulUrl(b.url);
    const category = (USEFUL_CATS as readonly string[]).includes(b.category) ? b.category : 'other';
    const pack = await packUseful(env, country);
    if ((pack?.items ?? []).some((it) => sameUrl(it.url, url))) throw new HttpError(409, 'useful_exists', 'This link is already in the list');
    const own = await ownerOfSearch(env, b.search_id);
    const dup = (await DB.prepare(`SELECT ul.id, ul.url, ul.status FROM useful_links ul WHERE ul.country=? AND ul.pack_id IS NULL AND ul.status!='rejected' AND ${VISIBLE}`).bind(country, own, own).all<any>()).results?.find((r) => sameUrl(r.url, url));
    if (dup) throw new HttpError(409, 'useful_exists', dup.status === 'pending' ? 'This link is already waiting for approval' : 'This link is already in the list');
    // The owner of the search is the approver: their own suggestion is approved right away.
    const status = a.role === 'owner' ? 'approved' : 'pending';
    const id = rid('ul_');
    const t = now();
    const ru = user.lang !== 'en';
    await DB.prepare(`INSERT INTO useful_links (id, country, city, category, kind, name, url, about_ru, about_en, lang, status, suggested_by, search_id, decided_by, note, created_at, updated_at, shared)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, country, null, category, kindOfUrl(url), name, url, ru ? about : null, ru ? null : about, null, status, user.id, b.search_id,
        status === 'approved' ? user.id : null, about, t, t, status === 'approved' && (await isAdmin(env, user.id)) ? 1 : 0).run();
    await event(env, b.search_id, 'useful_suggested', id, user.id, { name: user.display_name, title: name, url, category, about, status });
    const row = await DB.prepare(`${ROW_SQL} WHERE ul.id=?`).bind(id).first<any>();
    return json({ link: { ...rowView(row, user.id), can_decide: false } });
  }
  if (path === '/app/api/useful-decide' && req.method === 'POST') {
    const b = await body(req);
    await member(env, b.search_id, user.id, ['owner']);
    if (!['approved', 'rejected'].includes(b.status)) throw new HttpError(400, 'bad_status', 'status must be approved or rejected');
    const r = await DB.prepare('SELECT * FROM useful_links WHERE id=?').bind(String(b.id ?? '')).first<any>();
    // Only links suggested in this search; a shared one is an admin's to change.
    if (r?.shared === 1 && !(await isAdmin(env, user.id))) throw new HttpError(403, 'not_yours');
    if (!r || r.search_id !== b.search_id || r.pack_id) throw new HttpError(404, 'no_useful');
    await DB.prepare('UPDATE useful_links SET status=?, decided_by=?, updated_at=?, shared=? WHERE id=?').bind(b.status, user.id, now(), b.status === 'approved' && (await isAdmin(env, user.id)) ? 1 : 0, r.id).run();
    await event(env, b.search_id, 'useful_decided', r.id, user.id, { name: user.display_name, title: r.name, url: r.url, status: b.status });
    const row = await DB.prepare(`${ROW_SQL} WHERE ul.id=?`).bind(r.id).first<any>();
    return json({ link: rowView(row, user.id) });
  }
  return null;
}

// ---------------------------------------------------------------- agent API

interface AgentUser { id: string; display_name: string }
async function isAdmin(env: Env, uid: string) {
  return !!(await env.DB.prepare('SELECT 1 FROM hunters WHERE user_id=? AND is_admin=1').bind(uid).first());
}
/** May this hunter change a D1 row: an admin, the one who suggested/added it, or the owner of the search it was suggested in. */
async function canManage(env: Env, uid: string, r: any) {
  if (r.shared === 1 && !(await isAdmin(env, uid))) return false; // shared with everyone: admins only
  if (r.suggested_by === uid) return true;
  if (r.search_id && (await env.DB.prepare("SELECT 1 FROM members WHERE search_id=? AND user_id=? AND role='owner'").bind(r.search_id, uid).first())) return true;
  return isAdmin(env, uid);
}
function cleanCountry(v: unknown): string {
  const c = String(v ?? '').trim().toLowerCase();
  if (!/^[a-z_]{2,20}$/.test(c) || c === '_generic') throw new HttpError(400, 'bad_country', 'country must be a pack slug like bali, kz, th');
  return c;
}
const cleanCity = (v: unknown) => {
  if (v == null || v === '') return null;
  const c = String(v).trim().toLowerCase();
  if (!/^[a-z0-9_]{2,30}$/.test(c)) throw new HttpError(400, 'bad_city', 'city must be a sub-pack slug like bukit');
  return c;
};

export async function usefulAgent(req: Request, env: Env, p: string[], user: AgentUser): Promise<Response | null> {
  const DB = env.DB;
  const m = req.method;
  if (p[1] !== 'useful') return null;
  if (p.length === 2 && m === 'GET') {
    const q = new URL(req.url).searchParams;
    const country = cleanCountry(q.get('country'));
    const city = cleanCity(q.get('city'));
    // Pending: what was suggested in the caller's own searches or by the caller (an admin sees all).
    const admin = await isAdmin(env, user.id);
    const pw = admin ? { sql: '1=1', binds: [] } : { sql: "ul.suggested_by=? OR ul.search_id IN (SELECT search_id FROM members WHERE user_id=? AND role='owner')", binds: [user.id, user.id] };
    const v = await collect(env, country, city, user.id, user.id, pw);
    let rejected: any[] = [];
    if (q.get('status') === 'rejected') {
      rejected = ((await DB.prepare(`${ROW_SQL} WHERE ul.country=? AND ul.status='rejected' AND (?=1 OR ${VISIBLE}) ORDER BY ul.updated_at DESC LIMIT 50`).bind(country, admin ? 1 : 0, user.id, user.id).all<any>()).results ?? []).map((r) => rowView(r, user.id));
    }
    return json({ ...v, ...(rejected.length ? { rejected } : {}) });
  }
  if (p.length === 2 && m === 'POST') {
    const b = await body(req);
    const country = cleanCountry(b.country);
    const t = now();
    if (b.pack_id) {
      // Annotate a pack item (activity hint from read-only Telegram stats, last_checked): one row per country + pack_id.
      const pack = await packUseful(env, country);
      const it = (pack?.items ?? []).find((x) => x.id === String(b.pack_id));
      if (!it) throw new HttpError(404, 'no_pack_item', `No useful.yaml item ${b.pack_id} in ${country}`);
      const activity = cleanActivity(b.activity);
      const checked = day(b.last_checked);
      if (!activity && !checked) throw new HttpError(400, 'missing', 'pass activity and/or last_checked');
      const old = await DB.prepare('SELECT id, activity, last_checked FROM useful_links WHERE country=? AND pack_id=?').bind(country, it.id).first<any>();
      const id = old?.id ?? rid('ul_');
      if (old) await DB.prepare('UPDATE useful_links SET activity=?, last_checked=?, updated_at=? WHERE id=?').bind(activity ?? old.activity, checked ?? old.last_checked, t, id).run();
      else await DB.prepare(`INSERT INTO useful_links (id, country, city, pack_id, category, kind, name, url, activity, last_checked, status, suggested_by, decided_by, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?, 'approved', ?, 'agent', ?, ?)`).bind(id, country, it.city, it.id, it.category, it.kind, it.name, it.url, activity, checked, user.id, t, t).run();
      const row = await DB.prepare(`${ROW_SQL} WHERE ul.id=?`).bind(id).first<any>();
      return json({ annotation: rowView(row, user.id) }, old ? 200 : 201);
    }
    const name = text(b.name, 'name', 80, true)!;
    const url = cleanUsefulUrl(b.url);
    const kind = b.kind == null ? kindOfUrl(url) : String(b.kind);
    if (!['telegram', 'app', 'web'].includes(kind)) throw new HttpError(400, 'bad_kind', 'kind must be telegram, app or web (hunt items live in the pack)');
    const category = b.category == null ? 'other' : String(b.category);
    if (!(USEFUL_CATS as readonly string[]).includes(category)) throw new HttpError(400, 'bad_category', `category must be one of ${USEFUL_CATS.join(', ')}`);
    if (b.lang != null && !LANG_RE.test(String(b.lang))) throw new HttpError(400, 'bad_lang', 'lang must be a language code (ru, en, id…) or multi');
    let sid: string | null = null;
    if (b.search_id) {
      if (!(await DB.prepare("SELECT 1 FROM members WHERE search_id=? AND user_id=? AND role='owner'").bind(String(b.search_id), user.id).first())) throw new HttpError(404, 'no_search');
      sid = String(b.search_id);
    }
    const pack = await packUseful(env, country);
    if ((pack?.items ?? []).some((it) => sameUrl(it.url, url))) throw new HttpError(409, 'useful_exists', 'This link is already in the pack (annotate it with pack_id)');
    const dup = (await DB.prepare(`SELECT ul.id, ul.url FROM useful_links ul WHERE ul.country=? AND ul.pack_id IS NULL AND ul.status!='rejected' AND ${VISIBLE}`).bind(country, user.id, user.id).all<any>()).results?.find((r) => sameUrl(r.url, url));
    if (dup) throw new HttpError(409, 'useful_exists', `This link is already there as ${dup.id}`);
    const id = rid('ul_');
    await DB.prepare(`INSERT INTO useful_links (id, country, city, category, kind, name, url, about_ru, about_en, lang, activity, last_checked, status, suggested_by, search_id, decided_by, created_at, updated_at, shared)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'approved', ?, ?, 'agent', ?, ?, ?)`)
      .bind(id, country, cleanCity(b.city), category, kind, name, url, text(b.about_ru, 'about_ru', 200), text(b.about_en, 'about_en', 200), b.lang ?? null,
        cleanActivity(b.activity), day(b.last_checked), user.id, sid, t, t, (await isAdmin(env, user.id)) ? 1 : 0).run();
    const row = await DB.prepare(`${ROW_SQL} WHERE ul.id=?`).bind(id).first<any>();
    return json({ link: rowView(row, user.id) }, 201);
  }
  if (p.length === 3 && m === 'PUT') {
    const b = await body(req);
    const r = await DB.prepare('SELECT * FROM useful_links WHERE id=?').bind(p[2]).first<any>();
    if (!r) throw new HttpError(404, 'no_useful');
    // Pack annotations are shared hints: any hunter may refresh them; other rows need canManage.
    if (!r.pack_id && !(await canManage(env, user.id, r))) throw new HttpError(403, 'not_yours', 'Only the owner of the search it was suggested in, the one who added it or an admin can change it');
    const sets: string[] = [];
    const vals: unknown[] = [];
    const set = (k: string, v: unknown) => { sets.push(`${k}=?`); vals.push(v); };
    if ('status' in b) {
      if (r.pack_id || !STATUSES.includes(b.status)) throw new HttpError(400, 'bad_status', 'status must be pending, approved or rejected');
      set('status', b.status);
      set('decided_by', 'agent');
      set('shared', b.status === 'approved' && (await isAdmin(env, user.id)) ? 1 : 0);
    }
    if ('activity' in b) set('activity', b.activity == null ? null : cleanActivity(b.activity));
    if ('last_checked' in b) set('last_checked', day(b.last_checked));
    if (!r.pack_id) {
      if ('name' in b) set('name', text(b.name, 'name', 80, true));
      if ('url' in b) { const u = cleanUsefulUrl(b.url); set('url', u); if (!('kind' in b)) set('kind', kindOfUrl(u)); }
      if ('kind' in b) { if (!['telegram', 'app', 'web'].includes(b.kind)) throw new HttpError(400, 'bad_kind', 'kind must be telegram, app or web'); set('kind', b.kind); }
      if ('category' in b) { if (!(USEFUL_CATS as readonly string[]).includes(b.category)) throw new HttpError(400, 'bad_category', `category must be one of ${USEFUL_CATS.join(', ')}`); set('category', b.category); }
      if ('about_ru' in b) set('about_ru', text(b.about_ru, 'about_ru', 200));
      if ('about_en' in b) set('about_en', text(b.about_en, 'about_en', 200));
      if ('lang' in b) { if (b.lang != null && !LANG_RE.test(String(b.lang))) throw new HttpError(400, 'bad_lang', 'lang must be a language code (ru, en, id…) or multi'); set('lang', b.lang ?? null); }
      if ('city' in b) set('city', cleanCity(b.city));
    }
    if (!sets.length) throw new HttpError(400, 'missing', 'nothing to change');
    await DB.prepare(`UPDATE useful_links SET ${sets.join(', ')}, updated_at=? WHERE id=?`).bind(...vals, now(), r.id).run();
    if ('status' in b && r.search_id && b.status !== r.status) await event(env, r.search_id, 'useful_decided', r.id, 'agent', { title: r.name, url: r.url, status: b.status });
    const row = await DB.prepare(`${ROW_SQL} WHERE ul.id=?`).bind(r.id).first<any>();
    return json({ link: rowView(row, user.id) });
  }
  return null;
}
