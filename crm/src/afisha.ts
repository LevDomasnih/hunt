// Wave 7 · Афиша: a curated daily events feed per region. The agent collects events from read-only sources (Telegram chats
// flagged `events: true` in the pack, venue pages, the places layer) and upserts them here (dedupe across sources); the Mini App
// shows each search the events of the whole region (wave 8.1: no distance cutoff; far ones only sink in the ranking and show the
// ride time; a district filter narrows the list), ranked for its members
// ("a good shuffle": taste + quality + fit, then a diversity re-rank, see afisha-rank.ts). "Записаться" creates a booking the
// agent turns into an approval draft to the organizer; booked events show in the home Plan and get a reminder 2 h before.
import { Env, HttpError, json, body, now, rid, parseJson, event, sensitive, httpUrl } from './util';
import { isOwnContact, ownerOfSearch, requireContact } from './household';
import { countryOf } from './members';
import { packData } from './life';
import { basePlaces } from './assets';
import { member } from './roles';
import { homePoint, regionInfo, minutesKm } from './homepoint';
import { searchTzOf, localDay } from './local';
import { dealDates } from './deal';
import { draftToOwner, dmMembers, dm, appUrl } from './notify';
import { rateLimit, putEventPhoto } from './media';
import { proxySrc } from './ssrf';
import {
  CATEGORIES, SOCIAL, LANGS, TAGS, INTERESTS, occurrences, recurringLabel, scoreItem, diversify, passFilters, isDuplicate, addDay, isoWd,
  kmBetween, normTitle, likedBefore, type Recurrence, type RankItem, type RankCtx, type Scored, type FeedbackRow, type MemberTaste,
} from './afisha-rank';

const PRICE_KINDS = ['free', 'paid', 'on_site', 'unknown'];
const ENTRY = ['free', 'fee', 'min_spend', 'guest_list'];
const BOOKING = ['none', 'message', 'ticket'];
const VIBES = ['chill', 'party', 'sport', 'meet'];
const CROWDS = ['expats', 'locals', 'mixed'];
const ORG_CHANNELS = ['telegram', 'whatsapp', 'instagram', 'facebook', 'email', 'phone', 'web'];
const SOURCE_KINDS = ['telegram', 'instagram', 'facebook', 'web', 'place', 'pack', 'user'];
const STATUSES = ['active', 'cancelled', 'hidden'];
const BOOK_KINDS = ['join', 'guest_list', 'table', 'slot'];
const BOOK_STATUSES = ['requested', 'drafted', 'asked', 'booked', 'declined', 'cancelled', 'attended'];
const AGE_BANDS = ['18-24', '25-30', '31-40', '40+'];
const ISO_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2})$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SEA_TOPICS = new Set(['sea', 'snorkel', 'diving', 'boat']);

// ---------------------------------------------------------------- validation

function txt(v: unknown, field: string, max: number, required = false): string | null {
  const s = v == null ? '' : String(v).trim();
  if (!s) { if (required) throw new HttpError(400, 'missing', `${field} is required`); return null; }
  if (s.length > max) throw new HttpError(400, 'too_long', `${field} is longer than ${max} characters`);
  const sn = sensitive(s);
  if (sn) throw new HttpError(400, 'sensitive', `${field}: ${sn}. Hunt never stores passport, ID or card numbers.`);
  return s;
}
const oneOf = (v: unknown, list: readonly string[], field: string) => {
  if (v == null || v === '') return null;
  if (!list.includes(String(v))) throw new HttpError(400, `bad_${field}`, `${field} must be one of ${list.join(', ')}`);
  return String(v);
};
const num = (v: unknown, field: string, lo: number, hi: number) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) throw new HttpError(400, `bad_${field}`, `${field} must be a number ${lo}..${hi}`);
  return n;
};
const bool = (v: unknown) => (v == null ? null : v ? 1 : 0);
const isoLocal = (v: unknown, field: string) => {
  if (v == null || v === '') return null;
  const s = String(v);
  if (!ISO_LOCAL.test(s) || Number.isNaN(Date.parse(s))) throw new HttpError(400, 'bad_time', `${field} must be local time with an offset, e.g. 2026-11-21T18:00:00+08:00`);
  return s.length === 22 ? s.slice(0, 16) + ':00' + s.slice(16) : s;
};
function cleanRecurrence(v: unknown): Recurrence | null {
  if (v == null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'bad_recurrence', 'recurrence must be an object');
  const r: any = v;
  const freq = oneOf(r.freq, ['daily', 'weekly', 'monthly', 'seasonal'], 'recurrence');
  if (!freq || !/^\d{2}:\d{2}$/.test(String(r.time ?? ''))) throw new HttpError(400, 'bad_recurrence', 'recurrence needs freq and time "HH:MM"');
  const ints = (x: unknown, lo: number, hi: number, f: string) => {
    if (x == null) return undefined;
    if (!Array.isArray(x) || !x.length || !x.every((n) => Number.isInteger(n) && n >= lo && n <= hi)) throw new HttpError(400, 'bad_recurrence', `recurrence.${f} must be a list of ${lo}..${hi}`);
    return [...new Set(x as number[])].sort((a, b) => a - b);
  };
  const out: Recurrence = { freq: freq as Recurrence['freq'], time: r.time };
  if (r.end != null) { if (!/^\d{2}:\d{2}$/.test(String(r.end))) throw new HttpError(400, 'bad_recurrence', 'recurrence.end must be "HH:MM"'); out.end = r.end; }
  out.weekdays = ints(r.weekdays, 1, 7, 'weekdays');
  out.months = ints(r.months, 1, 12, 'months');
  if (r.day != null) { if (!Number.isInteger(r.day) || r.day < 1 || r.day > 31) throw new HttpError(400, 'bad_recurrence', 'recurrence.day must be 1..31'); out.day = r.day; }
  if (r.nth != null) { if (![1, 2, 3, 4, -1].includes(r.nth)) throw new HttpError(400, 'bad_recurrence', 'recurrence.nth must be 1..4 or -1'); out.nth = r.nth; }
  for (const k of ['from', 'until'] as const) if (r[k] != null) { if (!DAY.test(String(r[k]))) throw new HttpError(400, 'bad_recurrence', `recurrence.${k} must be YYYY-MM-DD`); out[k] = r[k]; }
  if (freq === 'weekly' && !out.weekdays) throw new HttpError(400, 'bad_recurrence', 'weekly needs weekdays');
  if (freq === 'seasonal' && !out.months) throw new HttpError(400, 'bad_recurrence', 'seasonal needs months');
  if (freq === 'monthly' && !out.day && !(out.nth && out.weekdays)) throw new HttpError(400, 'bad_recurrence', 'monthly needs day, or nth + weekdays');
  for (const k of Object.keys(out) as (keyof Recurrence)[]) if (out[k] === undefined) delete out[k];
  return out;
}
function cleanTags(v: unknown): string[] | null {
  if (v == null) return null;
  if (!Array.isArray(v)) throw new HttpError(400, 'bad_tags', 'tags must be a list');
  const bad = v.find((t) => !TAGS.includes(String(t)));
  if (bad != null) throw new HttpError(400, 'bad_tags', `unknown tag ${bad}; known: ${TAGS.join(', ')}`);
  return [...new Set(v.map(String))];
}

/** Column values from an agent body (full = create; otherwise only the keys present). */
function eventCols(b: any, full: boolean): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  const has = (k: string) => full || k in b;
  if (has('city')) c.city = b.city == null || b.city === '' ? null : String(b.city).toLowerCase().slice(0, 30);
  if (has('area')) c.area = b.area == null || b.area === '' ? null : String(b.area).toLowerCase().slice(0, 40);
  if (has('title')) c.title = txt(b.title, 'title', 140, true);
  if (has('title_en')) c.title_en = txt(b.title_en, 'title_en', 140);
  if (has('about_ru')) c.about_ru = txt(b.about_ru, 'about_ru', 400);
  if (has('about_en')) c.about_en = txt(b.about_en, 'about_en', 400);
  if (has('category')) { c.category = oneOf(b.category, CATEGORIES, 'category'); if (!c.category) throw new HttpError(400, 'bad_category', `category must be one of ${CATEGORIES.join(', ')}`); }
  if (has('topic')) { const t = b.topic == null || b.topic === '' ? null : String(b.topic); if (t && !/^[a-z_]{2,30}$/.test(t)) throw new HttpError(400, 'bad_topic', 'topic must be a slug'); c.topic = t; }
  if (has('starts_at')) c.starts_at = isoLocal(b.starts_at, 'starts_at');
  if (has('ends_at')) c.ends_at = isoLocal(b.ends_at, 'ends_at');
  if (has('recurrence')) { const r = cleanRecurrence(b.recurrence); c.recurrence = r ? JSON.stringify(r) : null; }
  if (has('place_name')) c.place_name = txt(b.place_name, 'place_name', 140);
  if (has('place_id')) c.place_id = b.place_id == null || b.place_id === '' ? null : String(b.place_id).slice(0, 80);
  if (has('lat')) c.lat = num(b.lat, 'lat', -90, 90);
  if (has('lng')) c.lng = num(b.lng, 'lng', -180, 180);
  if (has('map_url')) c.map_url = httpUrl(b.map_url, 'map_url');
  if (has('price_kind')) c.price_kind = oneOf(b.price_kind, PRICE_KINDS, 'price_kind') ?? 'unknown';
  if (has('price')) { const p = num(b.price, 'price', 0, 1e11); c.price = p == null ? null : Math.round(p); }
  if (has('currency')) c.currency = b.currency == null || b.currency === '' ? null : String(b.currency).toUpperCase().slice(0, 3);
  if (has('price_note')) c.price_note = txt(b.price_note, 'price_note', 140);
  if (has('entry')) c.entry = oneOf(b.entry, ENTRY, 'entry');
  if (has('lang')) c.lang = oneOf(b.lang, LANGS, 'lang');
  if (has('booking')) c.booking = oneOf(b.booking, BOOKING, 'booking') ?? 'none';
  if (has('ticket_url')) c.ticket_url = httpUrl(b.ticket_url, 'ticket_url');
  if (has('organizer_name')) c.organizer_name = txt(b.organizer_name, 'organizer_name', 120);
  if (has('organizer_channel')) c.organizer_channel = oneOf(b.organizer_channel, ORG_CHANNELS, 'organizer_channel');
  if (has('organizer_address')) c.organizer_address = txt(b.organizer_address, 'organizer_address', 200);
  if (has('organizer_contact_id')) c.organizer_contact_id = b.organizer_contact_id == null || b.organizer_contact_id === '' ? null : String(b.organizer_contact_id);
  if (has('organizer_lang')) c.organizer_lang = b.organizer_lang == null || b.organizer_lang === '' ? null : String(b.organizer_lang).toLowerCase().slice(0, 5);
  if (has('source_kind')) c.source_kind = oneOf(b.source_kind, SOURCE_KINDS, 'source_kind');
  if (has('source_url')) c.source_url = httpUrl(b.source_url, 'source_url');
  if (has('source_name')) c.source_name = txt(b.source_name, 'source_name', 140);
  if (has('source_rep')) c.source_rep = num(b.source_rep, 'source_rep', 0, 1);
  if (has('photo_url') || has('photo_reuse')) c.photo_url = b.photo_reuse === false ? null : httpUrl(b.photo_url, 'photo_url');
  if (has('photo_credit')) c.photo_credit = txt(b.photo_credit, 'photo_credit', 140);
  if (has('photo_source_url')) c.photo_source_url = httpUrl(b.photo_source_url, 'photo_source_url');
  if (has('photo_score')) c.photo_score = num(b.photo_score, 'photo_score', 0, 1);
  if (has('age_min')) { const a = b.age_min == null || b.age_min === '' ? null : Number(b.age_min); if (a != null && ![18, 21].includes(a)) throw new HttpError(400, 'bad_age_min', 'age_min must be 18 or 21'); c.age_min = a; }
  if (has('dress_code')) c.dress_code = txt(b.dress_code, 'dress_code', 80);
  if (has('vibe')) c.vibe = oneOf(b.vibe, VIBES, 'vibe');
  if (has('crowd')) c.crowd = oneOf(b.crowd, CROWDS, 'crowd');
  for (const k of ['beginner', 'outdoor', 'sea']) if (has(k)) c[k] = bool(b[k]);
  if (has('tags')) { const t = cleanTags(b.tags); c.tags = t ? JSON.stringify(t) : null; }
  if (has('quality')) c.quality = num(b.quality, 'quality', 0, 1);
  if (has('status')) c.status = oneOf(b.status, STATUSES, 'status') ?? 'active';
  return c;
}

