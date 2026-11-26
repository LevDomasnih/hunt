// Wave 10 · orders from suppliers ("Заказы"): the catalog (its own compact endpoint, never in the main state), one shared
// basket per supplier, the message to the supplier, the order's life and its one expense in Деньги.
//  - Members fill the basket (each line keeps who added it), check the receipt and send the message THEMSELVES: the app opens
//    WhatsApp with the text ready ("opened" until someone taps Отправил / Не отправил). Or the agent sends it through the usual
//    approval draft (kind other). Nothing is ever sent or paid from here.
//  - "Привезли, оплатил" creates exactly one expense (kind food, the payer = who tapped), in one batch, idempotent.
//  - The agent imports price lists (upsert by name_id, price history) and records the supplier's answer; it never orders.
import { Env, HttpError, json, body, now, rid, parseJson, event, sensitive, httpUrl } from './util';
import { contactByAddress } from './household';
import { packData } from './life';
import { countryOf } from './members';
import { member, localDay, h, searchTzOf, type Access, type Role } from './wave5';
import { draftToOwner, dmMembers, appUrl, localMinutes, commit } from './notify';
import { tg } from './tg';
import { rateLimit } from './media';
import {
  cleanQty, totals, freeDelivery, slots, badTime, orderMessage, orderTranslation, chatUrl, parseImport, parseHours, UNITS, type MsgOpts, type Line,
} from './order-text';
import {
  SET_NAME_MAX, REPEATS, SET_TIME_DEFAULT, nameKey, isTime, isDays, nextOccurrence, biweeklyAnchor, dueDay, bandsOf, spread, rangeStr, reminderText, reminderButtons, skippedLine,
} from './order-sets';

type Row = Record<string, any>;
interface User { id: string; display_name: string; lang: string }
const VOTERS: Role[] = ['owner', 'member'];
const READERS: Role[] = ['owner', 'member', 'viewer'];
export const ACTIVE = ['opened', 'draft', 'sent', 'confirmed'];
const ACTIVE_SQL = ACTIVE.map((s) => `'${s}'`).join(',');
const KINDS = ['fruit', 'fish', 'other'];
const CHANNELS = ['whatsapp', 'telegram', 'phone'];
const MAX_LINES = 80;
const USUAL_MIN = 2; // in this many delivered orders = "ваше обычное"
const MAX_SETS = 50; // per search
const RESTORE_MIN = 15; // "Вернуть" after "Очистить" works this long

const txt = (v: unknown, field: string, max: number): string | null => {
  const s = v == null ? '' : String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (!s) return null;
  if (s.length > max) throw new HttpError(400, 'too_long', `${field} is longer than ${max} characters`);
  const sn = sensitive(s);
  if (sn) throw new HttpError(400, 'sensitive', `${field}: ${sn}. Hunt never stores passport, ID or card numbers.`);
  return s;
};
const amount = (v: unknown, field: string): number | null => {
  if (v == null || v === '') return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n <= 0 || n > 1e9) throw new HttpError(400, 'bad_amount', `${field} must be a positive amount (main units)`);
  return n;
};
const addDay = (day: string, n: number) => new Date(Date.parse(day + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);

// ---------------------------------------------------------------- views

/** Lines of some orders with the item they point to: a basket shows live names and prices, a sent order its own snapshot. */
const LINES_SQL = `SELECT l.order_id, l.item_id, l.qty, l.added_by, l.price lprice, l.price_unsure lunsure, l.name_id lname_id, l.name_ru lname_ru, l.name_en lname_en,
    i.name_id, i.name_ru, i.name_en, i.unit, i.step, i.price, i.price_unsure, i.toy, i.grp, i.hidden
  FROM order_lines l JOIN supplier_items i ON i.id=l.item_id`;
function lineView(l: Row, live: boolean) {
  return {
    item_id: l.item_id, qty: l.qty, by: l.added_by, unit: l.unit, step: l.step, toy: l.toy, grp: l.grp,
    name_id: live ? l.name_id : l.lname_id ?? l.name_id, name_ru: live ? l.name_ru : l.lname_ru ?? l.name_ru, name_en: live ? l.name_en : l.lname_en ?? l.name_en,
    price: live ? l.price : l.lprice, unsure: !!(live ? l.price_unsure : l.lunsure), ...(live && l.hidden ? { gone: true } : {}),
  };
}
function orderView(o: Row, lines: Row[], full: boolean) {
  const live = o.status === 'basket';
  const ls = lines.filter((l) => l.order_id === o.id).map((l) => lineView(l, live));
  const t = totals(ls);
  const v: Row = {
    id: o.id, supplier_id: o.supplier_id, supplier: o.sname, kind: o.skind, currency: o.scurrency, status: o.status, via: o.via, day: o.deliver_day, time: o.deliver_time,
    lines: ls, sum: t.sum, unknown: t.unknown, unsure: t.unsure,
    opened_at: o.opened_at, sent_at: o.sent_at, sent_by: o.sent_by, confirmed_at: o.confirmed_at, confirmed_by: o.confirmed_by, delivered_at: o.delivered_at,
    created_by: o.created_by, created_at: o.created_at, updated_at: o.updated_at,
  };
  if (full) Object.assign(v, { note: o.note, with_address: o.with_address, text: o.text, reply: o.reply, reply_tr: o.reply_tr, expense_id: o.expense_id, total_est: o.total_est, total: o.total_final, paid_by: o.paid_by, method: o.xmethod ?? null, channel: o.schannel, address: o.saddress });
  return v;
}
const ORDER_SQL = `SELECT o.*, s.name sname, s.kind skind, s.currency scurrency, s.channel schannel, s.address saddress, (SELECT method FROM expenses WHERE id=o.expense_id) xmethod FROM orders o JOIN suppliers s ON s.id=o.supplier_id`;

async function oneOrder(env: Env, sid: string, id: unknown): Promise<{ o: Row; lines: Row[] }> {
  const [a, b] = await env.DB.batch<Row>([
    env.DB.prepare(`${ORDER_SQL} WHERE o.id=?1 AND o.search_id=?2`).bind(String(id ?? ''), sid),
    env.DB.prepare(`${LINES_SQL} JOIN orders o ON o.id=l.order_id WHERE l.order_id=?1 AND o.search_id=?2 ORDER BY l.at, i.sort`).bind(String(id ?? ''), sid),
  ]);
  const o = a.results?.[0];
  if (!o) throw new HttpError(404, 'no_order');
  return { o, lines: b.results ?? [] };
}

/**
 * What Hunt learns about a supplier ("сколько приготовить денег"): paid / price list of each delivered order whose every line had a
 * price, oldest first, as [order id, ratio, delivered_at]. The Mini App turns them into the range (public/app.js ordSpread); the money stays there.
 */
const RATIOS_MAX = 30;
const RATIOS_SQL = `SELECT supplier_id, id, round(total_final * 1.0 / total_est, 4) r, delivered_at FROM orders
  WHERE search_id=?1 AND status='delivered' AND total_est > 0 AND total_final > 0 AND unknown_n = 0 ORDER BY delivered_at, id`;
const supplierView = (s: Row, full: boolean, ratios?: Row[]) => ({
  id: s.id, name: s.name, kind: s.kind, hours: s.hours, min_free_delivery: s.min_free_delivery, delivery_fee: s.delivery_fee ?? null, currency: s.currency, lang: s.lang, dir_entry_id: s.dir_entry_id,
  delivery_note: { ru: s.delivery_note_ru, en: s.delivery_note_en }, note: { ru: s.note_ru, en: s.note_en }, ...(full ? { channel: s.channel, address: s.address } : {}),
  ...(full && ratios ? { ratios: ratios.filter((r) => r.supplier_id === s.id).slice(-RATIOS_MAX).map((r) => [r.id, r.r, r.delivered_at]) } : {}),
});

/**
 * Home, the status screen and the history: suppliers (no items), baskets, active orders, the last delivered one per supplier,
 * the last 20 finished ones. Two D1 round trips at most, whatever the catalog size.
 */
async function ordersView(env: Env, sid: string, full: boolean, tz: string | null = null) {
  const DB = env.DB;
  const pick = `SELECT id FROM orders WHERE search_id=?1 AND (status IN ('basket',${ACTIVE_SQL}) OR id IN (SELECT id FROM orders WHERE search_id=?1 AND status IN ('delivered','cancelled') ORDER BY updated_at DESC LIMIT 20))`;
  const [su, or, ln, ra, st, sl] = await DB.batch<Row>([
    DB.prepare('SELECT * FROM suppliers WHERE search_id=?1 AND hidden=0 ORDER BY sort, created_at').bind(sid),
    DB.prepare(`${ORDER_SQL} WHERE o.id IN (${pick}) ORDER BY o.updated_at DESC`).bind(sid),
    DB.prepare(`${LINES_SQL} WHERE l.order_id IN (${pick}) ORDER BY l.at, i.sort`).bind(sid),
    DB.prepare(RATIOS_SQL).bind(sid),
    DB.prepare(SETS_SQL).bind(sid),
    DB.prepare(SET_LINES_SQL).bind(sid),
  ]);
  const all = (or.results ?? []).map((o) => orderView(o, ln.results ?? [], full));
  const sups = (su.results ?? []).map((s) => supplierView(s, full, ra.results ?? []));
  const on = new Set(sups.map((s) => s.id));
  return {
    suppliers: sups,
    baskets: all.filter((o) => o.status === 'basket' && o.lines.length),
    active: all.filter((o) => ACTIVE.includes(o.status)),
    history: all.filter((o) => o.status === 'delivered' || o.status === 'cancelled'),
    sets: (st.results ?? []).filter((x) => on.has(x.supplier_id)).map((x) => setView(x, sl.results ?? [], tz)),
  };
}

// ---------------------------------------------------------------- sets ("Наборы"): a saved basket of one supplier + an optional reminder

const SETS_SQL = 'SELECT * FROM order_sets WHERE search_id=?1 ORDER BY created_at, id';
const SET_LINES_SQL = `SELECT l.set_id, l.item_id, l.qty, i.name_id, i.name_ru, i.name_en, i.unit, i.step, i.price, i.price_unsure, i.toy, i.grp, i.hidden
  FROM order_set_lines l JOIN supplier_items i ON i.id=l.item_id WHERE l.set_id IN (SELECT id FROM order_sets WHERE search_id=?1) ORDER BY l.sort, i.sort`;
/** Live names and prices (like a basket); an item the supplier no longer lists is `gone` and never goes into the basket. */
function setView(st: Row, lines: Row[], tz: string | null) {
  return {
    id: st.id, supplier_id: st.supplier_id, name: st.name, repeat: st.repeat, days: st.days, time: st.time, anchor: st.anchor,
    next: tz && st.repeat !== 'none' ? nextOccurrence(st as any, localDay(tz), localMinutes(tz)) : null, last_sent: st.last_sent, skipped: st.skipped,
    lines: lines.filter((l) => l.set_id === st.id).map((l) => ({
      item_id: l.item_id, qty: l.qty, unit: l.unit, step: l.step, toy: l.toy, grp: l.grp, name_id: l.name_id, name_ru: l.name_ru, name_en: l.name_en,
      price: l.price, unsure: !!l.price_unsure, ...(l.hidden ? { gone: true } : {}),
    })),
    created_by: st.created_by, created_at: st.created_at, updated_at: st.updated_at,
  };
}
const setName = (v: unknown) => {
  const n = txt(v, 'name', SET_NAME_MAX);
  if (!n) throw new HttpError(400, 'missing', 'name is required');
  return n;
};
/** repeat / days / time of a body against the current set; "every 2 weeks" gets its anchor week when it starts or the days change. */
function scheduleCols(b: Row, cur: Row | null, tz: string): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  if ('repeat' in b) { if (!(REPEATS as readonly string[]).includes(String(b.repeat))) throw new HttpError(400, 'bad_repeat', `repeat must be one of ${REPEATS.join(', ')}`); c.repeat = String(b.repeat); }
  if ('days' in b) { const d = Number(b.days); if (!isDays(d)) throw new HttpError(400, 'bad_days', 'days is a weekday bitmask 0…127 (1 = Monday … 64 = Sunday)'); c.days = d; }
  if ('time' in b) { if (!isTime(b.time)) throw new HttpError(400, 'bad_time', 'time must be HH:MM'); c.time = b.time; }
  const repeat = (c.repeat ?? cur?.repeat ?? 'none') as string, days = (c.days ?? cur?.days ?? 0) as number, time = (c.time ?? cur?.time ?? SET_TIME_DEFAULT) as string;
  if (repeat !== 'none' && !days) throw new HttpError(400, 'need_days', 'Pick at least one weekday');
  if (repeat === 'biweekly' && ('repeat' in c && cur?.repeat !== 'biweekly' || 'days' in c || !cur?.anchor)) c.anchor = biweeklyAnchor(days, time, localDay(tz), localMinutes(tz));
  if (repeat !== 'biweekly' && 'repeat' in c) c.anchor = null;
  return c;
}
async function nameFree(env: Env, sid: string, key: string, id = '') {
  const x = await env.DB.prepare('SELECT 1 FROM order_sets WHERE search_id=? AND name_key=? AND id!=?').bind(sid, key, id).first();
  if (x) throw new HttpError(409, 'name_taken', 'There is a set with this name already');
}
const setOf = async (env: Env, sid: string, id: unknown) => {
  const st = await env.DB.prepare('SELECT os.* FROM order_sets os JOIN suppliers s ON s.id=os.supplier_id AND s.hidden=0 WHERE os.id=? AND os.search_id=?').bind(String(id ?? ''), sid).first<Row>();
  if (!st) throw new HttpError(404, 'no_set');
  return st;
};

