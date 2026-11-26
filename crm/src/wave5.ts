// Wave 5: access roles (owner / member / guest), surf forecast, guest guide (+ the public /g/<token> page), "what next" before
// the lease ends, negotiation helper (market stats, price history, offer), deal prices, search recap, guests on dates.
// Shared by the agent API (agent.ts), the Mini App (app.ts), the bot (bot.ts) and the cron (notify.ts).
import { Env, HttpError, now, rid, parseJson, event, hmac, hex, sha256hex, dtf } from './util';
import { sensitive } from './agent';
import { packData } from './life';
import { countryOf, regionTz, animalInfo } from './members';
import { ANIMALS } from './animals';
import { basePlaces, kmBetween, matchDossiers } from './wave4';
import { daysUntil } from './deal';
import { fileResponse, tg } from './tg';
import { withSrc, kvPhoto, mediaHeaders } from './media';

const txt = (v: unknown, n: number) => (v == null ? null : String(v).trim().slice(0, n) || null);
const isDay = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export const localDay = (tz: string, at = Date.now()) =>
  dtf('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
const localHour = (tz: string, at = Date.now()) =>
  Number(dtf('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date(at)));
function noSecrets(what: string, ...parts: unknown[]) {
  const s = sensitive(parts.map((x) => (typeof x === 'string' ? x : JSON.stringify(x ?? ''))).join(' '));
  if (s) throw new HttpError(400, 'sensitive', `${what} looks like it contains ${s}. Remove it.`);
}
/** HTML escape for text AND attribute values (util.esc does not escape quotes). */
export const h = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const searchTzOf = (s: { region?: string | null; brief?: any }) => {
  const b = typeof s.brief === 'string' ? parseJson<any>(s.brief, {}) : s.brief ?? {};
  return b.timezone || regionTz(s.region);
};

// ---------------------------------------------------------------- roles

export type Role = 'owner' | 'member' | 'viewer' | 'guest';
export const GUEST_AREAS = ['guide', 'places', 'contacts', 'issues'] as const;
export type Areas = Record<(typeof GUEST_AREAS)[number], boolean>;
export interface Access { role: Role; region: string; title: string; owner_id: string; brief: string; tz: string; guest?: { from: string; to: string; areas: Areas; invited_by: string | null; animal: string | null } }

export function cleanAreas(v: any, fallback = true): Areas {
  const o: any = {};
  for (const k of GUEST_AREAS) o[k] = v && typeof v === 'object' && k in v ? !!v[k] : fallback;
  return o;
}
/** Guests can open the app 3 days before `from` until the end of `to` (search timezone). */
export const guestOpen = (g: { date_from: string; date_to: string; status: string }, today: string) => g.status === 'active' && today <= g.date_to && today >= addDays(g.date_from, -3);

/**
 * The caller's role in a search: a members row (owner / member / viewer), else an active guest inside the date window.
 * Throws 403 not_member otherwise. `roles` whitelists who may use the route.
 */
export async function member(env: Env, sid: string, uid: string, roles?: readonly Role[]): Promise<Access> {
  const r = await env.DB.prepare(
    `SELECT s.region, s.title, s.owner_id, s.brief, s.status sstatus, m.role, g.date_from, g.date_to, g.areas, g.status gstatus, g.invited_by, g.animal
     FROM searches s LEFT JOIN members m ON m.search_id=s.id AND m.user_id=?2 LEFT JOIN guests g ON g.search_id=s.id AND g.user_id=?2 WHERE s.id=?1`,
  ).bind(String(sid ?? ''), uid).first<any>();
  if (!r) throw new HttpError(403, 'not_member');
  const tz = searchTzOf(r);
  let a: Access;
  if (r.role) a = { role: r.role, region: r.region, title: r.title, owner_id: r.owner_id, brief: r.brief, tz };
  // Wave 6: guests lose access when the project is closed.
  else if (r.gstatus && r.sstatus !== 'closed' && guestOpen({ date_from: r.date_from, date_to: r.date_to, status: r.gstatus }, localDay(tz))) {
    a = { role: 'guest', region: r.region, title: r.title, owner_id: r.owner_id, brief: r.brief, tz,
      guest: { from: r.date_from, to: r.date_to, areas: cleanAreas(parseJson(r.areas, {}), false), invited_by: r.invited_by, animal: r.animal } };
  } else throw new HttpError(403, 'not_member');
  if (roles && !roles.includes(a.role)) throw new HttpError(403, a.role === 'guest' ? 'guest' : a.role === 'viewer' ? 'viewer' : 'owner_only');
  return a;
}
export function needArea(a: Access, area: (typeof GUEST_AREAS)[number]) {
  if (a.role === 'guest' && !a.guest?.areas[area]) throw new HttpError(403, 'guest_area', `Guests of this house do not have "${area}"`);
}
/** True when the user is a guest somewhere and a member nowhere (the Mini App guard answers 403 'guest' outside guest routes). */
export async function guestOnly(env: Env, uid: string): Promise<boolean> {
  const r = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM members WHERE user_id=?1) m, (SELECT COUNT(*) FROM guests WHERE user_id=?1 AND status='active') g`).bind(uid).first<any>();
  return !Number(r?.m) && Number(r?.g) > 0;
}
export async function isGuestOf(env: Env, sid: string, uid: string): Promise<boolean> {
  return !!(await env.DB.prepare('SELECT 1 FROM guests WHERE search_id=? AND user_id=?').bind(sid, uid).first());
}

// ---------------------------------------------------------------- the home point and places around it

export async function regionInfo(env: Env, region: string) {
  const pack = (await packData(env))?.[countryOf(region)] ?? {};
  const sub = pack.sub?.[String(region).split('/')[1]] ?? {};
  return { pack, sub, kmh: Number(sub.travel?.kmh) || (pack.drive === 'car' ? 30 : 25), mode: sub.travel?.mode ?? 'scooter' };
}
export const minutesKm = (km: number, kmh: number) => Math.max(1, Math.round(((km * 1.35) / kmh) * 60));

/** The deal listing (the house), or null. */
export async function homeListing(env: Env, sid: string) {
  return env.DB.prepare(`SELECT l.*, d.data deal_data FROM deals d JOIN listings l ON l.id=d.listing_id WHERE d.search_id=? ORDER BY d.updated_at DESC LIMIT 1`).bind(sid).first<any>();
}

/** Where "near" is measured from: the deal house, else the brief anchor(s), else the centre of the brief districts' areas. */
export async function homePoint(env: Env, s: { id: string; region: string; brief: any }) {
  const hl = await homeListing(env, s.id);
  if (hl && Number.isFinite(hl.lat) && Number.isFinite(hl.lng) && hl.lat != null) return { lat: Number(hl.lat), lng: Number(hl.lng), label: parseJson<any>(hl.deal_data, {}).name ?? hl.title, source: 'deal' as const, district: hl.district };
  const b = typeof s.brief === 'string' ? parseJson<any>(s.brief, {}) : s.brief ?? {};
  const anchors = [b.anchor, ...(Array.isArray(b.anchors) ? b.anchors : [])].filter((a) => a && typeof a === 'object' && Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lng)));
  const a = anchors.find((x) => ['surf', 'beach'].includes(x.type) || x.icon === 'waves') ?? anchors[0];
  if (a) return { lat: Number(a.lat), lng: Number(a.lng), label: a.label ?? a.name ?? null, source: 'anchor' as const, district: null };
  const { pack } = await regionInfo(env, s.region);
  const ds: string[] = Array.isArray(b.districts) ? b.districts : [];
  const cs = Object.values<any>(pack.areas ?? {}).filter((ar) => Array.isArray(ar.center) && (ar.districts ?? []).some((d: string) => ds.includes(d)));
  if (cs.length) return { lat: cs.reduce((x, ar) => x + ar.center[0], 0) / cs.length, lng: cs.reduce((x, ar) => x + ar.center[1], 0) / cs.length, label: null, source: 'districts' as const, district: ds[0] ?? null };
  return null;
}
function areaNameOf(pack: any, district: string | null | undefined, lang = 'ru') {
  if (!district) return null;
  const ar = Object.values<any>(pack.areas ?? {}).find((x) => (x.districts ?? []).includes(district)) ?? pack.areas?.[district];
  if (ar?.name) return ar.name[lang] ?? ar.name.en ?? null;
  for (const sub of Object.values<any>(pack.sub ?? {})) if (sub.districts?.[district]) return sub.districts[district][lang] ?? sub.districts[district].en;
  return null;
}

/** Base pack places + the search's own places (not hidden), one shape, with minutes from a point. */
async function placesAround(env: Env, s: { id: string; region: string }, pt: { lat: number; lng: number }, kmh: number) {
  const bp = await basePlaces(env, countryOf(s.region));
  const own = (await env.DB.prepare('SELECT id, name, type, tier, lat, lng, note FROM places WHERE search_id=? AND hidden=0').bind(s.id).all<any>()).results ?? [];
  const all = [...own.map((p) => ({ ...p, own: true })), ...(bp.places ?? []).map((p: any) => ({ ...p, id: 'b:' + p.id, own: false }))];
  return { types: bp.types ?? {}, list: all.filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))).map((p) => ({ ...p, minutes: minutesKm(kmBetween([pt.lat, pt.lng], [Number(p.lat), Number(p.lng)]), kmh) })) };
}

// ---------------------------------------------------------------- surf

const LEVEL_RANGE: Record<string, [number, number]> = { beginner: [0.5, 1.3], intermediate: [0.8, 2.0], advanced: [1.2, 3.0] };
const angDiff = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
const hhmm = (h: number) => `${String(h).padStart(2, '0')}:00`;

interface Hourly { time: string[]; h: (number | null)[]; p: (number | null)[]; wd: (number | null)[]; ws: (number | null)[]; wdir: (number | null)[] }

/** Open-Meteo marine + wind for many points: one request each (comma-separated coordinates). Only numbers go out. */
async function fetchForecast(pts: { lat: number; lng: number }[], tz: string): Promise<Hourly[]> {
  const lat = pts.map((p) => Number(p.lat).toFixed(4)).join(','), lng = pts.map((p) => Number(p.lng).toFixed(4)).join(',');
  if (!pts.every((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)))) throw new HttpError(400, 'bad_point');
  const q = (vars: string) => `latitude=${lat}&longitude=${lng}&hourly=${vars}&timezone=${encodeURIComponent(tz)}&forecast_days=3`;
  const [mr, wr] = await Promise.all([
    fetch(`https://marine-api.open-meteo.com/v1/marine?${q('wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period')}`, { headers: { 'user-agent': 'hunt-crm' } }),
    fetch(`https://api.open-meteo.com/v1/forecast?${q('wind_speed_10m,wind_direction_10m')}`, { headers: { 'user-agent': 'hunt-crm' } }),
  ]);
  if (!mr.ok || !wr.ok) throw new Error(`open-meteo ${mr.status}/${wr.status}`);
  const arr = (x: any) => (Array.isArray(x) ? x : [x]);
  const m = arr(await mr.json()), w = arr(await wr.json());
  return pts.map((_, i) => {
    const mh = m[i]?.hourly ?? {}, wh = w[i]?.hourly ?? {};
    const time: string[] = mh.time ?? wh.time ?? [];
    const wt: string[] = wh.time ?? [];
    const at = (xs: any[] | undefined, t: string) => { const j = wt.indexOf(t); return j >= 0 ? xs?.[j] ?? null : null; };
    return {
      time,
      h: time.map((_t, j) => mh.wave_height?.[j] ?? mh.swell_wave_height?.[j] ?? null),
      p: time.map((_t, j) => mh.swell_wave_period?.[j] ?? mh.wave_period?.[j] ?? null),
      wd: time.map((_t, j) => mh.wave_direction?.[j] ?? null),
      ws: time.map((t) => at(wh.wind_speed_10m, t)),
      wdir: time.map((t) => at(wh.wind_direction_10m, t)),
    };
  });
}

