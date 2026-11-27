// Numbers, money, dates and short labels in the person's language and the project's time zone.
import { LANG, TERMS, cap, human, pick2, t } from './i18n.js';
import { S } from './store.js';

/** A date as the API sends it: an ISO string, a date-only 'YYYY-MM-DD', or a Date / epoch ms. */
export type DateIn = string | number | Date;
export const LOC = () => (LANG === 'ru' ? 'ru-RU' : 'en-GB');
export const tzNow = () => S.data?.search?.brief?.timezone || 'UTC';
export const fmtNum = (x: number) => new Intl.NumberFormat(LOC(), { maximumFractionDigits: 1 }).format(x);
export const SYM: { [cur: string]: string } = { KZT: '₸', THB: '฿', USD: '$', EUR: '€', RUB: '₽', IDR: 'IDR' };
export function money(v: number | string | null | undefined, cur?: string | null, sym?: boolean): string {
  if (v == null || v === '' || Number.isNaN(Number(v))) return '';
  const n = Number(v);
  const ru = LANG === 'ru';
  const a = Math.abs(n);
  const s = a >= 1e6 ? fmtNum(n / 1e6) + (ru ? ' млн' : 'M') : a >= 1e4 ? fmtNum(n / 1e3) + (ru ? ' тыс' : 'k') : fmtNum(n);
  const show = sym ?? (cur && cur !== 'IDR');
  return show && cur ? `${s} ${SYM[cur] ?? cur}` : s;
}
export const isDateOnly = (s: DateIn) => /^\d{4}-\d{2}-\d{2}$/.test(String(s));
export const asDate = (s: DateIn) => new Date(isDateOnly(s) ? `${s}T12:00:00Z` : s);
export const dfmt = (s: DateIn, opts: Intl.DateTimeFormatOptions, tz?: string) => new Intl.DateTimeFormat(LOC(), { timeZone: isDateOnly(s) ? 'UTC' : tz || tzNow(), ...opts }).format(asDate(s));
export const fmtTime = (s: DateIn, tz?: string) => dfmt(s, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, tz);
export const dayKey = (s: DateIn, tz?: string) => new Intl.DateTimeFormat('en-CA', { timeZone: isDateOnly(s) ? 'UTC' : tz || tzNow(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(asDate(s));
export const fmtDM = (s: DateIn, tz?: string) => dfmt(s, { day: '2-digit', month: '2-digit' }, tz).replace('/', '.');
export const fmtDMY = (s: DateIn) => dfmt(s, { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.');
export const fmtDayMonth = (s: DateIn, tz?: string) => dfmt(s, { day: 'numeric', month: 'long' }, tz);
export const fmtDayMonthShort = (s: DateIn, tz?: string) => dfmt(s, { day: 'numeric', month: 'short' }, tz).replace('.', '');
export const wdShort = (s: DateIn, tz?: string) => cap(dfmt(s, { weekday: 'short' }, tz).replace('.', ''));
export const ordinal = (n: number) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
export function todayTitle(tz?: string) {
  const d = new Date().toISOString();
  const wd = cap(dfmt(d, { weekday: 'long' }, tz));
  const day = Number(dfmt(d, { day: 'numeric' }, tz));
  return LANG === 'ru' ? `${wd}, ${day}\u2011е` : `${wd}, ${ordinal(day)}`;
}
export function relIn(ms: number) {
  const rtf = new Intl.RelativeTimeFormat(LANG, { numeric: 'auto' });
  const m = Math.round(ms / 60000);
  if (Math.abs(m) < 60) return rtf.format(m, 'minute');
  const h = Math.round(m / 60);
  if (Math.abs(h) < 24) return rtf.format(h, 'hour');
  return rtf.format(Math.round(h / 24), 'day');
}
export function whenLabel(iso: DateIn, tz?: string) {
  const k = dayKey(iso, tz);
  const now = Date.now();
  if (k === dayKey(new Date(now).toISOString(), tz)) return `${t('today')} ${fmtTime(iso, tz)}`;
  if (k === dayKey(new Date(now + 864e5).toISOString(), tz)) return `${t('tomorrow')} ${fmtTime(iso, tz)}`;
  return `${fmtDayMonthShort(iso, tz)} ${fmtTime(iso, tz)}`;
}
export function agoLabel(iso: DateIn) {
  const k = dayKey(iso);
  const now = Date.now();
  if (k === dayKey(new Date(now).toISOString())) return fmtTime(iso);
  if (k === dayKey(new Date(now - 864e5).toISOString())) return `${t('yesterday')} ${fmtTime(iso)}`;
  return fmtDayMonthShort(iso);
}
/** "from 2026-11-23" / "23.11–31.03" → {from:'23.11', to:'31.03'} */
export function availParts(av: string | null | undefined): { from?: string; to?: string } {
  if (!av) return {};
  const out: string[] = [];
  for (const m of String(av).matchAll(/(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/g)) {
    out.push(m[1] ? `${m[3]}.${m[2]}` : `${m[4].padStart(2, '0')}.${m[5].padStart(2, '0')}`);
  }
  return { from: out[0], to: out[1] };
}
export const termLabel = (x: string | null | undefined) => (x ? pick2(TERMS[x]) ?? x : null);
export const firstName = (n: string | null | undefined) => String(n ?? '').split(/\s+/)[0];
export const initial = (n: string | null | undefined) => (String(n ?? '?').trim()[0] ?? '?').toUpperCase();
export const shortTitle = (s: string | null | undefined) => String(s ?? '').split(/[,·]/)[0].trim();
export const CHANNEL: { [channel: string]: string } = { whatsapp: 'WhatsApp', telegram: 'Telegram', messenger: 'Messenger', instagram: 'Instagram', email: 'Email', line: 'LINE', viber: 'Viber', phone: 'Phone' };
export const channelName = (c: string | null | undefined) => CHANNEL[c] ?? (String(c ?? '').startsWith('portal:') ? String(c).slice(7) : human(c));

export function budgetLabel(b: number | string | { amount?: number; value?: number; currency?: string } | null | undefined, cur?: string) {
  if (b == null || b === '') return null;
  if (typeof b === 'object') return money(b.amount ?? b.value, b.currency ?? cur, true);
  if (typeof b === 'number') return money(b, cur, true);
  return String(b);
}
/** 20000000, 30000000 → "20–30 млн IDR" */
export function rangeLabel(lo: number, hi: number, cur?: string) {
  const sc = Math.abs(hi) >= 1e6 ? 1e6 : Math.abs(hi) >= 1e4 ? 1e3 : 1;
  return `${fmtNum(lo / sc)}–${money(hi, cur, true)}`;
}
// distance (km) between [lat,lng] points
export function km(a: [number, number] | number[], b: [number, number] | number[]) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
export const ROAD = 1.35;
