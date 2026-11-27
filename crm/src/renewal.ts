// Split from wave5.ts.
import { daysUntil } from './deal';
import { homeListing } from './homepoint';
import { addDays, isDay, localDay, searchTzOf, txt } from './local';
import { Env, HttpError, event, now, parseJson, rid } from './util';

// ---------------------------------------------------------------- what next (renewal)

export const NEXT_CHOICES = ['stay', 'new', 'leave'] as const;
const RENEWAL_SQL = `SELECT r.*, (SELECT json_group_array(json_object('user_id', v.user_id, 'name', u.display_name, 'choice', v.choice, 'at', v.at))
  FROM renewal_votes v JOIN users u ON u.id=v.user_id WHERE v.renewal_id=r.id) votes_json
  FROM renewals r WHERE r.search_id=?1 AND (r.status='open' OR r.decided_at > ?2) ORDER BY r.created_at DESC LIMIT 1`;
export const renewalSql = (env: Env, sid: string) => env.DB.prepare(RENEWAL_SQL).bind(sid, new Date(Date.now() - 30 * 864e5).toISOString());
export function renewalFromRow(r: any, voters = 0) {
  if (!r) return null;
  const votes = parseJson<any[]>(r.votes_json, []).filter((v) => v && v.user_id);
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: r.id, status: r.status, lease_to: r.lease_to, deadline: addDays(r.lease_to, -28), weeks_left: Math.max(0, Math.round(daysUntil(r.lease_to, today) / 7)),
    days_left: daysUntil(r.lease_to, today), note: r.note, choice: r.choice, decided_how: r.decided_how, decided_at: r.decided_at, votes, voters, new_search_id: r.new_search_id, listing_id: r.listing_id,
  };
}
async function voterCount(env: Env, sid: string) {
  return Number((await env.DB.prepare(`SELECT COUNT(*) n FROM members WHERE search_id=? AND role IN ('owner','member')`).bind(sid).first<any>())?.n ?? 0);
}
export async function renewalView(env: Env, sid: string) {
  return renewalFromRow(await renewalSql(env, sid).first<any>(), await voterCount(env, sid));
}
export async function ensureRenewal(env: Env, sid: string, leaseTo: string, listingId: string | null, note?: string | null) {
  if (!isDay(leaseTo)) throw new HttpError(400, 'bad_date', 'lease_to must be YYYY-MM-DD');
  const t = now();
  const r = await env.DB.prepare(`INSERT OR IGNORE INTO renewals (id, search_id, listing_id, lease_to, status, note, created_at, updated_at) VALUES (?,?,?,?, 'open', ?,?,?)`)
    .bind(rid('rn_'), sid, listingId, leaseTo, note ?? null, t, t).run();
  return !!r.meta.changes;
}
const NEXT_TEXT: Record<string, { ru: string; en: string }> = {
  stay: { ru: 'Решили остаться: спроси у хозяина цену и условия нового договора напрямую (черновик на одобрение)', en: 'We stay: ask the landlord for the price and terms of a new direct contract (a draft for approval)' },
  new: { ru: 'Решили искать новое: запусти новый поиск по старому брифу (search_clone), с учётом досье, заметок и мест', en: 'We look for a new place: start a new search from the old brief (search_clone), using the dossier, notes and places' },
  leave: { ru: 'Решили уезжать: запусти выезд (moveout_set), 3D-сканы выезда и вещи на продажу', en: 'We leave: start the move-out (moveout_set), move-out 3D scans and things for sale' },
};
export async function voteNext(env: Env, sid: string, user: { id: string; display_name: string; lang: string }, choice: string) {
  if (!(NEXT_CHOICES as readonly string[]).includes(choice)) throw new HttpError(400, 'bad_choice', 'choice must be stay, new or leave');
  const r = await env.DB.prepare(`SELECT * FROM renewals WHERE search_id=? AND status='open' ORDER BY created_at DESC LIMIT 1`).bind(sid).first<any>();
  if (!r) throw new HttpError(404, 'no_renewal');
  await env.DB.prepare('INSERT INTO renewal_votes (renewal_id, user_id, choice, at) VALUES (?,?,?,?) ON CONFLICT(renewal_id, user_id) DO UPDATE SET choice=excluded.choice, at=excluded.at').bind(r.id, user.id, choice, now()).run();
  await event(env, sid, 'next_vote', r.id, user.id, { name: user.display_name, choice });
  const voters = ((await env.DB.prepare(`SELECT m.user_id, m.role, v.choice FROM members m LEFT JOIN renewal_votes v ON v.renewal_id=? AND v.user_id=m.user_id WHERE m.search_id=? AND m.role IN ('owner','member')`).bind(r.id, sid).all<any>()).results ?? []);
  const tally: Record<string, number> = {};
  for (const v of voters) if (v.choice) tally[v.choice] = (tally[v.choice] ?? 0) + 1;
  const n = voters.length;
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  let decided: string | null = null, how: string | null = null;
  if (top[0] && top[0][1] > n / 2) { decided = top[0][0]; how = 'majority'; }
  else if (voters.every((v) => v.choice) && top.length) {
    const tied = top.filter((x) => x[1] === top[0][1]).map((x) => x[0]);
    if (tied.length === 1) { decided = tied[0]; how = 'majority'; }
    else { const ow = voters.find((v) => v.role === 'owner')?.choice; decided = ow && tied.includes(ow) ? ow : tied[0]; how = 'owner'; }
  }
  if (decided) {
    const upd = await env.DB.prepare(`UPDATE renewals SET status='decided', choice=?, decided_how=?, decided_at=?, updated_at=? WHERE id=? AND status='open'`).bind(decided, how, now(), now(), r.id).run();
    if (upd.meta.changes) {
      const owner = await env.DB.prepare('SELECT lang FROM users WHERE id=(SELECT owner_id FROM searches WHERE id=?)').bind(sid).first<any>();
      const L = owner?.lang === 'en' ? 'en' : 'ru';
      await event(env, sid, 'instruction', r.id, user.id, { name: user.display_name, kind: `next_${decided}`, text: NEXT_TEXT[decided][L], lease_to: r.lease_to, listing_id: r.listing_id, votes: tally, decided_how: how });
    }
  }
  return renewalView(env, sid);
}

