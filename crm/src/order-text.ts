// Wave 10 · pure parts of the orders (no D1, no Env): quantities and steps, totals, the free-delivery bar, delivery slots, the
// message to the supplier (Indonesian or English) with its translation, the wa.me link, the price-list import validation.
// Checked by scripts/test-wave10-pure.mts (node --experimental-strip-types).

export const UNITS = ['kg', 'pcs', 'pack', 'bunch', '30pcs'] as const;
export type Unit = (typeof UNITS)[number];
export const MAX_QTY = 200;

/** A quantity on the item's step: 0 and below → 0 (the line goes away), otherwise at least one step, at most MAX_QTY. */
export function cleanQty(v: unknown, step: number): number | null {
  const n = Number(v);
  if (v == null || v === '' || !Number.isFinite(n)) return null;
  if (n <= 0) return 0;
  const s = step > 0 ? step : 1;
  return Math.min(MAX_QTY, Math.round(Math.max(1, Math.round(n / s)) * s * 100) / 100);
}

export interface Line { name_id: string; name_ru: string; name_en: string; unit: string; qty: number; price: number | null; unsure?: boolean }
export const lineSum = (l: { qty: number; price: number | null }) => (l.price == null ? null : Math.round(l.qty * l.price));
/** Priced lines are summed; lines without a price are only counted ("+ цену узнаём"). */
export function totals(lines: { qty: number; price: number | null; unsure?: boolean }[]) {
  let sum = 0, unknown = 0, unsure = 0;
  for (const l of lines) { const s = lineSum(l); if (s == null) unknown++; else { sum += s; if (l.unsure) unsure++; } }
  return { count: lines.length, sum, unknown, unsure };
}
export function freeDelivery(sum: number, min: number | null | undefined) {
  if (!min || min <= 0) return null;
  return { min, left: Math.max(0, min - sum), reached: sum >= min, pct: Math.max(0, Math.min(100, Math.round((sum / min) * 100))) };
}

