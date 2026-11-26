// Wave 4: places (pack + Google Maps imports), location score from scooter isochrones, flood risk, bikes, 3D scans,
// house dossier, things bought with the villa, bike and local-calendar reminders.
// Shared by the agent API (agent.ts), the Mini App (app.ts) and the cron (notify.ts).
import { Env, HttpError, now, rid, parseJson, event } from './util';
import { sensitive, normAddr, insertExpense } from './agent';
import { packData, identitiesOf, identityOf } from './life';
import { countryOf } from './members';
import { dealDates, daysUntil } from './deal';

const txt = (v: unknown, n: number) => (v == null ? null : String(v).trim().slice(0, n) || null);
const isDay = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const day10 = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const num = (v: unknown) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Math.round(Number(v)) : NaN);
function noSecrets(what: string, ...parts: unknown[]) {
  const s = sensitive(parts.map((x) => (typeof x === 'string' ? x : JSON.stringify(x ?? ''))).join(' '));
  if (s) throw new HttpError(400, 'sensitive', `${what} looks like it contains ${s}. Remove it.`);
}

// ---------------------------------------------------------------- pack assets (public/art)

const assetCache = new Map<string, { at: number; data: any }>();
async function asset(env: Env, path: string): Promise<any> {
  const c = assetCache.get(path);
  if (c && Date.now() - c.at < 600e3) return c.data;
  let data: any = null;
  try {
    const r = await env.ASSETS.fetch(new Request(`${env.PUBLIC_URL || 'https://hunt.local'}${path}`));
    data = r.ok ? await r.json() : null;
  } catch { data = null; }
  assetCache.set(path, { at: Date.now(), data });
  return data;
}
/** Base places of a country pack: {types: {type: {weight_default, emoji, scored?, k?}}, places: [{id, name, type, tier, area, lat, lng, note, tags}]}. */
export const basePlaces = async (env: Env, country: string) => ((await asset(env, `/art/${country}/places.json`)) ?? { types: {}, places: [] }) as { types: Record<string, any>; places: any[] };
const areasGeo = (env: Env, country: string) => asset(env, `/art/${country}/districts.geojson`);

// ---------------------------------------------------------------- geometry

function inRing(x: number, y: number, ring: number[][]): boolean {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi) ins = !ins;
  }
  return ins;
}
export function inGeom(lng: number, lat: number, g: any): boolean {
  const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
  return polys.some((p: number[][][]) => p?.[0] && inRing(lng, lat, p[0]) && !p.slice(1).some((h) => inRing(lng, lat, h)));
}
export function kmBetween(a: [number, number], b: [number, number]) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Area of a point: inside an area polygon, else the nearest area when it is ≤ 30 min away at the region's speed, else 'trip'. */
async function assignArea(env: Env, region: string, lat: number, lng: number): Promise<string | null> {
  const country = countryOf(region);
  const geo = await areasGeo(env, country);
  if (!geo?.features?.length) return null;
  const f = geo.features.find((x: any) => inGeom(lng, lat, x.geometry));
  if (f) return f.properties.id;
  const pack = (await packData(env))?.[country];
  const kmh = Number(pack?.sub?.[String(region).split('/')[1]]?.travel?.kmh) || 25;
  let best: string | null = null, bestKm = Infinity;
  for (const x of geo.features) {
    const polys = x.geometry?.type === 'Polygon' ? [x.geometry.coordinates] : x.geometry?.coordinates ?? [];
    for (const p of polys) for (const pt of p[0] ?? []) {
      const k = kmBetween([lat, lng], [pt[1], pt[0]]);
      if (k < bestKm) { bestKm = k; best = x.properties.id; }
    }
  }
  return best && ((bestKm * 1.35) / kmh) * 60 <= 30 ? best : 'trip';
}

// ---------------------------------------------------------------- places

export const EXTRA_TYPES = ['nightlife', 'construction', 'other'];
export const extKey = (name: string, lat: number, lng: number) => `${name.trim().toLowerCase()}@${lat.toFixed(4)},${lng.toFixed(4)}`;
const PLACE_SOURCES = ['google_list', 'my_maps', 'google_place', 'manual'];

async function allowedTypes(env: Env, region: string) {
  const bp = await basePlaces(env, countryOf(region));
  return [...new Set([...Object.keys(bp.types ?? {}), 'beach', 'surf', 'coworking', 'gym', 'yoga', 'supermarket', 'market', 'hospital', 'pharmacy', 'coffee', 'food', 'daytrip', ...EXTRA_TYPES])];
}