// ---------------------------------------------------------------- views

type Row = Record<string, any>;
const effectsOf = (pack: any) => (pack?.events?.effects ?? {}) as Record<string, { shader: string; mix?: number } | null>;
export function effectFor(pack: any, ev: { topic?: string | null; category: string }) {
  const fx = effectsOf(pack);
  const pick = ev.topic && ev.topic in fx ? fx[ev.topic] : ev.category in fx ? fx[ev.category] : null;
  return pick && pick.shader && pick.shader !== 'none' ? { shader: pick.shader, mix: pick.mix ?? 1 } : null;
}
/**
 * The event photo as the app gets it: an https source (`url`), or one uploaded by the agent into KV (photo_url = "kv:<key>"),
 * served by the member-checked media proxy (`src`; the app adds the photo token). Credit and source link always travel along.
 */
export function photoOf(r: Row, withScore = false) {
  if (!r.photo_url) return null;
  const pu = String(r.photo_url);
  const kv = pu.startsWith('kv:') ? pu.slice(3) : null;
  const stale = !!r.photo_stale_at;
  // Wave 9: a photo by link that failed last time is not shown (category card) until the sweep brings a new one.
  if (stale && !withScore) return null;
  // Wave 9 ("link, don't store"): an https photo is shown through the image proxy (viewers' IPs never reach the third-party
  // site); the members never get the raw URL. Demo photos (/demo/…) are local assets. Anything else (http) is not shown.
  const view = kv ? { url: null, src: `/app/kv/${encodeURIComponent(kv)}` }
    : /^https:\/\//.test(pu) ? { url: withScore ? pu : null, src: proxySrc(r.id, pu) }
    : pu.startsWith('/demo/') ? { url: pu } : withScore ? { url: pu } : null;
  if (!view) return null;
  return {
    ...view, credit: r.photo_credit, source_url: r.photo_source_url,
    ...(withScore ? { score: r.photo_score, stored: !!kv, stale, fail: r.photo_fail ?? null } : {}),
  };
}
/** Seconds an uploaded event photo lives: ~30 days after the last occurrence (recurring without `until`: a year). */
export function eventPhotoTtl(r: Row, nowMs = Date.now()): number {
  const rec = parseJson<Recurrence | null>(r.recurrence, null);
  const last = rec ? (rec.until ? Date.parse(rec.until + 'T23:59:59Z') : nowMs + 335 * 864e5) : Date.parse(String(r.ends_at ?? r.starts_at ?? ''));
  const end = (Number.isFinite(last) ? last : nowMs) + 30 * 864e5;
  return Math.min(365 * 86400, Math.max(86400, Math.round((end - nowMs) / 1000)));
}
export function eventView(r: Row, pack: any) {
  return {
    id: r.id, country: r.country, city: r.city, area: r.area, title: r.title, title_en: r.title_en, about_ru: r.about_ru, about_en: r.about_en,
    category: r.category, topic: r.topic, starts_at: r.starts_at, ends_at: r.ends_at, recurrence: parseJson(r.recurrence, null),
    place_name: r.place_name, place_id: r.place_id, lat: r.lat, lng: r.lng, map_url: r.map_url,
    price_kind: r.price_kind, price: r.price, currency: r.currency, price_note: r.price_note, entry: r.entry, lang: r.lang,
    booking: r.booking, ticket_url: r.ticket_url, organizer_name: r.organizer_name, organizer_channel: r.organizer_channel,
    organizer_address: r.organizer_address, organizer_contact_id: r.organizer_contact_id, organizer_lang: r.organizer_lang,
    source_kind: r.source_kind, source_url: r.source_url, source_name: r.source_name, source_rep: r.source_rep, sources: parseJson(r.sources, []),
    photo: photoOf(r, true),
    age_min: r.age_min, dress_code: r.dress_code, vibe: r.vibe, crowd: r.crowd, beginner: !!r.beginner, outdoor: !!r.outdoor, sea: !!r.sea,
    tags: parseJson(r.tags, []), quality: r.quality, status: r.status, search_id: r.search_id, created_by: r.created_by,
    created_at: r.created_at, updated_at: r.updated_at, effect: effectFor(pack, r as any),
  };
}
const orgKey = (r: Row) => (r.organizer_contact_id ? 'c:' + r.organizer_contact_id : r.organizer_address ? 'a:' + String(r.organizer_address).toLowerCase() : r.organizer_name ? 'n:' + normTitle(r.organizer_name) : null);
const placeKey = (r: Row) => (r.place_id ? 'p:' + r.place_id : r.place_name ? 'n:' + normTitle(r.place_name) : null);

function bookingView(b: Row, ev: Row | null, names: Map<string, string>) {
  return {
    id: b.id, event_id: b.event_id, occ: b.occ, starts_at: b.starts_at, search_id: b.search_id, title: ev?.title ?? null,
    organizer: ev ? { name: ev.organizer_name, channel: ev.organizer_channel, address: ev.organizer_address, lang: ev.organizer_lang, contact_id: ev.organizer_contact_id } : null,
    who: parseJson<string[]>(b.who, []).map((u) => ({ user_id: u, name: names.get(u) ?? null })), guests: b.guests, kind: b.kind, note: b.note,
    status: b.status, draft_id: b.draft_id, requested_by: b.requested_by, created_at: b.created_at, updated_at: b.updated_at,
  };
}

// ---------------------------------------------------------------- the feed for one search

interface FeedOpts { viewer: string | null; from: string; to: string; seed: number; f: Set<string>; tab: 'all' | 'social' }
interface SearchRow { id: string; region: string; brief: any; status?: string }

/** Everything the ranking needs for one search, loaded in a handful of D1 statements. */
async function loadCtx(env: Env, s: SearchRow, from: string, to: string) {
  const country = countryOf(s.region);
  const pack = (await packData(env))?.[country] ?? {};
  const tz = searchTzOf(s);
  const [home, ri] = await Promise.all([homePoint(env, s), regionInfo(env, s.region)]);
  const DB = env.DB;
  const since = new Date(Date.now() - 180 * 864e5).toISOString();
  const [evs, mem, fb, vw, dl, mo, own, bk, sc, vr] = await DB.batch<any>([
    DB.prepare(`SELECT * FROM afisha WHERE country=? AND status='active' AND (recurrence IS NOT NULL OR (starts_at IS NOT NULL AND substr(starts_at,1,10) <= ? AND substr(COALESCE(ends_at, starts_at),1,10) >= ?))
      ORDER BY updated_at DESC LIMIT 500`).bind(country, to, from),
    DB.prepare(`SELECT m.user_id, m.role, m.taste, m.nightlife, m.afisha, m.animal, u.display_name FROM members m JOIN users u ON u.id=m.user_id WHERE m.search_id=? AND m.role IN ('owner','member')`).bind(s.id),
    DB.prepare('SELECT * FROM event_feedback WHERE search_id=? AND updated_at > ?').bind(s.id, since),
    DB.prepare("SELECT starts_at FROM viewings WHERE search_id=? AND status IN ('proposed','confirmed') AND substr(starts_at,1,10) BETWEEN ? AND ?").bind(s.id, from, to),
    DB.prepare('SELECT data FROM deals WHERE search_id=? ORDER BY updated_at DESC LIMIT 1').bind(s.id),
    DB.prepare('SELECT date FROM moveouts WHERE search_id=?').bind(s.id),
    DB.prepare("SELECT name, lat, lng, source, tier FROM places WHERE search_id=? AND hidden=0").bind(s.id),
    DB.prepare("SELECT * FROM event_bookings WHERE search_id=? AND status NOT IN ('cancelled') AND occ >= ?").bind(s.id, addDay(from, -1)),
    DB.prepare('SELECT spot_id, lat, lng, hourly FROM surf_cache LIMIT 60'),
    // wave 9: instance-wide ratings of places / organizers (members of every search who went and rated)
    DB.prepare(`SELECT place_key, organizer_key, rating FROM event_feedback WHERE rating IS NOT NULL AND attended=1 AND updated_at > ? ORDER BY updated_at DESC LIMIT 3000`).bind(new Date(Date.now() - 365 * 864e5).toISOString()),
  ]);
  const bp = await basePlaces(env, country);
  const venues = new Map<string, { sum: number; n: number }>();
  for (const v of (vr.results ?? []) as Row[]) for (const k of [v.place_key, v.organizer_key]) if (k) { const x = venues.get(k) ?? { sum: 0, n: 0 }; x.sum += Number(v.rating); x.n++; venues.set(k, x); }
  return { country, region: s.region, pack, tz, home, kmh: ri.kmh, events: (evs.results ?? []) as Row[], members: (mem.results ?? []) as Row[], feedback: (fb.results ?? []) as Row[],
    viewings: (vw.results ?? []) as Row[], deal: dl.results?.[0] ? parseJson<any>(dl.results[0].data, {}) : null, moveout: mo.results?.[0]?.date ?? null,
    own: (own.results ?? []) as Row[], bookings: (bk.results ?? []) as Row[], surf: (sc.results ?? []) as Row[], base: bp.places ?? [], venues };
}
type Ctx = Awaited<ReturnType<typeof loadCtx>>;

