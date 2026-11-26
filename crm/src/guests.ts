// Split from wave5.ts.
import { ANIMALS } from './animals';
import { daysUntil } from './deal';
import { homeListing } from './homepoint';
import { isDay, localDay, noSecrets, txt } from './local';
import { withSrc } from './media';
import { animalInfo, countryOf } from './members';
import { type Access, cleanAreas, member } from './roles';
import { Env, HttpError, event, now, parseJson, rid } from './util';

// ---------------------------------------------------------------- guests

function pickGuestAnimal(region: string, used: Set<string>) {
  const own = ANIMALS[countryOf(region)] ?? [], gen = ANIMALS._generic ?? [];
  const pool = [...own, ...gen].filter((a) => !used.has(a.slug));
  if (!pool.length) return null;
  const r = new Uint32Array(1);
  crypto.getRandomValues(r);
  return pool[r[0] % pool.length].slug;
}
export async function createGuestInvite(env: Env, a: Access, sid: string, uid: string, b: any) {
  const today = localDay(a.tz);
  if (!isDay(b.from) || !isDay(b.to) || b.from > b.to) throw new HttpError(400, 'bad_dates', 'from and to must be YYYY-MM-DD, from ≤ to');
  if (b.to < today) throw new HttpError(400, 'bad_dates', 'to is in the past');
  if (daysUntil(b.to, b.from) > 92) throw new HttpError(400, 'bad_dates', 'up to 3 months');
  const areas = cleanAreas(b.areas, true);
  const code = rid('g') + rid('');
  await env.DB.prepare(`INSERT INTO invites (code, kind, search_id, created_by, max_uses, expires_at, data, created_at) VALUES (?, 'guest', ?, ?, 1, ?, ?, ?)`)
    .bind(code, sid, uid, `${b.to}T23:59:59Z`, JSON.stringify({ from: b.from, to: b.to, areas }), now()).run();
  await event(env, sid, 'guest_invite', null, uid, { from: b.from, to: b.to, areas });
  return { code, link: `https://t.me/${env.BOT_USERNAME}?start=${code}`, expires_at: b.to };
}
/** /start <guest code>: the person becomes a guest of the search (members keep their role). */
export async function acceptGuestInvite(env: Env, inv: any, user: any) {
  const data = parseJson<any>(inv.data, {});
  if (await env.DB.prepare('SELECT 1 FROM members WHERE search_id=? AND user_id=?').bind(inv.search_id, user.id).first()) return { already_member: true };
  const s = await env.DB.prepare('SELECT region, title FROM searches WHERE id=?').bind(inv.search_id).first<any>();
  const used = new Set(((await env.DB.prepare('SELECT animal FROM members WHERE search_id=?1 AND animal IS NOT NULL UNION SELECT animal FROM guests WHERE search_id=?1 AND animal IS NOT NULL').bind(inv.search_id).all<any>()).results ?? []).map((r) => r.animal));
  const t = now();
  await env.DB.prepare(`INSERT INTO guests (search_id, user_id, invited_by, date_from, date_to, areas, animal, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?, 'active', ?,?)
    ON CONFLICT(search_id, user_id) DO UPDATE SET invited_by=excluded.invited_by, date_from=excluded.date_from, date_to=excluded.date_to, areas=excluded.areas, status='active', updated_at=excluded.updated_at`)
    .bind(inv.search_id, user.id, inv.created_by, data.from, data.to, JSON.stringify(cleanAreas(data.areas, true)), pickGuestAnimal(s?.region ?? '', used), t, t).run();
  await event(env, inv.search_id, 'guest', user.id, 'system', { name: user.display_name, from: data.from, to: data.to, kind: 'guest_joined' });
  return { title: s?.title ?? '', from: data.from, to: data.to };
}
export async function guestsView(env: Env, sid: string, region: string) {
  const rows = (await env.DB.prepare(`SELECT g.*, u.display_name name FROM guests g JOIN users u ON u.id=g.user_id WHERE g.search_id=? AND g.status='active' ORDER BY g.date_from`).bind(sid).all<any>()).results ?? [];
  return rows.map((g) => ({ user_id: g.user_id, name: g.name, animal: animalInfo(region, g.animal), from: g.date_from, to: g.date_to, areas: cleanAreas(parseJson(g.areas, {}), false), status: g.status, invited_by: g.invited_by }));
}
export async function setGuest(env: Env, sid: string, b: any, actor: string) {
  const g = await env.DB.prepare('SELECT * FROM guests WHERE search_id=? AND user_id=?').bind(sid, String(b.user_id ?? '')).first<any>();
  if (!g) throw new HttpError(404, 'no_guest');
  if (b.revoke) {
    await env.DB.prepare(`UPDATE guests SET status='revoked', updated_at=? WHERE search_id=? AND user_id=?`).bind(now(), sid, g.user_id).run();
    await event(env, sid, 'guest', g.user_id, actor, { kind: 'guest_revoked' });
    return;
  }
  const to = b.to == null ? g.date_to : String(b.to);
  if (!isDay(to) || to < g.date_from || daysUntil(to, g.date_from) > 92) throw new HttpError(400, 'bad_dates');
  const areas = b.areas ? cleanAreas(b.areas, false) : cleanAreas(parseJson(g.areas, {}), false);
  await env.DB.prepare(`UPDATE guests SET date_to=?, areas=?, status='active', updated_at=? WHERE search_id=? AND user_id=?`).bind(to, JSON.stringify(areas), now(), sid, g.user_id).run();
}
/** A guest asks the agent to write to a directory contact: a 'guest' draft that a member approves. */
export async function guestMessage(env: Env, sid: string, user: { id: string; display_name: string }, b: any) {
  const e = await env.DB.prepare('SELECT * FROM directory WHERE id=? AND search_id=?').bind(String(b.directory_id ?? ''), sid).first<any>();
  if (!e || e.grp === 'home') throw new HttpError(404, 'no_entry');
  if (!['whatsapp', 'telegram'].includes(e.channel) || !e.address) throw new HttpError(400, 'no_channel', 'This contact has no WhatsApp or Telegram');
  const text = txt(b.text, 500);
  if (!text) throw new HttpError(400, 'missing', 'text is required');
  noSecrets('The message', text);
  const id = rid('d_'), t = now();
  await env.DB.prepare(`INSERT INTO drafts (id, search_id, contact_id, listing_id, channel, address, text, kind, reason, status, requested_by, created_at, updated_at) VALUES (?,?,NULL,NULL,?,?,?, 'guest', ?, 'pending', ?,?,?)`)
    .bind(id, sid, e.channel, e.address, text, `Guest ${user.display_name} asks to write to ${e.name}`, user.id, t, t).run();
  await event(env, sid, 'guest_request', id, user.id, { name: user.display_name, contact: e.name, text });
  return id;
}
/** Cron: guests whose `to` has passed (UTC, a day late at most; requests check the search timezone) → expired; unused guest invites → expired. */
export async function expireGuests(env: Env) {
  const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  await env.DB.batch([
    env.DB.prepare(`UPDATE guests SET status='expired', updated_at=? WHERE status='active' AND date_to < ?`).bind(now(), y),
    env.DB.prepare(`UPDATE invites SET max_uses=uses WHERE kind='guest' AND uses < max_uses AND expires_at < ?`).bind(now()),
  ]);
}

