// Wave 6: the project pipeline (one lifecycle per search: start → search → viewings → choice → deal → move-in → living →
// what next → move-out, plus extensions and closed). Loads the data for stage-derive.ts in ONE D1 statement, stores the
// effective stage (manual override or derived) with a small history, writes `stage_changed` events and DMs the members on
// major transitions. Also: lease terms ≥ 2 (deal_terms), the closed-project guard for Mini App writes, the cron pass.
import { Env, HttpError, json, body, now, rid, parseJson, event, sensitive } from './util';
import { ownerOfSearch, requireContact } from './household';
import { regionTz } from './members';
import { withSrc } from './media';
import { dealDates, cleanDates } from './deal';
import { dmMembers } from './notify';
import { localDay } from './local';
import { derivePath, stageIdx, STAGE_KEYS, MAJOR_STAGES, PathInput, Derived, addDays, daysBetween } from './stage-derive';

export { STAGE_KEYS, stageIdx } from './stage-derive';

// Everything the derivation needs, as one statement (one D1 query; the state call stays far below 50).
const PATH_SQL = `SELECT s.id, s.owner_id, s.title, s.region, s.brief, s.status, s.created_at, s.stage, s.stage_manual, s.stage_changed_at, s.stage_history,
  s.home_listing_id, s.closed_at,
  (SELECT COUNT(*) FROM members WHERE search_id=s.id) members,
  (SELECT COUNT(*) FROM members WHERE search_id=s.id AND role IN ('owner','member')) voters,
  (SELECT json_object('n', COUNT(*), 'first', MIN(created_at), 'last', MAX(created_at)) FROM listings WHERE search_id=s.id) lst,
  (SELECT json_object('contacted', COUNT(DISTINCT CASE WHEN direction='out' THEN contact_id END), 'replied', COUNT(DISTINCT CASE WHEN direction='in' THEN contact_id END),
      'first', MIN(CASE WHEN direction='out' THEN at END), 'last', MAX(at))
    FROM (SELECT contact_id, direction, at FROM messages WHERE search_id=s.id
          UNION ALL SELECT contact_id, direction, at FROM messages WHERE search_id IS NULL AND listing_id IN (SELECT id FROM listings WHERE search_id=s.id))) msg,
  (SELECT json_object('n', COUNT(*), 'days', COUNT(DISTINCT substr(starts_at,1,10)), 'first', MIN(starts_at), 'last', MAX(starts_at),
      'upcoming', coalesce(SUM(CASE WHEN status IN ('proposed','confirmed') AND datetime(starts_at) >= datetime(?2) THEN 1 ELSE 0 END), 0),
      'past', coalesce(SUM(CASE WHEN status='done' OR datetime(starts_at) < datetime(?2) THEN 1 ELSE 0 END), 0))
    FROM viewings WHERE search_id=s.id AND status!='cancelled') vw,
  (SELECT json_group_array(json_object('id', l.id, 'title', l.title, 'decision', l.decision, 'status', l.status, 'decided_at', l.decided_at, 'updated_at', l.updated_at,
      'takes', (SELECT COUNT(*) FROM votes v WHERE v.listing_id=l.id AND v.decision='take'), 'photos', CASE WHEN json_valid(l.photos) THEN json(l.photos) ELSE json('[]') END))
    FROM listings l WHERE l.search_id=s.id AND (l.decision='take' OR l.status='taken' OR l.id=s.home_listing_id
      OR l.id IN (SELECT listing_id FROM deals WHERE search_id=s.id) OR EXISTS (SELECT 1 FROM votes v WHERE v.listing_id=l.id AND v.decision='take'))) cand,
  (SELECT json_object('listing_id', d.listing_id, 'data', CASE WHEN json_valid(d.data) THEN json(d.data) ELSE json('{}') END, 'deal_at', d.deal_at, 'updated_at', d.updated_at)
    FROM deals d WHERE d.search_id=s.id ORDER BY d.updated_at DESC LIMIT 1) deal,
  (SELECT json_group_array(json_object('id', id, 'title', title, 'status', status, 'signed_at', signed_at, 'has_file', tg_file_id IS NOT NULL, 'term_seq', term_seq))
    FROM documents WHERE search_id=s.id AND kind='lease') leases,
  (SELECT COUNT(*) FROM documents WHERE search_id=s.id AND kind='movein_video' AND tg_file_id IS NOT NULL) mv_video,
  (SELECT COUNT(*) FROM scans WHERE search_id=s.id AND phase='movein' AND status='ok') mv_scans,
  (SELECT COUNT(*) FROM meter_readings WHERE search_id=s.id AND kind='reading') mv_meters,
  (SELECT COUNT(*) FROM house_contacts WHERE search_id=s.id) mv_contacts,
  (SELECT name FROM house_contacts WHERE search_id=s.id AND role='owner' ORDER BY sort LIMIT 1) owner_name,
  (SELECT json_object('status', r.status, 'choice', r.choice, 'lease_to', r.lease_to, 'decided_at', r.decided_at, 'new_search_id', r.new_search_id,
      'votes', (SELECT COUNT(*) FROM renewal_votes WHERE renewal_id=r.id)) FROM renewals r WHERE r.search_id=s.id ORDER BY r.created_at DESC LIMIT 1) rn,
  (SELECT json_object('date', date, 'steps', CASE WHEN json_valid(steps) THEN json(steps) ELSE json('{}') END) FROM moveouts WHERE search_id=s.id) mo,
  (SELECT json_object('status', status, 'date_from', date_from, 'date_to', date_to) FROM relets WHERE search_id=s.id) rl,
  (SELECT json_group_array(json_object('id', id, 'seq', seq, 'listing_id', listing_id, 'kind', kind, 'date_from', date_from, 'date_to', date_to, 'rent', rent, 'currency', currency,
      'deposit', deposit, 'deposit_prev', deposit_prev, 'deposit_prev_amount', deposit_prev_amount, 'landlord', landlord, 'landlord_contact_id', landlord_contact_id, 'status', status,
      'dates', CASE WHEN json_valid(dates) THEN json(dates) ELSE json('[]') END, 'checklist', CASE WHEN json_valid(checklist) THEN json(checklist) ELSE json('[]') END, 'note', note,
      'updated_at', updated_at))
    FROM (SELECT * FROM deal_terms WHERE search_id=s.id ORDER BY seq)) terms
FROM searches s WHERE s.id=?1`;

