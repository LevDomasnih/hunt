// Split from wave4.ts.
import { areasGeo } from './assets';
import { packData } from './life';
import { countryOf } from './members';
import { Env } from './util';

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
export async function assignArea(env: Env, region: string, lat: number, lng: number): Promise<string | null> {
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
