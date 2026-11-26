// Wave 9 · evenings & parties.
//  - "Своя тусовка": a party at the home, private to its search. A public invite page /p/<token> (no Telegram needed): RSVP
//    Иду / Может / Не смогу + name + "+1", a personal link /p/<token>/<secret> to change the answer; the exact address, how to
//    get there and the Wi-Fi only on a "going" guest's personal link; an .ics. Members see the guests (counts, names, +1),
//    remove a guest, run the checklist (who brings what; costs become expenses in Money), get reminders the day before and
//    2 h before, ask the agent to warn the owner / neighbours (local rules from the region pack; approval draft, never sent
//    automatically), and after the party upload photos, rate it and see the recap.
//  - Evening Home: tonight's booked event (or party) with the leave-by time from the ride × the rush factor, who's going,
//    "Я выезжаю" (DM to the others, quiet hours respected) and "Опаздываю" (an approval draft to the organizer, only with a booking).
//  - "Как было?": the morning after (≥ 09:00 local) the bot asks each member who went: 1–5; the answer feeds the taste.
import { Env, HttpError, json, body, now, rid, parseJson, event, sensitive, hmac, hex, sha256hex } from './util';
import { ownerOfSearch, requireContact } from './household';
import { countryOf } from './members';
import { packData } from './life';
import { member, type Role } from './roles';
import { homeListing, regionInfo } from './homepoint';
import { searchTzOf, localDay, h } from './local';
import { dm, dmMembers, draftToOwner, appUrl, localMinutes } from './notify';
import { putImage, kvPhoto, mediaHeaders, rateLimit } from './media';
import { fileResponse } from './tg';
import { insertExpense } from './agent';
import { tonightEvents, rateEvent } from './afisha';
import { leaveBy, partyCounts, canAnswer, partyVisible, icsEvent, partyNoticeText, lateText, askFeedbackNow, ANSWERS, type Answer } from './evening';

type Row = Record<string, any>;
const VIBES = ['chill', 'dance', 'dinner', 'pool', 'games', 'sunset'];
const STATUSES = ['active', 'cancelled', 'done'];
const ITEM_KINDS = ['drinks', 'ice', 'food', 'music', 'cups', 'cleanup', 'other'];
const NOTICE_CHANNELS = ['telegram', 'whatsapp', 'instagram', 'facebook', 'email', 'phone'];
const ISO_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2})$/;
const VOTERS: Role[] = ['owner', 'member'];
const READERS: Role[] = ['owner', 'member', 'viewer'];

// ---------------------------------------------------------------- validation

function txt(v: unknown, field: string, max: number, required = false): string | null {
  const s = v == null ? '' : String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (!s) { if (required) throw new HttpError(400, 'missing', `${field} is required`); return null; }
  if (s.length > max) throw new HttpError(400, 'too_long', `${field} is longer than ${max} characters`);
  const sn = sensitive(s);
  if (sn) throw new HttpError(400, 'sensitive', `${field}: ${sn}. Hunt never stores passport, ID or card numbers.`);
  return s;
}
const isoLocal = (v: unknown, field: string, required = false) => {
  if (v == null || v === '') { if (required) throw new HttpError(400, 'missing', `${field} is required`); return null; }
  const s = String(v);
  if (!ISO_LOCAL.test(s) || Number.isNaN(Date.parse(s))) throw new HttpError(400, 'bad_time', `${field} must be local time with an offset, e.g. 2026-11-28T19:00:00+08:00`);
  return s.length === 22 ? s.slice(0, 16) + ':00' + s.slice(16) : s;
};
const oneOf = (v: unknown, list: string[], field: string) => {
  if (v == null || v === '') return null;
  if (!list.includes(String(v))) throw new HttpError(400, `bad_${field}`, `${field} must be one of ${list.join(', ')}`);
  return String(v);
};

/** Columns from a request body (full = create). */
function partyCols(b: any, full: boolean): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  const has = (k: string) => full || k in b;
  if (has('title')) c.title = txt(b.title, 'title', 80, true);
  if (has('starts_at')) c.starts_at = isoLocal(b.starts_at, 'starts_at', true);
  if (has('ends_at')) c.ends_at = isoLocal(b.ends_at, 'ends_at');
  if (has('theme')) c.theme = txt(b.theme, 'theme', 80);
  if (has('vibe')) c.vibe = oneOf(b.vibe, VIBES, 'vibe');
  if (has('dress_code')) c.dress_code = txt(b.dress_code, 'dress_code', 60);
  if (has('capacity')) {
    const n = b.capacity == null || b.capacity === '' ? null : Number(b.capacity);
    if (n != null && (!Number.isInteger(n) || n < 1 || n > 300)) throw new HttpError(400, 'bad_capacity', 'capacity must be 1..300');
    c.capacity = n;
  }
  if (has('plus_one')) c.plus_one = b.plus_one === false ? 0 : 1;
  if (has('byob')) c.byob = b.byob == null ? null : b.byob ? 1 : 0;
  if (has('note')) c.note = txt(b.note, 'note', 300);
  if (has('address')) c.address = txt(b.address, 'address', 200);
  if (has('how_to')) c.how_to = txt(b.how_to, 'how_to', 300);
  if (has('wifi')) c.wifi = b.wifi ? 1 : 0;
  if ('status' in b) c.status = oneOf(b.status, STATUSES, 'status') ?? 'active';
  if (c.ends_at && c.starts_at && Date.parse(String(c.ends_at)) <= Date.parse(String(c.starts_at))) throw new HttpError(400, 'bad_time', 'ends_at must be after starts_at');
  return c;
}

// ---------------------------------------------------------------- tokens and views

async function inviteToken(env: Env, id: string, ver: number) {
  return hex(await hmac(env.LINK_SECRET, `party|${id}|${ver}`)).slice(0, 32); // 128 bits, recomputable, only the hash is stored
}
export async function inviteUrl(env: Env, p: Row) {
  return p.token_hash ? `${env.PUBLIC_URL}/p/${await inviteToken(env, p.id, p.token_ver)}` : null;
}
const partyDay = (p: Row) => String(p.starts_at).slice(0, 10);
const partyEnd = (p: Row) => (p.ends_at ? Date.parse(p.ends_at) : Date.parse(p.starts_at) + 5 * 3600e3);

async function guestsOf(env: Env, pid: string) {
  return (await env.DB.prepare('SELECT * FROM party_guests WHERE party_id=? ORDER BY created_at').bind(pid).all<Row>()).results ?? [];
}
function guestView(g: Row) {
  return { id: g.id, name: g.name, answer: g.answer, plus_one: g.plus_one ? 1 : 0, came: g.came == null ? null : !!g.came, removed: !!g.removed, created_at: g.created_at, updated_at: g.updated_at };
}
/** A party as members and the agent see it (the address and the invite link included; the public page never uses this). */
export async function partyView(env: Env, p: Row, guests?: Row[]) {
  const gs = guests ?? (await guestsOf(env, p.id));
  return {
    id: p.id, search_id: p.search_id, title: p.title, starts_at: p.starts_at, ends_at: p.ends_at, theme: p.theme, vibe: p.vibe, dress_code: p.dress_code,
    capacity: p.capacity, plus_one: !!p.plus_one, byob: p.byob == null ? null : !!p.byob, note: p.note, status: p.status,
    cover: p.cover ? { src: `/app/kv/${encodeURIComponent(p.cover)}` } : null, address: p.address, how_to: p.how_to, wifi: !!p.wifi,
    link: await inviteUrl(env, p), counts: partyCounts(gs as any, p.capacity ?? null), past: partyEnd(p) < Date.now(),
    photos: parseJson<any[]>(p.photos, []).map((x) => ({ src: `/app/kv/${encodeURIComponent(x.kv)}`, by: x.by, at: x.at })),
    created_by: p.created_by, created_at: p.created_at, updated_at: p.updated_at,
  };
}
async function rulesOf(env: Env, region: string) {
  return (await packData(env))?.[countryOf(region)]?.events?.party ?? null;
}
async function detail(env: Env, p: Row, region: string) {
  const DB = env.DB;
  const gs = await guestsOf(env, p.id);
  const [items, ratings] = await DB.batch<Row>([
    DB.prepare('SELECT i.*, u.display_name who_name FROM party_items i LEFT JOIN users u ON u.id=i.who WHERE i.party_id=? ORDER BY i.sort, i.created_at').bind(p.id),
    DB.prepare('SELECT r.*, u.display_name name FROM party_ratings r JOIN users u ON u.id=r.user_id WHERE r.party_id=? ORDER BY r.at').bind(p.id),
  ]);
  const it = (items.results ?? []).map((i) => ({ id: i.id, title: i.title, kind: i.kind, who: i.who, who_name: i.who_name ?? null, cost: i.cost, currency: i.currency, done: !!i.done, expense_id: i.expense_id }));
  const rt = (ratings.results ?? []).map((r) => ({ user_id: r.user_id, name: r.name, rating: r.rating, note: r.note }));
  const view = await partyView(env, p, gs);
  const came = gs.filter((g) => !g.removed && g.came === 1);
  const spent = it.reduce((n, i) => n + (Number(i.cost) || 0), 0);
  const recap = {
    came: came.length ? came.reduce((n, g) => n + 1 + (g.plus_one ? 1 : 0), 0) : null, heads: view.counts.heads, spent: spent || null, currency: it.find((i) => i.currency)?.currency ?? null,
    rating: rt.length ? Math.round((rt.reduce((n, r) => n + r.rating, 0) / rt.length) * 10) / 10 : null, n_ratings: rt.length, photos: view.photos.length,
  };
  return { party: view, guests: gs.map(guestView), items: it, ratings: rt, recap, rules: await rulesOf(env, region) };
}

