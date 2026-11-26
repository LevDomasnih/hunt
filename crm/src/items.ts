// Split from wave4.ts.
import { isDay, noSecrets, num, txt } from './check';
import { Env, HttpError, event, now, rid } from './util';

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
