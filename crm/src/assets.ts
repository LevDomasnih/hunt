// Split from wave4.ts.
import { Env } from './util';

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
export const areasGeo = (env: Env, country: string) => asset(env, `/art/${country}/districts.geojson`);
