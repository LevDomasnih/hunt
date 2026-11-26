// Orders · pure parts of "Наборы" (saved baskets) — no D1, no Env: names, the repeat schedule (weekly / every 2 weeks on
// chosen weekdays at a local time), the next occurrence, when the cron reminds, the money range of a set (a port of
// public/app.js ordSpread / ordRangeTxt: the Mini App and the Telegram reminder must show the same numbers) and the reminder.
// Checked by scripts/test-order-sets-pure.mts (node --experimental-strip-types), incl. parity with the client's code.

export const SET_NAME_MAX = 40;
export const REPEATS = ['none', 'weekly', 'biweekly'] as const;
export type Repeat = (typeof REPEATS)[number];
export const SET_TIME_DEFAULT = '09:00';
/** The reminder still goes out this long after its time (a missed tick), never on another day. */
export const DUE_WINDOW_MIN = 180;

/** Unique per search, case-insensitive: "Фрукты  на НЕДЕЛЮ" = "фрукты на неделю"; ё = е. */
export const nameKey = (s: string) => s.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

/** A sensible first name for a set of this supplier; "… 2", "… 3" when taken. */
export function defaultSetName(kind: string | null | undefined, supplier: string, lang: string, taken: Set<string> = new Set()): string {
  const ru = lang !== 'en';
  const base = kind === 'fruit' ? (ru ? 'Фрукты на неделю' : 'Fruit for the week') : kind === 'fish' ? (ru ? 'Рыба на ужин' : 'Fish for dinner')
    : (ru ? `${supplier}: как обычно` : `${supplier}, the usual`).slice(0, SET_NAME_MAX);
  let name = base;
  for (let n = 2; taken.has(nameKey(name)) && n < 100; n++) name = `${base.slice(0, SET_NAME_MAX - String(n).length - 1)} ${n}`;
  return name;
}

// ---------------------------------------------------------------- schedule (days: bitmask, 1 = Monday … 64 = Sunday)