export async function upsertPlaces(env: Env, s: { id: string; region: string }, list: unknown, actor: string) {
  if (!Array.isArray(list) || !list.length || list.length > 500) throw new HttpError(400, 'bad_places', 'places must be a list of 1-500 items');
  const types = await allowedTypes(env, s.region);
  let added = 0, updated = 0;
  const out: any[] = [];
  const t = now();
  for (const [i, x] of (list as any[]).entries()) {
    const name = txt(x?.name, 120);
    const lat = Number(x?.lat), lng = Number(x?.lng ?? x?.lon);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new HttpError(400, 'bad_places', `places[${i}] needs name, lat, lng`);
    const type = types.includes(x.type) ? x.type : 'other';
    const tier = [1, 2, 3].includes(Number(x.tier)) ? Number(x.tier) : 2;
    const note = txt(x.note, 300), address = txt(x.address, 200);
    noSecrets('A place', note ?? '', name);
    const url = txt(x.url, 500);
    const key = txt(x.ext_key, 200) ?? extKey(name, lat, lng);
    const area = txt(x.area, 40) ?? (await assignArea(env, s.region, lat, lng));
    const old = await env.DB.prepare('SELECT id FROM places WHERE search_id=? AND ext_key=?').bind(s.id, key).first<{ id: string }>();
    const id = old?.id ?? rid('pl_');
    await env.DB.prepare(`INSERT INTO places (id, search_id, source, list_name, name, type, tier, note, address, lat, lng, area, url, ext_key, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source=excluded.source, list_name=excluded.list_name, name=excluded.name, type=excluded.type,
      tier=excluded.tier, note=excluded.note, address=excluded.address, lat=excluded.lat, lng=excluded.lng, area=excluded.area, url=excluded.url, updated_at=excluded.updated_at`)
      .bind(id, s.id, PLACE_SOURCES.includes(x.source) ? x.source : 'manual', txt(x.list_name, 80), name, type, tier, note, address,
        Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6, area, url && /^https?:\/\//.test(url) ? url : null, key, actor, t, t).run();
    if (old) updated++; else added++;
    out.push({ id, ext_key: key, name, type, tier, area });
  }
  await event(env, s.id, 'places', s.id, actor, { added, updated });
  await recomputeRings(env, s.id);
  return { added, updated, places: out };
}

export async function patchPlace(env: Env, p: any, b: any, region: string) {
  const types = await allowedTypes(env, region);
  if ('type' in b && !types.includes(b.type)) throw new HttpError(400, 'bad_type', `type must be one of ${types.join(', ')}`);
  if ('tier' in b && ![1, 2, 3].includes(Number(b.tier))) throw new HttpError(400, 'bad_tier', 'tier must be 1, 2 or 3');
  const v = (k: string) => (k in b ? b[k] : p[k]);
  const note = 'note' in b ? txt(b.note, 300) : p.note;
  noSecrets('A place', note ?? '');
  await env.DB.prepare('UPDATE places SET type=?, tier=?, note=?, name=?, hidden=?, area=?, updated_at=? WHERE id=?')
    .bind(v('type'), Number(v('tier')), note, txt(v('name'), 120) ?? p.name, b.hidden == null ? p.hidden : b.hidden ? 1 : 0, txt(v('area'), 40), now(), p.id).run();
  await recomputeRings(env, p.search_id);
  return env.DB.prepare('SELECT * FROM places WHERE id=?').bind(p.id).first<any>();
}

// ---------------------------------------------------------------- location: rings and score

// Ring set per region pack (pack.yaml `location: {rings, weights}`, exported to regions.json); free-flow scooter/car minutes.
export const DEFAULT_RINGS = [10, 20, 40];
export const DEFAULT_RING_W = [1, 0.7, 0.3];
export interface RingSet { rings: number[]; weights: number[]; rush: number }
const validRings = (r: any) => Array.isArray(r) && r.length >= 1 && r.length <= 5 && r.every((x: any, i: number) => Number.isFinite(Number(x)) && Number(x) > 0 && (i === 0 || Number(x) > Number(r[i - 1])));
/** The ring set of a region: sub-region pack overrides the country pack; default [10,20,40] × [1,0.7,0.3]. */
export async function ringSet(env: Env, region: string): Promise<RingSet> {
  const pack = (await packData(env))?.[countryOf(region)];
  const sub = pack?.sub?.[String(region).split('/')[1]];
  const loc = validRings(sub?.location?.rings) ? sub.location : validRings(pack?.location?.rings) ? pack.location : null;
  const rings = loc ? loc.rings.map(Number) : DEFAULT_RINGS;
  const w = Array.isArray(loc?.weights) && loc.weights.length === rings.length ? loc.weights.map(Number) : rings.length === 3 ? DEFAULT_RING_W : rings.map((_: number, i: number) => Math.max(0.2, 1 - i * 0.3));
  const rush = Number(sub?.travel?.rush ?? sub?.travel?.rush_factor) || 1.3;
  return { rings, weights: w, rush };
}
export const sameRings = (a: any, b: number[]) => Array.isArray(a) && a.length === b.length && a.every((x: any, i: number) => Number(x) === b[i]);
const ringW = (rs: RingSet, r: unknown) => { const i = rs.rings.indexOf(Number(r)); return i >= 0 ? rs.weights[i] : 0; };
const TIER_W: Record<number, number> = { 1: 1, 2: 0.6, 3: 0.3 };
export const GROUPS: Record<string, string[]> = {
  surf: ['surf', 'beach'], shops: ['supermarket', 'market'], cafes: ['coffee', 'food'], work: ['coworking'],
  sport: ['gym', 'yoga'], medical: ['hospital', 'pharmacy'], nightlife: ['nightlife'],
};
const groupOf = (type: string) => Object.keys(GROUPS).find((g) => GROUPS[g].includes(type)) ?? null;

/** Every place of a search, base ('b:<id>') and own ('pl_…'), keyed by id. */
export async function searchPlaces(env: Env, s: { id: string; region: string }) {
  const bp = await basePlaces(env, countryOf(s.region));
  const own = (await env.DB.prepare('SELECT * FROM places WHERE search_id=?').bind(s.id).all<any>()).results ?? [];
  const byId = new Map<string, any>();
  // A base place the search also saved itself (same name within 150 m) counts once, as the own one.
  const nm = (x: string) => String(x).toLowerCase().replace(/[^a-zа-я0-9]+/gi, ' ').trim();
  const shown = own.filter((o) => !o.hidden);
  const dup = (p: any) => shown.some((o) => kmBetween([o.lat, o.lng], [p.lat, p.lng]) < 0.15 && (nm(o.name).includes(nm(p.name)) || nm(p.name).includes(nm(o.name))));
  for (const p of bp.places ?? []) if (!dup(p)) byId.set('b:' + p.id, { ...p, id: 'b:' + p.id, own: false });
  for (const p of shown) byId.set(p.id, { ...p, own: true });
  return { byId, types: bp.types ?? {}, own };
}

function anchorsOf(brief: any): any[] {
  const out = (Array.isArray(brief?.anchors) ? brief.anchors : []).filter((a: any) => a && Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lng)));
  const a = brief?.anchor;
  if (a && typeof a === 'object' && Number.isFinite(Number(a.lat)) && !out.some((x: any) => x.id === 'anchor')) out.unshift({ id: 'anchor', name: a.label ?? '—', lat: a.lat, lng: a.lng, type: a.icon === 'waves' ? 'surf' : 'other' });
  return out;
}

/** Innermost ring of each place and anchor. geo: FeatureCollection with properties.ring 5|10|30. */
function ringsOf(geo: any, places: Iterable<any>, anchors: any[], RINGS: number[]) {
  const feats = RINGS.map((r) => ({ r, g: (geo?.features ?? []).filter((f: any) => Number(f.properties?.ring) === r).map((f: any) => f.geometry) }));
  const ringOf = (lat: number, lng: number) => feats.find((x) => x.g.some((g: any) => inGeom(lng, lat, g)))?.r ?? null;
  const rings: Record<string, string[]> = Object.fromEntries(RINGS.map((r) => [String(r), [] as string[]]));
  for (const p of places) { const r = ringOf(Number(p.lat), Number(p.lng)); if (r) rings[String(r)].push(p.id); }
  const anch: Record<string, number | null> = {};
  for (const a of anchors) anch[a.id] = ringOf(Number(a.lat), Number(a.lng));
  return { set: RINGS, rings, anchors: anch, at: now() };
}

