// Split from wave4.ts.
import { basePlaces } from './assets';
import { txt } from './check';
import { inGeom, kmBetween } from './geo';
import { packData } from './life';
import { countryOf } from './members';
import { Env, HttpError, now, parseJson } from './util';

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
