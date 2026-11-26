// Split from wave5.ts.
import { addDays, localDay, searchTzOf } from './local';
import { Env, HttpError, parseJson } from './util';

// ---------------------------------------------------------------- roles

export type Role = 'owner' | 'member' | 'viewer' | 'guest';
export const GUEST_AREAS = ['guide', 'places', 'contacts', 'issues'] as const;
export type Areas = Record<(typeof GUEST_AREAS)[number], boolean>;
export interface Access { role: Role; region: string; title: string; owner_id: string; brief: string; tz: string; guest?: { from: string; to: string; areas: Areas; invited_by: string | null; animal: string | null } }

export function cleanAreas(v: any, fallback = true): Areas {
  const o: any = {};
  for (const k of GUEST_AREAS) o[k] = v && typeof v === 'object' && k in v ? !!v[k] : fallback;
  return o;
}
/** Guests can open the app 3 days before `from` until the end of `to` (search timezone). */
export const guestOpen = (g: { date_from: string; date_to: string; status: string }, today: string) => g.status === 'active' && today <= g.date_to && today >= addDays(g.date_from, -3);

/**
 * The caller's role in a search: a members row (owner / member / viewer), else an active guest inside the date window.
 * Throws 403 not_member otherwise. `roles` whitelists who may use the route.
 */
export async function member(env: Env, sid: string, uid: string, roles?: readonly Role[]): Promise<Access> {
  const r = await env.DB.prepare(
    `SELECT s.region, s.title, s.owner_id, s.brief, s.status sstatus, m.role, g.date_from, g.date_to, g.areas, g.status gstatus, g.invited_by, g.animal
     FROM searches s LEFT JOIN members m ON m.search_id=s.id AND m.user_id=?2 LEFT JOIN guests g ON g.search_id=s.id AND g.user_id=?2 WHERE s.id=?1`,
  ).bind(String(sid ?? ''), uid).first<any>();
  if (!r) throw new HttpError(403, 'not_member');
  const tz = searchTzOf(r);
  let a: Access;
  if (r.role) a = { role: r.role, region: r.region, title: r.title, owner_id: r.owner_id, brief: r.brief, tz };
  // Wave 6: guests lose access when the project is closed.
  else if (r.gstatus && r.sstatus !== 'closed' && guestOpen({ date_from: r.date_from, date_to: r.date_to, status: r.gstatus }, localDay(tz))) {
    a = { role: 'guest', region: r.region, title: r.title, owner_id: r.owner_id, brief: r.brief, tz,
      guest: { from: r.date_from, to: r.date_to, areas: cleanAreas(parseJson(r.areas, {}), false), invited_by: r.invited_by, animal: r.animal } };
  } else throw new HttpError(403, 'not_member');
  if (roles && !roles.includes(a.role)) throw new HttpError(403, a.role === 'guest' ? 'guest' : a.role === 'viewer' ? 'viewer' : 'owner_only');
  return a;
}
export function needArea(a: Access, area: (typeof GUEST_AREAS)[number]) {
  if (a.role === 'guest' && !a.guest?.areas[area]) throw new HttpError(403, 'guest_area', `Guests of this house do not have "${area}"`);
}
/** True when the user is a guest somewhere and a member nowhere (the Mini App guard answers 403 'guest' outside guest routes). */
export async function guestOnly(env: Env, uid: string): Promise<boolean> {
  const r = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM members WHERE user_id=?1) m, (SELECT COUNT(*) FROM guests WHERE user_id=?1 AND status='active') g`).bind(uid).first<any>();
  return !Number(r?.m) && Number(r?.g) > 0;
}
export async function isGuestOf(env: Env, sid: string, uid: string): Promise<boolean> {
  return !!(await env.DB.prepare('SELECT 1 FROM guests WHERE search_id=? AND user_id=?').bind(sid, uid).first());
}