export async function recomputeRings(env: Env, sid: string, onlyListing?: string) {
  const s = await env.DB.prepare('SELECT id, region, brief FROM searches WHERE id=?').bind(sid).first<any>();
  if (!s) return;
  const rows = (await env.DB.prepare(`SELECT i.listing_id, i.geo, i.rings FROM isochrones i JOIN listings l ON l.id=i.listing_id WHERE l.search_id=? ${onlyListing ? 'AND l.id=?' : ''}`)
    .bind(...(onlyListing ? [sid, onlyListing] : [sid])).all<any>()).results ?? [];
  if (!rows.length) return;
  const { byId } = await searchPlaces(env, s);
  const anchors = anchorsOf(parseJson(s.brief, {}));
  const ups = rows.map((r) => env.DB.prepare('UPDATE listings SET location=? WHERE id=?').bind(JSON.stringify(ringsOf(parseJson(r.geo, null), byId.values(), anchors, parseJson<number[] | null>(r.rings, null) ?? [5, 10, 30])), r.listing_id));
  for (let i = 0; i < ups.length; i += 50) await env.DB.batch(ups.slice(i, i + 50));
}

export async function setIsochrones(env: Env, l: { id: string; search_id: string }, b: any) {
  const sr = await env.DB.prepare('SELECT region FROM searches WHERE id=?').bind(l.search_id).first<{ region: string }>();
  const rs = await ringSet(env, sr?.region ?? '');
  const RINGS = rs.rings;
  if (!sameRings(b.rings, RINGS)) throw new HttpError(400, 'bad_rings', `rings must be the region's ring set [${RINGS.join(', ')}] (free-flow minutes)`);
  const geo = typeof b.geo === 'string' ? parseJson<any>(b.geo, null) : b.geo;
  if (!geo || geo.type !== 'FeatureCollection' || !Array.isArray(geo.features) || !geo.features.length) throw new HttpError(400, 'bad_geo', `geo must be a FeatureCollection with one feature per ring (properties.ring ${RINGS.join('|')})`);
  if (!geo.features.every((f: any) => RINGS.includes(Number(f.properties?.ring)) && ['Polygon', 'MultiPolygon'].includes(f.geometry?.type))) throw new HttpError(400, 'bad_geo', `every feature needs properties.ring ${RINGS.join('|')} and a (Multi)Polygon`);
  const text = JSON.stringify({ type: 'FeatureCollection', features: geo.features.map((f: any) => ({ type: 'Feature', properties: { ring: Number(f.properties.ring) }, geometry: f.geometry })) });
  if (text.length > 1_500_000) throw new HttpError(413, 'too_big', 'isochrones over 1.5 MB: generalize or round the coordinates');
  await env.DB.prepare(`INSERT INTO isochrones (listing_id, costing, rush, geo, rings, at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(listing_id) DO UPDATE SET costing=excluded.costing, rush=excluded.rush, geo=excluded.geo, rings=excluded.rings, at=excluded.at`)
    .bind(l.id, txt(b.costing, 20) ?? 'motor_scooter', Number(b.rush) || null, text, JSON.stringify(RINGS), now()).run();
  await recomputeRings(env, l.search_id, l.id);
}

/** Group multipliers from the brief (documented in core/API.md); brief.priorities overrides. */
export function groupWeights(brief: any, own: any[]) {
  const anchors = anchorsOf(brief);
  const t = [brief?.must_have, brief?.nice_to_have, brief?.deal_breakers, brief?.style, brief?.transport, anchors.map((a) => a.type).join(' ')].filter(Boolean).join(' ').toLowerCase();
  const quiet = /тих|quiet|calm|спокой|стройк|construction|шум|noise|silence/.test(t) || brief?.construction_tolerance === 'dealbreaker';
  const party = /тусов|party|nightlife|клуб|club|вечерин/.test(t);
  const cafesOwn = own.filter((p) => !p.hidden && ['coffee', 'food'].includes(p.type)).length;
  const w: Record<string, number> = {
    surf: /серф|surf|волн|пляж|beach|океан|ocean/.test(t) || anchors.some((a) => ['surf', 'beach'].includes(a.type)) ? 3 : 1,
    shops: 2,
    cafes: /кафе|кофе|еда|food|cafe|coffee|рестор|brunch|завтрак/.test(t) || cafesOwn >= 3 ? 1.5 : 1,
    work: /коворк|cowork|удалён|remote|ноутбук|laptop/.test(t) || anchors.some((a) => ['work', 'cowork'].includes(a.type)) ? 1.5 : 1,
    sport: /спортзал|\bзал\b|gym|йог|yoga|фитнес|fitness|спорт|sport/.test(t) || anchors.some((a) => ['gym', 'yoga'].includes(a.type)) ? 1.5 : 1,
    medical: 1,
    nightlife: quiet ? 0 : party ? 3 : 0.5,
  };
  const pr = brief?.priorities;
  if (pr && typeof pr === 'object') for (const k of Object.keys(w)) if (Number.isFinite(Number(pr[k]))) w[k] = Math.max(0, Number(pr[k]));
  return { w, quiet };
}