const tzOf = (row: { region?: string; brief?: any }) => (typeof row.brief === 'string' ? parseJson<any>(row.brief, {}) : row.brief ?? {}).timezone || regionTz(row.region);
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** The search row + the derivation input. `today` (YYYY-MM-DD) overrides the search's local day (tests, previews). */
export async function loadPath(env: Env, sid: string, today?: string | null): Promise<{ row: any; input: PathInput }> {
  const row = await env.DB.prepare(PATH_SQL).bind(sid, now()).first<any>();
  if (!row) throw new HttpError(404, 'no_search');
  const brief = parseJson<any>(row.brief, {});
  const j = (v: any, f: any) => (typeof v === 'string' ? parseJson(v, f) : v ?? f);
  const lst = j(row.lst, {}), msg = j(row.msg, {}), vw = j(row.vw, {});
  const day = isDay(today) ? today : localDay(tzOf({ region: row.region, brief }));
  const input: PathInput = {
    today: day,
    now: isDay(today) ? `${today}T12:00:00.000Z` : now(),
    search: {
      id: row.id, status: row.status, created_at: row.created_at, brief, stage: row.stage, stage_manual: row.stage_manual, stage_changed_at: row.stage_changed_at,
      stage_history: j(row.stage_history, []), home_listing_id: row.home_listing_id, closed_at: row.closed_at,
    },
    members: Number(row.members) || 0, voters: Number(row.voters) || 0,
    listings: { n: Number(lst.n) || 0, first: lst.first ?? null, last: lst.last ?? null },
    msgs: { contacted: Number(msg.contacted) || 0, replied: Number(msg.replied) || 0, first: msg.first ?? null, last: msg.last ?? null },
    viewings: { n: Number(vw.n) || 0, days: Number(vw.days) || 0, first: vw.first ?? null, last: vw.last ?? null, upcoming: Number(vw.upcoming) || 0, past: Number(vw.past) || 0 },
    candidates: j(row.cand, []).filter((c: any) => c?.id).map((c: any) => ({ ...c, takes: Number(c.takes) || 0 })),
    deal: row.deal ? j(row.deal, null) : null,
    leases: j(row.leases, []).filter((d: any) => d?.id),
    movein: { video: Number(row.mv_video) > 0, scans: Number(row.mv_scans) || 0, meters: Number(row.mv_meters) || 0, contacts: Number(row.mv_contacts) || 0, owner: row.owner_name ?? null },
    renewal: row.rn ? j(row.rn, null) : null,
    moveout: row.mo ? j(row.mo, null) : null,
    relet: row.rl ? j(row.rl, null) : null,
    terms: j(row.terms, []).filter((t: any) => t?.id),
  };
  if (input.deal) input.deal.title = input.candidates.find((c) => c.id === input.deal!.listing_id)?.title ?? null;
  return { row, input };
}

