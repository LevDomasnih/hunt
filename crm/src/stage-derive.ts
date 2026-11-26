// Wave 6: the project pipeline, pure part. Derives the stage of a search ("project") from its data and builds the path rows
// (screen 45). No runtime imports on purpose: `node --experimental-strip-types scripts/test-stage.mts` checks it directly
// (fixtures with an injectable "today"); stage.ts loads the data from D1 and stores the result.

/** The 9 displayed stages, in path order (idx = position + 1). */
export const PATH_KEYS = ['start', 'search', 'viewings', 'choice', 'deal', 'movein', 'living', 'next', 'moveout'] as const;
/** Every stored stage: the 9 above, `extension` (a new lease term on the same home, counts as idx 7) and `closed`. */
export const STAGE_KEYS: readonly string[] = [...PATH_KEYS, 'extension', 'closed'];
export const stageIdx = (k: string | null | undefined): number =>
  k === 'extension' ? 7 : k === 'closed' ? 9 : Math.max(1, (PATH_KEYS as readonly string[]).indexOf(String(k)) + 1);
/** A finer order (extension sits between living and next): a manual override is dropped once the derived stage reaches it. */
export const stageOrd = (k: string | null | undefined): number =>
  k === 'extension' ? 7.5 : k === 'closed' ? 10 : (PATH_KEYS as readonly string[]).indexOf(String(k)) + 1;
/** Transitions that DM the members (once per search and stage). */
export const MAJOR_STAGES = new Set(['deal', 'movein', 'next', 'moveout', 'closed']);
const LIVING_GROUP = new Set(['living', 'extension', 'next', 'moveout']);

export interface PathInput {
  today: string; // YYYY-MM-DD in the search timezone
  now?: string; // ISO, for "upcoming" viewings (defaults to today 00:00 UTC)
  search: {
    id: string; status: string; created_at: string; brief: any; stage: string | null; stage_manual: string | null;
    stage_changed_at: string | null; stage_history: any[]; home_listing_id: string | null; closed_at: string | null;
  };
  members: number;
  voters: number;
  listings: { n: number; first: string | null; last: string | null };
  msgs: { contacted: number; replied: number; first: string | null; last: string | null };
  viewings: { n: number; days: number; first: string | null; last: string | null; upcoming: number; past: number };
  candidates: { id: string; title: string; decision: string | null; status: string | null; decided_at: string | null; updated_at: string | null; takes: number }[];
  deal: { listing_id: string; title?: string | null; data: any; deal_at: string | null; updated_at: string | null } | null;
  leases: { id: string; title?: string | null; status: string | null; signed_at: string | null; has_file: boolean | number; term_seq: number | null }[];
  movein: { video: boolean; scans: number; meters: number; contacts: number; owner: string | null };
  renewal: { status: string; choice: string | null; lease_to: string; decided_at: string | null; new_search_id: string | null; votes: number } | null;
  moveout: { date: string | null; steps: any } | null;
  relet: { status: string | null; date_from: string | null; date_to: string | null } | null;
  terms: any[]; // deal_terms rows (seq ≥ 2), dates/checklist already parsed
}

export interface Term {
  seq: number; kind: string | null; from: string | null; to: string | null; rent: number | null; currency: string | null; deposit: number | null;
  deposit_prev: string | null; deposit_prev_amount: number | null; landlord: string | null; landlord_contact_id?: string | null;
  status: string; current: boolean; signed: boolean; dates: any[]; checklist: any[]; note?: string | null; listing_id?: string | null;
}
export interface PathRow { key: string; status: 'done' | 'current' | 'todo'; date: string | null; date_to: string | null; go: string | null; facts: Record<string, any> }

const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10));
const day = (s: unknown): string | null => (isDay(s) ? String(s).slice(0, 10) : null);
export const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const minDay = (...xs: (string | null | undefined)[]) => xs.map(day).filter(Boolean).sort()[0] ?? null;
const maxDay = (...xs: (string | null | undefined)[]) => xs.map(day).filter(Boolean).sort().pop() ?? null;

/**
 * Deal dates of the first term: data.dates when present, else the legacy payments[] (refund = deposit return).
 * Mirrors deal.ts dealDates (kept import-free here so the derivation can be unit-tested without the Worker).
 */
