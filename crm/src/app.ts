import { webUser, webRoutes } from './web';
import { deskApp } from './desk';
import { accessApp, seen, sendViaBusiness } from './access';
import { seal, isSealed, openRows, openDraft, MSG, THREAD } from './vault';
import { Env, HttpError, json, body, now, rid, hmac, hex, inflate, parseJson, LISTING_JSON, event, safeEqual, guardBody, sensitive } from './util';
import { putImage, kvPhoto, mediaHeaders, verifyPhotoToken, photoToken, withSrc, rateLimit, AUDIO_TYPES, kvBudget } from './media';
import { DECISIONS } from './i18n';
import { publishListing, issueToken } from './bot';
import { fileResponse, tg, tgFileStream } from './tg';
import { routeLink } from './cards';
import { animalInfo, countryOf, regionTz, ensureAnimals, rerollAnimal, publicBrief, isPrivateBriefKey } from './members';
import { recomputeDecision, searchRatings, ratingSummary, CRITERIA } from './scores';
import { moneyView, cleanWeights } from './money';
import { dealDates, docView, DOC_KINDS } from './deal';
import { insertExpense, upsertIssue, cleanShortName } from './agent';
import { cleanRooms, MONEY_MODES } from './money';
import { ownerOfSearch, requireContact } from './household';
import { contactNotes, addNote, searchPower, moveoutView, reletView, setDirEntry, addDirGroup, cleanAnchor, MOVEOUT_STEPS } from './life';
import { member, needArea, guestOnly, guestOpen, type Role } from './roles';
import { guestState, createGuestInvite, guestsView, setGuest, guestMessage } from './guests';
import { localDay } from './local';
import { surfView, surfOn } from './surf';
import { guideView, setGuide, guideLink } from './guide';
import { renewalSql, renewalFromRow, voteNext } from './renewal';
import { negotiationView } from './negotiation';
import { recapView } from './recap';
import { locationScores, locationView, recomputeRings } from './location';
import { patchPlace } from './places';
import { setBike, payBike, bikeView } from './bikes';
import { scansOf } from './scans';
import { setItem, itemsView } from './items';
import { addFloodNote } from './flood';
import { matchDossiers } from './dossier';
import { usefulApp } from './useful';
import { afishaApp } from './afisha';
import { partyApp } from './party';
import { ordersApp, orderDraft } from './orders';
import { recomputeStage, stageSummary, SUMMARY_SQL, stateDates, extensionDates, closedGuard, appStage, toggleTermDate, toggleTermCheck } from './stage';

export interface AppUser { id: string; display_name: string; lang: string; tg_user_id: number | null; link_gen: number; scope?: { sid: string; role: string } }

const INIT_MAX_AGE = 24 * 3600; // initData older than a day is refused (Telegram re-signs it on every Mini App open)

/** Verify Telegram Mini App initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app). */
async function verifyInitData(env: Env, initData: string): Promise<any> {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new HttpError(401, 'no_init_data');
  params.delete('hash');
  const dcs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = await hmac('WebAppData', env.TG_BOT_TOKEN.trim());
  const sig = hex(await hmac(secret, dcs));
  if (!safeEqual(sig, hash)) throw new HttpError(401, 'bad_init_data');
  const authDate = Number(params.get('auth_date') ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > INIT_MAX_AGE) throw new HttpError(401, 'init_data_expired');
  return JSON.parse(params.get('user') ?? 'null');
}

export const LINK_MAX_DAYS = 30;
const b64u = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

/**
 * Signed web link token: base64url("2|uid|exp|gen|sid|role").sig. `gen` = users.link_gen (bumping it revokes every link);
 * `sid`/`role` bind a link minted by a search owner for a member to that one search and role (empty for the user's own link).
 */
export async function signLink(env: Env, userId: string, days: number, gen: number, scope?: { sid: string; role: string } | null): Promise<string> {
  const d = Math.min(LINK_MAX_DAYS, Math.max(1, Math.floor(Number(days) || LINK_MAX_DAYS)));
  const payload = ['2', userId, Math.floor(Date.now() / 1000) + d * 86400, gen, scope?.sid ?? '', scope?.role ?? ''].join('|');
  const sig = hex(await hmac(env.LINK_SECRET, `link|${payload}`)).slice(0, 32);
  return `${b64u(payload)}.${sig}`;
}

async function verifyLink(env: Env, tok: string): Promise<{ uid: string; gen: number; sid: string | null; role: string | null }> {
  const [b64, sig] = String(tok ?? '').split('.');
  let payload = '';
  try {
    payload = unb64u(b64 ?? '');
  } catch {
    throw new HttpError(401, 'bad_link');
  }
  const good = hex(await hmac(env.LINK_SECRET, `link|${payload}`)).slice(0, 32);
  if (!sig || !safeEqual(good, sig)) throw new HttpError(401, 'bad_link');
  const [v, uid, exp, gen, sid, role] = payload.split('|');
  if (v !== '2' || !uid) throw new HttpError(401, 'bad_link');
  if (Number(exp) < Date.now() / 1000) throw new HttpError(401, 'link_expired');
  return { uid, gen: Number(gen), sid: sid || null, role: role || null };
}

const USER_COLS = 'id, display_name, lang, tg_user_id, link_gen';

async function appUser(req: Request, env: Env): Promise<AppUser> {
  const init = req.headers.get('x-tg-init-data');
  const link = req.headers.get('x-hunt-link');
  if (init) {
    const tgUser = await verifyInitData(env, init);
    const u = await env.DB.prepare(`SELECT ${USER_COLS} FROM users WHERE tg_user_id=?`).bind(tgUser?.id).first<AppUser>();
    if (!u) throw new HttpError(403, 'not_member', 'Open the bot and press Start first');
    return u;
  }
  if (link) {
    const l = await verifyLink(env, link);
    // One statement: the user, the current link generation and (for a scoped link) the role it was minted for.
    const u = await env.DB.prepare(`SELECT ${USER_COLS},
        (SELECT role FROM members WHERE search_id=?2 AND user_id=users.id) mrole,
        (SELECT 1 FROM guests WHERE search_id=?2 AND user_id=users.id AND status='active') grole
      FROM users WHERE id=?1`).bind(l.uid, l.sid ?? '').first<AppUser & { mrole: string | null; grole: number | null }>();
    if (!u || Number(u.link_gen) !== l.gen) throw new HttpError(401, 'link_revoked', 'This link was revoked; ask for a new one');
    const { mrole, grole, ...user } = u;
    if (l.sid) {
      const cur = mrole ?? (grole ? 'guest' : null);
      if (!cur || cur !== l.role) throw new HttpError(401, 'link_revoked', 'This link is no longer valid for this search');
      return { ...user, scope: { sid: l.sid, role: l.role! } };
    }
    return user;
  }
  const uid = await webUser(req, env);
  if (uid) {
    const u = await env.DB.prepare(`SELECT ${USER_COLS} FROM users WHERE id=?`).bind(uid).first<AppUser>();
    if (u) return u;
  }
  throw new HttpError(401, 'no_auth');
}

const FEED_KINDS = ['vote', 'rating', 'comment', 'chat', 'instruction', 'draft_decided', 'listing_added', 'viewing_changed', 'brief_changed', 'checklist', 'thread', 'expense', 'settled', 'issue', 'document', 'checks', 'stage_changed'];

async function roleIn(env: Env, sid: string, uid: string): Promise<{ role: string; region: string; title: string }> {
  const r = await env.DB.prepare('SELECT m.role, s.region, s.title FROM members m JOIN searches s ON s.id=m.search_id WHERE m.search_id=? AND m.user_id=?')
    .bind(sid, uid).first<{ role: string; region: string; title: string }>();
  if (!r) throw new HttpError(403, 'not_member');
  return r;
}

const FULL_ROLES = ['owner', 'member'];
/** Roles that may write (vote, money, house, documents): a whitelist, never "not viewer". */
const VOTERS: Role[] = ['owner', 'member'];

/** Searches the user may open in the Mini App (a scoped link narrows them to its one search). */
async function searchRowsOf(env: Env, user: AppUser) {
  const rows = (await env.DB.prepare(
    `SELECT s.id, s.title, s.region, s.status, s.brief, s.owner_id, s.created_at, s.money_mode, s.rooms, s.dir_groups, s.agent_seen_at, s.agent_client, s.stage, s.stage_manual, s.stage_changed_at, s.home_listing_id, s.closed_at, o.display_name owner_name, m.role
     FROM searches s JOIN members m ON m.search_id=s.id AND m.user_id=?1 JOIN users o ON o.id=s.owner_id
     ORDER BY s.status='closed', s.updated_at DESC`,
  ).bind(user.id).all<any>()).results ?? [];
  return user.scope ? rows.filter((x: any) => x.id === user.scope!.sid) : rows;
}

/**
 * The Mini App state: searches, the chosen search's listings, votes, viewings, drafts, feed, conversations.
 * Money, the house, documents and wave 4 blocks come from /app/api/state-more (loaded in parallel), so each call stays
 * well under D1's 50 queries per invocation. Role whitelist: owner/member get everything but the owner-only bits;
 * legacy viewers get no money, deal, documents, drafts, conversations or contact channels.
 */