/** The `path` object of the Mini App state (contract in wave6-contract.md) for a role. */
export function pathView(d: Derived, input: PathInput, row: any, role: string) {
  const full = role === 'owner' || role === 'member';
  const home = d.home_listing_id ? input.candidates.find((c: any) => c.id === d.home_listing_id) as any : null;
  const photo = home ? withSrc(home.id, Array.isArray(home.photos) ? home.photos : [])[0] ?? null : null;
  return {
    key: d.key, idx: d.idx, n: 9, derived_key: d.derived_key, manual: !!d.manual && !d.closed, manual_key: d.closed ? null : d.manual, closed: d.closed,
    at: row.stage_changed_at ?? null, date: d.date, today: input.today, can_edit: role === 'owner',
    home_listing_id: d.home_listing_id,
    home: home ? { listing_id: home.id, title: (input.deal?.listing_id === home.id ? input.deal?.data?.name : null) ?? home.title, photo: photo?.src ?? photo?.url ?? null } : null,
    terms: full ? d.terms.map(({ dates, checklist, signed, ...t }) => ({ ...t, signed, dates: dates.length })) : [],
    rows: full ? d.rows : d.rows.map((r) => (r.key === 'deal' ? { ...r, facts: { ...r.facts, paid: null, pending: null } } : r)),
    history: parseJson<any[]>(row.stage_history, []).slice(-30),
    closed_at: row.closed_at ?? null,
  };
}

const ru = (lang: string) => lang !== 'en';
const dm2 = (d: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : '');
/** Short bot DM for a major transition (Telegram HTML). */
function stageDm(key: string, lang: string, d: Derived, title: string): string | null {
  const home = d.choice?.title || title;
  const h = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  switch (key) {
    case 'deal': return ru(lang) ? `🏠 Выбрали дом: <b>${h(home)}</b>. Дальше договор и оплата, шаги в Hunt` : `🏠 We chose the home: <b>${h(home)}</b>. Next: the lease and the payments, step by step in Hunt`;
    case 'movein': return ru(lang) ? `🔑 Договор подписан, оплата прошла${d.date ? `. Заезд ${dm2(d.date)}` : ''}` : `🔑 The lease is signed and paid${d.date ? `. Move-in ${dm2(d.date)}` : ''}`;
    case 'next': return ru(lang) ? `🗓 Договор заканчивается${d.date ? ` ${dm2(d.date)}` : ''}. Пора решить, что дальше: остаёмся, ищем новое или уезжаем` : `🗓 The lease ends${d.date ? ` on ${dm2(d.date)}` : ''}. Time to decide: stay, look for a new place or leave`;
    case 'moveout': return ru(lang) ? `📦 Начинаем выезд${d.date ? ` ${dm2(d.date)}` : ''}: осмотр, 3D-скан, залог. Шаги в Hunt` : `📦 Move-out starts${d.date ? ` ${dm2(d.date)}` : ''}: inspection, 3D scan, deposit. Steps in Hunt`;
    case 'closed': return ru(lang) ? `📁 Проект «${h(title)}» закрыт. Досье, документы и итоги остаются в Hunt` : `📁 The project “${h(title)}” is closed. The dossier, documents and totals stay in Hunt`;
    default: return null;
  }
}

/**
 * Derive and (unless dry) store the stage. On a change: history (≤ 30), event `stage_changed` (the agent's digest and the feed),
 * a DM to the members on major transitions (once per search and stage; quiet hours postpone it). The very first computation
 * (stage NULL) only stores: no event, no DM (no burst on deploy).
 */
export async function recomputeStage(env: Env, sid: string, opts: { actor?: string; today?: string | null; dry?: boolean; note?: string | null; role?: string } = {}) {
  const { row, input } = await loadPath(env, sid, opts.today);
  const d = derivePath(input);
  const view = () => pathView(d, input, row, opts.role ?? 'owner');
  if (opts.dry) return { path: view(), changed: false, derived: d };
  const manualCol = d.closed ? (row.stage_manual ?? 'closed') : d.manual;
  const status = d.living_status && ['active', 'found'].includes(row.status) ? 'living' : row.status;
  const home = d.home_listing_id ?? row.home_listing_id ?? null;
  const stageChanged = d.key !== row.stage;
  if (!stageChanged && manualCol === row.stage_manual && home === row.home_listing_id && status === row.status) return { path: view(), changed: false, derived: d };
  const at = now();
  const actor = opts.actor ?? 'system';
  const history = parseJson<any[]>(row.stage_history, []);
  if (stageChanged) history.push({ stage: d.key, at, by: actor, manual: d.manual ? 1 : 0, ...(d.date ? { date: d.date } : {}) });
  const hist = JSON.stringify(history.slice(-30));
  // Optimistic: only the request that still sees the old stage writes (no double events from parallel state calls).
  const upd = await env.DB.prepare(`UPDATE searches SET stage=?, stage_manual=?, stage_changed_at=?, stage_history=?, home_listing_id=?, status=? WHERE id=? AND coalesce(stage,'')=?`)
    .bind(d.key, manualCol, stageChanged ? at : row.stage_changed_at, hist, home, status, sid, row.stage ?? '').run();
  if (!upd.meta.changes) return { path: view(), changed: false, derived: d };
  const prev = row.stage as string | null;
  row.stage = d.key; row.stage_manual = manualCol; row.home_listing_id = home; row.status = status; row.stage_history = hist;
  if (stageChanged) {
    row.stage_changed_at = at;
    await afterChange(env, sid, row, input, d, actor, prev, opts.note ?? null);
  }
  return { path: view(), changed: stageChanged, derived: d };
}

