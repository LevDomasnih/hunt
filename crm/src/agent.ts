import { Env, HttpError, json, body, now, rid, sha256hex, inflate, LISTING_JSON, event, parseJson, sensitive, safeEqual, httpUrl, redactSensitive, guardBody } from './util';
import { publishListing, postDayPlan, notify } from './bot';
import { draftToOwner, notifyIncoming } from './notify';
import { routeLink } from './cards';
import { assignAnimal } from './members';
import { searchRatings, searchInterest } from './scores';
import { moneyView, cleanWeights, EXPENSE_KINDS, PAY_METHODS } from './money';
import { cleanChecks, cleanDates, cleanSummary, docView, dealDates, DOC_KINDS, DOC_STATUS } from './deal';
import { tg, tgFileStream } from './tg';
import { cleanRooms, MONEY_MODES } from './money';
import { contactNotes, addNote, searchPower, addReading, setMoveout, moveoutView, setRelet, setLead, reletView, setDirEntry, addDirGroup, cleanTravel } from './life';
import {
  upsertPlaces, patchPlace, basePlaces, setIsochrones, locationView, locationScores, setFlood, setBike, payBike, bikeView, setScan, scansOf,
  setDossier, addDossierItem, dossierView, matchDossiers, setItem, itemsView, ringSet, sameRings,
} from './wave4';
import { countryOf, publicBrief } from './members';
import { mediaHeaders } from './media';
import { surfView, guideView, setGuide, renewalView, ensureRenewal, cloneSearch, negotiationView, setDealPrices, autoDealPrices, notePrice, recapView, guestsView, homeListing } from './wave5';
import { usefulAgent } from './useful';
import { afishaAgent, bookingDraftSent } from './afisha';
import { partyAgent } from './party';
import { ordersAgent, orderDraft } from './orders';
import { sourcesAgent } from './sources';
import { sharesAgent } from './shares';
import { seal, sealOn, openRows, openDraft, MSG, DRAFT, THREAD } from './vault';
import { seen, sendViaBusiness } from './access';
import { altListingId, contactByAddress, isOwnContact, mineSql, requireContact } from './household';

interface Ctx {
  env: Env;
  user: { id: string; display_name: string; lang: string; tg_user_id: number | null };
}

const ROUTINE = new Set(['schedule', 'running_late', 'decline', 'cancel', 'found']);
const THREAD_STATES = ['waiting_us', 'waiting_them', 'closed'];

const LISTING_COLS = [
  'title', 'district', 'area_text', 'lat', 'lng', 'map_url', 'property_type', 'bedrooms', 'bathrooms', 'size_m2',
  'price', 'currency', 'price_note', 'includes', 'available', 'fields', 'photos', 'source', 'source_url', 'summary',
  'status', 'next_step', 'decision', 'short_name',
];

export async function authAgent(req: Request, env: Env): Promise<Ctx> {
  const h = req.headers.get('authorization') ?? '';
  const tok = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!tok) throw new HttpError(401, 'no_token', 'Authorization: Bearer <agent token> required');
  const row = await env.DB.prepare(
    `SELECT u.id, u.display_name, u.lang, u.tg_user_id FROM tokens t JOIN users u ON u.id=t.user_id
     JOIN hunters h ON h.user_id=u.id WHERE t.hash=? AND t.revoked_at IS NULL`,
  ).bind(await sha256hex(tok)).first<Ctx['user']>();
  if (!row) throw new HttpError(401, 'bad_token', 'Unknown or revoked token');
  return { env, user: row };
}

async function ownSearch(ctx: Ctx, id: string) {
  const s = await ctx.env.DB.prepare(
    `SELECT s.* FROM searches s JOIN members m ON m.search_id=s.id WHERE s.id=? AND m.user_id=? AND m.role='owner'`,
  ).bind(id, ctx.user.id).first<any>();
  if (!s) throw new HttpError(404, 'no_search', `Search ${id} not found`);
  return inflate(s, ['brief'])!;
}

async function listingOf(ctx: Ctx, lid: string) {
  const l = await ctx.env.DB.prepare(
    // The id as given, else this hunter's copy of a listing another hunter brought first (household.ts altListingId).
    `SELECT l.* FROM listings l JOIN members m ON m.search_id=l.search_id WHERE m.user_id=?2 AND m.role='owner' AND (l.id=?1 OR l.id=?1 || '--' || l.search_id)
     ORDER BY l.id=?1 DESC, l.updated_at DESC LIMIT 1`,
  ).bind(lid, ctx.user.id).first<any>();
  if (!l) throw new HttpError(404, 'no_listing', `Listing ${lid} not found`);
  return l;
}

/** A listing of the same search (ids the agent passes along with a search must not point into another search). */
async function sameSearchListing(ctx: Ctx, sid: string, lid: unknown): Promise<string | null> {
  if (lid == null || lid === '') return null;
  const l = await ctx.env.DB.prepare('SELECT id FROM listings WHERE search_id=?1 AND id IN (?2,?3) ORDER BY id=?2 DESC LIMIT 1')
    .bind(sid, String(lid), altListingId(String(lid), sid)).first<{ id: string }>();
  if (!l) throw new HttpError(404, 'no_listing', `Listing ${lid} is not in this search`);
  return l.id;
}
async function existingContact(ctx: Ctx, cid: unknown): Promise<string | null> {
  return requireContact(ctx.env, ctx.user.id, cid);
}
/** One of the caller's dossiers; returns a search id of theirs that it is linked to (or null). */
async function ownDossier(ctx: Ctx, did: string): Promise<string | null> {
  const d = await ctx.env.DB.prepare('SELECT listing_ids FROM dossiers WHERE id=? AND owner_id=?').bind(did, ctx.user.id).first<{ listing_ids: string }>();
  if (!d) throw new HttpError(404, 'no_dossier');
  const ids = parseJson<string[]>(d.listing_ids, []);
  const r = ids.length ? await ctx.env.DB.prepare(`SELECT l.search_id FROM listings l JOIN members m ON m.search_id=l.search_id AND m.user_id=? AND m.role='owner'
    WHERE l.id IN (${ids.map(() => '?').join(',')}) LIMIT 1`).bind(ctx.user.id, ...ids).first<{ search_id: string }>() : null;
  return r?.search_id ?? null;
}

/** Searches the caller owns (their agent works on them). */
async function ownSearchIds(ctx: Ctx): Promise<string[]> {
  return ((await ctx.env.DB.prepare("SELECT search_id FROM members WHERE user_id=? AND role='owner'").bind(ctx.user.id).all<{ search_id: string }>()).results ?? []).map((r) => r.search_id);
}
const ownContact = (ctx: Ctx, cid: string) => isOwnContact(ctx.env, ctx.user.id, cid);
/** Wave 8.1: a short house name, one line, at most 40 characters; '' / null clears it. */
export function cleanShortName(v: unknown): string | null {
  if (v == null) return null;
  const x = String(v).replace(/\s+/g, ' ').trim();
  if (!x) return null;
  if (x.length > 40) throw new HttpError(400, 'bad_short_name', 'short_name must be at most 40 characters');
  return x;
}
/**
 * Wave 8.1: any authenticated agent call (reads too) counts as the agent being around: agent_seen_at of the caller's own
 * searches moves forward at most once per 10 minutes (an in-isolate throttle plus the same condition in SQL).
 * "Подключить агента": the plugin says which client it runs in (X-Hunt-Client: claude-code | codex); a new client is
 * stored at once, an unknown or missing header (an older plugin) keeps what was there.
 */
const SEEN_MS = 10 * 60e3;
const seenAt = new Map<string, number>();
const CLIENTS = new Set(['claude-code', 'codex']);
export const agentClient = (req: Request): string | null => {
  const v = (req.headers.get('x-hunt-client') ?? '').trim().toLowerCase();
  return CLIENTS.has(v) ? v : null;
};
export async function seenAgent(env: Env, uid: string, client: string | null = null) {
  const t = Date.now(), key = `${uid}|${client ?? ''}`;
  if ((seenAt.get(key) ?? 0) > t - SEEN_MS) return;
  seenAt.set(key, t);
  if (seenAt.size > 500) seenAt.clear();
  const at = new Date(t).toISOString(), since = new Date(t - SEEN_MS).toISOString();
  const mine = `id IN (SELECT search_id FROM members WHERE user_id=?2 AND role='owner')`;
  if (client) {
    await env.DB.prepare(`UPDATE searches SET agent_seen_at=?1, agent_client=?4 WHERE ${mine}
      AND (agent_seen_at IS NULL OR agent_seen_at < ?3 OR agent_client IS NOT ?4)`).bind(at, uid, since, client).run();
  } else {
    await env.DB.prepare(`UPDATE searches SET agent_seen_at=?1 WHERE ${mine} AND (agent_seen_at IS NULL OR agent_seen_at < ?3)`).bind(at, uid, since).run();
  }
}
/** The agent was active in this search (the Mini App's "agent last seen"). */
export async function touchAgent(env: Env, sid: string | null | undefined) {
  if (sid) await env.DB.prepare('UPDATE searches SET agent_seen_at=? WHERE id=?').bind(now(), sid).run();
}
/** Agent-provided links on a listing must be http(s); photos[].url too. */
function cleanListingLinks(b: any) {
  for (const k of ['source_url', 'map_url']) if (k in b) b[k] = httpUrl(b[k], k);
  // Wave 8.1: the short house name for home-mode titles ("Дом в Унгасане"); empty clears it.
  if ('short_name' in b) b.short_name = cleanShortName(b.short_name);
  if (Array.isArray(b.photos)) b.photos = b.photos.map((p: any, i: number) => (p && typeof p === 'object' && 'url' in p ? { ...p, url: httpUrl(p.url, `photos[${i}].url`) } : p));
}

/** The agent setting `decision` (e.g. on import) is not a vote: decided_by NULL keeps it until members vote. */
const agentDecision = (cols: string[]) => (cols.includes('decision') ? ', decided_by=NULL, decided_at=NULL' : '');

/** A translation into the owner's language, masked like the text itself; the same text is no translation. */
const trText = (v: unknown, text: unknown) => { const s = redactSensitive(typeof v === 'string' ? v.trim().slice(0, 4000) : null); return s && s !== String(text ?? '').trim() ? s : null; };
const enc = (v: unknown) => (v != null && typeof v === 'object' ? JSON.stringify(v) : v ?? null);

