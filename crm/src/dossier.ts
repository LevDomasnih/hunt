// Split from wave4.ts.
import { day10, noSecrets, txt } from './check';
import { kmBetween } from './geo';
import { identitiesOf } from './life';
import { Env, HttpError, event, now, parseJson, rid } from './util';

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