async function afterChange(env: Env, sid: string, row: any, input: PathInput, d: Derived, actor: string, prev: string | null, note: string | null) {
  // The first computation (no previous stage stored) is silent.
  if (!prev) return;
  await event(env, sid, 'stage_changed', sid, actor, { from: prev, to: d.key, idx: d.idx, manual: !!d.manual, date: d.date, title: d.choice?.title ?? null, ...(note ? { note } : {}) });
  if (!MAJOR_STAGES.has(d.key) || (stageIdx(d.key) < stageIdx(prev) && d.key !== 'closed')) return;
  // "What next" has its own DM from the renewal cron (42 days before the end): don't send a second one.
  if (d.key === 'next' && input.renewal?.status === 'open') return;
  const mark = await env.DB.prepare('INSERT OR IGNORE INTO sent_marks (key, at) VALUES (?,?)').bind(`stage:${sid}:${d.key}`, now()).run();
  if (!mark.meta.changes) return;
  const { appUrl } = await import('./notify');
  await dmMembers(env, sid, (lang) => ({
    text: stageDm(d.key, lang, d, row.title) ?? '',
    buttons: [[{ text: ru(lang) ? 'Путь проекта' : 'Project path', web_app: { url: appUrl(env, `/s/${sid}/path`) } }]],
  }), { quiet: 'postpone', key: `stage:${sid}:${d.key}`, votersOnly: true });
}

/**
 * Manual stage: a stage key (override until the data catches up), 'closed' (archive: read-only, guests lose access) or 'auto'
 * (clear the override; reopens a closed project). listing_id pins the home (choice) when the data has no choice yet.
 */
export async function setStage(env: Env, sid: string, stage: string, actor: string, opts: { note?: string | null; listing_id?: string | null; role?: string } = {}) {
  const note = opts.note == null ? null : String(opts.note).trim().slice(0, 300) || null;
  if (note && sensitive(note)) throw new HttpError(400, 'sensitive', 'The note looks like it contains a passport, ID or card number');
  const cur = await env.DB.prepare('SELECT status, stage, stage_manual FROM searches WHERE id=?').bind(sid).first<any>();
  if (!cur) throw new HttpError(404, 'no_search');
  const t = now();
  if (stage === 'auto') {
    await env.DB.prepare(`UPDATE searches SET stage_manual=NULL, status=CASE WHEN status='closed' THEN 'active' ELSE status END, closed_at=CASE WHEN status='closed' THEN NULL ELSE closed_at END, updated_at=? WHERE id=?`).bind(t, sid).run();
  } else if (stage === 'closed') {
    await env.DB.batch([
      env.DB.prepare(`UPDATE searches SET stage_manual='closed', status='closed', closed_at=coalesce(closed_at, ?), updated_at=? WHERE id=?`).bind(t, t, sid),
      env.DB.prepare(`UPDATE guests SET status='expired', updated_at=? WHERE search_id=? AND status='active'`).bind(t, sid),
      env.DB.prepare(`UPDATE invites SET max_uses=uses WHERE search_id=? AND kind='guest' AND uses < max_uses`).bind(sid),
    ]);
  } else if (STAGE_KEYS.includes(stage)) {
    if (cur.status === 'closed') throw new HttpError(409, 'closed', "The project is closed: reopen it first (stage 'auto')");
    let pin: string | null = null;
    if (opts.listing_id) {
      const l = await env.DB.prepare('SELECT id FROM listings WHERE id=? AND search_id=?').bind(String(opts.listing_id), sid).first<any>();
      if (!l) throw new HttpError(404, 'no_listing', 'listing_id must be a listing of this search');
      pin = l.id;
    }
    await env.DB.prepare(`UPDATE searches SET stage_manual=?, home_listing_id=coalesce(?, home_listing_id), updated_at=? WHERE id=?`).bind(stage, pin, t, sid).run();
  } else throw new HttpError(400, 'bad_stage', `stage must be one of ${STAGE_KEYS.join(', ')} or auto`);
  return recomputeStage(env, sid, { actor, note, role: opts.role });
}

// ---------------------------------------------------------------- the Mini App and agent routes

/** POST /app/api/stage {search_id, stage | 'auto', note?, listing_id?} — the search owner only. */
export async function appStage(req: Request, env: Env, user: { id: string }) {
  const b = await body(req);
  const m = await env.DB.prepare('SELECT role FROM members WHERE search_id=? AND user_id=?').bind(String(b.search_id ?? ''), user.id).first<any>();
  if (!m) throw new HttpError(403, 'not_member');
  if (m.role !== 'owner') throw new HttpError(403, 'owner_only');
  const r = await setStage(env, b.search_id, String(b.stage ?? ''), user.id, { note: b.note, listing_id: b.listing_id, role: 'owner' });
  return json({ ok: true, path: r.path });
}