export async function handleAgent(req: Request, env: Env, path: string): Promise<Response> {
  const ctx = await authAgent(req, env);
  await seenAgent(env, ctx.user.id, agentClient(req));
  const m = req.method;
  const p = path.split('/').filter(Boolean); // ['api', ...]
  const DB = env.DB;
  // Free text never carries passport / ID / card numbers. Logged messages from other people are redacted instead (below).
  if (!(p[1] === 'messages' && m === 'POST') && p[1] !== 'shares') await guardBody(req); // shares check their own files (coordinates look like numbers)

  // --- listing sources from the registry
  if (p[1] === 'shares') { const r = await sharesAgent(req, env, p, ctx.user); if (r) return r; }
  if (p[1] === 'sources') { const r = await sourcesAgent(req, env, p, ctx.user.id); if (r) return r; }
  // --- wave 6 · Полезное (instance-wide useful links per region)
  if (p[1] === 'useful') { const r = await usefulAgent(req, env, p, ctx.user); if (r) return r; }
  // --- wave 7 · Афиша (events, bookings)
  if (p[1] === 'events' || p[1] === 'event-bookings' || p[1] === 'event-feedback') { const r = await afishaAgent(req, env, p, ctx.user); if (r) return r; }
  // --- wave 9 · parties
  if (p[1] === 'parties') { const r = await partyAgent(req, env, p, ctx.user); if (r) return r; }

  // --- me / profile
  if (p[1] === 'me' && m === 'GET') {
    const prof = await DB.prepare('SELECT data FROM profiles WHERE user_id=?').bind(ctx.user.id).first<{ data: string }>();
    return json({ user: ctx.user, profile: parseJson(prof?.data, null) });
  }
  if (p[1] === 'profile' && m === 'PUT') {
    const data = await body(req);
    await DB.prepare('INSERT INTO profiles (user_id, data, updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at')
      .bind(ctx.user.id, JSON.stringify(data), now()).run();
    return json({ ok: true });
  }

  // --- searches
  if (p[1] === 'searches' && p.length === 2) {
    if (m === 'GET') {
      // Own searches in full; searches where the hunter is only a member: the public projection (no budget_cap / budget_said, no chat ids).
      const r = await DB.prepare(`SELECT s.*, m.role my_role FROM searches s JOIN members m ON m.search_id=s.id WHERE m.user_id=? ORDER BY s.updated_at DESC`).bind(ctx.user.id).all<any>();
      return json((r.results ?? []).map((x) => {
        const { my_role, ...row } = x;
        if (my_role === 'owner') return { ...inflate(row, ['brief']), role: 'owner' };
        return { id: row.id, title: row.title, region: row.region, status: row.status, owner_id: row.owner_id, role: my_role, created_at: row.created_at, updated_at: row.updated_at,
          brief: publicBrief(row.region, row.brief, my_role) };
      }));
    }
    if (m === 'POST') {
      const b = await body(req);
      if (!b.title || !b.region) throw new HttpError(400, 'missing', 'title and region are required');
      const id = rid('s_');
      const t = now();
      const code = rid('');
      await DB.batch([
        DB.prepare('INSERT INTO searches (id, owner_id, title, region, brief, approval_mode, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
          .bind(id, ctx.user.id, b.title, b.region, JSON.stringify(b.brief ?? {}), b.approval_mode ?? 'ask', t, t),
        DB.prepare("INSERT INTO members (search_id, user_id, role) VALUES (?,?,'owner')").bind(id, ctx.user.id),
        DB.prepare("INSERT INTO invites (code, kind, search_id, created_by, max_uses, created_at) VALUES (?, 'member', ?, ?, 50, ?)").bind(code, id, ctx.user.id, t),
      ]);
      await assignAnimal(env, id, ctx.user.id, b.region);
      const search = await ownSearch(ctx, id);
      return json({
        search,
        group_link: `https://t.me/${env.BOT_USERNAME}?startgroup=${code}`,
        invite_link: `https://t.me/${env.BOT_USERNAME}?start=${code}`,
      }, 201);
    }
  }
  if (p[1] === 'searches' && p[2]) {
    const s = await ownSearch(ctx, p[2]);
    // --- wave 10 · orders from suppliers (catalogs, the supplier's answers)
    if (p[3] === 'suppliers' || p[3] === 'orders' || p[3] === 'sets') { const r = await ordersAgent(req, env, p, s); if (r) return r; }
    // Wave 6: the project stage (derived / manual / closed) and the lease terms ≥ 2 (extensions).
    if (p[3] === 'stage' || p[3] === 'terms') { const { handleStageAgent } = await import('./stage'); return handleStageAgent(req, env, p, s); }
    if (p.length === 3) {
      if (m === 'GET') {
        const members = await DB.prepare('SELECT u.id, u.display_name, u.tg_username, m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.search_id=?').bind(s.id).all();
        const stats = await DB.prepare('SELECT status, decision, COUNT(*) n FROM listings WHERE search_id=? GROUP BY status, decision').bind(s.id).all();
        return json({ search: s, members: members.results, stats: stats.results });
      }
      if (m === 'PATCH') {
        const b = await body(req);
        const sets: string[] = [];
        const vals: unknown[] = [];
        for (const k of ['title', 'region', 'brief', 'status', 'approval_mode']) if (k in b) { sets.push(`${k}=?`); vals.push(enc(b[k])); }
        if ('money_mode' in b) {
          if (!(MONEY_MODES as readonly string[]).includes(b.money_mode)) throw new HttpError(400, 'bad_money_mode', `money_mode must be ${MONEY_MODES.join(' or ')}`);
          sets.push('money_mode=?');
          vals.push(b.money_mode);
        }
        if ('rooms' in b) {
          sets.push('rooms=?');
          vals.push(b.rooms == null ? null : JSON.stringify(cleanRooms(b.rooms, await memberIds(env, s.id))));
        }
        if ('shares' in b) {
          const ids = await memberIds(env, s.id);
          sets.push('shares=?');
          vals.push(b.shares == null ? null : JSON.stringify(cleanWeights(b.shares, ids)));
        }
        if (sets.length) await DB.prepare(`UPDATE searches SET ${sets.join(',')}, updated_at=? WHERE id=?`).bind(...vals, now(), s.id).run();
        if ('brief' in b) { const { recomputeRings } = await import('./wave4'); await recomputeRings(env, s.id); }
        return json({ search: await ownSearch(ctx, s.id) });
      }
    }
    if (p[3] === 'digest' && m === 'GET') {
      const since = new URL(req.url).searchParams.get('since') ?? '0';
      const ev = await DB.prepare(`SELECT * FROM events WHERE search_id=? AND id>? AND actor!='agent' ORDER BY id`).bind(s.id, Number(since) || 0).all();
      const events = ev.results.map((x) => inflate(x as any, ['data']));
      const last = events.length ? (events[events.length - 1] as any).id : Number(since) || 0;
      return json({ cursor: last, events });
    }
    // Ratings after viewings + interest before them, per listing: what the agent ranks and recommends from.
    if (p[3] === 'ratings' && m === 'GET') {
      const [ratings, interest] = await Promise.all([searchRatings(env, s.id, true), searchInterest(env, s.id)]);
      const ls = (await DB.prepare(`SELECT id, title, district, price, currency, decision, status, checks FROM listings WHERE search_id=? AND status!='closed'`).bind(s.id).all<any>()).results ?? [];
      const onsite = await onsiteOf(env, s.id);
      const rows = ls.map((l) => ({ listing_id: l.id, title: l.title, district: l.district, price: l.price, currency: l.currency, decision: l.decision, status: l.status,
        interest: interest.of(l.id), rating: ratings[l.id] ?? null, onsite: onsite[l.id] ?? null, checks: parseJson(l.checks, null) }))
        .filter((r) => r.rating || r.interest.votes || r.onsite)
        .sort((a, b) => (b.rating?.score ?? -1) - (a.rating?.score ?? -1) || b.interest.score - a.interest.score);
      return json({ region: s.region, voters: interest.voters, listings: rows });
    }
    if (p[3] === 'listings' && p.length === 4 && m === 'GET') {
      const q = new URL(req.url).searchParams;
      const where = ['search_id=?'];
      const vals: unknown[] = [s.id];
      for (const k of ['status', 'decision', 'district']) if (q.get(k)) { where.push(`${k}=?`); vals.push(q.get(k)); }
      if (q.get('q')) { where.push('(title LIKE ? OR summary LIKE ? OR area_text LIKE ?)'); const like = `%${q.get('q')}%`; vals.push(like, like, like); }
      const r = await DB.prepare(`SELECT * FROM listings WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT 500`).bind(...vals).all();
      return json(r.results.map((x) => inflate(x as any, LISTING_JSON)));
    }
    if (p[3] === 'listings' && p[4] && m === 'PUT') {
      const b = await body(req);
      cleanListingLinks(b);
      let lid = p[4];
      let exists = await DB.prepare('SELECT search_id FROM listings WHERE id=?').bind(lid).first<{ search_id: string }>();
      if (exists && exists.search_id !== s.id) {
        // Taken by another project: this one keeps its own copy. The answer's listing.id is the id to use (the short one also works).
        lid = altListingId(lid, s.id);
        if (lid.length > 46 || !/^[A-Za-z0-9_-]+$/.test(lid)) throw new HttpError(409, 'listing_other_search', 'This listing id belongs to another search: use a shorter id (letters, digits, _ and -)');
        exists = await DB.prepare('SELECT search_id FROM listings WHERE id=?').bind(lid).first<{ search_id: string }>();
      }
      const t = now();
      const cols = LISTING_COLS.filter((k) => k in b);
      if (!exists) {
        if (!b.title) throw new HttpError(400, 'missing', 'title is required for a new listing');
        await DB.prepare(`INSERT INTO listings (id, search_id, ${cols.join(',')}, created_at, updated_at) VALUES (?,?,${cols.map(() => '?').join(',')},?,?)`)
          .bind(lid, s.id, ...cols.map((k) => enc(b[k])), t, t).run();
        await event(env, s.id, 'listing_added', lid, 'agent', { title: b.title });
        if ('price' in b) await notePrice(env, lid, null, b.price, b.currency, b.source);
      } else if (cols.length) {
        const old = 'price' in b ? await DB.prepare('SELECT price, currency, source FROM listings WHERE id=?').bind(lid).first<any>() : null;
        await DB.prepare(`UPDATE listings SET ${cols.map((k) => `${k}=?`).join(',')}${agentDecision(cols)}, updated_at=? WHERE id=?`).bind(...cols.map((k) => enc(b[k])), t, lid).run();
        if (old) await notePrice(env, lid, old.price, b.price, b.currency ?? old.currency, b.source ?? old.source);
      }
      const listing = inflate(await DB.prepare('SELECT * FROM listings WHERE id=?').bind(lid).first<any>(), LISTING_JSON);
      return json({ listing, created: !exists }, exists ? 200 : 201);
    }
    if (p[3] === 'viewings' && m === 'GET') {
      const date = new URL(req.url).searchParams.get('date');
      const r = await DB.prepare(
        `SELECT v.*, l.title, l.lat, l.lng, l.map_url FROM viewings v JOIN listings l ON l.id=v.listing_id
         WHERE v.search_id=? ${date ? 'AND substr(v.starts_at,1,10)=?' : ''} ORDER BY v.starts_at`,
      ).bind(...(date ? [s.id, date] : [s.id])).all();
      return json({ viewings: r.results, route: routeLink((r.results as any[]).filter((x) => x.status !== 'cancelled')) });
    }
    // Shared money: expenses, settlements, shares, balances.
    if (p[3] === 'expenses' && m === 'GET') return json(await moneyView(env, s.id));
    if (p[3] === 'expenses' && m === 'POST') {
      const b = await body(req);
      const e = await insertExpense(env, s, b, 'agent');
      return json({ expense: e }, 201);
    }
    // Life in the villa: issues, house contacts, deal and dates.
    if (p[3] === 'living' && m === 'GET') {
      const [is, hc, dl] = await DB.batch<any>([
        DB.prepare('SELECT * FROM issues WHERE search_id=? ORDER BY status=\'fixed\', updated_at DESC').bind(s.id),
        DB.prepare('SELECT * FROM house_contacts WHERE search_id=? ORDER BY sort, updated_at').bind(s.id),
        DB.prepare('SELECT * FROM deals WHERE search_id=? ORDER BY updated_at DESC LIMIT 1').bind(s.id),
      ]);
      const deal = dl.results?.[0] ? { listing_id: dl.results[0].listing_id, ...parseJson<any>(dl.results[0].data, {}) } : null;
      const [moveout, relet, power, dir, vis] = await Promise.all([
        moveoutView(env, s.id), reletView(env, s.id), searchPower(env, s.id),
        DB.prepare('SELECT * FROM directory WHERE search_id=? ORDER BY grp, sort, name').bind(s.id).all(),
        DB.prepare('SELECT m.user_id, u.display_name name, m.visa_until FROM members m JOIN users u ON u.id=m.user_id WHERE m.search_id=?').bind(s.id).all(),
      ]);
      return json({
        status: s.status, issues: is.results ?? [], contacts: hc.results ?? [], deal, dates: deal ? dealDates(deal) : [],
        moveout, relet, power, directory: dir.results ?? [], dir_groups: parseJson(s.dir_groups, []), visas: vis.results ?? [], rooms: parseJson(s.rooms, null), money_mode: s.money_mode ?? 'split',
      });
    }
    // Wave 3: power meter (readings the agent reads from members' photos, top-ups).
    if (p[3] === 'power' && m === 'GET') return json(await searchPower(env, s.id));
    if (p[3] === 'power' && m === 'POST') {
      const b = await body(req);
      const reading = await addReading(env, s.id, b, 'agent');
      return json({ reading, power: await searchPower(env, s.id) }, 201);
    }
    // Move-out of the current home.
    if (p[3] === 'moveout' && m === 'GET') return json({ moveout: await moveoutView(env, s.id) });
    if (p[3] === 'moveout' && m === 'PUT') return json({ moveout: await setMoveout(env, s, await body(req), 'agent') });
    // Re-let of the remaining term + leads.
    if (p[3] === 'relet' && p.length === 4 && m === 'GET') return json({ relet: await reletView(env, s.id) });
    if (p[3] === 'relet' && p.length === 4 && m === 'PUT') return json({ relet: await setRelet(env, s, await body(req), 'agent') });
    if (p[3] === 'relet' && p[4] === 'leads' && p[5] && m === 'PUT') {
      const lead = await setLead(env, s, p[5], await body(req), 'agent');
      return json({ lead }, p[5] === 'new' ? 201 : 200);
    }
    // Contacts directory near the home.
    if (p[3] === 'directory' && p.length === 4 && m === 'GET') {
      const r = await DB.prepare('SELECT * FROM directory WHERE search_id=? ORDER BY grp, sort, name').bind(s.id).all();
      return json({ groups: parseJson(s.dir_groups, []), entries: r.results ?? [] });
    }
    if (p[3] === 'directory' && p[4] && m === 'PUT') {
      const entry = await setDirEntry(env, s, p[4], await body(req), 'agent');
      return json({ entry }, p[4] === 'new' ? 201 : 200);
    }
    if (p[3] === 'directory' && p[4] && m === 'DELETE') {
      await DB.prepare('DELETE FROM directory WHERE id=? AND search_id=?').bind(p[4], s.id).run();
      return json({ ok: true });
    }
    if (p[3] === 'directory-groups' && m === 'POST') return json({ groups: await addDirGroup(env, s.id, (await body(req)).name) });
    if (p[3] === 'documents' && m === 'GET') {
      const lid = new URL(req.url).searchParams.get('listing_id');
      const r = await DB.prepare(`SELECT * FROM documents WHERE search_id=? ${lid ? 'AND listing_id=?' : ''} ORDER BY created_at`).bind(...(lid ? [s.id, lid] : [s.id])).all();
      return json((r.results ?? []).map(docView));
    }
    // Wave 4: places, location scores, bikes, scans, things bought.
    if (p[3] === 'places' && m === 'GET') {
      const r = await DB.prepare('SELECT * FROM places WHERE search_id=? ORDER BY area, type, name').bind(s.id).all();
      const bp = await basePlaces(env, countryOf(s.region));
      return json({ places: r.results ?? [], base: { count: (bp.places ?? []).length, types: bp.types ?? {} } });
    }
    if (p[3] === 'places' && m === 'POST') return json(await upsertPlaces(env, s, (await body(req)).places, 'agent'), 201);
    if (p[3] === 'locations' && m === 'GET') {
      const ls = (await DB.prepare(`SELECT l.id, l.title, l.location, (SELECT 1 FROM isochrones i WHERE i.listing_id=l.id) iso, (SELECT i.rings FROM isochrones i WHERE i.listing_id=l.id) iso_rings FROM listings l WHERE l.search_id=? AND l.status!='closed'`).bind(s.id).all<any>()).results ?? [];
      const [sc, rs] = await Promise.all([locationScores(env, s, ls), ringSet(env, s.region)]);
      return json(ls.map((l) => ({ listing_id: l.id, title: l.title, score: sc[l.id] ?? null, has_isochrones: !!l.iso, stale: !!l.iso && !sameRings(parseJson(l.iso_rings, null), rs.rings) })));
    }
    if (p[3] === 'bikes' && p.length === 4 && m === 'GET') return json({ bikes: ((await DB.prepare('SELECT * FROM bikes WHERE search_id=? ORDER BY status, created_at').bind(s.id).all()).results ?? []).map(bikeView) });
    if (p[3] === 'bikes' && p[4] && m === 'PUT') { const r = await setBike(env, s, p[4], await body(req), 'agent'); return json(r, p[4] === 'new' ? 201 : 200); }
    if (p[3] === 'bikes' && p[4] && m === 'DELETE') { await DB.prepare('DELETE FROM bikes WHERE id=? AND search_id=?').bind(p[4], s.id).run(); return json({ ok: true }); }
    if (p[3] === 'scans' && p.length === 4 && m === 'GET') return json({ scans: await scansOf(env, s.id) });
    if (p[3] === 'scans' && p[4] && m === 'PUT') return json({ scan: await setScan(env, s, p[4], await body(req), 'agent') }, p[4] === 'new' ? 201 : 200);
    if (p[3] === 'items' && p.length === 4 && m === 'GET') return json(await itemsView(env, s.id));
    if (p[3] === 'items' && p[4] && m === 'PUT') return json({ item: await setItem(env, s, p[4], await body(req), 'agent') }, p[4] === 'new' ? 201 : 200);
    if (p[3] === 'items' && p[4] && m === 'DELETE') { await DB.prepare('DELETE FROM items WHERE id=? AND search_id=?').bind(p[4], s.id).run(); return json({ ok: true }); }
    // Wave 5: surf, guest guide, what next, clone, recap, guests.
    if (p[3] === 'surf' && m === 'GET') return json(await surfView(env, s, { fetch: true, refresh: new URL(req.url).searchParams.get('refresh') === '1', lang: ctx.user.lang }));
    if (p[3] === 'guide' && (m === 'GET' || m === 'PUT')) {
      if (m === 'PUT') await setGuide(env, s.id, await body(req), 'agent');
      const g = await guideView(env, s, { withSecret: false, withUrl: true, lang: ctx.user.lang });
      return json({ guide: { address: g.address, map_url: g.map_url, wifi_name: g.wifi_name, wifi_password_set: g.wifi_password_set, rules: g.rules, note: g.note, host: g.host ? { user_id: g.host.user_id, name: g.host.name } : null, url: g.url, listing_id: g.listing_id } });
    }
    if (p[3] === 'next' && m === 'GET') return json({ renewal: await renewalView(env, s.id) });
    if (p[3] === 'next' && m === 'PUT') {
      const b = await body(req);
      const hl = await homeListing(env, s.id);
      const leaseTo = b.lease_to ?? String(parseJson<any>(hl?.deal_data, {})?.terms?.to ?? '').slice(0, 10);
      const cur = await renewalView(env, s.id);
      if (!cur || (b.lease_to && cur.lease_to !== b.lease_to)) await ensureRenewal(env, s.id, leaseTo, hl?.id ?? null, null);
      if ('note' in b) {
        const note = b.note == null ? null : String(b.note).trim().slice(0, 300) || null;
        const sn = note ? sensitive(note) : null;
        if (sn) throw new HttpError(400, 'sensitive', `The note looks like it contains ${sn}.`);
        await DB.prepare(`UPDATE renewals SET note=?, updated_at=? WHERE id=(SELECT id FROM renewals WHERE search_id=? ORDER BY created_at DESC LIMIT 1)`).bind(note, now(), s.id).run();
      }
      return json({ renewal: await renewalView(env, s.id) });
    }
    if (p[3] === 'clone' && m === 'POST') {
      const r = await cloneSearch(env, s, await body(req), ctx.user.id);
      const search = await ownSearch(ctx, r.id);
      return json({ search, invite_link: `https://t.me/${env.BOT_USERNAME}?start=${r.code}`, group_link: `https://t.me/${env.BOT_USERNAME}?startgroup=${r.code}` }, 201);
    }
    if (p[3] === 'recap' && m === 'GET') return json(await recapView(env, s.id, 'owner', ctx.user.lang));
    if (p[3] === 'guests' && m === 'GET') return json({ guests: await guestsView(env, s.id, s.region) });
    if (p[3] === 'day-plan' && m === 'POST') {
      const b = await body(req);
      await postDayPlan(env, s, b.date);
      return json({ ok: true });
    }
  }

  // --- listings by id
  if (p[1] === 'listings' && p[2]) {
    const l = await listingOf(ctx, p[2]);
    if (p.length === 3 && m === 'GET') {
      const contacts = await DB.prepare('SELECT c.*, lc.role link_role FROM listing_contacts lc JOIN contacts c ON c.id=lc.contact_id WHERE lc.listing_id=?').bind(l.id).all();
      const msgs = await DB.prepare('SELECT * FROM messages WHERE listing_id=? ORDER BY at DESC LIMIT 30').bind(l.id).all<any>();
      await openRows(env, msgs.results ?? [], MSG);
      if (msgs.results?.length) await seen(env, ctx.user.id, ctx.user.id, 'agent');
      const views = await DB.prepare('SELECT * FROM viewings WHERE listing_id=? ORDER BY starts_at').bind(l.id).all();
      const votes = await DB.prepare('SELECT v.*, u.display_name FROM votes v JOIN users u ON u.id=v.user_id WHERE listing_id=?').bind(l.id).all();
      const deal = await DB.prepare('SELECT data, updated_at FROM deals WHERE listing_id=?').bind(l.id).first<any>();
      const [ratings, interest] = await Promise.all([searchRatings(env, l.search_id, true), searchInterest(env, l.search_id)]);
      return json({
        listing: inflate(l, LISTING_JSON), contacts: contacts.results, messages_tail: msgs.results.reverse(), viewings: views.results, votes: votes.results,
        interest: interest.of(l.id), ratings: ratings[l.id] ?? null,
        deal: deal ? { ...parseJson<any>(deal.data, {}), updated_at: deal.updated_at } : null,
      });
    }
    if (p.length === 3 && m === 'PATCH') {
      const b = await body(req);
      cleanListingLinks(b);
      const cols = LISTING_COLS.filter((k) => k in b);
      if (cols.length) await DB.prepare(`UPDATE listings SET ${cols.map((k) => `${k}=?`).join(',')}${agentDecision(cols)}, updated_at=? WHERE id=?`).bind(...cols.map((k) => enc(b[k])), now(), l.id).run();
      if ('price' in b) await notePrice(env, l.id, l.price, b.price, b.currency ?? l.currency, b.source ?? l.source);
      return json({ listing: inflate(await DB.prepare('SELECT * FROM listings WHERE id=?').bind(l.id).first<any>(), LISTING_JSON) });
    }
    if (p[3] === 'photos' && m === 'POST') {
      // Photos are uploaded straight into the search chat as an album; Telegram file_ids become the storage.
      const ct = req.headers.get('content-type') ?? '';
      let files: (File | string)[] = [];
      if (ct.includes('multipart/form-data')) {
        const fd = await req.formData();
        files = fd.getAll('photo').filter((x) => typeof x !== 'string') as unknown as File[];
      } else {
        const b = await body(req);
        files = (b.urls ?? []) as string[];
      }
      if (!files.length) throw new HttpError(400, 'no_photos', 'Send multipart "photo" files or {urls:[]}');
      const photos = await publishListing(env, l, files);
      return json({ photos });
    }
    // Scam check (agent): verdict + signals, shown on the listing screen.
    if (p[3] === 'checks' && m === 'PUT') {
      const b = await body(req);
      const checks = cleanChecks(b);
      const sens = sensitive(JSON.stringify(checks));
      if (sens) throw new HttpError(400, 'sensitive', `Checks look like they contain ${sens}. Remove it.`);
      await DB.prepare('UPDATE listings SET checks=?, updated_at=? WHERE id=?').bind(JSON.stringify(checks), now(), l.id).run();
      await event(env, l.search_id, 'checks', l.id, 'agent', { title: l.title, verdict: checks.verdict, warn: checks.signals.filter((x: any) => x.status === 'warn').length });
      return json({ listing: inflate(await DB.prepare('SELECT * FROM listings WHERE id=?').bind(l.id).first<any>(), LISTING_JSON) });
    }
    // A file from the agent's computer (e.g. a lease converted to PDF): the bot sends it to the hunter's DM and we keep the file_id only.
    if (p[3] === 'documents' && m === 'POST') {
      if (!ctx.user.tg_user_id) throw new HttpError(409, 'no_tg_user', 'The hunter has not started the bot yet: no DM to send the file to.');
      const fd = await req.formData();
      const file = fd.get('file');
      if (!file || typeof file === 'string') throw new HttpError(400, 'no_file', 'Send a multipart "file"');
      if ((file as File).size > 49 * 1024 * 1024) throw new HttpError(413, 'too_big', 'Telegram bots send files up to 50 MB');
      const meta = Object.fromEntries([...fd.entries()].filter(([k, v]) => k !== 'file' && typeof v === 'string')) as Record<string, string>;
      const title = String(meta.title || (file as File).name || 'Document').slice(0, 160);
      const sens = sensitive(`${title} ${meta.note ?? ''}`);
      if (sens) throw new HttpError(400, 'sensitive', `Title or note looks like it contains ${sens}.`);
      const out = new FormData();
      out.set('chat_id', String(ctx.user.tg_user_id));
      out.set('document', file as File, (file as File).name || 'document');
      out.set('caption', `📄 ${title} · ${l.title}`.slice(0, 1000));
      const msg = await tg<any>(env, 'sendDocument', out);
      const f = msg.document ?? msg.video ?? (msg.photo ? msg.photo[msg.photo.length - 1] : null);
      if (!f?.file_id) throw new HttpError(502, 'telegram', 'Telegram did not return a file id');
      const doc = await upsertDocument(env, l, 'new', {
        ...meta, title, version: meta.version ? Number(meta.version) : undefined, pages: meta.pages ? Number(meta.pages) : undefined,
        tg_file_id: f.file_id, tg_chat_id: ctx.user.tg_user_id, file_kind: 'document', file_name: (file as File).name || null,
        mime: (file as File).type || msg.document?.mime_type || null, size: (file as File).size,
      }, 'agent');
      return json({ document: docView(doc) }, 201);
    }
    if (p[3] === 'publish' && m === 'POST') {
      await publishListing(env, l, null);
      return json({ ok: true });
    }
    // Wave 4: isochrones (agent, Valhalla) → rings and the location score; flood risk; 3D scan upload.
    if (p[3] === 'isochrones' && m === 'PUT') {
      await setIsochrones(env, l, await body(req));
      const fresh = await DB.prepare('SELECT * FROM listings WHERE id=?').bind(l.id).first<any>();
      return json(await locationView(env, fresh));
    }
    if (p[3] === 'location' && m === 'GET') return json(await locationView(env, l));
    if (p[3] === 'negotiation' && m === 'GET') return json(await negotiationView(env, l));
    if (p[3] === 'flood' && m === 'PUT') return json({ flood: await setFlood(env, l, await body(req), 'agent') });
    if (p[3] === 'scans' && m === 'POST') {
      if (!ctx.user.tg_user_id) throw new HttpError(409, 'no_tg_user', 'The hunter has not started the bot yet: no DM to send the file to.');
      const fd = await req.formData();
      const file = fd.get('file');
      if (!file || typeof file === 'string') throw new HttpError(400, 'no_file', 'Send a multipart "file" (.glb)');
      if ((file as File).size > 19.5 * 1024 * 1024) throw new HttpError(413, 'too_big', 'Scans up to ~19 MB (Bot API getFile reads 20 MB): run scan_prepare first');
      const meta = Object.fromEntries([...fd.entries()].filter(([k, v]) => k !== 'file' && typeof v === 'string')) as Record<string, string>;
      const room = String(meta.room || 'Scan').slice(0, 60);
      const out = new FormData();
      out.set('chat_id', String(ctx.user.tg_user_id));
      out.set('document', file as File, (file as File).name || 'scan.glb');
      out.set('caption', `🧊 3D · ${room} · ${l.title}`.slice(0, 1000));
      const msg = await tg<any>(env, 'sendDocument', out);
      if (!msg.document?.file_id) throw new HttpError(502, 'telegram', 'Telegram did not return a file id');
      const doc = await upsertDocument(env, l, 'new', { kind: 'scan', title: `3D · ${room}`, status: 'have', doc_date: now().slice(0, 10), tg_file_id: msg.document.file_id, tg_chat_id: ctx.user.tg_user_id,
        file_kind: 'document', file_name: (file as File).name || 'scan.glb', mime: 'model/gltf-binary', size: (file as File).size }, 'agent');
      const s = await DB.prepare('SELECT id FROM searches WHERE id=?').bind(l.search_id).first<any>();
      const scan = await setScan(env, s, meta.scan_id || 'new', { listing_id: l.id, room, phase: meta.phase || 'movein', bike_id: meta.bike_id || null, note: meta.note || null, app: meta.app || null, status: 'ok', doc_id: doc.id }, 'agent');
      return json({ scan, document: docView(doc) }, 201);
    }
    // Travel times to the brief anchors, computed agent-side (Valhalla × rush-hour factor).
    if (p[3] === 'travel' && m === 'PUT') {
      const b = await body(req);
      const travel = b.replace ? cleanTravel(b.times, {}) : cleanTravel(b.times, parseJson(l.travel, {}));
      await DB.prepare('UPDATE listings SET travel=?, updated_at=? WHERE id=?').bind(JSON.stringify(travel), now(), l.id).run();
      return json({ travel });
    }
  }

  // --- wave 4: places, bikes, dossiers
  if (p[1] === 'places' && p[2]) {
    const pl = await DB.prepare(`SELECT p.*, s.region FROM places p JOIN searches s ON s.id=p.search_id JOIN members m ON m.search_id=p.search_id AND m.user_id=? AND m.role='owner' WHERE p.id=?`).bind(ctx.user.id, p[2]).first<any>();
    if (!pl) throw new HttpError(404, 'no_place');
    if (m === 'DELETE') {
      await DB.prepare('DELETE FROM places WHERE id=?').bind(pl.id).run();
      const { recomputeRings } = await import('./wave4');
      await recomputeRings(env, pl.search_id);
      return json({ ok: true });
    }
    if (m === 'PATCH') return json({ place: await patchPlace(env, pl, await body(req), pl.region) });
  }
  if (p[1] === 'bikes' && p[2] && p[3] === 'pay' && m === 'POST') {
    const bk = await DB.prepare(`SELECT b.* FROM bikes b JOIN members m ON m.search_id=b.search_id AND m.user_id=? AND m.role='owner' WHERE b.id=?`).bind(ctx.user.id, p[2]).first<any>();
    if (!bk) throw new HttpError(404, 'no_bike');
    return json(await payBike(env, bk, await body(req), 'agent'), 201);
  }
  if (p[1] === 'dossiers') {
    if (p[2] === 'match' && m === 'GET') {
      const l = await listingOf(ctx, new URL(req.url).searchParams.get('listing_id') ?? '');
      return json({ dossiers: await matchDossiers(env, l) });
    }
    if (p[2] && p.length === 3 && m === 'GET') {
      await ownDossier(ctx, p[2]);
      const d = await dossierView(env, p[2]);
      if (!d) throw new HttpError(404, 'no_dossier');
      return json({ dossier: d });
    }
    // Dossiers are the hunter's own.
    if (p[2] && p.length === 3 && m === 'PUT') {
      const b = await body(req);
      const l = b.listing_id ? await listingOf(ctx, b.listing_id) : undefined;
      if (p[2] === 'new' && !l) throw new HttpError(400, 'missing', 'listing_id (one of your listings) is required for a new dossier');
      if (p[2] !== 'new') await ownDossier(ctx, p[2]);
      if (b.owner_contact_id) await existingContact(ctx, b.owner_contact_id);
      return json({ dossier: await setDossier(env, p[2], b, 'agent', l, ctx.user.id) }, p[2] === 'new' ? 201 : 200);
    }
    if (p[2] && p[3] === 'items' && m === 'POST') {
      const b = await body(req);
      const own = await ownDossier(ctx, p[2]);
      const sid = b.search_id ? (await ownSearch(ctx, b.search_id)).id : own;
      return json({ item: await addDossierItem(env, p[2], { ...b, search_id: sid }, 'agent') }, 201);
    }
  }
  if (p[1] === 'dossier-items' && p[2] && m === 'DELETE') {
    // Only the author (the hunter whose search the item was written from) deletes it.
    const it = await DB.prepare(`SELECT i.id FROM dossier_items i JOIN members m ON m.search_id=i.search_id AND m.user_id=? AND m.role='owner' WHERE i.id=?`).bind(ctx.user.id, p[2]).first<any>();
    if (!it) throw new HttpError(404, 'no_item', 'No such dossier item of yours');
    await DB.prepare('DELETE FROM dossier_items WHERE id=?').bind(it.id).run();
    return json({ ok: true });
  }

  // --- KV media the members uploaded (v/ voice notes, o/ on-site photos, r/ receipts), for the agent to read.
  if (p[1] === 'media' && m === 'GET') {
    const key = new URL(req.url).searchParams.get('key') ?? '';
    const lm = key.match(/^(?:v|o)\/([^/]+)\/u_[a-z0-9]+-[a-z0-9]+$/);
    const rm = key.match(/^(?:r|m|i)\/([^/]+)\/u_[a-z0-9]+-[a-z0-9]+$/);
    if (lm) await listingOf(ctx, lm[1]);
    else if (rm) await ownSearch(ctx, rm[1]);
    else throw new HttpError(400, 'bad_key', 'key must be v/<listing>/…, o/<listing>/…, r/<search>/… or m/<search>/…');
    const { value, metadata } = await env.PHOTOS_KV.getWithMetadata<{ type?: string }>(key, 'stream');
    if (!value) throw new HttpError(404, 'no_media');
    return new Response(value, { headers: mediaHeaders(metadata?.type ?? 'application/octet-stream') });
  }

  // --- documents by id
  if (p[1] === 'documents' && p[2]) {
    if (p[2] !== 'new' && m !== 'PUT') {
      const d = await DB.prepare(`SELECT d.* FROM documents d JOIN members m ON m.search_id=d.search_id AND m.user_id=? AND m.role='owner' WHERE d.id=?`).bind(ctx.user.id, p[2]).first<any>();
      if (!d) throw new HttpError(404, 'no_document');
      if (p.length === 3 && m === 'GET') return json({ document: docView(d) });
      if (p[3] === 'file' && m === 'GET') {
        if (!d.tg_file_id) throw new HttpError(404, 'no_file', 'This document has no file yet (status request/due).');
        return tgFileStream(env, d.tg_file_id, { mime: d.mime, name: d.file_name, download: true });
      }
    }
    if (p.length === 3 && m === 'PUT') {
      const b = await body(req);
      const old = p[2] === 'new' ? null : await DB.prepare(`SELECT d.* FROM documents d JOIN members m ON m.search_id=d.search_id AND m.user_id=? AND m.role='owner' WHERE d.id=?`).bind(ctx.user.id, p[2]).first<any>();
      if (p[2] !== 'new' && !old) throw new HttpError(404, 'no_document');
      const l = await listingOf(ctx, old?.listing_id ?? b.listing_id ?? '');
      const doc = await upsertDocument(env, l, old ? old.id : 'new', b, 'agent');
      return json({ document: docView(doc) }, old ? 200 : 201);
    }
  }

  // --- life in the villa: issues and house contacts
  if (p[1] === 'issues' && p[2] && m === 'PUT') {
    const b = await body(req);
    const old = p[2] === 'new' ? null : await DB.prepare(`SELECT i.* FROM issues i JOIN members m ON m.search_id=i.search_id AND m.user_id=? AND m.role='owner' WHERE i.id=?`).bind(ctx.user.id, p[2]).first<any>();
    if (p[2] !== 'new' && !old) throw new HttpError(404, 'no_issue');
    const s = await ownSearch(ctx, old?.search_id ?? b.search_id ?? '');
    if ('listing_id' in b) b.listing_id = await sameSearchListing(ctx, s.id, b.listing_id);
    const issue = await upsertIssue(env, s, old, b, 'agent');
    return json({ issue }, old ? 200 : 201);
  }
  if (p[1] === 'house-contacts' && p[2]) {
    const old = p[2] === 'new' ? null : await DB.prepare(`SELECT h.* FROM house_contacts h JOIN members m ON m.search_id=h.search_id AND m.user_id=? AND m.role='owner' WHERE h.id=?`).bind(ctx.user.id, p[2]).first<any>();
    if (p[2] !== 'new' && !old) throw new HttpError(404, 'no_contact');
    if (m === 'DELETE' && old) {
      await DB.prepare('DELETE FROM house_contacts WHERE id=?').bind(old.id).run();
      return json({ ok: true });
    }
    if (m === 'PUT') {
      const b = await body(req);
      const s = await ownSearch(ctx, old?.search_id ?? b.search_id ?? '');
      const row = cleanHouseContact({ ...(old ?? {}), ...b });
      row.listing_id = await sameSearchListing(ctx, s.id, row.listing_id);
      row.contact_id = await existingContact(ctx, row.contact_id);
      const id = old?.id ?? rid('hc_');
      await DB.prepare(`INSERT INTO house_contacts (id, search_id, listing_id, contact_id, name, role, note, cost, currency, period, payer, schedule, channel, address, sort, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET listing_id=excluded.listing_id, contact_id=excluded.contact_id, name=excluded.name, role=excluded.role,
        note=excluded.note, cost=excluded.cost, currency=excluded.currency, period=excluded.period, payer=excluded.payer, schedule=excluded.schedule, channel=excluded.channel,
        address=excluded.address, sort=excluded.sort, updated_at=excluded.updated_at`)
        .bind(id, s.id, row.listing_id, row.contact_id, row.name, row.role, row.note, row.cost, row.currency, row.period, row.payer, row.schedule, row.channel, row.address, row.sort, now()).run();
      return json({ contact: await DB.prepare('SELECT * FROM house_contacts WHERE id=?').bind(id).first() }, old ? 200 : 201);
    }
  }

  // --- voice notes of ratings (key from ratings): raw audio for transcription
  if (p[1] === 'voice' && m === 'GET') {
    const key = new URL(req.url).searchParams.get('key') ?? '';
    const mm = key.match(/^v\/([^/]+)\/u_[a-z0-9]+-[a-z0-9]+$/);
    if (!mm) throw new HttpError(400, 'bad_key', 'key must be a ratings voice key (v/<listing>/<user>-<ts>)');
    await listingOf(ctx, mm[1]);
    const { value, metadata } = await env.PHOTOS_KV.getWithMetadata<{ type?: string }>(key, 'stream');
    if (!value) throw new HttpError(404, 'no_voice');
    return new Response(value, { headers: mediaHeaders(metadata?.type ?? 'audio/webm') });
  }

  // --- contacts (instance-wide records of people; listings, messages and search titles only from the caller's own searches)
  if (p[1] === 'contacts') {
    if (p[2] === 'resolve' && m === 'POST') {
      const b = await body(req);
      let cid: string | null = null;
      if (b.channel && b.address) {
        // Exact address among the caller's own contacts; other hunters' contacts are never returned.
        const a = normAddr(b.channel, b.address);
        cid = (await contactByAddress(env, ctx.user.id, b.channel, a)) ?? (b.channel !== 'any' ? await contactByAddress(env, ctx.user.id, null, a) : null);
      } else if (b.q) {
        // Free text: only among the caller's own contacts.
        const like = `%${String(b.q).slice(0, 80)}%`;
        const r = await DB.prepare(`SELECT c.id FROM contacts c LEFT JOIN contact_channels cc ON cc.contact_id=c.id
          WHERE (c.name LIKE ?1 OR cc.address LIKE ?1 OR cc.display LIKE ?1) AND ${mineSql('?2')} LIMIT 1`).bind(like, ctx.user.id).first<{ id: string }>();
        cid = r?.id ?? null;
      }
      if (!cid) return json({ contact: null });
      if (b.search_id) await ownSearch(ctx, b.search_id);
      return json(await contactFull(ctx, cid, b.search_id ?? null));
    }
    // A person's card: channels, listings of my searches, notes from the whole instance and stats.
    if (p[2] && p.length === 3 && m === 'GET' && p[2] !== 'resolve') {
      if (!(await ownContact(ctx, p[2]))) throw new HttpError(404, 'no_contact');
      const sid = new URL(req.url).searchParams.get('search_id');
      if (sid) await ownSearch(ctx, sid);
      return json(await contactFull(ctx, p[2], sid));
    }
    if (p[3] === 'notes' && m === 'POST') {
      const b = await body(req);
      if (b.search_id) await ownSearch(ctx, b.search_id);
      await existingContact(ctx, p[2]);
      const note = await addNote(env, { ...b, contact_id: p[2] }, 'agent');
      return json({ note }, 201);
    }
    if (p[2] && p.length === 3 && m === 'PUT') {
      const b = await body(req);
      const isNew = p[2] === 'new';
      const cid = isNew ? rid('c_') : p[2];
      const exists = !isNew && !!(await DB.prepare('SELECT 1 FROM contacts WHERE id=?').bind(cid).first());
      if (exists && !(await ownContact(ctx, cid))) throw new HttpError(404, 'no_contact', `Contact ${cid} not found`);
      if (!exists && !isNew && !/^c_[a-z0-9_]{1,40}$/i.test(cid)) throw new HttpError(400, 'bad_contact_id', 'Use id "new"');
      // A channel that already belongs to another contact is never moved (it would re-point someone else's conversation).
      const chans = (Array.isArray(b.channels) ? b.channels : []).filter((ch: any) => ch?.channel && ch?.address).map((ch: any) => ({ ...ch, address: normAddr(ch.channel, ch.address) }));
      for (const ch of chans) {
        const cur = await contactByAddress(env, ctx.user.id, ch.channel, ch.address);
        if (cur && cur !== cid) throw new HttpError(409, 'channel_taken', `${ch.channel} ${ch.address} already belongs to contact ${cur}: use that contact (contact_resolve)`);
      }
      const t = now();
      await DB.prepare(`INSERT INTO contacts (id, name, role, lang, notes, created_at, updated_at, owner_id) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET name=coalesce(excluded.name,name), role=coalesce(excluded.role,role), lang=coalesce(excluded.lang,lang), notes=coalesce(excluded.notes,notes), updated_at=excluded.updated_at`)
        .bind(cid, b.name ?? null, b.role ?? null, b.lang ?? null, b.notes ?? null, t, t, ctx.user.id).run();
      for (const ch of chans) {
        await DB.prepare('INSERT INTO contact_channels (contact_id, channel, address, display) VALUES (?,?,?,?) ON CONFLICT(contact_id,channel,address) DO UPDATE SET display=coalesce(excluded.display, display)')
          .bind(cid, ch.channel, ch.address, ch.display ?? null).run();
      }
      return json(await contactFull(ctx, cid));
    }
    if (p[3] === 'link' && m === 'POST') {
      const b = await body(req);
      const ll = await listingOf(ctx, b.listing_id);
      await existingContact(ctx, p[2]);
      await DB.prepare('INSERT OR REPLACE INTO listing_contacts (listing_id, contact_id, role) VALUES (?,?,?)').bind(ll.id, p[2], b.role ?? 'primary').run();
      return json({ ok: true });
    }
    if (p[3] === 'messages' && m === 'GET') {
      // Only messages logged in the caller's own searches (by search or listing), at most 1000.
      if (!(await ownContact(ctx, p[2]))) throw new HttpError(404, 'no_contact');
      const lim = Math.max(1, Math.min(1000, Math.floor(Number(new URL(req.url).searchParams.get('limit') ?? 200) || 200)));
      const r = await DB.prepare(`SELECT * FROM messages WHERE contact_id=?1 AND (
          search_id IN (SELECT search_id FROM members WHERE user_id=?2 AND role='owner')
          OR (search_id IS NULL AND listing_id IN (SELECT l.id FROM listings l JOIN members m ON m.search_id=l.search_id AND m.user_id=?2 AND m.role='owner')))
        ORDER BY at DESC LIMIT ?3`).bind(p[2], ctx.user.id, lim).all<any>();
      await openRows(env, r.results ?? [], MSG);
      if (r.results?.length) await seen(env, ctx.user.id, ctx.user.id, 'agent');
      return json(r.results.reverse().map((x) => inflate(x as any, ['media'])));
    }
  }

  // --- messages log: every message names one of the caller's searches (search_id and/or listing_id); others' numbers are redacted
  if (p[1] === 'messages' && m === 'POST') {
    const arr = await body<any[]>(req);
    const list = Array.isArray(arr) ? arr : [arr];
    if (list.length > 200) throw new HttpError(400, 'too_many', 'Up to 200 messages per call');
    let inserted = 0;
    const touched = new Set<string>();
    for (const x of list) {
      if (!x || typeof x !== 'object' || !x.channel || !['in', 'out', 'call_missed'].includes(x.direction)) throw new HttpError(400, 'bad_message', 'Each message needs channel and direction in|out|call_missed');
      let sid: string | null = null;
      if (x.search_id) sid = (await ownSearch(ctx, x.search_id)).id;
      if (x.listing_id) {
        const l = await listingOf(ctx, x.listing_id);
        x.listing_id = l.id;
        if (sid && l.search_id !== sid) throw new HttpError(409, 'listing_other_search', `Listing ${x.listing_id} is not in search ${sid}`);
        sid = l.search_id;
      }
      if (!sid) throw new HttpError(400, 'search_required', 'Each message needs search_id or listing_id (one of your searches)');
      await existingContact(ctx, x.contact_id);
      const text = redactSensitive(x.text ?? null);
      const media = (Array.isArray(x.media) ? x.media : []).map((md: any) => (md && typeof md === 'object' ? { ...md, ...(md.caption ? { caption: redactSensitive(String(md.caption)) } : {}), ...(md.url ? { url: httpUrl(md.url, 'media url', false) } : {}) } : md));
      const r = await DB.prepare(`INSERT OR IGNORE INTO messages (id, search_id, contact_id, listing_id, channel, direction, text, tr, media, external_id, at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(rid('m_'), sid, x.contact_id ?? null, x.listing_id ?? null, x.channel, x.direction, await seal(env, ctx.user.id, text), await seal(env, ctx.user.id, trText(x.tr, text)), JSON.stringify(media), x.external_id ?? null, x.at ?? now()).run();
      // Logged again with a translation: keep the message, fill the missing translation.
      if (!r.meta.changes && x.external_id && trText(x.tr, text)) await DB.prepare('UPDATE messages SET tr=? WHERE channel=? AND external_id=? AND search_id=? AND tr IS NULL').bind(await seal(env, ctx.user.id, trText(x.tr, text)), x.channel, x.external_id, sid).run();
      inserted += r.meta.changes ?? 0;
      if (x.direction === 'out') touched.add(sid);
      // A reply about a place we want to see or take: DM the members (best-effort, quiet hours respected).
      if (r.meta.changes && x.direction === 'in') await notifyIncoming(env, { ...x, text });
    }
    for (const sid of touched) await touchAgent(env, sid);
    return json({ inserted, skipped: list.length - inserted });
  }

  // --- drafts
  if (p[1] === 'drafts') {
    if (p.length === 2 && m === 'POST') {
      const b = await body(req);
      const s = await ownSearch(ctx, b.search_id);
      if (!b.channel || !b.address || !b.text) throw new HttpError(400, 'missing', 'channel, address and text are required');
      const id = rid('d_');
      const t = now();
      b.listing_id = await sameSearchListing(ctx, s.id, b.listing_id);
      b.contact_id = await existingContact(ctx, b.contact_id);
      const auto = s.approval_mode === 'routine_auto' && ROUTINE.has(b.kind);
      await DB.prepare(`INSERT INTO drafts (id, search_id, contact_id, listing_id, channel, address, text, tr, kind, reason, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(id, s.id, b.contact_id ?? null, b.listing_id ?? null, b.channel, b.address, await seal(env, ctx.user.id, String(b.text)), await seal(env, ctx.user.id, trText(b.tr, b.text)), b.kind ?? 'other', b.reason ?? null, auto ? 'approved' : 'pending', t, t).run();
      const draft = await openDraft(env, await DB.prepare('SELECT * FROM drafts WHERE id=?').bind(id).first<any>());
      if (!auto) await draftToOwner(env, s, draft);
      else if (await sendViaBusiness(env, id)) draft.status = 'sent';
      await touchAgent(env, s.id);
      return json({ draft }, 201);
    }
    if (p.length === 2 && m === 'GET') {
      const q = new URL(req.url).searchParams;
      const sid = q.get('search_id');
      const st = q.get('status');
      const r = await DB.prepare(`SELECT d.* FROM drafts d JOIN members m ON m.search_id=d.search_id AND m.user_id=? AND m.role='owner'
        WHERE (? IS NULL OR d.search_id=?) AND (? IS NULL OR d.status=? OR (?='ready' AND d.status IN ('approved','edited'))) ORDER BY d.created_at`)
        .bind(ctx.user.id, sid, sid, st, st, st).all<any>();
      return json(await openRows(env, r.results ?? [], DRAFT));
    }
    if (p[2] && m === 'PATCH') {
      const b = await body(req);
      const d = await DB.prepare(`SELECT d.* FROM drafts d JOIN members m ON m.search_id=d.search_id AND m.user_id=? AND m.role='owner' WHERE d.id=?`).bind(ctx.user.id, p[2]).first<any>();
      if (!d) throw new HttpError(404, 'no_draft');
      if (!['sent', 'failed'].includes(b.status)) throw new HttpError(400, 'bad_status', 'status must be sent or failed');
      await DB.prepare('UPDATE drafts SET status=?, updated_at=? WHERE id=?').bind(b.status, now(), d.id).run();
      if (b.status === 'sent' && d.kind === 'event_book') await bookingDraftSent(env, d.id);
      if (d.kind === 'other') await orderDraft(env, d.id, b.status); // wave 10: an order the agent sent
      await touchAgent(env, d.search_id);
      return json({ draft: { ...(await openDraft(env, d)), status: b.status } });
    }
  }

  // --- threads: per-contact conversation summary shown in the Mini App ("Переписка")
  if (p[1] === 'threads' && p.length === 2) {
    if (m === 'GET') {
      const sid = new URL(req.url).searchParams.get('search_id') ?? '';
      const s = await ownSearch(ctx, sid);
      const r = await DB.prepare(`SELECT t.*, c.name contact_name FROM threads t LEFT JOIN contacts c ON c.id=t.contact_id WHERE t.search_id=? ORDER BY t.last_at DESC`).bind(s.id).all<any>();
      return json(await openRows(env, r.results ?? [], THREAD));
    }
    if (m === 'PUT') {
      const b = await body(req);
      const s = await ownSearch(ctx, b.search_id);
      if (!b.contact_id) throw new HttpError(400, 'missing', 'contact_id is required');
      await existingContact(ctx, b.contact_id);
      const c = await DB.prepare('SELECT id, name FROM contacts WHERE id=?').bind(b.contact_id).first<any>();
      if (!c) throw new HttpError(404, 'no_contact', `Contact ${b.contact_id} not found`);
      if (b.state != null && !THREAD_STATES.includes(b.state)) throw new HttpError(400, 'bad_state', `state must be one of ${THREAD_STATES.join(', ')}`);
      if (b.listing_id) b.listing_id = await sameSearchListing(ctx, s.id, b.listing_id);
      if (b.last_at != null && Number.isNaN(Date.parse(b.last_at))) throw new HttpError(400, 'bad_last_at', 'last_at must be an ISO time');
      const old = await DB.prepare('SELECT * FROM threads WHERE search_id=? AND contact_id=?').bind(s.id, c.id).first<any>();
      if (old) await openRows(env, [old], THREAD);
      const txt = (k: string) => (k in b ? (b[k] == null ? null : String(b[k]).trim().slice(0, 600) || null) : old?.[k] ?? null);
      const row = {
        listing_id: 'listing_id' in b ? b.listing_id ?? null : old?.listing_id ?? null,
        state: b.state ?? old?.state ?? 'waiting_them',
        known: txt('known'), open: txt('open'), last: txt('last'),
        last_at: b.last_at ?? old?.last_at ?? now(),
      };
      await DB.prepare(`INSERT INTO threads (search_id, contact_id, listing_id, state, known, open, last, last_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(search_id, contact_id) DO UPDATE SET listing_id=excluded.listing_id, state=excluded.state, known=excluded.known, open=excluded.open,
        last=excluded.last, last_at=excluded.last_at, updated_at=excluded.updated_at`)
        .bind(s.id, c.id, row.listing_id, row.state, await seal(env, ctx.user.id, row.known), await seal(env, ctx.user.id, row.open), await seal(env, ctx.user.id, row.last), row.last_at, now()).run();
      if (!old || old.state !== row.state || old.last !== row.last) {
        await event(env, s.id, 'thread', c.id, 'agent', { contact_name: c.name, state: row.state, last: sealOn(env) ? null : row.last, listing_id: row.listing_id, prev_state: old?.state ?? null });
      }
      return json({ thread: { search_id: s.id, contact_id: c.id, ...row }, created: !old }, old ? 200 : 201);
    }
  }

  // --- viewings
  if (p[1] === 'viewings' && p[2] && m === 'PUT') {
    const b = await body(req);
    const s = await ownSearch(ctx, b.search_id);
    b.listing_id = await sameSearchListing(ctx, s.id, b.listing_id);
    if (!b.listing_id) throw new HttpError(404, 'no_listing', 'listing_id is required');
    const vid = p[2] === 'new' ? rid('v_') : p[2];
    const t = now();
    const old = p[2] === 'new' ? null : await DB.prepare('SELECT * FROM viewings WHERE id=? AND search_id=?').bind(vid, s.id).first<any>();
    if (p[2] !== 'new' && !old && (await DB.prepare('SELECT 1 FROM viewings WHERE id=?').bind(vid).first())) throw new HttpError(404, 'no_viewing', `Viewing ${vid} is not in this search`);
    if (old) for (const k of ['starts_at', 'status', 'meet_note', 'outcome']) if (!(k in b)) b[k] = old[k];
    if (!b.starts_at) throw new HttpError(400, 'missing', 'starts_at is required for a new viewing');
    await DB.prepare(`INSERT INTO viewings (id, search_id, listing_id, starts_at, status, meet_note, outcome, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET starts_at=excluded.starts_at, status=excluded.status, meet_note=excluded.meet_note, outcome=excluded.outcome, updated_at=excluded.updated_at`)
      .bind(vid, s.id, b.listing_id, b.starts_at, b.status ?? 'proposed', b.meet_note ?? null, b.outcome ?? null, t, t).run();
    await event(env, s.id, 'viewing_changed', vid, 'agent', { status: b.status, starts_at: b.starts_at });
    return json({ viewing: await DB.prepare('SELECT * FROM viewings WHERE id=?').bind(vid).first() });
  }

  // --- deal dates extracted from the lease (replaces data.dates, keeps the rest of the deal)
  if (p[1] === 'deals' && p[2] && p[3] === 'dates' && m === 'PUT') {
    const l = await listingOf(ctx, p[2]);
    const b = await body(req);
    const dates = cleanDates(Array.isArray(b) ? b : b.dates);
    const sens = sensitive(JSON.stringify(dates));
    if (sens) throw new HttpError(400, 'sensitive', `Dates look like they contain ${sens}.`);
    const cur = await DB.prepare('SELECT data FROM deals WHERE listing_id=?').bind(l.id).first<{ data: string }>();
    const data = { ...parseJson<any>(cur?.data, {}), dates };
    await DB.prepare('INSERT INTO deals (listing_id, search_id, data, updated_at) VALUES (?,?,?,?) ON CONFLICT(listing_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at')
      .bind(l.id, l.search_id, JSON.stringify(data), now()).run();
    return json({ deal: data });
  }

  // --- wave 5: asked vs agreed monthly price (owner only, outside deals.data)
  if (p[1] === 'deals' && p[2] && p[3] === 'prices' && m === 'PUT') {
    const l = await listingOf(ctx, p[2]);
    return json(await setDealPrices(env, l.id, await body(req)));
  }

  // --- deals
  if (p[1] === 'deals' && p[2] && p.length === 3 && m === 'PUT') {
    const l = await listingOf(ctx, p[2]);
    const b = await body(req);
    const sens = sensitive(JSON.stringify(b));
    if (sens) {
      throw new HttpError(400, 'sensitive', `Deal data looks like it contains ${sens}. Remove it.`);
    }
    await DB.prepare('INSERT INTO deals (listing_id, search_id, data, updated_at) VALUES (?,?,?,?) ON CONFLICT(listing_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at')
      .bind(l.id, l.search_id, JSON.stringify(b), now()).run();
    await autoDealPrices(env, l, b);
    return json({ deal: b });
  }

  // --- admin: re-register the Telegram webhook (after adding update types)
  if (p[1] === 'admin' && p[2] === 'webhook' && m === 'POST') {
    const h = await DB.prepare('SELECT is_admin FROM hunters WHERE user_id=?').bind(ctx.user.id).first<any>();
    if (!h?.is_admin) throw new HttpError(403, 'not_admin');
    const { tg } = await import('./tg');
    const { BOT_COMMANDS, BOT_UPDATES } = await import('./bot');
    await tg(env, 'setWebhook', { url: `${env.PUBLIC_URL}/tg/webhook`, secret_token: env.TG_WEBHOOK_SECRET.trim(), allowed_updates: BOT_UPDATES });
    await tg(env, 'setMyCommands', { commands: BOT_COMMANDS });
    return json({ ok: true, info: await tg(env, 'getWebhookInfo', {}) });
  }

  // --- notify
  if (p[1] === 'notify' && m === 'POST') {
    const b = await body(req);
    const s = await ownSearch(ctx, b.search_id);
    await notify(env, s, b.text, b.to ?? 'owner');
    return json({ ok: true });
  }

  throw new HttpError(404, 'not_found', `${m} ${path}`);
}

export function normAddr(channel: string, a: string): string {
  const s = String(a).trim();
  if (channel === 'whatsapp' || channel === 'viber' || channel === 'phone' || channel === 'line_phone') {
    const d = s.replace(/[^\d]/g, '');
    return d ? `+${d}` : s;
  }
  if (channel === 'telegram') return s.startsWith('@') || /^\d+$/.test(s) ? s.toLowerCase() : '@' + s.toLowerCase();
  if (channel === 'email') return s.toLowerCase();
  // LINE IDs are lower-case; a line.me/ti/p/ token is case-sensitive.
  if (channel === 'line') return /line\.me\//i.test(s) ? s : s.toLowerCase();
  return s;
}

async function contactFull(ctx: Ctx, cid: string, searchId: string | null = null) {
  const env = ctx.env;
  const [c, ch, ls] = await env.DB.batch<any>([
    env.DB.prepare('SELECT * FROM contacts WHERE id=?').bind(cid),
    env.DB.prepare('SELECT channel, address, display FROM contact_channels WHERE contact_id=?').bind(cid),
    // Listings with this person only from the caller's own searches.
    env.DB.prepare(`SELECT l.id, l.title, l.status, l.decision, l.search_id FROM listing_contacts lc JOIN listings l ON l.id=lc.listing_id
      JOIN members m ON m.search_id=l.search_id AND m.user_id=? AND m.role='owner' WHERE lc.contact_id=?`).bind(ctx.user.id, cid),
  ]);
  // Wave 3: notes about this person from the hunter's own projects; notes_elsewhere = not from `searchId` (warn the hunter).
  const pn = await contactNotes(env, cid, ctx.user.id, searchId);
  return { contact: c.results?.[0] ?? null, channels: ch.results ?? [], listings: ls.results ?? [], notes: pn.notes, notes_elsewhere: pn.notes_elsewhere, stats: pn.stats };
}

export { sensitive } from './util';

async function memberIds(env: Env, sid: string): Promise<string[]> {
  return ((await env.DB.prepare('SELECT user_id FROM members WHERE search_id=?').bind(sid).all<{ user_id: string }>()).results ?? []).map((r) => r.user_id);
}

const day10 = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const txt = (v: unknown, n: number) => (v == null ? null : String(v).trim().slice(0, n) || null);

/** Shared by the agent API and the Mini App. actor = 'agent' or a user id. */
export async function insertExpense(env: Env, s: { id: string; brief?: any }, b: any, actor: string) {
  const ids = await memberIds(env, s.id);
  const title = txt(b.title, 120);
  const amount = Math.round(Number(b.amount));
  if (!title) throw new HttpError(400, 'missing', 'title is required');
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'bad_amount', 'amount must be a positive number (main units)');
  const paid = b.paid_by ?? (actor !== 'agent' ? actor : null);
  if (!paid || !ids.includes(paid)) throw new HttpError(400, 'bad_paid_by', 'paid_by must be a member user_id (search_get → members)');
  const kind = (EXPENSE_KINDS as readonly string[]).includes(b.kind) ? b.kind : 'other';
  const method = (PAY_METHODS as readonly string[]).includes(b.method) ? b.method : null;
  const split = b.split == null ? null : cleanWeights(b.split, ids);
  const brief = typeof s.brief === 'object' && s.brief ? s.brief : parseJson<any>((s as any).brief, {});
  const currency = txt(b.currency, 8)?.toUpperCase() ?? brief.currency ?? null;
  if (!currency) throw new HttpError(400, 'missing', 'currency is required (the search brief has none)');
  const date = day10(b.date) ?? new Date().toISOString().slice(0, 10);
  const note = txt(b.note, 300);
  const sens = sensitive(`${title} ${note ?? ''}`);
  if (sens) throw new HttpError(400, 'sensitive', `The expense looks like it contains ${sens}.`);
  const receipt = b.receipt ? String(b.receipt) : null;
  if (receipt && !receipt.startsWith(`r/${s.id}/`)) throw new HttpError(400, 'bad_receipt');
  if (b.listing_id != null && b.listing_id !== '' && !(await env.DB.prepare('SELECT 1 FROM listings WHERE id=? AND search_id=?').bind(String(b.listing_id), s.id).first()))
    throw new HttpError(404, 'no_listing', `Listing ${b.listing_id} is not in this search`);
  const id = rid('x_');
  const t = now();
  await env.DB.prepare(`INSERT INTO expenses (id, search_id, listing_id, title, amount, currency, date, paid_by, split, kind, method, note, receipt, created_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, s.id, b.listing_id ?? null, title, amount, currency, date, paid, split ? JSON.stringify(split) : null, kind, method, note, receipt, actor, t, t).run();
  const row = await env.DB.prepare('SELECT * FROM expenses WHERE id=?').bind(id).first<any>();
  await event(env, s.id, 'expense', id, actor, { title, amount, currency, paid_by: paid, kind });
  return { ...row, split };
}

export async function upsertDocument(env: Env, l: { id: string; search_id: string }, id: string, b: any, actor: string) {
  const old = id === 'new' ? null : await env.DB.prepare('SELECT * FROM documents WHERE id=?').bind(id).first<any>();
  const v = (k: string) => (k in b ? b[k] : old?.[k] ?? null);
  const kind = v('kind') ?? 'other';
  if (!(DOC_KINDS as readonly string[]).includes(kind)) throw new HttpError(400, 'bad_kind', `kind must be one of ${DOC_KINDS.join(', ')}`);
  const status = v('status') ?? (b.tg_file_id || old?.tg_file_id ? 'have' : 'request');
  if (!(DOC_STATUS as readonly string[]).includes(status)) throw new HttpError(400, 'bad_status', `status must be one of ${DOC_STATUS.join(', ')}`);
  const title = txt(v('title'), 160);
  if (!title) throw new HttpError(400, 'missing', 'title is required');
  const summary = 'summary' in b ? cleanSummary(b.summary) : parseJson(old?.summary, null);
  const row = {
    kind, status, title, summary,
    due_date: day10(v('due_date')), doc_date: day10(v('doc_date')), signed_at: day10(v('signed_at')),
    version: v('version') == null ? null : Number(v('version')) || null, pages: v('pages') == null ? null : Number(v('pages')) || null,
    note: txt(v('note'), 200),
    // Wave 6: which lease term the document belongs to (NULL = the first; 2, 3… = extensions, deal_terms.seq).
    term_seq: v('term_seq') == null || v('term_seq') === '' || Number(v('term_seq')) <= 1 ? null : Math.floor(Number(v('term_seq'))) || null,
  };
  const sens = sensitive(JSON.stringify(row));
  if (sens) throw new HttpError(400, 'sensitive', `The document data looks like it contains ${sens}. Summaries never hold ID, passport or card numbers.`);
  const t = now();
  const did = old?.id ?? rid('doc_');
  await env.DB.prepare(`INSERT INTO documents (id, search_id, listing_id, kind, title, status, due_date, version, doc_date, signed_at, pages, note, summary,
      tg_file_id, tg_chat_id, file_kind, file_name, mime, size, created_by, created_at, updated_at, term_seq)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, title=excluded.title, status=excluded.status, term_seq=excluded.term_seq,
      due_date=excluded.due_date, version=excluded.version, doc_date=excluded.doc_date, signed_at=excluded.signed_at, pages=excluded.pages, note=excluded.note,
      summary=excluded.summary, tg_file_id=coalesce(excluded.tg_file_id, tg_file_id), tg_chat_id=coalesce(excluded.tg_chat_id, tg_chat_id),
      file_kind=coalesce(excluded.file_kind, file_kind), file_name=coalesce(excluded.file_name, file_name), mime=coalesce(excluded.mime, mime),
      size=coalesce(excluded.size, size), updated_at=excluded.updated_at`)
    .bind(did, l.search_id, l.id, row.kind, row.title, row.status, row.due_date, row.version, row.doc_date, row.signed_at, row.pages, row.note,
      row.summary ? JSON.stringify(row.summary) : null, b.tg_file_id ?? null, b.tg_chat_id ?? null, b.file_kind ?? null, b.file_name ?? null, b.mime ?? null, b.size ?? null,
      actor, t, t, row.term_seq).run();
  if (!old || old.status !== row.status) await event(env, l.search_id, 'document', did, actor, { title: row.title, kind: row.kind, status: row.status, listing_id: l.id });
  return env.DB.prepare('SELECT * FROM documents WHERE id=?').bind(did).first<any>();
}

const ISSUE_STATUS = ['open', 'scheduled', 'fixed'];
export async function upsertIssue(env: Env, s: { id: string }, old: any, b: any, actor: string) {
  const v = (k: string) => (k in b ? b[k] : old?.[k] ?? null);
  const status = v('status') ?? 'open';
  if (!ISSUE_STATUS.includes(status)) throw new HttpError(400, 'bad_status', 'status must be open, scheduled or fixed');
  const title = txt(v('title'), 160);
  if (!title) throw new HttpError(400, 'missing', 'title is required');
  const sch = v('scheduled_at');
  if (sch != null && Number.isNaN(Date.parse(sch))) throw new HttpError(400, 'bad_time', 'scheduled_at must be an ISO time');
  const note = txt(v('note'), 300);
  const t = now();
  const id = old?.id ?? rid('is_');
  const fixed = status === 'fixed' ? v('fixed_at') ?? old?.fixed_at ?? t : null;
  const listing = v('listing_id') ?? (await env.DB.prepare('SELECT listing_id FROM deals WHERE search_id=? ORDER BY updated_at DESC LIMIT 1').bind(s.id).first<any>())?.listing_id ?? null;
  await env.DB.prepare(`INSERT INTO issues (id, search_id, listing_id, title, status, note, scheduled_at, fixed_at, reported_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title, status=excluded.status, note=excluded.note, scheduled_at=excluded.scheduled_at, fixed_at=excluded.fixed_at, updated_at=excluded.updated_at`)
    .bind(id, s.id, listing, title, status, note, sch ?? null, fixed, old?.reported_by ?? actor, old?.created_at ?? t, t).run();
  if (!old || old.status !== status) await event(env, s.id, 'issue', id, actor, { title, status, note });
  return env.DB.prepare('SELECT * FROM issues WHERE id=?').bind(id).first<any>();
}

const HC_ROLES = ['owner', 'manager', 'cleaning', 'pool', 'garden', 'repair', 'security', 'internet', 'other'];
function cleanHouseContact(b: any) {
  const name = txt(b.name, 80);
  if (!name) throw new HttpError(400, 'missing', 'name is required');
  const cost = b.cost == null || b.cost === '' ? null : Math.round(Number(b.cost));
  if (cost != null && !Number.isFinite(cost)) throw new HttpError(400, 'bad_cost', 'cost must be a number');
  return {
    name, role: HC_ROLES.includes(b.role) ? b.role : 'other', note: txt(b.note, 160), cost, currency: txt(b.currency, 8),
    period: ['month', 'week', 'visit', 'once'].includes(b.period) ? b.period : null, payer: ['rent', 'us'].includes(b.payer) ? b.payer : null,
    schedule: txt(b.schedule, 80), channel: txt(b.channel, 20), address: b.address ? normAddr(String(b.channel ?? ''), String(b.address)) : null,
    listing_id: b.listing_id ?? null, contact_id: b.contact_id ?? null, sort: Number(b.sort) || 0,
  };
}

/** On-site checklist results per listing: per item counts and notes, photo keys. */
export async function onsiteOf(env: Env, sid: string) {
  const [rows, photos] = await env.DB.batch<any>([
    env.DB.prepare(`SELECT c.*, u.display_name name FROM site_checks c JOIN listings l ON l.id=c.listing_id JOIN users u ON u.id=c.user_id WHERE l.search_id=? ORDER BY c.at`).bind(sid),
    env.DB.prepare(`SELECT p.key, p.listing_id, p.user_id FROM site_photos p JOIN listings l ON l.id=p.listing_id WHERE l.search_id=? ORDER BY p.at`).bind(sid),
  ]);
  const out: Record<string, { items: Record<string, { ok: number; not_ok: number; notes: { user_id: string; name: string; ok: boolean | null; note: string }[] }>; photos: string[] }> = {};
  for (const r of rows.results ?? []) {
    const o = (out[r.listing_id] ??= { items: {}, photos: [] });
    const it = (o.items[r.item] ??= { ok: 0, not_ok: 0, notes: [] });
    if (r.ok === 1) it.ok++;
    if (r.ok === 0) it.not_ok++;
    if (r.note) it.notes.push({ user_id: r.user_id, name: r.name, ok: r.ok == null ? null : r.ok === 1, note: r.note });
  }
  for (const p of photos.results ?? []) (out[p.listing_id] ??= { items: {}, photos: [] }).photos.push(p.key);
  return out;
}