const DEFAULT_ITEMS: Record<string, [string, string][]> = {
  ru: [['drinks', 'Напитки'], ['ice', 'Лёд'], ['food', 'Еда'], ['music', 'Музыка и колонка'], ['cups', 'Стаканы'], ['cleanup', 'Уборка после']],
  en: [['drinks', 'Drinks'], ['ice', 'Ice'], ['food', 'Food'], ['music', 'Music and a speaker'], ['cups', 'Cups'], ['cleanup', 'Cleanup after']],
};

async function createParty(env: Env, sid: string, cols: Record<string, unknown>, actor: string, lang: string) {
  const id = rid('pt_');
  const t = now();
  const all: Record<string, unknown> = { id, search_id: sid, plus_one: 1, wifi: 0, status: 'active', ...cols, token_ver: 1, created_by: actor, created_at: t, updated_at: t };
  const stmts = [env.DB.prepare(`INSERT INTO parties (${Object.keys(all).join(',')}) VALUES (${Object.keys(all).map(() => '?').join(',')})`).bind(...Object.values(all))];
  (DEFAULT_ITEMS[lang === 'en' ? 'en' : 'ru']).forEach(([k, title], i) => stmts.push(env.DB.prepare('INSERT INTO party_items (id, party_id, title, kind, sort, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').bind(rid('pi_'), id, title, k, i, t, t)));
  await env.DB.batch(stmts);
  await event(env, sid, 'party_created', id, actor, { party_id: id, title: cols.title, starts_at: cols.starts_at });
  return (await env.DB.prepare('SELECT * FROM parties WHERE id=?').bind(id).first<Row>())!;
}
async function updateParty(env: Env, p: Row, cols: Record<string, unknown>, actor: string) {
  if (!Object.keys(cols).length) throw new HttpError(400, 'missing', 'nothing to change');
  await env.DB.prepare(`UPDATE parties SET ${Object.keys(cols).map((k) => `${k}=?`).join(', ')}, updated_at=? WHERE id=?`).bind(...Object.values(cols), now(), p.id).run();
  await event(env, p.search_id, 'party_updated', p.id, actor, { party_id: p.id, title: cols.title ?? p.title, fields: Object.keys(cols) });
  return (await env.DB.prepare('SELECT * FROM parties WHERE id=?').bind(p.id).first<Row>())!;
}
async function partyLink(env: Env, p: Row, action: string) {
  if (action === 'revoke') { await env.DB.prepare('UPDATE parties SET token_hash=NULL, updated_at=? WHERE id=?').bind(now(), p.id).run(); return null; }
  if (action !== 'share' && action !== 'regenerate') throw new HttpError(400, 'bad_action', 'action must be share, regenerate or revoke');
  const ver = action === 'regenerate' ? Number(p.token_ver) + 1 : Number(p.token_ver);
  const tok = await inviteToken(env, p.id, ver);
  await env.DB.prepare('UPDATE parties SET token_hash=?, token_ver=?, updated_at=? WHERE id=?').bind(await sha256hex(tok), ver, now(), p.id).run();
  return `${env.PUBLIC_URL}/p/${tok}`;
}

/** A checklist cost with a payer becomes one expense in Money (replaced on every change; removed with the cost). */
async function syncExpense(env: Env, p: Row, item: Row) {
  const DB = env.DB;
  if (item.expense_id) await DB.prepare('DELETE FROM expenses WHERE id=? AND search_id=?').bind(item.expense_id, p.search_id).run();
  let eid: string | null = null;
  if (item.who && Number(item.cost) > 0) {
    const s = await DB.prepare('SELECT id, brief FROM searches WHERE id=?').bind(p.search_id).first<Row>();
    const kind = ['drinks', 'ice', 'food', 'cups'].includes(item.kind) ? 'food' : 'other';
    const e = await insertExpense(env, s as any, { title: `${p.title}: ${item.title}`.slice(0, 120), amount: Number(item.cost), currency: item.currency ?? undefined, date: partyDay(p), paid_by: item.who, kind, note: `party ${p.id}` }, item.who);
    eid = e?.id ?? null;
  }
  await DB.prepare('UPDATE party_items SET expense_id=? WHERE id=?').bind(eid, item.id).run();
  return eid;
}

// ---------------------------------------------------------------- Mini App routes

async function partyOf(env: Env, sid: string, id: unknown) {
  const p = await env.DB.prepare('SELECT * FROM parties WHERE id=? AND search_id=?').bind(String(id ?? ''), String(sid ?? '')).first<Row>();
  if (!p) throw new HttpError(404, 'no_party');
  return p;
}
const editable = (p: Row) => { if (p.status === 'cancelled') throw new HttpError(409, 'party_cancelled', 'The party is cancelled'); };

