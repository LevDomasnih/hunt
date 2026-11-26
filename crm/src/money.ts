// Shared money: who paid what, split by per-member weights, balances and the transfers that settle them.
// The Mini App shows the result of moneyView(); the agent gets the same through GET /api/searches/:id/expenses.
import { Env, HttpError, parseJson } from './util';

export const EXPENSE_KINDS = ['rent', 'deposit', 'power', 'water', 'internet', 'cleaning', 'pool', 'repair', 'food', 'transport', 'other'] as const;
export const PAY_METHODS = ['cash', 'transfer', 'card'] as const;

export type Weights = Record<string, number>;
export interface ExpenseRow {
  id: string; search_id: string; listing_id: string | null; title: string; amount: number; currency: string; date: string;
  paid_by: string; split: string | Weights | null; kind: string; method: string | null; note: string | null; receipt: string | null;
  created_by: string; created_at: string; updated_at: string;
}
export interface SettlementRow { id: string; from_user: string; to_user: string; amount: number; currency: string; note: string | null; created_by: string; at: string }

/** Positive weights of members only; empty → equal split between `voters`. */
export function normWeights(w: unknown, members: string[], voters: string[]): Weights {
  const out: Weights = {};
  if (w && typeof w === 'object') {
    for (const [k, v] of Object.entries(w as Record<string, unknown>)) {
      const n = Number(v);
      if (members.includes(k) && Number.isFinite(n) && n > 0) out[k] = n;
    }
  }
  if (Object.keys(out).length) return out;
  for (const u of voters) out[u] = 1;
  return out;
}

/** Validate a split/shares object from a request: {user_id: weight>=0}, members only. */
export function cleanWeights(w: unknown, members: string[]): Weights | null {
  if (w == null) return null;
  if (typeof w !== 'object' || Array.isArray(w)) throw new HttpError(400, 'bad_split', 'split/shares must be {user_id: weight}');
  const out: Weights = {};
  for (const [k, v] of Object.entries(w as Record<string, unknown>)) {
    if (!members.includes(k)) throw new HttpError(400, 'bad_split', `${k} is not a member of this search`);
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new HttpError(400, 'bad_split', 'weights must be numbers 0-100');
    if (n > 0) out[k] = Math.round(n * 100) / 100;
  }
  if (!Object.keys(out).length) throw new HttpError(400, 'bad_split', 'at least one member needs a weight above 0');
  return out;
}

/**
 * Net balance per member and currency: paid minus owed (positive = the others owe them), settlements applied.
 * transfers: greedy debtor → creditor list that brings everyone to zero.
 */
export function balances(expenses: ExpenseRow[], settlements: SettlementRow[], weightsOf: Weights | ((e: ExpenseRow) => Weights), members: string[], voters: string[]) {
  const net: Record<string, Record<string, number>> = {};
  const add = (cur: string, u: string, x: number) => { (net[cur] ??= {})[u] = (net[cur][u] ?? 0) + x; };
  for (const e of expenses) {
    const split = typeof e.split === 'string' ? parseJson<Weights | null>(e.split, null) : e.split;
    const ww = split ? normWeights(split, members, voters) : typeof weightsOf === 'function' ? weightsOf(e) : weightsOf;
    const sum = Object.values(ww).reduce((a, b) => a + b, 0) || 1;
    add(e.currency, e.paid_by, e.amount);
    for (const [u, x] of Object.entries(ww)) add(e.currency, u, -(e.amount * x) / sum);
  }
  for (const s of settlements) { add(s.currency, s.from_user, s.amount); add(s.currency, s.to_user, -s.amount); }
  const out: Record<string, { net: Record<string, number>; transfers: { from: string; to: string; amount: number }[] }> = {};
  for (const [cur, m] of Object.entries(net)) {
    const rounded = Object.fromEntries(Object.entries(m).map(([u, x]) => [u, Math.round(x)]));
    const debt = Object.entries(rounded).filter(([, x]) => x < 0).map(([u, x]) => ({ u, x: -x })).sort((a, b) => b.x - a.x);
    const cred = Object.entries(rounded).filter(([, x]) => x > 0).map(([u, x]) => ({ u, x })).sort((a, b) => b.x - a.x);
    const transfers: { from: string; to: string; amount: number }[] = [];
    let i = 0, j = 0;
    while (i < debt.length && j < cred.length) {
      const a = Math.min(debt[i].x, cred[j].x);
      if (a >= 1) transfers.push({ from: debt[i].u, to: cred[j].u, amount: a });
      debt[i].x -= a; cred[j].x -= a;
      if (debt[i].x < 1) i++;
      if (cred[j].x < 1) j++;
    }
    out[cur] = { net: rounded, transfers };
  }
  return out;
}