async function state(req: Request, env: Env, user: AppUser): Promise<Response> {
  const DB = env.DB;
  const url = new URL(req.url);
  const searchRows = await searchRowsOf(env, user);
  // can_create: invited hunters start projects from the app ("Новый проект"); members and guests only join by a link
  const me = { id: user.id, display_name: user.display_name, lang: user.lang, can_create: !user.scope && !!(await DB.prepare('SELECT 1 FROM hunters WHERE user_id=?').bind(user.id).first()) };
  const photo_token = await photoToken(env, user.id, Number(user.link_gen ?? 0), user.scope?.sid);
  // Guests (wave 5): searches where I am an active guest inside the date window get a reduced projection.
  const wantSid = user.scope ? user.scope.sid : url.searchParams.get('s');
  if (!searchRows.length || (wantSid && !searchRows.some((x: any) => x.id === wantSid))) {
    const gs = ((await DB.prepare(`SELECT g.search_id id, g.date_from, g.date_to, g.status, s.title, s.region, s.brief, s.status sstatus, s.created_at, o.display_name owner_name
      FROM guests g JOIN searches s ON s.id=g.search_id JOIN users o ON o.id=s.owner_id WHERE g.user_id=? AND g.status='active' AND s.status!='closed'`).bind(user.id).all<any>()).results ?? [])
      .filter((g) => (!user.scope || g.id === user.scope.sid) && guestOpen(g, localDay(parseJson<any>(g.brief, {}).timezone || regionTz(g.region))));
    const gsum = gs.map((g) => ({ id: g.id, title: g.title, region: g.region, country: countryOf(g.region), status: g.sstatus, role: 'guest', owner_name: g.owner_name, created_at: g.created_at,
      brief: { timezone: parseJson<any>(g.brief, {}).timezone || regionTz(g.region) }, members: [], counts: { new: 0, drafts: 0, listings: 0 }, upcoming: [], deal: null, guest: { from: g.date_from, to: g.date_to } }));
    const gsid = wantSid && gsum.some((x) => x.id === wantSid) ? wantSid : !searchRows.length && gsum.length === 1 ? gsum[0].id : null;
    if (gsid) return json(await guestState(env, user, gsid, gsum, photo_token));
    if (!searchRows.length) return json({ user: me, searches: gsum, search: null });
  }

  const since = new Date(Date.now() - 36 * 3600e3).toISOString().slice(0, 10);
  const [memR, newR, drR, vwR, dlR, cntR, stR] = await DB.batch<any>([
    DB.prepare(`SELECT m.search_id, m.user_id, m.role, m.animal, u.display_name name FROM members m JOIN users u ON u.id=m.user_id
                WHERE m.search_id IN (SELECT search_id FROM members WHERE user_id=?1) ORDER BY m.role='owner' DESC, u.created_at`).bind(user.id),
    DB.prepare(`SELECT l.search_id, COUNT(*) n FROM listings l JOIN members m ON m.search_id=l.search_id AND m.user_id=?1
                WHERE l.status NOT IN ('closed','rejected','taken') AND coalesce(l.decision,'')!='take'
                  AND (l.decision IS NULL OR EXISTS (SELECT 1 FROM votes v WHERE v.listing_id=l.id))
                  AND NOT EXISTS (SELECT 1 FROM votes v WHERE v.listing_id=l.id AND v.user_id=?1)
                GROUP BY l.search_id`).bind(user.id),
    DB.prepare(`SELECT d.search_id, COUNT(*) n FROM drafts d JOIN members m ON m.search_id=d.search_id AND m.user_id=?1 AND m.role='owner'
                WHERE d.status='pending' GROUP BY d.search_id`).bind(user.id),
    DB.prepare(`SELECT v.search_id, v.starts_at FROM viewings v JOIN members m ON m.search_id=v.search_id AND m.user_id=?1
                WHERE v.status IN ('proposed','confirmed') AND v.starts_at >= ?2 ORDER BY v.starts_at`).bind(user.id, since),
    DB.prepare(`SELECT d.search_id, d.listing_id, d.data, d.updated_at FROM deals d JOIN members m ON m.search_id=d.search_id AND m.user_id=?1 AND m.role IN ('owner','member')
                ORDER BY d.updated_at DESC`).bind(user.id),
    DB.prepare(`SELECT l.search_id, COUNT(*) n FROM listings l JOIN members m ON m.search_id=l.search_id AND m.user_id=?1
                WHERE l.status!='closed' GROUP BY l.search_id`).bind(user.id),
    // Wave 6: the projects list (home photo, last term end, move-out date) for the stage line and bar.
    DB.prepare(SUMMARY_SQL).bind(user.id),
  ]);
  const by = <T,>(rows: T[] | undefined, k: keyof T) => {
    const o: Record<string, T[]> = {};
    for (const r of rows ?? []) (o[String(r[k])] ??= []).push(r);
    return o;
  };
  const membersBy = by(memR.results, 'search_id');
  const viewsBy = by(vwR.results, 'search_id');
  const dealsBy = by(dlR.results, 'search_id');
  const num = (rows: any[] | undefined, sid: string) => Number(rows?.find((r) => r.search_id === sid)?.n ?? 0);

  const searches = searchRows.map((s) => {
    const deal = dealsBy[s.id]?.[0];
    return {
      id: s.id,
      title: s.title,
      region: s.region,
      country: countryOf(s.region),
      status: s.status,
      role: s.role,
      owner_name: s.owner_name,
      created_at: s.created_at,
      brief: publicBrief(s.region, s.brief, s.role),
      members: (membersBy[s.id] ?? []).map((m: any) => ({ user_id: m.user_id, name: m.name, role: m.role, animal: animalInfo(s.region, m.animal) })),
      counts: { new: num(newR.results, s.id), drafts: num(drR.results, s.id), listings: num(cntR.results, s.id) },
      upcoming: (viewsBy[s.id] ?? []).slice(0, 6).map((v: any) => v.starts_at),
      deal: deal ? { listing_id: deal.listing_id, terms: parseJson<any>(deal.data, {}).terms ?? null } : null,
      stage: stageSummary(s, (stR.results ?? []).find((r: any) => r.search_id === s.id), deal ? parseJson<any>(deal.data, {}).terms ?? null : null, { listings: num(cntR.results, s.id) }),
      money_mode: s.money_mode === 'shared' ? 'shared' : 'split',
      rooms: parseJson(s.rooms, null),
      dir_groups: parseJson(s.dir_groups, []),
    };
  });

  // ?l=<listing id> (bot card "Open" → startapp) resolves the search of that listing.
  const viaListing = url.searchParams.get('l') && !wantSid
    ? (await DB.prepare('SELECT search_id FROM listings WHERE id=?').bind(url.searchParams.get('l')).first<{ search_id: string }>())?.search_id
    : null;
  const sid = wantSid ?? viaListing ?? (searches.length === 1 ? searches[0].id : null);
  if (!sid) return json({ user: me, searches, search: null, photo_token });
  const summary = searches.find((x) => x.id === sid);
  if (!summary) throw new HttpError(403, 'not_member');
  const role = summary.role;
  const full = FULL_ROLES.includes(role);
  if ((membersBy[sid] ?? []).some((m: any) => !m.animal)) await ensureAnimals(env, sid, summary.region);

  const day = new Date(Date.now() - 24 * 3600e3).toISOString();
  const inList = `(SELECT id FROM listings WHERE search_id=?1)`;
  // Messages of the search: by search_id (index messages_search) plus listing messages logged without a search (messages_listing).
  const msgSrc = `(SELECT id, at, channel, text, listing_id, contact_id, direction FROM messages WHERE search_id=?1 AND direction='in'
                   UNION ALL SELECT id, at, channel, text, listing_id, contact_id, direction FROM messages WHERE listing_id IN ${inList} AND search_id IS NULL AND direction='in')`;
  const [mem, lst, vts, vws, drf, dls, evs, msgs, rep, inv, thr, lcs, chs, w5] = await DB.batch<any>([
    DB.prepare(`SELECT m.user_id, m.role, m.animal, m.reveal_seen_at, m.notify, m.digest, m.surf, u.display_name name FROM members m JOIN users u ON u.id=m.user_id
                WHERE m.search_id=?1 ORDER BY m.role='owner' DESC, u.created_at`).bind(sid),
    DB.prepare(`SELECT * FROM listings WHERE search_id=?1 AND status!='closed'
                ORDER BY CASE decision WHEN 'take' THEN 0 WHEN 'want_view' THEN 1 WHEN 'thinking' THEN 2 WHEN 'not_interested' THEN 9 ELSE 3 END, created_at DESC`).bind(sid),
    DB.prepare(`SELECT v.listing_id, v.user_id, v.decision, v.comment, v.at FROM votes v JOIN listings l ON l.id=v.listing_id WHERE l.search_id=?1`).bind(sid),
    DB.prepare(`SELECT v.*, l.title, l.lat, l.lng, l.map_url, l.photos, l.district, l.area_text, l.bedrooms, l.price, l.currency
                FROM viewings v JOIN listings l ON l.id=v.listing_id WHERE v.search_id=?1 AND v.status!='cancelled' ORDER BY v.starts_at`).bind(sid),
    DB.prepare(`SELECT d.id, d.contact_id, d.listing_id, d.channel, d.address, d.text, d.tr, d.kind, d.reason, d.created_at,
                       c.name contact_name, l.title listing_title, l.price listing_price, l.currency listing_currency, l.district listing_district,
                       l.area_text listing_area, l.bedrooms listing_bedrooms,
                       (SELECT mm.text FROM messages mm WHERE mm.contact_id=d.contact_id AND mm.direction='in' ORDER BY mm.at DESC LIMIT 1) last_in_text,
                       (SELECT mm.at FROM messages mm WHERE mm.contact_id=d.contact_id AND mm.direction='in' ORDER BY mm.at DESC LIMIT 1) last_in_at
                FROM drafts d LEFT JOIN contacts c ON c.id=d.contact_id LEFT JOIN listings l ON l.id=d.listing_id
                WHERE d.search_id=?1 AND d.status='pending' AND ?2='owner' ORDER BY d.created_at`).bind(sid, role),
    DB.prepare(`SELECT * FROM deals WHERE search_id=?1 AND ?2=1 ORDER BY updated_at DESC LIMIT 1`).bind(sid, full ? 1 : 0),
    // Feed: instructions are private to their author unless you own the search (M3); threads only for members.
    DB.prepare(`SELECT e.id, e.kind, e.ref, e.actor, e.data, e.at, u.display_name name FROM events e LEFT JOIN users u ON u.id=e.actor
                WHERE e.search_id=?1 AND e.kind IN (${FEED_KINDS.map((k) => `'${k}'`).join(',')})
                  AND (e.kind!='instruction' OR ?2='owner' OR e.actor=?3) AND (?4=1 OR e.kind NOT IN ('thread','expense','settled','document','draft_decided'))
                ORDER BY e.id DESC LIMIT 40`).bind(sid, role, user.id, full ? 1 : 0),
    DB.prepare(`SELECT msg.id, msg.at, msg.channel, msg.text, msg.listing_id, c.name contact_name FROM (SELECT * FROM ${msgSrc} ORDER BY at DESC LIMIT 20) msg
                LEFT JOIN contacts c ON c.id=msg.contact_id WHERE ?2=1 ORDER BY msg.at DESC`).bind(sid, full ? 1 : 0),
    DB.prepare(`SELECT (SELECT COUNT(*) FROM messages WHERE search_id=?1 AND direction='in' AND at > ?2)
                     + (SELECT COUNT(*) FROM messages WHERE listing_id IN ${inList} AND search_id IS NULL AND direction='in' AND at > ?2) n`).bind(sid, day),
    DB.prepare(`SELECT code FROM invites WHERE search_id=?1 AND kind='member' AND uses < max_uses AND (expires_at IS NULL OR expires_at > ?2) AND ?3=1
                ORDER BY created_at DESC LIMIT 1`).bind(sid, now(), full ? 1 : 0),
    DB.prepare(`SELECT t.contact_id, t.listing_id, t.state, t.known, t.open, t.last, t.last_at, t.updated_at, c.name contact_name, c.role contact_role
                FROM threads t LEFT JOIN contacts c ON c.id=t.contact_id WHERE t.search_id=?1 AND ?2=1`).bind(sid, full ? 1 : 0),
    DB.prepare(`SELECT lc.listing_id, lc.contact_id, c.name, c.role FROM listing_contacts lc JOIN contacts c ON c.id=lc.contact_id WHERE lc.listing_id IN ${inList} AND ?2=1`).bind(sid, full ? 1 : 0),
    DB.prepare(`SELECT contact_id, channel, address, display FROM contact_channels
                WHERE ?2=1 AND contact_id IN (SELECT contact_id FROM threads WHERE search_id=?1 UNION SELECT contact_id FROM listing_contacts WHERE listing_id IN ${inList})`).bind(sid, full ? 1 : 0),
    // Wave 5 in one statement: what next, guests, guest drafts waiting for a member, guide link (members only).
    DB.prepare(`SELECT
      (SELECT json_group_array(json_object('user_id', g.user_id, 'name', u.display_name, 'animal', g.animal, 'from', g.date_from, 'to', g.date_to, 'areas', json(g.areas), 'status', g.status, 'invited_by', g.invited_by))
        FROM guests g JOIN users u ON u.id=g.user_id WHERE g.search_id=?1 AND g.status='active') guests,
      (SELECT json_group_array(json_object('id', d.id, 'text', d.text, 'reason', d.reason, 'channel', d.channel, 'address', d.address, 'requested_by', d.requested_by,
          'requester_name', (SELECT display_name FROM users WHERE id=d.requested_by), 'dir_name', (SELECT name FROM directory WHERE search_id=?1 AND address=d.address LIMIT 1), 'created_at', d.created_at))
        FROM drafts d WHERE d.search_id=?1 AND d.kind='guest' AND d.status='pending') gdrafts,
      (SELECT token_hash IS NOT NULL FROM guides WHERE search_id=?1) guide_ready
      WHERE ?2=1`).bind(sid, full ? 1 : 0),
  ]);
  await openRows(env, drf.results ?? [], ['text', 'tr', 'last_in_text']);
  await openRows(env, msgs.results ?? [], MSG);
  await openRows(env, thr.results ?? [], THREAD);

  const members = (mem.results ?? []).map((m: any) => ({ user_id: m.user_id, name: m.name, role: m.role, animal: animalInfo(summary.region, m.animal) }));
  const rawSearch = searchRows.find((x: any) => x.id === sid);
  const [ratings, locScores, rn] = await Promise.all([
    searchRatings(env, sid),
    locationScores(env, { id: sid, region: summary.region, brief: rawSearch?.brief ?? '{}' }, lst.results ?? []),
    renewalSql(env, sid).first<any>(),
  ]);
  // Wave 6: the project path, derived fresh (one D1 statement; writes only when the stage changes).
  const pathR = await recomputeStage(env, sid, { role, actor: 'system' }).catch((e) => { console.error('stage', sid, String(e?.message ?? e)); return null; });
  const path = pathR?.path ?? null;
  if (path) summary.stage = { ...summary.stage, key: path.key, idx: path.idx, closed: path.closed, manual: path.manual, at: path.at, date: path.date, line_key: `pp_line_${path.key}`, estimated: false };
  const extDates = path && full && path.terms.some((t: any) => t.seq >= 2) ? await extensionDates(env, sid) : [];
  const meRow = (mem.results ?? []).find((m: any) => m.user_id === user.id);
  const viewings = (vws.results ?? []).map((v: any) => { const x = inflate(v, ['photos'])!; x.photos = withSrc(v.listing_id, x.photos); return x; });
  const byDay: Record<string, any[]> = {};
  for (const v of viewings) (byDay[String(v.starts_at).slice(0, 10)] ??= []).push(v);
  const routes = Object.fromEntries(Object.entries(byDay).map(([d, vs]) => [d, routeLink(vs)]));
  const seenThread = new Set<string>();
  const feedEvents = (evs.results ?? [])
    .filter((e: any) => e.kind !== 'thread' || (!seenThread.has(e.ref) && !!seenThread.add(e.ref))) // latest summary per conversation
    .map((e: any) => {
      let data = parseJson<any>(e.data, {});
      if (e.kind === 'brief_changed' && role !== 'owner') {
        data = { name: data.name, keys: (data.changes ?? []).map((c: any) => c.key).filter((k: string) => !isPrivateBriefKey(k)) };
      }
      return { type: 'event', id: `e${e.id}`, kind: e.kind, ref: e.ref, actor: e.actor, name: e.name, data, at: e.at };
    })
    .filter((e: any) => e.kind !== 'brief_changed' || role === 'owner' || e.data.keys.length);
  const feed = [
    ...feedEvents,
    ...(msgs.results ?? []).map((m: any) => ({ type: 'message', id: m.id, at: m.at, channel: m.channel, text: m.text, listing_id: m.listing_id, contact_name: m.contact_name })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 20);
  const deal = dls.results?.[0] ? inflate(dls.results[0], ['data']) : null;
  if (deal && role !== 'owner') { delete (deal as any).asked; delete (deal as any).agreed; } // negotiation numbers are owner-only
  const w = w5.results?.[0] ?? null;
  const voters = (mem.results ?? []).filter((m: any) => m.role === 'owner' || m.role === 'member').length;
  const code = inv.results?.[0]?.code;

  return json({
    user: me,
    searches,
    search: {
      ...summary,
      invite_link: code && env.BOT_USERNAME && full ? `https://t.me/${env.BOT_USERNAME}?start=${code}` : null,
    },
    me: { role, animal: animalInfo(summary.region, meRow?.animal), reveal_seen: !!meRow?.reveal_seen_at, notify: meRow?.notify !== 0, digest: meRow?.digest !== 0,
      surf: surfOn(meRow?.surf ?? null, rawSearchBrief(searchRows, sid)), surf_auto: meRow?.surf == null },
    members,
    listings: (lst.results ?? []).map((l: any) => {
      const x = inflate(l, LISTING_JSON)!;
      delete x.tg_message_id;
      delete x.location;
      x.photos = withSrc(l.id, x.photos);
      x.location_score = locScores[l.id] ?? null;
      return x;
    }),
    votes: vts.results ?? [],
    ratings,
    viewings,
    routes,
    drafts: drf.results ?? [],
    threads: thr.results ?? [],
    listing_contacts: lcs.results ?? [],
    channels: chs.results ?? [],
    deal,
    dates: stateDates(deal ? deal.data : null, extDates),
    path,
    // Filled by /app/api/state-more (the Mini App merges it before rendering).
    money: null, issues: [], house_contacts: [], documents: [], onsite: [], onsite_photos: [], moveout: null, relet: null, power: null,
    directory: [], visas: [], places: [], bikes: [], scans: [], items: null,
    bot_username: env.BOT_USERNAME ?? null,
    renewal: role === 'guest' ? null : renewalFromRow(rn, voters),
    guests: parseJson<any[]>(w?.guests, []).filter((g) => g?.user_id).map((g) => ({ ...g, animal: animalInfo(summary.region, g.animal) })),
    guest_drafts: parseJson<any[]>(w?.gdrafts, []).filter((x) => x?.id),
    guide_ready: !!w?.guide_ready,
    feed,
    counts: { new: summary.counts.new, drafts: summary.counts.drafts, replies_24h: full ? Number(rep.results?.[0]?.n ?? 0) : 0 },
    agent_last_seen: rawSearch?.agent_seen_at ?? null,
    agent_client: rawSearch?.agent_client ?? null, // claude-code | codex (X-Hunt-Client of the owner's plugin)
    photo_token,
  });
}

/** The rest of the Mini App state for one search: money, the house, documents, on-site checks, wave 3 and wave 4 blocks. */
async function stateMore(req: Request, env: Env, user: AppUser): Promise<Response> {
  const DB = env.DB;
  const sid = user.scope?.sid ?? new URL(req.url).searchParams.get('s') ?? '';
  const a = await member(env, sid, user.id, ['owner', 'member', 'viewer', 'guest']);
  if (a.role === 'guest') return json({ search_id: sid }); // the guest state already has everything a guest may see
  const role = a.role;
  const full = FULL_ROLES.includes(role);
  const inList = `(SELECT id FROM listings WHERE search_id=?1)`;
  const [isR, hcR, docR, scR, spR, dirR, visR, plR, bkR] = await DB.batch<any>([
    DB.prepare(`SELECT * FROM issues WHERE search_id=?1 ORDER BY status='fixed', coalesce(fixed_at, updated_at) DESC`).bind(sid),
    DB.prepare(`SELECT id, name, role, note, cost, currency, period, payer, schedule, channel, address, contact_id, sort FROM house_contacts WHERE search_id=?1 AND ?2=1 ORDER BY sort, updated_at`).bind(sid, full ? 1 : 0),
    DB.prepare(`SELECT * FROM documents WHERE search_id=?1 AND ?2=1 ORDER BY created_at`).bind(sid, full ? 1 : 0),
    DB.prepare(`SELECT c.listing_id, c.viewing_id, c.user_id, c.item, c.ok, c.note, c.at FROM site_checks c WHERE c.listing_id IN ${inList}`).bind(sid),
    DB.prepare(`SELECT listing_id, viewing_id, COUNT(*) n FROM site_photos WHERE listing_id IN ${inList} GROUP BY listing_id, viewing_id`).bind(sid),
    DB.prepare('SELECT * FROM directory WHERE search_id=?1 ORDER BY grp, sort, name').bind(sid),
    DB.prepare(`SELECT user_id, visa_until FROM members WHERE search_id=?1 AND visa_until IS NOT NULL AND (?2='owner' OR user_id=?3)`).bind(sid, role, user.id),
    DB.prepare('SELECT id, source, list_name, name, type, tier, note, address, lat, lng, area, url, hidden FROM places WHERE search_id=?1 ORDER BY name').bind(sid),
    DB.prepare("SELECT * FROM bikes WHERE search_id=?1 ORDER BY status='returned', created_at").bind(sid),
  ]);
  const [money, moveout, relet, power, scans, items] = await Promise.all([
    full ? moneyView(env, sid) : null, full ? moveoutView(env, sid) : null, full ? reletView(env, sid) : null, searchPower(env, sid),
    full ? scansOf(env, sid) : [], itemsView(env, sid),
  ]);
  return json({
    search_id: sid,
    money,
    issues: isR.results ?? [],
    house_contacts: hcR.results ?? [],
    documents: (docR.results ?? []).map(docView),
    onsite: scR.results ?? [],
    onsite_photos: spR.results ?? [],
    moveout,
    relet,
    power,
    directory: dirR.results ?? [],
    visas: visR.results ?? [],
    places: plR.results ?? [],
    bikes: (bkR.results ?? []).map(bikeView),
    scans,
    items,
  });
}

const BRIEF_ARRAYS = ['bedrooms', 'payment_terms', 'property_type', 'districts'];
const BRIEF_MONEY = ['budget_min', 'budget_max', 'budget_said'];
const BRIEF_TEXT = ['must_have', 'nice_to_have', 'deal_breakers', 'term'];

/** Only keys the edit sheet may change, with types checked. null = remove the key. */
function cleanBriefPatch(p: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!p || typeof p !== 'object') throw new HttpError(400, 'bad_brief');
  for (const k of BRIEF_ARRAYS) {
    if (!(k in p)) continue;
    if (p[k] == null) { out[k] = null; continue; }
    if (!Array.isArray(p[k]) || p[k].length > 40) throw new HttpError(400, 'bad_brief', `${k} must be a list`);
    const xs = [...new Set(p[k].map((x: unknown) => String(x).trim().slice(0, 40)).filter(Boolean))];
    if (k === 'districts' && xs.some((x) => !/^[a-z0-9_-]+$/.test(x as string))) throw new HttpError(400, 'bad_brief', 'districts must be pack slugs');
    out[k] = xs.length ? xs : null;
  }
  for (const k of BRIEF_MONEY) {
    if (!(k in p)) continue;
    const v = p[k] == null || p[k] === '' ? null : Number(p[k]);
    if (v != null && (!Number.isFinite(v) || v < 0)) throw new HttpError(400, 'bad_brief', `${k} must be a number`);
    out[k] = v == null ? null : Math.round(v);
  }
  for (const k of BRIEF_TEXT) {
    if (!(k in p)) continue;
    const v = p[k] == null ? '' : String(p[k]).trim().slice(0, 500);
    out[k] = v || null;
  }
  if ('move_in' in p) {
    if (p.move_in != null && p.move_in !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(String(p.move_in))) throw new HttpError(400, 'bad_brief', 'move_in must be YYYY-MM-DD');
    out.move_in = p.move_in || null;
  }
  return out;
}