/** Cron: an open renewal 42 days before the lease end (DM to every member), a reminder to the undecided at 28 days. */
export async function renewalCron(env: Env, c: { dm: (env: Env, chat: number, text: string, buttons?: any[][]) => Promise<boolean>; searchCtx: (env: Env, sid: string) => Promise<any>; localMinutes: (tz: string) => number; quietLeft: (q: any, tz: string) => number; appUrl: (env: Env, h: string) => string }) {
  // Wave 6: the lease end is the latest signed term's end (extensions in deal_terms), else the deal's terms.to.
  const rows = (await env.DB.prepare(`SELECT d.listing_id, d.search_id, d.data, s.region, s.brief,
      (SELECT MAX(date_to) FROM deal_terms t WHERE t.search_id=d.search_id AND t.status!='draft') t_to
    FROM deals d JOIN searches s ON s.id=d.search_id WHERE s.status IN ('found','living')`).all<any>()).results ?? [];
  for (const r of rows) {
    try {
      const to = [String(parseJson<any>(r.data, {})?.terms?.to ?? '').slice(0, 10), String(r.t_to ?? '')].filter(isDay).sort().pop() ?? '';
      if (!isDay(to)) continue;
      const tz = searchTzOf(r);
      const left = daysUntil(to, localDay(tz));
      if (left > 42 || left < 0) continue;
      const ctx = await c.searchCtx(env, r.search_id);
      if (!ctx || c.localMinutes(tz) < 8 * 60 || c.quietLeft(ctx.quiet, tz) > 0) continue;
      const created = await ensureRenewal(env, r.search_id, to, r.listing_id);
      const rn = await env.DB.prepare(`SELECT * FROM renewals WHERE search_id=? AND lease_to=?`).bind(r.search_id, to).first<any>();
      if (!rn || rn.status !== 'open') continue;
      const stage = created || left > 28 ? 6 : 4;
      if (stage === 4 && left > 28) continue;
      if (!(await once(env, `renewal:${rn.id}:${stage}`))) continue;
      if (created) await event(env, r.search_id, 'renewal', rn.id, 'system', { lease_to: to });
      const people = (await env.DB.prepare(`SELECT u.tg_user_id, u.lang, m.user_id FROM members m JOIN users u ON u.id=m.user_id
        WHERE m.search_id=? AND m.role IN ('owner','member') AND m.notify=1 AND u.tg_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM renewal_votes v WHERE v.renewal_id=? AND v.user_id=m.user_id)`).bind(r.search_id, rn.id).all<any>()).results ?? [];
      const weeks = Math.max(1, Math.round(left / 7));
      for (const p of people) {
        const ru = p.lang !== 'en';
        const text = ru ? `🗓 До конца договора ${weeks} ${weeks === 1 ? 'неделя' : weeks < 5 ? 'недели' : 'недель'}. Что дальше: остаёмся, ищем новое или уезжаем? Проголосуй в Hunt.`
          : `🗓 The lease ends in ${weeks} week${weeks === 1 ? '' : 's'}. What next: stay, look for a new place or leave? Vote in Hunt.`;
        await c.dm(env, p.tg_user_id, text, [[{ text: ru ? 'Что дальше?' : 'What next?', web_app: { url: c.appUrl(env, `/s/${r.search_id}/next`) } }]]);
      }
    } catch (e) { console.error('renewal', r.search_id, String((e as Error)?.message ?? e)); }
  }
}
async function once(env: Env, key: string) {
  const ins = await env.DB.prepare('INSERT OR IGNORE INTO sent_marks (key, at) VALUES (?,?)').bind(key, now()).run();
  return !!ins.meta.changes;
}