function rateHour(spot: any, i: number, f: Hourly) {
  const height = f.h[i], period = f.p[i], ws = f.ws[i], wdir = f.wdir[i];
  if (height == null) return null;
  const lvl = LEVEL_RANGE[spot.level ?? ''] ?? [0.6, 2.5];
  const hs = height >= lvl[0] && height <= lvl[1] ? 1 : height >= lvl[0] * 0.7 && height <= lvl[1] * 1.3 ? 0.5 : 0;
  const ps = period == null ? 0.4 : period >= 13 ? 1 : period >= 10 ? 0.7 : period >= 8 ? 0.4 : 0.1;
  let wind: 'offshore' | 'cross' | 'onshore' | null = null;
  let wsc = 0.6;
  if (spot.faces != null && ws != null && wdir != null) {
    if (ws < 8 || angDiff(wdir, (spot.faces + 180) % 360) <= 50) { wind = 'offshore'; wsc = 1; }
    else if (angDiff(wdir, spot.faces) <= 60 && ws > 15) { wind = 'onshore'; wsc = 0; }
    else { wind = 'cross'; wsc = 0.5; }
  }
  const total = hs === 0 ? 0.2 : hs * 0.45 + ps * 0.3 + wsc * 0.25;
  return { total, wind, height, period };
}

/** One spot's day: best daylight window at the day's top rating, wind story, stars. */
function rateDay(spot: any, f: Hourly, day: string) {
  const idx = f.time.map((t, i) => ({ t, i })).filter((x) => x.t.startsWith(day) && Number(x.t.slice(11, 13)) >= 6 && Number(x.t.slice(11, 13)) <= 17); // daylight hours starting 06:00–17:00
  const rated = idx.map((x) => ({ hour: Number(x.t.slice(11, 13)), r: rateHour(spot, x.i, f) })).filter((x) => x.r) as { hour: number; r: NonNullable<ReturnType<typeof rateHour>> }[];
  if (!rated.length) return null;
  const top = Math.max(...rated.map((x) => x.r.total));
  let best: typeof rated = [], cur: typeof rated = [];
  for (const x of rated) {
    if (x.r.total >= top - 0.08 && (!cur.length || x.hour === cur[cur.length - 1].hour + 1)) cur.push(x);
    else { if (cur.length > best.length) best = cur; cur = x.r.total >= top - 0.08 ? [x] : []; }
  }
  if (cur.length > best.length) best = cur;
  const peak = best.reduce((a, x) => (x.r.total > a.r.total ? x : a), best[0]);
  let wind: any = null;
  if (spot.faces != null) {
    const start = best[0].hour;
    const fromStart = rated.filter((x) => x.hour >= start);
    let until: number | null = null, later: any = null;
    if (fromStart[0]?.r.wind === 'offshore') {
      const k = fromStart.findIndex((x) => x.r.wind !== 'offshore');
      until = k < 0 ? null : fromStart[k].hour;
      later = k < 0 ? null : fromStart[k].r.wind;
    }
    const firstOff = rated.find((x) => x.r.wind === 'offshore');
    wind = { offshore_until: until != null ? hhmm(until) : null, offshore_from: fromStart[0]?.r.wind !== 'offshore' && firstOff ? hhmm(firstOff.hour) : null, later };
  }
  return {
    height: Math.round(peak.r.height * 10) / 10, period: peak.r.period != null ? Math.round(peak.r.period) : null,
    stars: top >= 0.75 ? 3 : top >= 0.5 ? 2 : 1, score: Math.round(top * 100) / 100,
    window: { from: hhmm(best[0].hour), to: hhmm(best[best.length - 1].hour + 1) }, wind, rated_wind: spot.faces != null,
  };
}