function pointOf(r: Row, c: Ctx): [number, number] | null {
  if (r.lat != null && r.lng != null) return [Number(r.lat), Number(r.lng)];
  if (r.place_id && String(r.place_id).startsWith('b:')) { const p = c.base.find((x: any) => 'b:' + x.id === r.place_id); if (p?.lat != null) return [Number(p.lat), Number(p.lng)]; }
  const ar = r.area ? c.pack.areas?.[r.area] : null;
  return Array.isArray(ar?.center) ? [ar.center[0], ar.center[1]] : null;
}
/** Wave 8.1: the pack area (district chip) of an event: its `area` when that is an area key or one of an area's districts, else
 * the nearest area centre within 12 km of its point; null when unknown. */
export function areaOf(r: Row, c: { pack: any; base: any[] }): string | null {
  const areas = c.pack?.areas ?? {};
  if (r.area && areas[r.area]) return r.area;
  if (r.area) { const k = Object.keys(areas).find((a) => (areas[a].districts ?? []).includes(r.area)); if (k) return k; }
  const pt = pointOf(r, c as Ctx);
  if (!pt) return null;
  let best: string | null = null, bk = 12;
  for (const [k, a] of Object.entries<any>(areas)) {
    if (!Array.isArray(a.center)) continue;
    const km = kmBetween(pt, [a.center[0], a.center[1]]);
    if (km < bk) { bk = km; best = k; }
  }
  return best;
}
/** Sea state at the event's hour from the surf forecast cache (nearest spot ≤ 25 km), or null when there is no data. */
function seaAt(c: Ctx, pt: [number, number] | null, startsAt: string) {
  const at = pt ?? (c.home ? [c.home.lat, c.home.lng] as [number, number] : null);
  if (!at || !c.surf.length) return null;
  let best: Row | null = null, bk = 25;
  for (const s of c.surf) { const k = kmBetween(at, [Number(s.lat), Number(s.lng)]); if (k < bk) { bk = k; best = s; } }
  if (!best) return null;
  const h = parseJson<any>(best.hourly, {});
  const i = (h.time ?? []).indexOf(`${startsAt.slice(0, 13)}:00`);
  if (i < 0) return null;
  const wave = h.h?.[i] ?? null, wind = h.ws?.[i] ?? null;
  if (wave == null) return null;
  return { calm: wave <= 0.8 && (wind ?? 0) <= 20, wave: Math.round(wave * 10) / 10, wind: wind == null ? null : Math.round(wind) };
}

/** Rank the occurrences between `from` and `to` for the search's members. Returns all scored items (incl. excluded). */
function rank(c: Ctx, opts: FeedOpts) {
  const rings: number[] = c.pack.location?.rings ?? [10, 20, 40];
  const weights: number[] = c.pack.location?.weights ?? [1, 0.7, 0.3];
  const members: MemberTaste[] = c.members.map((m) => {
    const t = parseJson<any>(m.taste, {});
    return { user_id: m.user_id, name: m.display_name, interests: Array.isArray(t.interests) ? t.interests : [], age_band: t.age_band ?? null, nightlife: m.nightlife == null ? null : !!m.nightlife };
  });
  const blocked = new Map<string, 'nyepi' | 'moveout' | 'holiday'>();
  for (const e of c.pack.calendar?.events ?? []) {
    if (e.kind !== 'holiday' || !e.date) continue;
    const why = /nyepi/i.test(e.id) ? 'nyepi' : 'holiday';
    for (let d = e.date; d <= (e.to ?? e.date); d = addDay(d, 1)) if (!blocked.has(d) || why === 'nyepi') blocked.set(d, why);
  }
  if (c.moveout) blocked.set(String(c.moveout).slice(0, 10), 'moveout');
  const payDays = new Set(c.deal ? dealDates(c.deal).filter((d) => d.kind === 'payment' && !d.done).map((d) => d.date) : []);
  const busy = c.viewings.map((v) => { const t = Date.parse(v.starts_at); return { from: t - 30 * 60e3, to: t + 90 * 60e3, why: 'viewing' as const }; });
  const prices = c.events.map((e) => e.price).filter((p) => p != null && p > 0).sort((a, b) => a - b);
  const ctx: RankCtx = { now: Date.now(), members, feedback: c.feedback as FeedbackRow[], viewer: opts.viewer, busy, blocked, payDays, rings, weights, priceMedian: prices.length ? prices[Math.floor(prices.length / 2)] : null };
  const googlePts = c.own.filter((p) => p.source === 'google_list' || p.source === 'my_maps' || p.source === 'google_place').map((p) => [Number(p.lat), Number(p.lng)] as [number, number]);
  const out: (Scored & { row: Row })[] = [];
  const city = String(c.region ?? '').split('/')[1] || null;
  for (const r of c.events) {
    // Without a home point (no deal, anchor or districts) distance is unknown: another city only ranks lower (wave 8.1, no cutoff).
    const otherCity = !c.home && !!city && !!r.city && r.city !== city;
    const rec = parseJson<Recurrence | null>(r.recurrence, null);
    const pt = pointOf(r, c);
    const minutes = pt && c.home ? minutesKm(kmBetween([c.home.lat, c.home.lng], pt), c.kmh) : null;
    const tags = parseJson<string[]>(r.tags, []);
    const basePlace = r.place_id && String(r.place_id).startsWith('b:') ? c.base.find((x: any) => 'b:' + x.id === r.place_id) : null;
    for (const o of occurrences({ starts_at: r.starts_at, ends_at: r.ends_at, recurrence: rec }, opts.from, opts.to, c.tz)) {
      const sea = !!r.sea || SEA_TOPICS.has(r.topic ?? '');
      const it: RankItem = {
        key: `${r.id}@${o.occ}`, id: r.id, occ: o.occ, starts_at: o.starts_at, ends_at: o.ends_at, title: r.title, category: r.category, topic: r.topic,
        organizer_key: orgKey(r), place_key: placeKey(r), lang: r.lang, price_kind: r.price_kind, price: r.price, tags, quality: r.quality, source_rep: r.source_rep,
        photo_score: r.photo_url ? r.photo_score : null, place_tier: basePlace?.tier ?? null, in_user_list: !!pt && googlePts.some((g) => kmBetween(g, pt) <= 0.15),
        minutes, sea, outdoor: !!r.outdoor, sea_state: sea ? seaAt(c, pt, o.starts_at) : null, age_min: r.age_min, booking: r.booking, other_city: otherCity,
        venue: venueOf(c, r),
      };
      out.push({ ...scoreItem(it, ctx), row: r });
    }
  }
  return out;
}

/** Wave 9: instance-wide rating of the event's place (else organizer): {avg, n} or null. */
function venueOf(c: Ctx, r: Row) {
  const v = c.venues.get(placeKey(r) ?? '') ?? c.venues.get(orgKey(r) ?? '');
  return v ? { avg: Math.round((v.sum / v.n) * 10) / 10, n: v.n } : null;
}
function occView(x: Scored & { row: Row }, c: Ctx, viewer: string | null) {
  const r = x.row;
  const fb = c.feedback.filter((f) => f.event_id === r.id);
  const mine = fb.find((f) => f.user_id === viewer);
  const bks = c.bookings.filter((b) => b.event_id === r.id && b.occ === x.occ && b.status !== 'declined');
  const going = [...new Set(bks.filter((b) => ['booked', 'asked', 'drafted', 'requested', 'attended'].includes(b.status)).flatMap((b) => parseJson<string[]>(b.who, [])))];
  const rec = parseJson<Recurrence | null>(r.recurrence, null);
  const start = Date.parse(x.starts_at);
  return {
    key: x.key, id: r.id, occ: x.occ, starts_at: x.starts_at, ends_at: x.ends_at, title: r.title, title_en: r.title_en, about: { ru: r.about_ru, en: r.about_en },
    category: r.category, topic: r.topic, social: SOCIAL.has(r.category), effect: effectFor(c.pack, r as any), recurrence: rec, recurring: recurringLabel(rec),
    place: { name: r.place_name, lat: r.lat, lng: r.lng, area: r.area, map_url: r.map_url }, pt: pointOf(r, c), minutes: x.minutes, far: !!x.far, area_id: areaOf(r, c),
    price_kind: r.price_kind, price: r.price, currency: r.currency, price_note: r.price_note, entry: r.entry, lang: r.lang, booking: r.booking, ticket_url: r.ticket_url,
    organizer: { name: r.organizer_name, channel: r.organizer_channel }, source: { kind: r.source_kind, url: r.source_url, name: r.source_name },
    photo: photoOf(r),
    age_min: r.age_min, dress_code: r.dress_code, vibe: r.vibe, crowd: r.crowd, beginner: !!r.beginner, outdoor: !!r.outdoor, sea: x.sea, sea_state: x.sea_state,
    score: x.score, why: x.why, new_for_you: x.new_for_you, in_hours: start > Date.now() ? Math.round((start - Date.now()) / 360e3) / 10 : 0, live: start <= Date.now(),
    mine: { like: !!mine?.liked, nope: !!mine?.nope, want: !!mine?.want, bookmark: !!mine?.bookmark, attended: !!mine?.attended, rating: mine?.rating ?? null, note: mine?.note ?? null },
    // wave 9: "вам понравилось" on repeat venues / recurring nights, and the instance-wide venue rating
    liked_before: likedBefore(c.feedback as FeedbackRow[], { id: r.id, place_key: placeKey(r), organizer_key: orgKey(r) }), venue: venueOf(c, r),
    want: fb.filter((f) => f.want).map((f) => f.user_id), going,
    booking_status: bks.find((b) => b.status !== 'cancelled')?.status ?? null, booking_id: bks.find((b) => b.status !== 'cancelled')?.id ?? null,
  };
}