export function termOneDates(data: any): any[] {
  if (Array.isArray(data?.dates) && data.dates.length) return data.dates.filter((d: any) => d && isDay(d.date)).map((d: any) => ({ ...d, date: String(d.date).slice(0, 10) }));
  return (Array.isArray(data?.payments) ? data.payments : []).filter((p: any) => p && isDay(p.date)).map((p: any) => ({
    date: String(p.date).slice(0, 10), kind: p.kind === 'refund' ? 'deposit_return' : 'payment', title: p.label ?? '', amount: p.amount ?? null,
    currency: p.currency ?? data?.terms?.currency ?? null, done: !!p.paid, legacy: true,
  }));
}

/** A lease document of term `seq` counts as signed: signed_at set, or status have with a file. */
const leaseSigned = (inp: PathInput, seq: number) =>
  inp.leases.some((d) => (Number(d.term_seq) || 1) === seq && (!!d.signed_at || (d.status === 'have' && !!d.has_file)));

/** Lease terms of the home: seq 1 from deals.data.terms, seq ≥ 2 from deal_terms. */
export function termsOf(inp: PathInput): Term[] {
  const out: Term[] = [];
  const today = inp.today;
  const data = inp.deal?.data ?? null;
  if (data) {
    const t = data.terms ?? {};
    const signed = leaseSigned(inp, 1);
    const from = day(t.from), to = day(t.to);
    out.push({
      seq: 1, kind: t.type ?? t.kind ?? null, from, to, rent: num(t.rent), currency: t.currency ?? null, deposit: num(t.deposit ?? data.deposit?.amount),
      deposit_prev: null, deposit_prev_amount: null, landlord: t.landlord ?? null, listing_id: inp.deal!.listing_id,
      status: !signed ? 'draft' : to && to < today ? 'ended' : from && from <= today ? 'active' : 'signed', current: false, signed,
      dates: termOneDates(data).map((d, i) => ({ ...d, term_seq: 1, index: i })), checklist: Array.isArray(data.checklist) ? data.checklist : [],
    });
  }
  for (const r of [...inp.terms].sort((a, b) => a.seq - b.seq)) {
    const signed = ['signed', 'active', 'ended'].includes(r.status) || leaseSigned(inp, Number(r.seq));
    const from = day(r.date_from ?? r.from), to = day(r.date_to ?? r.to);
    out.push({
      seq: Number(r.seq), kind: r.kind ?? null, from, to, rent: num(r.rent), currency: r.currency ?? null, deposit: num(r.deposit),
      deposit_prev: r.deposit_prev ?? null, deposit_prev_amount: num(r.deposit_prev_amount), landlord: r.landlord ?? null, landlord_contact_id: r.landlord_contact_id ?? null,
      status: !signed ? 'draft' : r.status === 'ended' || (to && to < today) ? 'ended' : from && from <= today ? 'active' : 'signed', current: false, signed,
      dates: (Array.isArray(r.dates) ? r.dates : []).map((d: any, i: number) => ({ ...d, term_seq: Number(r.seq), index: i })),
      checklist: Array.isArray(r.checklist) ? r.checklist : [], note: r.note ?? null, listing_id: r.listing_id ?? null,
    });
  }
  // The current term: the signed one that covers today, else the latest signed that started, else the first.
  const cover = out.filter((t) => t.signed && t.from && t.from <= today && (!t.to || t.to >= today)).pop()
    ?? out.filter((t) => t.signed && t.from && t.from <= today).pop() ?? out[0];
  if (cover) cover.current = true;
  return out;
}

const STAMP = /meterai|materai|марк[аоуиеы]|гербов|stamp/i;

export interface Derived {
  derived_key: string; key: string; idx: number; manual: string | null; closed: boolean;
  home_listing_id: string | null; living_status: boolean; terms: Term[]; rows: PathRow[]; date: string | null;
  choice: { listing_id: string; title: string; how: string; at: string | null } | null;
}

/**
 * Derive the stage and the path rows. `manual` = the stored override (dropped when the derived stage reaches it; the caller
 * clears it in D1 then). Closed = searches.status 'closed' (only an explicit close sets it).
 */