/** The set's lines that go into the basket and the range for them: the same formula and data as the Mini App (order-sets.ts spread). */
async function setRange(env: Env, st: Row) {
  const [ls, su, ra, it] = await env.DB.batch<Row>([
    env.DB.prepare('SELECT l.qty, i.price, i.unit, i.grp, i.price_unsure unsure FROM order_set_lines l JOIN supplier_items i ON i.id=l.item_id AND i.hidden=0 WHERE l.set_id=?').bind(st.id),
    env.DB.prepare('SELECT min_free_delivery, delivery_fee, currency FROM suppliers WHERE id=?').bind(st.supplier_id),
    env.DB.prepare(`SELECT round(total_final * 1.0 / total_est, 4) r FROM orders WHERE supplier_id=? AND status='delivered' AND total_est > 0 AND total_final > 0 AND unknown_n = 0 ORDER BY delivered_at, id`).bind(st.supplier_id),
    env.DB.prepare('SELECT price, price_unsure, grp, unit FROM supplier_items WHERE supplier_id=? AND hidden=0 AND price > 0').bind(st.supplier_id),
  ]);
  const lines = (ls.results ?? []) as any[];
  return { n: lines.length, sp: spread(lines, (su.results?.[0] ?? null) as any, (ra.results ?? []).map((x) => Number(x.r)).slice(-RATIOS_MAX), bandsOf((it.results ?? []) as any)) };
}

/**
 * Cron (every 15 min): a set with a repeat reminds every member (owner, members; notifications on, their language, quiet
 * hours postpone it) on its day at its local time, once a day. Buttons: "Собрать корзину" (the Mini App puts the set into the
 * basket and opens it) and "Пропустить". The order itself is never sent from here.
 */