/** The Mini App feed: 7 day strip, the selected day's ranked list (event of the day = the first 3), the weekday card (Тусовки). */
async function feedView(env: Env, s: SearchRow, opts: { viewer: string; day: string | null; tab: 'all' | 'social'; f: Set<string>; seed: number; d?: Set<string> }) {
  const tz = searchTzOf(s);
  const today = localDay(tz);
  const to = addDay(today, 6);
  const c = await loadCtx(env, s, today, to);
  const all = rank(c, { viewer: opts.viewer, from: today, to, seed: opts.seed, f: opts.f, tab: opts.tab });
  const live = all.filter((x) => !x.excluded && (opts.tab === 'social' ? SOCIAL.has(x.category) : true));
  const passed = live.filter((x) => passFilters({ ...x, beginner: !!x.row.beginner }, opts.f));
  // wave 8.1: district chips ("Рядом" = none selected: the whole region by score with the distance penalty); multi-select narrows
  const areaIds = new Map(passed.map((x) => [x.row.id, areaOf(x.row, c)]));
  const dsel = new Set([...(opts.d ?? [])].filter((k) => c.pack?.areas?.[k]));
  const filtered = dsel.size ? passed.filter((x) => dsel.has(areaIds.get(x.row.id) ?? '')) : passed;
  const areaN = new Map<string, number>();
  for (const x of passed) { const a = areaIds.get(x.row.id); if (a) areaN.set(a, (areaN.get(a) ?? 0) + 1); }
  const days = Array.from({ length: 7 }, (_, i) => addDay(today, i)).map((d) => ({ day: d, n: filtered.filter((x) => x.occ === d).length }));
  let day = opts.day && DAY.test(opts.day) && opts.day >= today && opts.day <= to ? opts.day : null;
  if (opts.tab === 'social' && opts.f.has('today')) day = today;
  let list: (Scored & { row: Row })[];
  if (day || opts.tab === 'all') {
    const d = day ?? (days.find((x) => x.n > 0)?.day ?? today);
    day = d;
    list = diversify(filtered.filter((x) => x.occ === d), { seed: opts.seed }) as any;
  } else {
    // Тусовки without a day: the week, nearer days slightly first.
    const byDay = filtered.map((x) => ({ ...x, score: x.score - 0.15 * Math.round((Date.parse(x.occ) - Date.parse(today)) / 864e5) }));
    // A recurring night shows once (its nearest good occurrence), not on every day of the week.
    const seen = new Set<string>();
    list = (diversify(byDay, { seed: opts.seed }) as any[]).filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
  }
  const views = list.map((x) => occView(x, c, opts.viewer));
  // Event of the day: the top of the list, never something the viewer marked "не моё" or nightlife they opted out of.
  const top = views.filter((v) => !v.mine.nope).slice(0, 3);
  const rest = views.filter((v) => !top.includes(v));
  const weekly: { wd: number; title: string; key: string }[] = [];
  if (opts.tab === 'social') {
    for (const x of live.filter((y) => y.row.recurrence).sort((a, b) => b.score - a.score)) {
      const wd = isoWd(x.occ);
      if (!weekly.some((w) => w.wd === wd)) weekly.push({ wd, title: shortTitle(x.row), key: x.key });
    }
    weekly.sort((a, b) => a.wd - b.wd);
  }
  const me = c.members.find((m) => m.user_id === opts.viewer);
  return {
    country: c.country, tz, today, day, tab: opts.tab, seed: opts.seed, filters: [...opts.f], days, top, items: rest, weekly,
    area: c.home?.district ?? null, home: c.home ? { source: c.home.source, label: c.home.label } : null, total: live.length,
    districts: [...dsel], areas: [...areaN].map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n),
    prefs: { nightlife: me?.nightlife == null ? null : !!me.nightlife, afisha: me?.afisha == null ? null : !!me.afisha, taste: parseJson(me?.taste, {}) },
  };
}
const shortTitle = (r: Row) => String(r.title || r.place_name).split(/[·,(]/)[0].trim().slice(0, 18);

// ---------------------------------------------------------------- Mini App routes

export async function afishaApp(req: Request, env: Env, path: string, user: { id: string; display_name: string; lang: string }): Promise<Response | null> {
  const DB = env.DB;
  const q = new URL(req.url).searchParams;
  if (path === '/app/api/afisha' && req.method === 'GET') {
    const sid = q.get('s') ?? '';
    const a = await member(env, sid, user.id, ['owner', 'member', 'viewer']);
    const f = new Set((q.get('f') ?? '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 12));
    const dd = new Set((q.get('d') ?? '').split(',').map((x) => x.trim()).filter((x) => /^[a-z0-9_]{2,40}$/.test(x)).slice(0, 20));
    const tab = q.get('tab') === 'social' ? 'social' : 'all';
    const seed = Math.max(0, Math.min(1e9, Math.floor(Number(q.get('seed')) || 0)));
    return json(await feedView(env, { id: sid, region: a.region, brief: a.brief }, { viewer: user.id, day: q.get('day'), tab, f, seed, d: dd }));
  }
  if (path === '/app/api/event' && req.method === 'GET') {
    const sid = q.get('s') ?? '';
    const a = await member(env, sid, user.id, ['owner', 'member', 'viewer']);
    const r = await DB.prepare('SELECT * FROM afisha WHERE id=?').bind(q.get('id') ?? '').first<Row>();
    if (!r || r.country !== countryOf(a.region) || r.status === 'hidden') throw new HttpError(404, 'no_event');
    const s = { id: sid, region: a.region, brief: a.brief };
    const today = localDay(a.tz);
    const occ = q.get('occ') && DAY.test(q.get('occ')!) ? q.get('occ')! : today;
    const c = await loadCtx(env, s, occ, occ);
    c.events = [r];
    const xs = rank(c, { viewer: user.id, from: occ, to: occ, seed: 0, f: new Set(), tab: 'all' });
    let x = xs[0];
    if (!x) {
      // Not on that day (e.g. an old link): the next occurrence within 30 days.
      const c2 = await loadCtx(env, s, today, addDay(today, 30));
      c2.events = [r];
      x = rank(c2, { viewer: user.id, from: today, to: addDay(today, 30), seed: 0, f: new Set(), tab: 'all' }).find((y) => !y.excluded) as any;
      if (!x) return json({ event: { ...eventView(r, c.pack), past: true }, occurrence: null });
      Object.assign(c, { bookings: c2.bookings, feedback: c2.feedback });
    }
    const names = new Map(c.members.map((m) => [m.user_id, m.display_name]));
    const bookings = c.bookings.filter((b) => b.event_id === r.id && b.occ === x.occ).map((b) => bookingView(b, r, names));
    return json({ occurrence: occView(x as any, c, user.id), bookings, excluded: x.excluded, parts: x.parts.map((p) => ({ k: p.k, v: Math.round(p.v * 100) / 100 })),
      organizer: { name: r.organizer_name, channel: r.organizer_channel, can_message: !!(r.organizer_channel && r.organizer_address && r.organizer_channel !== 'web') } });
  }
  if (path === '/app/api/event-plan' && req.method === 'GET') {
    // Home Plan: upcoming bookings of this search + today's top event (cheap: today only).
    const sid = q.get('s') ?? '';
    const a = await member(env, sid, user.id, ['owner', 'member', 'viewer']);
    const today = localDay(a.tz);
    const rows = (await DB.prepare(`SELECT b.*, e.title, e.place_name FROM event_bookings b JOIN afisha e ON e.id=b.event_id WHERE b.search_id=? AND b.occ >= ? AND b.status IN ('requested','drafted','asked','booked') ORDER BY b.starts_at LIMIT 10`)
      .bind(sid, today).all<Row>()).results ?? [];
    const fv = await feedView(env, { id: sid, region: a.region, brief: a.brief }, { viewer: user.id, day: today, tab: 'all', f: new Set(), seed: 0 });
    return json({ today, top: fv.top[0] ?? null, total: fv.days.reduce((n, d) => n + d.n, 0),
      bookings: rows.map((b) => ({ id: b.id, event_id: b.event_id, occ: b.occ, starts_at: b.starts_at, status: b.status, title: b.title, place: b.place_name, who: parseJson(b.who, []), guests: b.guests })) });
  }
  if (path === '/app/api/event-feedback' && req.method === 'POST') {
    const b = await body(req);
    const a = await member(env, b.search_id, user.id, ['owner', 'member']);
    await rateLimit(env, 'evfb', user.id, 300);
    const kind = oneOf(b.kind, ['like', 'nope', 'want', 'bookmark', 'attended'], 'kind');
    if (!kind) throw new HttpError(400, 'bad_kind', 'kind is required');
    const r = await DB.prepare('SELECT * FROM afisha WHERE id=?').bind(String(b.event_id ?? '')).first<Row>();
    if (!r || r.country !== countryOf(a.region)) throw new HttpError(404, 'no_event');
    const on = b.on !== false;
    const occ = b.occ && DAY.test(b.occ) ? b.occ : null;
    const rating = kind === 'attended' && b.rating != null ? num(b.rating, 'rating', 1, 5) : null;
    const col = { like: 'liked', nope: 'nope', want: 'want', bookmark: 'bookmark', attended: 'attended' }[kind];
    const t = now();
    // like and nope exclude each other.
    const extra = kind === 'like' && on ? ', nope=0' : kind === 'nope' && on ? ', liked=0, want=0' : '';
    await DB.prepare(`INSERT INTO event_feedback (event_id, user_id, search_id, occ, ${col}, rating, category, topic, organizer_key, place_key, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(event_id, user_id, search_id) DO UPDATE SET ${col}=excluded.${col}${extra}, occ=COALESCE(excluded.occ, occ), rating=COALESCE(excluded.rating, rating), updated_at=excluded.updated_at`)
      .bind(r.id, user.id, b.search_id, occ, on ? 1 : 0, rating, r.category, r.topic, orgKey(r), placeKey(r), t, t).run();
    let notified = 0;
    if (kind === 'want' && on) {
      // "Хочу пойти": the other members get one DM per person, event and day (quiet hours postpone it).
      const key = `evwant:${r.id}:${occ ?? ''}:${user.id}`;
      const ins = await DB.prepare('INSERT OR IGNORE INTO sent_marks (key, at) VALUES (?,?)').bind(key, t).run();
      if (ins.meta.changes) {
        await event(env, b.search_id, 'event_want', r.id, user.id, { event_id: r.id, title: r.title, occ, name: user.display_name });
        const when = occ ? occ.slice(8, 10) + '.' + occ.slice(5, 7) : '';
        notified = await dmMembers(env, b.search_id, (lang) => ({
          text: lang === 'ru' ? `${user.display_name} хочет пойти: <b>${escH(r.title)}</b>${when ? ` ${when}` : ''}. Пойдёшь?` : `${user.display_name} wants to go: <b>${escH(r.title_en || r.title)}</b>${when ? ` ${when}` : ''}. Coming?`,
          buttons: [[{ text: lang === 'ru' ? 'Открыть' : 'Open', web_app: { url: appUrl(env, `/s/${b.search_id}/event/${encodeURIComponent(r.id + '@' + (occ ?? ''))}`) } }]],
        }), { quiet: 'postpone', key, skip: new Set([user.id]), votersOnly: true });
      }
    }
    return json({ ok: true, notified });
  }
  if (path === '/app/api/event-book' && req.method === 'POST') {
    const b = await body(req);
    const a = await member(env, b.search_id, user.id, ['owner', 'member']);
    await rateLimit(env, 'evbook', user.id, 30);
    const r = await DB.prepare('SELECT * FROM afisha WHERE id=?').bind(String(b.event_id ?? '')).first<Row>();
    if (!r || r.country !== countryOf(a.region) || r.status !== 'active') throw new HttpError(404, 'no_event');
    if (!b.occ || !DAY.test(b.occ)) throw new HttpError(400, 'bad_occ', 'occ (YYYY-MM-DD) is required');
    const occ = occurrences({ starts_at: r.starts_at, ends_at: r.ends_at, recurrence: parseJson(r.recurrence, null) }, b.occ, b.occ, a.tz)[0];
    if (!occ) throw new HttpError(400, 'bad_occ', 'The event does not happen on that day');
    if (Date.parse(occ.ends_at ?? occ.starts_at) < Date.now()) throw new HttpError(409, 'event_past', 'This event is over');
    const mem = ((await DB.prepare("SELECT user_id FROM members WHERE search_id=? AND role IN ('owner','member')").bind(b.search_id).all<Row>()).results ?? []).map((m) => m.user_id);
    const who: string[] = Array.isArray(b.who) && b.who.length ? [...new Set<string>(b.who.map(String))] : [user.id];
    if (who.some((u) => !mem.includes(u))) throw new HttpError(400, 'bad_who', 'who must be members of this search');
    const guests = Math.max(0, Math.min(10, Math.floor(Number(b.guests) || 0)));
    const kind = oneOf(b.kind, BOOK_KINDS, 'kind') ?? (r.category === 'social_sport' ? 'slot' : 'join');
    const note = txt(b.note, 'note', 300);
    const t = now();
    const old = await DB.prepare("SELECT * FROM event_bookings WHERE search_id=? AND event_id=? AND occ=? AND status NOT IN ('cancelled','declined')").bind(b.search_id, r.id, b.occ).first<Row>();
    let id = old?.id;
    if (old) {
      // Same day again: update who and the guests; if the draft is already out, the agent sees it as a new request.
      await DB.prepare("UPDATE event_bookings SET who=?, guests=?, kind=?, note=?, status=CASE WHEN status IN ('booked','asked') THEN status ELSE 'requested' END, updated_at=? WHERE id=?")
        .bind(JSON.stringify(who), guests, kind, note, t, old.id).run();
    } else {
      id = rid('eb_');
      await DB.prepare(`INSERT INTO event_bookings (id, event_id, search_id, occ, starts_at, who, guests, kind, note, status, requested_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?, 'requested', ?,?,?)`)
        .bind(id, r.id, b.search_id, b.occ, occ.starts_at, JSON.stringify(who), guests, kind, note, user.id, t, t).run();
    }
    const names = new Map(((await DB.prepare(`SELECT u.id, u.display_name FROM users u WHERE u.id IN (${who.map(() => '?').join(',')})`).bind(...who).all<Row>()).results ?? []).map((x) => [x.id, x.display_name]));
    await event(env, b.search_id, 'event_book', id!, user.id, { booking_id: id, event_id: r.id, title: r.title, occ: b.occ, starts_at: occ.starts_at, who: who.map((u) => names.get(u) ?? u), guests, kind, note, name: user.display_name,
      booking: r.booking, ticket_url: r.ticket_url });
    const row = await DB.prepare('SELECT * FROM event_bookings WHERE id=?').bind(id).first<Row>();
    return json({ booking: bookingView(row!, r, names) }, old ? 200 : 201);
  }
  if (path === '/app/api/event-book-cancel' && req.method === 'POST') {
    const b = await body(req);
    await member(env, b.search_id, user.id, ['owner', 'member']);
    const r = await DB.prepare('SELECT b.*, e.title FROM event_bookings b JOIN afisha e ON e.id=b.event_id WHERE b.id=?').bind(String(b.booking_id ?? '')).first<Row>();
    if (!r || r.search_id !== b.search_id) throw new HttpError(404, 'no_booking');
    await DB.prepare("UPDATE event_bookings SET status='cancelled', updated_at=? WHERE id=?").bind(now(), r.id).run();
    // A pending draft to the organizer is withdrawn; a sent one stays (the agent tells the organizer if needed).
    if (r.draft_id) await DB.prepare("UPDATE drafts SET status='rejected', updated_at=? WHERE id=? AND status='pending'").bind(now(), r.draft_id).run();
    await event(env, b.search_id, 'event_book_cancel', r.id, user.id, { booking_id: r.id, title: r.title, status_was: r.status, name: user.display_name });
    return json({ ok: true });
  }
  if (path === '/app/api/event-rate' && req.method === 'POST') {
    // Wave 9 · "Как было?": attended + 1..5 + an optional note (also from the bot's morning DM). The strongest taste signal.
    const b = await body(req);
    await member(env, b.search_id, user.id, ['owner', 'member']);
    await rateLimit(env, 'evfb', user.id, 300);
    const r = await DB.prepare('SELECT * FROM afisha WHERE id=?').bind(String(b.event_id ?? '')).first<Row>();
    if (!r) throw new HttpError(404, 'no_event');
    const rating = num(b.rating, 'rating', 1, 5);
    if (rating == null || !Number.isInteger(rating)) throw new HttpError(400, 'bad_rating', 'rating must be 1..5');
    const note = txt(b.note, 'note', 300);
    const occ = b.occ && DAY.test(b.occ) ? b.occ : null;
    await rateEvent(env, r, b.search_id, user, occ, rating, note, 'note' in b);
    return json({ ok: true });
  }
  if (path === '/app/api/event-share' && req.method === 'POST') {
    // Wave 9: a public read-only page of an Афиша event (signed link; no login, noindex).
    const b = await body(req);
    const a = await member(env, b.search_id, user.id, ['owner', 'member', 'viewer']);
    const r = await DB.prepare('SELECT id, country, status FROM afisha WHERE id=?').bind(String(b.event_id ?? '')).first<Row>();
    if (!r || r.country !== countryOf(a.region) || r.status === 'hidden') throw new HttpError(404, 'no_event');
    const { eventShareUrl } = await import('./imgproxy');
    return json({ url: await eventShareUrl(env, r.id, b.occ && DAY.test(b.occ) ? b.occ : null) });
  }
  if (path === '/app/api/afisha-prefs' && req.method === 'POST') {
    const b = await body(req);
    await member(env, b.search_id, user.id, ['owner', 'member']);
    const sets: string[] = [], vals: unknown[] = [];
    if ('nightlife' in b) { sets.push('nightlife=?'); vals.push(b.nightlife == null ? null : b.nightlife ? 1 : 0); }
    if ('afisha' in b) { sets.push('afisha=?'); vals.push(b.afisha == null ? null : b.afisha ? 1 : 0); }
    if ('taste' in b) {
      const tv = b.taste ?? {};
      if (typeof tv !== 'object' || Array.isArray(tv)) throw new HttpError(400, 'bad_taste', 'taste must be {age_band?, interests?}');
      const ab = tv.age_band == null ? null : oneOf(tv.age_band, AGE_BANDS, 'age_band');
      const ints = Array.isArray(tv.interests) ? [...new Set<string>(tv.interests.map(String))].filter((i) => i in INTERESTS) : [];
      sets.push('taste=?'); vals.push(JSON.stringify({ ...(ab ? { age_band: ab } : {}), interests: ints }));
    }
    if (!sets.length) throw new HttpError(400, 'missing', 'nothing to change');
    await DB.prepare(`UPDATE members SET ${sets.join(', ')} WHERE search_id=? AND user_id=?`).bind(...vals, b.search_id, user.id).run();
    const m = await DB.prepare('SELECT nightlife, afisha, taste FROM members WHERE search_id=? AND user_id=?').bind(b.search_id, user.id).first<Row>();
    return json({ prefs: { nightlife: m?.nightlife == null ? null : !!m.nightlife, afisha: m?.afisha == null ? null : !!m.afisha, taste: parseJson(m?.taste, {}) } });
  }
  return null;
}
const escH = (s: unknown) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));

// ---------------------------------------------------------------- agent API

interface AgentUser { id: string; display_name: string }
async function isAdmin(env: Env, uid: string) { return !!(await env.DB.prepare('SELECT 1 FROM hunters WHERE user_id=? AND is_admin=1').bind(uid).first()); }
async function ownSearchId(env: Env, uid: string, sid: unknown): Promise<string> {
  const r = await env.DB.prepare("SELECT s.id FROM searches s JOIN members m ON m.search_id=s.id AND m.user_id=? AND m.role='owner' WHERE s.id=?").bind(uid, String(sid ?? '')).first<Row>();
  if (!r) throw new HttpError(404, 'no_search', `Search ${sid} not found`);
  return r.id;
}
const cleanCountry = (v: unknown) => {
  const c = String(v ?? '').trim().toLowerCase();
  if (!/^[a-z_]{2,20}$/.test(c) || c === '_generic') throw new HttpError(400, 'bad_country', 'country must be a pack slug like bali, kz, th');
  return c;
};

/** Upsert one event (dedupe across sources). Returns what happened. */
async function upsertOne(env: Env, b: any, user: AgentUser, existing: Row[]): Promise<{ action: 'created' | 'updated' | 'merged'; id: string } | { action: 'skipped'; reason: string }> {
  if (!b || typeof b !== 'object') return { action: 'skipped', reason: 'not_an_object' };
  let country: string, cols: Record<string, unknown>;
  try {
    country = cleanCountry(b.country);
    cols = eventCols(b, true);
  } catch (e) {
    if (e instanceof HttpError) return { action: 'skipped', reason: e.code === 'sensitive' ? 'sensitive' : e.code === 'bad_category' ? 'bad_category' : `${e.code}: ${e.message}` };
    throw e;
  }
  if (!cols.starts_at && !cols.recurrence) return { action: 'skipped', reason: 'no_date' };
  if (!cols.place_name && cols.lat == null && !cols.place_id && !cols.area) return { action: 'skipped', reason: 'no_place' };
  if (!cols.recurrence && Date.parse(String(cols.ends_at ?? cols.starts_at)) < Date.now() - 3600e3) return { action: 'skipped', reason: 'past' };
  if (!cols.source_url && cols.source_kind !== 'place' && cols.source_kind !== 'pack') return { action: 'skipped', reason: 'no_source' };
  let sid: string | null = null;
  if (b.search_id) sid = await ownSearchId(env, user.id, b.search_id);
  const t = now();
  const src = cols.source_url || cols.source_name ? [{ kind: cols.source_kind ?? null, url: cols.source_url ?? null, name: cols.source_name ?? null }] : [];
  const key = { title: String(cols.title), starts_at: (cols.starts_at as string) ?? null, recurrence: parseJson<Recurrence | null>(cols.recurrence as string, null), place_name: (cols.place_name as string) ?? null, lat: (cols.lat as number) ?? null, lng: (cols.lng as number) ?? null };
  const dup = existing.find((r) => r.country === country && isDuplicate(key, { title: r.title, starts_at: r.starts_at, recurrence: parseJson(r.recurrence, null), place_name: r.place_name, lat: r.lat, lng: r.lng }));
  if (dup) {
    // Merge: fill empty fields, keep the better photo, add the source; an explicit status from the agent always applies.
    const sets: string[] = [], vals: unknown[] = [];
    for (const [k, v] of Object.entries(cols)) {
      if (v == null || k === 'title' || k === 'category') continue;
      if (k.startsWith('photo_')) continue;
      if (k === 'status' ? 'status' in b : dup[k] == null || dup[k] === '' || (k === 'price_kind' && dup[k] === 'unknown') || (k === 'booking' && dup[k] === 'none')) { sets.push(`${k}=?`); vals.push(v); }
    }
    if (cols.photo_url && (dup.photo_url == null || dup.photo_stale_at || Number(cols.photo_score ?? 0) > Number(dup.photo_score ?? 0))) {
      for (const k of ['photo_url', 'photo_credit', 'photo_source_url', 'photo_score']) { sets.push(`${k}=?`); vals.push(cols[k] ?? null); }
      sets.push('photo_stale_at=NULL', 'photo_fail=NULL');
    }
    const srcs = parseJson<any[]>(dup.sources, []);
    for (const s of src) if (!srcs.some((x) => x.url && x.url === s.url)) srcs.push(s);
    sets.push('sources=?'); vals.push(JSON.stringify(srcs.slice(-10)));
    await env.DB.prepare(`UPDATE afisha SET ${sets.join(', ')}, updated_at=? WHERE id=?`).bind(...vals, t, dup.id).run();
    return { action: dup.created_by === user.id && dup.source_url === cols.source_url ? 'updated' : 'merged', id: dup.id };
  }
  const id = rid('ev_');
  const all: Record<string, unknown> = { id, country, ...cols, sources: JSON.stringify(src), search_id: sid, created_by: user.id, created_at: t, updated_at: t };
  if (!all.status) all.status = 'active';
  await env.DB.prepare(`INSERT INTO afisha (${Object.keys(all).join(',')}) VALUES (${Object.keys(all).map(() => '?').join(',')})`).bind(...Object.values(all)).run();
  existing.push({ ...all });
  return { action: 'created', id };
}

const T_DATE: Record<string, (d: string) => string> = {
  en: (d) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(d + 'T12:00:00Z')),
  ru: (d) => new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(d + 'T12:00:00Z')),
  id: (d) => new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(d + 'T12:00:00Z')),
};
/** The default message to the organizer, short and human, in their language. Payments stay with the humans ("on site"). */
export function bookingText(lang: string, x: { title: string; occ: string; time: string; n: number; names: string[]; kind: string; price_kind: string }) {
  const L = ['en', 'ru', 'id'].includes(lang) ? lang : 'en';
  const date = T_DATE[L](x.occ);
  const who = x.names.join(L === 'ru' ? ' и ' : L === 'id' ? ' dan ' : ' and ');
  const pay = x.price_kind === 'free' ? '' : L === 'ru' ? ' оплатим на месте.' : L === 'id' ? ' bayar di tempat ya.' : " we'll pay on site.";
  if (L === 'ru') {
    if (x.kind === 'guest_list') return `привет! можно нас в гест-лист на ${x.title}, ${date}? ${x.n} чел. (${who}). спасибо!`;
    if (x.kind === 'table') return `привет! можно забронировать стол на ${x.n} на ${x.title}, ${date} с ${x.time}? спасибо!`;
    if (x.kind === 'slot') return `привет! есть место в игре ${x.title}, ${date} около ${x.time}? нас ${x.n} (${who}).`;
    return `привет! хотим прийти на ${x.title}, ${date} в ${x.time}, ${x.n} чел. (${who}). есть места?${pay} спасибо!`;
  }
  if (L === 'id') {
    if (x.kind === 'guest_list') return `halo! boleh masukkan kami ke guest list ${x.title}, ${date}? ${x.n} orang (${who}). terima kasih!`;
    if (x.kind === 'table') return `halo! bisa reservasi meja untuk ${x.n} orang di ${x.title}, ${date} jam ${x.time}? terima kasih!`;
    if (x.kind === 'slot') return `halo! masih ada slot di ${x.title}, ${date} sekitar jam ${x.time}? kami ${x.n} orang (${who}).`;
    return `halo! kami mau ikut ${x.title}, ${date} jam ${x.time}, ${x.n} orang (${who}). masih ada tempat?${pay} terima kasih!`;
  }
  if (x.kind === 'guest_list') return `hi! could you put us on the guest list for ${x.title}, ${date}? ${x.n} people (${who}). thanks!`;
  if (x.kind === 'table') return `hi! could we book a table for ${x.n} at ${x.title}, ${date} from ${x.time}? thanks!`;
  if (x.kind === 'slot') return `hi! any free spot in the ${x.title} game on ${date} around ${x.time}? we're ${x.n} (${who}).`;
  return `hi! we'd like to join ${x.title} on ${date} at ${x.time}, ${x.n} people (${who}). is there space?${pay} thanks!`;
}