export interface Schedule { repeat: string; days: number; time: string; anchor?: string | null }
export const addDay = (day: string, n: number) => new Date(Date.parse(day + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
/** 0 = Monday … 6 = Sunday. */
export const wdIdx = (day: string) => (new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7;
export const mondayOf = (day: string) => addDay(day, -wdIdx(day));
export const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
export const isTime = (v: unknown) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
export const isDays = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 127;

/** Does the schedule fire on this local day (weekday, and for "every 2 weeks" the week of the anchor ± 2k)? */
export function firesOn(s: Schedule, day: string): boolean {
  if (s.repeat !== 'weekly' && s.repeat !== 'biweekly') return false;
  if (!(s.days & (1 << wdIdx(day)))) return false;
  if (s.repeat === 'biweekly') {
    if (!s.anchor) return false;
    const weeks = Math.round((Date.parse(mondayOf(day)) - Date.parse(mondayOf(s.anchor))) / (7 * 864e5));
    return ((weeks % 2) + 2) % 2 === 0;
  }
  return true;
}

/** The next reminder from now (local `today`, minutes `nowMin`): today only when its time is still ahead. */
export function nextOccurrence(s: Schedule, today: string, nowMin: number): { day: string; time: string } | null {
  if (!isTime(s.time) || !s.days) return null;
  for (let i = 0; i < 22; i++) {
    const day = addDay(today, i);
    if (i === 0 && toMin(s.time) <= nowMin) continue;
    if (firesOn(s, day)) return { day, time: s.time };
  }
  return null;
}

/** "Every 2 weeks" counts from the week of the first reminder after the change (so the nearest chosen weekday fires). */
export function biweeklyAnchor(days: number, time: string, today: string, nowMin: number): string {
  const n = nextOccurrence({ repeat: 'weekly', days, time }, today, nowMin);
  return mondayOf(n?.day ?? today);
}

/** The cron: the occurrence to remind about now (its local day), or null. Once per day per set (`last_sent`). */
export function dueDay(s: Schedule & { last_sent?: string | null }, today: string, nowMin: number): string | null {
  if (!isTime(s.time) || !firesOn(s, today)) return null;
  const t = toMin(s.time);
  if (nowMin < t || nowMin >= t + DUE_WINDOW_MIN) return null;
  return s.last_sent === today ? null : today;
}

// ---------------------------------------------------------------- the range (= public/app.js ordSpread, ordRangeTxt, ordRangeStr)

export interface RLine { qty: number; price: number | null; unit: string; grp: string; unsure?: boolean | number }
export interface RSupplier { min_free_delivery?: number | null; delivery_fee?: number | null; currency?: string | null }
const RG_KG = [0.95, 1.25], RG_PCS = [1, 1.15], RG_ASK = [0.25, 0.9], RG_LEARN = [0.97, 1.03], RG_LEARN_MIN = 2;
const rgPct = (xs: number[], p: number) => { const i = (xs.length - 1) * p, a = Math.floor(i), b = Math.min(a + 1, xs.length - 1); return xs[a] + (xs[b] - xs[a]) * (i - a); };

/** Known prices of the supplier's visible catalog by group and unit → [p25, p90]; unsure prices stay out. */
export function bandsOf(items: { price: number | null; unsure?: boolean | number; price_unsure?: number; grp: string; unit: string }[]): Record<string, number[]> {
  const by: Record<string, number[]> = {};
  for (const x of items) if ((x.price ?? 0) > 0 && !(x.unsure ?? x.price_unsure)) (by[`${x.grp}|${x.unit}`] ??= []).push(x.price!);
  const b: Record<string, number[]> = {};
  for (const [k, xs] of Object.entries(by)) { xs.sort((p, q) => p - q); b[k] = RG_ASK.map((p) => rgPct(xs, p)); }
  return b;
}

/** {lo, hi} of lines at a supplier (ratios = its paid / price-list history, oldest first, ≤ 30) — or null, exactly as the app. */
export function spread(lines: RLine[], s: RSupplier | null, ratios: number[], bands: Record<string, number[]> | null) {
  const kg = { lo: 0, hi: 0 }, pcs = { lo: 0, hi: 0 }, ask = { lo: 0, hi: 0 };
  let est = 0, miss = 0;
  for (const l of lines) {
    if (!(l.qty > 0)) continue;
    if (l.price != null) {
      const v = l.qty * l.price, g = l.unit === 'kg' ? kg : pcs, [a, b] = l.unit === 'kg' ? RG_KG : RG_PCS;
      est += v; g.lo += v * a; g.hi += v * b;
    } else {
      const bd = bands?.[`${l.grp}|${l.unit}`];
      if (bd) { ask.lo += l.qty * bd[0]; ask.hi += l.qty * bd[1]; } else miss++;
    }
  }
  est = Math.round(est);
  const rs = est > 0 ? ratios : [];
  let lo: number, hi: number;
  if (rs.length >= RG_LEARN_MIN) { lo = est * Math.min(...rs) * RG_LEARN[0] + ask.lo; hi = est * Math.max(...rs) * RG_LEARN[1] + ask.hi; }
  else {
    lo = kg.lo + pcs.lo + ask.lo; hi = kg.hi + pcs.hi + ask.hi;
    if (hi > 0 && s?.min_free_delivery && est >= s.min_free_delivery) { /* free delivery */ }
    else if (hi > 0 && s?.delivery_fee) { lo += s.delivery_fee; hi += s.delivery_fee; }
  }
  if (!(hi > 0)) return null;
  const step = hi >= 1e5 ? 1000 : hi >= 1e4 ? 100 : 1;
  return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, est, miss, cur: s?.currency ?? 'IDR' };
}

const SYM: Record<string, string> = { KZT: '₸', THB: '฿', USD: '$', EUR: '€', RUB: '₽', IDR: 'IDR' };
/** "1,0–1,6 млн", "730–950 тыс" (en "1.0–1.6M", "730–950 k"), the app's thresholds and locale. */
export function rangeStr(lo: number, hi: number, cur: string, lang: string): string {
  const ru = lang !== 'en';
  const f = (x: number, d: number) => new Intl.NumberFormat(ru ? 'ru-RU' : 'en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }).format(x);
  const [k, d, u] = hi >= 1e6 ? [1e6, 1, ru ? 'млн' : 'M'] : hi >= 1e4 ? [1e3, 0, ru ? 'тыс' : 'k'] : [1, 0, ''];
  const a = f(lo / (k as number), d as number), b = f(hi / (k as number), d as number);
  const n = a === b ? a : `${a}–${b}`;
  const unit = [u, cur !== 'IDR' ? SYM[cur] ?? cur : ''].filter(Boolean).join(' ');
  return unit ? n + (ru || !((k as number) > 1) ? ' ' : '') + unit : n;
}

// ---------------------------------------------------------------- the reminder (Telegram)

const WD_RU = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const WD_EN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const plRu = (n: number, a: string, b: string, c: string) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * "Понедельник: пора заказать «Фрукты на неделю»\n28 позиций, приготовить 1,0–1,4 млн" (HTML-escaped). `n` = lines that go
 * into the basket (hidden items left out), `range` = rangeStr(…) or null.
 */
export function reminderText(lang: string, day: string, name: string, n: number, range: string | null): string {
  const ru = lang !== 'en';
  const wd = (ru ? WD_RU : WD_EN)[wdIdx(day)];
  const head = ru ? `${wd}: пора заказать «${esc(name)}»` : `${wd}: time to order “${esc(name)}”`;
  const pos = ru ? `${n} ${plRu(n, 'позиция', 'позиции', 'позиций')}` : `${n} ${n === 1 ? 'item' : 'items'}`;
  return `${head}\n${range ? (ru ? `${pos}, приготовить ${range}` : `${pos}, have ${range} ready`) : pos}`;
}
export const reminderButtons = (lang: string) => (lang !== 'en' ? { go: 'Собрать корзину', skip: 'Пропустить' } : { go: 'Fill the basket', skip: 'Skip' });
export const skippedLine = (lang: string, who: string) => (lang !== 'en' ? `Пропускаем этот раз · ${who}` : `Skipping this time · ${who}`);