/** "budget_min: — → 20000000; districts: +dreamland −melasti" for the agent's digest. */
function diffSummary(changes: { key: string; from: unknown; to: unknown }[]): string {
  const v = (x: unknown) => (x == null ? '—' : Array.isArray(x) ? x.join(', ') : String(x));
  return changes.map(({ key, from, to }) => {
    if (Array.isArray(from) || Array.isArray(to)) {
      const a = new Set((from as string[]) ?? []), b = new Set((to as string[]) ?? []);
      const add = [...b].filter((x) => !a.has(x)), del = [...a].filter((x) => !b.has(x));
      return `${key}: ${[...add.map((x) => '+' + x), ...del.map((x) => '−' + x)].join(' ') || v(to)}`;
    }
    return `${key}: ${v(from)} → ${v(to)}`;
  }).join('; ');
}

const GUEST_PATHS = new Set(['/app/api/state', '/app/api/state-more', '/app/api/guide', '/app/api/surf', '/app/api/issue', '/app/api/guest-message', '/app/api/lang', '/app/api/useful']);
const rawSearchBrief = (rows: any[], sid: string) => rows.find((x: any) => x.id === sid)?.brief ?? '{}';

export async function handleApp(req: Request, env: Env, path: string): Promise<Response> {
  if (path === '/app' || path === '/app/') {
    const r = await env.ASSETS.fetch(new Request(new URL('/index.html', req.url)));
    return new Response(r.body, { status: r.status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
  }
  { const r = await webRoutes(req, env, path); if (r) return r; }
  if (path.startsWith('/app/kv/')) {
    // KV media: a photo token (?k=, <img> cannot send headers) or the usual auth; the search comes from the key, membership is checked.
    const url = new URL(req.url);
    const key = decodeURIComponent(path.slice('/app/kv/'.length));
    const idx = url.searchParams.get('i');
    const k = url.searchParams.get('k');
    const who = k ? await verifyPhotoToken(env, k, async (u) => genOf(env, u)) : await appUser(req, env).then((u) => ({ uid: u.id, sid: u.scope?.sid ?? null }), () => { throw new HttpError(401, 'no_auth'); });
    if (!(await mediaAllowed(env, who.uid, key, who.sid))) return new Response('not found', { status: 404 });
    const got = await kvPhoto(env, key, idx == null ? null : Number(idx));
    if (!got) return new Response('not found', { status: 404 });
    return new Response(got.body, { headers: mediaHeaders(got.type ?? 'image/jpeg', { 'cache-control': 'private, max-age=172800, immutable' }) });
  }
  if (path.startsWith('/app/photo/')) {
    // A listing photo that lives in Telegram, addressed by listing and index (never by a raw file_id).
    const m = path.match(/^\/app\/photo\/([^/]+)\/(\d{1,2})$/);
    if (!m) return new Response('not found', { status: 404 });
    const lid = decodeURIComponent(m[1]);
    const k = new URL(req.url).searchParams.get('k');
    const who = k ? await verifyPhotoToken(env, k, async (u) => genOf(env, u)) : await appUser(req, env).then((u) => ({ uid: u.id, sid: u.scope?.sid ?? null }), () => { throw new HttpError(401, 'no_auth'); });
    if (!(await mediaAllowed(env, who.uid, `p/${lid}/`, who.sid))) return new Response('not found', { status: 404 });
    const l = await env.DB.prepare('SELECT photos FROM listings WHERE id=?').bind(lid).first<{ photos: string }>();
    const ph = parseJson<any[]>(l?.photos, [])[Number(m[2])];
    if (!ph?.file_id) return new Response('not found', { status: 404 });
    return fileResponse(env, ph.file_id);
  }
  if (path.startsWith('/app/doc/')) {
    // Document file proxy: a short-lived token from /app/api/doc-link, re-checked against membership; nothing is stored.
    const id = decodeURIComponent(path.slice('/app/doc/'.length));
    const uid = await verifyDocToken(env, id, new URL(req.url).searchParams.get('t') ?? '');
    const d = await env.DB.prepare("SELECT d.* FROM documents d JOIN members m ON m.search_id=d.search_id AND m.user_id=? AND m.role IN ('owner','member') WHERE d.id=?").bind(uid, id).first<any>();
    if (!d?.tg_file_id) return new Response('not found', { status: 404 });
    return tgFileStream(env, d.tg_file_id, { mime: d.mime, name: d.file_name });
  }
  const user = await appUser(req, env);
  const DB = env.DB;
  // Free text never carries passport / ID / card numbers (every JSON write, before any route runs).
  await guardBody(req);
  // Guests (wave 5) use only these routes; everything else is members-only (and checked again by each route).
  if (path.startsWith('/app/api/') && !GUEST_PATHS.has(path) && (await guestOnly(env, user.id))) throw new HttpError(403, 'guest');
  // A link an owner minted for a member opens only that one search.
  if (user.scope) await checkScope(req, env, path, user.scope.sid);
  // Wave 6: a closed project is read-only (409 closed on writes that name it).
  await closedGuard(req, env, path);

  { const r = await accessApp(req, env, path, user); if (r) return r; }
  if (path === '/app/api/state' && req.method === 'GET') return state(req, env, user);
  if (path === '/app/api/state-more' && req.method === 'GET') return stateMore(req, env, user);
  { const r = await deskApp(req, env, path, user); if (r) return r; }
  // Wave 6 · Полезное: /app/api/useful (guests read-only), /app/api/useful-suggest, /app/api/useful-decide (owner).
  if (path.startsWith('/app/api/useful')) { const r = await usefulApp(req, env, path, user); if (r) return r; }
  // Wave 7 · Афиша: /app/api/afisha, event, event-plan, event-feedback, event-book, event-book-cancel, afisha-prefs.
  if (path.startsWith('/app/api/afisha') || path.startsWith('/app/api/event-') || path === '/app/api/event') { const r = await afishaApp(req, env, path, user); if (r) return r; }
  // Wave 9: parties, the evening Home (/app/api/evening, evening-leaving, evening-late).
  if (path.startsWith('/app/api/part') || path.startsWith('/app/api/evening')) { const r = await partyApp(req, env, path, user); if (r) return r; }

  // Wave 10: orders from suppliers (/app/api/shop, orders, order, order-*).
  if (path === '/app/api/shop' || path === '/app/api/orders' || path === '/app/api/order' || path.startsWith('/app/api/order-')) { const r = await ordersApp(req, env, path, user); if (r) return r; }

  if (path === '/app/api/listing' && req.method === 'GET') {
    const lid = new URL(req.url).searchParams.get('id') ?? '';
    const l = await DB.prepare(`SELECT l.id, l.search_id, m.role FROM listings l JOIN members m ON m.search_id=l.search_id WHERE l.id=? AND m.user_id=?`).bind(lid, user.id).first<any>();
    if (!l) throw new HttpError(404, 'no_listing');
    const full = VOTERS.includes(l.role) ? 1 : 0; // conversations and contacts: owner and members only
    const [msgs, contacts, comments] = await DB.batch<any>([
      DB.prepare(`SELECT m.id, m.direction, m.channel, m.text, m.at, c.name contact_name FROM messages m LEFT JOIN contacts c ON c.id=m.contact_id
                  WHERE m.listing_id=? AND ?2=1 ORDER BY m.at DESC LIMIT 100`).bind(lid, full),
      DB.prepare(`SELECT c.id, c.name, c.role, lc.role link_role FROM listing_contacts lc JOIN contacts c ON c.id=lc.contact_id WHERE lc.listing_id=? AND ?2=1`).bind(lid, full),
      DB.prepare(`SELECT e.id, e.actor, e.data, e.at FROM events e WHERE e.search_id=? AND e.kind='comment' AND e.ref=? ORDER BY e.id DESC LIMIT 50`).bind(l.search_id, lid),
    ]);
    await openRows(env, msgs.results ?? [], MSG);
    if (msgs.results?.length) await seen(env, await ownerOfSearch(env, l.search_id), user.id, 'app');
    return json({
      messages: (msgs.results ?? []).reverse(),
      contacts: contacts.results ?? [],
      comments: (comments.results ?? []).map((c: any) => ({ ...c, data: parseJson(c.data, {}) })).reverse(),
    });
  }

  if (path === '/app/api/vote' && req.method === 'POST') {
    const b = await body(req);
    if (!(DECISIONS as readonly string[]).includes(b.decision)) throw new HttpError(400, 'bad_decision');
    const l = await DB.prepare(`SELECT l.* FROM listings l JOIN members m ON m.search_id=l.search_id WHERE l.id=? AND m.user_id=? AND m.role IN ('owner','member')`).bind(b.listing_id, user.id).first<any>();
    if (!l) throw new HttpError(404, 'no_listing');
    await DB.prepare('INSERT INTO votes (listing_id, user_id, decision, comment, at) VALUES (?,?,?,?,?) ON CONFLICT(listing_id,user_id) DO UPDATE SET decision=excluded.decision, comment=coalesce(excluded.comment, comment), at=excluded.at')
      .bind(l.id, user.id, b.decision, b.comment ?? null, now()).run();
    const group = await recomputeDecision(env, l.id);
    await event(env, l.search_id, 'vote', l.id, user.id, { name: user.display_name, decision: b.decision, group, title: l.title, comment: b.comment });
    await publishListing(env, { ...l, decision: group }, null).catch(() => null);
    return json({ ok: true, decision: group });
  }

  // Deck "undo": drop my vote; the group decision is recomputed from the remaining votes.
  if (path === '/app/api/unvote' && req.method === 'POST') {
    const b = await body(req);
    const l = await DB.prepare(`SELECT l.* FROM listings l JOIN members m ON m.search_id=l.search_id WHERE l.id=? AND m.user_id=? AND m.role IN ('owner','member')`).bind(b.listing_id, user.id).first<any>();
    if (!l) throw new HttpError(404, 'no_listing');
    await DB.prepare('DELETE FROM votes WHERE listing_id=? AND user_id=?').bind(l.id, user.id).run();
    await recomputeDecision(env, l.id);
    await event(env, l.search_id, 'vote_undone', l.id, user.id, { name: user.display_name, title: l.title });
    const fresh = await DB.prepare('SELECT * FROM listings WHERE id=?').bind(l.id).first<any>();
    await publishListing(env, fresh, null).catch(() => null);
    return json({ ok: true, decision: fresh?.decision ?? null });
  }

  // Voice note for a rating: raw audio body, stored in KV; the key goes into /app/api/rate as `voice`.
  if (path === '/app/api/rating-voice' && req.method === 'POST') {
    const lid = new URL(req.url).searchParams.get('listing_id') ?? '';
    const l = await DB.prepare(`SELECT l.id FROM listings l JOIN members m ON m.search_id=l.search_id WHERE l.id=? AND m.user_id=? AND m.role IN ('owner','member')`).bind(lid, user.id).first<any>();
    if (!l) throw new HttpError(404, 'no_listing');
    const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!AUDIO_TYPES.includes(type)) throw new HttpError(400, 'not_audio', 'Send the recording as audio (webm, ogg, mp4, mpeg, aac, wav)');
    await rateLimit(env, 'upload', user.id, 60);
    const buf = await req.arrayBuffer();
    if (!buf.byteLength) throw new HttpError(400, 'empty');
    if (buf.byteLength > 8 * 1024 * 1024) throw new HttpError(413, 'too_big', 'Voice notes up to 8 MB');
    const key = `v/${lid}/${user.id}-${Date.now().toString(36)}`;
    await kvBudget(env, 1);
    await env.PHOTOS_KV.put(key, buf, { metadata: { type } });
    return json({ key });
  }

  // Rating after a viewing (members): four criteria 1-5, a note, an optional voice key.
  if (path === '/app/api/rate' && req.method === 'POST') {
    const b = await body(req);
    const l = await DB.prepare(`SELECT l.* FROM listings l JOIN members m ON m.search_id=l.search_id WHERE l.id=? AND m.user_id=? AND m.role IN ('owner','member')`).bind(b.listing_id, user.id).first<any>();
    if (!l) throw new HttpError(404, 'no_listing');
    const vals = CRITERIA.map((c) => Number(b[c]));
    if (vals.some((v) => !Number.isInteger(v) || v < 1 || v > 5)) throw new HttpError(400, 'bad_rating', `${CRITERIA.join(', ')} must be 1-5`);
    const note = b.note == null ? null : String(b.note).trim().slice(0, 1000) || null;
    const voice = b.voice == null || b.voice === '' ? null : String(b.voice);
    if (voice && !voice.startsWith(`v/${l.id}/${user.id}-`)) throw new HttpError(400, 'bad_voice');
    const at = now();
    await DB.prepare(`INSERT INTO ratings (listing_id, user_id, overall, area, inside, quiet, note, voice, at) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(listing_id, user_id) DO UPDATE SET overall=excluded.overall, area=excluded.area, inside=excluded.inside, quiet=excluded.quiet,
      note=excluded.note, voice=coalesce(excluded.voice, voice), at=excluded.at`).bind(l.id, user.id, ...vals, note, voice, at).run();
    const mine = ratingSummary([{ listing_id: l.id, user_id: user.id, overall: vals[0], area: vals[1], inside: vals[2], quiet: vals[3], note, voice, at }])!;
    await event(env, l.search_id, 'rating', l.id, user.id, {
      name: user.display_name, title: l.title, score: mine.score, note, ...(voice ? { voice } : {}),
      criteria: Object.fromEntries(CRITERIA.map((c, i) => [c, vals[i]])),
    });
    const all = await searchRatings(env, l.search_id);
    return json({ ok: true, score: mine.score, rating: all[l.id] ?? null });
  }

  if (path === '/app/api/comment' && req.method === 'POST') {
    const b = await body(req);
    const l = await DB.prepare(`SELECT l.* FROM listings l JOIN members m ON m.search_id=l.search_id WHERE l.id=? AND m.user_id=? AND m.role IN ('owner','member')`).bind(b.listing_id, user.id).first<any>();
    if (!l || !b.text) throw new HttpError(400, 'bad_comment');
    await event(env, l.search_id, 'comment', l.id, user.id, { name: user.display_name, text: String(b.text).slice(0, 2000) });
    return json({ ok: true });
  }

  if (path === '/app/api/draft' && req.method === 'POST') {
    const b = await body(req);
    // Owner decides every draft; members (owner + member) also decide drafts a guest asked for (kind 'guest').
    const d = await DB.prepare(`SELECT d.* FROM drafts d JOIN searches s ON s.id=d.search_id LEFT JOIN members m ON m.search_id=d.search_id AND m.user_id=?2
      WHERE d.id=?1 AND (s.owner_id=?2 OR (d.kind='guest' AND m.role IN ('owner','member')))`).bind(b.draft_id, user.id).first<any>();
    if (!d) throw new HttpError(404, 'no_draft');
    if (d.status !== 'pending') throw new HttpError(409, 'already_decided', d.status);
    const sealed = isSealed(d.text);
    await openDraft(env, d);
    const status = b.action === 'send' ? (b.text && b.text !== d.text ? 'edited' : 'approved') : 'rejected';
    if (status === 'edited') { const sn = sensitive(String(b.text)); if (sn) throw new HttpError(400, 'sensitive'); }
    await DB.prepare('UPDATE drafts SET status=?, edited_text=?, decided_by=?, updated_at=? WHERE id=?').bind(status, status !== 'edited' ? null : sealed ? await seal(env, await ownerOfSearch(env, d.search_id), String(b.text).slice(0, 2000)) : String(b.text).slice(0, 2000), user.id, now(), d.id).run();
    if (status === 'rejected') await orderDraft(env, d.id, status); // wave 10: an order's draft → collecting again
    await event(env, d.search_id, 'draft_decided', d.id, user.id, { status, ...(d.kind === 'guest' ? { kind: 'guest', name: user.display_name } : {}) });
    const sent = status !== 'rejected' && (await sendViaBusiness(env, d.id));
    return json({ ok: true, status: sent ? 'sent' : status });
  }

  // A new project from the app (design/mockup-v7): invited hunters only. The brief goes through the same whitelist as the owner's
  // brief edits; a free-form wish becomes an instruction for the agent, so typing it or tapping the map is the same thing.
  if (path === '/app/api/searches' && req.method === 'POST') {
    if (user.scope) throw new HttpError(403, 'scoped');
    if (!(await DB.prepare('SELECT 1 FROM hunters WHERE user_id=?').bind(user.id).first())) throw new HttpError(403, 'not_hunter');
    await rateLimit(env, 'newsearch', user.id, 10);
    const b = await body(req);
    const region = String(b.region ?? '');
    if (!/^[a-z_]{2,20}\/[a-z0-9_]{2,40}$/.test(region)) throw new HttpError(400, 'bad_region', 'region must be country/city');
    const title = String(b.title ?? '').trim().slice(0, 80);
    if (!title) throw new HttpError(400, 'no_title');
    const living = b.mode === 'living';
    const brief: Record<string, unknown> = Object.fromEntries(Object.entries(cleanBriefPatch(b.brief ?? {})).filter(([, v]) => v != null));
    const cap = b.brief?.budget_cap == null || b.brief.budget_cap === '' ? null : Number(b.brief.budget_cap);
    if (cap != null && (!Number.isFinite(cap) || cap < 0)) throw new HttpError(400, 'bad_brief', 'budget_cap must be a number');
    if (cap) brief.budget_cap = Math.round(cap);
    for (const k of ['currency', 'timezone']) if (typeof b.brief?.[k] === 'string' && /^[A-Za-z_/+-]{3,40}$/.test(b.brief[k])) brief[k] = b.brief[k];
    const wish = String(b.wish ?? '').trim().slice(0, 1000);
    if (wish && sensitive(wish)) throw new HttpError(400, 'sensitive');
    const id = rid('s_'), t = now(), code = rid('');
    await DB.batch([
      DB.prepare('INSERT INTO searches (id, owner_id, title, region, brief, approval_mode, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(id, user.id, title, region, JSON.stringify(brief), 'ask', living ? 'living' : 'active', t, t),
      DB.prepare("INSERT INTO members (search_id, user_id, role) VALUES (?,?,'owner')").bind(id, user.id),
      DB.prepare("INSERT INTO invites (code, kind, search_id, created_by, max_uses, created_at) VALUES (?, 'member', ?, ?, 50, ?)").bind(code, id, user.id, t),
    ]);
    const { assignAnimal } = await import('./members');
    await assignAnimal(env, id, user.id, region);
    await event(env, id, 'project_started', null, user.id, { name: user.display_name, mode: living ? 'living' : 'search', from: 'app' });
    if (wish) await event(env, id, 'instruction', null, user.id, { name: user.display_name, text: wish, kind: 'brief' });
    return json({ id, invite_link: env.BOT_USERNAME ? `https://t.me/${env.BOT_USERNAME}?start=${code}` : null }, 201);
  }

  // Free-form instruction for the agent ("running late" from the plan screen). The agent reads it in the digest.
  if (path === '/app/api/instruction' && req.method === 'POST') {
    const b = await body(req);
    await member(env, b.search_id, user.id, VOTERS);
    const text = String(b.text ?? '').trim().slice(0, 1000);
    if (!text) throw new HttpError(400, 'no_text');
    await event(env, b.search_id, 'instruction', b.ref ?? null, user.id, {
      name: user.display_name, text, kind: b.kind ?? null, minutes: Number(b.minutes) || null, date: b.date ?? null,
    });
    return json({ ok: true });
  }

  // Brief edit (owner): merges whitelisted keys, writes event brief_changed with a diff for the agent's digest.
  if (path === '/app/api/brief' && (req.method === 'PATCH' || req.method === 'POST')) {
    const b = await body(req);
    const r = await roleIn(env, b.search_id, user.id);
    if (r.role !== 'owner') throw new HttpError(403, 'owner_only');
    const row = await DB.prepare('SELECT brief FROM searches WHERE id=?').bind(b.search_id).first<{ brief: string }>();
    const brief = parseJson<any>(row?.brief, {});
    const patch = cleanBriefPatch(b.brief ?? {});
    const changes: { key: string; from: unknown; to: unknown }[] = [];
    for (const [k, v] of Object.entries(patch)) {
      const before = brief[k] ?? null;
      if (JSON.stringify(before) === JSON.stringify(v)) continue;
      changes.push({ key: k, from: before, to: v });
      if (v == null) delete brief[k];
      else brief[k] = v;
    }
    if (brief.budget_min != null && brief.budget_max != null && brief.budget_min > brief.budget_max) throw new HttpError(400, 'bad_budget', 'budget_min > budget_max');
    if (!changes.length) return json({ ok: true, changed: [] });
    await DB.prepare('UPDATE searches SET brief=?, updated_at=? WHERE id=?').bind(JSON.stringify(brief), now(), b.search_id).run();
    await event(env, b.search_id, 'brief_changed', b.search_id, user.id, { name: user.display_name, changes, summary: diffSummary(changes) });
    return json({ ok: true, changed: changes.map((c) => c.key), brief: publicBrief(r.region, JSON.stringify(brief), 'owner') });
  }

  // Deal checklist tick (members).
  if (path === '/app/api/deal-check' && req.method === 'POST') {
    const b = await body(req);
    const dl = await DB.prepare(`SELECT d.listing_id, d.search_id, d.data, m.role FROM deals d JOIN members m ON m.search_id=d.search_id AND m.user_id=? WHERE d.listing_id=?`)
      .bind(user.id, b.listing_id).first<any>();
    if (!dl) throw new HttpError(404, 'no_deal');
    if (!VOTERS.includes(dl.role)) throw new HttpError(403, 'viewer');
    const data = parseJson<any>(dl.data, {});
    const i = Number(b.index);
    if (!Array.isArray(data.checklist) || !Number.isInteger(i) || !data.checklist[i]) throw new HttpError(400, 'bad_index');
    const item = typeof data.checklist[i] === 'object' ? data.checklist[i] : { text: String(data.checklist[i]) };
    item.done = !!b.done;
    data.checklist[i] = item;
    await DB.prepare('UPDATE deals SET data=?, updated_at=? WHERE listing_id=?').bind(JSON.stringify(data), now(), dl.listing_id).run();
    await event(env, dl.search_id, 'checklist', dl.listing_id, user.id, { name: user.display_name, index: i, text: item.text ?? item.label ?? '', done: item.done });
    return json({ ok: true, done: item.done });
  }

  // Wave 8.1: the owner names the home ("Дом в Унгасане"): listings.short_name, shown in home-mode titles.
  if (path === '/app/api/home-name' && req.method === 'POST') {
    const b = await body(req);
    await member(env, String(b.search_id ?? ''), user.id, ['owner']);
    const l = await DB.prepare('SELECT id FROM listings WHERE id=? AND search_id=?').bind(String(b.listing_id ?? ''), String(b.search_id)).first<{ id: string }>();
    if (!l) throw new HttpError(404, 'no_listing');
    const name = cleanShortName(b.short_name);
    await DB.prepare('UPDATE listings SET short_name=?, updated_at=? WHERE id=?').bind(name, now(), l.id).run();
    return json({ ok: true, short_name: name });
  }

  if (path === '/app/api/term-check' && req.method === 'POST') {
    const b = await body(req);
    await member(env, String(b.search_id ?? ''), user.id, VOTERS);
    const item = await toggleTermCheck(env, String(b.search_id), Number(b.seq), Number(b.index), !!b.done);
    await event(env, String(b.search_id), 'checklist', `term:${Number(b.seq)}`, user.id, { name: user.display_name, index: Number(b.index), text: item.text ?? '', done: !!item.done, term_seq: Number(b.seq) });
    return json({ ok: true, done: !!item.done });
  }

  if (path === '/app/api/reroll-animal' && req.method === 'POST') {
    const b = await body(req);
    const r = await roleIn(env, b.search_id, user.id);
    const slug = await rerollAnimal(env, b.search_id, user.id, r.region);
    return json({ animal: animalInfo(r.region, slug) });
  }

  if (path === '/app/api/seen-reveal' && req.method === 'POST') {
    const b = await body(req);
    await roleIn(env, b.search_id, user.id);
    await DB.prepare('UPDATE members SET reveal_seen_at=coalesce(reveal_seen_at, ?) WHERE search_id=? AND user_id=?').bind(now(), b.search_id, user.id).run();
    return json({ ok: true });
  }

  // ---------------------------------------------------------------- wave 2
  // Shared money (members who can vote).
  if (path === '/app/api/expense' && req.method === 'POST') {
    const b = await body(req);
    await member(env, b.search_id, user.id, VOTERS);
    const s = await DB.prepare('SELECT id, brief FROM searches WHERE id=?').bind(b.search_id).first<any>();
    const expense = await insertExpense(env, s, { ...b, paid_by: b.paid_by ?? user.id }, user.id);
    return json({ ok: true, expense });
  }
  if (path === '/app/api/expense-delete' && req.method === 'POST') {
    const b = await body(req);
    const e = await DB.prepare(`SELECT e.*, m.role FROM expenses e JOIN members m ON m.search_id=e.search_id AND m.user_id=? WHERE e.id=?`).bind(user.id, b.id).first<any>();
    if (!e) throw new HttpError(404, 'no_expense');
    if (e.created_by !== user.id && e.paid_by !== user.id && e.role !== 'owner') throw new HttpError(403, 'not_yours');
    await DB.prepare('DELETE FROM expenses WHERE id=?').bind(e.id).run();
    if (e.receipt) await env.PHOTOS_KV.delete(e.receipt).catch(() => null);
    await event(env, e.search_id, 'expense_deleted', e.id, user.id, { name: user.display_name, title: e.title, amount: e.amount, currency: e.currency });
    return json({ ok: true });
  }
  if (path === '/app/api/expense-receipt' && req.method === 'POST') {
    const sid = new URL(req.url).searchParams.get('search_id') ?? '';
    await member(env, sid, user.id, VOTERS);
    const key = `r/${sid}/${user.id}-${Date.now().toString(36)}`;
    await rateLimit(env, 'upload', user.id, 60);
    await putImage(env, req, key);
    return json({ key });
  }
  if (path === '/app/api/settle' && req.method === 'POST') {
    const b = await body(req);
    const r = await member(env, b.search_id, user.id, VOTERS);
    const ids = ((await DB.prepare('SELECT user_id FROM members WHERE search_id=?').bind(b.search_id).all<any>()).results ?? []).map((x) => x.user_id);
    const amount = Math.round(Number(b.amount));
    if (!ids.includes(b.from) || !ids.includes(b.to) || b.from === b.to) throw new HttpError(400, 'bad_members');
    if (b.from !== user.id && b.to !== user.id && r.role !== 'owner') throw new HttpError(403, 'not_yours', 'Only the two people involved mark a settlement');
    if (!Number.isFinite(amount) || amount <= 0 || !b.currency) throw new HttpError(400, 'bad_amount');
    const id = `st_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await DB.prepare('INSERT INTO settlements (id, search_id, from_user, to_user, amount, currency, note, created_by, at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(id, b.search_id, b.from, b.to, amount, String(b.currency).slice(0, 8), b.note ? String(b.note).slice(0, 200) : null, user.id, now()).run();
    await event(env, b.search_id, 'settled', id, user.id, { name: user.display_name, from: b.from, to: b.to, amount, currency: b.currency });
    return json({ ok: true, money: await moneyView(env, b.search_id) });
  }
  if (path === '/app/api/shares' && req.method === 'POST') {
    const b = await body(req);
    await member(env, b.search_id, user.id, VOTERS);
    const ids = ((await DB.prepare('SELECT user_id FROM members WHERE search_id=?').bind(b.search_id).all<any>()).results ?? []).map((x) => x.user_id);
    const shares = cleanWeights(b.shares, ids);
    await DB.prepare('UPDATE searches SET shares=?, updated_at=? WHERE id=?').bind(JSON.stringify(shares), now(), b.search_id).run();
    await event(env, b.search_id, 'shares_changed', b.search_id, user.id, { name: user.display_name, shares });
    return json({ ok: true, money: await moneyView(env, b.search_id) });
  }

  // On-site checklist: one answer per item, member and viewing.
  if (path === '/app/api/onsite' && req.method === 'POST') {
    const b = await body(req);
    const l = await DB.prepare(`SELECT l.id, l.search_id, l.title FROM listings l JOIN members m ON m.search_id=l.search_id WHERE l.id=? AND m.user_id=? AND m.role IN ('owner','member')`).bind(b.listing_id, user.id).first<any>();
    if (!l) throw new HttpError(404, 'no_listing');
    const item = String(b.item ?? '');
    if (!/^[a-z0-9_]{1,40}$/.test(item)) throw new HttpError(400, 'bad_item');
    const ok = b.ok === true ? 1 : b.ok === false ? 0 : null;
    const note = b.note == null ? null : String(b.note).trim().slice(0, 200) || null;
    const vid = String(b.viewing_id ?? '');
    await DB.prepare(`INSERT INTO site_checks (listing_id, viewing_id, user_id, item, ok, note, at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(listing_id, viewing_id, user_id, item) DO UPDATE SET ok=excluded.ok, note=${'note' in b ? 'excluded.note' : 'note'}, at=excluded.at`)
      .bind(l.id, vid, user.id, item, ok, note, now()).run();
    return json({ ok: true });
  }
  if (path === '/app/api/onsite-photo' && req.method === 'POST') {
    const q = new URL(req.url).searchParams;
    const l = await DB.prepare(`SELECT l.id FROM listings l JOIN members m ON m.search_id=l.search_id WHERE l.id=? AND m.user_id=? AND m.role IN ('owner','member')`).bind(q.get('listing_id') ?? '', user.id).first<any>();
    if (!l) throw new HttpError(404, 'no_listing');
    const key = `o/${l.id}/${user.id}-${Date.now().toString(36)}`;
    await rateLimit(env, 'upload', user.id, 60);
    await putImage(env, req, key);
    await DB.prepare('INSERT INTO site_photos (key, listing_id, viewing_id, user_id, at) VALUES (?,?,?,?,?)').bind(key, l.id, q.get('viewing_id') ?? '', user.id, now()).run();
    const n = await DB.prepare('SELECT COUNT(*) n FROM site_photos WHERE listing_id=?').bind(l.id).first<{ n: number }>();
    return json({ key, count: n?.n ?? 1 });
  }

  // Life in the villa: "report a problem" = an issue + an instruction for the agent to tell the owner.
  if (path === '/app/api/issue' && req.method === 'POST') {
    const b = await body(req);
    const r = await member(env, b.search_id, user.id, ['owner', 'member', 'guest']);
    needArea(r, 'issues');
    const issue = await upsertIssue(env, { id: b.search_id }, null, { title: b.title, note: b.note ?? null, status: 'open' }, user.id);
    await event(env, b.search_id, 'instruction', issue.id, user.id, {
      name: user.display_name, kind: 'issue', ...(r.role === 'guest' ? { guest: true } : {}), text: `${issue.title}${b.note ? ` (${String(b.note).slice(0, 300)})` : ''}`,
    });
    return json({ ok: true, issue });
  }

  // Documents: open (short-lived link to the proxy), send to my DM, ask the agent to request one.
  if (path === '/app/api/doc-link' && req.method === 'POST') {
    const b = await body(req);
    const d = await DB.prepare("SELECT d.id, d.tg_file_id FROM documents d JOIN members m ON m.search_id=d.search_id AND m.user_id=? AND m.role IN ('owner','member') WHERE d.id=?").bind(user.id, b.id).first<any>();
    if (!d?.tg_file_id) throw new HttpError(404, 'no_file');
    return json({ url: `${env.PUBLIC_URL}/app/doc/${encodeURIComponent(d.id)}?t=${encodeURIComponent(await signDocToken(env, d.id, user.id))}` });
  }
  if (path === '/app/api/doc-send' && req.method === 'POST') {
    const b = await body(req);
    const d = await DB.prepare("SELECT d.* FROM documents d JOIN members m ON m.search_id=d.search_id AND m.user_id=? AND m.role IN ('owner','member') WHERE d.id=?").bind(user.id, b.id).first<any>();
    if (!d?.tg_file_id) throw new HttpError(404, 'no_file');
    if (!user.tg_user_id) throw new HttpError(409, 'no_tg_user', 'Open the bot and press Start first');
    await rateLimit(env, 'doc_send', user.id, 30);
    const method = d.file_kind === 'photo' ? 'sendPhoto' : d.file_kind === 'video' ? 'sendVideo' : 'sendDocument';
    const field = d.file_kind === 'photo' ? 'photo' : d.file_kind === 'video' ? 'video' : 'document';
    await tg(env, method, { chat_id: user.tg_user_id, [field]: d.tg_file_id, caption: d.title });
    return json({ ok: true });
  }
  if (path === '/app/api/doc-request' && req.method === 'POST') {
    const b = await body(req);
    await member(env, b.search_id, user.id, VOTERS);
    const deal = await DB.prepare('SELECT listing_id FROM deals WHERE search_id=? ORDER BY updated_at DESC LIMIT 1').bind(b.search_id).first<any>();
    const lid = b.listing_id ?? deal?.listing_id;
    if (!lid) throw new HttpError(404, 'no_deal');
    if (!(await DB.prepare('SELECT 1 FROM listings WHERE id=? AND search_id=?').bind(lid, b.search_id).first())) throw new HttpError(404, 'no_listing');
    const kind = (DOC_KINDS as readonly string[]).includes(b.kind) ? b.kind : 'other';
    const existing = b.id ? await DB.prepare('SELECT id, title FROM documents WHERE id=? AND search_id=?').bind(b.id, b.search_id).first<any>() : null;
    const title = existing?.title ?? (String(b.title ?? '').trim().slice(0, 160) || kind);
    if (existing) await DB.prepare("UPDATE documents SET status='request', updated_at=? WHERE id=?").bind(now(), existing.id).run();
    else await DB.prepare(`INSERT INTO documents (id, search_id, listing_id, kind, title, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?, 'request', ?,?,?)`)
      .bind(`doc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, b.search_id, lid, kind, title, user.id, now(), now()).run();
    await event(env, b.search_id, 'instruction', existing?.id ?? lid, user.id, { name: user.display_name, kind: 'doc_request', doc_kind: kind, text: `${user.lang === 'ru' ? 'Запроси документ' : 'Request the document'}: ${title}` });
    return json({ ok: true });
  }
  // Deal date done (e.g. the deposit came back): stops its reminders.
  if (path === '/app/api/deal-date' && req.method === 'POST') {
    const b = await body(req);
    const dl = await DB.prepare(`SELECT d.listing_id, d.search_id, d.data, m.role FROM deals d JOIN members m ON m.search_id=d.search_id AND m.user_id=? WHERE d.listing_id=?`).bind(user.id, b.listing_id).first<any>();
    if (!dl) throw new HttpError(404, 'no_deal');
    if (!VOTERS.includes(dl.role)) throw new HttpError(403, 'viewer');
    if (Number(b.term_seq) >= 2) {
      // Wave 6: a date of an extension term (deal_terms.dates).
      const x = await toggleTermDate(env, dl.search_id, Number(b.term_seq), Number(b.index), !!b.done);
      await event(env, dl.search_id, 'deal_date', dl.listing_id, user.id, { name: user.display_name, index: Number(b.index), term_seq: Number(b.term_seq), title: x.title, kind: x.kind, done: !!b.done });
      return json({ ok: true });
    }
    const data = parseJson<any>(dl.data, {});
    if (!Array.isArray(data.dates) || !data.dates.length) data.dates = dealDates(data).map(({ legacy, ...x }) => x);
    const i = Number(b.index);
    if (!Number.isInteger(i) || !data.dates[i]) throw new HttpError(400, 'bad_index');
    data.dates[i].done = !!b.done;
    await DB.prepare('UPDATE deals SET data=?, updated_at=? WHERE listing_id=?').bind(JSON.stringify(data), now(), dl.listing_id).run();
    await event(env, dl.search_id, 'deal_date', dl.listing_id, user.id, { name: user.display_name, index: i, title: data.dates[i].title, kind: data.dates[i].kind, done: !!b.done });
    return json({ ok: true });
  }
  // My notification switches for this search: bot DMs and the morning digest.
  if (path === '/app/api/prefs' && req.method === 'POST') {
    const b = await body(req);
    await roleIn(env, b.search_id, user.id);
    if (typeof b.notify === 'boolean') await DB.prepare('UPDATE members SET notify=? WHERE search_id=? AND user_id=?').bind(b.notify ? 1 : 0, b.search_id, user.id).run();
    if (typeof b.digest === 'boolean') await DB.prepare('UPDATE members SET digest=? WHERE search_id=? AND user_id=?').bind(b.digest ? 1 : 0, b.search_id, user.id).run();
    if ('surf' in b && (typeof b.surf === 'boolean' || b.surf === null)) await DB.prepare('UPDATE members SET surf=? WHERE search_id=? AND user_id=?').bind(b.surf == null ? null : b.surf ? 1 : 0, b.search_id, user.id).run();
    return json({ ok: true });
  }

  // ---------------------------------------------------------------- wave 3
  // Money mode: 'split' (balances, settle up) or 'shared' (one wallet, totals only). Owner.
  if (path === '/app/api/money-mode' && req.method === 'POST') {
    const b = await body(req);
    const r = await roleIn(env, b.search_id, user.id);
    if (r.role !== 'owner') throw new HttpError(403, 'owner_only');
    if (!(MONEY_MODES as readonly string[]).includes(b.mode)) throw new HttpError(400, 'bad_money_mode');
    await DB.prepare('UPDATE searches SET money_mode=?, updated_at=? WHERE id=?').bind(b.mode, now(), b.search_id).run();
    await event(env, b.search_id, 'money_mode', b.search_id, user.id, { name: user.display_name, mode: b.mode });
    return json({ ok: true, money: await moneyView(env, b.search_id) });
  }
  // Rent split by rooms (members who can vote).
  if (path === '/app/api/rooms' && req.method === 'POST') {
    const b = await body(req);
    await member(env, b.search_id, user.id, VOTERS);
    const ids = ((await DB.prepare('SELECT user_id FROM members WHERE search_id=?').bind(b.search_id).all<any>()).results ?? []).map((x) => x.user_id);
    const rooms = cleanRooms(b.rooms, ids);
    await DB.prepare('UPDATE searches SET rooms=?, updated_at=? WHERE id=?').bind(rooms ? JSON.stringify(rooms) : null, now(), b.search_id).run();
    await event(env, b.search_id, 'shares_changed', b.search_id, user.id, { name: user.display_name, rooms });
    return json({ ok: true, rooms, money: await moneyView(env, b.search_id) });
  }
  // Meter photo: stored in KV, waits for the agent to read the balance (instruction meter_photo).
  if (path === '/app/api/meter-photo' && req.method === 'POST') {
    const sid = new URL(req.url).searchParams.get('search_id') ?? '';
    await member(env, sid, user.id, VOTERS);
    const key = `m/${sid}/${user.id}-${Date.now().toString(36)}`;
    await rateLimit(env, 'upload', user.id, 60);
    await putImage(env, req, key);
    const id = `mr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await DB.prepare("INSERT INTO meter_readings (id, search_id, kind, photo, at, created_by, created_at) VALUES (?,?, 'photo', ?,?,?,?)").bind(id, sid, key, now(), user.id, now()).run();
    await event(env, sid, 'instruction', id, user.id, { name: user.display_name, kind: 'meter_photo', photo: key, text: user.lang === 'ru' ? 'Фото счётчика: прочитай остаток кВт·ч' : 'Meter photo: read the kWh balance' });
    return json({ ok: true, key, power: await searchPower(env, sid) });
  }
  // My visa expiry date (a date only, never a number); visible to me and the search owner.
  if (path === '/app/api/visa' && req.method === 'POST') {
    const b = await body(req);
    await roleIn(env, b.search_id, user.id);
    const until = b.until == null || b.until === '' ? null : String(b.until);
    if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new HttpError(400, 'bad_date', 'until must be YYYY-MM-DD');
    await DB.prepare('UPDATE members SET visa_until=? WHERE search_id=? AND user_id=?').bind(until, b.search_id, user.id).run();
    return json({ ok: true, visa_until: until });
  }
  // A person (owner / agent): notes from the hunter's projects and stats. Only for contacts of my searches.
  if (path === '/app/api/contact' && req.method === 'GET') {
    const q = new URL(req.url).searchParams;
    const cid = q.get('id') ?? '';
    const ok = await DB.prepare(`SELECT 1 FROM members m WHERE m.user_id=?1 AND m.role IN ('owner','member') AND m.search_id IN (
        SELECT l.search_id FROM listing_contacts lc JOIN listings l ON l.id=lc.listing_id WHERE lc.contact_id=?2
        UNION SELECT search_id FROM threads WHERE contact_id=?2 UNION SELECT search_id FROM house_contacts WHERE contact_id=?2
        UNION SELECT search_id FROM messages WHERE contact_id=?2 AND search_id IS NOT NULL) LIMIT 1`).bind(user.id, cid).first();
    if (!ok) throw new HttpError(404, 'no_contact');
    const [c, chs] = await DB.batch<any>([
      DB.prepare('SELECT id, name, role, lang FROM contacts WHERE id=?').bind(cid),
      DB.prepare('SELECT channel, address, display FROM contact_channels WHERE contact_id=?').bind(cid),
    ]);
    // Notes of the hunter whose contact it is; projects I am not in stay anonymous (no title).
    const own = await DB.prepare(`SELECT COALESCE(c.owner_id, (SELECT s.owner_id FROM searches s JOIN members m ON m.search_id=s.id AND m.user_id=?2 WHERE s.id=?3)) o FROM contacts c WHERE c.id=?1`)
      .bind(cid, user.id, q.get('s') ?? '').first<{ o: string | null }>();
    const pn = await contactNotes(env, cid, own?.o ?? '', q.get('s'));
    const mine = new Set(((await DB.prepare('SELECT search_id FROM members WHERE user_id=?').bind(user.id).all<any>()).results ?? []).map((r) => r.search_id));
    const notes = pn.notes.map((n: any) => (n.search_id && !mine.has(n.search_id) ? { ...n, search_id: null, search_title: null, elsewhere: true } : n));
    return json({ contact: c.results?.[0] ?? null, channels: chs.results ?? [], notes, stats: pn.stats });
  }
  if (path === '/app/api/note' && req.method === 'POST') {
    const b = await body(req);
    const r = await member(env, b.search_id, user.id, VOTERS);
    await requireContact(env, await ownerOfSearch(env, b.search_id), b.contact_id);
    const note = await addNote(env, { contact_id: b.contact_id, search_id: b.search_id, text: b.text, sentiment: b.sentiment }, user.id);
    return json({ ok: true, note: { ...note, author_name: user.display_name, search_title: r.title, at: note.created_at } });
  }
  // A member marks a move-out step done (the agent sees an event).
  if (path === '/app/api/moveout-step' && req.method === 'POST') {
    const b = await body(req);
    await member(env, b.search_id, user.id, VOTERS);
    if (!(MOVEOUT_STEPS as readonly string[]).includes(b.key) || !['done', 'todo'].includes(b.status)) throw new HttpError(400, 'bad_step');
    const row = await DB.prepare('SELECT steps FROM moveouts WHERE search_id=?').bind(b.search_id).first<{ steps: string }>();
    if (!row) throw new HttpError(404, 'no_moveout');
    const steps = parseJson<any>(row.steps, {});
    steps[b.key] = { ...(steps[b.key] ?? {}), status: b.status };
    await DB.prepare('UPDATE moveouts SET steps=?, updated_at=? WHERE search_id=?').bind(JSON.stringify(steps), now(), b.search_id).run();
    await event(env, b.search_id, 'moveout', b.search_id, user.id, { name: user.display_name, step: b.key, status: b.status });
    return json({ ok: true, moveout: await moveoutView(env, b.search_id) });
  }
  // Places near: add / remove a brief anchor (members who can vote); the agent recomputes travel times.
  if (path === '/app/api/anchor' && req.method === 'POST') {
    const b = await body(req);
    await member(env, b.search_id, user.id, VOTERS);
    const row = await DB.prepare('SELECT brief FROM searches WHERE id=?').bind(b.search_id).first<{ brief: string }>();
    const brief = parseJson<any>(row?.brief, {});
    const list: any[] = Array.isArray(brief.anchors) ? brief.anchors : [];
    let change: any;
    if (b.remove) {
      const gone = list.find((a) => a.id === b.remove);
      if (!gone) throw new HttpError(404, 'no_anchor');
      brief.anchors = list.filter((a) => a.id !== b.remove);
      change = { key: 'anchors', from: gone.name, to: null };
    } else {
      if (list.length >= 12) throw new HttpError(400, 'too_many', 'up to 12 places');
      const a = cleanAnchor(b.anchor, user.id);
      const s = sensitive(JSON.stringify(a));
      if (s) throw new HttpError(400, 'sensitive');
      brief.anchors = [...list.filter((x) => x.id !== a.id), a];
      change = { key: 'anchors', from: null, to: `${a.name} (${a.type}${a.max_minutes ? `, ≤${a.max_minutes} min` : ''})` };
    }
    await DB.prepare('UPDATE searches SET brief=?, updated_at=? WHERE id=?').bind(JSON.stringify(brief), now(), b.search_id).run();
    await event(env, b.search_id, 'brief_changed', b.search_id, user.id, { name: user.display_name, changes: [change], summary: `anchors: ${change.to ? '+' + change.to : '−' + change.from}` });
    await recomputeRings(env, b.search_id);
    return json({ ok: true, anchors: brief.anchors });
  }
  // Contacts directory: add / edit an entry, add a group, delete an entry (members who can vote).
  if (path === '/app/api/dir-entry' && req.method === 'POST') {
    const b = await body(req);
    await member(env, b.search_id, user.id, VOTERS);
    const s = await DB.prepare('SELECT id, dir_groups FROM searches WHERE id=?').bind(b.search_id).first<any>();
    const entry = await setDirEntry(env, s, b.id ?? 'new', b, user.id);
    return json({ ok: true, entry });
  }
  if (path === '/app/api/dir-group' && req.method === 'POST') {
    const b = await body(req);
    await member(env, b.search_id, user.id, VOTERS);
    return json({ ok: true, groups: await addDirGroup(env, b.search_id, b.name) });
  }
  if (path === '/app/api/dir-delete' && req.method === 'POST') {
    const b = await body(req);
    const e = await DB.prepare('SELECT d.id, d.search_id, d.created_by, m.role FROM directory d JOIN members m ON m.search_id=d.search_id AND m.user_id=? WHERE d.id=?').bind(user.id, b.id).first<any>();
    if (!e) throw new HttpError(404, 'no_entry');
    if (!VOTERS.includes(e.role)) throw new HttpError(403, 'viewer');
    await DB.prepare('DELETE FROM directory WHERE id=?').bind(e.id).run();
    return json({ ok: true });
  }

  // ---------------------------------------------------------------- wave 4
  // Location of a listing: score breakdown, isochrone polygons, places in the rings (screen 31, 31b).
  if (path === '/app/api/location' && req.method === 'GET') {
    const lid = new URL(req.url).searchParams.get('id') ?? '';
    const l = await DB.prepare('SELECT l.* FROM listings l JOIN members m ON m.search_id=l.search_id WHERE l.id=? AND m.user_id=?').bind(lid, user.id).first<any>();
    if (!l) throw new HttpError(404, 'no_listing');
    return json(await locationView(env, l, true));
  }
  // A member edits an own place: type, tier, hidden.
  if (path === '/app/api/place' && req.method === 'POST') {
    const b = await body(req);
    const pl = await DB.prepare(`SELECT p.*, s.region, m.role FROM places p JOIN searches s ON s.id=p.search_id JOIN members m ON m.search_id=p.search_id AND m.user_id=? WHERE p.id=?`).bind(user.id, b.id).first<any>();
    if (!pl) throw new HttpError(404, 'no_place');
    if (!VOTERS.includes(pl.role)) throw new HttpError(403, 'viewer');
    const patch: any = {};
    for (const k of ['type', 'tier', 'hidden']) if (k in b) patch[k] = b[k];
    return json({ ok: true, place: await patchPlace(env, pl, patch, pl.region) });
  }
  // "Add from Google Maps": the link goes to the agent (places_import).
  if (path === '/app/api/places-link' && req.method === 'POST') {
    const b = await body(req);
    await member(env, b.search_id, user.id, VOTERS);
    const url = String(b.url ?? '').trim();
    if (!/^https:\/\/(maps\.app\.goo\.gl\/[\w-]+|goo\.gl\/maps\/[\w-]+|(www\.)?google\.(com|[a-z]{2,3}|com?\.[a-z]{2})\/maps(\/[^\s<>"']*)?)(\?[^\s<>"']*)?$/i.test(url) || url.length > 2000)
      throw new HttpError(400, 'bad_url', 'A Google Maps link (maps.app.goo.gl/… or google.com/maps/…)');
    await event(env, b.search_id, 'instruction', null, user.id, { name: user.display_name, kind: 'places_import', text: url });
    return json({ ok: true });
  }
  // Bikes: add / edit (members), a rental payment (→ an expense), a pickup checklist tick.
  if (path === '/app/api/bike' && req.method === 'POST') {
    const b = await body(req);
    await member(env, b.search_id, user.id, VOTERS);
    const { id, search_id, ...rest } = b;
    return json({ ok: true, ...(await setBike(env, { id: search_id }, id ?? 'new', rest, user.id)) });
  }
  if (path === '/app/api/bike-pay' && req.method === 'POST') {
    const b = await body(req);
    const bk = await DB.prepare(`SELECT b.*, m.role FROM bikes b JOIN members m ON m.search_id=b.search_id AND m.user_id=? WHERE b.id=?`).bind(user.id, b.id).first<any>();
    if (!bk) throw new HttpError(404, 'no_bike');
    if (!VOTERS.includes(bk.role)) throw new HttpError(403, 'viewer');
    const r = await payBike(env, bk, { amount: b.amount, until: b.until, paid_by: b.paid_by ?? user.id, date: b.date }, user.id);
    return json({ ok: true, ...r, money: await moneyView(env, bk.search_id) });
  }
  if (path === '/app/api/bike-check' && req.method === 'POST') {
    const b = await body(req);
    const bk = await DB.prepare(`SELECT b.search_id, m.role FROM bikes b JOIN members m ON m.search_id=b.search_id AND m.user_id=? WHERE b.id=?`).bind(user.id, b.id).first<any>();
    if (!bk) throw new HttpError(404, 'no_bike');
    if (!VOTERS.includes(bk.role)) throw new HttpError(403, 'viewer');
    return json({ ok: true, ...(await setBike(env, { id: bk.search_id }, b.id, { checklist: { [String(b.key)]: { done: !!b.done } } }, user.id)) });
  }
  // 3D act: ask the agent to send it to the owners (outreach with approval).
  if (path === '/app/api/scan-send' && req.method === 'POST') {
    const b = await body(req);
    await member(env, b.search_id, user.id, VOTERS);
    await event(env, b.search_id, 'instruction', null, user.id, { name: user.display_name, kind: 'scan_send', text: user.lang === 'ru' ? 'Отправь 3D-акт заезда хозяевам (ссылки на сканы), через черновик на одобрение' : 'Send the 3D move-in act to the owners (scan links), as a draft for approval' });
    return json({ ok: true });
  }
  // House dossier for a listing of one of my searches.
  if (path === '/app/api/dossier' && req.method === 'GET') {
    const lid = new URL(req.url).searchParams.get('listing_id') ?? '';
    const l = await DB.prepare('SELECT l.* FROM listings l JOIN members m ON m.search_id=l.search_id WHERE l.id=? AND m.user_id=?').bind(lid, user.id).first<any>();
    if (!l) throw new HttpError(404, 'no_listing');
    return json({ dossiers: await matchDossiers(env, l) });
  }
  // Things bought with the villa.
  if (path === '/app/api/item' && req.method === 'POST') {
    const b = await body(req);
    await member(env, b.search_id, user.id, VOTERS);
    const { id, search_id, ...rest } = b;
    const item = await setItem(env, { id: search_id }, id ?? 'new', rest, user.id);
    return json({ ok: true, item, items: await itemsView(env, search_id) });
  }
  if (path === '/app/api/item-delete' && req.method === 'POST') {
    const b = await body(req);
    const it = await DB.prepare('SELECT i.id, i.search_id, i.photo, m.role FROM items i JOIN members m ON m.search_id=i.search_id AND m.user_id=? WHERE i.id=?').bind(user.id, b.id).first<any>();
    if (!it) throw new HttpError(404, 'no_item');
    if (!VOTERS.includes(it.role)) throw new HttpError(403, 'viewer');
    await DB.prepare('DELETE FROM items WHERE id=?').bind(it.id).run();
    if (it.photo) await env.PHOTOS_KV.delete(it.photo).catch(() => null);
    return json({ ok: true, items: await itemsView(env, it.search_id) });
  }
  if (path === '/app/api/item-photo' && req.method === 'POST') {
    const sid = new URL(req.url).searchParams.get('search_id') ?? '';
    await member(env, sid, user.id, VOTERS);
    const key = `i/${sid}/${user.id}-${Date.now().toString(36)}`;
    await rateLimit(env, 'upload', user.id, 60);
    await putImage(env, req, key);
    return json({ key });
  }
  // A member's flood note on a listing ("after the rain the lane is ankle-deep").
  if (path === '/app/api/flood-note' && req.method === 'POST') {
    const b = await body(req);
    const l = await DB.prepare(`SELECT l.*, m.role FROM listings l JOIN members m ON m.search_id=l.search_id WHERE l.id=? AND m.user_id=?`).bind(b.listing_id, user.id).first<any>();
    if (!l) throw new HttpError(404, 'no_listing');
    if (!VOTERS.includes(l.role)) throw new HttpError(403, 'viewer');
    return json({ ok: true, flood: await addFloodNote(env, l, user, b.text) });
  }

  // ---------------------------------------------------------------- wave 5
  if (path === '/app/api/surf' && req.method === 'GET') {
    const sid = new URL(req.url).searchParams.get('search_id') ?? '';
    const a = await member(env, sid, user.id, ['owner', 'member', 'viewer', 'guest']);
    needArea(a, 'places');
    return json(await surfView(env, { id: sid, region: a.region, brief: a.brief }, { fetch: true, lang: user.lang }));
  }
  if (path === '/app/api/guide' && req.method === 'GET') {
    const sid = new URL(req.url).searchParams.get('search_id') ?? '';
    const a = await member(env, sid, user.id, ['owner', 'member', 'viewer', 'guest']);
    needArea(a, 'guide');
    const full = a.role === 'owner' || a.role === 'member';
    return json({ guide: await guideView(env, { id: sid, region: a.region, brief: a.brief }, { withSecret: full || a.role === 'guest', withUrl: full, lang: user.lang }) });
  }
  if (path === '/app/api/guide' && req.method === 'POST') {
    const b = await body(req);
    const a = await member(env, b.search_id, user.id, ['owner', 'member']);
    const { search_id, ...rest } = b;
    await setGuide(env, search_id, rest, user.id);
    return json({ guide: await guideView(env, { id: search_id, region: a.region, brief: a.brief }, { withSecret: true, withUrl: true, lang: user.lang }) });
  }
  if (path === '/app/api/guide-link' && req.method === 'POST') {
    const b = await body(req);
    await member(env, b.search_id, user.id, ['owner', 'member']);
    return json({ url: await guideLink(env, b.search_id, String(b.action ?? ''), user.id) });
  }
  if (path === '/app/api/next-vote' && req.method === 'POST') {
    const b = await body(req);
    await member(env, b.search_id, user.id, ['owner', 'member']);
    return json({ renewal: await voteNext(env, b.search_id, user, String(b.choice ?? '')) });
  }
  if (path === '/app/api/negotiation' && req.method === 'GET') {
    const lid = new URL(req.url).searchParams.get('listing_id') ?? '';
    const l = await DB.prepare('SELECT * FROM listings WHERE id=?').bind(lid).first<any>();
    if (!l) throw new HttpError(404, 'no_listing');
    await member(env, l.search_id, user.id, ['owner']);
    return json(await negotiationView(env, l));
  }
  if (path === '/app/api/recap' && req.method === 'GET') {
    const sid = new URL(req.url).searchParams.get('search_id') ?? '';
    const a = await member(env, sid, user.id, ['owner', 'member', 'viewer']);
    return json(await recapView(env, sid, a.role, user.lang));
  }
  // The recap card is drawn on a canvas in the Mini App; the PNG is relayed to my bot DM to forward (nothing is stored).
  if (path === '/app/api/recap-share' && req.method === 'POST') {
    const sid = new URL(req.url).searchParams.get('search_id') ?? '';
    await member(env, sid, user.id, ['owner', 'member', 'viewer']);
    if (!user.tg_user_id) throw new HttpError(409, 'no_tg_user', 'Open the bot and press Start first');
    if ((req.headers.get('content-type') ?? '').split(';')[0].trim() !== 'image/png') throw new HttpError(400, 'not_png');
    await rateLimit(env, 'recap_share', user.id, 10);
    const buf = await req.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > 5 * 1024 * 1024) throw new HttpError(413, 'too_big', 'PNG up to 5 MB');
    const fd = new FormData();
    fd.set('chat_id', String(user.tg_user_id));
    fd.set('photo', new Blob([buf], { type: 'image/png' }), 'hunt-recap.png');
    fd.set('caption', user.lang === 'ru' ? 'Итоги поиска — перешли друзьям' : 'Search recap — forward it to friends');
    await tg(env, 'sendPhoto', fd);
    return json({ ok: true });
  }
  if (path === '/app/api/guests' && req.method === 'GET') {
    const sid = new URL(req.url).searchParams.get('search_id') ?? '';
    const a = await member(env, sid, user.id, ['owner', 'member']);
    return json({ guests: await guestsView(env, sid, a.region) });
  }
  if (path === '/app/api/guest-invite' && req.method === 'POST') {
    const b = await body(req);
    const a = await member(env, b.search_id, user.id, ['owner', 'member']);
    return json(await createGuestInvite(env, a, b.search_id, user.id, b));
  }
  if (path === '/app/api/guest' && req.method === 'POST') {
    const b = await body(req);
    const a = await member(env, b.search_id, user.id, ['owner', 'member']);
    await setGuest(env, b.search_id, b, user.id);
    return json({ ok: true, guests: await guestsView(env, b.search_id, a.region) });
  }
  if (path === '/app/api/guest-message' && req.method === 'POST') {
    const b = await body(req);
    const a = await member(env, b.search_id, user.id, ['guest']);
    needArea(a, 'contacts');
    return json({ ok: true, draft_id: await guestMessage(env, b.search_id, user, b) });
  }

  // Revocation (M5): every web link and photo token of mine stops working (Telegram keeps working).
  if (path === '/app/api/revoke-links' && req.method === 'POST') {
    await DB.prepare('UPDATE users SET link_gen=link_gen+1 WHERE id=?').bind(user.id).run();
    return json({ ok: true });
  }
  // "Подключить агента": the owner issues a new agent token for their plugin. Only the person's earlier agent tokens die (the
  // bot's /revoke also kills web links and sessions). The token is in this answer only: the server keeps its sha256.
  if (path === '/app/api/agent-token' && req.method === 'POST') {
    if (user.scope) throw new HttpError(403, 'link_scope');
    const b = await body(req);
    await member(env, b.search_id, user.id, ['owner']);
    if (!(await DB.prepare('SELECT 1 FROM hunters WHERE user_id=?').bind(user.id).first())) throw new HttpError(403, 'not_hunter', 'Only a hunter has an agent');
    await rateLimit(env, 'agent_token', user.id, 6);
    const r = await issueToken(env, user.id, 'app', true);
    await event(env, b.search_id, 'agent_token', null, user.id, { name: user.display_name, revoked: r.revoked });
    const res = json({ ok: true, token: r.token, api_url: env.PUBLIC_URL, revoked: r.revoked });
    res.headers.set('cache-control', 'no-store');
    return res;
  }
  // The owner removes a member (their votes stop counting, links minted for them die with the role).
  if (path === '/app/api/member-remove' && req.method === 'POST') {
    const b = await body(req);
    await member(env, b.search_id, user.id, ['owner']);
    const target = await DB.prepare('SELECT m.role, u.display_name FROM members m JOIN users u ON u.id=m.user_id WHERE m.search_id=? AND m.user_id=?').bind(b.search_id, String(b.user_id ?? '')).first<any>();
    if (!target) throw new HttpError(404, 'no_member');
    if (target.role === 'owner') throw new HttpError(400, 'owner', 'The owner cannot be removed');
    await DB.batch([
      DB.prepare('DELETE FROM members WHERE search_id=? AND user_id=?').bind(b.search_id, b.user_id),
      // The old member invite is known to the removed person: retire it and issue a fresh one.
      DB.prepare("UPDATE invites SET max_uses=uses WHERE search_id=? AND kind='member'").bind(b.search_id),
      DB.prepare("INSERT INTO invites (code, kind, search_id, created_by, max_uses, created_at) VALUES (?, 'member', ?, ?, 50, ?)").bind(rid(''), b.search_id, user.id, now()),
    ]);
    await event(env, b.search_id, 'member_removed', b.user_id, user.id, { name: user.display_name, removed: target.display_name });
    return json({ ok: true });
  }

  // Wave 6: the owner changes the project stage ('auto' clears the override and reopens a closed project).
  if (path === '/app/api/stage' && req.method === 'POST') return appStage(req, env, user);

  if (path === '/app/api/lang' && req.method === 'POST') {
    const b = await body(req);
    if (!['en', 'ru'].includes(b.lang)) throw new HttpError(400, 'bad_lang');
    await DB.prepare('UPDATE users SET lang=? WHERE id=?').bind(b.lang, user.id).run();
    return json({ ok: true, lang: b.lang });
  }

  throw new HttpError(404, 'not_found');
}

async function genOf(env: Env, uid: string): Promise<number | null> {
  const u = await env.DB.prepare('SELECT link_gen FROM users WHERE id=?').bind(uid).first<{ link_gen: number }>();
  return u ? Number(u.link_gen) : null;
}

/**
 * May `uid` read this KV key? The search comes from the key: p/ a/ (listing album), v/ (rating voice), o/ (on-site photo) by
 * listing; r/ (receipt), m/ (meter photo), i/ (item photo) by search. Guests see only the home's album.
 */
async function mediaAllowed(env: Env, uid: string, key: string, scopeSid: string | null = null): Promise<boolean> {
  const lm = key.match(/^(p|a|v|o)\/([^/]+)\//);
  const sm = key.match(/^(r|m|i)\/([^/]+)\//);
  const em = key.match(/^e\/([^/]+)\//);
  const ym = key.match(/^y\/([^/]+)\//);
  if (ym) {
    // Wave 9: a party cover or photo: members (and viewers) of the party's search.
    const r = await env.DB.prepare(`SELECT p.search_id, m.role FROM parties p JOIN members m ON m.search_id=p.search_id AND m.user_id=? WHERE p.id=?`).bind(uid, ym[1]).first<{ search_id: string; role: string }>();
    return !!r && (!scopeSid || r.search_id === scopeSid) && ['owner', 'member', 'viewer'].includes(r.role);
  }
  if (em) {
    // An Афиша photo: the event is region-wide, so any member, viewer or active guest of a search in that country sees it
    // (a scoped link: only through its own search). The key must be the event's current photo.
    const ev = await env.DB.prepare('SELECT country, photo_url FROM afisha WHERE id=?').bind(em[1]).first<{ country: string; photo_url: string | null }>();
    if (!ev || ev.photo_url !== 'kv:' + key) return false;
    const rows = (await env.DB.prepare(`SELECT s.id, s.region FROM searches s WHERE s.id IN (SELECT search_id FROM members WHERE user_id=?1 AND role IN ('owner','member','viewer'))
        OR s.id IN (SELECT search_id FROM guests WHERE user_id=?1 AND status='active')`).bind(uid).all<{ id: string; region: string }>()).results ?? [];
    return rows.some((r) => (!scopeSid || r.id === scopeSid) && countryOf(r.region) === ev.country);
  }
  if (lm) {
    const r = await env.DB.prepare(`SELECT l.search_id, m.role, (SELECT 1 FROM guests g JOIN deals d ON d.search_id=g.search_id AND d.listing_id=l.id
        WHERE g.search_id=l.search_id AND g.user_id=?1 AND g.status='active') guest_home
      FROM listings l LEFT JOIN members m ON m.search_id=l.search_id AND m.user_id=?1 WHERE l.id=?2`).bind(uid, lm[2]).first<{ search_id: string; role: string | null; guest_home: number | null }>();
    if (!r || (scopeSid && r.search_id !== scopeSid)) return false;
    if (r.role && ['owner', 'member', 'viewer'].includes(r.role)) return true;
    return (lm[1] === 'p' || lm[1] === 'a') && !!r.guest_home;
  }
  if (sm) {
    if (scopeSid && sm[2] !== scopeSid) return false;
    const r = await env.DB.prepare('SELECT role FROM members WHERE search_id=? AND user_id=?').bind(sm[2], uid).first<{ role: string }>();
    return !!r && (sm[1] === 'i' ? ['owner', 'member', 'viewer'] : ['owner', 'member']).includes(r.role);
  }
  return false;
}

// Routes whose body/query `id` names a row of this table (the scope check resolves its search).
const SCOPE_ID_TABLE: Record<string, string> = {
  '/app/api/expense-delete': 'expenses', '/app/api/doc-link': 'documents', '/app/api/doc-send': 'documents', '/app/api/dir-delete': 'directory',
  '/app/api/place': 'places', '/app/api/bike-pay': 'bikes', '/app/api/bike-check': 'bikes', '/app/api/item-delete': 'items',
  '/app/api/listing': 'listings', '/app/api/location': 'listings',
};

/**
 * A scoped web link (minted by an owner for one member) may only touch its own search: every search, listing or row id the
 * request names must belong to `sid`, and a request that names none is refused (deny by default).
 */
async function checkScope(req: Request, env: Env, path: string, sid: string): Promise<void> {
  if (path === '/app/api/state' || path === '/app/api/lang' || path === '/app/api/revoke-links') return; // state is narrowed to `sid` itself
  const q = new URL(req.url).searchParams;
  let b: any = {};
  if (req.method !== 'GET' && (req.headers.get('content-type') ?? '').includes('application/json')) b = await req.clone().json().catch(() => ({}));
  const found: string[] = [];
  for (const v of [q.get('s'), q.get('search_id'), b?.search_id]) if (v) found.push(String(v));
  const lids = [q.get('listing_id'), q.get('l'), b?.listing_id].filter(Boolean).map(String);
  const DB = env.DB;
  for (const lid of lids) found.push((await DB.prepare('SELECT search_id FROM listings WHERE id=?').bind(lid).first<any>())?.search_id ?? '?');
  const table = SCOPE_ID_TABLE[path];
  const id = table ? q.get('id') ?? b?.id : null;
  if (table && id) found.push((await DB.prepare(`SELECT search_id FROM ${table} WHERE id=?`).bind(String(id)).first<any>())?.search_id ?? '?');
  if (path === '/app/api/draft' && b?.draft_id) found.push((await DB.prepare('SELECT search_id FROM drafts WHERE id=?').bind(String(b.draft_id)).first<any>())?.search_id ?? '?');
  if (path === '/app/api/contact') {
    const ok = await DB.prepare(`SELECT 1 FROM (SELECT l.search_id FROM listing_contacts lc JOIN listings l ON l.id=lc.listing_id WHERE lc.contact_id=?1
        UNION SELECT search_id FROM threads WHERE contact_id=?1 UNION SELECT search_id FROM house_contacts WHERE contact_id=?1) WHERE search_id=?2`).bind(q.get('id') ?? '', sid).first();
    found.push(ok ? sid : '?');
  }
  if (!found.length || found.some((x) => x !== sid)) throw new HttpError(403, 'link_scope', 'This link opens only one search');
}

/** Document link token: 15 minutes, bound to the document and the user. */
async function signDocToken(env: Env, docId: string, userId: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + 15 * 60;
  const sig = hex(await hmac(env.LINK_SECRET, `doc|${docId}|${userId}|${exp}`)).slice(0, 32);
  return `${userId}.${exp}.${sig}`;
}
async function verifyDocToken(env: Env, docId: string, tok: string): Promise<string> {
  const [uid, exp, sig] = tok.split('.');
  if (!uid || !exp || !sig) throw new HttpError(401, 'bad_link');
  const good = hex(await hmac(env.LINK_SECRET, `doc|${docId}|${uid}|${exp}`)).slice(0, 32);
  if (!safeEqual(good, sig)) throw new HttpError(401, 'bad_link');
  if (Number(exp) < Date.now() / 1000) throw new HttpError(401, 'link_expired');
  return uid;
}
