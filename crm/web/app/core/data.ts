// Reading the state: listings, members, votes, ratings, photos, districts, travel time.
import { LOC, ROAD, dayKey, firstName, money } from './format.js';
import { LANG, STR, cap, human, t } from './i18n.js';
import type { Listing, Member, Photo, State, Viewing, Vote } from '../../types/api.js';
import { S } from './store.js';

// ---------------------------------------------------------------- data helpers
export const D = (): State => S.data;
export const listingById = (id: string | null | undefined): Listing | undefined => D()?.listings.find((l) => l.id === id);
export const memberById = (id: string | null | undefined): Member | undefined => D()?.members.find((m) => m.user_id === id);
export const votesFor = (lid: string): Vote[] => (D()?.votes ?? []).filter((v) => v.listing_id === lid);
export const myVote = (lid: string): string | null => votesFor(lid).find((v) => v.user_id === D()?.user.id)?.decision ?? null;
// Group interest and decision: mirrors src/scores.ts.
export const WEIGHT: { [decision: string]: number } = { take: 3, want_view: 2, thinking: 1, not_interested: -2 };
export const canVoteRole = (r: string | null | undefined) => r === 'owner' || r === 'member';
export const votersN = () => (D()?.members ?? []).filter((m) => canVoteRole(m.role)).length;
export const ownerId = () => D()?.members.find((m) => m.role === 'owner')?.user_id ?? null;
export interface Interest { score: number; max: number; votes: Vote[] }
export function interestOf(lid: string): Interest {
  const vs = votesFor(lid).filter((v) => { const m = memberById(v.user_id); return !m || canVoteRole(m.role); });
  return { score: vs.reduce((n, v) => n + (WEIGHT[v.decision] ?? 0), 0), max: 3 * votersN(), votes: vs };
}
export function groupDecision(vs: Vote[]): string | null {
  if (!vs.length) return null;
  if (vs.some((v) => v.user_id === ownerId() && v.decision === 'take')) return 'take';
  const n: { [decision: string]: number } = {};
  for (const v of vs) n[v.decision] = (n[v.decision] ?? 0) + 1;
  const top = Math.max(...Object.values(n));
  const tied = Object.keys(n).filter((k) => n[k] === top);
  if (tied.length === 1) return tied[0];
  const pos = ['take', 'want_view', 'thinking'].filter((k) => tied.includes(k));
  if (tied.includes('not_interested') && pos.length) return 'thinking';
  return pos[0] ?? tied[0];
}
export const ratingOf = (lid: string) => D()?.ratings?.[lid] ?? null;
export const myRating = (lid: string) => ratingOf(lid)?.by_member?.find((m: { user_id: string }) => m.user_id === D()?.user.id) ?? null;
export const fmtScore = (x: number | null | undefined) => (x == null ? '—' : new Intl.NumberFormat(LOC(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(x));
export const interestText = (it: Interest) => t('interest', { x: Math.max(0, it.score), max: it.max });
/** The last viewing of a listing that has happened (done, or confirmed and already started). */
export function viewedOf(lid: string): Viewing | null {
  const now = Date.now();
  const vs = (D()?.viewings ?? []).filter((v) => v.listing_id === lid && (v.status === 'done' || (v.status === 'confirmed' && Date.parse(v.starts_at) < now)));
  return vs[vs.length - 1] ?? null;
}
export const CRIT = ['overall', 'area', 'inside', 'quiet'];
export const CRIT_ICON: { [crit: string]: string } = { overall: 'sparkles', area: 'pin', inside: 'sofa', quiet: 'volume' };
export const animalName = (m: Member | null | undefined): string => (m?.animal ? m.animal.name[LANG] ?? m.animal.name.en : '');
export const memberLabel = (m: Member | null | undefined) => (m ? (animalName(m) ? `${cap(animalName(m))} (${firstName(m.name)})` : firstName(m.name)) : '?');
/** The URL of a photo: a path string, or { url } / { src } / { kv, i } from the API. */
export function photoUrl(p: string | Photo | null | undefined): string | null {
  if (!p) return null;
  const k = encodeURIComponent(D()?.photo_token ?? '');
  // our own media paths (/app/kv/…, /app/photo/…) need the photo token: <img> cannot send the auth header
  if (typeof p === 'string') return /^\/app\/(kv|photo)\//.test(p) && !/[?&]k=/.test(p) ? `${p}${p.includes('?') ? '&' : '?'}k=${k}` : p;
  if (p.url) return p.url;
  if (p.src) return `${p.src}${p.src.includes('?') ? '&' : '?'}k=${k}`;
  if (p.kv) return `/app/kv/${encodeURIComponent(p.kv)}${p.i != null ? `?i=${p.i}&` : '?'}k=${k}`;
  return null;
}
export const photosOf = (l: { photos?: unknown } | null | undefined): string[] => (Array.isArray(l?.photos) ? (l.photos as Photo[]) : []).map(photoUrl).filter(Boolean);
export function districtName(l: Partial<Listing> | null | undefined): string {
  if (!l) return '';
  const s = D()?.search;
  const reg = S.regions?.[s?.country];
  if (reg && l.district) {
    const sub = String(s.region).split('/')[1];
    const nm = reg.sub?.[sub]?.districts?.[l.district] ?? Object.values(reg.sub ?? {}).map((x) => x.districts?.[l.district]).find(Boolean);
    if (nm) return nm[LANG] ?? nm.en;
  }
  return l.area_text || human(l.district);
}
export const districtShort = (l: Partial<Listing> | null | undefined) => String(districtName(l)).split(/\s+\/\s+/)[0];
export const shortLabel = (l: Partial<Listing> | null | undefined) => [l?.bedrooms != null ? t('br', { n: l.bedrooms }) : null, districtName(l)].filter(Boolean).join(', ');
export const priceText = (l: Partial<Listing> | null | undefined) => money(l?.price, l?.currency);
export function extraCost(l: Partial<Listing> | null | undefined) {
  const f = l?.fields ?? {};
  if (['token_tenant', 'postpaid_tenant'].includes(f.electricity)) return t('plus_power');
  if (f.utilities_billing === 'by_meters') return t('plus_utils');
  return '';
}
export const subRegion = () => {
  const s = D()?.search;
  return S.regions?.[s?.country]?.sub?.[String(s?.region).split('/')[1]] ?? null;
};
export const travelKmh = () => D()?.search?.brief?.travel_kmh || subRegion()?.travel?.kmh || 25;
export const travelMode = () => {
  const m = D()?.search?.brief?.travel_mode || subRegion()?.travel?.mode;
  return (STR[LANG] as { [key: string]: unknown })['mode_' + m] ? t('mode_' + m) : t('mode_any');
};
export const minutesFor = (dist: number) => Math.max(1, Math.round(((dist * ROAD) / travelKmh()) * 60));
/** New for me: I have not voted, and either nobody decided yet or friends voted (not agent-set, not taken). */
export function isNewForMe(l: Listing, mine: Set<string>) {
  if (mine.has(l.id) || ['rejected', 'taken', 'closed'].includes(l.status) || l.decision === 'take') return false;
  return !l.decision || votesFor(l.id).length > 0;
}
export function deckIds(d: State): string[] {
  const mine = new Set(d.votes.filter((v) => v.user_id === d.user.id).map((v) => v.listing_id));
  return d.listings
    .filter((l) => isNewForMe(l, mine))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map((l) => l.id);
}
export function agentAwayHours() {
  const s = D()?.agent_last_seen;
  if (!s) return 0;
  const h = Math.floor((Date.now() - Date.parse(s)) / 3600e3);
  return h >= 24 ? h : 0; // wave 8.1: a small line in the settings sheet only, after a day
}
export function viewingsByDay() {
  const out = new Map<string, Viewing[]>();
  for (const v of D()?.viewings ?? []) {
    const k = dayKey(v.starts_at);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(v);
  }
  return out;
}
export function defaultDay(days: string[]): string | null {
  const today = dayKey(new Date().toISOString());
  if (days.includes(today)) return today;
  return days.find((d) => d > today) ?? days[days.length - 1] ?? null;
}
export const sceneStyle = (c: string) => (S.regions?.[c]?.scene ? `--scene:url(/art/${c}/motif-scene.svg)` : '');
export const markStyle = (c: string) => (S.regions?.[c]?.scene ? `--mark:url(/art/${c}/motif-mark.svg)` : '');
/** Living in the chosen home (a deal or the path's home listing), not a guest. */
export function homeMode() {
  const d = D();
  if (!d?.search || !d.me || d.me.role === 'guest') return false;
  return d.path ? !!d.path.home_listing_id : !!d.deal;
}