/** The location score of one listing from its rings (see core/API.md "Location score"). */
export function scoreLocation(loc: any, byId: Map<string, any>, types: Record<string, any>, brief: any, own: any[], rs: RingSet = { rings: DEFAULT_RINGS, weights: DEFAULT_RING_W, rush: 1.3 }) {
  if (!loc?.rings || !sameRings(loc.set, rs.rings)) return null; // legacy 5/10/30 or another ring set: stale until recomputed
  const RINGS = rs.rings;
  const { w, quiet } = groupWeights(brief, own);
  const sum: Record<string, number> = {}, sumRing: Record<string, Record<string, number>> = {}, n: Record<string, number> = {};
  const rings: Record<string, { points: number; places: any[] }> = {};
  const inner = new Set<string>();
  for (const r of RINGS) {
    const list: any[] = [];
    for (const id of loc.rings[String(r)] ?? []) {
      const p = byId.get(id);
      if (!p || inner.has(id)) continue;
      inner.add(id);
      const g = groupOf(p.type);
      const tw = Number(types[p.type]?.weight_default ?? (p.type === 'nightlife' ? 0.5 : 0.6));
      const c = g && types[p.type]?.scored !== false ? (TIER_W[p.tier] ?? 0.6) * ringW(rs, r) * tw * (p.own ? 1.5 : 1) : 0;
      if (g && c > 0) {
        sum[g] = (sum[g] ?? 0) + c;
        (sumRing[g] ??= {})[String(r)] = (sumRing[g]?.[String(r)] ?? 0) + c;
        n[g] = (n[g] ?? 0) + 1;
      }
      list.push({ id, name: p.name, type: p.type, tier: p.tier, own: !!p.own, contribution: Math.round(c * 100) / 100 });
    }
    list.sort((a, b) => b.contribution - a.contribution || a.tier - b.tier);
    rings[String(r)] = { points: 0, places: list };
  }
  const anchors = anchorsOf(brief);
  const groups: any[] = [];
  for (const g of Object.keys(GROUPS)) {
    const ks = GROUPS[g].map((x) => Number(types[x]?.k)).filter((x) => x > 0);
    const k = ks.length ? ks.reduce((a, b) => a + b, 0) / ks.length : 1.5;
    groups.push({ key: g, weight: w[g], s: 1 - Math.exp(-(sum[g] ?? 0) / k), n: n[g] ?? 0 });
  }
  if (anchors.length) {
    const top = Math.max(...Object.values(w));
    const s = anchors.reduce((a, x) => a + ringW(rs, loc.anchors?.[x.id]), 0) / anchors.length;
    groups.unshift({ key: 'anchors', weight: top, s, n: anchors.filter((x) => loc.anchors?.[x.id]).length });
  }
  const W = groups.reduce((a, g) => a + (g.weight > 0 ? g.weight : 0), 0) || 1;
  for (const g of groups) g.points = Math.round(((g.weight > 0 ? g.weight : 0) * g.s * 100) / W * 10) / 10;
  const base = groups.reduce((a, g) => a + (g.weight > 0 ? g.weight * g.s : 0), 0) / W * 100;
  // Ring points: each group's part of the score split by the rings' share of its sum.
  for (const r of RINGS) {
    let pts = 0;
    for (const g of groups) if (g.key !== 'anchors' && sum[g.key]) pts += (g.weight > 0 ? g.weight : 0) * g.s * ((sumRing[g.key]?.[String(r)] ?? 0) / sum[g.key]);
    const a = groups.find((g) => g.key === 'anchors');
    if (a && anchors.length) pts += a.weight * (anchors.filter((x) => loc.anchors?.[x.id] === r).reduce((s0) => s0 + ringW(rs, r), 0) / anchors.length);
    rings[String(r)].points = Math.round((pts / W) * 100);
  }
  const penalties: any[] = [];
  const within = (rs: number[], f: (p: any) => boolean) => rs.flatMap((r) => rings[String(r)].places).find((p) => f(p));
  if (!within(RINGS.slice(0, 2), (p) => p.type === 'supermarket')) penalties.push({ key: 'no_shop', points: -10 });
  if (quiet) {
    const club = within(RINGS.slice(0, 1), (p) => p.type === 'nightlife');
    if (club) penalties.push({ key: 'club_near', points: -8, place: club.name });
    const site = within(RINGS.slice(0, 1), (p) => p.type === 'construction');
    if (site) penalties.push({ key: 'construction_near', points: -8, place: site.name });
  }
  const score = Math.max(0, Math.min(100, Math.round(base + penalties.reduce((a, p) => a + p.points, 0))));
  return {
    score, base: Math.round(base), groups: groups.map((g) => ({ ...g, s: Math.round(g.s * 100) })), penalties, rings, quiet,
    anchors: anchors.map((a) => ({ id: a.id, name: a.name, ring: loc.anchors?.[a.id] ?? null })), at: loc.at ?? null,
    ring_set: RINGS, ring_weights: rs.weights, rush_factor: rs.rush,
  };
}

/** Scores of every listing of a search (for the state and the agent's list). */
export async function locationScores(env: Env, s: { id: string; region: string; brief: any }, listings: any[]) {
  const withLoc = listings.filter((l) => l.location);
  if (!withLoc.length) return {} as Record<string, number>;
  const [{ byId, types, own }, rs] = await Promise.all([searchPlaces(env, s), ringSet(env, s.region)]);
  const brief = typeof s.brief === 'string' ? parseJson(s.brief, {}) : s.brief ?? {};
  const out: Record<string, number> = {};
  for (const l of withLoc) {
    const r = scoreLocation(typeof l.location === 'string' ? parseJson(l.location, null) : l.location, byId, types, brief, own, rs);
    if (r) out[l.id] = r.score;
  }
  return out;
}

/** Full breakdown + polygons + the places in the rings with coordinates (Mini App screen 31). */
export async function locationView(env: Env, l: any, withGeo = false) {
  const s = await env.DB.prepare('SELECT id, region, brief FROM searches WHERE id=?').bind(l.search_id).first<any>();
  const iso = await env.DB.prepare('SELECT costing, rush, geo, rings, at FROM isochrones WHERE listing_id=?').bind(l.id).first<any>();
  if (!s) throw new HttpError(404, 'no_search');
  const [{ byId, types, own }, rs] = await Promise.all([searchPlaces(env, s), ringSet(env, s.region)]);
  const loc = parseJson<any>(l.location, null);
  const location = scoreLocation(loc, byId, types, parseJson(s.brief, {}), own, rs);
  const stale = !!iso && !sameRings(parseJson(iso.rings, null), rs.rings);
  const out: any = { location, has_isochrones: !!iso, stale, costing: iso?.costing ?? null, rush: iso?.rush ?? null, ring_set: rs.rings, ring_weights: rs.weights, rush_factor: rs.rush };
  const RINGS = sameRings(loc?.set, rs.rings) ? rs.rings : [];
  if (withGeo) {
    out.geo = iso ? parseJson(iso.geo, null) : null;
    const pts: any[] = [];
    for (const r of RINGS) for (const id of loc?.rings?.[String(r)] ?? []) {
      const p = byId.get(id);
      if (p) pts.push({ id, name: p.name, type: p.type, tier: p.tier, own: !!p.own, lat: p.lat, lng: p.lng, ring: r, emoji: types[p.type]?.emoji ?? null });
    }
    out.places = pts;
    out.types = types;
  }
  return out;
}

// ---------------------------------------------------------------- flood