/** Surf spots within 30 min of the home, with today's rating. fetch=false (the digest) reads the D1 cache only. */
export async function surfView(env: Env, s: { id: string; region: string; brief: any }, opts: { fetch?: boolean; refresh?: boolean; lang?: string } = {}) {
  const tz = searchTzOf(s);
  const day = localDay(tz);
  const pt = await homePoint(env, s);
  const { pack, kmh } = await regionInfo(env, s.region);
  const base = { home: pt ? { lat: pt.lat, lng: pt.lng, label: pt.label, source: pt.source } : null, date: day, tz, area_name: pt ? areaNameOf(pack, pt.district, opts.lang) : null };
  if (!pt) return { ...base, spots: [], best: null, updated_at: null, error: 'no_home' };
  const { list } = await placesAround(env, s, pt, kmh);
  const level = (tags: any[]) => (tags ?? []).map(String).find((t) => t.startsWith('level-'))?.slice(6) ?? null;
  const spots = list.filter((p) => p.type === 'surf' && p.minutes <= 30).sort((a, b) => a.minutes - b.minutes || a.tier - b.tier).slice(0, 8)
    .map((p) => ({ id: p.id, name: p.name, tier: p.tier, lat: Number(p.lat), lng: Number(p.lng), minutes: p.minutes, faces: Number.isFinite(Number(p.faces)) ? Number(p.faces) : null,
      level: level(p.tags), bottom: (p.tags ?? []).includes('reef') ? 'reef' : (p.tags ?? []).includes('beach-break') ? 'beach' : null }));
  if (!spots.length) return { ...base, spots: [], best: null, updated_at: null, error: 'no_spots' };
  const ids = spots.map((x) => x.id);
  const rows = (await env.DB.prepare(`SELECT spot_id, fetched_at, hourly FROM surf_cache WHERE spot_id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<any>()).results ?? [];
  const cache = new Map(rows.map((r) => [r.spot_id, r]));
  const fresh = (r: any) => r && Date.now() - Date.parse(r.fetched_at) < 3 * 3600e3 && parseJson<Hourly | null>(r.hourly, null)?.time?.some((t) => t.startsWith(day));
  let error: string | null = null;
  const stale = spots.filter((x) => opts.refresh || !fresh(cache.get(x.id)));
  if (opts.fetch && stale.length) {
    try {
      const got = await fetchForecast(stale, tz);
      const t = now();
      await env.DB.batch(stale.map((x, i) => env.DB.prepare(`INSERT INTO surf_cache (spot_id, lat, lng, fetched_at, hourly) VALUES (?,?,?,?,?)
        ON CONFLICT(spot_id) DO UPDATE SET lat=excluded.lat, lng=excluded.lng, fetched_at=excluded.fetched_at, hourly=excluded.hourly`).bind(x.id, x.lat, x.lng, t, JSON.stringify(got[i]))));
      stale.forEach((x, i) => cache.set(x.id, { spot_id: x.id, fetched_at: t, hourly: JSON.stringify(got[i]) }));
    } catch (e) {
      console.error('surf', String((e as Error)?.message ?? e));
      error = 'forecast_unavailable';
    }
  }
  const out = spots.map((x) => {
    const f = parseJson<Hourly | null>(cache.get(x.id)?.hourly, null);
    const r = f ? rateDay(x, f, day) : null;
    const { lat, lng, ...rest } = x;
    return { ...rest, height: r?.height ?? null, period: r?.period ?? null, stars: r?.stars ?? null, score: r?.score ?? null, window: r?.window ?? null, wind: r?.wind ?? null, rated_wind: r?.rated_wind ?? x.faces != null };
  });
  const rated = out.filter((x) => x.score != null);
  const best = rated.length ? rated.reduce((a, x) => (x.score! > a.score! || (x.score === a.score && x.minutes < a.minutes) ? x : a), rated[0]).id : null;
  const at = [...cache.values()].map((r) => r.fetched_at).sort().pop() ?? null;
  return { ...base, spots: out, best, updated_at: at, error: rated.length ? null : error ?? 'forecast_unavailable' };
}

/** Members' digest switch: explicit 1/0, NULL = on when the brief mentions surf. */
export const briefMentionsSurf = (brief: any) => {
  const b = typeof brief === 'string' ? parseJson<any>(brief, {}) : brief ?? {};
  const t = [b.must_have, b.nice_to_have, b.style, ...(Array.isArray(b.anchors) ? b.anchors.map((a: any) => `${a.type} ${a.name}`) : []), b.anchor?.icon, b.anchor?.label].filter(Boolean).join(' ').toLowerCase();
  return /серф|surf|волн|waves/.test(t);
};
export const surfOn = (memberSurf: number | null | undefined, brief: any) => (memberSurf == null ? briefMentionsSurf(brief) : memberSurf === 1);

/** "🏄 Green Bowl 1,2 м, с берега до 10:00" from the cache only (no fetch), or null. */
export async function surfDigestLine(env: Env, s: { id: string; region: string; brief: any }, lang: string): Promise<string | null> {
  const v = await surfView(env, s, { fetch: false });
  const b = v.spots.find((x) => x.id === v.best);
  if (!b || b.height == null || (b.stars ?? 0) < 2) return null;
  const ru = lang === 'ru';
  const hgt = ru ? String(b.height).replace('.', ',') + ' м' : `${b.height} m`;
  const tail = b.wind?.offshore_until ? (ru ? `с берега до ${b.wind.offshore_until}` : `offshore until ${b.wind.offshore_until}`)
    : b.window ? (ru ? `лучше ${b.window.from}–${b.window.to}` : `best ${b.window.from}–${b.window.to}`) : '';
  return `🏄 ${b.name} ${hgt}${tail ? ', ' + tail : ''}`;
}

// ---------------------------------------------------------------- guide

const RULE_ICONS = ['smoke', 'water', 'zap', 'trash', 'moon', 'key', 'car', 'dog', 'pool', 'shoe', 'info'];
async function guideToken(env: Env, sid: string, version: number) {
  return hex(await hmac(env.LINK_SECRET, `guide|${sid}|${version}`)).slice(0, 32); // 128 bits, recomputable, only the hash is stored
}
export async function guideUrl(env: Env, row: any) {
  return row?.token_hash ? `${env.PUBLIC_URL}/g/${await guideToken(env, row.search_id, row.version)}` : null;
}
function cleanRules(v: unknown) {
  if (v == null) return null;
  if (!Array.isArray(v) || v.length > 12) throw new HttpError(400, 'bad_rules', 'rules must be a list of up to 12 {icon, text}');
  return v.map((x: any) => (typeof x === 'string' ? { icon: 'info', text: x } : x)).map((x: any) => ({ icon: RULE_ICONS.includes(x?.icon) ? x.icon : 'info', text: txt(x?.text, 140) })).filter((x) => x.text);
}
export async function setGuide(env: Env, sid: string, b: any, actor: string) {
  const old = await env.DB.prepare('SELECT * FROM guides WHERE search_id=?').bind(sid).first<any>();
  const v = (k: string, n: number) => (k in b ? txt(b[k], n) : old?.[k] ?? null);
  const row = {
    address: v('address', 200), map_url: v('map_url', 500), wifi_name: v('wifi_name', 64), wifi_password: v('wifi_password', 64), note: v('note', 400),
    rules: 'rules' in b ? cleanRules(b.rules) : parseJson(old?.rules, null),
  };
  if (row.map_url && !/^https:\/\//.test(row.map_url)) throw new HttpError(400, 'bad_url', 'map_url must be an https link');
  noSecrets('The guide', row.address ?? '', row.note ?? '', row.wifi_name ?? '', row.rules ?? []);
  if (row.wifi_password && sensitive(row.wifi_password)) throw new HttpError(400, 'sensitive', 'The Wi-Fi password looks like an ID or card number.');
  const hl = await homeListing(env, sid);
  const t = now();
  await env.DB.prepare(`INSERT INTO guides (search_id, listing_id, address, map_url, wifi_name, wifi_password, rules, note, updated_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(search_id) DO UPDATE SET listing_id=excluded.listing_id, address=excluded.address, map_url=excluded.map_url, wifi_name=excluded.wifi_name, wifi_password=excluded.wifi_password,
    rules=excluded.rules, note=excluded.note, updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
    .bind(sid, hl?.id ?? old?.listing_id ?? null, row.address, row.map_url, row.wifi_name, row.wifi_password, row.rules ? JSON.stringify(row.rules) : null, row.note, actor, old?.created_at ?? t, t).run();
  if (actor !== 'agent') await event(env, sid, 'guide', sid, actor, { fields: Object.keys(b).filter((k) => k !== 'search_id' && k !== 'wifi_password') });
}
/** share: make a link if there is none; regenerate: a new link (the old stops working); revoke: no link. share/regenerate make `uid` the host contact. */
export async function guideLink(env: Env, sid: string, action: string, uid: string) {
  if (!['share', 'regenerate', 'revoke'].includes(action)) throw new HttpError(400, 'bad_action');
  let row = await env.DB.prepare('SELECT * FROM guides WHERE search_id=?').bind(sid).first<any>();
  if (!row) { await setGuide(env, sid, {}, uid); row = await env.DB.prepare('SELECT * FROM guides WHERE search_id=?').bind(sid).first<any>(); }
  if (action === 'revoke') {
    await env.DB.prepare('UPDATE guides SET token_hash=NULL, updated_at=? WHERE search_id=?').bind(now(), sid).run();
    return null;
  }
  const version = action === 'regenerate' || !row.token_hash ? (action === 'regenerate' ? row.version + 1 : row.version) : row.version;
  const tok = await guideToken(env, sid, version);
  await env.DB.prepare('UPDATE guides SET token_hash=?, version=?, host_user_id=?, updated_at=? WHERE search_id=?').bind(await sha256hex(tok), version, uid, now(), sid).run();
  return `${env.PUBLIC_URL}/g/${tok}`;
}

/** The guide as members / guests / the public page see it. withSecret: Wi-Fi password; withUrl: the share link (members). */
export async function guideView(env: Env, s: { id: string; region: string; brief: any }, opts: { withSecret: boolean; withUrl: boolean; lang?: string; row?: any }) {
  const lang = opts.lang === 'en' ? 'en' : 'ru';
  const row = opts.row ?? (await env.DB.prepare('SELECT * FROM guides WHERE search_id=?').bind(s.id).first<any>());
  const hl = await homeListing(env, s.id);
  const { pack, kmh } = await regionInfo(env, s.region);
  const photos = parseJson<any[]>(hl?.photos, []);
  const lat = hl?.lat ?? null, lng = hl?.lng ?? null;
  let places: any[] = [];
  if (lat != null && lng != null) {
    const { list, types } = await placesAround(env, s, { lat, lng }, kmh);
    const order = ['beach', 'surf', 'coffee', 'supermarket', 'food', 'market', 'pharmacy', 'hospital', 'coworking', 'gym', 'yoga'];
    const byType = new Map<string, any>();
    for (const p of list.filter((x) => x.minutes <= 10).sort((a, b) => a.tier - b.tier || a.minutes - b.minutes)) if (order.includes(p.type) && !byType.has(p.type)) byType.set(p.type, p);
    places = order.filter((t) => byType.has(t)).slice(0, 6).map((t) => { const p = byType.get(t); return { name: p.name, type: p.type, emoji: types[p.type]?.emoji ?? null, minutes: p.minutes, lat: Number(p.lat), lng: Number(p.lng) }; });
  }
  const host = row?.host_user_id ? await env.DB.prepare('SELECT id, display_name, tg_username FROM users WHERE id=?').bind(row.host_user_id).first<any>() : null;
  const hosts = ((await env.DB.prepare(`SELECT u.display_name FROM members m JOIN users u ON u.id=m.user_id WHERE m.search_id=? AND m.role IN ('owner','member') ORDER BY m.role='owner' DESC, u.created_at`).bind(s.id).all<any>()).results ?? []).map((u) => String(u.display_name).split(' ')[0]);
  const em = (pack.emergency?.numbers ?? []).slice(0, 4).map((n: any) => ({ label: n.label?.[lang] ?? n.label?.en ?? n.id, phone: n.phone }));
  return {
    title: parseJson<any>(hl?.deal_data, {}).name ?? hl?.title ?? s.id, photo: hl ? withSrc(hl.id, photos)[0] ?? null : null, lat, lng,
    address: row?.address ?? hl?.area_text ?? null,
    map_url: row?.map_url ?? (lat != null ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : hl?.map_url ?? null),
    wifi_name: row?.wifi_name ?? null, wifi_password: opts.withSecret ? row?.wifi_password ?? null : null, wifi_password_set: !!row?.wifi_password,
    rules: parseJson<any[]>(row?.rules, []), note: row?.note ?? null,
    host: host ? { user_id: host.id, name: host.display_name, tg_username: host.tg_username ?? null } : null, hosts,
    url: opts.withUrl ? await guideUrl(env, row) : null, places, emergency: em, listing_id: hl?.id ?? null,
  };
}

const RULE_SVG: Record<string, string> = {
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  smoke: '<path d="M2 16h15v4H2zM22 16v4M18 8c0-2.5-2-2.5-2-5M22 8c0-2.5-2-2.5-2-5M2 2l20 20"/>',
  water: '<path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05zM12.56 6.6A11 11 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9L18 10l-2.7-3.6A2 2 0 0 0 13.7 6H7.3a2 2 0 0 0-1.6.8L3 10.5l-1.2.4C1.3 11.1 1 11.6 1 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
  dog: '<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.05Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/>',
  pool: '<path d="M2 12h20M2 17c1.5 0 2.5-1 4-1s2.5 1 4 1 2.5-1 4-1 2.5 1 4 1 2.5-1 4-1M6 12V5a2 2 0 0 1 4 0M14 12V5a2 2 0 0 1 4 0"/>',
  shoe: '<path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0ZM20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z"/>',
};
const svg = (paths: string, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

/** Public guest guide: GET /g/<token> (HTML) and /g/<token>/photo. No tracking, noindex, no-store, strict CSP, guide fields only. */
export async function handleGuidePage(req: Request, env: Env, path: string): Promise<Response> {
  const m = path.match(/^\/g\/([a-f0-9]{32})(\/photo)?\/?$/);
  const notFound = () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } });
  if (!m) return notFound();
  const row = await env.DB.prepare('SELECT g.*, s.region, s.brief, s.status FROM guides g JOIN searches s ON s.id=g.search_id WHERE g.token_hash=?').bind(await sha256hex(m[1])).first<any>();
  if (!row || row.status === 'closed') return notFound();
  const s = { id: row.search_id, region: row.region, brief: row.brief };
  if (m[2]) {
    const hl = await homeListing(env, s.id);
    const p = parseJson<any[]>(hl?.photos, [])[0];
    const hdr = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' };
    if (p?.kv) {
      const got = await kvPhoto(env, p.kv, p.i ?? null);
      return got ? new Response(got.body, { headers: mediaHeaders(got.type ?? 'image/jpeg', hdr) }) : notFound();
    }
    if (p?.file_id) { const r = await fileResponse(env, p.file_id); return new Response(r.body, { status: r.status, headers: { ...hdr, 'content-type': r.headers.get('content-type') ?? 'image/jpeg' } }); }
    if (p?.url && /^https:\/\//.test(p.url)) { const r = await fetch(p.url); return r.ok ? new Response(r.body, { headers: mediaHeaders(/^image\//.test(r.headers.get('content-type') ?? '') ? r.headers.get('content-type') : 'image/jpeg', hdr) }) : notFound(); }
    if (p?.url && /^\/demo\/[\w.-]+$/.test(p.url)) return env.ASSETS.fetch(new Request(new URL(p.url, req.url)));
    return notFound();
  }
  const ql = new URL(req.url).searchParams.get('lang');
  const lang = ql === 'en' || ql === 'ru' ? ql : /^ru|,\s*ru/i.test(req.headers.get('accept-language') ?? '') ? 'ru' : 'en';
  const g = await guideView(env, s, { withSecret: true, withUrl: false, lang, row });
  const ru = lang === 'ru';
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  const hosts = g.hosts.length > 1 ? `${g.hosts.slice(0, -1).join(', ')} ${ru ? 'и' : 'and'} ${g.hosts[g.hosts.length - 1]}` : g.hosts[0] ?? '';
  const hostsRu = ru ? g.hosts.map((n) => n.replace(/(.*?)(ь|й)$/, '$1я').replace(/(.*?)([^аяьйео])$/, '$1$2а')) : g.hosts;
  const hostsLabel = ru ? (hostsRu.length > 1 ? `${hostsRu.slice(0, -1).join(', ')} и ${hostsRu[hostsRu.length - 1]}` : hostsRu[0] ?? '') : hosts;
  const I = {
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    wifi: '<path d="M12 20h.01M2 8.82a15 15 0 0 1 20 0M5 12.86a10 10 0 0 1 14 0M8.5 16.43a5 5 0 0 1 7 0"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  };
  const min = (n: number) => (ru ? `${n} мин` : `${n} min`);
  const body = `
<div class="bar" aria-hidden="true">hunt</div>
${g.photo ? `<img class="hero" src="/g/${h(m[1])}/photo" alt="">` : ''}
<main>
<p class="kicker">${ru ? 'Гайд для гостей' : 'Guest guide'}${hostsLabel ? ` · ${ru ? 'от' : 'from'} ${h(hostsLabel)}` : ''}</p>
<h1>${h(g.title)}</h1>
${g.address || g.map_url ? `<section class="card row">${svg(I.pin)}<div class="grow"><b>${h(g.address ?? (ru ? 'Адрес' : 'Address'))}</b></div>${g.map_url ? `<a class="btn accent" href="${h(g.map_url)}" rel="noopener noreferrer" target="_blank">${ru ? 'Карта' : 'Map'}</a>` : ''}</section>` : ''}
${g.wifi_name ? `<section class="card row">${svg(I.wifi)}<div class="grow"><b>Wi-Fi: ${h(g.wifi_name)}</b>${g.wifi_password ? `<span class="muted">${ru ? 'пароль' : 'password'}: <span id="pw" data-pw="${h(g.wifi_password)}">••••••••</span></span>` : ''}</div>${g.wifi_password ? `<button class="btn" id="show" type="button">${ru ? 'Показать' : 'Show'}</button>` : ''}</section>` : ''}
${g.rules.length ? `<section class="card list"><h2>${ru ? 'Правила дома' : 'House rules'}</h2>${g.rules.map((r: any) => `<div class="li">${svg(RULE_SVG[r.icon] ?? RULE_SVG.info, 'ic muted')}<span>${h(r.text)}</span></div>`).join('')}</section>` : ''}
${g.note ? `<section class="card"><p>${h(g.note)}</p></section>` : ''}
${g.places.length ? `<div class="places">${g.places.map((p: any) => `<a class="card place" href="https://www.google.com/maps/search/?api=1&amp;query=${Number(p.lat)},${Number(p.lng)}" rel="noopener noreferrer" target="_blank"><span class="muted">${h(p.emoji ?? '📍')} ${min(p.minutes)}</span><b>${h(p.name)}</b></a>`).join('')}</div>` : ''}
${g.emergency.length ? `<section class="card list"><h2>${ru ? 'Экстренные номера' : 'Emergency numbers'}</h2>${g.emergency.map((e: any) => `<a class="li" href="tel:${h(String(e.phone).replace(/[^\d+]/g, ''))}">${svg(I.phone, 'ic muted')}<span class="grow">${h(e.label)}</span><b>${h(e.phone)}</b></a>`).join('')}</section>` : ''}
${g.host ? `<section class="card row">${svg(I.send)}<div class="grow"><b>${h(g.host.name)}</b><span class="muted">${ru ? 'хозяева дома' : 'your hosts'}</span></div>${g.host.tg_username ? `<a class="btn accent" href="https://t.me/${h(g.host.tg_username)}" rel="noopener noreferrer" target="_blank">Telegram</a>` : ''}</section>` : ''}
<p class="foot">hunt</p>
</main>`;
  // Wave 8 · Block vibe (DESIGN.md "Update 21.11.2026"): the region's solid screen colour, dot grid, ink text, a floating tilted
  // photo, a giant title, hairline lists and black pills; night palette in the dark theme. The strict CSP stays (no web fonts,
  // no data: images), so Inter Tight is used only when installed, then the system sans.
  const screen = ({ bali: '#E8E35C', kz: '#9ED0F2', th: '#FFB65C' } as Record<string, string>)[String(row.region ?? '').split('/')[0]] ?? '#E6E4DF';
  const css = `:root{--ground:${screen};--ink:#151413;--muted:#46433D;--line:#1514131F;--line2:#15141340;--fill:#151413;--on:#F2F0EA;--dots:#1514131C;--paper:#F5F4F0}
@media (prefers-color-scheme:dark){:root{--ground:#151413;--ink:#F2F0EA;--muted:#A9A59C;--line:#F2F0EA26;--line2:#F2F0EA66;--fill:#F2F0EA;--on:#151413;--dots:#F2F0EA1F;--paper:#22201E}}
*{box-sizing:border-box}html{background:var(--ground)}body{margin:0;background-color:var(--ground);background-image:radial-gradient(var(--dots) 1px,transparent 1.3px);background-size:18px 18px;color:var(--ink);font:16px/1.4 "Inter Tight","Inter",-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;letter-spacing:-.012em}
:focus-visible{outline:3px solid #1F6BFF;outline-offset:2px}
main{max-width:560px;margin:0 auto;padding:18px 20px 40px}.bar{max-width:560px;margin:0 auto;padding:16px 20px 0;font-weight:800;font-size:23px;letter-spacing:-.06em}
.hero{display:block;width:calc(100% - 48px);max-width:512px;height:230px;margin:22px auto 6px;object-fit:cover;border-radius:22px;transform:rotate(-2deg);box-shadow:0 26px 44px rgba(58,52,20,.34)}
.kicker{margin:18px 0 6px;color:var(--muted);font-weight:500;font-size:15px}h1{margin:0 0 20px;font-size:46px;line-height:.98;letter-spacing:-.055em;font-weight:800;overflow-wrap:anywhere}
.card{display:block;padding:16px 0;margin:0;border-top:1px solid var(--line);color:inherit;text-decoration:none}
.row{display:flex;align-items:center;gap:14px}.grow{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}.grow b{font-size:18px;font-weight:600;letter-spacing:-.025em}.muted{color:var(--muted)}
.ic{width:24px;height:24px;flex:none;color:var(--ink)}.ic.muted{color:var(--muted)}
.btn{border:0;border-radius:999px;padding:0 18px;font:500 15px/1 inherit;background:transparent;color:var(--ink);box-shadow:inset 0 0 0 1.5px var(--ink);text-decoration:none;cursor:pointer;min-height:46px;display:inline-flex;align-items:center}
.btn.accent{background:var(--fill);color:var(--on);box-shadow:none}.list{padding:0}.list h2{margin:0;padding:18px 0 6px;font-size:14px;font-weight:500;color:var(--muted)}
.li{display:flex;align-items:center;gap:14px;padding:13px 0;border-top:1px solid var(--line);color:inherit;text-decoration:none;font-size:16px}.li b{font-weight:600}
.places{display:grid;grid-template-columns:repeat(3,1fr);gap:14px 16px;margin:6px 0 4px;padding-top:4px;border-top:1px solid var(--line)}.place{padding:12px 0 0;margin:0;border-top:1.5px solid var(--ink);display:flex;flex-direction:column;gap:4px;font-size:14px}
.place b{font-size:16px;font-weight:600;letter-spacing:-.02em;overflow:hidden;text-overflow:ellipsis}.foot{color:var(--muted);font-size:13px;text-align:center;margin-top:28px;font-weight:800;letter-spacing:-.04em}
section.card p{margin:0;font-size:17px;line-height:1.45}
@media (max-width:360px){.places{grid-template-columns:repeat(2,1fr)}h1{font-size:38px}}`;
  const js = `document.getElementById('show')?.addEventListener('click',function(){var p=document.getElementById('pw');var o=p.textContent.indexOf('•')<0;p.textContent=o?'••••••••':p.dataset.pw;this.textContent=o?${JSON.stringify(ru ? 'Показать' : 'Show')}:${JSON.stringify(ru ? 'Скрыть' : 'Hide')};});`;
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${h(g.title)}</title><style nonce="${nonce}">${css}</style></head><body>${body}<script nonce="${nonce}">${js}</script></body></html>`;
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
      'content-security-policy': `default-src 'none'; img-src 'self'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    },
  });
}