export async function setsCron(env: Env) {
  const rows = (await env.DB.prepare(`SELECT os.*, s.region, s.brief FROM order_sets os JOIN searches s ON s.id=os.search_id AND s.status!='closed'
      JOIN suppliers su ON su.id=os.supplier_id AND su.hidden=0 WHERE os.repeat IN ('weekly','biweekly') AND os.days > 0 LIMIT 300`).all<Row>()).results ?? [];
  for (const st of rows) {
    const tz = searchTzOf(st);
    const day = dueDay(st as any, localDay(tz), localMinutes(tz));
    if (!day) continue;
    const r = await setRange(env, st);
    if (r.n) await dmMembers(env, st.search_id, (lang) => setReminder(env, st, day, r, lang), { quiet: 'postpone', key: `oset:${st.id}:${day}`, votersOnly: true });
    await commit(env, [env.DB.prepare('UPDATE order_sets SET last_sent=? WHERE id=?').bind(day, st.id)]);
  }
}
/** The reminder DM (exported for the checks: it is built without sending). */
export function setReminder(env: Env, st: Row, day: string, r: { n: number; sp: ReturnType<typeof spread> }, lang: string) {
  const bt = reminderButtons(lang);
  return {
    text: reminderText(lang, day, st.name, r.n, r.sp ? rangeStr(r.sp.lo, r.sp.hi, r.sp.cur, lang) : null),
    buttons: [[{ text: bt.go, web_app: { url: appUrl(env, `/s/${st.search_id}/set-apply/${st.id}`) } }, { text: bt.skip, callback_data: `os:${day}:${st.id}` }]],
  };
}
/** Bot callback "os:<day>:<set>" (Пропустить): this occurrence is skipped, the message says so and loses its buttons. */
export async function setSkipCallback(env: Env, user: { id: string; display_name: string; lang: string }, q: any, day: string, id: string): Promise<string | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? '')) return null;
  const st = await env.DB.prepare(`SELECT os.id, s.status FROM order_sets os JOIN searches s ON s.id=os.search_id
      JOIN members m ON m.search_id=os.search_id AND m.user_id=? AND m.role IN ('owner','member') WHERE os.id=?`).bind(user.id, String(id ?? '')).first<Row>();
  if (!st) return null;
  const ru = user.lang !== 'en';
  if (st.status === 'closed') return ru ? 'Проект закрыт' : 'The project is closed';
  await env.DB.prepare('UPDATE order_sets SET skipped=?, updated_at=? WHERE id=?').bind(day, now(), st.id).run();
  if (q?.message) {
    await tg(env, 'editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: `${String(q.message.text ?? '')}\n\n${skippedLine(user.lang, user.display_name)}`, reply_markup: { inline_keyboard: [] } }).catch(() => null);
  }
  return ru ? 'Пропускаем' : 'Skipped';
}

/** The whole shop: every supplier with its catalog (items as arrays, see ITEM_KEYS) + the orders view. */
export const ITEM_KEYS = ['id', 'ru', 'en', 'name_id', 'grp', 'unit', 'step', 'price', 'flags', 'toy', 'top', 'fav']; // flags: 1 = unsure, 2 = by request
async function shopView(env: Env, sid: string, full: boolean, tz: string) {
  const [v, it] = await Promise.all([
    ordersView(env, sid, full, tz),
    env.DB.prepare(`SELECT i.* FROM supplier_items i JOIN suppliers s ON s.id=i.supplier_id WHERE s.search_id=? AND s.hidden=0 AND i.hidden=0 ORDER BY i.supplier_id, i.sort, i.name_ru`).bind(sid).all<Row>(),
  ]);
  const items: Record<string, unknown[][]> = {};
  const at: Record<string, string> = {};
  for (const i of it.results ?? []) {
    (items[i.supplier_id] ??= []).push([i.id, i.name_ru, i.name_en, i.name_id, i.grp, i.unit, i.step, i.price, (i.price_unsure ? 1 : 0) | (i.by_request ? 2 : 0), i.toy, i.top, i.fav]);
    if (i.price_at && i.price_at > (at[i.supplier_id] ?? '')) at[i.supplier_id] = i.price_at;
  }
  return { ...v, keys: ITEM_KEYS, items, price_at: at, usual_min: USUAL_MIN };
}

// ---------------------------------------------------------------- the message

async function msgOpts(env: Env, a: Access, sid: string, o: Row, lines: Row[]): Promise<{ opts: MsgOpts; withAddress: boolean; hasAddress: boolean; today: string; min: number; supplier: Row }> {
  const [g, s, prev] = await env.DB.batch<Row>([
    env.DB.prepare('SELECT address, map_url FROM guides WHERE search_id=?').bind(sid),
    env.DB.prepare('SELECT * FROM suppliers WHERE id=?').bind(o.supplier_id),
    env.DB.prepare("SELECT 1 x FROM orders WHERE supplier_id=?1 AND id!=?2 AND status IN ('sent','confirmed','delivered') LIMIT 1").bind(o.supplier_id, o.id),
  ]);
  const address = g.results?.[0]?.address ?? null;
  // The house address goes out only when the guide has one and the toggle is on (default: on for the first order here).
  const withAddress = !!address && (o.with_address == null ? !prev.results?.length : !!o.with_address);
  const today = localDay(a.tz);
  const min = localMinutes(a.tz);
  const day = o.deliver_day && o.deliver_day >= today ? o.deliver_day : null; // a stale day from an old basket never goes out
  const live = o.status === 'basket';
  const ls = lines.map((l) => lineView(l, live));
  return {
    opts: {
      lines: ls as unknown as Line[], day: day === today ? 'today' : day === addDay(today, 1) ? 'tomorrow' : day, time: day ? o.deliver_time : null, hour: Math.floor(min / 60),
      address: withAddress ? address : null, map_url: withAddress ? httpUrl(g.results?.[0]?.map_url, 'map_url', false) : null, note: o.note,
    },
    withAddress, hasAddress: !!address, today, min, supplier: s.results![0],
  };
}
async function preview(env: Env, a: Access, sid: string, id: unknown, lang: string) {
  const { o, lines } = await oneOrder(env, sid, id);
  const m = await msgOpts(env, a, sid, o, lines);
  const s = m.supplier;
  const text = orderMessage(s.lang, m.opts);
  const t = totals(m.opts.lines);
  const todays = slots(s.hours, true, m.min);
  return {
    order: orderView(o, lines, true), text, text_tr: orderTranslation(lang, m.opts), address: m.hasAddress ? { on: m.withAddress } : null,
    days: [{ day: m.today, slots: todays }, { day: addDay(m.today, 1), slots: slots(s.hours, false, 0) }],
    free: freeDelivery(t.sum, s.min_free_delivery), can_open: !!chatUrl(s.channel, s.address, 'x'), can_agent: !!(s.channel && s.channel !== 'phone' && s.address),
    supplier: supplierView(s, true),
  };
}