export function derivePath(inp: PathInput): Derived {
  const s = inp.search;
  const today = inp.today;
  const nowIso = inp.now ?? `${today}T00:00:00.000Z`;
  const brief = inp.search.brief ?? {};
  const terms = termsOf(inp);
  const t1 = terms[0] ?? null;
  const data = inp.deal?.data ?? {};

  // 1 start: the brief has a budget or districts, or the search already has listings / messages.
  const hasBudget = [brief.budget_min, brief.budget_max, brief.budget_said].some((x) => x != null && x !== '');
  const districts = Array.isArray(brief.districts) ? brief.districts.length : 0;
  const startDone = hasBudget || districts > 0 || inp.listings.n > 0 || inp.msgs.contacted > 0;

  // 4 choice: a deal, a listing most voters want to take, a listing marked taken, or a manual pin (stage_set with a listing).
  let choice: Derived['choice'] = null;
  const cand = inp.candidates;
  const title = (id: string) => (inp.deal?.listing_id === id ? data.name : null) ?? cand.find((c) => c.id === id)?.title ?? inp.deal?.title ?? '';
  if (inp.deal) choice = { listing_id: inp.deal.listing_id, title: title(inp.deal.listing_id), how: 'deal', at: inp.deal.deal_at ?? cand.find((c) => c.id === inp.deal!.listing_id)?.decided_at ?? inp.deal.updated_at };
  if (!choice) {
    const maj = cand.filter((c) => c.takes > inp.voters / 2 || (c.decision === 'take' && c.takes > 0))
      .sort((a, b) => b.takes - a.takes || String(b.decided_at ?? '').localeCompare(String(a.decided_at ?? '')))[0];
    if (maj) choice = { listing_id: maj.id, title: maj.title, how: 'majority', at: maj.decided_at ?? maj.updated_at };
  }
  if (!choice) {
    const tk = cand.filter((c) => c.status === 'taken').sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))[0];
    if (tk) choice = { listing_id: tk.id, title: tk.title, how: 'taken', at: tk.updated_at };
  }
  if (!choice && s.home_listing_id && s.stage_manual && stageOrd(s.stage_manual) >= stageOrd('choice')) {
    choice = { listing_id: s.home_listing_id, title: title(s.home_listing_id), how: 'manual', at: s.stage_changed_at };
  }
  const choiceDone = !!choice;
  const choiceCurrent = !choiceDone && (cand.some((c) => c.takes > 0) || (inp.viewings.past > 0 && inp.viewings.upcoming === 0));

  // 5 deal: the lease is signed and every payment due on/before the move-in day is done.
  const from = t1?.from ?? null;
  const pays = (t1?.dates ?? []).filter((d) => d.kind === 'payment' && (!from || d.date <= from));
  const paid = pays.filter((d) => d.done).reduce((a, d) => a + (Number(d.amount) || 0), 0);
  const pending = pays.filter((d) => !d.done).reduce((a, d) => a + (Number(d.amount) || 0), 0);
  const allPaid = pays.every((d) => d.done);
  const signed1 = leaseSigned(inp, 1);
  const dealDone = choiceDone && !!inp.deal && signed1 && allPaid;
  const lease1 = inp.leases.filter((d) => (Number(d.term_seq) || 1) === 1).sort((a, b) => String(b.signed_at ?? '').localeCompare(String(a.signed_at ?? '')))[0];
  const stamp = (t1?.checklist ?? []).some((c: any) => (typeof c === 'object' ? c?.done && STAMP.test(String(c.text ?? c.label ?? '')) : false)) || STAMP.test(String(lease1?.title ?? ''));

  // 6 move-in: on/after the lease start with evidence (move-in video or scans + a meter reading + a house contact), or a week later.
  const evidence = (inp.movein.video || inp.movein.scans > 0) && inp.movein.meters > 0 && inp.movein.contacts >= 1;
  const moveinDone = choiceDone && (s.status === 'living' || (!!from && ((today >= from && evidence) || today >= addDays(from, 7))));
  const moveinNow = choiceDone && (dealDone || (!!from && today >= from));

  // 7-9: living, extension, what next, move-out. The lease end is the latest signed term's end.
  const leaseEnd = maxDay(...terms.filter((t) => t.seq === 1 || t.signed).map((t) => t.to));
  const exts = terms.filter((t) => t.seq >= 2);
  const lastExt = exts[exts.length - 1] ?? null;
  const rn = inp.renewal;
  const rnHere = !!rn && !!leaseEnd && rn.lease_to === leaseEnd;
  let living: string = 'living';
  if (moveinDone) {
    if (inp.moveout || inp.relet || (rnHere && rn!.status === 'decided' && (rn!.choice === 'new' || rn!.choice === 'leave'))) living = 'moveout';
    else if (lastExt && lastExt.signed && lastExt.from && lastExt.from > today) living = 'extension';
    else if (rnHere && rn!.status === 'decided' && rn!.choice === 'stay') living = 'extension';
    else if (rn && rn.status === 'open') living = 'next';
    else if (leaseEnd && today > leaseEnd) living = 'moveout';
    else if (leaseEnd && today >= addDays(leaseEnd, -42) && !rnHere) living = 'next';
  }

  const derived = s.status === 'closed' ? 'closed'
    : moveinDone ? living
      : moveinNow ? 'movein'
        : choiceDone ? 'deal'
          : choiceCurrent ? 'choice'
            : inp.viewings.n > 0 ? 'viewings'
              : startDone ? 'search' : 'start';

  // The manual override wins until the derived stage reaches it (closed is never "reached": only reopen clears it).
  let manual = s.stage_manual && STAGE_KEYS.includes(s.stage_manual) ? s.stage_manual : null;
  if (manual === 'closed' && s.status !== 'closed') manual = null;
  if (manual && manual !== 'closed' && stageOrd(derived) >= stageOrd(manual)) manual = null;
  const key = s.status === 'closed' ? 'closed' : manual ?? derived;
  const closed = key === 'closed';
  const idx = stageIdx(key);

  const status = (k: string): PathRow['status'] => {
    if (closed) return 'done';
    if (k === 'living' && (key === 'extension' || key === 'next' || key === 'moveout')) return 'done';
    const i = stageIdx(k);
    return i < idx ? 'done' : i === idx ? 'current' : 'todo';
  };
  const voteDay = (x: string | null | undefined) => day(x);
  const moDates = (t1?.dates ?? []).filter((d) => d.kind === 'moveout');
  const moveoutDay = day(inp.moveout?.date) ?? day(moDates[moDates.length - 1]?.date) ?? leaseEnd;
  const steps = inp.moveout?.steps && typeof inp.moveout.steps === 'object' ? inp.moveout.steps : {};
  const stepVals = Object.values(steps) as any[];
  const depDate = [...terms].reverse().flatMap((t) => t.dates).find((d) => d.kind === 'deposit_return');
  const owner = inp.movein.owner ?? (data.terms?.owner ? String(data.terms.owner) : null) ?? t1?.landlord ?? null;
  const livingFrom = from;
  const rows: PathRow[] = [
    { key: 'start', status: status('start'), date: day(s.created_at), date_to: null, go: 'brief',
      facts: { members: inp.members, budget: hasBudget, districts, created_at: s.created_at } },
    { key: 'search', status: status('search'), date: minDay(inp.listings.first, inp.msgs.first), date_to: maxDay(inp.listings.last, inp.msgs.last), go: 'listings',
      facts: { contacted: inp.msgs.contacted, replied: inp.msgs.replied, listings: inp.listings.n, from: minDay(inp.listings.first, inp.msgs.first), to: maxDay(inp.listings.last, inp.msgs.last) } },
    { key: 'viewings', status: status('viewings'), date: voteDay(inp.viewings.first), date_to: voteDay(inp.viewings.last), go: 'plan',
      facts: { count: inp.viewings.n, days: inp.viewings.days, first: voteDay(inp.viewings.first), last: voteDay(inp.viewings.last), upcoming: inp.viewings.upcoming } },
    { key: 'choice', status: status('choice'), date: choice ? day(choice.at) : null, date_to: null, go: choice ? `listing/${choice.listing_id}` : 'compare',
      facts: choice ? { ...choice } : { listing_id: null, title: null, how: null, at: null, takes: cand.reduce((a, c) => Math.max(a, c.takes), 0) } },
    { key: 'deal', status: status('deal'), date: day(lease1?.signed_at) ?? maxDay(...pays.filter((d) => d.done).map((d) => d.date)) ?? (inp.deal ? day(inp.deal.deal_at ?? inp.deal.updated_at) : null), date_to: null, go: 'deal',
      facts: { signed_at: day(lease1?.signed_at), signed: signed1, lease_kind: t1?.kind ?? null, landlord: t1?.landlord ?? null, stamp, paid, pending, currency: t1?.currency ?? pays[0]?.currency ?? null } },
    { key: 'movein', status: status('movein'), date: from, date_to: null, go: 'act',
      facts: { date: from, video: !!inp.movein.video || inp.movein.scans > 0, meters: inp.movein.meters > 0, contacts: inp.movein.contacts, landlord: owner, days_left: from ? daysBetween(today, from) : null } },
    { key: 'living', status: status('living'), date: livingFrom, date_to: leaseEnd, go: 'home',
      facts: { from: livingFrom, to: leaseEnd, day: livingFrom && today >= livingFrom ? daysBetween(livingFrom, today) + 1 : null, days: livingFrom && leaseEnd ? daysBetween(livingFrom, leaseEnd) : null } },
  ];
  // Extension rows: one per term ≥ 2 (or one pending row while "stay" waits for the new contract).
  const extRows: PathRow[] = exts.map((t) => ({
    key: 'extension', status: closed ? 'done' : t.signed && t.from && t.from <= today ? 'done' : key === 'extension' && t === lastExt ? 'current' : 'todo',
    date: t.from, date_to: t.to, go: 'docs',
    facts: { seq: t.seq, from: t.from, to: t.to, landlord: t.landlord, status: t.status, deposit_prev: t.deposit_prev, deposit_prev_amount: t.deposit_prev_amount, deposit: t.deposit, currency: t.currency, rent: t.rent },
  }));
  if (key === 'extension' && (!lastExt || (lastExt.signed && lastExt.from && lastExt.from <= today))) {
    extRows.push({ key: 'extension', status: 'current', date: leaseEnd, date_to: null, go: 'next', facts: { seq: null, from: leaseEnd, to: null, landlord: null, status: 'pending', deposit_prev: null, deposit: null } });
  }
  rows.push(...extRows);
  rows.push({ key: 'next', status: status('next'), date: leaseEnd ? addDays(leaseEnd, -28) : null, date_to: null, go: 'next',
    facts: { lease_to: leaseEnd, opens: leaseEnd ? addDays(leaseEnd, -42) : null, deadline: leaseEnd ? addDays(leaseEnd, -28) : null, status: rn && (rnHere || rn.status === 'open') ? rn.status : null,
      choice: rn && (rnHere || rn.status === 'open') ? rn.choice : null, votes: rn && (rnHere || rn.status === 'open') ? rn.votes : 0, voters: inp.voters, new_search_id: rn?.new_search_id ?? null } });
  if (inp.relet) {
    rows.push({ key: 'relet', status: closed || ['found', 'closed'].includes(String(inp.relet.status)) ? 'done' : key === 'moveout' ? 'current' : 'todo',
      date: day(inp.relet.date_from), date_to: day(inp.relet.date_to), go: 'relet', facts: { status: inp.relet.status, from: day(inp.relet.date_from), to: day(inp.relet.date_to) } });
  }
  rows.push({ key: 'moveout', status: status('moveout'), date: moveoutDay, date_to: null, go: 'moveout',
    facts: { date: moveoutDay, done: stepVals.filter((x) => x?.status === 'done').length, total: stepVals.length, landlord: owner,
      deposit_status: steps.deposit?.status ?? (depDate ? (depDate.done ? 'done' : 'wait') : null), days_left: moveoutDay ? daysBetween(today, moveoutDay) : null } });

  // The key date of the current stage (projects list, "Заезд через 3 дня").
  const keyDate = key === 'movein' || key === 'deal' ? from : key === 'living' || key === 'extension' || key === 'next' ? leaseEnd
    : key === 'moveout' ? moveoutDay : key === 'closed' ? day(s.closed_at) : key === 'viewings' ? day(inp.viewings.last) : null;
  void nowIso;
  return {
    derived_key: derived, key, idx, manual, closed, home_listing_id: choice?.listing_id ?? (closed ? s.home_listing_id : null),
    living_status: LIVING_GROUP.has(derived), terms, rows, date: keyDate, choice,
  };
}