export async function afishaAgent(req: Request, env: Env, p: string[], user: AgentUser): Promise<Response | null> {
  const DB = env.DB;
  const m = req.method;
  if (p[1] === 'events') {
    if (p.length === 2 && m === 'POST') {
      const raw = await body<any>(req);
      const list = Array.isArray(raw) ? raw : [raw];
      if (list.length > 50) throw new HttpError(400, 'too_many', 'Up to 50 events per call');
      const countries = [...new Set(list.map((x) => String(x?.country ?? '').toLowerCase()).filter((c) => /^[a-z_]{2,20}$/.test(c)))];
      const existing = countries.length ? ((await DB.prepare(`SELECT id, country, title, starts_at, recurrence, place_name, lat, lng, photo_url, photo_score, photo_stale_at, sources, created_by, source_url, ${
        ['city', 'area', 'title_en', 'about_ru', 'about_en', 'topic', 'ends_at', 'place_id', 'map_url', 'price_kind', 'price', 'currency', 'price_note', 'entry', 'lang', 'booking', 'ticket_url',
          'organizer_name', 'organizer_channel', 'organizer_address', 'organizer_contact_id', 'organizer_lang', 'source_kind', 'source_name', 'source_rep', 'photo_credit', 'photo_source_url',
          'age_min', 'dress_code', 'vibe', 'crowd', 'beginner', 'outdoor', 'sea', 'tags', 'quality', 'status'].join(', ')}
          FROM afisha WHERE country IN (${countries.map(() => '?').join(',')}) AND (recurrence IS NOT NULL OR starts_at >= ?) LIMIT 3000`)
        .bind(...countries, new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10)).all<Row>()).results ?? []) : [];
      const out = { created: 0, updated: 0, merged: 0, skipped: [] as { i: number; reason: string }[], ids: [] as (string | null)[] };
      for (let i = 0; i < list.length; i++) {
        const r = await upsertOne(env, list[i], user, existing);
        if (r.action === 'skipped') { out.skipped.push({ i, reason: r.reason }); out.ids.push(null); }
        else { out[r.action]++; out.ids.push(r.id); }
      }
      return json(out, out.created ? 201 : 200);
    }
    if (p.length === 2 && m === 'GET') {
      const q = new URL(req.url).searchParams;
      const country = cleanCountry(q.get('country'));
      const pack = (await packData(env))?.[country] ?? {};
      const from = q.get('from') && DAY.test(q.get('from')!) ? q.get('from')! : new Date().toISOString().slice(0, 10);
      const to = q.get('to') && DAY.test(q.get('to')!) ? q.get('to')! : addDay(from, 13);
      const st = q.get('status');
      const city = q.get('city');
      const qq = (q.get('q') ?? '').trim().toLowerCase();
      const rows = ((await DB.prepare(`SELECT * FROM afisha WHERE country=? AND (? IS NULL OR status=?) AND (? IS NULL OR city IS NULL OR city=?)
          AND (recurrence IS NOT NULL OR (starts_at IS NOT NULL AND substr(starts_at,1,10) <= ? AND substr(COALESCE(ends_at, starts_at),1,10) >= ?)) ORDER BY starts_at LIMIT 500`)
        .bind(country, st, st, city, city, to, from).all<Row>()).results ?? []).filter((r) => !qq || `${r.title} ${r.place_name ?? ''} ${r.organizer_name ?? ''}`.toLowerCase().includes(qq));
      const res: any = { events: rows.map((r) => eventView(r, pack)) };
      if (q.get('search_id')) {
        const sid = await ownSearchId(env, user.id, q.get('search_id'));
        const s = await DB.prepare('SELECT id, region, brief FROM searches WHERE id=?').bind(sid).first<Row>();
        const c = await loadCtx(env, s as SearchRow, from, to);
        const xs = rank(c, { viewer: null, from, to, seed: 0, f: new Set(), tab: 'all' });
        res.occurrences = xs.sort((a, b) => a.occ.localeCompare(b.occ) || b.score - a.score).map((x) => ({ ...occView(x, c, null), excluded: x.excluded, parts: x.parts.map((y) => ({ k: y.k, v: Math.round(y.v * 100) / 100 })) }));
      }
      return json(res);
    }
    if (p.length === 4 && p[3] === 'photo' && m === 'POST') {
      // A photo file from the agent's computer (Telegram photos have no public https URL): multipart `photo` + credit +
      // source_url (+ score). Stored in KV, served to members through /app/kv/. Only the hunter who added the event (or an
      // admin) replaces a photo; anyone may fill an empty one or bring a better-scored one (the same rule as the upsert merge).
      const r = await DB.prepare('SELECT * FROM afisha WHERE id=?').bind(p[2]).first<Row>();
      if (!r) throw new HttpError(404, 'no_event');
      if (!(req.headers.get('content-type') ?? '').includes('multipart/form-data')) throw new HttpError(400, 'not_multipart', 'Send multipart/form-data with a "photo" file, "credit" and "source_url"');
      const fd = await req.formData();
      const file = fd.get('photo');
      if (!file || typeof file === 'string') throw new HttpError(400, 'no_file', 'Send a multipart "photo" file (JPEG, PNG or WebP, ≤ 2 MB)');
      const str = (k: string) => { const v = fd.get(k); return typeof v === 'string' ? v : null; };
      const credit = txt(str('credit'), 'credit', 140, true);
      const source = httpUrl(str('source_url'), 'source_url');
      if (!source) throw new HttpError(400, 'missing', 'source_url is required: the post or page the photo comes from');
      const score = num(str('score'), 'score', 0, 1);
      const mine = r.created_by === user.id || (await isAdmin(env, user.id));
      if (!mine && r.photo_url && Number(score ?? 0) <= Number(r.photo_score ?? 0)) throw new HttpError(403, 'not_yours', 'The event already has a photo at least as good; only the hunter who added it (or an admin) can replace it');
      await rateLimit(env, 'evphoto', user.id, 120);
      const key = await putEventPhoto(env, r.id, file as File, eventPhotoTtl(r));
      await DB.prepare('UPDATE afisha SET photo_url=?, photo_credit=?, photo_source_url=?, photo_score=?, photo_stale_at=NULL, photo_fail=NULL, updated_at=? WHERE id=?')
        .bind('kv:' + key, credit, source, score, now(), r.id).run();
      const row = await DB.prepare('SELECT * FROM afisha WHERE id=?').bind(r.id).first<Row>();
      return json({ event: eventView(row!, (await packData(env))?.[row!.country] ?? {}), key }, 201);
    }
    if (p.length === 3 && m === 'PUT') {
      const b = await body(req);
      const r = await DB.prepare('SELECT * FROM afisha WHERE id=?').bind(p[2]).first<Row>();
      if (!r) throw new HttpError(404, 'no_event');
      if (r.created_by !== user.id && !(await isAdmin(env, user.id))) throw new HttpError(403, 'not_yours', 'Only the hunter who added it (or an admin) can change it; upsert the same event to merge new details');
      const cols = eventCols(b, false);
      delete (cols as any).country;
      if (!Object.keys(cols).length) throw new HttpError(400, 'missing', 'nothing to change');
      const fresh = 'photo_url' in cols && cols.photo_url !== r.photo_url ? ', photo_stale_at=NULL, photo_fail=NULL' : '';
      await DB.prepare(`UPDATE afisha SET ${Object.keys(cols).map((k) => `${k}=?`).join(', ')}${fresh}, updated_at=? WHERE id=?`).bind(...Object.values(cols), now(), r.id).run();
      const row = await DB.prepare('SELECT * FROM afisha WHERE id=?').bind(r.id).first<Row>();
      return json({ event: eventView(row!, (await packData(env))?.[row!.country] ?? {}) });
    }
  }
  if (p[1] === 'event-feedback' && p.length === 2 && m === 'GET') {
    // Wave 9: members' feedback of one of the caller's searches + instance-wide place / organizer ratings.
    const q = new URL(req.url).searchParams;
    const sid = await ownSearchId(env, user.id, q.get('search_id'));
    const from = q.get('from') && DAY.test(q.get('from')!) ? q.get('from')! : addDay(new Date().toISOString().slice(0, 10), -30);
    const to = q.get('to') && DAY.test(q.get('to')!) ? q.get('to')! : addDay(new Date().toISOString().slice(0, 10), 1);
    const rows = (await DB.prepare(`SELECT f.*, e.title, u.display_name name FROM event_feedback f JOIN afisha e ON e.id=f.event_id JOIN users u ON u.id=f.user_id
        WHERE f.search_id=? AND substr(f.updated_at,1,10) BETWEEN ? AND ? ORDER BY f.updated_at DESC LIMIT 500`).bind(sid, from, to).all<Row>()).results ?? [];
    const vr = (await DB.prepare(`SELECT f.place_key, f.organizer_key, f.rating, e.place_name, e.organizer_name FROM event_feedback f JOIN afisha e ON e.id=f.event_id
        WHERE f.rating IS NOT NULL AND f.attended=1 ORDER BY f.updated_at DESC LIMIT 3000`).all<Row>()).results ?? [];
    const agg = new Map<string, { kind: string; key: string; name: string | null; sum: number; n: number }>();
    for (const v of vr) for (const [kind, key, name] of [['place', v.place_key, v.place_name], ['organizer', v.organizer_key, v.organizer_name]] as const) {
      if (!key) continue;
      const x = agg.get(key) ?? { kind, key, name: name ?? null, sum: 0, n: 0 };
      x.sum += Number(v.rating); x.n++; agg.set(key, x);
    }
    return json({
      feedback: rows.map((f) => ({ event_id: f.event_id, title: f.title, occ: f.occ, user_id: f.user_id, name: f.name, attended: !!f.attended, rating: f.rating, note: f.note ?? null,
        liked: !!f.liked, nope: !!f.nope, want: !!f.want, updated_at: f.updated_at })),
      venues: [...agg.values()].map((x) => ({ kind: x.kind, key: x.key, name: x.name, avg: Math.round((x.sum / x.n) * 10) / 10, n: x.n })).sort((a, b) => b.n - a.n).slice(0, 100),
    });
  }
  if (p[1] === 'event-bookings') {
    if (p.length === 2 && m === 'GET') {
      const q = new URL(req.url).searchParams;
      const sid = q.get('search_id') ? await ownSearchId(env, user.id, q.get('search_id')) : null;
      const st = q.get('status');
      const rows = (await DB.prepare(`SELECT b.* FROM event_bookings b JOIN members m ON m.search_id=b.search_id AND m.user_id=? AND m.role='owner'
          WHERE (? IS NULL OR b.search_id=?) AND (? IS NULL OR b.status=?) ORDER BY b.starts_at LIMIT 200`).bind(user.id, sid, sid, st, st).all<Row>()).results ?? [];
      const evs = new Map<string, Row>();
      for (const id of [...new Set(rows.map((r) => r.event_id))]) { const e = await DB.prepare('SELECT * FROM afisha WHERE id=?').bind(id).first<Row>(); if (e) evs.set(id, e); }
      const uids = [...new Set(rows.flatMap((r) => parseJson<string[]>(r.who, [])))];
      const names = new Map(uids.length ? ((await DB.prepare(`SELECT id, display_name FROM users WHERE id IN (${uids.map(() => '?').join(',')})`).bind(...uids).all<Row>()).results ?? []).map((u) => [u.id, u.display_name]) : []);
      return json({ bookings: rows.map((r) => bookingView(r, evs.get(r.event_id) ?? null, names)) });
    }
    const bk = p[2] ? await DB.prepare(`SELECT b.* FROM event_bookings b JOIN members m ON m.search_id=b.search_id AND m.user_id=? AND m.role='owner' WHERE b.id=?`).bind(user.id, p[2]).first<Row>() : null;
    if (p[2] && !bk) throw new HttpError(404, 'no_booking');
    if (bk && p[3] === 'draft' && m === 'POST') {
      const b = await body(req);
      const ev = await DB.prepare('SELECT * FROM afisha WHERE id=?').bind(bk.event_id).first<Row>();
      if (!ev) throw new HttpError(404, 'no_event');
      if (['cancelled', 'booked', 'attended'].includes(bk.status)) throw new HttpError(409, 'booking_' + bk.status, `The booking is ${bk.status}`);
      const channel = b.channel ? oneOf(b.channel, ORG_CHANNELS.filter((c) => c !== 'web'), 'channel') : ev.organizer_channel;
      const address = b.address ? txt(b.address, 'address', 200) : ev.organizer_address;
      if (!channel || !address || channel === 'web') throw new HttpError(400, 'no_organizer_contact', 'The event has no organizer channel/address: pass channel and address');
      const who = parseJson<string[]>(bk.who, []);
      const names = ((await DB.prepare(`SELECT id, display_name FROM users WHERE id IN (${who.map(() => '?').join(',') || "''"})`).bind(...who).all<Row>()).results ?? []).map((u) => String(u.display_name).split(/\s+/)[0]);
      const lang = String(b.lang ?? ev.organizer_lang ?? (['en', 'ru', 'id'].includes(ev.lang) ? ev.lang : 'en')).toLowerCase();
      const text = b.text ? txt(b.text, 'text', 1000, true)! : bookingText(lang, { title: ev.title_en && lang !== 'ru' ? ev.title_en : ev.title, occ: bk.occ, time: String(bk.starts_at).slice(11, 16), n: who.length + Number(bk.guests || 0),
        names: [...names, ...(bk.guests ? [lang === 'ru' ? `+${bk.guests}` : `+${bk.guests}`] : [])], kind: bk.kind, price_kind: ev.price_kind });
      const s = await DB.prepare('SELECT * FROM searches WHERE id=?').bind(bk.search_id).first<Row>();
      const id = rid('d_');
      const t = now();
      // Events are shared, the organizer's contact is the hunter's own: another hunter's contact is not used.
      const own = await ownerOfSearch(env, bk.search_id);
      const contact = b.contact_id ? await requireContact(env, own, b.contact_id) : ev.organizer_contact_id && (await isOwnContact(env, own, ev.organizer_contact_id)) ? ev.organizer_contact_id : null;
      const reason = txt(b.reason, 'reason', 300) ?? `Афиша: ${ev.title}, ${bk.occ}`;
      await DB.prepare(`INSERT INTO drafts (id, search_id, contact_id, listing_id, channel, address, text, kind, reason, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?, 'event_book', ?, 'pending', ?, ?)`)
        .bind(id, bk.search_id, contact, null, channel, address, text, reason, t, t).run();
      await DB.prepare("UPDATE event_bookings SET draft_id=?, status='drafted', updated_at=? WHERE id=?").bind(id, t, bk.id).run();
      const draft = await DB.prepare('SELECT * FROM drafts WHERE id=?').bind(id).first<Row>();
      await draftToOwner(env, s, draft);
      await DB.prepare('UPDATE searches SET agent_seen_at=? WHERE id=?').bind(t, bk.search_id).run();
      const nm = new Map(((await DB.prepare(`SELECT id, display_name FROM users WHERE id IN (${who.map(() => '?').join(',') || "''"})`).bind(...who).all<Row>()).results ?? []).map((u) => [u.id, u.display_name]));
      const nb = await DB.prepare('SELECT * FROM event_bookings WHERE id=?').bind(bk.id).first<Row>();
      return json({ draft, booking: bookingView(nb!, ev, nm) }, 201);
    }
    if (bk && p.length === 3 && m === 'PUT') {
      const b = await body(req);
      const st = oneOf(b.status, BOOK_STATUSES.filter((x) => x !== 'requested' && x !== 'drafted'), 'status');
      if (!st) throw new HttpError(400, 'bad_status', 'status is required');
      const note = 'note' in b ? txt(b.note, 'note', 300) : bk.note;
      await DB.prepare('UPDATE event_bookings SET status=?, note=?, updated_at=? WHERE id=?').bind(st, note, now(), bk.id).run();
      const ev = await DB.prepare('SELECT * FROM afisha WHERE id=?').bind(bk.event_id).first<Row>();
      await event(env, bk.search_id, 'event_booking', bk.id, 'agent', { booking_id: bk.id, title: ev?.title, occ: bk.occ, status: st, note });
      if (st === 'booked' && st !== bk.status && ev) {
        // Tell the people who go (once): it's in the Plan, payment on the spot by them.
        const who = new Set(parseJson<string[]>(bk.who, []));
        const time = String(bk.starts_at).slice(11, 16);
        await dmMembers(env, bk.search_id, (lang) => ({
          text: lang === 'ru' ? `Записали: <b>${escH(ev.title)}</b>, ${bk.occ.slice(8, 10)}.${bk.occ.slice(5, 7)} в ${time}${ev.price_kind === 'free' ? '' : '. Оплата на месте, сами'}` : `Booked: <b>${escH(ev.title_en || ev.title)}</b>, ${bk.occ.slice(8, 10)}.${bk.occ.slice(5, 7)} at ${time}${ev.price_kind === 'free' ? '' : '. You pay on site'}`,
          buttons: [[{ text: lang === 'ru' ? 'План' : 'Plan', web_app: { url: appUrl(env, `/s/${bk.search_id}/plan`) } }]],
        }), { quiet: 'postpone', key: `evbooked:${bk.id}`, skip: new Set((await DB.prepare("SELECT user_id FROM members WHERE search_id=?").bind(bk.search_id).all<Row>()).results?.map((x) => x.user_id).filter((u) => !who.has(u)) ?? []) });
      }
      const uids = parseJson<string[]>(bk.who, []);
      const names = new Map(uids.length ? ((await DB.prepare(`SELECT id, display_name FROM users WHERE id IN (${uids.map(() => '?').join(',')})`).bind(...uids).all<Row>()).results ?? []).map((u) => [u.id, u.display_name]) : []);
      const nb = await DB.prepare('SELECT * FROM event_bookings WHERE id=?').bind(bk.id).first<Row>();
      return json({ booking: bookingView(nb!, ev, names) });
    }
  }
  return null;
}