export async function partyApp(req: Request, env: Env, path: string, user: { id: string; display_name: string; lang: string }): Promise<Response | null> {
  const DB = env.DB;
  const q = new URL(req.url).searchParams;
  if (path === '/app/api/parties' && req.method === 'GET') {
    const sid = q.get('s') ?? '';
    await member(env, sid, user.id, READERS);
    const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
    const rows = (await DB.prepare("SELECT * FROM parties WHERE search_id=? AND substr(starts_at,1,10) >= ? AND status != 'cancelled' ORDER BY starts_at LIMIT 20").bind(sid, since).all<Row>()).results ?? [];
    return json({ parties: await Promise.all(rows.map((p) => partyView(env, p))) });
  }
  if (path === '/app/api/party' && req.method === 'GET') {
    const sid = q.get('s') ?? '';
    const a = await member(env, sid, user.id, READERS);
    return json(await detail(env, await partyOf(env, sid, q.get('id')), a.region));
  }
  if (path === '/app/api/party' && req.method === 'POST') {
    const b = await body(req);
    const a = await member(env, b.search_id, user.id, VOTERS);
    await rateLimit(env, 'party', user.id, 60);
    if (b.id) {
      const p = await partyOf(env, b.search_id, b.id);
      const cols = partyCols(b, false);
      delete (cols as any).search_id;
      return json(await detail(env, await updateParty(env, p, cols, user.id), a.region));
    }
    const cols = partyCols(b, true);
    const p = await createParty(env, b.search_id, cols, user.id, user.lang);
    await partyLink(env, p, 'share'); // a fresh party gets its invite link right away (revocable)
    return json(await detail(env, (await DB.prepare('SELECT * FROM parties WHERE id=?').bind(p.id).first<Row>())!, a.region), 201);
  }
  if ((path === '/app/api/party-cover' || path === '/app/api/party-photo') && req.method === 'POST') {
    const sid = q.get('search_id') ?? '';
    await member(env, sid, user.id, VOTERS);
    const p = await partyOf(env, sid, q.get('id'));
    await rateLimit(env, 'upload', user.id, 60);
    const cover = path === '/app/api/party-cover';
    const key = `y/${p.id}/${cover ? 'c-' : ''}${Date.now().toString(36)}`;
    await putImage(env, req, key, { ttl: 365 * 86400 });
    if (cover) {
      if (p.cover) await env.PHOTOS_KV.delete(p.cover).catch(() => null);
      await DB.prepare('UPDATE parties SET cover=?, updated_at=? WHERE id=?').bind(key, now(), p.id).run();
    } else {
      const ph = parseJson<any[]>(p.photos, []);
      if (ph.length >= 30) throw new HttpError(409, 'too_many_photos', 'Up to 30 photos per party');
      ph.push({ kv: key, by: user.id, at: now() });
      await DB.prepare('UPDATE parties SET photos=?, updated_at=? WHERE id=?').bind(JSON.stringify(ph), now(), p.id).run();
      await event(env, sid, 'party_photo', p.id, user.id, { party_id: p.id, title: p.title, name: user.display_name });
    }
    return json({ key, src: `/app/kv/${encodeURIComponent(key)}` }, 201);
  }
  if (path === '/app/api/party-link' && req.method === 'POST') {
    const b = await body(req);
    await member(env, b.search_id, user.id, VOTERS);
    const p = await partyOf(env, b.search_id, b.id);
    return json({ url: await partyLink(env, p, String(b.action ?? '')) });
  }
  if (path === '/app/api/party-guest' && req.method === 'POST') {
    const b = await body(req);
    await member(env, b.search_id, user.id, VOTERS);
    const p = await partyOf(env, b.search_id, b.id);
    const g = await DB.prepare('SELECT * FROM party_guests WHERE id=? AND party_id=?').bind(String(b.guest_id ?? ''), p.id).first<Row>();
    if (!g) throw new HttpError(404, 'no_guest');
    const set = { remove: 'removed=1', restore: 'removed=0', came: 'came=1', not_came: 'came=0' }[String(b.action)];
    if (!set) throw new HttpError(400, 'bad_action', 'action must be remove, restore, came or not_came');
    await DB.prepare(`UPDATE party_guests SET ${set}, updated_at=? WHERE id=?`).bind(now(), g.id).run();
    if (b.action === 'remove') await event(env, p.search_id, 'party_guest_removed', p.id, user.id, { party_id: p.id, guest: g.name, name: user.display_name });
    const gs = await guestsOf(env, p.id);
    return json({ guests: gs.map(guestView), counts: partyCounts(gs as any, p.capacity ?? null) });
  }
  if (path === '/app/api/party-item' && req.method === 'POST') {
    const b = await body(req);
    const a = await member(env, b.search_id, user.id, VOTERS);
    const p = await partyOf(env, b.search_id, b.id);
    editable(p);
    const t = now();
    if (b.item_id && b.delete) {
      const it = await DB.prepare('SELECT * FROM party_items WHERE id=? AND party_id=?').bind(String(b.item_id), p.id).first<Row>();
      if (!it) throw new HttpError(404, 'no_item');
      if (it.expense_id) await DB.prepare('DELETE FROM expenses WHERE id=? AND search_id=?').bind(it.expense_id, p.search_id).run();
      await DB.prepare('DELETE FROM party_items WHERE id=?').bind(it.id).run();
      return json(await detail(env, p, a.region));
    }
    const mem = ((await DB.prepare("SELECT user_id FROM members WHERE search_id=? AND role IN ('owner','member')").bind(p.search_id).all<Row>()).results ?? []).map((x) => x.user_id);
    let it = b.item_id ? await DB.prepare('SELECT * FROM party_items WHERE id=? AND party_id=?').bind(String(b.item_id), p.id).first<Row>() : null;
    if (b.item_id && !it) throw new HttpError(404, 'no_item');
    const cols: Record<string, unknown> = {};
    if (!it || 'title' in b) cols.title = txt(b.title, 'title', 60, true);
    if (!it || 'kind' in b) cols.kind = oneOf(b.kind, ITEM_KINDS, 'kind') ?? 'other';
    if ('who' in b) { const w = b.who == null || b.who === '' ? null : String(b.who); if (w && !mem.includes(w)) throw new HttpError(400, 'bad_who', 'who must be a member'); cols.who = w; }
    if ('cost' in b) {
      const c = b.cost == null || b.cost === '' ? null : Math.round(Number(b.cost));
      if (c != null && (!Number.isFinite(c) || c < 0 || c > 1e11)) throw new HttpError(400, 'bad_cost', 'cost must be a positive amount (main units)');
      cols.cost = c || null;
      const brief = parseJson<any>((await DB.prepare('SELECT brief FROM searches WHERE id=?').bind(p.search_id).first<Row>())?.brief, {});
      cols.currency = c ? String(b.currency ?? brief.currency ?? '').toUpperCase().slice(0, 8) || null : null;
    }
    if ('done' in b) cols.done = b.done ? 1 : 0;
    if (it) {
      if (Object.keys(cols).length) await DB.prepare(`UPDATE party_items SET ${Object.keys(cols).map((k) => `${k}=?`).join(', ')}, updated_at=? WHERE id=?`).bind(...Object.values(cols), t, it.id).run();
    } else {
      const n = await DB.prepare('SELECT COUNT(*) n FROM party_items WHERE party_id=?').bind(p.id).first<Row>();
      if (Number(n?.n) >= 30) throw new HttpError(409, 'too_many_items', 'Up to 30 checklist items');
      const id = rid('pi_');
      const all = { id, party_id: p.id, title: cols.title, kind: cols.kind, who: cols.who ?? null, cost: cols.cost ?? null, currency: cols.currency ?? null, done: cols.done ?? 0, sort: Number(n?.n ?? 0), created_at: t, updated_at: t };
      await DB.prepare(`INSERT INTO party_items (${Object.keys(all).join(',')}) VALUES (${Object.keys(all).map(() => '?').join(',')})`).bind(...Object.values(all)).run();
      it = { id } as Row;
    }
    const fresh = (await DB.prepare('SELECT * FROM party_items WHERE id=?').bind(it.id).first<Row>())!;
    if ('who' in b || 'cost' in b || ('title' in b && fresh.expense_id)) await syncExpense(env, p, fresh);
    return json(await detail(env, p, a.region));
  }
  if (path === '/app/api/party-rate' && req.method === 'POST') {
    const b = await body(req);
    const a = await member(env, b.search_id, user.id, VOTERS);
    const p = await partyOf(env, b.search_id, b.id);
    const r = Number(b.rating);
    if (!Number.isInteger(r) || r < 1 || r > 5) throw new HttpError(400, 'bad_rating', 'rating must be 1..5');
    await rateParty(env, p, user, r, txt(b.note, 'note', 300), 'note' in b);
    return json(await detail(env, p, a.region));
  }
  if (path === '/app/api/party-notice' && req.method === 'POST') {
    // A member asks the agent to warn the owner / neighbours: the agent drafts it (approval), nothing goes out from here.
    const b = await body(req);
    await member(env, b.search_id, user.id, VOTERS);
    const p = await partyOf(env, b.search_id, b.id);
    const to = oneOf(b.to, ['owner', 'neighbours'], 'to') ?? 'owner';
    const key = `ptnotice:${p.id}:${to}`;
    const ins = await DB.prepare('INSERT OR IGNORE INTO sent_marks (key, at) VALUES (?,?)').bind(key, now()).run();
    if (ins.meta.changes) await event(env, p.search_id, 'party_notice_requested', p.id, user.id, { party_id: p.id, title: p.title, starts_at: p.starts_at, to, name: user.display_name });
    return json({ ok: true, already: !ins.meta.changes });
  }
  if (path === '/app/api/evening' && req.method === 'GET') {
    const sid = q.get('s') ?? '';
    const a = await member(env, sid, user.id, READERS);
    return json(await eveningView(env, { id: sid, region: a.region, brief: a.brief }, user.id));
  }
  if (path === '/app/api/evening-leaving' && req.method === 'POST') {
    const b = await body(req);
    const a = await member(env, b.search_id, user.id, VOTERS);
    await rateLimit(env, 'leaving', user.id, 20);
    const v = await eveningView(env, { id: b.search_id, region: a.region, brief: a.brief }, user.id);
    const tn = v.tonight;
    if (!tn || tn.key !== b.key) throw new HttpError(404, 'nothing_tonight', 'No event for you tonight');
    const key = `leaving:${tn.key}:${user.id}`;
    const ins = await DB.prepare('INSERT OR IGNORE INTO sent_marks (key, at) VALUES (?,?)').bind(key, now()).run();
    if (!ins.meta.changes) return json({ ok: true, notified: 0, already: true });
    const eta = tn.ride != null ? new Date(Date.now() + (tn.ride + 5) * 60e3) : null;
    const etaHM = eta ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: a.tz }).format(eta) : null;
    const others = new Set((tn.who as string[]).filter((u) => u !== user.id));
    await event(env, b.search_id, 'evening_leaving', tn.key, user.id, { title: tn.title, name: user.display_name, eta: etaHM });
    const skip = new Set(((await DB.prepare('SELECT user_id FROM members WHERE search_id=?').bind(b.search_id).all<Row>()).results ?? []).map((x) => x.user_id).filter((u) => !others.has(u)));
    const notified = others.size ? await dmMembers(env, b.search_id, (lang) => ({
      text: lang === 'ru' ? `${h(user.display_name)} выезжает на <b>${h(tn.title)}</b>${etaHM ? `, будет около ${etaHM}` : ''}` : `${h(user.display_name)} is leaving for <b>${h(tn.title)}</b>${etaHM ? `, there around ${etaHM}` : ''}`,
      buttons: [[{ text: lang === 'ru' ? 'Открыть' : 'Open', web_app: { url: appUrl(env, `/s/${b.search_id}/today`) } }]],
    }), { quiet: 'skip', skip, votersOnly: true }) : 0;
    return json({ ok: true, notified, eta: etaHM });
  }
  if (path === '/app/api/evening-late' && req.method === 'POST') {
    const b = await body(req);
    await member(env, b.search_id, user.id, VOTERS);
    await rateLimit(env, 'late', user.id, 10);
    const minutes = Number(b.minutes);
    if (![10, 15, 20, 30, 45].includes(minutes)) throw new HttpError(400, 'bad_minutes', 'minutes must be 10, 15, 20, 30 or 45');
    const bk = await DB.prepare(`SELECT b.*, e.title, e.title_en, e.organizer_channel, e.organizer_address, e.organizer_lang, e.organizer_contact_id, e.lang elang
        FROM event_bookings b JOIN afisha e ON e.id=b.event_id WHERE b.id=? AND b.search_id=?`).bind(String(b.booking_id ?? ''), b.search_id).first<Row>();
    // Only with a real booking the organizer knows about (asked / booked) and a way to reach them.
    if (!bk || !['asked', 'booked'].includes(bk.status)) throw new HttpError(409, 'no_booking', 'Only a booking the organizer knows about can be told "running late"');
    if (!bk.organizer_channel || !bk.organizer_address || bk.organizer_channel === 'web') throw new HttpError(409, 'no_organizer_contact', 'The organizer has no channel to write to');
    const lang = String(bk.organizer_lang ?? (['en', 'ru', 'id'].includes(bk.elang) ? bk.elang : 'en')).toLowerCase();
    const who = parseJson<string[]>(bk.who, []);
    const text = lateText(lang, { title: lang !== 'ru' && bk.title_en ? bk.title_en : bk.title, minutes, n: who.length + Number(bk.guests || 0) });
    const s = await DB.prepare('SELECT * FROM searches WHERE id=?').bind(b.search_id).first<Row>();
    const id = rid('d_');
    const t = now();
    await DB.prepare(`INSERT INTO drafts (id, search_id, contact_id, listing_id, channel, address, text, kind, reason, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?, 'running_late', ?, 'pending', ?, ?)`)
      .bind(id, b.search_id, bk.organizer_contact_id ?? null, null, bk.organizer_channel, bk.organizer_address, text, `Опаздываем на ${minutes} мин: ${bk.title}`, t, t).run();
    await draftToOwner(env, s, await DB.prepare('SELECT * FROM drafts WHERE id=?').bind(id).first<Row>());
    await event(env, b.search_id, 'event_late', bk.id, user.id, { booking_id: bk.id, title: bk.title, minutes, draft_id: id, name: user.display_name });
    return json({ ok: true, draft_id: id }, 201);
  }
  return null;
}

