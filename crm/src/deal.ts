// Deal dates (payments, notice, move-out, deposit return), scam checks and document helpers.
import { HttpError, parseJson } from './util';

export const DATE_KINDS = ['payment', 'notice', 'moveout', 'deposit_return', 'other'] as const;
/** Days before the date when every member gets a reminder (0 = the morning of the day, negative = after). */
export const CADENCE: Record<string, number[]> = { payment: [7, 2, 0], notice: [14, 3], moveout: [3], deposit_return: [0, -3], other: [0] };

export interface DealDate { date: string; kind: string; title: string; amount?: number | null; currency?: string | null; note?: string | null; done?: boolean; legacy?: boolean }

const isDay = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10));

/** deal.data.dates[]; deals saved before wave 2 only have payments[] (refund = deposit return). */
export function dealDates(data: any): DealDate[] {
  if (Array.isArray(data?.dates) && data.dates.length) {
    return data.dates.filter((d: any) => d && isDay(d.date)).map((d: any) => ({ ...d, date: String(d.date).slice(0, 10), kind: DATE_KINDS.includes(d.kind) ? d.kind : 'other' }));
  }
  return (Array.isArray(data?.payments) ? data.payments : []).filter((p: any) => p && isDay(p.date)).map((p: any) => ({
    date: String(p.date).slice(0, 10),
    kind: p.kind === 'refund' ? 'deposit_return' : 'payment',
    title: p.label ?? '',
    amount: p.amount ?? null,
    currency: p.currency ?? data?.terms?.currency ?? null,
    done: !!p.paid,
    legacy: true,
  }));
}

export function cleanDates(arr: unknown): DealDate[] {
  if (!Array.isArray(arr) || arr.length > 60) throw new HttpError(400, 'bad_dates', 'dates must be a list (max 60)');
  return arr.map((d: any, i) => {
    if (!d || !isDay(d.date)) throw new HttpError(400, 'bad_dates', `dates[${i}].date must be YYYY-MM-DD`);
    if (!DATE_KINDS.includes(d.kind)) throw new HttpError(400, 'bad_dates', `dates[${i}].kind must be one of ${DATE_KINDS.join(', ')}`);
    const title = String(d.title ?? '').trim().slice(0, 120);
    if (!title) throw new HttpError(400, 'bad_dates', `dates[${i}].title is required`);
    const amount = d.amount == null || d.amount === '' ? null : Number(d.amount);
    if (amount != null && !Number.isFinite(amount)) throw new HttpError(400, 'bad_dates', `dates[${i}].amount must be a number`);
    return {
      date: String(d.date).slice(0, 10), kind: d.kind, title, amount: amount == null ? null : Math.round(amount),
      currency: d.currency ? String(d.currency).slice(0, 8) : null, note: d.note ? String(d.note).trim().slice(0, 200) : null, done: !!d.done,
    };
  }).sort((a, b) => a.date.localeCompare(b.date));
}

/** Whole days from `today` to `day` (both YYYY-MM-DD). */
export const daysUntil = (day: string, today: string) => Math.round((Date.parse(day + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 864e5);

// ---------------------------------------------------------------- scam check

export const VERDICTS = ['ok', 'caution', 'danger'] as const;
export const SIGNAL_STATUS = ['ok', 'warn', 'todo'] as const;

export function cleanChecks(b: any) {
  if (!VERDICTS.includes(b?.verdict)) throw new HttpError(400, 'bad_checks', `verdict must be one of ${VERDICTS.join(', ')}`);
  if (!Array.isArray(b.signals) || b.signals.length > 20) throw new HttpError(400, 'bad_checks', 'signals must be a list (max 20)');
  const signals = b.signals.map((x: any, i: number) => {
    if (!SIGNAL_STATUS.includes(x?.status)) throw new HttpError(400, 'bad_checks', `signals[${i}].status must be ok, warn or todo`);
    const title = String(x.title ?? '').trim().slice(0, 120);
    if (!title) throw new HttpError(400, 'bad_checks', `signals[${i}].title is required`);
    return { status: x.status, title, detail: x.detail ? String(x.detail).trim().slice(0, 300) : null };
  });
  return { verdict: b.verdict, signals, advice: b.advice ? String(b.advice).trim().slice(0, 200) : null, checked_at: new Date().toISOString() };
}

// ---------------------------------------------------------------- documents

export const DOC_KINDS = ['lease', 'receipt', 'owner_consent', 'movein_video', 'moveout_video', 'scan', 'other'] as const;
export const DOC_STATUS = ['have', 'request', 'due'] as const;
export const SUMMARY_ICONS = ['users', 'calendar', 'wallet', 'shield', 'zap', 'home', 'key', 'file', 'alert', 'receipt', 'info'];

export function cleanSummary(s: unknown) {
  if (s == null) return null;
  const v: any = typeof s === 'string' ? parseJson(s, null) : s;
  if (!v || typeof v !== 'object' || !Array.isArray(v.sections) || v.sections.length > 12) throw new HttpError(400, 'bad_summary', 'summary must be {sections:[{icon, title, text}], changes?}');
  return {
    sections: v.sections.map((x: any, i: number) => {
      const title = String(x?.title ?? '').trim().slice(0, 80);
      const text = String(x?.text ?? '').trim().slice(0, 600);
      if (!title || !text) throw new HttpError(400, 'bad_summary', `sections[${i}] needs title and text`);
      return { icon: SUMMARY_ICONS.includes(x.icon) ? x.icon : 'info', title, text };
    }),
    changes: v.changes ? String(v.changes).trim().slice(0, 600) : null,
    changes_from: v.changes_from != null ? Number(v.changes_from) || null : null,
  };
}

/** Public view of a document row: Telegram ids stay on the server. */
export function docView(d: any) {
  if (!d) return d;
  const { tg_file_id, tg_chat_id, ...rest } = d;
  return { ...rest, summary: parseJson(d.summary, null), has_file: !!tg_file_id };
}
