// Bot DMs to search members: incoming-message alerts, viewing reminders, deal-date reminders, the morning digest, quiet hours, the cron.
// Every Telegram call here is best-effort: a failed DM never fails the API call that caused it.
import { sharesCron } from './shares';
import { Env, now, parseJson, esc, event, dtf } from './util';
import { dealDates, daysUntil, CADENCE } from './deal';
import { tg, kb, InlineButton } from './tg';
import { t } from './i18n';
import { regionTz } from './members';
import { sendDraftForApproval } from './bot';
import { powerView, packData } from './life';
import { countryOf } from './members';
import { bikeReminders, calendarReminders } from './wave4';
import { surfOn, surfDigestLine, renewalCron, expireGuests } from './wave5';
import { afishaDigestLine, afishaOn, afishaCron } from './afisha';
import { pruneCounters } from './media';
import { stageCron } from './stage';
import { partyCron, feedbackCron } from './party';
import { openDraft, unseal } from './vault';
import { accessCron } from './access';
import { setsCron } from './orders';

/** Wave 8.3: once a home is chosen, a thread about another home is the search archive: never "waiting for you" (same rule as
 * thArchived in public/app.js). The home = searches.home_listing_id or a listing taken; house contacts always stay with the home. */
const HOME_IDS = `SELECT h.id FROM listings h WHERE h.search_id=t.search_id AND (h.decision='take' OR h.status='taken' OR h.id=(SELECT home_listing_id FROM searches WHERE id=t.search_id))`;
export const ARCHIVED_THREAD = `(t.listing_id IS NOT NULL AND EXISTS (${HOME_IDS}) AND t.listing_id NOT IN (${HOME_IDS})
  AND t.contact_id NOT IN (SELECT contact_id FROM house_contacts WHERE search_id=t.search_id AND contact_id IS NOT NULL))`;

export const appUrl = (env: Env, hash: string) => `${env.PUBLIC_URL}/app#${hash}`;
export const threadHash = (sid: string, contactId: string) => `/s/${sid}/chats/${encodeURIComponent(contactId)}`;

interface Recipient { user_id: string; tg_user_id: number; lang: string; role: string }
interface Quiet { start: number; end: number } // minutes from local midnight

const DEFAULT_QUIET = '23:00-08:00';

/** "23:00-08:00" or {start, end}; missing = the default; "off" / false = no quiet hours. */
export function parseQuiet(v: unknown): Quiet | null {
  if (v === false || v === 'off' || v === 'none') return null;
  const src = v == null || v === '' ? DEFAULT_QUIET : v;
  const toMin = (x: unknown) => {
    const m = String(x ?? '').match(/^\s*(\d{1,2})(?::(\d{2}))?\s*$/);
    return m ? (Number(m[1]) % 24) * 60 + Number(m[2] ?? 0) : null;
  };
  let a: number | null = null, b: number | null = null;
  if (typeof src === 'object') { a = toMin((src as any).start); b = toMin((src as any).end); }
  else { const [x, y] = String(src).split(/\s*[-–—]\s*/); a = toMin(x); b = toMin(y); }
  return a == null || b == null || a === b ? null : { start: a, end: b };
}