/** Agent: GET/PUT /api/searches/:id/stage, GET/PUT /api/searches/:id/terms[/:seq]. `s` = the caller's own search. */
export async function handleStageAgent(req: Request, env: Env, p: string[], s: any): Promise<Response> {
  const m = req.method;
  if (p[3] === 'stage' && m === 'GET') {
    // ?today=YYYY-MM-DD previews the derivation on another day (read-only, nothing is stored).
    const today = new URL(req.url).searchParams.get('today');
    const r = await recomputeStage(env, s.id, isDay(today) ? { today, dry: true } : { actor: 'agent' });
    return json({ stage: r.path, derived: { key: r.derived.derived_key, choice: r.derived.choice } });
  }
  if (p[3] === 'stage' && m === 'PUT') {
    const b = await body(req);
    const r = await setStage(env, s.id, String(b.stage ?? ''), 'agent', { note: b.note, listing_id: b.listing_id });
    return json({ stage: r.path, changed: r.changed });
  }
  if (p[3] === 'terms' && m === 'GET' && !p[4]) return json({ terms: await termsFull(env, s.id) });
  if (p[3] === 'terms' && p[4] && m === 'GET') {
    const t = (await termsFull(env, s.id)).find((x) => String(x.seq) === p[4]);
    if (!t) throw new HttpError(404, 'no_term');
    return json({ term: t });
  }
  if (p[3] === 'terms' && p[4] && m === 'PUT') {
    const term = await setTerm(env, s, p[4], await body(req), 'agent');
    await recomputeStage(env, s.id, { actor: 'agent' }).catch((e) => console.error('stage', s.id, String(e?.message ?? e)));
    return json({ term, terms: await termsFull(env, s.id) }, term.created ? 201 : 200);
  }
  throw new HttpError(404, 'not_found');
}

/** All lease terms with their dates and checklists (seq 1 synthesized from the deal). */
export async function termsFull(env: Env, sid: string) {
  const { input } = await loadPath(env, sid);
  return derivePath(input).terms;
}

const TERM_KINDS = ['lease', 'sublease'];
const TERM_STATUS = ['draft', 'signed', 'active', 'ended'];
const DEPOSIT_PREV = ['returned', 'carried', 'pending', 'kept'];
const intOrNull = (v: unknown, k: string) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, 'bad_term', `${k} must be a positive number (main units)`);
  return Math.round(n);
};