/** "How was it" for a party (members; the strongest signal is shown in the recap; the agent gets party_rated). */
export async function rateParty(env: Env, p: Row, user: { id: string; display_name: string }, rating: number, note: string | null, setNote: boolean) {
  await env.DB.prepare(`INSERT INTO party_ratings (party_id, user_id, rating, note, at) VALUES (?,?,?,?,?)
    ON CONFLICT(party_id, user_id) DO UPDATE SET rating=excluded.rating, ${setNote ? 'note=excluded.note,' : ''} at=excluded.at`).bind(p.id, user.id, rating, note, now()).run();
  await event(env, p.search_id, 'party_rated', p.id, user.id, { party_id: p.id, title: p.title, rating, note, name: user.display_name });
}

// ---------------------------------------------------------------- evening Home

/** Tonight for one member: their booked event today (ride + leave-by + who goes), or a party at the home. */
export async function eveningView(env: Env, s: { id: string; region: string; brief: any }, viewer: string) {
  const tz = searchTzOf(s);
  const today = localDay(tz);
  const { sub } = await regionInfo(env, s.region);
  const rush = Number(sub?.travel?.rush) || null;
  const items: any[] = [];
  for (const x of await tonightEvents(env, s, viewer)) {
    const lb = leaveBy({ starts_at: x.starts_at, minutes: x.minutes, rush_factor: rush });
    items.push({ kind: 'event', key: `${x.id}@${x.occ}`, event_id: x.id, occ: x.occ, title: x.title, title_en: x.title_en, starts_at: x.starts_at, ends_at: x.ends_at, place: x.place?.name ?? null,
      photo: x.photo, category: x.category, effect: x.effect, minutes: x.minutes, ride: lb?.ride ?? null, leave_at: lb?.leave_at ?? null, rush: !!lb?.rush, minutes_left: lb?.minutes_left ?? null, late: !!lb?.late,
      who: x.who, booking_id: x.booking_id, booking_status: x.booking_status, can_late: x.can_late, organizer: x.organizer });
  }
  const parties = (await env.DB.prepare("SELECT * FROM parties WHERE search_id=? AND substr(starts_at,1,10)=? AND status='active' ORDER BY starts_at").bind(s.id, today).all<Row>()).results ?? [];
  const mem = ((await env.DB.prepare("SELECT user_id FROM members WHERE search_id=? AND role IN ('owner','member')").bind(s.id).all<Row>()).results ?? []).map((x) => x.user_id);
  for (const p of parties) {
    const v = await partyView(env, p);
    items.push({ kind: 'party', key: `party:${p.id}`, party_id: p.id, title: p.title, starts_at: p.starts_at, ends_at: p.ends_at, place: null, photo: v.cover, minutes: 0, ride: 0, leave_at: null, rush: false,
      minutes_left: Math.round((Date.parse(p.starts_at) - Date.now()) / 60e3), late: false, who: mem, counts: v.counts, theme: p.theme });
  }
  // Still to come (or running): the earliest first.
  const live = items.filter((x) => (x.ends_at ? Date.parse(x.ends_at) : Date.parse(x.starts_at) + 3 * 3600e3) > Date.now()).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return { today, tz, local_min: localMinutes(tz), rush_factor: rush, tonight: live[0] ?? null, more: live.slice(1).map((x) => ({ key: x.key, title: x.title, starts_at: x.starts_at, kind: x.kind })) };
}

// ---------------------------------------------------------------- agent API

