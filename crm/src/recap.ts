// Split from wave5.ts.
import { regionInfo } from './homepoint';
import { withSrc } from './media';
import { animalInfo } from './members';
import { dealPrices } from './negotiation';
import { type Role } from './roles';
import { Env, HttpError, now, parseJson } from './util';

// ---------------------------------------------------------------- recap

export async function recapView(env: Env, sid: string, role: Role, lang = 'ru') {
  const s = await env.DB.prepare('SELECT id, title, region, created_at FROM searches WHERE id=?').bind(sid).first<any>();
  if (!s) throw new HttpError(404, 'no_search');
  const inL = '(SELECT id FROM listings WHERE search_id=?1)';
  const [cnt, mem, dl] = await env.DB.batch<any>([
    env.DB.prepare(`SELECT (SELECT COUNT(DISTINCT contact_id) FROM messages WHERE (search_id=?1 OR listing_id IN ${inL}) AND direction='out' AND contact_id IS NOT NULL) contacted,
      (SELECT COUNT(DISTINCT contact_id) FROM messages WHERE (search_id=?1 OR listing_id IN ${inL}) AND direction='in' AND contact_id IS NOT NULL) replied,
      (SELECT COUNT(*) FROM viewings WHERE search_id=?1 AND (status='done' OR (status='confirmed' AND starts_at < ?2))) viewings,
      (SELECT COUNT(*) FROM deals WHERE search_id=?1) deals`).bind(sid, now()),
    env.DB.prepare(`SELECT m.user_id, m.animal, u.display_name name FROM members m JOIN users u ON u.id=m.user_id WHERE m.search_id=? AND m.role IN ('owner','member') ORDER BY m.role='owner' DESC, u.created_at`).bind(sid),
    env.DB.prepare(`SELECT d.listing_id, d.deal_at, d.updated_at, l.title, l.photos FROM deals d JOIN listings l ON l.id=d.listing_id WHERE d.search_id=? ORDER BY d.updated_at DESC LIMIT 1`).bind(sid),
  ]);
  const c = cnt.results?.[0] ?? {};
  const d = dl.results?.[0] ?? null;
  const { pack, sub } = await regionInfo(env, s.region);
  const dealAt = d ? d.deal_at ?? d.updated_at : null;
  const prices = d && role === 'owner' ? await dealPrices(env, d.listing_id) : null;
  const missing: string[] = [];
  if (!d) missing.push('deal');
  const photo = d ? withSrc(d.listing_id, parseJson<any[]>(d.photos, []))[0] ?? null : null;
  if (d && !photo) missing.push('photo');
  if (!Number(c.contacted)) missing.push('messages');
  if (role === 'owner' && d && (prices?.asked == null || prices?.agreed == null)) missing.push('prices');
  return {
    search: { id: s.id, title: s.title, region: s.region, region_name: sub.name?.[lang] ?? sub.name?.en ?? pack.name?.[lang] ?? pack.name?.en ?? null, country_name: pack.name?.[lang] ?? pack.name?.en ?? null },
    members: (mem.results ?? []).map((m: any) => ({ user_id: m.user_id, name: m.name, animal: animalInfo(s.region, m.animal) })),
    days: dealAt ? Math.max(1, Math.ceil((Date.parse(dealAt) - Date.parse(s.created_at)) / 864e5)) : null, created_at: s.created_at, deal_at: dealAt,
    counts: { contacted: Number(c.contacted ?? 0), replied: Number(c.replied ?? 0), viewings: Number(c.viewings ?? 0), deals: Number(c.deals ?? 0) },
    prices: prices && prices.asked != null && prices.agreed != null ? prices : null,
    listing: d ? { id: d.listing_id, title: d.title, photo } : null, complete: !missing.filter((x) => x !== 'prices').length, missing,
  };
}