// ---------------------------------------------------------------- wave 3: rooms and the shared budget

export const MONEY_MODES = ['split', 'shared'] as const;
export interface Room { id: string; name: string; user_id: string | null; share: number }
export interface Rooms { rooms: Room[]; others_equal: boolean }

/** Validate {rooms:[{id?, name, user_id|null, share}], others_equal} from a request; shares are percents 0-100. */
export function cleanRooms(v: unknown, members: string[]): Rooms | null {
  if (v == null) return null;
  const b: any = typeof v === 'string' ? parseJson(v, null) : v;
  if (!b || typeof b !== 'object' || !Array.isArray(b.rooms) || b.rooms.length > 12) throw new HttpError(400, 'bad_rooms', 'rooms must be {rooms:[{name, user_id, share}], others_equal}');
  const rooms = b.rooms.map((r: any, i: number) => {
    const name = String(r?.name ?? '').trim().slice(0, 60);
    if (!name) throw new HttpError(400, 'bad_rooms', `rooms[${i}].name is required`);
    const user_id = r.user_id == null || r.user_id === '' ? null : String(r.user_id);
    if (user_id && !members.includes(user_id)) throw new HttpError(400, 'bad_rooms', `${user_id} is not a member of this search`);
    const share = Number(r.share ?? 0);
    if (!Number.isFinite(share) || share < 0 || share > 100) throw new HttpError(400, 'bad_rooms', 'share must be a percent 0-100');
    const id = /^[a-z0-9_-]{1,24}$/i.test(String(r.id ?? '')) ? String(r.id) : `r${i + 1}`;
    return { id, name, user_id, share: Math.round(share * 10) / 10 };
  });
  const sum = rooms.reduce((a: number, r: Room) => a + r.share, 0);
  if (rooms.length && (sum < 99 || sum > 101)) throw new HttpError(400, 'bad_rooms', `room shares must add up to 100% (now ${sum})`);
  return { rooms, others_equal: b.others_equal !== false };
}

/** Rent weights from the rooms: a member's rooms add up; a shared room with a share is split equally between voters. */
export function roomWeights(r: Rooms | null, voters: string[]): Weights | null {
  if (!r?.rooms?.length) return null;
  const w: Weights = {};
  for (const room of r.rooms) {
    if (!(room.share > 0)) continue;
    if (room.user_id && voters.includes(room.user_id)) w[room.user_id] = (w[room.user_id] ?? 0) + room.share;
    else if (!room.user_id && voters.length) for (const u of voters) w[u] = (w[u] ?? 0) + room.share / voters.length;
  }
  return Object.keys(w).length ? w : null;
}

/** Months covered by a run of dated purchases (at least one): first date → last date + one average gap. */
function monthsSpan(dates: string[]): number {
  if (dates.length < 2) return 1;
  const a = Date.parse(dates[0]), b = Date.parse(dates[dates.length - 1]);
  const gap = (b - a) / (dates.length - 1);
  return Math.max(1, (b - a + gap) / (30.44 * 864e5));
}