export const FLOOD_LEVELS = ['low', 'medium', 'high'];
export async function setFlood(env: Env, l: any, b: any, actor: string) {
  if (!FLOOD_LEVELS.includes(b.level)) throw new HttpError(400, 'bad_level', 'level must be low, medium or high');
  const old = parseJson<any>(l.flood, {});
  const sources = (Array.isArray(b.sources) ? b.sources : []).slice(0, 8).map((x: any) => ({
    kind: ['terrain', 'chats', 'notes', 'area'].includes(x?.kind) ? x.kind : 'notes', title: txt(x?.title, 80) ?? '', text: txt(x?.text, 300),
  }));
  const t = b.terrain && typeof b.terrain === 'object' ? { elev: Number(b.terrain.elev) || null, ring_mean: Number(b.terrain.ring_mean) || null, diff: Number.isFinite(Number(b.terrain.diff)) ? Math.round(Number(b.terrain.diff) * 10) / 10 : null, ring_m: Number(b.terrain.ring_m) || null } : old.terrain ?? null;
  const flood = { level: b.level, summary: txt(b.summary, 300), sources, terrain: t, notes: old.notes ?? [], at: now() };
  noSecrets('The flood data', flood.summary ?? '', sources);
  await env.DB.prepare('UPDATE listings SET flood=?, updated_at=? WHERE id=?').bind(JSON.stringify(flood), now(), l.id).run();
  if (old.level !== b.level) await event(env, l.search_id, 'flood', l.id, actor, { title: l.title, level: b.level });
  return flood;
}
export async function addFloodNote(env: Env, l: any, user: { id: string; display_name: string }, text: unknown) {
  const t = txt(text, 200);
  if (!t) throw new HttpError(400, 'missing', 'text is required');
  noSecrets('The note', t);
  const f = parseJson<any>(l.flood, {});
  f.notes = [...(f.notes ?? []), { user_id: user.id, name: user.display_name, text: t, at: now() }].slice(-10);
  await env.DB.prepare('UPDATE listings SET flood=? WHERE id=?').bind(JSON.stringify(f), l.id).run();
  await event(env, l.search_id, 'instruction', l.id, user.id, { name: user.display_name, kind: 'flood_note', text: `${l.title}: ${t}` });
  return f;
}

// ---------------------------------------------------------------- bikes

const BIKE_CHECK = ['video', 'helmets', 'stnk', 'fuel'];
/** "passport" without "copy": the original passport must never be left as a deposit. */
export const originalPassport = (s: string | null) => !!s && /паспорт|passport|paspor/i.test(s) && !/коп|copy|scan|скан|salinan|fotokop/i.test(s);

export async function setBike(env: Env, s: { id: string }, id: string, b: any, actor: string) {
  const old = id === 'new' ? null : await env.DB.prepare('SELECT * FROM bikes WHERE id=? AND search_id=?').bind(id, s.id).first<any>();
  if (id !== 'new' && !old) throw new HttpError(404, 'no_bike');
  const v = (k: string) => (k in b ? b[k] : old?.[k] ?? null);
  const model = txt(v('model'), 80);
  if (!model) throw new HttpError(400, 'missing', 'model is required');
  const rider = v('rider_id');
  if (rider && !(await env.DB.prepare('SELECT 1 FROM members WHERE search_id=? AND user_id=?').bind(s.id, rider).first())) throw new HttpError(400, 'bad_rider', 'rider_id must be a member of this search');
  const price = num(v('price'));
  if (Number.isNaN(price)) throw new HttpError(400, 'bad_price');
  const period = ['month', 'week', 'day'].includes(v('period')) ? v('period') : 'month';
  const channel = ['whatsapp', 'telegram', 'phone'].includes(v('channel')) ? v('channel') : null;
  const address = v('address') ? normAddr(channel === 'telegram' ? 'telegram' : 'phone', String(v('address'))) : null;
  const phone = v('phone') ? normAddr('phone', String(v('phone'))) : channel && channel !== 'telegram' ? address : null;
  const oldCk = parseJson<any>(old?.checklist, {});
  const ck: Record<string, any> = { ...oldCk };
  if (b.checklist && typeof b.checklist === 'object') for (const [k, x] of Object.entries<any>(b.checklist)) if (BIKE_CHECK.includes(k)) ck[k] = { done: !!(x?.done ?? x), note: txt(x?.note, 80) ?? oldCk[k]?.note ?? null };
  const row = {
    model, plate: txt(v('plate'), 20)?.toUpperCase() ?? null, rider, price, currency: txt(v('currency'), 8)?.toUpperCase() ?? null, period,
    paid_until: isDay(v('paid_until')) ? v('paid_until') : null, deposit: txt(v('deposit'), 120), rental_name: txt(v('rental_name'), 80), channel, address, phone,
    status: v('status') === 'returned' ? 'returned' : 'active', date_from: isDay(v('date_from')) ? v('date_from') : null, return_date: isDay(v('return_date')) ? v('return_date') : null, note: txt(v('note'), 200),
  };
  noSecrets('The bike', row.deposit ?? '', row.note ?? '', ck);
  const bid = old?.id ?? rid('bk_');
  const t = now();
  await env.DB.prepare(`INSERT INTO bikes (id, search_id, model, plate, rider_id, price, currency, period, paid_until, deposit, rental_name, channel, address, phone, checklist, status, date_from, return_date, note, created_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET model=excluded.model, plate=excluded.plate, rider_id=excluded.rider_id, price=excluded.price,
    currency=excluded.currency, period=excluded.period, paid_until=excluded.paid_until, deposit=excluded.deposit, rental_name=excluded.rental_name, channel=excluded.channel,
    address=excluded.address, phone=excluded.phone, checklist=excluded.checklist, status=excluded.status, date_from=excluded.date_from, return_date=excluded.return_date, note=excluded.note, updated_at=excluded.updated_at`)
    .bind(bid, s.id, row.model, row.plate, row.rider, row.price, row.currency, row.period, row.paid_until, row.deposit, row.rental_name, row.channel, row.address, row.phone,
      JSON.stringify(ck), row.status, row.date_from, row.return_date, row.note, old?.created_by ?? actor, old?.created_at ?? t, t).run();
  if (!old || old.status !== row.status) await event(env, s.id, 'bike', bid, actor, { model, plate: row.plate, status: row.status });
  const bike = bikeView(await env.DB.prepare('SELECT * FROM bikes WHERE id=?').bind(bid).first<any>());
  return { bike, warning: originalPassport(row.deposit) ? 'original_passport' : null };
}
export const bikeView = (b: any) => (b ? { ...b, checklist: parseJson(b.checklist, {}) } : b);

