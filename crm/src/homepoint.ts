// Split from wave5.ts.
import { packData } from './life';
import { countryOf } from './members';
import { Env, parseJson } from './util';
import { basePlaces } from './assets';
import { kmBetween } from './geo';

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
export function areaNameOf(pack: any, district: string | null | undefined, lang = 'ru') {
  if (!district) return null;
  const ar = Object.values<any>(pack.areas ?? {}).find((x) => (x.districts ?? []).includes(district)) ?? pack.areas?.[district];
  if (ar?.name) return ar.name[lang] ?? ar.name.en ?? null;
  for (const sub of Object.values<any>(pack.sub ?? {})) if (sub.districts?.[district]) return sub.districts[district][lang] ?? sub.districts[district].en;
  return null;
}

/** Base pack places + the search's own places (not hidden), one shape, with minutes from a point. */
export async function placesAround(env: Env, s: { id: string; region: string }, pt: { lat: number; lng: number }, kmh: number) {
  const bp = await basePlaces(env, countryOf(s.region));
  const own = (await env.DB.prepare('SELECT id, name, type, tier, lat, lng, note FROM places WHERE search_id=? AND hidden=0').bind(s.id).all<any>()).results ?? [];
  const all = [...own.map((p) => ({ ...p, own: true })), ...(bp.places ?? []).map((p: any) => ({ ...p, id: 'b:' + p.id, own: false }))];
  return { types: bp.types ?? {}, list: all.filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))).map((p) => ({ ...p, minutes: minutesKm(kmBetween([pt.lat, pt.lng], [Number(p.lat), Number(p.lng)]), kmh) })) };
}
