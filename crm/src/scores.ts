// Group interest before viewing (votes), group decision, and ratings after viewing.
// The Mini App mirrors interestOf / groupDecision in public/app.js; keep both in sync.
import { Env, now } from './util';

export const VOTE_WEIGHT: Record<string, number> = { take: 3, want_view: 2, thinking: 1, not_interested: -2 };
const STRENGTH = ['take', 'want_view', 'thinking'];
export const CRITERIA = ['overall', 'area', 'inside', 'quiet'] as const;

export interface VoteRow { listing_id: string; user_id: string; decision: string; at: string }
export interface RatingRow {
  listing_id: string; user_id: string; overall: number; area: number; inside: number; quiet: number;
  note: string | null; voice: string | null; at: string; display_name?: string;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Majority of the votes. Ties: the stronger positive wins (take > want_view > thinking);
 * a tie between a positive and not_interested is a split group = thinking.
 * Any `take` by the owner makes it take.
 */
export function groupDecision(votes: { user_id: string; decision: string }[], ownerId: string | null): string | null {
  if (!votes.length) return null;
  if (ownerId && votes.some((v) => v.user_id === ownerId && v.decision === 'take')) return 'take';
  const n: Record<string, number> = {};
  for (const v of votes) n[v.decision] = (n[v.decision] ?? 0) + 1;
  const top = Math.max(...Object.values(n));
  const tied = Object.keys(n).filter((k) => n[k] === top);
  if (tied.length === 1) return tied[0];
  const pos = STRENGTH.filter((k) => tied.includes(k));
  if (tied.includes('not_interested') && pos.length) return 'thinking';
  return pos[0] ?? tied[0];
}

/** interest = sum of vote weights; max = 3 × members who can vote (owner | member). */
export function interestOf(votes: { decision: string }[], voters: number) {
  return { score: votes.reduce((s, v) => s + (VOTE_WEIGHT[v.decision] ?? 0), 0), max: 3 * voters, votes: votes.length };
}

/** Listing score = mean of member scores (each = mean of the 4 criteria), 1 decimal; per-criterion means for the bars. */
export function ratingSummary(rows: RatingRow[]) {
  if (!rows.length) return null;
  const by_member = rows.map((r) => ({
    user_id: r.user_id, ...(r.display_name ? { display_name: r.display_name } : {}),
    score: round1(mean(CRITERIA.map((c) => Number(r[c])))),
    overall: r.overall, area: r.area, inside: r.inside, quiet: r.quiet, at: r.at,
  }));
  const criteria = Object.fromEntries(CRITERIA.map((c) => [c, round1(mean(rows.map((r) => Number(r[c]))))])) as Record<(typeof CRITERIA)[number], number>;
  return {
    score: round1(mean(rows.map((r) => mean(CRITERIA.map((c) => Number(r[c])))))),
    by_member,
    criteria,
    weak: CRITERIA.filter((c) => criteria[c] < 3),
    notes: rows.filter((r) => r.note || r.voice).map((r) => ({ user_id: r.user_id, note: r.note ?? null, ...(r.voice ? { voice: r.voice } : {}) })),
  };
}

/** Ratings of every listing of a search: {listing_id: summary}. */
export async function searchRatings(env: Env, sid: string, withNames = false) {
  const rows = (await env.DB.prepare(
    `SELECT r.*, u.display_name FROM ratings r JOIN listings l ON l.id=r.listing_id JOIN users u ON u.id=r.user_id
     WHERE l.search_id=? ORDER BY r.at`,
  ).bind(sid).all<RatingRow>()).results ?? [];
  const by: Record<string, RatingRow[]> = {};
  for (const r of rows) (by[r.listing_id] ??= []).push(withNames ? r : { ...r, display_name: undefined });
  return Object.fromEntries(Object.entries(by).map(([lid, rs]) => [lid, ratingSummary(rs)]));
}

/**
 * listings.decision from all votes of members who can vote. Called after every vote / unvote.
 * No votes left: a decision that came from votes is cleared; one the agent set (decided_by NULL) stays.
 */
export async function recomputeDecision(env: Env, lid: string): Promise<string | null> {
  const DB = env.DB;
  const l = await DB.prepare('SELECT l.decision, l.decided_by, s.owner_id FROM listings l JOIN searches s ON s.id=l.search_id WHERE l.id=?').bind(lid).first<any>();
  if (!l) return null;
  const votes = (await DB.prepare(
    `SELECT v.user_id, v.decision, v.at FROM votes v JOIN listings l ON l.id=v.listing_id
     JOIN members m ON m.search_id=l.search_id AND m.user_id=v.user_id AND m.role IN ('owner','member')
     WHERE v.listing_id=? ORDER BY v.at DESC`,
  ).bind(lid).all<{ user_id: string; decision: string; at: string }>()).results ?? [];
  if (!votes.length) {
    if (l.decided_by == null) return l.decision ?? null;
    await DB.prepare('UPDATE listings SET decision=NULL, decided_by=NULL, decided_at=NULL, updated_at=? WHERE id=?').bind(now(), lid).run();
    return null;
  }
  const dec = groupDecision(votes, l.owner_id);
  const who = votes.find((v) => v.decision === dec) ?? votes[0];
  await DB.prepare('UPDATE listings SET decision=?, decided_by=?, decided_at=?, updated_at=? WHERE id=?').bind(dec, who.user_id, votes[0].at, now(), lid).run();
  return dec;
}

/** Interest per listing of a search (agent API). */
export async function searchInterest(env: Env, sid: string) {
  const [vs, ms] = await env.DB.batch<any>([
    env.DB.prepare(`SELECT v.listing_id, v.user_id, v.decision FROM votes v JOIN listings l ON l.id=v.listing_id
                    JOIN members m ON m.search_id=l.search_id AND m.user_id=v.user_id AND m.role IN ('owner','member') WHERE l.search_id=?`).bind(sid),
    env.DB.prepare(`SELECT COUNT(*) n FROM members WHERE search_id=? AND role IN ('owner','member')`).bind(sid),
  ]);
  const voters = Number(ms.results?.[0]?.n ?? 0);
  const by: Record<string, any[]> = {};
  for (const v of vs.results ?? []) (by[v.listing_id] ??= []).push(v);
  return { voters, of: (lid: string) => ({ ...interestOf(by[lid] ?? [], voters), by: (by[lid] ?? []).map((v) => ({ user_id: v.user_id, decision: v.decision })) }) };
}