/** Reduced state for a guest (only guide / places / directory contacts / own issues; never money, deal, documents, chats, votes, listings). */
export async function guestState(env: Env, user: { id: string; display_name: string; lang: string }, sid: string, searches: any[], photoToken: string) {
  const a = await member(env, sid, user.id, ['guest']);
  const g = a.guest!;
  const hl = await homeListing(env, sid);
  const [mem, dir, pl, is] = await env.DB.batch<any>([
    env.DB.prepare(`SELECT m.user_id, m.role, m.animal, u.display_name name FROM members m JOIN users u ON u.id=m.user_id WHERE m.search_id=? AND m.role IN ('owner','member') ORDER BY m.role='owner' DESC, u.created_at`).bind(sid),
    env.DB.prepare(`SELECT id, grp, name, subtitle, channel, address, phone, map_url, lat, lng, icon, sort FROM directory WHERE search_id=? AND grp!='home' AND ?2=1 ORDER BY grp, sort, name`).bind(sid, g.areas.contacts ? 1 : 0),
    env.DB.prepare(`SELECT id, name, type, tier, note, lat, lng, area, url FROM places WHERE search_id=? AND hidden=0 AND ?2=1 ORDER BY name`).bind(sid, g.areas.places ? 1 : 0),
    env.DB.prepare(`SELECT id, title, status, scheduled_at, fixed_at, created_at FROM issues WHERE search_id=? AND reported_by=? ORDER BY created_at DESC LIMIT 10`).bind(sid, user.id),
  ]);
  const s = await env.DB.prepare('SELECT dir_groups FROM searches WHERE id=?').bind(sid).first<any>();
  const members = (mem.results ?? []).map((m: any) => ({ user_id: m.user_id, name: m.name, role: m.role, animal: animalInfo(a.region, m.animal) }));
  const summary = searches.find((x) => x.id === sid);
  const today = localDay(a.tz);
  return {
    user: { id: user.id, display_name: user.display_name, lang: user.lang }, searches,
    search: { ...summary, id: sid, title: a.title, region: a.region, country: countryOf(a.region), role: 'guest', brief: { timezone: a.tz }, members, counts: { new: 0, drafts: 0, listings: 0 }, invite_link: null, dir_groups: parseJson(s?.dir_groups, []) },
    me: { role: 'guest', animal: animalInfo(a.region, g.animal), reveal_seen: true, notify: false, digest: false, surf: false,
      guest: { from: g.from, to: g.to, areas: g.areas, hosts: members.map((m: any) => String(m.name).split(' ')[0]), days_left: daysUntil(g.to, today) } },
    members,
    home: hl ? { title: parseJson<any>(hl.deal_data, {}).name ?? hl.title, lat: hl.lat, lng: hl.lng, area_text: hl.area_text, photo: withSrc(hl.id, parseJson<any[]>(hl.photos, []))[0] ?? null, district: hl.district } : null,
    directory: dir.results ?? [], dir_groups: parseJson(s?.dir_groups, []), places: pl.results ?? [], issues: g.areas.issues ? is.results ?? [] : [],
    listings: [], votes: [], ratings: {}, viewings: [], routes: {}, drafts: [], threads: [], listing_contacts: [], channels: [], deal: null, dates: [], money: null,
    house_contacts: [], documents: [], onsite: [], onsite_photos: [], moveout: null, relet: null, power: null, visas: [], bikes: [], scans: [], items: null,
    renewal: null, guests: [], guest_drafts: [], feed: [], counts: { new: 0, drafts: 0, replies_24h: 0 }, agent_last_seen: null, agent_client: null,
    bot_username: env.BOT_USERNAME ?? null, photo_token: photoToken,
  };
}