// ---------------------------------------------------------------- what next (renewal)

export const NEXT_CHOICES = ['stay', 'new', 'leave'] as const;
const RENEWAL_SQL = `SELECT r.*, (SELECT json_group_array(json_object('user_id', v.user_id, 'name', u.display_name, 'choice', v.choice, 'at', v.at))
  FROM renewal_votes v JOIN users u ON u.id=v.user_id WHERE v.renewal_id=r.id) votes_json
  FROM renewals r WHERE r.search_id=?1 AND (r.status='open' OR r.decided_at > ?2) ORDER BY r.created_at DESC LIMIT 1`;
export const renewalSql = (env: Env, sid: string) => env.DB.prepare(RENEWAL_SQL).bind(sid, new Date(Date.now() - 30 * 864e5).toISOString());
export function renewalFromRow(r: any, voters = 0) {
  if (!r) return null;
  const votes = parseJson<any[]>(r.votes_json, []).filter((v) => v && v.user_id);
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: r.id, status: r.status, lease_to: r.lease_to, deadline: addDays(r.lease_to, -28), weeks_left: Math.max(0, Math.round(daysUntil(r.lease_to, today) / 7)),
    days_left: daysUntil(r.lease_to, today), note: r.note, choice: r.choice, decided_how: r.decided_how, decided_at: r.decided_at, votes, voters, new_search_id: r.new_search_id, listing_id: r.listing_id,
  };
}
async function voterCount(env: Env, sid: string) {
  return Number((await env.DB.prepare(`SELECT COUNT(*) n FROM members WHERE search_id=? AND role IN ('owner','member')`).bind(sid).first<any>())?.n ?? 0);
}
export async function renewalView(env: Env, sid: string) {
  return renewalFromRow(await renewalSql(env, sid).first<any>(), await voterCount(env, sid));
}
export async function ensureRenewal(env: Env, sid: string, leaseTo: string, listingId: string | null, note?: string | null) {
  if (!isDay(leaseTo)) throw new HttpError(400, 'bad_date', 'lease_to must be YYYY-MM-DD');
  const t = now();
  const r = await env.DB.prepare(`INSERT OR IGNORE INTO renewals (id, search_id, listing_id, lease_to, status, note, created_at, updated_at) VALUES (?,?,?,?, 'open', ?,?,?)`)
    .bind(rid('rn_'), sid, listingId, leaseTo, note ?? null, t, t).run();
  return !!r.meta.changes;
}
const NEXT_TEXT: Record<string, { ru: string; en: string }> = {
  stay: { ru: 'Решили остаться: спроси у хозяина цену и условия нового договора напрямую (черновик на одобрение)', en: 'We stay: ask the landlord for the price and terms of a new direct contract (a draft for approval)' },
  new: { ru: 'Решили искать новое: запусти новый поиск по старому брифу (search_clone), с учётом досье, заметок и мест', en: 'We look for a new place: start a new search from the old brief (search_clone), using the dossier, notes and places' },
  leave: { ru: 'Решили уезжать: запусти выезд (moveout_set), 3D-сканы выезда и вещи на продажу', en: 'We leave: start the move-out (moveout_set), move-out 3D scans and things for sale' },
};
export async function voteNext(env: Env, sid: string, user: { id: string; display_name: string; lang: string }, choice: string) {
  if (!(NEXT_CHOICES as readonly string[]).includes(choice)) throw new HttpError(400, 'bad_choice', 'choice must be stay, new or leave');
  const r = await env.DB.prepare(`SELECT * FROM renewals WHERE search_id=? AND status='open' ORDER BY created_at DESC LIMIT 1`).bind(sid).first<any>();
  if (!r) throw new HttpError(404, 'no_renewal');
  await env.DB.prepare('INSERT INTO renewal_votes (renewal_id, user_id, choice, at) VALUES (?,?,?,?) ON CONFLICT(renewal_id, user_id) DO UPDATE SET choice=excluded.choice, at=excluded.at').bind(r.id, user.id, choice, now()).run();
  await event(env, sid, 'next_vote', r.id, user.id, { name: user.display_name, choice });
  const voters = ((await env.DB.prepare(`SELECT m.user_id, m.role, v.choice FROM members m LEFT JOIN renewal_votes v ON v.renewal_id=? AND v.user_id=m.user_id WHERE m.search_id=? AND m.role IN ('owner','member')`).bind(r.id, sid).all<any>()).results ?? []);
  const tally: Record<string, number> = {};
  for (const v of voters) if (v.choice) tally[v.choice] = (tally[v.choice] ?? 0) + 1;
  const n = voters.length;
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  let decided: string | null = null, how: string | null = null;
  if (top[0] && top[0][1] > n / 2) { decided = top[0][0]; how = 'majority'; }
  else if (voters.every((v) => v.choice) && top.length) {
    const tied = top.filter((x) => x[1] === top[0][1]).map((x) => x[0]);
    if (tied.length === 1) { decided = tied[0]; how = 'majority'; }
    else { const ow = voters.find((v) => v.role === 'owner')?.choice; decided = ow && tied.includes(ow) ? ow : tied[0]; how = 'owner'; }
  }
  if (decided) {
    const upd = await env.DB.prepare(`UPDATE renewals SET status='decided', choice=?, decided_how=?, decided_at=?, updated_at=? WHERE id=? AND status='open'`).bind(decided, how, now(), now(), r.id).run();
    if (upd.meta.changes) {
      const owner = await env.DB.prepare('SELECT lang FROM users WHERE id=(SELECT owner_id FROM searches WHERE id=?)').bind(sid).first<any>();
      const L = owner?.lang === 'en' ? 'en' : 'ru';
      await event(env, sid, 'instruction', r.id, user.id, { name: user.display_name, kind: `next_${decided}`, text: NEXT_TEXT[decided][L], lease_to: r.lease_to, listing_id: r.listing_id, votes: tally, decided_how: how });
    }
  }
  return renewalView(env, sid);
}