/** Wave 9: store "how was it" for one member (attended + rating + note) and tell the agent's digest. */
export async function rateEvent(env: Env, r: Row, sid: string, user: { id: string; display_name: string }, occ: string | null, rating: number, note: string | null, setNote: boolean) {
  const t = now();
  await env.DB.prepare(`INSERT INTO event_feedback (event_id, user_id, search_id, occ, attended, rating, note, category, topic, organizer_key, place_key, created_at, updated_at)
      VALUES (?,?,?,?,1,?,?,?,?,?,?,?,?)
      ON CONFLICT(event_id, user_id, search_id) DO UPDATE SET attended=1, rating=excluded.rating, ${setNote ? 'note=excluded.note,' : ''} occ=COALESCE(excluded.occ, occ), nope=0, updated_at=excluded.updated_at`)
    .bind(r.id, user.id, sid, occ, rating, note, r.category, r.topic, orgKey(r), placeKey(r), t, t).run();
  await env.DB.prepare("UPDATE event_bookings SET status='attended', updated_at=? WHERE search_id=? AND event_id=? AND (? IS NULL OR occ=?) AND status IN ('booked','asked')").bind(t, sid, r.id, occ, occ).run();
  await event(env, sid, 'event_rated', r.id, user.id, { event_id: r.id, title: r.title, occ, rating, note, name: user.display_name });
}