/** PUT a lease term ≥ 2 (an extension: the same home, possibly a new landlord). seq 'new' = the next number. */
export async function setTerm(env: Env, s: { id: string }, seqArg: string, b: any, actor: string) {
  if (String(seqArg) === '1') throw new HttpError(400, 'term_one', 'The first term lives in the deal (deal_set / deal_dates_set); terms here start at seq 2');
  const DB = env.DB;
  const maxSeq = Number((await DB.prepare('SELECT MAX(seq) n FROM deal_terms WHERE search_id=?').bind(s.id).first<any>())?.n ?? 1);
  const seq = seqArg === 'new' ? Math.max(2, maxSeq + 1) : Number(seqArg);
  if (!Number.isInteger(seq) || seq < 2 || seq > 50) throw new HttpError(400, 'bad_seq', 'seq must be 2…50 or new');
  const old = await DB.prepare('SELECT * FROM deal_terms WHERE search_id=? AND seq=?').bind(s.id, seq).first<any>();
  const v = (k: string, alias?: string) => (k in b ? b[k] : alias && alias in b ? b[alias] : old?.[k] ?? null);
  const from = v('date_from', 'from'), to = v('date_to', 'to');
  if (!isDay(from)) throw new HttpError(400, 'bad_term', 'from must be YYYY-MM-DD');
  if (to != null && !isDay(to)) throw new HttpError(400, 'bad_term', 'to must be YYYY-MM-DD');
  if (to && to < from) throw new HttpError(400, 'bad_term', 'to is before from');
  const kind = v('kind');
  if (kind != null && !TERM_KINDS.includes(kind)) throw new HttpError(400, 'bad_term', `kind must be ${TERM_KINDS.join(' or ')}`);
  const status = v('status') ?? 'draft';
  if (!TERM_STATUS.includes(status)) throw new HttpError(400, 'bad_term', `status must be ${TERM_STATUS.join(', ')}`);
  const dprev = v('deposit_prev');
  if (dprev != null && !DEPOSIT_PREV.includes(dprev)) throw new HttpError(400, 'bad_term', `deposit_prev must be ${DEPOSIT_PREV.join(', ')}`);
  // The home: the given listing (of this search), else the old term's, else the deal / pinned home.
  let lid = v('listing_id');
  if (!lid) lid = (await DB.prepare(`SELECT coalesce((SELECT listing_id FROM deals WHERE search_id=?1 ORDER BY updated_at DESC LIMIT 1), home_listing_id) l FROM searches WHERE id=?1`).bind(s.id).first<any>())?.l ?? null;
  if (!lid || !(await DB.prepare('SELECT 1 FROM listings WHERE id=? AND search_id=?').bind(String(lid), s.id).first())) throw new HttpError(400, 'no_home', 'No home listing: make the deal first (deal_set) or pass listing_id');
  const cid = v('landlord_contact_id');
  if (cid && cid !== old?.landlord_contact_id) await requireContact(env, await ownerOfSearch(env, s.id), cid);
  const dates = 'dates' in b ? (b.dates == null ? [] : cleanDates(b.dates)) : parseJson<any[]>(old?.dates, []);
  const checklist = 'checklist' in b ? (Array.isArray(b.checklist) ? b.checklist.slice(0, 40).map((c: any) => (typeof c === 'string' ? { text: c.slice(0, 200), done: false } : { text: String(c?.text ?? '').slice(0, 200), done: !!c?.done })).filter((c: any) => c.text) : []) : parseJson<any[]>(old?.checklist, []);
  const row = {
    kind, status, from, to: to ?? null, rent: intOrNull(v('rent'), 'rent'), currency: v('currency') ? String(v('currency')).slice(0, 8).toUpperCase() : null,
    deposit: intOrNull(v('deposit'), 'deposit'), deposit_prev: dprev, deposit_prev_amount: intOrNull(v('deposit_prev_amount'), 'deposit_prev_amount'),
    landlord: v('landlord') == null ? null : String(v('landlord')).trim().slice(0, 120) || null, landlord_contact_id: cid ?? null,
    note: v('note') == null ? null : String(v('note')).trim().slice(0, 300) || null,
  };
  const sn = sensitive(JSON.stringify({ ...row, dates, checklist }));
  if (sn) throw new HttpError(400, 'sensitive', `The term looks like it contains ${sn}. Landlords by name only, never ID numbers.`);
  const t = now();
  await DB.prepare(`INSERT INTO deal_terms (id, search_id, listing_id, seq, kind, date_from, date_to, rent, currency, deposit, deposit_prev, deposit_prev_amount, landlord, landlord_contact_id,
      status, dates, checklist, note, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(search_id, seq) DO UPDATE SET listing_id=excluded.listing_id, kind=excluded.kind, date_from=excluded.date_from, date_to=excluded.date_to, rent=excluded.rent,
      currency=excluded.currency, deposit=excluded.deposit, deposit_prev=excluded.deposit_prev, deposit_prev_amount=excluded.deposit_prev_amount, landlord=excluded.landlord,
      landlord_contact_id=excluded.landlord_contact_id, status=excluded.status, dates=excluded.dates, checklist=excluded.checklist, note=excluded.note, updated_at=excluded.updated_at`)
    .bind(old?.id ?? rid('dt_'), s.id, lid, seq, row.kind, row.from, row.to, row.rent, row.currency, row.deposit, row.deposit_prev, row.deposit_prev_amount, row.landlord, row.landlord_contact_id,
      row.status, JSON.stringify(dates), JSON.stringify(checklist), row.note, actor, t, t).run();
  if (!old || old.status !== row.status) await event(env, s.id, 'term', String(seq), actor, { seq, status: row.status, from: row.from, to: row.to, landlord: row.landlord });
  return { seq, listing_id: lid, ...row, dates, checklist, created: !old };
}

/** Deal date toggle of a term ≥ 2 (the Mini App sends term_seq + index within that term). */
export async function toggleTermDate(env: Env, sid: string, seq: number, index: number, done: boolean) {
  const r = await env.DB.prepare('SELECT dates FROM deal_terms WHERE search_id=? AND seq=?').bind(sid, seq).first<any>();
  if (!r) throw new HttpError(404, 'no_term');
  const dates = parseJson<any[]>(r.dates, []);
  if (!Number.isInteger(index) || !dates[index]) throw new HttpError(400, 'bad_index');
  dates[index].done = done;
  await env.DB.prepare('UPDATE deal_terms SET dates=?, updated_at=? WHERE search_id=? AND seq=?').bind(JSON.stringify(dates), now(), sid, seq).run();
  return dates[index];
}

/** Checklist toggle of a term ≥ 2 (Mini App "For the new lease" on the home Today). */
export async function toggleTermCheck(env: Env, sid: string, seq: number, index: number, done: boolean) {
  const r = await env.DB.prepare('SELECT checklist FROM deal_terms WHERE search_id=? AND seq=?').bind(sid, seq).first<any>();
  if (!r) throw new HttpError(404, 'no_term');
  const list = parseJson<any[]>(r.checklist, []);
  if (!Number.isInteger(index) || !list[index]) throw new HttpError(400, 'bad_index');
  list[index].done = done;
  await env.DB.prepare('UPDATE deal_terms SET checklist=?, updated_at=? WHERE search_id=? AND seq=?').bind(JSON.stringify(list), now(), sid, seq).run();
  return list[index];
}