async function ownParty(env: Env, uid: string, id: string) {
  const p = await env.DB.prepare(`SELECT p.*, s.region FROM parties p JOIN members m ON m.search_id=p.search_id AND m.user_id=? AND m.role='owner' JOIN searches s ON s.id=p.search_id WHERE p.id=?`).bind(uid, id).first<Row>();
  if (!p) throw new HttpError(404, 'no_party', `Party ${id} not found`);
  return p;
}
export async function partyAgent(req: Request, env: Env, p: string[], user: { id: string; display_name: string; lang?: string }): Promise<Response | null> {
  if (p[1] !== 'parties') return null;
  const DB = env.DB;
  const m = req.method;
  if (p.length === 2 && m === 'GET') {
    const sid = new URL(req.url).searchParams.get('search_id') ?? '';
    const s = await DB.prepare("SELECT s.id FROM searches s JOIN members m ON m.search_id=s.id AND m.user_id=? AND m.role='owner' WHERE s.id=?").bind(user.id, sid).first<Row>();
    if (!s) throw new HttpError(404, 'no_search', `Search ${sid} not found`);
    const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
    const rows = (await DB.prepare('SELECT * FROM parties WHERE search_id=? AND substr(starts_at,1,10) >= ? ORDER BY starts_at DESC LIMIT 50').bind(sid, since).all<Row>()).results ?? [];
    return json({ parties: await Promise.all(rows.map((x) => partyView(env, x))) });
  }
  if (p.length === 2 && m === 'POST') {
    const b = await body(req);
    const s = await DB.prepare("SELECT s.id, s.region FROM searches s JOIN members m ON m.search_id=s.id AND m.user_id=? AND m.role='owner' WHERE s.id=?").bind(user.id, String(b.search_id ?? '')).first<Row>();
    if (!s) throw new HttpError(404, 'no_search', `Search ${b.search_id} not found`);
    const row = await createParty(env, s.id, partyCols(b, true), 'agent', user.lang ?? 'ru');
    await partyLink(env, row, 'share');
    return json({ party: await partyView(env, (await DB.prepare('SELECT * FROM parties WHERE id=?').bind(row.id).first<Row>())!) }, 201);
  }
  if (!p[2]) return null;
  const party = await ownParty(env, user.id, p[2]);
  if (p.length === 3 && m === 'GET') return json(await detail(env, party, party.region));
  if (p.length === 3 && m === 'PUT') {
    const cols = partyCols(await body(req), false);
    return json({ party: await partyView(env, await updateParty(env, party, cols, 'agent')) });
  }
  if (p[3] === 'guests' && m === 'GET') {
    const gs = await guestsOf(env, party.id);
    return json({ guests: gs.map(guestView), counts: partyCounts(gs as any, party.capacity ?? null) });
  }
  if (p[3] === 'notice-draft' && m === 'POST') {
    const b = await body(req);
    const to = oneOf(b.to, ['owner', 'neighbours'], 'to');
    if (!to) throw new HttpError(400, 'bad_to', 'to must be owner or neighbours');
    const channel = oneOf(b.channel, NOTICE_CHANNELS, 'channel');
    const address = txt(b.address, 'address', 200);
    if (!channel || !address) throw new HttpError(400, 'missing', 'channel and address are required');
    const contact = await requireContact(env, await ownerOfSearch(env, party.search_id), b.contact_id);
    const rules = await rulesOf(env, party.region);
    const gs = await guestsOf(env, party.id);
    const lang = String(b.lang ?? 'en').toLowerCase();
    const host = await DB.prepare('SELECT display_name FROM users WHERE id=(SELECT owner_id FROM searches WHERE id=?)').bind(party.search_id).first<Row>();
    const text = b.text ? txt(b.text, 'text', 1500, true)! : partyNoticeText(lang, { to: to as 'owner' | 'neighbours', day: partyDay(party), time: String(party.starts_at).slice(11, 16), heads: Math.max(partyCounts(gs as any, null).heads + 2, party.capacity ? Math.min(party.capacity, 20) : 0),
      quiet_after: rules?.quiet_after ?? null, name: host?.display_name ? String(host.display_name).split(/\s+/)[0] : null });
    const id = rid('d_');
    const t = now();
    await DB.prepare(`INSERT INTO drafts (id, search_id, contact_id, listing_id, channel, address, text, kind, reason, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?, 'party_notice', ?, 'pending', ?, ?)`)
      .bind(id, party.search_id, contact, null, channel, address, text, txt(b.reason, 'reason', 300) ?? `Тусовка ${partyDay(party)}: ${to === 'owner' ? 'предупредить хозяина' : 'предупредить соседей'}`, t, t).run();
    const s = await DB.prepare('SELECT * FROM searches WHERE id=?').bind(party.search_id).first<Row>();
    const draft = await DB.prepare('SELECT * FROM drafts WHERE id=?').bind(id).first<Row>();
    await draftToOwner(env, s, draft);
    await DB.prepare('UPDATE searches SET agent_seen_at=? WHERE id=?').bind(t, party.search_id).run();
    return json({ draft }, 201);
  }
  return null;
}

// ---------------------------------------------------------------- public invite page /p/<token>