/** Everything the money screen and the agent need for one search. */
export async function moneyView(env: Env, sid: string) {
  const DB = env.DB;
  const [ex, st, mem, s] = await DB.batch<any>([
    DB.prepare('SELECT * FROM expenses WHERE search_id=? ORDER BY date, created_at').bind(sid),
    DB.prepare('SELECT * FROM settlements WHERE search_id=? ORDER BY at').bind(sid),
    DB.prepare('SELECT m.user_id, m.role, u.display_name name FROM members m JOIN users u ON u.id=m.user_id WHERE m.search_id=?').bind(sid),
    DB.prepare('SELECT shares, brief, rooms, money_mode FROM searches WHERE id=?').bind(sid),
  ]);
  const expenses = ((ex.results ?? []) as ExpenseRow[]).map((e) => ({ ...e, split: parseJson<Weights | null>(e.split as string, null) }));
  const settlements = (st.results ?? []) as SettlementRow[];
  const members = (mem.results ?? []).map((m: any) => m.user_id as string);
  const voters = (mem.results ?? []).filter((m: any) => m.role !== 'viewer').map((m: any) => m.user_id as string);
  const shares = normWeights(parseJson(s.results?.[0]?.shares, null), members, voters);
  const brief = parseJson<any>(s.results?.[0]?.brief, {});
  const mode = s.results?.[0]?.money_mode === 'shared' ? 'shared' : 'split';
  const rooms = parseJson<Rooms | null>(s.results?.[0]?.rooms, null);
  const rentW = roomWeights(rooms, voters);
  const equal = Object.fromEntries(voters.map((u) => [u, 1]));
  // Without their own split: rent follows the rooms; the rest is equal (others_equal) or follows the shares.
  const weightsOf = (e: { kind: string; split: any }): Weights => (e.split ? normWeights(e.split, members, voters) : rentW ? (e.kind === 'rent' ? rentW : rooms!.others_equal ? equal : shares) : shares);
  const bal = balances(expenses, settlements, weightsOf as any, members, voters);
  const counts: Record<string, number> = {};
  for (const e of expenses) counts[e.currency] = (counts[e.currency] ?? 0) + 1;
  const currency = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? brief.currency ?? null;
  const main = expenses.filter((e) => e.currency === currency);
  const total = main.reduce((a, e) => a + e.amount, 0);
  const shareSum = Object.values(shares).reduce((a, b) => a + b, 0) || 1;
  const power = main.filter((e) => e.kind === 'power');
  const totals = {
    currency,
    total,
    per_member: Object.fromEntries(members.map((u) => {
      let owed = 0;
      for (const e of main) {
        const w = weightsOf(e);
        const sum = Object.values(w).reduce((a, b) => a + b, 0) || 1;
        owed += (e.amount * (w[u] ?? 0)) / sum;
      }
      return [u, Math.round(owed)];
    })),
    equal_share: Math.round(total / Math.max(1, Object.keys(shares).length)),
    power_per_month: power.length ? Math.round(power.reduce((a, e) => a + e.amount, 0) / monthsSpan(power.map((e) => e.date))) : null,
    share_sum: shareSum,
    ...budgetTotals(main),
  };
  return { currency, mode, shares, rooms, rent_weights: rentW, expenses, settlements, balances: bal, totals };
}

/** Shared-budget totals: this month, per category, per month (main currency only). */
function budgetTotals(main: { amount: number; kind: string; date: string }[]) {
  const by_kind: Record<string, number> = {};
  const by_month: Record<string, number> = {};
  for (const e of main) {
    by_kind[e.kind] = (by_kind[e.kind] ?? 0) + e.amount;
    const mth = String(e.date).slice(0, 7);
    by_month[mth] = (by_month[mth] ?? 0) + e.amount;
  }
  const thisMonth = new Date().toISOString().slice(0, 7);
  const months = Object.keys(by_month).length;
  const total = main.reduce((a, e) => a + e.amount, 0);
  return { this_month: by_month[thisMonth] ?? 0, by_kind, by_month, per_month_avg: months ? Math.round(total / months) : 0 };
}
