// Split from wave4.ts.
import { insertExpense, normAddr } from './agent';
import { day10, isDay, noSecrets, num, txt } from './check';
import { Env, HttpError, event, now, parseJson, rid } from './util';

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