const NF_HEADERS = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' };
const notFound = () => new Response('Not found', { status: 404, headers: NF_HEADERS });
const T = {
  ru: { kick: 'Приглашение', going: 'Иду', maybe: 'Может', no: 'Не смогу', name: 'Как тебя зовут', plus: 'Приду не один (+1)', send: 'Ответить', change: 'Поменять ответ',
    you: 'Твой ответ', save_link: 'Это твоя личная ссылка: по ней можно поменять ответ. Сохрани её', where: 'Адрес', how: 'Как добраться', wifi: 'Wi-Fi', pw: 'пароль', show: 'Показать', hide: 'Скрыть',
    map: 'Карта', ics: 'В календарь', addr_hidden: 'Адрес и как добраться появятся здесь, когда ответишь «Иду»', full: 'Мест больше нет: можно ответить «Может»', no_plus: 'На эту тусовку без +1',
    byob: 'приноси что пьёшь', drinks: 'напитки есть', dress: 'дресс-код', n_going: (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'идёт' : 'идут'}`, left: (n: number) => `осталось мест: ${n}`, thanks_going: 'Ждём тебя!',
    thanks_maybe: 'Ок, ждём ответа ближе к делу', thanks_no: 'Жаль! Если планы поменяются, ответь по этой ссылке', cancelled: 'Тусовку отменили', past: 'Тусовка уже прошла', removed: 'Хозяева убрали этот ответ',
    err: 'Не получилось: проверь имя', limit: 'Слишком много ответов, попробуй позже', from: 'зовут', bad_name: 'Напиши имя (до 60 символов)' },
  en: { kick: 'Invitation', going: "I'm in", maybe: 'Maybe', no: "Can't make it", name: 'Your name', plus: "I'm bringing someone (+1)", send: 'Reply', change: 'Change my answer',
    you: 'Your answer', save_link: 'This is your personal link: use it to change your answer. Keep it', where: 'Address', how: 'How to get there', wifi: 'Wi-Fi', pw: 'password', show: 'Show', hide: 'Hide',
    map: 'Map', ics: 'Add to calendar', addr_hidden: 'The address and directions show up here once you answer "I\'m in"', full: 'No spots left: you can answer "Maybe"', no_plus: 'No +1 at this party',
    byob: 'bring your own drinks', drinks: 'drinks provided', dress: 'dress code', n_going: (n: number) => `${n} going`, left: (n: number) => `${n} spots left`, thanks_going: 'See you there!',
    thanks_maybe: 'OK, let us know closer to the day', thanks_no: 'Too bad! If plans change, answer again with this link', cancelled: 'The party is cancelled', past: 'The party is over', removed: 'The hosts removed this answer',
    err: 'That did not work: check your name', limit: 'Too many answers, try again later', from: 'from', bad_name: 'Write your name (up to 60 characters)' },
};

async function partyByToken(env: Env, tok: string) {
  return env.DB.prepare('SELECT p.*, s.region, s.brief, s.status sstatus, s.owner_id FROM parties p JOIN searches s ON s.id=p.search_id WHERE p.token_hash=?').bind(await sha256hex(tok)).first<Row>();
}

/** GET/POST /p/<token>[/rsvp | /cover | /<secret>[/ics]] — public, rate-limited by the caller; noindex, no-store, strict CSP. */
export async function handlePartyPage(req: Request, env: Env, path: string): Promise<Response> {
  const m = path.match(/^\/p\/([a-f0-9]{32})(?:\/(rsvp|cover|[a-f0-9]{32}))?(?:\/(ics))?\/?$/);
  if (!m) return notFound();
  const p = await partyByToken(env, m[1]);
  if (!p || p.sstatus === 'closed') return notFound();
  const ip = req.headers.get('cf-connecting-ip') ?? 'local';
  const ql = new URL(req.url).searchParams.get('lang');
  const lang: 'ru' | 'en' = ql === 'en' || ql === 'ru' ? ql : /^ru|,\s*ru/i.test(req.headers.get('accept-language') ?? '') ? 'ru' : 'en';
  if (m[2] === 'cover') return coverResponse(env, p, req);
  let guest: Row | null = null;
  let secret: string | null = null;
  if (m[2] && m[2] !== 'rsvp') {
    secret = m[2];
    guest = await env.DB.prepare('SELECT * FROM party_guests WHERE secret_hash=? AND party_id=?').bind(await sha256hex(secret), p.id).first<Row>();
    if (!guest) return notFound();
  }
  const base = `/p/${m[1]}`;
  if (m[3] === 'ics') {
    if (!guest || guest.removed) return notFound();
    const vis = partyVisible({ guest: guest as any });
    const addr = vis.address ? await addressOf(env, p) : null;
    return new Response(icsEvent({ uid: `${p.id}@hunt`, title: p.title, starts_at: p.starts_at, ends_at: p.ends_at, location: addr?.text ?? null, description: [p.theme, vis.how_to ? p.how_to : null].filter(Boolean).join('\n') || null,
      url: `${env.PUBLIC_URL}${base}/${secret}` }), { headers: { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': 'attachment; filename="party.ics"', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'x-content-type-options': 'nosniff' } });
  }
  let flash: string | null = null;
  if (req.method === 'POST') {
    if (m[2] !== 'rsvp' && !guest) return notFound();
    const L = T[lang];
    try {
      await rateLimit(env, 'rsvp', ip, 20);
      await rateLimit(env, 'rsvp-party', p.id, 300);
    } catch { return page(env, p, lang, base, guest, secret, L.limit, 429); }
    if (p.status !== 'active' || Date.parse(p.starts_at) + 3 * 3600e3 < Date.now()) return page(env, p, lang, base, guest, secret, p.status === 'cancelled' ? L.cancelled : L.past, 409);
    if (guest?.removed) return page(env, p, lang, base, guest, secret, L.removed, 403);
    const fd = await req.formData().catch(() => null);
    const get = (k: string) => { const v = fd?.get(k); return typeof v === 'string' ? v : ''; };
    if (get('website')) return page(env, p, lang, base, guest, secret, L.err, 400); // honeypot
    const answer = (ANSWERS as readonly string[]).includes(get('answer')) ? (get('answer') as Answer) : null;
    let name: string | null = null;
    try { name = guest ? guest.name : txt(get('name'), 'name', 60, true); } catch { return page(env, p, lang, base, guest, secret, L.bad_name, 400); }
    if (!answer || !name) return page(env, p, lang, base, guest, secret, L.bad_name, 400);
    const plusOne = get('plus_one') === '1' && answer === 'going';
    const gs = await guestsOf(env, p.id);
    const ok = canAnswer({ capacity: p.capacity ?? null, plus_one_allowed: !!p.plus_one, heads: partyCounts(gs as any, null).heads, mine: guest as any, answer, plusOne });
    if (!ok.ok) return page(env, p, lang, base, guest, secret, ok.why === 'full' ? L.full : L.no_plus, 409);
    const t = now();
    if (guest) {
      await env.DB.prepare('UPDATE party_guests SET answer=?, plus_one=?, updated_at=? WHERE id=?').bind(answer, plusOne ? 1 : 0, t, guest.id).run();
    } else {
      secret = hex(crypto.getRandomValues(new Uint8Array(16)));
      const id = rid('pg_');
      await env.DB.prepare('INSERT INTO party_guests (id, party_id, name, answer, plus_one, secret_hash, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .bind(id, p.id, name, answer, plusOne ? 1 : 0, await sha256hex(secret), t, t).run();
    }
    await event(env, p.search_id, 'party_rsvp', p.id, 'guest', { party_id: p.id, title: p.title, name, answer, plus_one: plusOne, changed: !!guest });
    // Post/redirect/get: the personal link is where the guest lands (and what they keep).
    return new Response(null, { status: 303, headers: { location: `${base}/${secret}?ok=${answer}${ql ? `&lang=${lang}` : ''}`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
  }
  await rateLimit(env, 'party-page', ip, 300).catch(() => { throw new HttpError(429, 'rate_limited'); });
  const okq = new URL(req.url).searchParams.get('ok');
  if (guest && okq && (ANSWERS as readonly string[]).includes(okq)) flash = T[lang][('thanks_' + okq) as 'thanks_going'];
  return page(env, p, lang, base, guest, secret, flash, 200, !!flash);
}

async function coverResponse(env: Env, p: Row, req: Request) {
  const hdr = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' };
  if (p.cover) { const got = await kvPhoto(env, p.cover); if (got) return new Response(got.body, { headers: mediaHeaders(got.type ?? 'image/jpeg', hdr) }); }
  const hl = await homeListing(env, p.search_id);
  const ph = parseJson<any[]>(hl?.photos, [])[0];
  if (ph?.kv) { const got = await kvPhoto(env, ph.kv, ph.i ?? null); return got ? new Response(got.body, { headers: mediaHeaders(got.type ?? 'image/jpeg', hdr) }) : notFound(); }
  if (ph?.file_id) { const r = await fileResponse(env, ph.file_id); return new Response(r.body, { status: r.status, headers: { ...hdr, 'content-type': r.headers.get('content-type') ?? 'image/jpeg', 'x-content-type-options': 'nosniff' } }); }
  if (ph?.url && /^\/demo\/[\w./-]+$/.test(ph.url)) return env.ASSETS.fetch(new Request(new URL(ph.url, req.url)));
  return notFound();
}
async function hasCover(env: Env, p: Row) {
  if (p.cover) return true;
  const hl = await homeListing(env, p.search_id);
  const ph = parseJson<any[]>(hl?.photos, [])[0];
  return !!(ph?.kv || ph?.file_id || (ph?.url && /^\/demo\//.test(ph.url)));
}
/** The exact address for "going" guests: the party's own, else the house guide's, else the listing area; plus a map link. */
async function addressOf(env: Env, p: Row) {
  const g = await env.DB.prepare('SELECT address, map_url, wifi_name, wifi_password FROM guides WHERE search_id=?').bind(p.search_id).first<Row>();
  const hl = await homeListing(env, p.search_id);
  const text = p.address ?? g?.address ?? hl?.area_text ?? null;
  const map = g?.map_url ?? (hl?.lat != null ? `https://www.google.com/maps/search/?api=1&query=${hl.lat},${hl.lng}` : null);
  return { text, map, wifi_name: p.wifi ? g?.wifi_name ?? null : null, wifi_password: p.wifi ? g?.wifi_password ?? null : null };
}

async function page(env: Env, p: Row, lang: 'ru' | 'en', base: string, guest: Row | null, secret: string | null, flash: string | null, status = 200, good = false): Promise<Response> {
  const L = T[lang];
  const ru = lang === 'ru';
  const gs = await guestsOf(env, p.id);
  const cnt = partyCounts(gs as any, p.capacity ?? null);
  const vis = partyVisible({ guest: guest as any });
  const addr = vis.address ? await addressOf(env, p) : null;
  const hosts = ((await env.DB.prepare(`SELECT u.display_name FROM members m JOIN users u ON u.id=m.user_id WHERE m.search_id=? AND m.role IN ('owner','member') ORDER BY m.role='owner' DESC, u.created_at`).bind(p.search_id).all<Row>()).results ?? []).map((u) => String(u.display_name).split(' ')[0]);
  const day = new Intl.DateTimeFormat(ru ? 'ru-RU' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(partyDay(p) + 'T12:00:00Z'));
  const time = String(p.starts_at).slice(11, 16) + (p.ends_at ? '–' + String(p.ends_at).slice(11, 16) : '');
  const stickers = [p.byob === 1 ? L.byob : p.byob === 0 ? L.drinks : null, p.dress_code ? `${L.dress}: ${p.dress_code}` : null].filter(Boolean) as string[];
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  const closed = p.status !== 'active' || Date.parse(p.starts_at) + 3 * 3600e3 < Date.now();
  const removed = !!guest?.removed;
  const cur = guest && !removed ? guest.answer : null;
  const form = closed || removed ? '' : `<form method="post" action="${guest ? `${base}/${h(secret)}` : `${base}/rsvp`}${lang === 'en' ? '?lang=en' : ''}" class="rsvp">
<div class="ans" role="radiogroup" aria-label="${h(L.send)}">${(['going', 'maybe', 'no'] as const).map((a) => `<label class="opt"><input type="radio" name="answer" value="${a}"${(cur ?? 'going') === a ? ' checked' : ''} required><span>${h(L[a])}</span></label>`).join('')}</div>
${guest ? '' : `<label class="fld"><span>${h(L.name)}</span><input name="name" maxlength="60" autocomplete="given-name" required></label>`}
${p.plus_one ? `<label class="chk"><input type="checkbox" name="plus_one" value="1"${guest?.plus_one ? ' checked' : ''}><span>${h(L.plus)}</span></label>` : `<p class="muted">${h(L.no_plus)}</p>`}
<input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
<button class="btn fill" type="submit">${h(guest ? L.change : L.send)}</button></form>`;
  const mine = guest ? `<section class="you"><p class="k">${h(L.you)} · ${h(guest.name)}</p><p class="big">${h(removed ? L.removed : L[guest.answer as Answer] ?? guest.answer)}${guest.plus_one && !removed ? ' +1' : ''}</p><p class="muted small">${h(L.save_link)}</p></section>` : '';
  const secretBlock = guest && !removed ? (vis.address ? `<section class="info">
${addr?.text ? `<div class="row"><div class="grow"><p class="k">${h(L.where)}</p><b>${h(addr.text)}</b></div>${addr.map ? `<a class="btn fill" href="${h(addr.map)}" rel="noopener noreferrer" target="_blank">${h(L.map)}</a>` : ''}</div>` : ''}
${p.how_to ? `<div class="row"><div class="grow"><p class="k">${h(L.how)}</p><span>${h(p.how_to)}</span></div></div>` : ''}
${addr?.wifi_name ? `<div class="row"><div class="grow"><p class="k">${h(L.wifi)}</p><b>${h(addr.wifi_name)}</b>${addr.wifi_password ? `<span class="muted">${h(L.pw)}: <span id="pw" data-pw="${h(addr.wifi_password)}">••••••••</span></span>` : ''}</div>${addr.wifi_password ? `<button class="btn" id="show" type="button">${h(L.show)}</button>` : ''}</div>` : ''}
</section>` : `<p class="note">${h(L.addr_hidden)}</p>`) + `<p class="pills"><a class="btn" href="${base}/${h(secret)}/ics">${h(L.ics)}</a></p>` : guest ? '' : `<p class="note">${h(L.addr_hidden)}</p>`;
  const cover = await hasCover(env, p);
  const region = String(p.region ?? '').split('/')[0];
  const screen = ({ bali: '#E8E35C', kz: '#9ED0F2', th: '#FFB65C' } as Record<string, string>)[region] ?? '#E6E4DF';
  const body = `<div class="bar" aria-hidden="true">hunt</div><main>
<p class="kick">${h(L.kick)}${hosts.length ? ` · ${h(hosts.length > 1 ? hosts.slice(0, -1).slice(0, 2).join(', ') + (ru ? ' и ' : ' and ') + hosts[hosts.length - 1] : hosts[0])}` : ''}</p>
<div class="stage"><div class="tk"><div class="frame">${cover ? `<img src="${base}/cover" alt="">` : '<span class="none"></span>'}</div><div class="perf" aria-hidden="true"></div>
<div class="stub"><h1>${h(p.title)}</h1><p class="m">${h(day)} · ${h(time)}</p>${p.theme ? `<p class="theme">${h(p.theme)}</p>` : ''}</div></div>
${stickers.map((s, i) => `<span class="sticker s${i}"><span>${h(s)}</span></span>`).join('')}</div>
<p class="count"><b>${h(L.n_going(cnt.heads))}</b>${cnt.left != null ? ` · ${h(L.left(cnt.left))}` : ''}</p>
${flash ? `<p class="flash${good ? ' good' : ''}" role="status">${h(flash)}</p>` : ''}
${closed ? `<p class="flash">${h(p.status === 'cancelled' ? L.cancelled : L.past)}</p>` : ''}
${p.note ? `<p class="about">${h(p.note)}</p>` : ''}
${mine}${secretBlock}${form}
<p class="foot">hunt</p></main>`;
  const css = `:root{--ground:${screen};--ink:#151413;--muted:#46433D;--line:#1514131F;--paper:#F5F4F0;--dots:#1514131C;--fill:#151413;--on:#F2F0EA}
@media (prefers-color-scheme:dark){:root{--ground:#151413;--ink:#F2F0EA;--muted:#A9A59C;--line:#F2F0EA26;--dots:#F2F0EA1F;--fill:#F2F0EA;--on:#151413}}
*{box-sizing:border-box}html{background:var(--ground)}body{margin:0;background-color:var(--ground);background-image:radial-gradient(var(--dots) 1px,transparent 1.3px);background-size:18px 18px;color:var(--ink);font:16px/1.4 "Inter Tight","Inter",-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;letter-spacing:-.012em}
:focus-visible{outline:3px solid #1F6BFF;outline-offset:2px}.bar{max-width:520px;margin:0 auto;padding:16px 20px 0;font-weight:800;font-size:23px;letter-spacing:-.06em}
main{max-width:520px;margin:0 auto;padding:10px 20px 40px}.kick{color:var(--muted);font-weight:500;margin:12px 0 14px}
.stage{position:relative}.tk{background:var(--paper);color:#151413;border-radius:36px;padding:12px;transform:rotate(-1.5deg);box-shadow:0 26px 44px rgba(58,52,20,.3)}
.frame{background:#151413;border-radius:28px;padding:10px;aspect-ratio:4/3.2;overflow:hidden}.frame img,.frame .none{display:block;width:100%;height:100%;object-fit:cover;border-radius:20px;background:#2a2725}
.perf{position:relative;margin:12px 4px;border-top:2px dashed #15141333}.stub{padding:0 10px 10px}
h1{margin:0 0 6px;font-size:44px;line-height:.96;letter-spacing:-.055em;font-weight:800;overflow-wrap:anywhere}.m{margin:0;font-weight:600;font-size:17px;font-variant-numeric:tabular-nums}.theme{margin:4px 0 0;color:#5F5C56}
.sticker{position:absolute;display:grid;place-items:center;width:92px;height:92px;border-radius:50%;background:#F2E33A;color:#151413;font-weight:700;font-size:13px;line-height:1.1;text-align:center;padding:10px;box-shadow:0 6px 14px rgba(0,0,0,.18)}
.sticker.s0{right:-8px;top:-24px;transform:rotate(12deg)}.sticker.s1{left:-12px;top:34%;transform:rotate(-10deg);background:#9ED0F2}
.count{font-size:20px;margin:26px 0 0;letter-spacing:-.03em}.count b{font-weight:700}.flash{margin:16px 0 0;padding:14px 16px;border-radius:18px;background:var(--fill);color:var(--on);font-weight:500}
.flash.good{background:#F2E33A;color:#151413}.about{font-size:18px;margin:18px 0 0}.you{margin:22px 0 0;border-top:1px solid var(--line);padding-top:14px}.k{margin:0;color:var(--muted);font-size:14px}
.big{margin:2px 0 4px;font-size:34px;font-weight:800;letter-spacing:-.05em}.small{font-size:13px}.muted{color:var(--muted)}
.info{margin-top:14px}.row{display:flex;gap:14px;align-items:center;padding:14px 0;border-top:1px solid var(--line)}.grow{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}.grow b{font-size:18px;font-weight:600}
.note{margin:18px 0 0;padding:14px 0;border-top:1px solid var(--line);color:var(--muted)}.pills{margin:8px 0 0}
.rsvp{margin:22px 0 0;border-top:1px solid var(--line);padding-top:18px;display:flex;flex-direction:column;gap:14px}.ans{display:flex;gap:8px;flex-wrap:wrap}
.opt{position:relative}.opt input{position:absolute;opacity:0;inset:0}.opt span{display:inline-flex;align-items:center;min-height:46px;padding:0 18px;border-radius:999px;box-shadow:inset 0 0 0 1.5px var(--ink);font-weight:600}
.opt input:checked+span{background:var(--fill);color:var(--on);box-shadow:none}.opt input:focus-visible+span{outline:3px solid #1F6BFF;outline-offset:2px}
.fld{display:flex;flex-direction:column;gap:6px;font-size:14px;color:var(--muted)}.fld input{font-family:inherit;font-weight:500;font-size:18px;min-height:52px;padding:0 16px;border-radius:16px;border:1.5px solid var(--ink);background:transparent;color:var(--ink)}
.chk{display:flex;gap:10px;align-items:center;min-height:44px;font-weight:500}.chk input{width:22px;height:22px;accent-color:#151413}.hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}
.btn{border:0;border-radius:999px;padding:0 20px;min-height:46px;display:inline-flex;align-items:center;justify-content:center;font-family:inherit;font-weight:600;font-size:16px;line-height:1;background:transparent;color:var(--ink);box-shadow:inset 0 0 0 1.5px var(--ink);text-decoration:none;cursor:pointer}
.btn.fill{background:var(--fill);color:var(--on);box-shadow:none}.foot{color:var(--muted);font-size:13px;text-align:center;margin-top:30px;font-weight:800;letter-spacing:-.04em}
@media (max-width:360px){h1{font-size:36px}.sticker{width:78px;height:78px;font-size:12px}}`;
  const js = `document.getElementById('show')?.addEventListener('click',function(){var p=document.getElementById('pw');var o=p.textContent.indexOf('•')<0;p.textContent=o?'••••••••':p.dataset.pw;this.textContent=o?${JSON.stringify(L.show)}:${JSON.stringify(L.hide)};});`;
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${h(p.title)}</title><style nonce="${nonce}">${css}</style></head><body>${body}<script nonce="${nonce}">${js}</script></body></html>`;
  return new Response(html, { status, headers: {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
    'content-security-policy': `default-src 'none'; img-src 'self'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
  } });
}