/** Wave 9 · evening Home: today's bookings the viewer goes to, with the ride minutes from the home (feed occurrence) and who goes. */
export async function tonightEvents(env: Env, s: SearchRow, viewer: string) {
  const tz = searchTzOf(s);
  const today = localDay(tz);
  const bks = ((await env.DB.prepare("SELECT * FROM event_bookings WHERE search_id=? AND occ=? AND status IN ('requested','drafted','asked','booked')").bind(s.id, today).all<Row>()).results ?? [])
    .filter((b) => parseJson<string[]>(b.who, []).includes(viewer));
  if (!bks.length) return [];
  const c = await loadCtx(env, s, today, today);
  const ids = new Set(bks.map((b) => b.event_id));
  const rows = ((await env.DB.prepare(`SELECT * FROM afisha WHERE id IN (${[...ids].map(() => '?').join(',')})`).bind(...ids).all<Row>()).results ?? []);
  c.events = rows;
  const xs = rank(c, { viewer, from: today, to: today, seed: 0, f: new Set(), tab: 'all' });
  const out = [];
  for (const b of bks) {
    const x = xs.find((y) => y.row.id === b.event_id && y.occ === b.occ);
    if (!x) continue;
    const v = occView(x, c, viewer);
    const r = x.row;
    out.push({ ...v, who: parseJson<string[]>(b.who, []), booking_id: b.id, booking_status: b.status,
      can_late: ['asked', 'booked'].includes(b.status) && !!r.organizer_channel && !!r.organizer_address && r.organizer_channel !== 'web',
      organizer: { name: r.organizer_name, channel: r.organizer_channel } });
  }
  return out;
}

