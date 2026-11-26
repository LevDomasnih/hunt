// What only the big screen needs: the conversation itself in two languages, and what the agent did lately.
import { Env, HttpError, json, body, now, rid, event, parseJson, sensitive } from './util';
import { seal, openRows, MSG, DRAFT } from './vault';
import { seen, sendViaBusiness } from './access';
import { ownerOfSearch } from './household';

const MAX_MSG = 80;
const ROLES = "('owner','member')";
async function roleOf(env: Env, sid: string, uid: string): Promise<string> {
  const r = await env.DB.prepare(`SELECT role FROM members WHERE search_id=? AND user_id=? AND role IN ${ROLES}`).bind(sid, uid).first<{ role: string }>();
  if (!r) throw new HttpError(403, 'not_member');
  return r.role;
}

export async function deskApp(req: Request, env: Env, path: string, user: { id: string; display_name?: string; scope?: { sid: string; role: string } }): Promise<Response | null> {
  if (!['/app/api/desk', '/app/api/thread', '/app/api/say'].includes(path)) return null;
  const q = new URL(req.url).searchParams;
  if (path === '/app/api/thread' && req.method === 'GET') {
    const sid = q.get('s') ?? '', cid = q.get('c') ?? '';
    const role = await roleOf(env, sid, user.id);
    const inS = '(SELECT id FROM listings WHERE search_id=?1)';
    const known = await env.DB.prepare(`SELECT 1 FROM threads WHERE search_id=?1 AND contact_id=?2 UNION SELECT 1 FROM listing_contacts WHERE contact_id=?2 AND listing_id IN ${inS} UNION SELECT 1 FROM messages WHERE search_id=?1 AND contact_id=?2 LIMIT 1`).bind(sid, cid).first();
    if (!known) throw new HttpError(404, 'no_contact');
    const [m, d, ch, ev] = await env.DB.batch<any>([
      env.DB.prepare(`SELECT id, at, channel, direction, text, tr, listing_id, json_array_length(media) media FROM messages WHERE contact_id=?2 AND (search_id=?1 OR (search_id IS NULL AND listing_id IN ${inS})) ORDER BY at DESC LIMIT ${MAX_MSG}`).bind(sid, cid),
      env.DB.prepare("SELECT id, channel, text, tr, kind, reason, listing_id, created_at FROM drafts WHERE search_id=? AND contact_id=? AND status='pending' AND ?='owner' ORDER BY created_at").bind(sid, cid, role),
      env.DB.prepare('SELECT channel, address, display FROM contact_channels WHERE contact_id=?').bind(cid),
      env.DB.prepare(`SELECT e.kind, e.data, e.at FROM events e WHERE e.search_id=?1 AND e.kind IN ('checks','viewing_changed','deal_date') AND e.ref IN (SELECT listing_id FROM threads WHERE search_id=?1 AND contact_id=?2 UNION SELECT listing_id FROM listing_contacts WHERE contact_id=?2) ORDER BY e.id DESC LIMIT 12`).bind(sid, cid),
    ]);
    await openRows(env, m.results ?? [], MSG);
    await openRows(env, d.results ?? [], DRAFT);
    if (m.results?.length) await seen(env, await ownerOfSearch(env, sid), user.id, 'app');
    return json({
      messages: (m.results ?? []).reverse(), drafts: d.results ?? [],
      // Phone numbers and handles are the owner's business; members see the channel only.
      channels: (ch.results ?? []).map((x: any) => (role === 'owner' ? x : { channel: x.channel })),
      acts: (ev.results ?? []).map((x: any) => ({ kind: x.kind, at: x.at, data: parseJson(x.data, {}) })).reverse(),
      role,
    });
  }
  if (path === '/app/api/desk' && req.method === 'GET') {
    const sid = q.get('s') ?? '';
    const role = await roleOf(env, sid, user.id);
    const since = new Date(Date.now() - 36 * 3600e3).toISOString();
    const [ev, out, s] = await env.DB.batch<any>([
      env.DB.prepare("SELECT kind, ref, data, at FROM events WHERE search_id=? AND at>? AND actor='agent' ORDER BY id DESC LIMIT 60").bind(sid, since),
      env.DB.prepare(`SELECT m.at, m.channel, c.name FROM messages m LEFT JOIN contacts c ON c.id=m.contact_id WHERE m.search_id=? AND m.direction='out' AND m.at>? ORDER BY m.at DESC LIMIT 30`).bind(sid, since),
      env.DB.prepare('SELECT agent_seen_at FROM searches WHERE id=?').bind(sid),
    ]);
    return json({
      role, agent_seen_at: s.results?.[0]?.agent_seen_at ?? null,
      log: [...(ev.results ?? []).map((x: any) => ({ kind: x.kind, ref: x.ref, at: x.at, data: parseJson(x.data, {}) })), ...(out.results ?? []).map((x: any) => ({ kind: 'sent', at: x.at, data: { name: x.name, channel: x.channel } }))]
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 30),
    });
  }
  // The owner writes a message themselves. as_is: it goes exactly as typed on the agent's next run; otherwise the agent
  // translates it and brings the draft for approval.
  if (path === '/app/api/say' && req.method === 'POST') {
    const b = await body(req);
    const sid = String(b.search_id ?? ''), cid = String(b.contact_id ?? ''), text = String(b.text ?? '').trim().slice(0, 2000);
    if ((await roleOf(env, sid, user.id)) !== 'owner') throw new HttpError(403, 'owner_only');
    if (!text) throw new HttpError(400, 'no_text');
    const sn = sensitive(text);
    if (sn) throw new HttpError(400, 'sensitive', `It looks like ${sn}`);
    const th = await env.DB.prepare('SELECT listing_id FROM threads WHERE search_id=? AND contact_id=?').bind(sid, cid).first<any>();
    if (!th) throw new HttpError(404, 'no_contact');
    if (!b.as_is) {
      await event(env, sid, 'instruction', cid, user.id, { name: user.display_name, text, kind: 'say', contact_id: cid });
      return json({ ok: true, status: 'translating' });
    }
    const ch = await env.DB.prepare(`SELECT cc.channel, cc.address FROM contact_channels cc WHERE cc.contact_id=?1 ORDER BY cc.channel=(SELECT channel FROM messages WHERE contact_id=?1 ORDER BY at DESC LIMIT 1) DESC LIMIT 1`).bind(cid).first<any>();
    if (!ch) throw new HttpError(409, 'no_channel');
    const id = rid('d_');
    await env.DB.prepare("INSERT INTO drafts (id, search_id, contact_id, listing_id, channel, address, text, kind, reason, status, decided_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,'other',?,'approved',?,?,?)")
      .bind(id, sid, cid, th.listing_id ?? null, ch.channel, ch.address, await seal(env, user.id, text), 'the owner wrote it', user.id, now(), now()).run();
    await event(env, sid, 'draft_decided', id, user.id, { status: 'approved', own: true });
    const sent = await sendViaBusiness(env, id);
    return json({ ok: true, status: sent ? 'sent' : 'approved', draft_id: id });
  }
  return null;
}