/** A new search from an old one: same region, brief (move_in = the lease end), members (not guests), own places. */
export async function cloneSearch(env: Env, s: any, b: any, ownerId: string) {
  const brief = typeof s.brief === 'string' ? parseJson<any>(s.brief, {}) : { ...(s.brief ?? {}) };
  const hl = await homeListing(env, s.id);
  // Wave 6: the lease end is the latest signed extension's end when there is one.
  const ext = await env.DB.prepare(`SELECT MAX(date_to) t FROM deal_terms WHERE search_id=? AND status!='draft'`).bind(s.id).first<any>();
  const leaseTo = [String(parseJson<any>(hl?.deal_data, {})?.terms?.to ?? '').slice(0, 10), String(ext?.t ?? '')].filter(isDay).sort().pop() ?? '';
  brief.move_in = isDay(b.move_in) ? b.move_in : isDay(leaseTo) ? leaseTo : brief.move_in ?? null;
  if (b.term) brief.term = String(b.term).slice(0, 40);
  const id = rid('s_'), code = rid(''), t = now();
  const title = txt(b.title, 120) ?? `${String(s.title).split(/[,·]/)[0].trim()} · ${brief.move_in ? brief.move_in.slice(0, 7) : 'new'}`;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO searches (id, owner_id, title, region, brief, approval_mode, money_mode, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(id, ownerId, title, s.region, JSON.stringify(brief), s.approval_mode ?? 'ask', s.money_mode ?? 'split', t, t),
    env.DB.prepare(`INSERT INTO members (search_id, user_id, role, notify, digest, animal, reveal_seen_at, surf) SELECT ?, user_id, role, notify, digest, animal, reveal_seen_at, surf FROM members WHERE search_id=?`).bind(id, s.id),
    env.DB.prepare("INSERT INTO invites (code, kind, search_id, created_by, max_uses, created_at) VALUES (?, 'member', ?, ?, 50, ?)").bind(code, id, ownerId, t),
    env.DB.prepare(`INSERT INTO places (id, search_id, source, list_name, name, type, tier, note, address, lat, lng, area, url, ext_key, hidden, created_by, created_at, updated_at)
      SELECT 'pl_' || lower(hex(randomblob(8))), ?, source, list_name, name, type, tier, note, address, lat, lng, area, url, ext_key, hidden, created_by, ?, ? FROM places WHERE search_id=?`).bind(id, t, t, s.id),
    env.DB.prepare(`UPDATE renewals SET new_search_id=?, updated_at=? WHERE search_id=? AND status='decided' AND choice='new' AND new_search_id IS NULL`).bind(id, t, s.id),
  ]);
  await event(env, s.id, 'cloned', id, 'agent', { title });
  await event(env, id, 'note', s.id, 'agent', { text: `cloned from ${s.id}` });
  return { id, code, title };
}