/** Cron: an open renewal 42 days before the lease end (DM to every member), a reminder to the undecided at 28 days. */
export async function renewalCron(env: Env, c: { dm: (env: Env, chat: number, text: string, buttons?: any[][]) => Promise<boolean>; searchCtx: (env: Env, sid: string) => Promise<any>; localMinutes: (tz: string) => number; quietLeft: (q: any, tz: string) => number; appUrl: (env: Env, h: string) => string }) {
  // Wave 6: the lease end is the latest signed term's end (extensions in deal_terms), else the deal's terms.to.
  const rows = (await env.DB.prepare(`SELECT d.listing_id, d.search_id, d.data, s.region, s.brief,
      (SELECT MAX(date_to) FROM deal_terms t WHERE t.search_id=d.search_id AND t.status!='draft') t_to
    FROM deals d JOIN searches s ON s.id=d.search_id WHERE s.status IN ('found','living')`).all<any>()).results ?? [];
  for (const r of rows) {
    try {
      const to = [String(parseJson<any>(r.data, {})?.terms?.to ?? '').slice(0, 10), String(r.t_to ?? '')].filter(isDay).sort().pop() ?? '';
      if (!isDay(to)) continue;
      const tz = searchTzOf(r);
      const left = daysUntil(to, localDay(tz));
      if (left > 42 || left < 0) continue;
      const ctx = await c.searchCtx(env, r.search_id);
      if (!ctx || c.localMinutes(tz) < 8 * 60 || c.quietLeft(ctx.quiet, tz) > 0) continue;
      const created = await ensureRenewal(env, r.search_id, to, r.listing_id);
      const rn = await env.DB.prepare(`SELECT * FROM renewals WHERE search_id=? AND lease_to=?`).bind(r.search_id, to).first<any>();
      if (!rn || rn.status !== 'open') continue;
      const stage = created || left > 28 ? 6 : 4;
      if (stage === 4 && left > 28) continue;
      if (!(await once(env, `renewal:${rn.id}:${stage}`))) continue;
      if (created) await event(env, r.search_id, 'renewal', rn.id, 'system', { lease_to: to });
      const people = (await env.DB.prepare(`SELECT u.tg_user_id, u.lang, m.user_id FROM members m JOIN users u ON u.id=m.user_id
        WHERE m.search_id=? AND m.role IN ('owner','member') AND m.notify=1 AND u.tg_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM renewal_votes v WHERE v.renewal_id=? AND v.user_id=m.user_id)`).bind(r.search_id, rn.id).all<any>()).results ?? [];
      const weeks = Math.max(1, Math.round(left / 7));
      for (const p of people) {
        const ru = p.lang !== 'en';
        const text = ru ? `🗓 До конца договора ${weeks} ${weeks === 1 ? 'неделя' : weeks < 5 ? 'недели' : 'недель'}. Что дальше: остаёмся, ищем новое или уезжаем? Проголосуй в Hunt.`
          : `🗓 The lease ends in ${weeks} week${weeks === 1 ? '' : 's'}. What next: stay, look for a new place or leave? Vote in Hunt.`;
        await c.dm(env, p.tg_user_id, text, [[{ text: ru ? 'Что дальше?' : 'What next?', web_app: { url: c.appUrl(env, `/s/${r.search_id}/next`) } }]]);
      }
    } catch (e) { console.error('renewal', r.search_id, String((e as Error)?.message ?? e)); }
  }
}
async function once(env: Env, key: string) {
  const ins = await env.DB.prepare('INSERT OR IGNORE INTO sent_marks (key, at) VALUES (?,?)').bind(key, now()).run();
  return !!ins.meta.changes;
}

