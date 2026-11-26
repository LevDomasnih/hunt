// Split from wave4.ts.
import { isDay } from './check';
import { daysUntil } from './deal';
import { packData } from './life';
import { countryOf } from './members';
import { Env, now, parseJson } from './util';

// ---------------------------------------------------------------- reminders (cron)

type DmFn = (env: Env, sid: string, build: (lang: string) => { text: string; buttons?: any[][] }, opts: any) => Promise<number>;
interface CronCtx { dmMembers: DmFn; dm: (env: Env, chat: number, text: string, buttons?: any[][]) => Promise<boolean>; searchCtx: (env: Env, sid: string) => Promise<any>; localDay: (tz: string) => string; localMinutes: (tz: string) => number; quietLeft: (q: any, tz: string) => number; appUrl: (env: Env, h: string) => string; esc: (s: unknown) => string }

const fmtDM = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
async function once(env: Env, key: string) {
  if (await env.DB.prepare('SELECT 1 FROM sent_marks WHERE key=?').bind(key).first()) return false;
  const ins = await env.DB.prepare('INSERT OR IGNORE INTO sent_marks (key, at) VALUES (?,?)').bind(key, now()).run();
  return !!ins.meta.changes;
}

/** Bikes: payment 2 days before paid_until and on the day; return on return_date. To the rider (or everyone for a shared bike). */
export async function bikeReminders(env: Env, c: CronCtx) {
  const rows = (await env.DB.prepare(`SELECT b.*, s.region FROM bikes b JOIN searches s ON s.id=b.search_id WHERE b.status='active' AND s.status!='closed' AND (b.paid_until IS NOT NULL OR b.return_date IS NOT NULL)`).all<any>()).results ?? [];
  for (const b of rows) {
    try {
      const ctx = await c.searchCtx(env, b.search_id);
      if (!ctx || c.localMinutes(ctx.tz) < 8 * 60 || c.quietLeft(ctx.quiet, ctx.tz) > 0) continue;
      const today = c.localDay(ctx.tz);
      const todo: { key: string; kind: string; d: string; left: number }[] = [];
      if (b.paid_until) { const left = daysUntil(b.paid_until, today); if (left === 2 || left === 0) todo.push({ key: `bike:${b.id}:pay:${b.paid_until}:${left}`, kind: 'pay', d: b.paid_until, left }); }
      if (b.return_date && daysUntil(b.return_date, today) === 0) todo.push({ key: `bike:${b.id}:ret:${b.return_date}`, kind: 'ret', d: b.return_date, left: 0 });
      for (const x of todo) {
        if (!(await once(env, x.key))) continue;
        const name = `${b.model}${b.plate ? ' · ' + b.plate : ''}`;
        const build = (lang: string) => {
          const ru = lang === 'ru';
          const head = x.kind === 'ret' ? (ru ? '🛵 Сегодня вернуть байк' : '🛵 Return the bike today') : x.left === 0 ? (ru ? '🛵 Сегодня оплата байка' : '🛵 Bike rent due today') : (ru ? `🛵 Через 2 дня оплата байка (до ${fmtDM(x.d)})` : `🛵 Bike rent due in 2 days (by ${fmtDM(x.d)})`);
          return { text: `${head}: <b>${c.esc(name)}</b>${b.rental_name ? ` · ${c.esc(b.rental_name)}` : ''}`, buttons: [[{ text: ru ? 'Байки' : 'Bikes', web_app: { url: c.appUrl(env, `/s/${b.search_id}/bikes`) } }]] };
        };
        if (b.rider_id) {
          const u = await env.DB.prepare('SELECT u.tg_user_id, u.lang FROM users u JOIN members m ON m.user_id=u.id AND m.search_id=? WHERE u.id=? AND m.notify=1').bind(b.search_id, b.rider_id).first<any>();
          if (u?.tg_user_id) { const m = build(u.lang); await c.dm(env, u.tg_user_id, m.text, m.buttons); }
        } else await c.dmMembers(env, b.search_id, build, { quiet: 'send' });
      }
    } catch (e) { console.error('bikes', b.id, String((e as Error)?.message ?? e)); }
  }
}

/** Local calendar (pack calendar.yaml): `remind[].days` before an event, for searches that are found / living while the lease covers it. */
export async function calendarReminders(env: Env, c: CronCtx) {
  const packs = await packData(env);
  const rows = (await env.DB.prepare(`SELECT s.id, s.region, (SELECT data FROM deals d WHERE d.search_id=s.id ORDER BY updated_at DESC LIMIT 1) deal FROM searches s WHERE s.status IN ('found','living')`).all<any>()).results ?? [];
  for (const s of rows) {
    try {
      const cal = packs?.[countryOf(s.region)]?.calendar;
      if (!cal?.events?.length) continue;
      const ctx = await c.searchCtx(env, s.id);
      if (!ctx || c.localMinutes(ctx.tz) < 8 * 60 || c.quietLeft(ctx.quiet, ctx.tz) > 0) continue;
      const today = c.localDay(ctx.tz);
      const terms = parseJson<any>(s.deal, {})?.terms ?? {};
      for (const ev of cal.events) {
        if (!isDay(ev.date) || !Array.isArray(ev.remind)) continue;
        if (terms.to && String(terms.to).slice(0, 10) < ev.date) continue;
        for (const r of ev.remind) {
          const days = Number(r?.days);
          if (!Number.isFinite(days) || daysUntil(ev.date, today) !== days) continue;
          if (!(await once(env, `cal:${s.id}:${ev.id}:${days}`))) continue;
          await c.dmMembers(env, s.id, (lang) => {
            const L = (o: any) => o?.[lang] ?? o?.en ?? '';
            return { text: `📅 <b>${c.esc(L(r.title) || L(ev.title))}</b> · ${c.esc(L(ev.title))} ${fmtDM(ev.date)}${L(r.note) ? `\n${c.esc(L(r.note))}` : ''}`,
              buttons: [[{ text: lang === 'ru' ? 'Календарь' : 'Calendar', web_app: { url: c.appUrl(env, `/s/${s.id}/calendar`) } }]] };
          }, { quiet: 'send' });
        }
      }
    } catch (e) { console.error('calendar', s.id, String((e as Error)?.message ?? e)); }
  }
}