export function localMinutes(tz: string, at = Date.now()): number {
  const p = dtf('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at));
  const g = (k: string) => Number(p.find((x) => x.type === k)?.value ?? 0);
  return g('hour') * 60 + g('minute');
}

/** Minutes left until the quiet hours end, 0 when outside them. */
export function quietLeft(q: Quiet | null, tz: string, at = Date.now()): number {
  if (!q) return 0;
  const m = localMinutes(tz, at);
  const inside = q.start < q.end ? m >= q.start && m < q.end : m >= q.start || m < q.end;
  return inside ? (q.end - m + 1440) % 1440 || 1440 : 0;
}

export const localDay = (tz: string, at = Date.now()) =>
  dtf('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));

// ---------------------------------------------------------------- per-run caches and budget (cron)

type SCtx = { s: any; tz: string; quiet: Quiet | null };
interface RunState { ctx: Map<string, SCtx | null>; rcpt: Map<string, Recipient[]>; budget: Budget }
const run = (env: Env): RunState | undefined => (env as any).__run;

export class BudgetOut extends Error { constructor(what: string) { super(`cron budget: ${what}`); } }
/**
 * Free tier per invocation: 50 D1 queries, 50 subrequests. The cron stops at 32 queries (+8 reserved for writing the
 * "sent" marks after successful sends) and 40 Telegram calls; everything is idempotent, so the next tick continues.
 */
export class Budget {
  d1 = 32; reserve = 8; fetch = 40;
  take(n = 1) { if (this.d1 < n) throw new BudgetOut('d1'); this.d1 -= n; }
  takeFetch() { if (this.fetch < 1) throw new BudgetOut('fetch'); this.fetch--; }
  canCommit(n: number) { return this.d1 + this.reserve >= n; }
  commit(n: number) {
    if (!this.canCommit(n)) throw new BudgetOut('d1 reserve');
    const a = Math.min(this.d1, n); this.d1 -= a; this.reserve -= n - a;
  }
}

/** A D1 binding that counts every statement against the run budget (a batch counts each statement). */
function countingDB(db: D1Database, b: Budget): D1Database {
  const raw = new WeakMap<object, D1PreparedStatement>();
  const wrap = (st: D1PreparedStatement): D1PreparedStatement => {
    const w: any = {
      bind: (...v: unknown[]) => wrap(st.bind(...v)),
      first: (col?: string) => { b.take(); return col ? st.first(col) : st.first(); },
      all: () => { b.take(); return st.all(); },
      run: () => { b.take(); return st.run(); },
      raw: (o?: any) => { b.take(); return st.raw(o); },
    };
    raw.set(w, st);
    return w as D1PreparedStatement;
  };
  return {
    prepare: (q: string) => wrap(db.prepare(q)),
    batch: (sts: D1PreparedStatement[]) => { b.take(sts.length); return db.batch(sts.map((x) => raw.get(x as object) ?? x)); },
    exec: (q: string) => { b.take(); return db.exec(q); },
    dump: () => db.dump(),
    withSession: (...a: any[]) => (db as any).withSession(...a),
    __raw: db, __map: raw,
  } as unknown as D1Database;
}

/** Writes that must follow a successful send ("sent" marks, outbox deletes): from the reserve, one batch. */
export async function commit(env: Env, sts: D1PreparedStatement[]) {
  if (!sts.length) return;
  const r = run(env);
  if (!r) { await env.DB.batch(sts); return; }
  r.budget.commit(sts.length);
  const db = (env.DB as any).__raw as D1Database;
  const map = (env.DB as any).__map as WeakMap<object, D1PreparedStatement>;
  await db.batch(sts.map((x) => map.get(x as object) ?? x));
}

const ctxFromRow = (s: any): SCtx => {
  const brief = parseJson<any>(s.brief, {});
  const prof = parseJson<any>(s.profile, {});
  return { s, tz: brief.timezone || regionTz(s.region), quiet: parseQuiet(prof.quiet_hours) };
};

async function searchCtx(env: Env, sid: string) {
  const c = run(env)?.ctx;
  if (c?.has(sid)) return c.get(sid)!;
  const s = await env.DB.prepare(
    `SELECT s.id, s.title, s.region, s.brief, s.status, p.data profile FROM searches s LEFT JOIN profiles p ON p.user_id=s.owner_id WHERE s.id=?`,
  ).bind(sid).first<any>();
  const out = s ? ctxFromRow(s) : null;
  c?.set(sid, out);
  return out;
}

async function recipients(env: Env, sid: string, ownerOnly = false): Promise<Recipient[]> {
  const c = run(env)?.rcpt;
  let all = c?.get(sid);
  if (!all) {
    all = (await env.DB.prepare(
      `SELECT u.id user_id, u.tg_user_id, u.lang, m.role FROM members m JOIN users u ON u.id=m.user_id
       WHERE m.search_id=? AND m.notify=1 AND u.tg_user_id IS NOT NULL`,
    ).bind(sid).all<Recipient>()).results ?? [];
    c?.set(sid, all);
  }
  return ownerOnly ? all.filter((r) => r.role === 'owner') : all;
}

export async function dm(env: Env, chatId: number, text: string, buttons?: InlineButton[][]): Promise<boolean> {
  run(env)?.budget.takeFetch(); // out of budget: throws, the cron job stops and the next tick continues
  try {
    await tg(env, 'sendMessage', {
      chat_id: chatId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
      ...(buttons?.length ? { reply_markup: kb(buttons) } : {}),
    });
    return true;
  } catch (e) {
    console.error('dm', chatId, String((e as Error)?.message ?? e));
    return false;
  }
}

interface Msg { text: string; buttons?: InlineButton[][] }

/**
 * DM every member of the search who has notifications on.
 * quiet: 'send' ignores quiet hours, 'postpone' queues the DM in the outbox until they end (needs key), 'skip' drops it.
 * Returns how many DMs went out now.
 */
export async function dmMembers(env: Env, sid: string, build: (lang: string) => Msg, opts: { quiet: 'send' | 'postpone' | 'skip'; key?: string; ownerOnly?: boolean; skip?: Set<string>; votersOnly?: boolean }): Promise<number> {
  try {
    const ctx = await searchCtx(env, sid);
    if (!ctx) return 0;
    const left = opts.quiet === 'send' ? 0 : quietLeft(ctx.quiet, ctx.tz);
    let sent = 0;
    for (const r of await recipients(env, sid, opts.ownerOnly)) {
      // votersOnly: owner and members only (a whitelist; legacy viewers and anyone else are skipped).
      if (opts.skip?.has(r.user_id) || (opts.votersOnly && !['owner', 'member'].includes(r.role))) continue;
      const m = build(r.lang);
      if (left > 0) {
        if (opts.quiet === 'postpone' && opts.key) await enqueue(env, `${opts.key}:${r.tg_user_id}`, r.tg_user_id, { kind: 'text', ...m }, left);
        continue;
      }
      if (await dm(env, r.tg_user_id, m.text, m.buttons)) sent++;
    }
    return sent;
  } catch (e) {
    if (e instanceof BudgetOut) throw e;
    console.error('dmMembers', e);
    return 0;
  }
}

async function enqueue(env: Env, key: string, chatId: number, payload: unknown, minutes: number) {
  const nb = new Date(Date.now() + minutes * 60e3).toISOString();
  await env.DB.prepare(
    `INSERT INTO outbox (key, chat_id, payload, not_before, created_at) VALUES (?,?,?,?,?)
     ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, not_before=excluded.not_before`,
  ).bind(key, chatId, JSON.stringify(payload), nb, now()).run();
}

/** Draft approval for the owner: now, or after the quiet hours. */
export async function draftToOwner(env: Env, s: any, draft: any): Promise<void> {
  try {
    const ctx = await searchCtx(env, s.id);
    const left = ctx ? quietLeft(ctx.quiet, ctx.tz) : 0;
    if (left > 0) {
      const owner = await env.DB.prepare('SELECT tg_user_id FROM users WHERE id=?').bind(s.owner_id).first<{ tg_user_id: number | null }>();
      if (owner?.tg_user_id) await enqueue(env, `draft:${draft.id}`, owner.tg_user_id, { kind: 'draft', draft_id: draft.id }, left);
      return;
    }
    await sendDraftForApproval(env, s, draft);
  } catch (e) {
    console.error('draftToOwner', String((e as Error)?.message ?? e));
  }
}

/** (a) An incoming message about a place we want: tell the members, with a button to the conversation. */
export async function notifyIncoming(env: Env, x: { search_id?: string | null; contact_id?: string | null; listing_id?: string | null; channel: string; text?: string | null }) {
  try {
    if (!x.listing_id) return;
    const l = await env.DB.prepare('SELECT id, search_id, decision, title FROM listings WHERE id=?').bind(x.listing_id).first<any>();
    if (!l || !['want_view', 'take'].includes(l.decision)) return;
    const sid = x.search_id || l.search_id;
    const c = x.contact_id
      ? await env.DB.prepare(`SELECT c.name, (SELECT coalesce(display, address) FROM contact_channels WHERE contact_id=c.id LIMIT 1) alt FROM contacts c WHERE c.id=?`).bind(x.contact_id).first<any>()
      : null;
    const who = c?.name || c?.alt || x.channel;
    const raw = String(x.text ?? '').replace(/\s+/g, ' ').trim();
    const snippet = raw.length > 120 ? raw.slice(0, 120) + '…' : raw || '…';
    const hash = x.contact_id ? threadHash(sid, x.contact_id) : `/s/${sid}/listing/${encodeURIComponent(l.id)}`;
    await dmMembers(env, sid, (lang) => ({
      text: `<b>${esc(who)}</b>: ${esc(snippet)}`,
      buttons: [[{ text: t(lang, 'open_chat'), web_app: { url: appUrl(env, hash) } }]],
    }), { quiet: 'postpone', key: `in:${sid}:${x.contact_id ?? l.id}`, votersOnly: true });
  } catch (e) {
    console.error('notifyIncoming', e);
  }
}

function fmtMoney(n: number, cur: string | null | undefined, lang: string): string {
  const ru = lang === 'ru';
  const a = Math.abs(n);
  const f = (x: number) => new Intl.NumberFormat(ru ? 'ru-RU' : 'en-GB', { maximumFractionDigits: 1 }).format(x);
  const s = a >= 1e6 ? f(n / 1e6) + (ru ? ' млн' : 'M') : a >= 1e4 ? f(n / 1e3) + (ru ? ' тыс' : 'k') : f(n);
  return cur ? `${s} ${cur}` : s;
}

// ---------------------------------------------------------------- cron (every 15 minutes)

/**
 * Postponed DMs (quiet hours) and draft approvals: send first, delete after a successful send, at most 20 sends per tick.
 * Several postponed "new message" alerts for the same person become one DM. A row that keeps failing for 3 days is dropped.
 */
async function flushOutbox(env: Env) {
  const rows = (await env.DB.prepare('SELECT * FROM outbox WHERE not_before <= ? ORDER BY not_before LIMIT 40').bind(now()).all<any>()).results ?? [];
  if (!rows.length) return;
  const groups: { chat: number; rows: any[] }[] = [];
  for (const r of rows) {
    const p = parseJson<any>(r.payload, {});
    const inbound = p.kind === 'text' && String(r.key).startsWith('in:');
    const g = inbound ? groups.find((x) => x.chat === r.chat_id && String(x.rows[0].key).startsWith('in:')) : null;
    if (g) g.rows.push(r); else groups.push({ chat: r.chat_id, rows: [r] });
  }
  const stale = new Date(Date.now() - 3 * 864e5).toISOString();
  let sends = 0;
  for (const g of groups) {
    if (sends >= 20) break;
    const done: any[] = [];
    try {
      const p0 = parseJson<any>(g.rows[0].payload, {});
      if (p0.kind === 'text') {
        const ps = g.rows.map((r) => parseJson<any>(r.payload, {}));
        const text = ps.map((p) => p.text).join('\n\n').slice(0, 3800);
        sends++;
        if (await dm(env, g.chat, text, ps[ps.length - 1].buttons)) done.push(...g.rows);
      } else if (p0.kind === 'draft') {
        const d = await openDraft(env, await env.DB.prepare("SELECT * FROM drafts WHERE id=? AND status='pending' AND tg_message_id IS NULL").bind(p0.draft_id).first<any>());
        const s = d ? await env.DB.prepare('SELECT * FROM searches WHERE id=?').bind(d.search_id).first<any>() : null;
        if (d && s) {
          run(env)?.budget.takeFetch();
          sends++;
          await sendDraftForApproval(env, s, d);
        }
        done.push(...g.rows); // sent, or nothing to send any more
      } else done.push(...g.rows);
    } catch (e) {
      if (e instanceof BudgetOut) throw e;
      console.error('outbox', g.rows[0].key, String((e as Error)?.message ?? e));
    }
    const failed = g.rows.filter((r) => !done.includes(r));
    const sts = [
      ...done.map((r) => env.DB.prepare('DELETE FROM outbox WHERE key=? AND not_before=?').bind(r.key, r.not_before)),
      ...failed.filter((r) => r.created_at < stale).map((r) => env.DB.prepare('DELETE FROM outbox WHERE key=?').bind(r.key)),
      ...failed.filter((r) => r.created_at >= stale).map((r) => env.DB.prepare('UPDATE outbox SET not_before=? WHERE key=?').bind(new Date(Date.now() + 3600e3).toISOString(), r.key)),
    ];
    await commit(env, sts);
  }
}

/** (c) 60-75 min before a confirmed viewing, once. Ignores quiet hours. */
async function viewingReminders(env: Env) {
  const nowMs = Date.now();
  const from = new Date(nowMs - 864e5).toISOString().slice(0, 10);
  const to = new Date(nowMs + 2 * 864e5).toISOString().slice(0, 10);
  const rows = (await env.DB.prepare(
    `SELECT v.id, v.search_id, v.listing_id, v.starts_at, v.meet_note, l.title, l.lat, l.lng, l.map_url, s.region, s.brief
     FROM viewings v JOIN listings l ON l.id=v.listing_id JOIN searches s ON s.id=v.search_id
     WHERE v.status='confirmed' AND v.reminded_at IS NULL AND substr(v.starts_at,1,10) BETWEEN ? AND ?`,
  ).bind(from, to).all<any>()).results ?? [];
  for (const v of rows) {
    const mins = (Date.parse(v.starts_at) - nowMs) / 60e3;
    if (!(mins > 45 && mins <= 75)) continue;
    const upd = await env.DB.prepare('UPDATE viewings SET reminded_at=? WHERE id=? AND reminded_at IS NULL').bind(now(), v.id).run();
    if (!upd.meta.changes) continue;
    const tz = parseJson<any>(v.brief, {}).timezone || regionTz(v.region);
    const time = dtf('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(v.starts_at));
    const dest = v.lat != null ? `https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lng}` : v.map_url;
    await dmMembers(env, v.search_id, (lang) => ({
      text: `${t(lang, 'viewing_soon')}: <b>${time}</b> · ${esc(v.title)}${v.meet_note ? `\n${esc(v.meet_note)}` : ''}`,
      buttons: [[
        ...(dest ? [{ text: `🧭 ${t(lang, 'route')}`, url: dest }] : []),
        { text: t(lang, 'open_chat'), web_app: { url: appUrl(env, `/s/${v.search_id}/listing/${encodeURIComponent(v.listing_id)}`) } },
      ]],
    }), { quiet: 'send' });
  }
}

/**
 * (e) 60-90 min after a viewing started (confirmed or done), once per viewing: "Rate <title>" to each member
 * who can vote and has not rated it yet, with a button into the rating screen. Waits for the quiet hours (outbox).
 */
async function rateReminders(env: Env) {
  const nowMs = Date.now();
  const from = new Date(nowMs - 2 * 864e5).toISOString().slice(0, 10);
  const to = new Date(nowMs + 864e5).toISOString().slice(0, 10);
  const rows = (await env.DB.prepare(
    `SELECT v.id, v.search_id, v.listing_id, v.starts_at, l.title FROM viewings v JOIN listings l ON l.id=v.listing_id
     WHERE v.status IN ('confirmed','done') AND v.rate_asked_at IS NULL AND substr(v.starts_at,1,10) BETWEEN ? AND ?`,
  ).bind(from, to).all<any>()).results ?? [];
  for (const v of rows) {
    const mins = (nowMs - Date.parse(v.starts_at)) / 60e3;
    if (!(mins >= 60 && mins <= 90)) continue;
    const upd = await env.DB.prepare('UPDATE viewings SET rate_asked_at=? WHERE id=? AND rate_asked_at IS NULL').bind(now(), v.id).run();
    if (!upd.meta.changes) continue;
    const rated = new Set(((await env.DB.prepare('SELECT user_id FROM ratings WHERE listing_id=?').bind(v.listing_id).all<{ user_id: string }>()).results ?? []).map((r) => r.user_id));
    const hash = `/s/${v.search_id}/rate/${encodeURIComponent(v.listing_id)}`;
    await dmMembers(env, v.search_id, (lang) => ({
      text: `${t(lang, 'rate_ask')}: <b>${esc(v.title)}</b>`,
      buttons: [[{ text: t(lang, 'rate_btn'), web_app: { url: appUrl(env, hash) } }]],
    }), { quiet: 'postpone', key: `rate:${v.id}`, skip: rated, votersOnly: true });
  }
}

const ruPl = (n: number, one: string, few: string, many: string) => {
  const c = new Intl.PluralRules('ru').select(n);
  return c === 'one' ? one : c === 'few' ? few : many;
};

/**
 * (d) Deal dates (lease dates[], or legacy payments[]): reminders to every member with notifications on.
 * Cadence (days before): payment 7, 2 and the morning of the day; notice 14 and 3; move-out 3;
 * deposit return on the day and 3 days after unless marked done (then the agent also gets an event).
 * Sent once per date and offset (sent_marks), only after 08:00 local and outside quiet hours.
 */
async function dateReminders(env: Env) {
  const rows = (await env.DB.prepare(
    // Wave 6: plus the dates of signed extension terms (deal_terms, seq ≥ 2).
    `SELECT d.listing_id, d.search_id, d.data, s.region, s.brief,
       (SELECT json_group_array(json_object('seq', t.seq, 'currency', t.currency, 'dates', CASE WHEN json_valid(t.dates) THEN json(t.dates) ELSE json('[]') END))
          FROM deal_terms t WHERE t.search_id=d.search_id AND t.status!='draft') ext
     FROM deals d JOIN searches s ON s.id=d.search_id WHERE s.status != 'closed'`,
  ).all<any>()).results ?? [];
  for (const r of rows) {
    const data = parseJson<any>(r.data, {});
    const tz = parseJson<any>(r.brief, {}).timezone || regionTz(r.region);
    const today = localDay(tz);
    const ext = parseJson<any[]>(r.ext, []).filter((x) => x?.seq).flatMap((x) => (Array.isArray(x.dates) ? x.dates : [])
      .filter((d: any) => d && /^\d{4}-\d{2}-\d{2}$/.test(String(d.date))).map((d: any) => ({ ...d, currency: d.currency ?? x.currency ?? null, term_seq: Number(x.seq) })));
    const dates: (ReturnType<typeof dealDates>[number] & { term_seq?: number })[] = [...dealDates(data), ...ext];
    for (let i = 0; i < dates.length; i++) {
      const d = dates[i];
      if (d.done) continue;
      const left = daysUntil(d.date, today);
      const offset = (CADENCE[d.kind] ?? [0]).find((o) => o === left);
      if (offset === undefined) continue;
      const key = `date:${r.listing_id}:${d.term_seq ? `t${d.term_seq}:` : ''}${d.date}:${d.kind}:${offset}:${d.amount ?? i}`;
      if (await env.DB.prepare('SELECT 1 FROM sent_marks WHERE key=?').bind(key).first()) continue;
      // Deals from before wave 2 were reminded "today or tomorrow" once: don't repeat the day-of reminder.
      if (d.legacy && offset <= 1 && await env.DB.prepare('SELECT 1 FROM sent_marks WHERE key=?').bind(`pay:${r.listing_id}:${d.date}:${d.amount ?? ''}`).first()) continue;
      if (localMinutes(tz) < 8 * 60) continue; // in the morning, not at midnight
      const ctx = await searchCtx(env, r.search_id);
      if (ctx && quietLeft(ctx.quiet, ctx.tz) > 0) continue; // next tick after the quiet hours
      const ins = await env.DB.prepare('INSERT OR IGNORE INTO sent_marks (key, at) VALUES (?,?)').bind(key, now()).run();
      if (!ins.meta.changes) continue;
      const late = d.kind === 'deposit_return' && offset < 0;
      if (late) await event(env, r.search_id, 'date_due', r.listing_id, 'system', { kind: d.kind, date: d.date, title: d.title, amount: d.amount ?? null, overdue_days: -offset });
      const cur = d.currency ?? data.terms?.currency ?? null;
      await dmMembers(env, r.search_id, (lang) => {
        const head = late ? t(lang, 'dt_deposit_late') : t(lang, ('dt_' + d.kind) as any);
        const when = offset === 0 ? t(lang, 'dt_today') : offset > 0 ? t(lang, 'dt_in', { n: offset }) : '';
        const amount = d.amount != null ? ` — <b>${esc(fmtMoney(Number(d.amount), cur, lang))}</b>` : '';
        const lines = [`${head}${when ? ` ${when}` : ''}${/[?!]$/.test(head) ? '' : ':'} ${esc(d.title)}${amount}`];
        if (d.note) lines.push(esc(d.note));
        if (late) lines.push(t(lang, 'dt_late_tail'));
        return { text: lines.join('\n'), buttons: [[{ text: t(lang, 'open_docs'), web_app: { url: appUrl(env, `/s/${r.search_id}/docs`) } }]] };
      }, { quiet: 'send' });
    }
  }
}

/**
 * (f) Morning digest: at 08:00-12:00 local (first tick outside quiet hours), once a day per member who has the digest on.
 * New listings, replies, drafts waiting (owner), today's payments and viewings, scam flags, open issues. Empty digest = no DM.
 */
async function morningDigest(env: Env) {
  // One query for every active search with its timezone and quiet hours; nothing more unless one is inside 08:00-12:00 local.
  const all = (await env.DB.prepare(`SELECT s.id, s.title, s.region, s.brief, s.status, p.data profile FROM searches s LEFT JOIN profiles p ON p.user_id=s.owner_id
    WHERE s.status IN ('active','found','living')`).all<any>()).results ?? [];
  const r0 = run(env);
  const open = all.map((s) => { const c = ctxFromRow(s); r0?.ctx.set(s.id, c); return c; }).filter((c) => {
    const mins = localMinutes(c.tz);
    return mins >= 8 * 60 && mins < 12 * 60 && quietLeft(c.quiet, c.tz) === 0;
  });
  if (!open.length) return;
  const ids = open.map((c) => c.s.id);
  const people = (await env.DB.prepare(`SELECT m.search_id, u.id user_id, u.tg_user_id, u.lang, m.role, m.surf, m.afisha, m.nightlife FROM members m JOIN users u ON u.id=m.user_id
    WHERE m.search_id IN (${ids.map(() => '?').join(',')}) AND m.digest=1 AND u.tg_user_id IS NOT NULL`).bind(...ids).all<any>()).results ?? [];
  const keyOf = (sid: string, uid: string, day: string) => `digest:${sid}:${uid}:${day}`;
  const dayOf = new Map(open.map((c) => [c.s.id, localDay(c.tz)]));
  const keys = people.map((p) => keyOf(p.search_id, p.user_id, dayOf.get(p.search_id)!));
  const sent = new Set<string>();
  for (let i = 0; i < keys.length; i += 90) {
    const part = keys.slice(i, i + 90);
    for (const r of (await env.DB.prepare(`SELECT key FROM sent_marks WHERE key IN (${part.map(() => '?').join(',')})`).bind(...part).all<{ key: string }>()).results ?? []) sent.add(r.key);
  }
  for (const ctx of open) {
    const s = ctx.s;
    try {
      const day = dayOf.get(s.id)!;
      const todo = people.filter((p) => p.search_id === s.id && !sent.has(keyOf(s.id, p.user_id, day)));
      if (!todo.length) continue;
      const since = new Date(Date.now() - 24 * 3600e3).toISOString();
      const [nl, th, dr, vw, fl, is, dl] = await env.DB.batch<any>([
        env.DB.prepare(`SELECT COUNT(*) n FROM listings WHERE search_id=? AND created_at > ? AND status NOT IN ('closed','rejected')`).bind(s.id, since),
        env.DB.prepare(`SELECT t.last, c.name FROM threads t LEFT JOIN contacts c ON c.id=t.contact_id WHERE t.search_id=? AND t.state='waiting_us' AND t.last_at > ? AND NOT ${ARCHIVED_THREAD} ORDER BY t.last_at DESC LIMIT 2`).bind(s.id, since),
        env.DB.prepare(`SELECT COUNT(*) n FROM drafts WHERE search_id=? AND status='pending'`).bind(s.id),
        env.DB.prepare(`SELECT v.starts_at, l.title FROM viewings v JOIN listings l ON l.id=v.listing_id WHERE v.search_id=? AND v.status IN ('proposed','confirmed') AND substr(v.starts_at,1,10)=? ORDER BY v.starts_at`).bind(s.id, day),
        env.DB.prepare(`SELECT title, checks FROM listings WHERE search_id=? AND checks IS NOT NULL AND status NOT IN ('closed','rejected') AND (decision IN ('want_view','take')
                        OR id IN (SELECT listing_id FROM viewings WHERE search_id=? AND status IN ('proposed','confirmed') AND starts_at >= ?))`).bind(s.id, s.id, day),
        env.DB.prepare(`SELECT COUNT(*) n FROM issues WHERE search_id=? AND status!='fixed'`).bind(s.id),
        env.DB.prepare(`SELECT data FROM deals WHERE search_id=? ORDER BY updated_at DESC LIMIT 1`).bind(s.id),
      ]);
      for (const x of th.results ?? []) (x as any).last = await unseal(env, (x as any).last);
      const nNew = Number(nl.results?.[0]?.n ?? 0);
      const nDrafts = Number(dr.results?.[0]?.n ?? 0);
      const nIssues = Number(is.results?.[0]?.n ?? 0);
      const deal = dl.results?.[0] ? parseJson<any>(dl.results[0].data, {}) : null;
      const pays = deal ? dealDates(deal).filter((d) => d.date === day && !d.done && d.kind === 'payment') : [];
      const flags = (fl.results ?? []).map((l: any) => ({ title: l.title, c: parseJson<any>(l.checks, null) }))
        .filter((x: any) => x.c && x.c.verdict !== 'ok').map((x: any) => ({ title: x.title, n: (x.c.signals ?? []).filter((g: any) => g.status === 'warn').length || 1 }));
      const short = String(s.title).split(/[,·]/)[0].trim();
      const hm = dtf('en-GB', { timeZone: ctx.tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      // Wave 5: the best surf spot today, from the forecast cache only (members who opted in; default on when the brief mentions surf).
      const surfLines: Record<string, string | null> = {};
      for (const p of todo) if (surfOn(p.surf, s.brief) && !(p.lang in surfLines)) surfLines[p.lang] = await surfDigestLine(env, s, p.lang).catch((e) => { if (e instanceof BudgetOut) throw e; return null; });
      // Wave 7: the top event of today (members with the Афиша line on; nightlife opt-outs get their own pick).
      const evLines: Record<string, string | null> = {};
      for (const p of todo) {
        if (!afishaOn(p.afisha, s.status) || !['owner', 'member'].includes(p.role)) continue;
        const k = `${p.lang}:${p.nightlife === 0 ? 'off' : 'on'}`;
        if (!(k in evLines)) evLines[k] = await afishaDigestLine(env, s, p.lang, p.nightlife === 0 ? p.user_id : null).catch((e) => { if (e instanceof BudgetOut) throw e; return null; });
      }
      // full: owner and members see conversation snippets and money; anyone else (legacy viewers) gets counts only.
      const build = (lang: string, owner: boolean, full: boolean, surf = false, ev: string | null = null) => {
        const ru = lang === 'ru';
        const lines: string[] = [];
        if (nNew) lines.push(`🏠 ${nNew} ${ru ? ruPl(nNew, 'новый вариант', 'новых варианта', 'новых вариантов') : nNew === 1 ? 'new listing' : 'new listings'}`);
        if (full) for (const x of th.results ?? []) lines.push(`💬 ${esc(x.name ?? '?')}: ${esc(String(x.last ?? '').slice(0, 140))}`);
        if (owner && nDrafts) lines.push(`✍️ ${nDrafts} ${ru ? `${ruPl(nDrafts, 'сообщение ждёт', 'сообщения ждут', 'сообщений ждут')} твоего «да»` : `${nDrafts === 1 ? 'message waits' : 'messages wait'} for your “yes”`}`);
        const today = [
          ...(full ? pays.map((p) => `${t(lang, 'dg_pay')} ${fmtMoney(Number(p.amount ?? 0), p.currency ?? deal?.terms?.currency, lang)}`) : []),
          ...(vw.results ?? []).map((v: any) => `${t(lang, 'dg_viewing')} ${hm.format(new Date(v.starts_at))} ${String(v.title).split(/[,·]/)[0]}`),
        ];
        if (today.length) lines.push(`📅 ${t(lang, 'dg_today')}: ${esc(today.join(', '))}`);
        for (const f of flags.slice(0, 2)) lines.push(`🛡 ${ru ? `У ${esc(String(f.title).split(/[,·]/)[0])} ${f.n} ${ruPl(f.n, 'сигнал', 'сигнала', 'сигналов')}, глянь до просмотра` : `${esc(String(f.title).split(/[,·]/)[0])}: ${f.n} warning ${f.n === 1 ? 'sign' : 'signs'}, check before the viewing`}`);
        if (surf && surfLines[lang]) lines.push(esc(surfLines[lang]!));
        if (ev) lines.push(esc(ev));
        if (nIssues) lines.push(`🔧 ${ru ? `${nIssues} ${ruPl(nIssues, 'открытая поломка', 'открытые поломки', 'открытых поломок')} в доме` : `${nIssues} open ${nIssues === 1 ? 'problem' : 'problems'} in the house`}`);
        if (!lines.length) return null;
        const wd = dtf(ru ? 'ru-RU' : 'en-GB', { timeZone: ctx.tz, weekday: 'long' }).format(new Date());
        const dn = Number(dtf('en-GB', { timeZone: ctx.tz, day: 'numeric' }).format(new Date()));
        const head = `☀️ <b>${t(lang, 'dg_hello')} ${esc(short)}, ${wd} ${ru ? `${dn}-е` : dn}</b>`;
        const buttons: InlineButton[][] = [[{ text: t(lang, 'dg_open'), web_app: { url: appUrl(env, `/s/${s.id}/today`) } }]];
        const row2: InlineButton[] = [];
        if (owner && nDrafts) row2.push({ text: t(lang, 'dg_approve'), web_app: { url: appUrl(env, `/s/${s.id}/approve`) } });
        if (nNew) row2.push({ text: t(lang, 'dg_new_btn'), web_app: { url: appUrl(env, `/s/${s.id}/deck`) } });
        if (row2.length) buttons.push(row2);
        return { text: [head, ...lines].join('\n\n'), buttons };
      };
      // Send first; the "sent" marks go in one batch after the sends that worked (a failed DM is retried next tick).
      const marks: D1PreparedStatement[] = [];
      try {
        for (const p of todo) {
          if (r0 && !r0.budget.canCommit(marks.length + 1)) break;
          const ev = afishaOn(p.afisha, s.status) && ['owner', 'member'].includes(p.role) ? evLines[`${p.lang}:${p.nightlife === 0 ? 'off' : 'on'}`] ?? null : null;
          const m = build(p.lang, p.role === 'owner', ['owner', 'member'].includes(p.role), surfOn(p.surf, s.brief), ev);
          if (!m || (await dm(env, p.tg_user_id, m.text, m.buttons))) marks.push(env.DB.prepare('INSERT OR IGNORE INTO sent_marks (key, at) VALUES (?,?)').bind(keyOf(s.id, p.user_id, day), now()));
        }
      } finally {
        await commit(env, marks);
      }
    } catch (e) {
      if (e instanceof BudgetOut) throw e;
      console.error('digest', s.id, String((e as Error)?.message ?? e));
    }
  }
}

/**
 * (g) Power tokens: when the estimated balance lasts ≤ 3 days, DM the members once per reading
 * (after 08:00 local, outside quiet hours, members with notifications on).
 */
async function powerReminders(env: Env) {
  const sids = (await env.DB.prepare(`SELECT DISTINCT r.search_id FROM meter_readings r JOIN searches s ON s.id=r.search_id
    WHERE s.status='living' AND r.kind='reading' AND r.at > ?`).bind(new Date(Date.now() - 21 * 864e5).toISOString()).all<{ search_id: string }>()).results ?? [];
  for (const { search_id: sid } of sids) {
    try {
      const rows = (await env.DB.prepare('SELECT id, kind, kwh, amount, photo, at FROM meter_readings WHERE search_id=? ORDER BY at DESC LIMIT 100').bind(sid).all<any>()).results ?? [];
      const pv = powerView(rows);
      if (pv.days_left == null || pv.days_left > 3) continue;
      const last = rows.filter((r) => r.kind !== 'photo').sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
      const key = `power:${sid}:${last?.id ?? ''}`;
      if (await env.DB.prepare('SELECT 1 FROM sent_marks WHERE key=?').bind(key).first()) continue;
      const ctx = await searchCtx(env, sid);
      if (!ctx || localMinutes(ctx.tz) < 8 * 60 || quietLeft(ctx.quiet, ctx.tz) > 0) continue;
      const ins = await env.DB.prepare('INSERT OR IGNORE INTO sent_marks (key, at) VALUES (?,?)').bind(key, now()).run();
      if (!ins.meta.changes) continue;
      const pack = (await packData(env))?.[countryOf(ctx.s.region)]?.power;
      const days = Math.max(0, Math.round(pv.days_left));
      await dmMembers(env, sid, (lang) => {
        const how = pack?.tokens ? (lang === 'ru' ? pack.tokens.ru : pack.tokens.en) ?? pack.tokens.en : null;
        return {
          text: [t(lang, 'pw_low', { n: days, kwh: Math.round(pv.balance ?? 0) }), how ? esc(how) : null].filter(Boolean).join('\n'),
          buttons: [[{ text: t(lang, 'pw_open'), web_app: { url: appUrl(env, `/s/${sid}/power`) } }]],
        };
      }, { quiet: 'send' });
    } catch (e) {
      console.error('power', sid, String((e as Error)?.message ?? e));
    }
  }
}

/**
 * (h) Visa: a member whose visa ends before the lease does gets a DM `remind_days_before` days before the apply-by date
 * (visa expiry − pack `visa.extend_lead_days`), 3 days before it and on the day. Only that member; once per offset.
 */
async function visaReminders(env: Env) {
  const rows = (await env.DB.prepare(`SELECT m.search_id, m.user_id, m.visa_until, m.notify, u.tg_user_id, u.lang, s.region, s.brief,
      (SELECT data FROM deals d WHERE d.search_id=m.search_id ORDER BY updated_at DESC LIMIT 1) deal
    FROM members m JOIN users u ON u.id=m.user_id JOIN searches s ON s.id=m.search_id
    WHERE m.visa_until IS NOT NULL AND s.status IN ('found','living') AND u.tg_user_id IS NOT NULL AND m.notify=1`).all<any>()).results ?? [];
  if (!rows.length) return;
  const packs = await packData(env);
  for (const r of rows) {
    try {
      const visa = packs?.[countryOf(r.region)]?.visa ?? {};
      const lead = Number(visa.extend_lead_days) || 7;
      const before = Number(visa.remind_days_before) || 14;
      const leaseTo = parseJson<any>(r.deal, {})?.terms?.to;
      if (leaseTo && String(leaseTo).slice(0, 10) <= r.visa_until) continue; // the visa outlives the lease
      const tz = parseJson<any>(r.brief, {}).timezone || regionTz(r.region);
      const today = localDay(tz);
      const applyBy = new Date(Date.parse(r.visa_until + 'T00:00:00Z') - lead * 864e5).toISOString().slice(0, 10);
      const left = daysUntil(applyBy, today);
      const offset = [before, 3, 0].find((o) => o === left);
      if (offset === undefined) continue;
      const key = `visa:${r.search_id}:${r.user_id}:${r.visa_until}:${offset}`;
      if (await env.DB.prepare('SELECT 1 FROM sent_marks WHERE key=?').bind(key).first()) continue;
      const ctx = await searchCtx(env, r.search_id);
      if (!ctx || localMinutes(tz) < 8 * 60 || quietLeft(ctx.quiet, tz) > 0) continue;
      const ins = await env.DB.prepare('INSERT OR IGNORE INTO sent_marks (key, at) VALUES (?,?)').bind(key, now()).run();
      if (!ins.meta.changes) continue;
      const fmt = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
      await dm(env, r.tg_user_id, t(r.lang, 'visa_remind', { until: fmt(r.visa_until), by: fmt(applyBy) }),
        [[{ text: t(r.lang, 'visa_open'), web_app: { url: appUrl(env, `/s/${r.search_id}/important`) } }]]);
    } catch (e) {
      console.error('visa', r.search_id, String((e as Error)?.message ?? e));
    }
  }
}

const cronCtx = () => ({ dmMembers, dm, searchCtx, localDay, localMinutes, quietLeft, appUrl, esc });

export async function runCron(env: Env): Promise<void> {
  // A counting D1 binding and per-run caches: each tick stays inside the free tier's per-invocation limits.
  const budget = new Budget();
  const cronEnv = { ...env, DB: countingDB(env.DB, budget), __run: { ctx: new Map(), rcpt: new Map(), budget } } as Env;
  const jobs = [['viewings', viewingReminders], ['dates', dateReminders], ['digest', morningDigest], ['ratings', rateReminders], ['power', powerReminders], ['visa', visaReminders],
    ['bikes', (e: Env) => bikeReminders(e, cronCtx())], ['calendar', (e: Env) => calendarReminders(e, cronCtx())],
    ['renewal', (e: Env) => renewalCron(e, cronCtx())], ['guests', expireGuests], ['counters', pruneCounters], ['access', accessCron], ['stage', stageCron], ['afisha', afishaCron], ['party', partyCron], ['feedback', feedbackCron], ['shares', sharesCron]] as const;
  // The outbox and the sets' reminders first (time-sensitive; one query when nothing is due), then the rest starting at a
  // different job every tick, so a busy job never starves the others.
  const shift = Math.floor(Date.now() / 900e3) % jobs.length;
  const order = [['outbox', flushOutbox] as const, ['sets', setsCron] as const, ...jobs.slice(shift), ...jobs.slice(0, shift)];
  for (const [name, f] of order) {
    try { await f(cronEnv); } catch (e) {
      if (e instanceof BudgetOut) { console.log('cron budget used up at', name, '- the next tick continues'); return; }
      console.error('cron', name, e);
    }
  }
}