/** A new search from an old one: same region, brief (move_in = the lease end), members (not guests), own places. */
export async function cloneSearch(env: Env, s: any, b: any, ownerId: string) {
  const brief = typeof s.brief === 'string' ? parseJson<any>(s.brief, {}) : { ...(s.brief ?? {}) };
  const hl = await homeListing(env, s.id);
  // Wave 6: the lease end is the latest signed extension's end when there is one.
  const ext = await env.DB.prepare(`SELECT MAX(date_to) t FROM deal_terms WHERE search_id=? AND status!='draft'`).bind(s.id).first<any>();
  const leaseTo = [String(parseJson<any>(hl?.deal_data, {})?.terms?.to ?? '').slice(0, 10), String(ext?.t ?? '')].filter(isDay).sort().pop() ?? '';
  brief.move_in = isDay(b.move_in) ? b.move_in : isDay(leaseTo) ? leaseTo : brief.move_in ?? null;
  if (b.term) brief.term = String(b.term).slice(0, 40);
  const id = rid('s_'), code = rid(''), t = now();
  const title = txt(b.title, 120) ?? `${String(s.title).split(/[,·]/)[0].trim()} · ${brief.move_in ? brief.move_in.slice(0, 7) : 'new'}`;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO searches (id, owner_id, title, region, brief, approval_mode, money_mode, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(id, ownerId, title, s.region, JSON.stringify(brief), s.approval_mode ?? 'ask', s.money_mode ?? 'split', t, t),
    env.DB.prepare(`INSERT INTO members (search_id, user_id, role, notify, digest, animal, reveal_seen_at, surf) SELECT ?, user_id, role, notify, digest, animal, reveal_seen_at, surf FROM members WHERE search_id=?`).bind(id, s.id),
    env.DB.prepare("INSERT INTO invites (code, kind, search_id, created_by, max_uses, created_at) VALUES (?, 'member', ?, ?, 50, ?)").bind(code, id, ownerId, t),
    env.DB.prepare(`INSERT INTO places (id, search_id, source, list_name, name, type, tier, note, address, lat, lng, area, url, ext_key, hidden, created_by, created_at, updated_at)
      SELECT 'pl_' || lower(hex(randomblob(8))), ?, source, list_name, name, type, tier, note, address, lat, lng, area, url, ext_key, hidden, created_by, ?, ? FROM places WHERE search_id=?`).bind(id, t, t, s.id),
    env.DB.prepare(`UPDATE renewals SET new_search_id=?, updated_at=? WHERE search_id=? AND status='decided' AND choice='new' AND new_search_id IS NULL`).bind(id, t, s.id),
  ]);
  await event(env, s.id, 'cloned', id, 'agent', { title });
  await event(env, id, 'note', s.id, 'agent', { text: `cloned from ${s.id}` });
  return { id, code, title };
}

