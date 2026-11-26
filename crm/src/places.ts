// Split from wave4.ts.
import { basePlaces } from './assets';
import { noSecrets, txt } from './check';
import { assignArea } from './geo';
import { recomputeRings } from './location';
import { countryOf } from './members';
import { Env, HttpError, event, now, rid } from './util';

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