/** A rental payment: an expense (split: the rider; shared mode: the common wallet) and the new paid-until date. */
export async function payBike(env: Env, bike: any, b: any, actor: string) {
  const s = await env.DB.prepare('SELECT id, brief, money_mode FROM searches WHERE id=?').bind(bike.search_id).first<any>();
  if (!isDay(b.until)) throw new HttpError(400, 'bad_until', 'until must be YYYY-MM-DD (the new paid-until date)');
  const split = s.money_mode !== 'shared' && bike.rider_id ? { [bike.rider_id]: 1 } : null;
  const expense = await insertExpense(env, s, {
    title: `${bike.model}${bike.plate ? ' · ' + bike.plate : ''}`, amount: b.amount, currency: b.currency ?? bike.currency, date: day10(b.date) ?? undefined,
    paid_by: b.paid_by ?? (actor !== 'agent' ? actor : bike.rider_id), kind: 'transport', note: `${bike.rental_name ?? ''} → ${b.until}`.trim(), split,
  }, actor);
  await env.DB.prepare('UPDATE bikes SET paid_until=?, updated_at=? WHERE id=?').bind(b.until, now(), bike.id).run();
  return { bike: bikeView(await env.DB.prepare('SELECT * FROM bikes WHERE id=?').bind(bike.id).first<any>()), expense };
}

// ---------------------------------------------------------------- 3D scans

export const SCAN_PHASES = ['movein', 'moveout', 'bike'];
export async function setScan(env: Env, s: { id: string }, id: string, b: any, actor: string) {
  const old = id === 'new' ? null : await env.DB.prepare('SELECT * FROM scans WHERE id=? AND search_id=?').bind(id, s.id).first<any>();
  if (id !== 'new' && !old) throw new HttpError(404, 'no_scan');
  const v = (k: string) => (k in b ? b[k] : old?.[k] ?? null);
  const room = txt(v('room'), 60);
  if (!room) throw new HttpError(400, 'missing', 'room is required');
  const phase = SCAN_PHASES.includes(v('phase')) ? v('phase') : 'movein';
  const status = ['ok', 'redo', 'todo'].includes(v('status')) ? v('status') : v('doc_id') ? 'ok' : 'todo';
  const deal = await env.DB.prepare('SELECT listing_id FROM deals WHERE search_id=? ORDER BY updated_at DESC LIMIT 1').bind(s.id).first<any>();
  const note = txt(v('note'), 200);
  noSecrets('The scan note', note ?? '');
  const sid = old?.id ?? rid('sc_');
  const t = now();
  await env.DB.prepare(`INSERT INTO scans (id, search_id, listing_id, bike_id, room, phase, status, note, doc_id, app, sort, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET listing_id=excluded.listing_id, bike_id=excluded.bike_id, room=excluded.room, phase=excluded.phase, status=excluded.status, note=excluded.note,
    doc_id=excluded.doc_id, app=excluded.app, sort=excluded.sort, updated_at=excluded.updated_at`)
    .bind(sid, s.id, v('listing_id') ?? deal?.listing_id ?? null, v('bike_id'), room, phase, status, note, v('doc_id'), txt(v('app'), 30), Number(v('sort')) || 0, old?.created_by ?? actor, old?.created_at ?? t, t).run();
  if (!old || old.status !== status) await event(env, s.id, 'scan', sid, actor, { room, phase, status });
  return env.DB.prepare('SELECT * FROM scans WHERE id=?').bind(sid).first<any>();
}
export async function scansOf(env: Env, sid: string) {
  const rows = (await env.DB.prepare(`SELECT sc.*, d.size doc_size, d.created_at doc_at, d.file_name, (d.tg_file_id IS NOT NULL) has_file FROM scans sc LEFT JOIN documents d ON d.id=sc.doc_id
    WHERE sc.search_id=? ORDER BY sc.phase, sc.sort, sc.created_at`).bind(sid).all<any>()).results ?? [];
  return rows.map((r) => ({ ...r, has_file: !!r.has_file }));
}

// ---------------------------------------------------------------- house dossier