/** The basket leaves: snapshot of names and prices, the text as it went out. One batch; only from `from` statuses. */
async function leaveBasket(env: Env, a: Access, sid: string, id: unknown, set: { status: string; via: string; sent_by: string; draft_id?: string | null }, from = 'basket') {
  const { o, lines } = await oneOrder(env, sid, id);
  if (o.status !== from) throw new HttpError(409, 'order_changed', `The order is already ${o.status}`);
  if (!lines.length) throw new HttpError(400, 'empty_basket', 'The basket is empty');
  const m = await msgOpts(env, a, sid, o, lines);
  const text = orderMessage(m.supplier.lang, m.opts);
  const t = totals(m.opts.lines);
  const at = now();
  const [u] = await env.DB.batch([
    env.DB.prepare(`UPDATE orders SET status=?1, via=?2, sent_by=?3, draft_id=?4, text=?5, total_est=?6, unknown_n=?7, opened_at=?8, with_address=?9, updated_at=?8 WHERE id=?10 AND status='basket'`)
      .bind(set.status, set.via, set.sent_by, set.draft_id ?? null, text, t.sum || null, t.unknown, at, m.withAddress ? 1 : 0, o.id),
    env.DB.prepare(`UPDATE order_lines SET (price, price_unsure, name_id, name_ru, name_en) = (SELECT i.price, i.price_unsure, i.name_id, i.name_ru, i.name_en FROM supplier_items i WHERE i.id=order_lines.item_id)
      WHERE order_id=?1 AND (SELECT updated_at FROM orders WHERE id=?1)=?2`).bind(o.id, at),
  ]);
  if (!u.meta.changes) throw new HttpError(409, 'order_changed');
  return { o, text, t, supplier: m.supplier };
}
/** Back to collecting ("Не отправил", a rejected draft): into the basket somebody may have started meanwhile, else it is the basket again. */
async function backToBasket(env: Env, o: Row) {
  const t = now();
  const other = await env.DB.prepare("SELECT id FROM orders WHERE supplier_id=? AND status='basket'").bind(o.supplier_id).first<Row>();
  if (!other) {
    await env.DB.prepare(`UPDATE orders SET status='basket', via=NULL, draft_id=NULL, sent_by=NULL, opened_at=NULL, text=NULL, total_est=NULL, unknown_n=NULL, updated_at=?1 WHERE id=?2 AND status IN ('opened','draft')`).bind(t, o.id).run();
    return o.id;
  }
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO order_lines (order_id, item_id, qty, added_by, at) SELECT ?1, l.item_id, l.qty, l.added_by, l.at FROM order_lines l JOIN orders o ON o.id=l.order_id AND o.status IN ('opened','draft')
      WHERE l.order_id=?2 ON CONFLICT(order_id, item_id) DO UPDATE SET qty=MIN(200, qty+excluded.qty)`).bind(other.id, o.id),
    env.DB.prepare(`UPDATE orders SET status='cancelled', cancelled_at=?1, updated_at=?1 WHERE id=?2 AND status IN ('opened','draft')`).bind(t, o.id),
    env.DB.prepare('UPDATE orders SET updated_at=? WHERE id=?').bind(t, other.id),
  ]);
  return other.id as string;
}

// ---------------------------------------------------------------- Mini App

export async function ordersApp(req: Request, env: Env, path: string, user: User): Promise<Response | null> {
  const DB = env.DB;
  const q = new URL(req.url).searchParams;
  if (req.method === 'GET') {
    if (!['/app/api/shop', '/app/api/orders', '/app/api/order', '/app/api/order-preview'].includes(path)) return null;
    const sid = q.get('s') ?? '';
    const a = await member(env, sid, user.id, path === '/app/api/order-preview' ? VOTERS : READERS);
    const full = VOTERS.includes(a.role); // legacy viewers: the catalog and statuses, never the message, the address or the expense
    if (path === '/app/api/shop') return json(await shopView(env, sid, full, a.tz));
    if (path === '/app/api/orders') return json(await ordersView(env, sid, full, a.tz));
    if (path === '/app/api/order-preview') return json(await preview(env, a, sid, q.get('id'), user.lang));
    const { o, lines } = await oneOrder(env, sid, q.get('id'));
    return json({ order: orderView(o, lines, full) });
  }
  if (req.method !== 'POST' || !path.startsWith('/app/api/order-')) return null;
  const b = await body(req);
  const sid = String(b.search_id ?? '');
  const a = await member(env, sid, user.id, VOTERS);
  const view = async (extra: Row = {}) => json({ ...(await ordersView(env, sid, true, a.tz)), ...extra });

  // One line of the shared basket: the absolute quantity (so a retry is harmless); 0 removes it.
  if (path === '/app/api/order-line') {
    await rateLimit(env, 'order-line', user.id, 900);
    const it = await DB.prepare(`SELECT i.id, i.step, i.hidden, i.supplier_id, (SELECT id FROM orders WHERE supplier_id=i.supplier_id AND status='basket') oid,
        (SELECT COUNT(*) FROM order_lines WHERE order_id=(SELECT id FROM orders WHERE supplier_id=i.supplier_id AND status='basket')) n
      FROM supplier_items i JOIN suppliers s ON s.id=i.supplier_id WHERE i.id=? AND s.search_id=? AND s.hidden=0`).bind(String(b.item_id ?? ''), sid).first<Row>();
    if (!it) throw new HttpError(404, 'no_item');
    const qty = cleanQty(b.qty, it.step);
    if (qty == null) throw new HttpError(400, 'bad_qty', 'qty must be a number');
    if (qty > 0 && it.hidden) throw new HttpError(409, 'item_gone', 'The supplier no longer lists this item');
    if (qty > 0 && Number(it.n) >= MAX_LINES) {
      const has = await DB.prepare('SELECT 1 FROM order_lines WHERE order_id=? AND item_id=?').bind(it.oid, it.id).first();
      if (!has) throw new HttpError(409, 'too_many_lines', `Up to ${MAX_LINES} items per order`);
    }
    const t = now();
    if (qty === 0) {
      if (it.oid) await DB.batch([DB.prepare('DELETE FROM order_lines WHERE order_id=? AND item_id=?').bind(it.oid, it.id), DB.prepare('UPDATE orders SET updated_at=? WHERE id=?').bind(t, it.oid)]);
    } else {
      await DB.batch([
        DB.prepare("INSERT OR IGNORE INTO orders (id, search_id, supplier_id, status, created_by, created_at, updated_at) VALUES (?,?,?,'basket',?,?,?)").bind(rid('or_'), sid, it.supplier_id, user.id, t, t),
        DB.prepare(`INSERT INTO order_lines (order_id, item_id, qty, added_by, at) SELECT id, ?1, ?2, ?3, ?4 FROM orders WHERE supplier_id=?5 AND status='basket'
          ON CONFLICT(order_id, item_id) DO UPDATE SET qty=excluded.qty`).bind(it.id, qty, user.id, t, it.supplier_id),
        DB.prepare("UPDATE orders SET updated_at=? WHERE supplier_id=? AND status='basket'").bind(t, it.supplier_id),
      ]);
    }
    return view();
  }
  await rateLimit(env, 'order', user.id, 240);

  if (path === '/app/api/order-again') {
    // "Как в прошлый раз": the last delivered order's lines into the basket (what is there already stays), current prices.
    // With order_id: that order ("Повторить" on a receipt), otherwise the last delivered one (of the supplier).
    const last = b.order_id
      ? await DB.prepare("SELECT o.id FROM orders o JOIN suppliers s ON s.id=o.supplier_id AND s.hidden=0 WHERE o.id=? AND o.search_id=? AND o.status!='basket'").bind(String(b.order_id), sid).first<Row>()
      : await DB.prepare("SELECT o.id FROM orders o JOIN suppliers s ON s.id=o.supplier_id AND s.hidden=0 WHERE o.search_id=? AND o.status='delivered' AND (?2='' OR o.supplier_id=?2) ORDER BY o.delivered_at DESC LIMIT 1")
        .bind(sid, String(b.supplier_id ?? '')).first<Row>();
    if (!last) throw new HttpError(404, 'no_last_order', 'No delivered order yet');
    const su = (await DB.prepare('SELECT supplier_id FROM orders WHERE id=?').bind(last.id).first<Row>())!.supplier_id;
    const t = now();
    await DB.batch([
      DB.prepare("INSERT OR IGNORE INTO orders (id, search_id, supplier_id, status, created_by, created_at, updated_at) VALUES (?,?,?,'basket',?,?,?)").bind(rid('or_'), sid, su, user.id, t, t),
      DB.prepare(`INSERT INTO order_lines (order_id, item_id, qty, added_by, at)
        SELECT (SELECT id FROM orders WHERE supplier_id=?1 AND status='basket'), l.item_id, l.qty, ?2, ?3 FROM order_lines l JOIN supplier_items i ON i.id=l.item_id AND i.hidden=0 WHERE l.order_id=?4
        ON CONFLICT(order_id, item_id) DO NOTHING`).bind(su, user.id, t, last.id),
      DB.prepare("UPDATE orders SET updated_at=? WHERE supplier_id=? AND status='basket'").bind(t, su),
    ]);
    return view({ supplier_id: su });
  }

  // ---- sets ("Наборы")
  if (path === '/app/api/order-set-save') {
    // From the basket or any earlier order of this search: its lines (item + qty) become a set of that supplier.
    const src = await DB.prepare(`SELECT o.id, o.supplier_id, (SELECT COUNT(*) FROM order_lines WHERE order_id=o.id) n, (SELECT COUNT(*) FROM order_sets WHERE search_id=?2) sets
      FROM orders o JOIN suppliers s ON s.id=o.supplier_id AND s.hidden=0 WHERE o.id=?1 AND o.search_id=?2`).bind(String(b.from_order_id ?? ''), sid).first<Row>();
    if (!src) throw new HttpError(404, 'no_order');
    if (!Number(src.n)) throw new HttpError(400, 'empty_basket', 'The basket is empty');
    if (Number(src.sets) >= MAX_SETS) throw new HttpError(409, 'too_many_sets', `Up to ${MAX_SETS} sets per project`);
    const name = setName(b.name), key = nameKey(name);
    const sc = scheduleCols(b, null, a.tz);
    await nameFree(env, sid, key);
    const sid2 = rid('os_'), t = now();
    try {
      await DB.batch([
        DB.prepare(`INSERT INTO order_sets (id, search_id, supplier_id, name, name_key, repeat, days, time, anchor, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
          .bind(sid2, sid, src.supplier_id, name, key, sc.repeat ?? 'none', sc.days ?? 0, sc.time ?? SET_TIME_DEFAULT, sc.anchor ?? null, user.id, t, t),
        DB.prepare('INSERT INTO order_set_lines (set_id, item_id, qty, sort) SELECT ?1, item_id, qty, ROW_NUMBER() OVER (ORDER BY at, item_id) FROM order_lines WHERE order_id=?2').bind(sid2, src.id),
      ]);
    } catch (e) {
      if (/UNIQUE/i.test(String((e as Error)?.message ?? e))) throw new HttpError(409, 'name_taken', 'There is a set with this name already');
      throw e;
    }
    return view({ set_id: sid2 });
  }
  if (path === '/app/api/order-set-edit') {
    const st = await setOf(env, sid, b.set_id);
    const cols = scheduleCols(b, st, a.tz);
    if ('name' in b) { cols.name = setName(b.name); cols.name_key = nameKey(cols.name as string); await nameFree(env, sid, cols.name_key as string, st.id); }
    if (!Object.keys(cols).length) throw new HttpError(400, 'missing', 'nothing to change');
    try {
      await DB.prepare(`UPDATE order_sets SET ${Object.keys(cols).map((k) => `${k}=?`).join(', ')}, updated_at=? WHERE id=?`).bind(...Object.values(cols), now(), st.id).run();
    } catch (e) {
      if (/UNIQUE/i.test(String((e as Error)?.message ?? e))) throw new HttpError(409, 'name_taken', 'There is a set with this name already');
      throw e;
    }
    return view({ set_id: st.id });
  }
  if (path === '/app/api/order-set-delete') {
    const st = await setOf(env, sid, b.set_id);
    await DB.batch([DB.prepare('DELETE FROM order_set_lines WHERE set_id=?').bind(st.id), DB.prepare('DELETE FROM order_sets WHERE id=?').bind(st.id)]);
    return view();
  }
  if (path === '/app/api/order-set-apply') {
    // "В корзину": the set's lines are ADDED to the supplier's basket (what is there stays; the same item keeps the larger
    // quantity), current prices; items the supplier no longer lists are skipped. Then the usual check → send.
    const st = await setOf(env, sid, b.set_id);
    const c = await DB.prepare(`SELECT (SELECT COUNT(*) FROM order_set_lines l JOIN supplier_items i ON i.id=l.item_id AND i.hidden=0 WHERE l.set_id=?1) n,
        (SELECT COUNT(*) FROM order_set_lines l JOIN supplier_items i ON i.id=l.item_id AND i.hidden=1 WHERE l.set_id=?1) gone,
        (SELECT COUNT(*) FROM order_lines WHERE order_id=(SELECT id FROM orders WHERE supplier_id=?2 AND status='basket') AND item_id NOT IN (SELECT item_id FROM order_set_lines WHERE set_id=?1)) other`)
      .bind(st.id, st.supplier_id).first<Row>();
    if (!Number(c?.n)) throw new HttpError(409, 'set_empty', 'Nothing in this set is on the price list any more');
    if (Number(c!.n) + Number(c!.other) > MAX_LINES) throw new HttpError(409, 'too_many_lines', `Up to ${MAX_LINES} items per order`);
    const t = now();
    await DB.batch([
      DB.prepare("INSERT OR IGNORE INTO orders (id, search_id, supplier_id, status, created_by, created_at, updated_at) VALUES (?,?,?,'basket',?,?,?)").bind(rid('or_'), sid, st.supplier_id, user.id, t, t),
      DB.prepare(`INSERT INTO order_lines (order_id, item_id, qty, added_by, at)
        SELECT (SELECT id FROM orders WHERE supplier_id=?1 AND status='basket'), l.item_id, l.qty, ?2, ?3 FROM order_set_lines l JOIN supplier_items i ON i.id=l.item_id AND i.hidden=0 WHERE l.set_id=?4
        ON CONFLICT(order_id, item_id) DO UPDATE SET qty=MAX(qty, excluded.qty)`).bind(st.supplier_id, user.id, t, st.id),
      DB.prepare("UPDATE orders SET updated_at=? WHERE supplier_id=? AND status='basket'").bind(t, st.supplier_id),
    ]);
    return view({ supplier_id: st.supplier_id, set_id: st.id, added: Number(c!.n), gone: Number(c!.gone) });
  }

  const id = String(b.order_id ?? '');
  const o = await DB.prepare(`${ORDER_SQL} WHERE o.id=? AND o.search_id=?`).bind(id, sid).first<Row>();
  if (!o) throw new HttpError(404, 'no_order');

  if (path === '/app/api/order-set') {
    if (o.status !== 'basket') throw new HttpError(409, 'order_changed', `The order is already ${o.status}`);
    const cols: Record<string, unknown> = {};
    const s = await DB.prepare('SELECT hours FROM suppliers WHERE id=?').bind(o.supplier_id).first<Row>();
    const today = localDay(a.tz);
    if ('day' in b) {
      const d = b.day == null || b.day === '' ? null : String(b.day);
      if (d && (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < today || d > addDay(today, 7))) throw new HttpError(400, 'bad_day', 'day must be today … a week ahead');
      cols.deliver_day = d;
      if (!d || !('time' in b)) cols.deliver_time = null;
    }
    if ('time' in b) {
      const d = ('deliver_day' in cols ? cols.deliver_day : o.deliver_day) as string | null;
      const tm = b.time == null || b.time === '' ? null : String(b.time);
      if (tm) {
        if (!d) throw new HttpError(400, 'bad_time', 'Pick the day first');
        const bad = badTime(tm, s?.hours, d === today, localMinutes(a.tz));
        if (bad) throw new HttpError(400, 'bad_time', bad === 'closed' ? `The supplier works ${s?.hours}` : bad === 'past' ? 'This time has passed' : 'time must be HH:MM');
      }
      cols.deliver_time = tm;
    }
    if ('note' in b) cols.note = txt(b.note, 'note', 300);
    if ('with_address' in b) cols.with_address = b.with_address ? 1 : 0;
    if (Object.keys(cols).length) await DB.prepare(`UPDATE orders SET ${Object.keys(cols).map((k) => `${k}=?`).join(', ')}, updated_at=? WHERE id=? AND status='basket'`).bind(...Object.values(cols), now(), id).run();
    return json(await preview(env, a, sid, id, user.lang));
  }
  if (path === '/app/api/order-clear') {
    // The removed lines (qty, who added them) and the note / time stay on the order for RESTORE_MIN minutes: "Вернуть".
    if (o.status !== 'basket') throw new HttpError(409, 'order_changed');
    const t = now();
    const r = await DB.batch([
      DB.prepare(`UPDATE orders SET cleared=json_object('lines', json((SELECT json_group_array(json_object('item_id', item_id, 'qty', qty, 'added_by', added_by, 'at', at)) FROM order_lines WHERE order_id=?1)),
          'note', note, 'day', deliver_day, 'time', deliver_time), cleared_at=?2 WHERE id=?1 AND status='basket' AND EXISTS (SELECT 1 FROM order_lines WHERE order_id=?1)`).bind(id, t),
      DB.prepare("DELETE FROM order_lines WHERE order_id=?1 AND EXISTS (SELECT 1 FROM orders WHERE id=?1 AND status='basket')").bind(id),
      DB.prepare('UPDATE orders SET note=NULL, deliver_day=NULL, deliver_time=NULL, updated_at=? WHERE id=?').bind(t, id),
    ]);
    return view({ cleared: r[0].meta.changes ? { order_id: id, supplier_id: o.supplier_id, n: r[1].meta.changes } : null });
  }
  if (path === '/app/api/order-restore') {
    // "Вернуть": exactly the lines of the last clear (an item added again meanwhile keeps the larger quantity and its adder).
    if (o.status !== 'basket' || !o.cleared) throw new HttpError(409, 'nothing_to_restore', 'Nothing to bring back');
    if (Date.parse(o.cleared_at) < Date.now() - RESTORE_MIN * 60e3) throw new HttpError(409, 'restore_expired', 'Too late to bring it back');
    const c = parseJson<Row>(o.cleared, {});
    const J = (k: string) => `json_extract(j.value,'$.${k}')`;
    const t = now();
    const r = await DB.batch([
      DB.prepare(`INSERT INTO order_lines (order_id, item_id, qty, added_by, at) SELECT ?1, ${J('item_id')}, ${J('qty')}, coalesce(${J('added_by')}, ?3), coalesce(${J('at')}, ?4)
          FROM json_each(?2) j JOIN supplier_items i ON i.id=${J('item_id')} AND i.supplier_id=?5 WHERE true
          ON CONFLICT(order_id, item_id) DO UPDATE SET qty=MAX(qty, excluded.qty)`).bind(id, JSON.stringify(Array.isArray(c.lines) ? c.lines : []), user.id, t, o.supplier_id),
      DB.prepare(`UPDATE orders SET cleared=NULL, cleared_at=NULL, note=coalesce(note, ?1), deliver_day=coalesce(deliver_day, ?2), deliver_time=coalesce(deliver_time, ?3), updated_at=?4 WHERE id=?5 AND status='basket'`)
        .bind(c.note ?? null, c.day ?? null, c.time ?? null, t, id),
    ]);
    return view({ restored: r[0].meta.changes, supplier_id: o.supplier_id });
  }
  if (path === '/app/api/order-open') {
    // The human presses send themselves: we only hand out the link with the text and ask afterwards.
    if (o.status === 'opened') { const url = chatUrl(o.schannel, o.saddress, o.text ?? ''); return json({ url, ...(await ordersView(env, sid, true)) }); }
    if (!chatUrl(o.schannel, o.saddress, 'x')) throw new HttpError(409, 'no_chat', 'This supplier has no WhatsApp or Telegram');
    const r = await leaveBasket(env, a, sid, id, { status: 'opened', via: o.schannel, sent_by: user.id });
    return json({ url: chatUrl(o.schannel, o.saddress, r.text), ...(await ordersView(env, sid, true)) });
  }
  if (path === '/app/api/order-agent') {
    if (o.status !== 'basket') throw new HttpError(409, 'order_changed');
    if (!o.schannel || o.schannel === 'phone' || !o.saddress) throw new HttpError(409, 'no_chat', 'This supplier has no WhatsApp or Telegram');
    const did = rid('d_');
    const r = await leaveBasket(env, a, sid, id, { status: 'draft', via: 'agent', sent_by: user.id, draft_id: did });
    const t = now();
    const c = await contactByAddress(env, a.owner_id, o.schannel, o.saddress);
    const reason = `${o.sname}: ${r.t.count} · ≈ ${r.t.sum} ${o.scurrency}${r.t.unknown ? ` + ${r.t.unknown} ?` : ''} · ${user.display_name}`;
    await DB.prepare(`INSERT INTO drafts (id, search_id, contact_id, listing_id, channel, address, text, kind, reason, status, requested_by, created_at, updated_at) VALUES (?,?,?,NULL,?,?,?,'other',?,'pending',?,?,?)`)
      .bind(did, sid, c, o.schannel, o.saddress, r.text, reason, user.id, t, t).run();
    const draft = await DB.prepare('SELECT * FROM drafts WHERE id=?').bind(did).first<Row>();
    await draftToOwner(env, { id: sid, owner_id: a.owner_id }, draft);
    await event(env, sid, 'order_draft', id, user.id, { order_id: id, supplier: o.sname, draft_id: did, name: user.display_name });
    return view();
  }
  if (path === '/app/api/order-status') {
    const act = String(b.action ?? '');
    const t = now();
    if (act === 'sent') {
      const u = await DB.prepare("UPDATE orders SET status='sent', sent_at=?1, sent_by=?2, updated_at=?1 WHERE id=?3 AND status='opened'").bind(t, user.id, id).run();
      if (!u.meta.changes && o.status !== 'sent') throw new HttpError(409, 'order_changed', `The order is already ${o.status}`);
      if (u.meta.changes) await event(env, sid, 'order_sent', id, user.id, { order_id: id, supplier: o.sname, via: o.via, total_est: o.total_est, name: user.display_name });
      return view();
    }
    if (act === 'not_sent') {
      if (o.status !== 'opened') throw new HttpError(409, 'order_changed', `The order is already ${o.status}`);
      await backToBasket(env, o);
      return view();
    }
    if (act === 'confirm') {
      const total = amount(b.total, 'total');
      const tm = cleanTime(b.time);
      const u = await DB.prepare(`UPDATE orders SET status='confirmed', total_final=coalesce(?1,total_final), deliver_time=coalesce(?2,deliver_time), deliver_day=coalesce(?3,deliver_day), sent_at=coalesce(sent_at,?4), confirmed_at=coalesce(confirmed_at,?4), confirmed_by=coalesce(confirmed_by,?5), updated_at=?4
        WHERE id=?6 AND status IN ('opened','sent','confirmed')`).bind(total, tm, cleanDay(b.day), t, user.id, id).run();
      if (!u.meta.changes) throw new HttpError(409, 'order_changed', `The order is already ${o.status}`);
      await event(env, sid, 'order_confirmed', id, user.id, { order_id: id, supplier: o.sname, total, time: tm, name: user.display_name });
      return view();
    }
    if (act === 'cancel') {
      const u = await DB.batch([
        DB.prepare(`UPDATE orders SET status='cancelled', cancelled_at=?1, updated_at=?1 WHERE id=?2 AND status IN (${ACTIVE_SQL})`).bind(t, id),
        // A draft that has not gone out yet must not go out any more.
        DB.prepare("UPDATE drafts SET status='rejected', updated_at=? WHERE id=? AND status IN ('pending','approved','edited')").bind(t, o.draft_id ?? ''),
      ]);
      if (!u[0].meta.changes && o.status !== 'cancelled') throw new HttpError(409, 'order_changed', `The order is already ${o.status}`);
      if (u[0].meta.changes) await event(env, sid, 'order_cancelled', id, user.id, { order_id: id, supplier: o.sname, was: o.status, name: user.display_name });
      return view();
    }
    if (act === 'delivered') { await deliver(env, a, sid, o, b, user); return json({ ...(await ordersView(env, sid, true)), delivered: id }); }
    throw new HttpError(400, 'bad_action', 'action must be sent, not_sent, confirm, delivered or cancel');
  }
  return null;
}
const cleanTime = (v: unknown) => {
  if (v == null || v === '') return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v))) throw new HttpError(400, 'bad_time', 'time must be HH:MM');
  return String(v);
};
const cleanDay = (v: unknown) => {
  if (v == null || v === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || Number.isNaN(Date.parse(String(v)))) throw new HttpError(400, 'bad_day', 'day must be YYYY-MM-DD');
  return String(v);
};