// ---------------------------------------------------------------- cron: party reminders and "Как было?"

/** Members' reminders: the day before (from 10:00 local) and 2 h before (once each). */
export async function partyCron(env: Env) {
  const lo = new Date(Date.now() - 864e5).toISOString().slice(0, 10), hi = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
  const rows = (await env.DB.prepare(`SELECT p.*, s.region, s.brief FROM parties p JOIN searches s ON s.id=p.search_id WHERE p.status='active' AND s.status != 'closed' AND substr(p.starts_at,1,10) BETWEEN ? AND ?`).bind(lo, hi).all<Row>()).results ?? [];
  for (const p of rows) {
    const left = Date.parse(p.starts_at) - Date.now();
    if (left <= 0) continue;
    const tz = searchTzOf(p);
    const today = localDay(tz);
    const tomorrow = new Date(Date.parse(today + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);
    const kind = left <= 2 * 3600e3 ? 'h2' : partyDay(p) === tomorrow && localMinutes(tz) >= 600 ? 'd1' : null;
    if (!kind) continue;
    const key = `ptrem:${kind}:${p.id}`;
    const ins = await env.DB.prepare('INSERT OR IGNORE INTO sent_marks (key, at) VALUES (?,?)').bind(key, now()).run();
    if (!ins.meta.changes) continue;
    const gs = await guestsOf(env, p.id);
    const c = partyCounts(gs as any, p.capacity ?? null);
    const open = ((await env.DB.prepare('SELECT title FROM party_items WHERE party_id=? AND who IS NULL AND done=0 ORDER BY sort LIMIT 4').bind(p.id).all<Row>()).results ?? []).map((x) => x.title);
    const time = String(p.starts_at).slice(11, 16);
    await dmMembers(env, p.search_id, (lang) => {
      const ru = lang === 'ru';
      const head = kind === 'h2' ? (ru ? `Через 2 часа тусовка: <b>${h(p.title)}</b>, ${time}` : `Party in 2 hours: <b>${h(p.title)}</b>, ${time}`)
        : (ru ? `Завтра тусовка: <b>${h(p.title)}</b> в ${time}` : `Party tomorrow: <b>${h(p.title)}</b> at ${time}`);
      const going = ru ? `Идут: ${c.heads}` : `Going: ${c.heads}`;
      const todo = open.length ? (ru ? `Никто не взял: ${open.map(h).join(', ')}` : `Nobody took: ${open.map(h).join(', ')}`) : '';
      return { text: [head, going, todo].filter(Boolean).join('\n'), buttons: [[{ text: ru ? 'Открыть' : 'Open', web_app: { url: appUrl(env, `/s/${p.search_id}/party/${p.id}`) } }]] };
    }, { quiet: kind === 'h2' ? 'skip' : 'postpone', key, votersOnly: true });
  }
}

const STARS = (n: number) => '★'.repeat(n);
/** "Как было?": the morning after a booked event or a party, each member who went gets 1–5 buttons (once). */
export async function feedbackCron(env: Env) {
  const DB = env.DB;
  const lo = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10), hi = new Date().toISOString().slice(0, 10);
  const bks = (await DB.prepare(`SELECT b.id, b.search_id, b.event_id, b.occ, b.who, e.title, e.title_en, s.region, s.brief FROM event_bookings b JOIN afisha e ON e.id=b.event_id JOIN searches s ON s.id=b.search_id
      WHERE b.status IN ('booked','asked','attended') AND b.occ BETWEEN ? AND ? LIMIT 100`).bind(lo, hi).all<Row>()).results ?? [];
  const parties = (await DB.prepare(`SELECT p.id, p.search_id, p.title, p.starts_at, s.region, s.brief FROM parties p JOIN searches s ON s.id=p.search_id
      WHERE p.status IN ('active','done') AND substr(p.starts_at,1,10) BETWEEN ? AND ? LIMIT 50`).bind(lo, hi).all<Row>()).results ?? [];
  const ask = async (sid: string, uids: string[], key: (u: string) => string, cb: (n: number) => string, text: (ru: boolean) => string, hash: string) => {
    if (!uids.length) return;
    const people = (await DB.prepare(`SELECT u.id, u.tg_user_id, u.lang FROM users u JOIN members m ON m.user_id=u.id AND m.search_id=? AND m.role IN ('owner','member') AND m.notify=1
        WHERE u.id IN (${uids.map(() => '?').join(',')}) AND u.tg_user_id IS NOT NULL`).bind(sid, ...uids).all<Row>()).results ?? [];
    for (const u of people) {
      const ins = await DB.prepare('INSERT OR IGNORE INTO sent_marks (key, at) VALUES (?,?)').bind(key(u.id), now()).run();
      if (!ins.meta.changes) continue;
      const ru = u.lang !== 'en';
      await dm(env, u.tg_user_id, text(ru), [[1, 2, 3, 4, 5].map((n) => ({ text: String(n), callback_data: cb(n) })), [{ text: ru ? 'Написать пару слов' : 'Add a few words', web_app: { url: appUrl(env, hash) } }]]);
    }
  };
  for (const b of bks) {
    const tz = searchTzOf(b);
    if (!askFeedbackNow({ occ: b.occ, today: localDay(tz), localMin: localMinutes(tz) })) continue;
    const rated = new Set(((await DB.prepare('SELECT user_id FROM event_feedback WHERE event_id=? AND search_id=? AND rating IS NOT NULL AND occ=?').bind(b.event_id, b.search_id, b.occ).all<Row>()).results ?? []).map((x) => x.user_id));
    const who = parseJson<string[]>(b.who, []).filter((u) => !rated.has(u));
    await ask(b.search_id, who, (u) => `evfb:${b.id}:${u}`, (n) => `ef:${n}:${b.id}`, (ru) => ru ? `Как было вчера на <b>${h(b.title)}</b>? Оцени от 1 до 5, это лучше всего учит Афишу` : `How was <b>${h(b.title_en || b.title)}</b> last night? Rate it 1–5, it teaches Афиша best`,
      `/s/${b.search_id}/event/${encodeURIComponent(b.event_id + '@' + b.occ)}`);
  }
  for (const p of parties) {
    const tz = searchTzOf(p);
    if (!askFeedbackNow({ occ: partyDay(p), today: localDay(tz), localMin: localMinutes(tz) })) continue;
    const rated = new Set(((await DB.prepare('SELECT user_id FROM party_ratings WHERE party_id=?').bind(p.id).all<Row>()).results ?? []).map((x) => x.user_id));
    const mem = ((await DB.prepare("SELECT user_id FROM members WHERE search_id=? AND role IN ('owner','member')").bind(p.search_id).all<Row>()).results ?? []).map((x) => x.user_id).filter((u) => !rated.has(u));
    await ask(p.search_id, mem, (u) => `ptfb:${p.id}:${u}`, (n) => `pf:${n}:${p.id}`, (ru) => ru ? `Как прошла тусовка <b>${h(p.title)}</b>? Оцени от 1 до 5 и закинь фото в Hunt` : `How was the party <b>${h(p.title)}</b>? Rate it 1–5 and add photos in Hunt`,
      `/s/${p.search_id}/party/${p.id}`);
  }
}