// ---------------------------------------------------------------- negotiation, price history, deal prices

/** A listing's price as the agent wrote it: the first price and every change go into price_history. */
export async function notePrice(env: Env, lid: string, oldPrice: number | null | undefined, price: unknown, currency: unknown, source: unknown) {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0 || Number(oldPrice) === p) return;
  await env.DB.prepare('INSERT INTO price_history (listing_id, price, currency, source, at) VALUES (?,?,?,?,?)').bind(lid, Math.round(p), txt(currency, 8), txt(source, 40), now()).run();
}
const quant = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return Math.round(s[lo] + (s[hi] - s[lo]) * (i - lo)); };
const roundDown = (x: number) => { const u = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1))) - 1) / 2; return Math.max(u, Math.floor(x / u) * u); };
const photoKeys = (raw: any) => new Set(parseJson<any[]>(raw, []).map((p) => p?.kv ?? p?.file_id ?? p?.url).filter(Boolean));

export async function negotiationView(env: Env, l: any) {
  const s = await env.DB.prepare('SELECT id, region, brief FROM searches WHERE id=?').bind(l.search_id).first<any>();
  const brief = parseJson<any>(s?.brief, {});
  const { pack, sub } = await regionInfo(env, s?.region ?? '');
  const asked = Number(l.price) || null;
  const cur = l.currency ?? brief.currency ?? null;
  // Market: same bedrooms + district, then the brief districts; pack price_ref when the CRM saw fewer than 5.
  const comps = async (ds: string[], type: boolean) => ((await env.DB.prepare(`SELECT id, price FROM listings WHERE id!=? AND price > 0 AND coalesce(currency,'')=coalesce(?,'') AND bedrooms IS ?
      AND district IN (${ds.map(() => '?').join(',') || "''"}) ${type && l.property_type ? 'AND property_type=?' : ''}`)
    .bind(l.id, cur, l.bedrooms ?? null, ...ds, ...(type && l.property_type ? [l.property_type] : [])).all<any>()).results ?? []).map((x) => Number(x.price));
  let market: any = null;
  const scopes: [string[], boolean][] = [];
  if (l.district) scopes.push([[l.district], true], [[l.district], false]);
  const bd: string[] = [...new Set([...(l.district ? [l.district] : []), ...(Array.isArray(brief.districts) ? brief.districts : [])])];
  if (bd.length) scopes.push([bd, false]);
  for (const [ds, type] of scopes) {
    const xs = await comps(ds, type);
    if (xs.length >= 5) { market = { districts: ds, bedrooms: l.bedrooms ?? null, property_type: type ? l.property_type ?? null : null, count: xs.length, median: quant(xs, 0.5), p25: quant(xs, 0.25), p75: quant(xs, 0.75), min: Math.min(...xs), max: Math.max(...xs), source: 'crm' }; break; }
  }
  if (!market && l.bedrooms != null) {
    const pr = sub.price_ref;
    const area = Object.values<any>(pack.areas ?? {}).find((a) => (a.districts ?? []).includes(l.district) && a.price?.[String(l.bedrooms)]);
    const rng = pr?.beds?.[String(l.bedrooms)] ?? area?.price?.[String(l.bedrooms)];
    if (rng && (!pr?.currency || !cur || pr.currency === cur)) {
      const [lo, hi] = rng.map(Number);
      const med = Number(pr?.median?.[String(l.bedrooms)]) || Math.round((lo + hi) / 2);
      market = { districts: l.district ? [l.district] : bd, bedrooms: l.bedrooms, property_type: null, count: 0, median: med, p25: Math.round(lo + (med - lo) / 2), p75: Math.round(med + (hi - med) / 2), min: lo, max: hi, source: 'pack' };
    }
  }
  // History: price changes of this listing, the same house in other listings (contact, photos, ±50 m), the dossier.
  const history: any[] = [];
  for (const r of (await env.DB.prepare('SELECT price, currency, source, at FROM price_history WHERE listing_id=? ORDER BY at').bind(l.id).all<any>()).results ?? [])
    if (!history.some((x) => x.match === 'same' && x.price === r.price)) history.push({ date: String(r.at).slice(0, 7), price: r.price, currency: r.currency ?? cur, source: r.source ?? l.source, note: null, match: 'same', title: l.title });
  const cids = ((await env.DB.prepare('SELECT contact_id FROM listing_contacts WHERE listing_id=?').bind(l.id).all<any>()).results ?? []).map((x) => x.contact_id);
  const near = l.lat != null ? [Number(l.lat) - 0.0006, Number(l.lat) + 0.0006, Number(l.lng) - 0.0006, Number(l.lng) + 0.0006] : null;
  const others = (await env.DB.prepare(`SELECT l.id, l.title, l.price, l.currency, l.source, l.price_note, l.lat, l.lng, l.photos, l.created_at, s.title stitle,
      EXISTS (SELECT 1 FROM listing_contacts lc WHERE lc.listing_id=l.id AND lc.contact_id IN (${cids.map(() => '?').join(',') || "''"})) same_contact
    FROM listings l JOIN searches s ON s.id=l.search_id WHERE l.id!=? AND l.price > 0 AND (
      l.id IN (SELECT listing_id FROM listing_contacts WHERE contact_id IN (${cids.map(() => '?').join(',') || "''"}))
      ${near ? 'OR (l.lat BETWEEN ? AND ? AND l.lng BETWEEN ? AND ?)' : ''} OR l.photos LIKE ?) LIMIT 40`)
    .bind(...cids, l.id, ...cids, ...(near ?? []), `%${[...photoKeys(l.photos)][0] ?? '\u0000'}%`).all<any>()).results ?? [];
  const mine = photoKeys(l.photos);
  for (const o of others) {
    const photos = mine.size > 0 && [...photoKeys(o.photos)].filter((k) => mine.has(k)).length >= Math.min(2, mine.size); // a repost: the same photos
    const point = near && o.lat != null && kmBetween([Number(l.lat), Number(l.lng)], [Number(o.lat), Number(o.lng)]) <= 0.05;
    const match = photos ? 'photos' : o.same_contact && (point || (l.bedrooms == null)) ? 'contact' : point ? 'point' : null;
    if (!match) continue;
    history.push({ date: String(o.created_at).slice(0, 7), price: o.price, currency: o.currency, source: o.source, note: o.price_note ?? o.stitle, match, title: o.title });
  }
  for (const d of await matchDossiers(env, l).catch(() => [])) {
    if (d.stats?.price) history.push({ date: String(d.updated_at ?? d.created_at).slice(0, 7), price: Number(d.stats.price), currency: d.stats.currency ?? cur, source: 'dossier', note: d.stats.price_note ?? d.verdict_title ?? null, match: 'dossier', title: d.title });
  }
  history.sort((a, b) => a.date.localeCompare(b.date));
  // Arguments and the offer.
  const args: any[] = [];
  if (market && asked && market.median < asked) args.push({ key: 'median', value: market.median });
  const inc = parseJson<string[]>(l.includes, []).map((x) => String(x).toLowerCase());
  const notInc = ['electricity', 'cleaning', 'internet', 'water'].filter((k) => !inc.includes(k) && !(k === 'internet' && inc.includes('wifi')));
  if (notInc.includes('electricity') || /\+\s*(свет|electric|listrik|power)/i.test(l.price_note ?? '')) args.push({ key: 'not_included', items: notInc.slice(0, 2) });
  const av = String(l.available ?? '').match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? (/^(now|сейчас|сразу|immediately)/i.test(l.available ?? '') ? null : null);
  const today = new Date().toISOString().slice(0, 10);
  if (av && av <= today) args.push({ key: 'empty_since', date: av });
  const month = Number(today.slice(5, 7));
  const seasons = pack.seasons ?? {};
  const season = (seasons.low ?? []).includes(month) ? 'low' : (seasons.wet ?? []).includes(month) ? 'wet' : (seasons.high ?? []).includes(month) ? 'high' : null;
  if (season && season !== 'high') args.push({ key: 'season', season });
  const listed = Math.round((Date.now() - Date.parse(l.created_at)) / 864e5);
  if (listed >= 14) args.push({ key: 'long_listed', days: listed });
  const termText = [brief.term, ...(Array.isArray(brief.payment_terms) ? brief.payment_terms : [])].join(' ');
  const months = Math.max(0, ...[...termText.matchAll(/(\d+)\s*(?:months?|мес)/gi)].map((x) => Number(x[1])).filter((n) => n <= 12));
  const upfront = /upfront|вперёд|вперед/i.test(termText) ? Math.max(0, ...[...termText.matchAll(/(\d+)\s*months?\s*upfront/gi)].map((x) => Number(x[1]))) || null : null;
  const upMonths = upfront ?? (months >= 3 ? Math.min(months, 6) : null);
  if (upMonths) args.push({ key: 'term_upfront', months: upMonths });
  const cheaper = history.filter((x) => x.price && asked && x.price < asked && (x.currency ?? cur) === cur).sort((a, b) => a.price - b.price)[0];
  if (cheaper) args.push({ key: 'was_cheaper', price: cheaper.price, date: cheaper.date });
  let offer: any = null;
  if (asked) {
    let target = market && market.median < asked ? Math.max(market.median, asked * 0.85) : asked * 0.93;
    if (season === 'low' || season === 'wet') target *= 0.98;
    if (upMonths) target *= 0.98;
    if (cheaper) target = Math.min(target, Math.max(cheaper.price, asked * 0.85));
    target = Math.min(roundDown(target), asked);
    const said = Number(brief.budget_said) || null;
    const capped = !!said && target > said;
    if (capped) target = roundDown(said!);
    offer = { price: target, months_upfront: upMonths, capped };
  }
  return {
    listing: { id: l.id, title: l.title, price: asked, currency: cur, district: l.district, bedrooms: l.bedrooms, property_type: l.property_type, photo: withSrc(l.id, parseJson<any[]>(l.photos, []))[0] ?? null, area_name: areaNameOf(pack, l.district) },
    market, history: history.slice(-6), offer, arguments: args, asked, budget_said: Number(brief.budget_said) || null,
  };
}