/** "Привезли, оплатил": one expense (kind food, payer = who tapped, split as usual / the common wallet), the order is done. */
async function deliver(env: Env, a: Access, sid: string, o: Row, b: Row, user: User) {
  if (o.status === 'delivered') return; // a second tap (or a second phone): nothing more happens
  const CAN = "status IN ('opened','sent','confirmed')";
  if (!['opened', 'sent', 'confirmed'].includes(o.status)) throw new HttpError(409, 'order_changed', `The order is already ${o.status}`);
  const total = amount(b.total, 'total') ?? o.total_final ?? (o.unknown_n ? null : o.total_est);
  if (!total) throw new HttpError(400, 'need_total', 'How much did you pay? Some prices were not known');
  const { lines } = await oneOrder(env, sid, o.id);
  const names = lines.map((l) => lineView(l, false)).map((l) => (user.lang === 'en' ? l.name_en : l.name_ru));
  const title = `${o.sname}: ${names.join(', ')}`;
  const t = now(), eid = rid('x_');
  const r = await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO expenses (id, search_id, title, amount, currency, date, paid_by, split, kind, method, note, receipt, created_by, created_at, updated_at, order_id)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, 'food', NULL, NULL, NULL, ?7, ?8, ?8, id FROM orders WHERE id=?9 AND ${CAN}`)
      .bind(eid, sid, title.length > 120 ? title.slice(0, 119) + '…' : title, total, o.scurrency, localDay(a.tz), user.id, t, o.id),
    env.DB.prepare(`UPDATE supplier_items SET fav=fav+1 WHERE id IN (SELECT item_id FROM order_lines WHERE order_id=?1) AND EXISTS (SELECT 1 FROM orders WHERE id=?1 AND ${CAN})`).bind(o.id),
    env.DB.prepare(`UPDATE orders SET status='delivered', delivered_at=?1, paid_by=?2, total_final=?3, sent_at=coalesce(sent_at,?1), expense_id=(SELECT id FROM expenses WHERE order_id=?4), updated_at=?1 WHERE id=?4 AND ${CAN}`).bind(t, user.id, total, o.id),
  ]);
  if (!r[2].meta.changes) return; // somebody else was first
  if (r[0].meta.changes) await event(env, sid, 'expense', eid, user.id, { title, amount: total, currency: o.scurrency, paid_by: user.id, kind: 'food' });
  await event(env, sid, 'order_delivered', o.id, user.id, { order_id: o.id, supplier: o.sname, total, name: user.display_name });
}

/** The draft of an order was decided or went out (Mini App, bot, agent PATCH): rejected / failed → collecting again, sent → waiting. */
export async function orderDraft(env: Env, draftId: string, status: string) {
  const o = await env.DB.prepare("SELECT * FROM orders WHERE draft_id=? AND status='draft'").bind(draftId).first<Row>();
  if (!o) return;
  if (status === 'rejected' || status === 'failed') { await backToBasket(env, o); return; }
  if (status === 'sent') {
    const t = now();
    await env.DB.prepare("UPDATE orders SET status='sent', sent_at=?1, updated_at=?1, text=coalesce((SELECT coalesce(edited_text, text) FROM drafts WHERE id=?2), text) WHERE id=?3 AND status='draft'").bind(t, draftId, o.id).run();
    await event(env, o.search_id, 'order_sent', o.id, 'agent', { order_id: o.id, via: 'agent', total_est: o.total_est });
  }
}

// ---------------------------------------------------------------- agent API

const supplierCols = (b: Row, full: boolean) => {
  const c: Record<string, unknown> = {};
  const has = (k: string) => full || k in b;
  if (has('name')) { c.name = txt(b.name, 'name', 80); if (!c.name) throw new HttpError(400, 'missing', 'name is required'); }
  if ('kind' in b) { if (!KINDS.includes(String(b.kind))) throw new HttpError(400, 'bad_kind', `kind must be one of ${KINDS.join(', ')}`); c.kind = b.kind; }
  if ('channel' in b) { if (b.channel != null && !CHANNELS.includes(String(b.channel))) throw new HttpError(400, 'bad_channel', `channel must be one of ${CHANNELS.join(', ')}`); c.channel = b.channel ?? null; }
  if ('address' in b) c.address = b.address == null ? null : String(b.address).trim().slice(0, 80) || null;
  if ('hours' in b) { const hrs = b.hours == null || b.hours === '' ? null : String(b.hours).replace(/\s/g, ''); if (hrs && !parseHours(hrs)) throw new HttpError(400, 'bad_hours', "hours must be 'HH:MM-HH:MM'"); c.hours = hrs; }
  if ('min_free_delivery' in b) c.min_free_delivery = amount(b.min_free_delivery, 'min_free_delivery');
  if ('delivery_fee' in b) c.delivery_fee = amount(b.delivery_fee, 'delivery_fee'); // under min_free_delivery; NULL = not known
  for (const k of ['delivery_note_ru', 'delivery_note_en', 'note_ru', 'note_en']) if (k in b) c[k] = txt(b[k], k, 200);
  if ('lang' in b) { if (!['id', 'en'].includes(String(b.lang))) throw new HttpError(400, 'bad_lang', 'lang must be id or en'); c.lang = b.lang; }
  if ('currency' in b) { const cur = String(b.currency ?? '').toUpperCase(); if (!/^[A-Z]{3}$/.test(cur)) throw new HttpError(400, 'bad_currency'); c.currency = cur; }
  if ('sort' in b) c.sort = Math.trunc(Number(b.sort)) || 0;
  if ('hidden' in b) c.hidden = b.hidden ? 1 : 0;
  return c;
};

/** Upsert by name_id in three statements whatever the size (json_each): the price history, the known items, the new ones. `full` hides what the list no longer has. */
async function importItems(env: Env, su: Row, b: Row) {
  let items;
  try { items = parseImport(b.items, b.price_at == null ? null : String(b.price_at)); } catch (e) { throw new HttpError(400, 'bad_items', String((e as Error).message)); }
  const sn = sensitive(items.map((i) => `${i.name_id} ${i.name_ru ?? ''} ${i.name_en ?? ''}`).join('\n'));
  if (sn) throw new HttpError(400, 'sensitive', `items: ${sn}`);
  const t = now();
  const data = JSON.stringify(items.map((i) => ({ ...i, id: rid('si_') })));
  const COLS = ['name_id', 'name_ru', 'name_en', 'grp', 'unit', 'step', 'price', 'has_price', 'price_unsure', 'by_request', 'price_at', 'toy', 'top', 'sort', 'hidden'];
  const J = (k: string) => `json_extract(j.value,'$.${k}')`;
  const stmts = [
    env.DB.prepare(`SELECT name_id, price, hidden FROM supplier_items WHERE supplier_id=?`).bind(su.id),
    env.DB.prepare(`INSERT INTO supplier_prices (item_id, old_price, new_price, at) SELECT i.id, i.price, ${J('price')}, ?3 FROM json_each(?1) j JOIN supplier_items i ON i.supplier_id=?2 AND i.name_id=${J('name_id')}
      WHERE ${J('has_price')}=1 AND i.price IS NOT ${J('price')}`).bind(data, su.id, t),
    env.DB.prepare(`UPDATE supplier_items SET name_ru=coalesce(j.name_ru, supplier_items.name_ru), name_en=coalesce(j.name_en, supplier_items.name_en), grp=coalesce(j.grp, supplier_items.grp),
        unit=coalesce(j.unit, supplier_items.unit), step=coalesce(j.step, supplier_items.step), toy=coalesce(j.toy, supplier_items.toy), top=coalesce(j.top, supplier_items.top), sort=coalesce(j.sort, supplier_items.sort),
        price=CASE j.has_price WHEN 1 THEN j.price ELSE supplier_items.price END, price_unsure=CASE j.has_price WHEN 1 THEN j.price_unsure ELSE supplier_items.price_unsure END,
        by_request=coalesce(j.by_request, supplier_items.by_request), price_at=CASE j.has_price WHEN 1 THEN coalesce(j.price_at, supplier_items.price_at) ELSE supplier_items.price_at END, hidden=j.hidden, updated_at=?3
      FROM (SELECT ${COLS.map((k) => `${J(k)} ${k}`).join(', ')} FROM json_each(?1) j) j WHERE supplier_items.supplier_id=?2 AND supplier_items.name_id=j.name_id`).bind(data, su.id, t),
    env.DB.prepare(`INSERT OR IGNORE INTO supplier_items (id, supplier_id, name_id, name_ru, name_en, grp, unit, step, price, price_unsure, by_request, price_at, toy, top, fav, sort, hidden, created_at, updated_at)
      SELECT ${J('id')}, ?2, ${J('name_id')}, coalesce(${J('name_ru')}, ${J('name_en')}, ${J('name_id')}), coalesce(${J('name_en')}, ${J('name_id')}), coalesce(${J('grp')},'other'), coalesce(${J('unit')},'kg'),
        coalesce(${J('step')},0.5), ${J('price')}, ${J('price_unsure')}, coalesce(${J('by_request')},0), ${J('price_at')}, ${J('toy')}, ${J('top')}, 0, coalesce(${J('sort')},9999), ${J('hidden')}, ?3, ?3 FROM json_each(?1) j`).bind(data, su.id, t),
  ];
  if (b.full) stmts.push(env.DB.prepare(`UPDATE supplier_items SET hidden=1, updated_at=?3 WHERE supplier_id=?2 AND hidden=0 AND name_id NOT IN (SELECT ${J('name_id')} FROM json_each(?1) j)`).bind(data, su.id, t));
  const r = await env.DB.batch<Row>(stmts);
  const old = new Map((r[0].results ?? []).map((x) => [x.name_id as string, x]));
  const changes = items.filter((i) => i.has_price && old.has(i.name_id) && old.get(i.name_id)!.price !== i.price).map((i) => ({ name_id: i.name_id, from: old.get(i.name_id)!.price, to: i.price }));
  const names = new Set(items.map((i) => i.name_id));
  return {
    imported: items.length, created: items.filter((i) => !old.has(i.name_id)).length, price_changes: changes.slice(0, 60), price_changes_n: changes.length,
    hidden: b.full ? r[4].meta.changes : 0, missing: b.full ? [] : [...old.values()].filter((x) => !x.hidden && !names.has(x.name_id)).map((x) => x.name_id).slice(0, 60),
  };
}

/** /api/searches/:id/suppliers[/:spid[/import|/catalog]], /api/searches/:id/orders[/:oid]. `s` is the caller's own search. */
export async function ordersAgent(req: Request, env: Env, p: string[], s: { id: string; owner_id: string; brief?: any }): Promise<Response | null> {
  const m = req.method;
  const DB = env.DB;
  const supplierOf = async (id: string) => {
    const su = await DB.prepare('SELECT * FROM suppliers WHERE id=? AND search_id=?').bind(id, s.id).first<Row>();
    if (!su) throw new HttpError(404, 'no_supplier', `Supplier ${id} is not in this search`);
    return su;
  };
  if (p[3] === 'suppliers') {
    if (p.length === 4 && m === 'GET') {
      const r = await DB.prepare('SELECT s.*, (SELECT COUNT(*) FROM supplier_items WHERE supplier_id=s.id AND hidden=0) items, (SELECT MAX(price_at) FROM supplier_items WHERE supplier_id=s.id) price_at FROM suppliers s WHERE s.search_id=? ORDER BY s.sort, s.created_at').bind(s.id).all<Row>();
      return json({ suppliers: r.results ?? [] });
    }
    if (p.length === 5 && m === 'PUT') {
      const b = await body(req);
      const cols = supplierCols(b, p[4] === 'new');
      if ('dir_entry_id' in b) {
        if (b.dir_entry_id == null || b.dir_entry_id === '') cols.dir_entry_id = null;
        else {
          const d = await DB.prepare('SELECT * FROM directory WHERE id=? AND search_id=?').bind(String(b.dir_entry_id), s.id).first<Row>();
          if (!d) throw new HttpError(404, 'no_entry', `Directory entry ${b.dir_entry_id} is not in this search`);
          cols.dir_entry_id = d.id;
          // The contact card already knows the channel: take it unless the call says otherwise.
          if (!('channel' in b) && CHANNELS.includes(d.channel)) cols.channel = d.channel;
          if (!('address' in b) && (d.address || d.phone)) cols.address = d.address ?? d.phone;
        }
      }
      const t = now();
      let id = p[4];
      if (id === 'new') {
        id = rid('su_');
        const all: Record<string, unknown> = { kind: 'other', lang: 'id', currency: String(s.brief?.currency ?? (await packData(env))?.[countryOf((s as any).region)]?.currency ?? 'USD').toUpperCase(), sort: 0, hidden: 0, ...cols, id, search_id: s.id, created_at: t, updated_at: t };
        await DB.prepare(`INSERT INTO suppliers (${Object.keys(all).join(',')}) VALUES (${Object.keys(all).map(() => '?').join(',')})`).bind(...Object.values(all)).run();
      } else {
        await supplierOf(id);
        if (!Object.keys(cols).length) throw new HttpError(400, 'missing', 'nothing to change');
        await DB.prepare(`UPDATE suppliers SET ${Object.keys(cols).map((k) => `${k}=?`).join(', ')}, updated_at=? WHERE id=?`).bind(...Object.values(cols), t, id).run();
      }
      return json({ supplier: await supplierOf(id) }, p[4] === 'new' ? 201 : 200);
    }
    if (p.length === 6 && p[5] === 'import' && m === 'POST') {
      const su = await supplierOf(p[4]);
      const r = await importItems(env, su, await body(req));
      await event(env, s.id, 'catalog_imported', su.id, 'agent', { supplier: su.name, imported: r.imported, created: r.created, price_changes: r.price_changes_n });
      return json(r);
    }
    if (p.length === 6 && p[5] === 'catalog' && m === 'GET') {
      const su = await supplierOf(p[4]);
      const [it, pr] = await DB.batch<Row>([
        DB.prepare('SELECT id, name_id, name_ru, name_en, grp, unit, step, price, price_unsure, by_request, price_at, toy, top, fav, sort, hidden FROM supplier_items WHERE supplier_id=? ORDER BY sort, name_id').bind(su.id),
        DB.prepare('SELECT i.name_id, h.old_price, h.new_price, h.at FROM supplier_prices h JOIN supplier_items i ON i.id=h.item_id WHERE i.supplier_id=? ORDER BY h.id DESC LIMIT 60').bind(su.id),
      ]);
      return json({ supplier: su, items: it.results ?? [], price_history: pr.results ?? [], units: UNITS });
    }
    return null;
  }
  if (p[3] === 'sets' && p.length === 4 && m === 'GET') {
    // Read-only for the agent: the members' saved baskets and their reminders (the agent never edits sets or orders).
    const v = await ordersView(env, s.id, true, searchTzOf(s));
    const su = new URL(req.url).searchParams.get('supplier_id');
    return json({ sets: su ? v.sets.filter((x) => x.supplier_id === su) : v.sets });
  }
  if (p[3] === 'orders') {
    if (p.length === 4 && m === 'GET') {
      const v = await ordersView(env, s.id, true);
      const st = new URL(req.url).searchParams.get('status');
      const all = [...v.baskets, ...v.active, ...v.history];
      return json({ orders: st ? all.filter((o) => o.status === st) : all });
    }
    if (p.length === 5 && m === 'PATCH') {
      const b = await body(req);
      const { o } = await oneOrder(env, s.id, p[4]);
      const total = amount(b.total, 'total'), tm = cleanTime(b.deliver_time), day = cleanDay(b.deliver_day), reply = txt(b.reply, 'reply', 1000), reply_tr = txt(b.reply_tr, 'reply_tr', 1000);
      const status = b.status == null ? null : String(b.status);
      // The agent records what the supplier said. Collecting, "delivered" and the money belong to the members.
      if (status && !['sent', 'confirmed', 'cancelled'].includes(status)) throw new HttpError(400, 'bad_status', 'status must be sent, confirmed or cancelled (members order, receive and pay themselves)');
      if (!ACTIVE.includes(o.status)) throw new HttpError(409, 'order_changed', `The order is ${o.status}`);
      if (status === 'sent' && o.status === 'confirmed') throw new HttpError(409, 'order_changed', 'The order is already confirmed');
      const next = status ?? o.status;
      const t = now();
      await DB.prepare(`UPDATE orders SET status=?1, total_final=coalesce(?2,total_final), deliver_time=coalesce(?3,deliver_time), deliver_day=coalesce(?4,deliver_day), reply=coalesce(?5,reply), reply_tr=coalesce(?6,reply_tr),
          sent_at=CASE WHEN ?1 IN ('sent','confirmed') THEN coalesce(sent_at,?7) ELSE sent_at END, confirmed_at=CASE WHEN ?1='confirmed' THEN coalesce(confirmed_at,?7) ELSE confirmed_at END,
          confirmed_by=CASE WHEN ?1='confirmed' THEN coalesce(confirmed_by,'agent') ELSE confirmed_by END, cancelled_at=CASE WHEN ?1='cancelled' THEN ?7 ELSE cancelled_at END, updated_at=?7
        WHERE id=?8 AND status=?9`).bind(next, total, tm, day, reply, reply_tr, t, o.id, o.status).run();
      if (next === 'cancelled' && o.draft_id) await DB.prepare("UPDATE drafts SET status='rejected', updated_at=? WHERE id=? AND status IN ('pending','approved','edited')").bind(t, o.draft_id).run();
      if (next !== o.status) {
        await event(env, s.id, `order_${next}`, o.id, 'agent', { order_id: o.id, supplier: o.sname, total: total ?? o.total_final });
        if (next === 'confirmed') {
          const sum = total ?? o.total_final, when = tm ?? o.deliver_time;
          await dmMembers(env, s.id, (lang) => ({
            text: lang === 'en' ? `🧺 <b>${h(o.sname)}</b> confirmed the order${sum ? `: ${sum} ${o.scurrency}` : ''}${when ? `, ${when}` : ''}` : `🧺 <b>${h(o.sname)}</b> подтвердил заказ${sum ? `: ${sum} ${o.scurrency}` : ''}${when ? `, к ${when}` : ''}`,
            buttons: [[{ text: lang === 'en' ? 'Open' : 'Открыть', web_app: { url: appUrl(env, `/s/${s.id}/order/${o.id}`) } }]],
          }), { quiet: 'postpone', key: `ordok:${o.id}`, votersOnly: true });
        }
      }
      const f = await oneOrder(env, s.id, o.id);
      return json({ order: orderView(f.o, f.lines, true) });
    }
  }
  return null;
}