/** `dates` of the state: the first term's (deal.ts dealDates, term_seq 1) then the extension terms' (term_seq ≥ 2). */
export function stateDates(dealData: any | null, termDates: any[] = []) {
  const first = dealData ? dealDates(dealData).map((x, i) => ({ ...x, term_seq: 1, index: i })) : [];
  return [...first, ...termDates];
}
/** Extension dates for the state (one cheap query, only when the search has terms ≥ 2). */
export async function extensionDates(env: Env, sid: string): Promise<any[]> {
  const rows = (await env.DB.prepare('SELECT seq, dates, currency FROM deal_terms WHERE search_id=? ORDER BY seq').bind(sid).all<any>()).results ?? [];
  return rows.flatMap((r) => parseJson<any[]>(r.dates, []).map((d, i) => ({ ...d, currency: d.currency ?? r.currency ?? null, term_seq: Number(r.seq), index: i })));
}

// ---------------------------------------------------------------- the projects list (cheap: stored stage, no derivation)

/** Extra per-search data for the projects list: the home (or newest) listing photo, the last term end, the move-out date. One statement. */
export const SUMMARY_SQL = `SELECT s.id search_id,
    (SELECT json_object('id', l.id, 'title', l.title, 'photos', CASE WHEN json_valid(l.photos) THEN json(l.photos) ELSE json('[]') END) FROM listings l
      WHERE l.id=coalesce(s.home_listing_id, (SELECT listing_id FROM deals WHERE search_id=s.id ORDER BY updated_at DESC LIMIT 1))) home,
    (SELECT json_object('id', l.id, 'photos', json(l.photos)) FROM listings l WHERE l.search_id=s.id AND l.status NOT IN ('closed','rejected') AND json_valid(l.photos) AND l.photos!='[]'
      ORDER BY l.created_at DESC LIMIT 1) newest,
    (SELECT MAX(date_to) FROM deal_terms WHERE search_id=s.id AND status!='draft') t_to,
    (SELECT date FROM moveouts WHERE search_id=s.id) mo_date
  FROM searches s JOIN members m ON m.search_id=s.id AND m.user_id=?1`;

/** searches[i].stage: from the stored columns (or a rough guess from the status before the first computation). */
export function stageSummary(s: any, extra: any, dealTerms: any | null, counts: { listings: number }) {
  const key = s.stage ?? (s.status === 'closed' ? 'closed' : s.status === 'living' ? 'living' : s.status === 'found' || dealTerms ? 'deal' : counts.listings ? 'search' : 'start');
  const home = extra?.home ? parseJson<any>(extra.home, null) : null;
  const newest = extra?.newest ? parseJson<any>(extra.newest, null) : null;
  const pic = (x: any) => { const p0 = x ? withSrc(x.id, Array.isArray(x.photos) ? x.photos : [])[0] : null; return p0?.src ?? p0?.url ?? null; };
  const tTo = [dealTerms?.to, extra?.t_to].filter(isDay).sort().pop() ?? null;
  const date = key === 'movein' || key === 'deal' ? (isDay(dealTerms?.from) ? dealTerms.from : null)
    : key === 'living' || key === 'extension' || key === 'next' ? tTo
      : key === 'moveout' ? (isDay(extra?.mo_date) ? extra.mo_date : tTo)
        : key === 'closed' ? (s.closed_at ? String(s.closed_at).slice(0, 10) : null) : null;
  return {
    key, idx: stageIdx(key), n: 9, closed: key === 'closed', manual: !!s.stage_manual && s.stage_manual !== 'closed', at: s.stage_changed_at ?? null, date,
    line_key: `pp_line_${key}`, estimated: !s.stage,
    home: home ? { listing_id: home.id, title: home.title, photo: pic(home) } : null,
    photo: pic(home) ?? pic(newest), listings: counts.listings,
  };
}

// ---------------------------------------------------------------- closed projects: read-only Mini App

// Writes that stay allowed on a closed project: reading files, my settings, the owner's reopen.
const CLOSED_OK = new Set(['/app/api/doc-link', '/app/api/doc-send', '/app/api/recap-share', '/app/api/lang', '/app/api/revoke-links', '/app/api/prefs',
  '/app/api/stage', '/app/api/seen-reveal', '/app/api/reroll-animal', '/app/api/agent-token']);
const ID_TABLE: Record<string, string> = {
  '/app/api/expense-delete': 'expenses', '/app/api/dir-delete': 'directory', '/app/api/place': 'places', '/app/api/bike-pay': 'bikes',
  '/app/api/bike-check': 'bikes', '/app/api/item-delete': 'items',
};