export const DOSSIER_KINDS = ['issue', 'power', 'cleaning', 'conflict', 'good', 'money', 'other'];
export async function setDossier(env: Env, id: string, b: any, actor: string, listing: any, ownerId: string) {
  const old = id === 'new' ? null : await env.DB.prepare('SELECT * FROM dossiers WHERE id=?').bind(id).first<any>();
  if (id !== 'new' && !old) throw new HttpError(404, 'no_dossier');
  const v = (k: string) => (k in b ? b[k] : old?.[k] ?? null);
  const title = txt(v('title'), 120) ?? listing?.title ?? null;
  if (!title) throw new HttpError(400, 'missing', 'title is required');
  const ids = new Set<string>(parseJson<string[]>(old?.listing_ids, []));
  if (listing) ids.add(listing.id);
  const ownerCid = v('owner_contact_id') ?? null;
  let ownerIdentity = old?.owner_identity ?? null;
  if (ownerCid && ownerCid !== old?.owner_contact_id) {
    const idsOf = await identitiesOf(env, ownerCid);
    ownerIdentity = idsOf.find((x) => !x.startsWith('contact:')) ?? idsOf[0];
  }
  const stats = 'stats' in b ? (b.stats && typeof b.stats === 'object' ? { months: Number(b.stats.months) || null, price: Number(b.stats.price) || null, currency: txt(b.stats.currency, 8), price_note: txt(b.stats.price_note, 60), issues: Number.isFinite(Number(b.stats.issues)) ? Number(b.stats.issues) : null } : null) : parseJson(old?.stats, null);
  const row = { title, area_text: txt(v('area_text'), 80) ?? listing?.district ?? null, lat: Number(v('lat') ?? listing?.lat) || null, lng: Number(v('lng') ?? listing?.lng) || null,
    verdict_title: txt(v('verdict_title'), 120), verdict: txt(v('verdict'), 600) };
  noSecrets('The dossier', row.verdict ?? '', row.verdict_title ?? '');
  const did = old?.id ?? rid('ds_');
  const t = now();
  await env.DB.prepare(`INSERT INTO dossiers (id, title, area_text, lat, lng, owner_contact_id, owner_identity, listing_ids, verdict_title, verdict, stats, updated_by, created_at, updated_at, owner_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, area_text=excluded.area_text, lat=excluded.lat, lng=excluded.lng, owner_contact_id=excluded.owner_contact_id,
    owner_identity=excluded.owner_identity, listing_ids=excluded.listing_ids, verdict_title=excluded.verdict_title, verdict=excluded.verdict, stats=excluded.stats, updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
    .bind(did, row.title, row.area_text, row.lat, row.lng, ownerCid, ownerIdentity, JSON.stringify([...ids]), row.verdict_title, row.verdict, stats ? JSON.stringify(stats) : null, actor, old?.created_at ?? t, t, ownerId).run();
  if (listing) await event(env, listing.search_id, 'dossier', did, actor, { title: row.title });
  return dossierView(env, did);
}
export async function addDossierItem(env: Env, did: string, b: any, actor: string) {
  if (!(await env.DB.prepare('SELECT 1 FROM dossiers WHERE id=?').bind(did).first())) throw new HttpError(404, 'no_dossier');
  const title = txt(b.title, 120);
  if (!title) throw new HttpError(400, 'missing', 'title is required');
  const text = txt(b.text, 400);
  noSecrets('The dossier item', title, text ?? '');
  const id = rid('di_');
  const s = Number(b.sentiment);
  await env.DB.prepare('INSERT INTO dossier_items (id, dossier_id, kind, title, text, sentiment, date, search_id, author, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(id, did, DOSSIER_KINDS.includes(b.kind) ? b.kind : 'other', title, text, s > 0 ? 1 : s < 0 ? -1 : 0, day10(b.date), b.search_id ?? null, actor, now()).run();
  return env.DB.prepare('SELECT * FROM dossier_items WHERE id=?').bind(id).first<any>();
}
export async function dossierView(env: Env, did: string) {
  const d = await env.DB.prepare('SELECT * FROM dossiers WHERE id=?').bind(did).first<any>();
  if (!d) return null;
  const ids = parseJson<string[]>(d.listing_ids, []);
  const [items, issues] = await env.DB.batch<any>([
    env.DB.prepare('SELECT * FROM dossier_items WHERE dossier_id=? ORDER BY coalesce(date, created_at)').bind(did),
    env.DB.prepare(`SELECT id, title, status, note, fixed_at, created_at FROM issues WHERE listing_id IN (${ids.map(() => '?').join(',') || "''"}) ORDER BY created_at`).bind(...ids),
  ]);
  return { ...d, listing_ids: ids, stats: parseJson(d.stats, null), items: items.results ?? [], issues: issues.results ?? [] };
}
/** The hunter's dossiers about this listing: the same listing, within 80 m, the same owner identity, or the same title. */
export async function matchDossiers(env: Env, l: any) {
  const rows = (await env.DB.prepare('SELECT id, title, lat, lng, owner_identity, listing_ids FROM dossiers WHERE owner_id=(SELECT owner_id FROM searches WHERE id=?)').bind(l.search_id).all<any>()).results ?? [];
  const contacts = ((await env.DB.prepare('SELECT contact_id FROM listing_contacts WHERE listing_id=?').bind(l.id).all<any>()).results ?? []).map((r) => r.contact_id);
  const ids = new Set<string>();
  for (const c of contacts) for (const x of await identitiesOf(env, c)) ids.add(x);
  const norm = (s: string) => String(s ?? '').toLowerCase().replace(/[^a-zа-я0-9]+/gi, ' ').trim();
  const out: any[] = [];
  for (const d of rows) {
    const why = parseJson<string[]>(d.listing_ids, []).includes(l.id) ? 'listing'
      : d.lat != null && l.lat != null && kmBetween([d.lat, d.lng], [l.lat, l.lng]) < 0.08 ? 'point'
      : d.owner_identity && ids.has(d.owner_identity) ? 'owner'
      : norm(d.title) && norm(d.title) === norm(l.title) ? 'title' : null;
    if (why) out.push({ ...(await dossierView(env, d.id)), match: why });
  }
  return out;
}
export { identityOf };

// ---------------------------------------------------------------- things bought with the villa

export async function setItem(env: Env, s: { id: string }, id: string, b: any, actor: string) {
  const old = id === 'new' ? null : await env.DB.prepare('SELECT * FROM items WHERE id=? AND search_id=?').bind(id, s.id).first<any>();
  if (id !== 'new' && !old) throw new HttpError(404, 'no_item');
  const v = (k: string) => (k in b ? b[k] : old?.[k] ?? null);
  const name = txt(v('name'), 80);
  if (!name) throw new HttpError(400, 'missing', 'name is required');
  const price = num(v('price')), sold = num(v('sold_price')), target = num(v('resale_target'));
  if ([price, sold, target].some((x) => Number.isNaN(x))) throw new HttpError(400, 'bad_amount');
  const photo = v('photo') ? String(v('photo')) : null;
  if (photo && !photo.startsWith(`i/${s.id}/`)) throw new HttpError(400, 'bad_photo');
  const deal = await env.DB.prepare('SELECT listing_id FROM deals WHERE search_id=? ORDER BY updated_at DESC LIMIT 1').bind(s.id).first<any>();
  const row = { name, price, currency: txt(v('currency'), 8)?.toUpperCase() ?? null, seller: txt(v('seller'), 60), bought_at: isDay(v('bought_at')) ? v('bought_at') : null,
    icon: /^[a-z0-9-]{1,30}$/.test(String(v('icon') ?? '')) ? v('icon') : null, status: ['have', 'offered', 'sold'].includes(v('status')) ? v('status') : 'have', note: txt(v('note'), 200) };
  noSecrets('The item', row.note ?? '');
  const iid = old?.id ?? rid('it_');
  const t = now();
  await env.DB.prepare(`INSERT INTO items (id, search_id, listing_id, name, price, currency, seller, bought_at, photo, icon, status, sold_price, resale_target, note, created_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, price=excluded.price, currency=excluded.currency, seller=excluded.seller, bought_at=excluded.bought_at,
    photo=excluded.photo, icon=excluded.icon, status=excluded.status, sold_price=excluded.sold_price, resale_target=excluded.resale_target, note=excluded.note, updated_at=excluded.updated_at`)
    .bind(iid, s.id, v('listing_id') ?? deal?.listing_id ?? null, row.name, row.price, row.currency, row.seller, row.bought_at, photo, row.icon, row.status, sold, target, row.note,
      old?.created_by ?? actor, old?.created_at ?? t, t).run();
  if (!old || old.status !== row.status) await event(env, s.id, 'item', iid, actor, { name, status: row.status, price });
  return env.DB.prepare('SELECT * FROM items WHERE id=?').bind(iid).first<any>();
}
export async function itemsView(env: Env, sid: string) {
  const items = (await env.DB.prepare("SELECT * FROM items WHERE search_id=? ORDER BY status='sold', coalesce(bought_at, created_at)").bind(sid).all<any>()).results ?? [];
  const cur = items.find((i) => i.currency)?.currency ?? null;
  const total = items.reduce((a, i) => a + (i.price ?? 0), 0);
  const unsold = items.filter((i) => i.status !== 'sold');
  const targets = unsold.filter((i) => i.resale_target != null);
  const resale = targets.length ? targets.reduce((a, i) => a + i.resale_target, 0) + Math.round(unsold.filter((i) => i.resale_target == null).reduce((a, i) => a + (i.price ?? 0), 0) * 0.6)
    : Math.round(unsold.reduce((a, i) => a + (i.price ?? 0), 0) * 0.6);
  return { items, total, currency: cur, resale_target: resale, sold: items.filter((i) => i.status === 'sold').reduce((a, i) => a + (i.sold_price ?? 0), 0) };
}

// ---------------------------------------------------------------- reminders (cron)

type DmFn = (env: Env, sid: string, build: (lang: string) => { text: string; buttons?: any[][] }, opts: any) => Promise<number>;
interface CronCtx { dmMembers: DmFn; dm: (env: Env, chat: number, text: string, buttons?: any[][]) => Promise<boolean>; searchCtx: (env: Env, sid: string) => Promise<any>; localDay: (tz: string) => string; localMinutes: (tz: string) => number; quietLeft: (q: any, tz: string) => number; appUrl: (env: Env, h: string) => string; esc: (s: unknown) => string }

const fmtDM = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
async function once(env: Env, key: string) {
  if (await env.DB.prepare('SELECT 1 FROM sent_marks WHERE key=?').bind(key).first()) return false;
  const ins = await env.DB.prepare('INSERT OR IGNORE INTO sent_marks (key, at) VALUES (?,?)').bind(key, now()).run();
  return !!ins.meta.changes;
}

/** Bikes: payment 2 days before paid_until and on the day; return on return_date. To the rider (or everyone for a shared bike). */
export async function bikeReminders(env: Env, c: CronCtx) {
  const rows = (await env.DB.prepare(`SELECT b.*, s.region FROM bikes b JOIN searches s ON s.id=b.search_id WHERE b.status='active' AND s.status!='closed' AND (b.paid_until IS NOT NULL OR b.return_date IS NOT NULL)`).all<any>()).results ?? [];
  for (const b of rows) {
    try {
      const ctx = await c.searchCtx(env, b.search_id);
      if (!ctx || c.localMinutes(ctx.tz) < 8 * 60 || c.quietLeft(ctx.quiet, ctx.tz) > 0) continue;
      const today = c.localDay(ctx.tz);
      const todo: { key: string; kind: string; d: string; left: number }[] = [];
      if (b.paid_until) { const left = daysUntil(b.paid_until, today); if (left === 2 || left === 0) todo.push({ key: `bike:${b.id}:pay:${b.paid_until}:${left}`, kind: 'pay', d: b.paid_until, left }); }
      if (b.return_date && daysUntil(b.return_date, today) === 0) todo.push({ key: `bike:${b.id}:ret:${b.return_date}`, kind: 'ret', d: b.return_date, left: 0 });
      for (const x of todo) {
        if (!(await once(env, x.key))) continue;
        const name = `${b.model}${b.plate ? ' · ' + b.plate : ''}`;
        const build = (lang: string) => {
          const ru = lang === 'ru';
          const head = x.kind === 'ret' ? (ru ? '🛵 Сегодня вернуть байк' : '🛵 Return the bike today') : x.left === 0 ? (ru ? '🛵 Сегодня оплата байка' : '🛵 Bike rent due today') : (ru ? `🛵 Через 2 дня оплата байка (до ${fmtDM(x.d)})` : `🛵 Bike rent due in 2 days (by ${fmtDM(x.d)})`);
          return { text: `${head}: <b>${c.esc(name)}</b>${b.rental_name ? ` · ${c.esc(b.rental_name)}` : ''}`, buttons: [[{ text: ru ? 'Байки' : 'Bikes', web_app: { url: c.appUrl(env, `/s/${b.search_id}/bikes`) } }]] };
        };
        if (b.rider_id) {
          const u = await env.DB.prepare('SELECT u.tg_user_id, u.lang FROM users u JOIN members m ON m.user_id=u.id AND m.search_id=? WHERE u.id=? AND m.notify=1').bind(b.search_id, b.rider_id).first<any>();
          if (u?.tg_user_id) { const m = build(u.lang); await c.dm(env, u.tg_user_id, m.text, m.buttons); }
        } else await c.dmMembers(env, b.search_id, build, { quiet: 'send' });
      }
    } catch (e) { console.error('bikes', b.id, String((e as Error)?.message ?? e)); }
  }
}

/** Local calendar (pack calendar.yaml): `remind[].days` before an event, for searches that are found / living while the lease covers it. */
export async function calendarReminders(env: Env, c: CronCtx) {
  const packs = await packData(env);
  const rows = (await env.DB.prepare(`SELECT s.id, s.region, (SELECT data FROM deals d WHERE d.search_id=s.id ORDER BY updated_at DESC LIMIT 1) deal FROM searches s WHERE s.status IN ('found','living')`).all<any>()).results ?? [];
  for (const s of rows) {
    try {
      const cal = packs?.[countryOf(s.region)]?.calendar;
      if (!cal?.events?.length) continue;
      const ctx = await c.searchCtx(env, s.id);
      if (!ctx || c.localMinutes(ctx.tz) < 8 * 60 || c.quietLeft(ctx.quiet, ctx.tz) > 0) continue;
      const today = c.localDay(ctx.tz);
      const terms = parseJson<any>(s.deal, {})?.terms ?? {};
      for (const ev of cal.events) {
        if (!isDay(ev.date) || !Array.isArray(ev.remind)) continue;
        if (terms.to && String(terms.to).slice(0, 10) < ev.date) continue;
        for (const r of ev.remind) {
          const days = Number(r?.days);
          if (!Number.isFinite(days) || daysUntil(ev.date, today) !== days) continue;
          if (!(await once(env, `cal:${s.id}:${ev.id}:${days}`))) continue;
          await c.dmMembers(env, s.id, (lang) => {
            const L = (o: any) => o?.[lang] ?? o?.en ?? '';
            return { text: `📅 <b>${c.esc(L(r.title) || L(ev.title))}</b> · ${c.esc(L(ev.title))} ${fmtDM(ev.date)}${L(r.note) ? `\n${c.esc(L(r.note))}` : ''}`,
              buttons: [[{ text: lang === 'ru' ? 'Календарь' : 'Calendar', web_app: { url: c.appUrl(env, `/s/${s.id}/calendar`) } }]] };
          }, { quiet: 'send' });
        }
      }
    } catch (e) { console.error('calendar', s.id, String((e as Error)?.message ?? e)); }
  }
}
export { dealDates };