// ---------------------------------------------------------------- delivery time

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const toMin = (s: string) => { const m = String(s).match(HM); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
export const toHM = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
/** 'HH:MM-HH:MM' (also with an en dash) → minutes; null when it is not a same-day range. */
export function parseHours(s: string | null | undefined): [number, number] | null {
  const m = String(s ?? '').replace(/\s/g, '').match(/^(\d{1,2}:\d{2})[-–](\d{1,2}:\d{2})$/);
  if (!m) return null;
  const a = toMin(m[1].padStart(5, '0')), b = toMin(m[2].padStart(5, '0'));
  return a != null && b != null && b > a ? [a, b] : null;
}
export const DEFAULT_HOURS: [number, number] = [9 * 60, 19 * 60]; // only for the pills, when the supplier's hours are not known
export const LEAD_MIN = 60; // today: not earlier than an hour from now
/** "к HH:00" slots for a day, every 2 hours inside the supplier's hours; today only the ones still possible. */
export function slots(hours: string | null | undefined, isToday: boolean, nowMin: number): string[] {
  const [a, b] = parseHours(hours) ?? DEFAULT_HOURS;
  const out: string[] = [];
  for (let t = Math.ceil((a + 60) / 60) * 60; t <= b; t += 120) if (!isToday || t >= nowMin + LEAD_MIN) out.push(toHM(t));
  return out;
}
/** null when the time is fine, else the reason. */
export function badTime(time: string, hours: string | null | undefined, isToday: boolean, nowMin: number): 'format' | 'closed' | 'past' | null {
  const t = toMin(time);
  if (t == null) return 'format';
  const h = parseHours(hours);
  if (h && (t < h[0] || t > h[1])) return 'closed';
  if (isToday && t < nowMin) return 'past';
  return null;
}

// ---------------------------------------------------------------- the message

const comma = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');
const dot = (n: number) => String(Math.round(n * 100) / 100);
const QTY_ID: Record<string, (q: number) => string> = { kg: (q) => `${comma(q)} kg`, pcs: (q) => comma(q), pack: (q) => `${comma(q)} pak`, bunch: (q) => `${comma(q)} ikat`, '30pcs': (q) => `${comma(q)} rak isi 30` };
const QTY_EN: Record<string, (q: number) => string> = { kg: (q) => `${dot(q)} kg`, pcs: (q) => `${dot(q)} ×`, pack: (q) => `${dot(q)} ${q === 1 ? 'pack' : 'packs'}`, bunch: (q) => `${dot(q)} ${q === 1 ? 'bunch' : 'bunches'}`, '30pcs': (q) => `${dot(q)} ${q === 1 ? 'tray' : 'trays'} of 30` };
const QTY_RU: Record<string, (q: number) => string> = { kg: (q) => `${comma(q)} кг`, pcs: (q) => `${comma(q)} шт`, pack: (q) => `${comma(q)} уп`, bunch: (q) => `${comma(q)} пуч`, '30pcs': (q) => `${comma(q)} × 30 шт` };
const qty = (m: Record<string, (q: number) => string>, l: Line) => (m[l.unit] ?? m.pcs)(l.qty);
export const qtyRu = (l: Line) => qty(QTY_RU, l);

export interface MsgOpts { lines: Line[]; day: 'today' | 'tomorrow' | string | null; time: string | null; hour: number; address?: string | null; map_url?: string | null; note?: string | null; delivery?: boolean }
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const ddmm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

/** What goes to the supplier. Names are exactly the ones from their list. */
export function orderMessage(lang: string, o: MsgOpts): string {
  const id = lang !== 'en';
  const list = o.lines.map((l) => `- ${qty(id ? QTY_ID : QTY_EN, l)} ${oneLine(l.name_id)}`);
  const out: string[] = [];
  if (id) {
    const g = o.hour < 11 ? 'pagi' : o.hour < 15 ? 'siang' : o.hour < 18 ? 'sore' : 'malam';
    out.push(`Halo, selamat ${g}. Saya mau pesan:`, ...list);
    const day = o.day === 'today' ? 'hari ini' : o.day === 'tomorrow' ? 'besok' : o.day ? `tanggal ${ddmm(o.day)}` : null;
    const tm = o.time ? ` jam ${o.time.replace(':', '.')}` : '';
    out.push(day ? `Bisa diantar ${day}${tm}?` : 'Kapan bisa diantar?');
    if (o.address) out.push(`Alamat: ${oneLine(o.address)}`);
    if (o.address && o.map_url) out.push(`Lokasi: ${o.map_url}`);
    if (o.note) out.push(`Catatan: ${oneLine(o.note)}`);
    out.push('Total berapa dengan ongkir? Bayar di tempat ya. Terima kasih');
  } else {
    out.push('Hello, I would like to order:', ...list);
    const day = o.day === 'today' ? 'today' : o.day === 'tomorrow' ? 'tomorrow' : o.day ? `on ${ddmm(o.day)}` : null;
    out.push(day ? `Can you deliver ${day}${o.time ? ` at ${o.time}` : ''}?` : 'When can you deliver?');
    if (o.address) out.push(`Address: ${oneLine(o.address)}`);
    if (o.address && o.map_url) out.push(`Location: ${o.map_url}`);
    if (o.note) out.push(`Note: ${oneLine(o.note)}`);
    out.push('What is the total with delivery? Cash on delivery. Thank you');
  }
  return out.join('\n');
}
/** The same message for the members, in their language. */
export function orderTranslation(lang: string, o: MsgOpts): string {
  const ru = lang !== 'en';
  const list = o.lines.map((l) => (ru ? `${qty(QTY_RU, l)} ${l.name_ru}` : `${qty(QTY_EN, l)} ${l.name_en}`)).join(ru ? '; ' : '; ');
  const out: string[] = [ru ? `Здравствуйте, хочу заказать: ${list}.` : `Hello, I would like to order: ${list}.`];
  const day = o.day === 'today' ? (ru ? 'сегодня' : 'today') : o.day === 'tomorrow' ? (ru ? 'завтра' : 'tomorrow') : o.day ? ddmm(o.day) : null;
  if (ru) out.push(day ? `Привезёте ${day}${o.time ? ` к ${o.time}` : ''}?` : 'Когда сможете привезти?');
  else out.push(day ? `Can you deliver ${day}${o.time ? ` by ${o.time}` : ''}?` : 'When can you deliver?');
  if (o.address) out.push(ru ? `Адрес: ${oneLine(o.address)}.` : `Address: ${oneLine(o.address)}.`);
  if (o.note) out.push(ru ? `Пометка: ${oneLine(o.note)}.` : `Note: ${oneLine(o.note)}.`);
  out.push(ru ? 'Сколько всего с доставкой? Заплатим на месте. Спасибо' : 'What is the total with delivery? We pay on delivery. Thank you');
  return out.join(' ');
}
/** A link that opens the chat with the text ready; the human presses send. null = this channel has no such link. */
export function chatUrl(channel: string | null | undefined, address: string | null | undefined, text: string): string | null {
  const a = String(address ?? '').trim();
  if (!a) return null;
  if (channel === 'whatsapp') { const n = a.replace(/\D/g, ''); return n.length >= 8 ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null; }
  if (channel === 'telegram') { const u = a.replace(/^@/, ''); return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(u) ? `https://t.me/${u}?text=${encodeURIComponent(text)}` : null; }
  // Viber takes no text in the link (best effort); LINE: an official account opens with the text, a person only through the share sheet.
  if (channel === 'viber') { const n = a.replace(/\D/g, ''); return n.length >= 8 ? `viber://chat?number=%2B${n}` : null; }
  if (channel === 'line') return /^@[a-z0-9._-]{2,40}$/i.test(a) ? `https://line.me/R/oaMessage/${encodeURIComponent(a)}/?${encodeURIComponent(text)}` : `https://line.me/R/share?text=${encodeURIComponent(text)}`;
  return null;
}

// ---------------------------------------------------------------- price-list import

export interface ImportItem {
  name_id: string; name_ru: string | null; name_en: string | null; grp: string | null; unit: Unit | null; step: number | null; price: number | null; has_price: 0 | 1;
  price_unsure: 0 | 1; by_request: 0 | 1 | null; price_at: string | null; toy: string | null; top: number | null; sort: number | null; hidden: 0 | 1;
}
const clean = (v: unknown, max: number) => { const s = v == null ? '' : String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(); return s ? s.slice(0, max) : null; };

/** Validates an import; throws Error('items[3]: …') with a message a human can act on. Absent fields stay null (the old value is kept). */
export function parseImport(items: unknown, priceAt: string | null): ImportItem[] {
  if (!Array.isArray(items) || !items.length) throw new Error('items must be a non-empty list');
  if (items.length > 500) throw new Error('at most 500 items per import');
  const seen = new Set<string>();
  return items.map((x: any, i) => {
    const at = (m: string) => new Error(`items[${i}]: ${m}`);
    if (!x || typeof x !== 'object') throw at('must be an object');
    const name_id = clean(x.name_id, 120);
    if (!name_id) throw at('name_id (the name as in the list) is required');
    if (seen.has(name_id)) throw at(`duplicate name_id "${name_id}"`);
    seen.add(name_id);
    const unit = x.unit == null ? null : String(x.unit);
    if (unit && !(UNITS as readonly string[]).includes(unit)) throw at(`unit must be one of ${UNITS.join(', ')}`);
    const step = x.step == null ? (unit ? (unit === 'kg' ? 0.5 : 1) : null) : Number(x.step);
    if (step != null && !(step > 0 && step <= 50)) throw at('step must be 0..50');
    let price: number | null = null;
    if (x.price != null && x.price !== '') {
      price = Math.round(Number(x.price));
      if (!Number.isFinite(price) || price < 0 || price > 1e9) throw at('price must be a number in main units');
      if (price === 0) price = null; // "0,00" in a list = no price
    }
    const grp = x.grp == null ? null : String(x.grp);
    if (grp && !/^[a-z0-9_]{1,24}$/.test(grp)) throw at('grp must be a short latin key');
    const toy = x.toy == null ? null : String(x.toy);
    if (toy && !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(toy)) throw at('toy must be a goods slug');
    const d = x.price_at ?? priceAt;
    if (d != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(d))) throw at('price_at must be YYYY-MM-DD');
    const int = (v: unknown, lo: number, hi: number, f: string) => { if (v == null || v === '') return null; const n = Number(v); if (!Number.isInteger(n) || n < lo || n > hi) throw at(`${f} must be ${lo}..${hi}`); return n; };
    return {
      name_id, name_ru: clean(x.name_ru, 80), name_en: clean(x.name_en, 80), grp, unit: unit as Unit | null, step, price, has_price: 'price' in x || x.by_request ? 1 : 0,
      price_unsure: x.price_unsure ? 1 : 0, by_request: 'by_request' in x ? (x.by_request ? 1 : 0) : 'price' in x ? 0 : null, price_at: d == null ? null : String(d), toy, top: int(x.top, 1, 99, 'top'), sort: int(x.sort, 0, 9999, 'sort'), hidden: x.hidden ? 1 : 0,
    };
  });
}