/** Bot callback "ef:<n>:<booking>" / "pf:<n>:<party>" → the rating; returns the answer text (or null when not allowed). */
export async function rateFromBot(env: Env, user: { id: string; display_name: string; lang: string }, kind: string, n: number, id: string): Promise<string | null> {
  if (!Number.isInteger(n) || n < 1 || n > 5) return null;
  const DB = env.DB;
  const ru = user.lang !== 'en';
  if (kind === 'ef') {
    const b = await DB.prepare('SELECT * FROM event_bookings WHERE id=?').bind(id).first<Row>();
    if (!b || !parseJson<string[]>(b.who, []).includes(user.id)) return null;
    const mm = await DB.prepare("SELECT role FROM members WHERE search_id=? AND user_id=? AND role IN ('owner','member')").bind(b.search_id, user.id).first();
    if (!mm) return null;
    const r = await DB.prepare('SELECT * FROM afisha WHERE id=?').bind(b.event_id).first<Row>();
    if (!r) return null;
    await rateEvent(env, r, b.search_id, user, b.occ, n, null, false);
    return `${ru ? 'Спасибо!' : 'Thanks!'} ${STARS(n)} · ${h(r.title)}`;
  }
  if (kind === 'pf') {
    const p = await DB.prepare('SELECT * FROM parties WHERE id=?').bind(id).first<Row>();
    if (!p) return null;
    const mm = await DB.prepare("SELECT role FROM members WHERE search_id=? AND user_id=? AND role IN ('owner','member')").bind(p.search_id, user.id).first();
    if (!mm) return null;
    await rateParty(env, p, user, n, null, false);
    return `${ru ? 'Спасибо!' : 'Thanks!'} ${STARS(n)} · ${h(p.title)}`;
  }
  return null;
}

