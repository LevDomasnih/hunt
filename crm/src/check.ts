// Split from wave4.ts: input checks and helpers shared by its parts.
import { sensitive } from './agent';
import { HttpError } from './util';

export const txt = (v: unknown, n: number) => (v == null ? null : String(v).trim().slice(0, n) || null);
export const isDay = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
export const day10 = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
export const num = (v: unknown) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Math.round(Number(v)) : NaN);
export function noSecrets(what: string, ...parts: unknown[]) {
  const s = sensitive(parts.map((x) => (typeof x === 'string' ? x : JSON.stringify(x ?? ''))).join(' '));
  if (s) throw new HttpError(400, 'sensitive', `${what} looks like it contains ${s}. Remove it.`);
}
