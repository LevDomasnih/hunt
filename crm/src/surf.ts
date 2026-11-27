// Split from wave5.ts.
import { areaNameOf, homePoint, placesAround, regionInfo } from './homepoint';
import { localDay, searchTzOf } from './local';
import { Env, HttpError, now, parseJson } from './util';

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