/** Central 409 `closed` for every Mini App write that names a closed search (by search, listing, row or draft id). */
export async function closedGuard(req: Request, env: Env, path: string): Promise<void> {
  if (req.method === 'GET' || !path.startsWith('/app/api/') || CLOSED_OK.has(path)) return;
  const q = new URL(req.url).searchParams;
  let b: any = {};
  if ((req.headers.get('content-type') ?? '').includes('application/json')) b = await req.clone().json().catch(() => ({}));
  if (!b || typeof b !== 'object') b = {};
  const sids = [q.get('s'), q.get('search_id'), b.search_id].filter(Boolean).map(String);
  const lids = [q.get('listing_id'), q.get('l'), b.listing_id].filter(Boolean).map(String);
  const table = ID_TABLE[path];
  const id = table ? String(q.get('id') ?? b.id ?? '') : '';
  const draft = path === '/app/api/draft' ? String(b.draft_id ?? '') : '';
  if (!sids.length && !lids.length && !id && !draft) return;
  const hit = await env.DB.prepare(`SELECT 1 FROM searches WHERE status='closed' AND (id IN (SELECT value FROM json_each(?1))
      OR id IN (SELECT search_id FROM listings WHERE id IN (SELECT value FROM json_each(?2)))
      OR (?3 != '' AND id IN (SELECT search_id FROM ${table ?? 'expenses'} WHERE id=?3))
      OR (?4 != '' AND id IN (SELECT search_id FROM drafts WHERE id=?4))) LIMIT 1`)
    .bind(JSON.stringify(sids), JSON.stringify(lids), id, draft).first();
  if (hit) throw new HttpError(409, 'closed', 'This project is closed and read-only; the owner can reopen it');
}

// ---------------------------------------------------------------- recompute after writes that move the stage

const APP_WATCH = new Set(['/app/api/vote', '/app/api/unvote', '/app/api/deal-date', '/app/api/deal-check', '/app/api/next-vote', '/app/api/moveout-step']);
const AGENT_WATCH = /^\/api\/(deals|listings|documents|viewings|house-contacts)\/[^/]+|^\/api\/searches\/[^/]+(\/(listings|moveout|relet|next|power|scans)(\/|$)|$)/;

/**
 * Wraps the Mini App and agent handlers (index.ts): after a successful write that can move the stage (votes, deal, dates,
 * documents, viewings, listing status, move-out, re-let, renewal, meter readings, scans), recompute that search's stage.
 * Best-effort: a failure here never fails the write.
 */
export async function withStage(req: Request, env: Env, path: string, run: () => Promise<Response>): Promise<Response> {
  if (req.method === 'GET') return run();
  const watched = path.startsWith('/app/') ? APP_WATCH.has(path) : AGENT_WATCH.test(path);
  if (!watched) return run();
  const pre: any = (req.headers.get('content-type') ?? '').includes('application/json') ? await req.clone().json().catch(() => null) : null;
  const res = await run();
  if (!res.ok) return res;
  try {
    const p = path.split('/').filter(Boolean);
    let sid: string | null = null;
    let lid: string | null = null;
    if (p[0] === 'api' && p[1] === 'searches') sid = p[2] ?? null;
    else if (p[0] === 'api' && (p[1] === 'deals' || p[1] === 'listings')) lid = p[2] ?? null;
    else if (pre && typeof pre === 'object' && !Array.isArray(pre)) { sid = pre.search_id ?? null; lid = sid ? null : pre.listing_id ?? null; }
    if (!sid && lid) sid = (await env.DB.prepare('SELECT search_id FROM listings WHERE id=?').bind(String(lid)).first<any>())?.search_id ?? null;
    if (!sid && p[0] === 'api') {
      const out = await res.clone().json().catch(() => null) as any;
      sid = out?.document?.search_id ?? out?.viewing?.search_id ?? out?.contact?.search_id ?? null;
    }
    if (sid) await recomputeStage(env, String(sid), { actor: 'system' });
  } catch (e) { console.error('stage after write', path, String((e as Error)?.message ?? e)); }
  return res;
}

// ---------------------------------------------------------------- cron

/** A few non-closed searches per tick, rotating (time-based moves: move-in day, lease end, 42 days before the end). */
export async function stageCron(env: Env) {
  const ids = ((await env.DB.prepare(`SELECT id FROM searches WHERE status!='closed' ORDER BY id`).all<any>()).results ?? []).map((r) => r.id as string);
  if (!ids.length) return;
  const per = 3;
  const start = (Math.floor(Date.now() / 900e3) * per) % ids.length;
  const pick = [...new Set(Array.from({ length: Math.min(per, ids.length) }, (_, i) => ids[(start + i) % ids.length]))];
  for (const sid of pick) {
    try { await recomputeStage(env, sid, { actor: 'system' }); } catch (e) {
      if ((e as Error)?.constructor?.name === 'BudgetOut') throw e;
      console.error('stage cron', sid, String((e as Error)?.message ?? e));
    }
  }
}

export { addDays, daysBetween };