function monthsOf(terms: any) {
  const a = String(terms?.from ?? '').slice(0, 10), b = String(terms?.to ?? '').slice(0, 10);
  if (!isDay(a) || !isDay(b)) return null;
  return Math.max(1, Math.round(daysUntil(b, a) / 30.4));
}
export async function dealPrices(env: Env, lid: string) {
  const d = await env.DB.prepare('SELECT d.asked, d.agreed, d.data, l.currency FROM deals d JOIN listings l ON l.id=d.listing_id WHERE d.listing_id=?').bind(lid).first<any>();
  if (!d) return null;
  const terms = parseJson<any>(d.data, {}).terms ?? {};
  const months = monthsOf(terms);
  const saved = d.asked != null && d.agreed != null ? Math.max(0, d.asked - d.agreed) : null;
  return { asked: d.asked, agreed: d.agreed, currency: terms.currency ?? d.currency ?? null, saved_month: saved, months, saved_term: saved != null && months ? saved * months : null };
}
export async function setDealPrices(env: Env, lid: string, b: any) {
  const n = (v: unknown) => (v == null || v === '' ? undefined : Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : NaN);
  const asked = n(b.asked), agreed = n(b.agreed);
  if (Number.isNaN(asked) || Number.isNaN(agreed)) throw new HttpError(400, 'bad_amount', 'asked and agreed must be positive numbers');
  const ex = await env.DB.prepare('SELECT 1 FROM deals WHERE listing_id=?').bind(lid).first();
  if (!ex) throw new HttpError(404, 'no_deal', 'Create the deal first (deal_set)');
  await env.DB.prepare('UPDATE deals SET asked=coalesce(?, asked), agreed=coalesce(?, agreed), deal_at=coalesce(deal_at, ?) WHERE listing_id=?').bind(asked ?? null, agreed ?? null, now(), lid).run();
  return dealPrices(env, lid);
}
/** After a deal write: agreed = terms.rent, asked = the first price seen, deal_at = the first write (only fills blanks). */
export async function autoDealPrices(env: Env, l: any, data: any) {
  const rent = Number(data?.terms?.rent) || null;
  const first = await env.DB.prepare('SELECT price FROM price_history WHERE listing_id=? ORDER BY at LIMIT 1').bind(l.id).first<any>();
  await env.DB.prepare('UPDATE deals SET agreed=coalesce(agreed, ?), asked=coalesce(asked, ?), deal_at=coalesce(deal_at, ?) WHERE listing_id=?')
    .bind(rent, Number(first?.price) || Number(l.price) || null, now(), l.id).run();
}

// ---------------------------------------------------------------- recap

export async function recapView(env: Env, sid: string, role: Role, lang = 'ru') {
  const s = await env.DB.prepare('SELECT id, title, region, created_at FROM searches WHERE id=?').bind(sid).first<any>();
  if (!s) throw new HttpError(404, 'no_search');
  const inL = '(SELECT id FROM listings WHERE search_id=?1)';
  const [cnt, mem, dl] = await env.DB.batch<any>([
    env.DB.prepare(`SELECT (SELECT COUNT(DISTINCT contact_id) FROM messages WHERE (search_id=?1 OR listing_id IN ${inL}) AND direction='out' AND contact_id IS NOT NULL) contacted,
      (SELECT COUNT(DISTINCT contact_id) FROM messages WHERE (search_id=?1 OR listing_id IN ${inL}) AND direction='in' AND contact_id IS NOT NULL) replied,
      (SELECT COUNT(*) FROM viewings WHERE search_id=?1 AND (status='done' OR (status='confirmed' AND starts_at < ?2))) viewings,
      (SELECT COUNT(*) FROM deals WHERE search_id=?1) deals`).bind(sid, now()),
    env.DB.prepare(`SELECT m.user_id, m.animal, u.display_name name FROM members m JOIN users u ON u.id=m.user_id WHERE m.search_id=? AND m.role IN ('owner','member') ORDER BY m.role='owner' DESC, u.created_at`).bind(sid),
    env.DB.prepare(`SELECT d.listing_id, d.deal_at, d.updated_at, l.title, l.photos FROM deals d JOIN listings l ON l.id=d.listing_id WHERE d.search_id=? ORDER BY d.updated_at DESC LIMIT 1`).bind(sid),
  ]);
  const c = cnt.results?.[0] ?? {};
  const d = dl.results?.[0] ?? null;
  const { pack, sub } = await regionInfo(env, s.region);
  const dealAt = d ? d.deal_at ?? d.updated_at : null;
  const prices = d && role === 'owner' ? await dealPrices(env, d.listing_id) : null;
  const missing: string[] = [];
  if (!d) missing.push('deal');
  const photo = d ? withSrc(d.listing_id, parseJson<any[]>(d.photos, []))[0] ?? null : null;
  if (d && !photo) missing.push('photo');
  if (!Number(c.contacted)) missing.push('messages');
  if (role === 'owner' && d && (prices?.asked == null || prices?.agreed == null)) missing.push('prices');
  return {
    search: { id: s.id, title: s.title, region: s.region, region_name: sub.name?.[lang] ?? sub.name?.en ?? pack.name?.[lang] ?? pack.name?.en ?? null, country_name: pack.name?.[lang] ?? pack.name?.en ?? null },
    members: (mem.results ?? []).map((m: any) => ({ user_id: m.user_id, name: m.name, animal: animalInfo(s.region, m.animal) })),
    days: dealAt ? Math.max(1, Math.ceil((Date.parse(dealAt) - Date.parse(s.created_at)) / 864e5)) : null, created_at: s.created_at, deal_at: dealAt,
    counts: { contacted: Number(c.contacted ?? 0), replied: Number(c.replied ?? 0), viewings: Number(c.viewings ?? 0), deals: Number(c.deals ?? 0) },
    prices: prices && prices.asked != null && prices.agreed != null ? prices : null,
    listing: d ? { id: d.listing_id, title: d.title, photo } : null, complete: !missing.filter((x) => x !== 'prices').length, missing,
  };
}

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
    renewal: null, guests: [], guest_drafts: [], feed: [], counts: { new: 0, drafts: 0, replies_24h: 0 }, agent_last_seen: null,
    bot_username: env.BOT_USERNAME ?? null, photo_token: photoToken,
  };
}
export { tg };
