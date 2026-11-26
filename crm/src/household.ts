// One Hunt, several hunters: what belongs to whom. Contacts and dossiers are the hunter's own (contacts.owner_id,
// dossiers.owner_id); rows without an owner (made before migration 0015) count as the hunter's when linked to their projects.
import { Env, HttpError } from './util';

/** SQL on contacts `c`: the contact is ?N's own. */
export const mineSql = (n: string) => `(c.owner_id=${n} OR (c.owner_id IS NULL AND c.id IN (
    SELECT lc.contact_id FROM listing_contacts lc JOIN listings l ON l.id=lc.listing_id JOIN searches s ON s.id=l.search_id WHERE s.owner_id=${n}
    UNION SELECT t.contact_id FROM threads t JOIN searches s ON s.id=t.search_id WHERE s.owner_id=${n}
    UNION SELECT h.contact_id FROM house_contacts h JOIN searches s ON s.id=h.search_id WHERE s.owner_id=${n} AND h.contact_id IS NOT NULL
    UNION SELECT m.contact_id FROM messages m JOIN searches s ON s.id=m.search_id WHERE s.owner_id=${n} AND m.contact_id IS NOT NULL
    UNION SELECT d.contact_id FROM drafts d JOIN searches s ON s.id=d.search_id WHERE s.owner_id=${n} AND d.contact_id IS NOT NULL)))`;

export async function isOwnContact(env: Env, ownerId: string, cid: string): Promise<boolean> {
  return !!(await env.DB.prepare(`SELECT 1 FROM contacts c WHERE c.id=?2 AND ${mineSql('?1')}`).bind(ownerId, cid).first());
}
/** A contact id that came with a request, or 404 (the same answer for "not yours" and "does not exist"). */
export async function requireContact(env: Env, ownerId: string, cid: unknown): Promise<string | null> {
  if (cid == null || cid === '') return null;
  if (!(await isOwnContact(env, ownerId, String(cid)))) throw new HttpError(404, 'no_contact', `Contact ${cid} not found`);
  return String(cid);
}
export async function ownerOfSearch(env: Env, sid: string): Promise<string> {
  const r = await env.DB.prepare('SELECT owner_id FROM searches WHERE id=?').bind(sid).first<{ owner_id: string }>();
  if (!r) throw new HttpError(404, 'no_search');
  return r.owner_id;
}
/** The hunter's own contact with this exact address. */
export async function contactByAddress(env: Env, ownerId: string, channel: string | null, address: string): Promise<string | null> {
  const r = await env.DB.prepare(`SELECT c.id FROM contact_channels cc JOIN contacts c ON c.id=cc.contact_id
      WHERE cc.address=?2 ${channel ? 'AND cc.channel=?3' : ''} AND ${mineSql('?1')} ORDER BY c.created_at LIMIT 1`)
    .bind(...(channel ? [ownerId, address, channel] : [ownerId, address])).first<{ id: string }>();
  return r?.id ?? null;
}

/** Two hunters may bring the same listing ("fb-123"): the second one's row is stored as "fb-123--<search>". */
export const altListingId = (id: string, sid: string) => `${id}--${sid}`;
