// Split from wave5.ts: input checks and helpers shared by its parts.
import { sensitive } from './agent';
import { regionTz } from './members';
import { HttpError, dtf, parseJson } from './util';

export const txt = (v: unknown, n: number) => (v == null ? null : String(v).trim().slice(0, n) || null);
export const isDay = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
export const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export const localDay = (tz: string, at = Date.now()) =>
  dtf('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
const localHour = (tz: string, at = Date.now()) =>
  Number(dtf('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date(at)));
export function noSecrets(what: string, ...parts: unknown[]) {
  const s = sensitive(parts.map((x) => (typeof x === 'string' ? x : JSON.stringify(x ?? ''))).join(' '));
  if (s) throw new HttpError(400, 'sensitive', `${what} looks like it contains ${s}. Remove it.`);
}
/** HTML escape for text AND attribute values (util.esc does not escape quotes). */
export const h = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const searchTzOf = (s: { region?: string | null; brief?: any }) => {
  const b = typeof s.brief === 'string' ? parseJson<any>(s.brief, {}) : s.brief ?? {};
  return b.timezone || regionTz(s.region);
};