/** Drafts PATCH sent: a booking draft that went out moves the booking to "asked". */
export async function bookingDraftSent(env: Env, draftId: string) {
  await env.DB.prepare("UPDATE event_bookings SET status='asked', updated_at=? WHERE draft_id=? AND status IN ('requested','drafted')").bind(now(), draftId).run();
}

// ---------------------------------------------------------------- digest line and reminders

/** "🎟 Сегодня: Кечак на закате, 18:00 · Улувату" — the top event of today for the morning digest, or null. */
export async function afishaDigestLine(env: Env, s: SearchRow, lang: string, viewer: string | null): Promise<string | null> {
  const tz = searchTzOf(s);
  const today = localDay(tz);
  const c = await loadCtx(env, s, today, today);
  if (!c.events.length) return null;
  const xs = diversify(rank(c, { viewer, from: today, to: today, seed: 0, f: new Set(), tab: 'all' }).filter((x) => Date.parse(x.starts_at) > Date.now()), { seed: 0 }) as (Scored & { row: Row })[];
  const x = xs[0];
  if (!x) return null;
  const ru = lang === 'ru';
  const title = ru ? x.row.title : x.row.title_en || x.row.title;
  const place = x.row.place_name ? ` · ${String(x.row.place_name).split(/[·,(]/)[0].trim()}` : '';
  return `🎟 ${ru ? 'Сегодня' : 'Today'}: ${title}, ${x.starts_at.slice(11, 16)}${place}${x.why ? ` (${ru ? x.why.ru : x.why.en})` : ''}`;
}
/** Digest toggle: members.afisha 1 / 0 / NULL = on once the project has a home (found/living). */
export const afishaOn = (pref: number | null | undefined, status: string | null | undefined) => (pref == null ? ['found', 'living'].includes(String(status)) : !!pref);

/** Cron: a reminder 2 h before a booked event to the people who go (once per booking). */
export async function afishaCron(env: Env) {
  const lo = new Date(Date.now() - 864e5).toISOString().slice(0, 10), hi = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const rows = (await env.DB.prepare(`SELECT b.*, e.title, e.title_en, e.place_name, e.price_kind FROM event_bookings b JOIN afisha e ON e.id=b.event_id WHERE b.status='booked' AND b.occ BETWEEN ? AND ?`).bind(lo, hi).all<Row>()).results ?? [];
  for (const b of rows) {
    const left = Date.parse(b.starts_at) - Date.now();
    if (left <= 0 || left > 2 * 3600e3) continue;
    const key = `evrem:${b.id}`;
    const ins = await env.DB.prepare('INSERT OR IGNORE INTO sent_marks (key, at) VALUES (?,?)').bind(key, now()).run();
    if (!ins.meta.changes) continue;
    const who = parseJson<string[]>(b.who, []);
    const people = who.length ? (await env.DB.prepare(`SELECT u.tg_user_id, u.lang FROM users u JOIN members m ON m.user_id=u.id AND m.search_id=? WHERE u.id IN (${who.map(() => '?').join(',')}) AND m.notify=1 AND u.tg_user_id IS NOT NULL`)
      .bind(b.search_id, ...who).all<Row>()).results ?? [] : [];
    const time = String(b.starts_at).slice(11, 16);
    for (const p of people) {
      const ru = p.lang === 'ru';
      await dm(env, p.tg_user_id, ru ? `Через 2 часа: <b>${escH(b.title)}</b> в ${time}${b.place_name ? `, ${escH(b.place_name)}` : ''}${b.price_kind === 'free' ? '' : '. Оплата на месте'}`
        : `In 2 hours: <b>${escH(b.title_en || b.title)}</b> at ${time}${b.place_name ? `, ${escH(b.place_name)}` : ''}${b.price_kind === 'free' ? '' : '. Pay on site'}`,
      [[{ text: ru ? 'Открыть' : 'Open', web_app: { url: appUrl(env, `/s/${b.search_id}/event/${encodeURIComponent(b.event_id + '@' + b.occ)}`) } }]]);
    }
  }
}
