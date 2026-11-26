// Which conversations Hunt sees, and taking it all back.
// Telegram: the person connects this bot to their account (Chat automation) and picks the chats there; Telegram itself enforces the choice.
//   A message of anyone who is not one of the person's known owners is thrown away unread. Reading and answering start only when the bot
//   has no more rights than it needs.
// WhatsApp: a button. The text is ready, the person sends it from their own app and brings the answer back.
// Revoking: we stop at once and erase; removing the bot in Telegram is the one step only the person can do.
import { Env, HttpError, json, body, now, rid, event, parseJson, redactSensitive, sensitive, sha256hex } from './util';
import { mineSql, isOwnContact } from './household';
import { seal, sealOn, openRows, openDraft, eraseKey, MSG } from './vault';
import { tg, tgDry, kb } from './tg';
import { notifyIncoming } from './notify';
import { rateLimit } from './media';

const ALLOWED = new Set(['can_reply', 'can_read_messages']); // reading = only the "seen" mark
const DAY = 864e5;
const WINDOW = DAY - 5 * 60e3; // Telegram lets the bot answer for 24 hours; five minutes spare
const S = '(SELECT id FROM searches WHERE owner_id=?1)';
const LIVE = `(m.search_id IN ${S} OR (m.search_id IS NULL AND m.listing_id IN (SELECT id FROM listings WHERE search_id IN ${S})))`;

interface Row { user_id: string; tg_status: string; tg_conn: string | null; tg_extra: string; tg_mode: string | null; wa_status: string; dropped: number; retain_days: number; ai_cap: number | null }
const get = (env: Env, uid: string) => env.DB.prepare('SELECT * FROM access WHERE user_id=?').bind(uid).first<Row>();
const ensure = (env: Env, uid: string) => env.DB.prepare('INSERT OR IGNORE INTO access (user_id, created_at, updated_at) VALUES (?1,?2,?2)').bind(uid, now()).run();

// ---------------------------------------------------------------- Telegram updates

/** The person connected the bot, changed its rights, or removed it. */
export async function onBusinessConnection(env: Env, bc: any): Promise<void> {
  const u = await env.DB.prepare('SELECT id, tg_user_id, lang FROM users WHERE tg_user_id=?').bind(Number(bc?.user?.id) || 0).first<any>();
  if (!u) return; // a stranger's connection: nothing is stored and nothing is read
  await ensure(env, u.id);
  const ru = u.lang !== 'en';
  if (!bc.is_enabled) {
    const was = await get(env, u.id);
    await env.DB.prepare("UPDATE access SET tg_status='off', tg_conn=NULL, tg_extra='[]', updated_at=? WHERE user_id=?").bind(now(), u.id).run();
    const last = await env.DB.prepare('SELECT id, data FROM access_receipts WHERE user_id=? ORDER BY at DESC LIMIT 1').bind(u.id).first<any>();
    const data = parseJson<any>(last?.data, null);
    if (was?.tg_status === 'revoking' && data?.tg === 'wait') await env.DB.prepare('UPDATE access_receipts SET data=? WHERE id=?').bind(JSON.stringify({ ...data, tg: 'done' }), last.id).run();
    return;
  }
  const r = await get(env, u.id);
  if (r?.tg_status === 'revoking') return; // the person took access back here: nothing starts again until the bot is removed
  const rights = bc.rights && typeof bc.rights === 'object' ? bc.rights : bc.can_reply ? { can_reply: true } : {};
  const extra = Object.keys(rights).filter((k) => rights[k] === true && !ALLOWED.has(k)).map((k) => k.slice(0, 40)).slice(0, 20);
  const status = extra.length ? 'rights' : 'on';
  await env.DB.prepare('UPDATE access SET tg_status=?, tg_conn=?, tg_extra=?, updated_at=? WHERE user_id=?').bind(status, String(bc.id), JSON.stringify(extra), now(), u.id).run();
  if (r?.tg_status !== status) await tg(env, 'sendMessage', {
    chat_id: u.tg_user_id,
    text: status === 'on'
      ? ru ? 'Telegram подключён. Читаю только хозяев из твоих проектов, остальное выбрасываю не глядя.' : 'Telegram is connected. I read only the owners of your projects and throw the rest away unread.'
      : ru ? 'Telegram подключён, но прав больше, чем нужно. Пока они есть, я ничего не читаю. Открой Hunt: там написано, что убрать.' : 'Telegram is connected with more rights than needed. I read nothing until they are gone. Open Hunt to see which.',
    reply_markup: kb([[{ text: 'Hunt', web_app: { url: `${env.PUBLIC_URL}/app` } }]]),
  }).catch(() => null);
}

/** A message in a chat the person opened to the bot. Not a known owner → counted and gone: no text, no name, no id is kept or logged. */
export async function onBusinessMessage(env: Env, msg: any): Promise<void> {
  if (!msg?.business_connection_id || msg.chat?.type !== 'private') return;
  const a = await env.DB.prepare("SELECT a.*, u.tg_user_id FROM access a JOIN users u ON u.id=a.user_id WHERE a.tg_conn=? AND a.tg_status='on'").bind(String(msg.business_connection_id)).first<Row & { tg_user_id: number }>();
  if (!a) return;
  if (msg.sender_business_bot) return; // what this bot sent itself is logged when it is sent
  const uid = a.user_id, chat = Number(msg.chat.id);
  const names = [msg.chat.username ? '@' + String(msg.chat.username).toLowerCase() : '', msg.chat.username ? String(msg.chat.username).toLowerCase() : '', String(chat)].filter(Boolean);
  const c = await env.DB.prepare(`SELECT c.id FROM contacts c WHERE ${mineSql('?1')} AND (c.id IN (SELECT contact_id FROM access_peers WHERE user_id=?1 AND chat_id=?2)
      OR c.id IN (SELECT contact_id FROM contact_channels WHERE channel='telegram' AND lower(address) IN (SELECT value FROM json_each(?3)))) LIMIT 1`).bind(uid, chat, JSON.stringify(names)).first<{ id: string }>();
  const muted = c ? await env.DB.prepare('SELECT 1 FROM access_mutes WHERE user_id=? AND contact_id=?').bind(uid, c.id).first() : null;
  const at = await placeOf(env, uid, c?.id);
  if (!c || muted || !at) return void (await env.DB.prepare('UPDATE access SET dropped=dropped+1 WHERE user_id=?').bind(uid).run());
  const dir = Number(msg.from?.id) === Number(a.tg_user_id) ? 'out' : 'in';
  const when = new Date((Number(msg.date) || Date.now() / 1000) * 1000).toISOString();
  await env.DB.prepare(`INSERT INTO access_peers (user_id, contact_id, chat_id, last_in_at) VALUES (?1,?2,?3,?4)
      ON CONFLICT(user_id, contact_id) DO UPDATE SET chat_id=excluded.chat_id, last_in_at=coalesce(excluded.last_in_at, last_in_at)`).bind(uid, c.id, chat, dir === 'in' ? when : null).run();
  const kind = ['photo', 'video', 'voice', 'audio', 'document', 'sticker', 'location'].find((k) => msg[k]);
  await logMessage(env, uid, { ...at, contact_id: c.id, channel: 'telegram', direction: dir, text: msg.text ?? msg.caption ?? '', kind, external_id: `tgb:${uid}:${chat}:${msg.message_id}`, at: when });
}

/** The newest open project of the person this contact belongs to. */
async function placeOf(env: Env, uid: string, cid: string | undefined): Promise<{ search_id: string; listing_id: string | null } | null> {
  if (!cid) return null;
  return env.DB.prepare(`SELECT s.id search_id, (SELECT coalesce((SELECT t.listing_id FROM threads t WHERE t.search_id=s.id AND t.contact_id=?2),
        (SELECT lc.listing_id FROM listing_contacts lc JOIN listings l ON l.id=lc.listing_id WHERE lc.contact_id=?2 AND l.search_id=s.id LIMIT 1))) listing_id
      FROM searches s WHERE s.owner_id=?1 AND s.status!='closed' AND (s.id IN (SELECT search_id FROM threads WHERE contact_id=?2)
        OR s.id IN (SELECT l.search_id FROM listing_contacts lc JOIN listings l ON l.id=lc.listing_id WHERE lc.contact_id=?2)
        OR s.id IN (SELECT search_id FROM drafts WHERE contact_id=?2) OR s.id IN (SELECT search_id FROM messages WHERE contact_id=?2))
      ORDER BY s.updated_at DESC LIMIT 1`).bind(uid, cid).first();
}

async function logMessage(env: Env, uid: string, x: { search_id: string; listing_id: string | null; contact_id: string; channel: string; direction: 'in' | 'out'; text: string; kind?: string; external_id: string; at: string; quiet?: boolean }) {
  const text = redactSensitive(String(x.text ?? '').slice(0, 4000)) ?? '';
  const r = await env.DB.prepare('INSERT OR IGNORE INTO messages (id, search_id, contact_id, listing_id, channel, direction, text, media, external_id, at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(rid('m_'), x.search_id, x.contact_id, x.listing_id, x.channel, x.direction, await seal(env, uid, text), JSON.stringify(x.kind ? [{ type: x.kind }] : []), x.external_id, x.at).run();
  if (!r.meta.changes) return;
  await env.DB.prepare(`INSERT INTO threads (search_id, contact_id, listing_id, state, last_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6)
      ON CONFLICT(search_id, contact_id) DO UPDATE SET state=excluded.state, last=NULL, last_at=excluded.last_at, updated_at=excluded.updated_at`)
    .bind(x.search_id, x.contact_id, x.listing_id, x.direction === 'in' ? 'waiting_us' : 'waiting_them', x.at, now()).run();
  if (x.direction === 'in' && !x.quiet) await notifyIncoming(env, { search_id: x.search_id, contact_id: x.contact_id, listing_id: x.listing_id, channel: x.channel, text });
}

// ---------------------------------------------------------------- sending

/** An approved draft for a Telegram contact who wrote within 24 hours: sent from the person's account by the connected bot. */
export async function sendViaBusiness(env: Env, draftId: string): Promise<boolean> {
  const d = await env.DB.prepare(`SELECT d.*, s.owner_id, a.tg_conn, p.chat_id, p.last_in_at FROM drafts d JOIN searches s ON s.id=d.search_id
      JOIN access a ON a.user_id=s.owner_id AND a.tg_status='on' JOIN access_peers p ON p.user_id=s.owner_id AND p.contact_id=d.contact_id
      WHERE d.id=? AND d.channel='telegram' AND d.status IN ('approved','edited')
        AND NOT EXISTS (SELECT 1 FROM access_mutes m WHERE m.user_id=s.owner_id AND m.contact_id=d.contact_id)`).bind(draftId).first<any>();
  if (!d || !d.last_in_at || Date.parse(d.last_in_at) < Date.now() - WINDOW) return false;
  const claim = await env.DB.prepare("UPDATE drafts SET status='sending', updated_at=? WHERE id=? AND status=?").bind(now(), d.id, d.status).run();
  if (!claim.meta.changes) return false;
  await openDraft(env, d);
  const text = d.edited_text ?? d.text;
  try {
    if (!text) throw new HttpError(409, 'no_text');
    const m = await tg<any>(env, 'sendMessage', { business_connection_id: d.tg_conn, chat_id: d.chat_id, text });
    await env.DB.prepare("UPDATE drafts SET status='sent', updated_at=? WHERE id=?").bind(now(), d.id).run();
    await logMessage(env, d.owner_id, { search_id: d.search_id, listing_id: d.listing_id, contact_id: d.contact_id, channel: 'telegram', direction: 'out', text, external_id: `tgb:${d.owner_id}:${d.chat_id}:${m?.message_id ?? d.id}`, at: now() });
    return true;
  } catch (e) {
    // A refusal by Telegram = certainly not sent: the draft waits again (the person's own app, or the agent). Anything else may have left.
    const refused = e instanceof HttpError && ['telegram', 'telegram_off', 'no_text'].includes(e.code);
    await env.DB.prepare('UPDATE drafts SET status=?, updated_at=? WHERE id=?').bind(refused ? d.status : 'failed', now(), d.id).run();
    return false;
  }
}

const digits = (s: string) => s.replace(/\D/g, '');
/** The chat in the person's own app with the text ready. */
export function chatUrl(channel: string, address: string, text: string): string | null {
  if (channel === 'whatsapp') { const n = digits(address); return n.length >= 7 ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null; }
  if (channel === 'telegram') { const u = String(address).replace(/^@/, ''); return /^[a-z][a-z0-9_]{3,31}$/i.test(u) ? `https://t.me/${u}?text=${encodeURIComponent(text)}` : null; }
  // Viber: the chat link is not in Viber's docs and takes no text (best effort); LINE: an official account (@id) opens with the text, a person's ID only through the share sheet.
  if (channel === 'viber') { const n = digits(address); return n.length >= 7 ? `viber://chat?number=%2B${n}` : null; }
  if (channel === 'line') { const a = String(address).trim(); return /^@[a-z0-9._-]{2,40}$/i.test(a) ? `https://line.me/R/oaMessage/${encodeURIComponent(a)}/?${encodeURIComponent(text)}` : a ? `https://line.me/R/share?text=${encodeURIComponent(text)}` : null; }
  return null;
}
async function ownDraft(env: Env, uid: string, id: unknown) {
  const d = await env.DB.prepare('SELECT d.*, s.owner_id FROM drafts d JOIN searches s ON s.id=d.search_id WHERE d.id=? AND s.owner_id=?').bind(String(id ?? ''), uid).first<any>();
  if (!d) throw new HttpError(404, 'no_draft');
  return openDraft(env, d);
}

// ---------------------------------------------------------------- deleting

/** Conversations of these projects: messages, the texts of drafts, summaries. Returns the number of messages. */
async function purge(env: Env, uid: string, sid: string | null): Promise<number> {
  const sc = sid ? '(SELECT id FROM searches WHERE owner_id=?1 AND id=?2)' : S;
  const b = (q: string) => env.DB.prepare(q).bind(...(sid ? [uid, sid] : [uid]));
  const where = `(search_id IN ${sc} OR (search_id IS NULL AND listing_id IN (SELECT id FROM listings WHERE search_id IN ${sc})))`;
  const n = Number((await b(`SELECT COUNT(*) n FROM messages WHERE ${where}`).first<{ n: number }>())?.n ?? 0);
  await env.DB.batch([
    b(`DELETE FROM outbox WHERE key IN (SELECT 'draft:'||id FROM drafts WHERE search_id IN ${sc}) OR key IN (SELECT 'in:'||search_id||':'||contact_id FROM threads WHERE search_id IN ${sc})`),
    b(`DELETE FROM messages WHERE ${where}`),
    b(`UPDATE drafts SET text='', edited_text=NULL, tr=NULL, reason=NULL, status=CASE WHEN status IN ('pending','approved','edited') THEN 'rejected' ELSE status END WHERE search_id IN ${sc} AND contact_id IS NOT NULL`),
    b(`DELETE FROM threads WHERE search_id IN ${sc}`),
    b(`DELETE FROM events WHERE kind IN ('thread','instruction') AND search_id IN ${sc}`),
  ]);
  return n;
}

/** Cron: conversations of projects closed more than retain_days ago (only for people who connected something here), one per tick; stuck sends. */
export async function accessCron(env: Env): Promise<void> {
  await env.DB.prepare("UPDATE drafts SET status='failed' WHERE status='sending' AND updated_at < ?").bind(new Date(Date.now() - 10 * 60e3).toISOString()).run();
  const s = await env.DB.prepare(`SELECT s.id, s.owner_id FROM searches s JOIN access a ON a.user_id=s.owner_id
      WHERE s.status='closed' AND s.closed_at IS NOT NULL AND julianday(s.closed_at) < julianday('now') - a.retain_days
        AND EXISTS (SELECT 1 FROM messages m WHERE m.search_id=s.id UNION ALL SELECT 1 FROM threads t WHERE t.search_id=s.id) LIMIT 1`).first<{ id: string; owner_id: string }>();
  if (s) await purge(env, s.owner_id, s.id);
}

/** Who opened the conversations (one row per person, way and day). */
export async function seen(env: Env, owner: string, actor: string, via: 'app' | 'agent'): Promise<void> {
  await env.DB.prepare('INSERT OR IGNORE INTO access_log (user_id, actor, via, day) VALUES (?,?,?,?)').bind(owner, actor, via, now().slice(0, 10)).run().catch(() => null);
}

async function revoke(req: Request, env: Env, uid: string, data: boolean): Promise<Response> {
  await ensure(env, uid);
  const a = (await get(env, uid))!;
  const DB = env.DB;
  const tgSt = a.tg_status === 'off' ? 'off' : 'wait';
  // First stop: from here no update is read and no draft is sent.
  await DB.prepare("UPDATE access SET tg_status=?, tg_conn=NULL, tg_extra='[]', wa_status='off', updated_at=? WHERE user_id=?").bind(tgSt === 'wait' ? 'revoking' : 'off', now(), uid).run();
  const rec: any = { tg: tgSt, wa: a.wa_status === 'off' ? 'off' : 'done', data: data ? 'done' : 'kept', sealed: sealOn(env) };
  if (data) {
    // Anything that was ever stored as plain text stays readable in the database's backups until they expire: say so.
    const P = "NOT LIKE 'enc1:%'";
    const plain = await DB.prepare(`SELECT 1 FROM messages WHERE search_id IN ${S} AND ((text!='' AND text ${P}) OR tr ${P})
      UNION ALL SELECT 1 FROM drafts WHERE search_id IN ${S} AND contact_id IS NOT NULL AND text!='' AND text ${P}
      UNION ALL SELECT 1 FROM threads WHERE search_id IN ${S} AND (known ${P} OR open ${P} OR last ${P}) LIMIT 1`).bind(uid).first();
    const keyed = await DB.prepare('SELECT 1 FROM chat_keys WHERE owner_id=?').bind(uid).first();
    rec.messages = await purge(env, uid, null);
    await eraseKey(env, uid);
    rec.copies = keyed && !plain ? 'erased' : plain || rec.messages ? 'plain' : 'none';
    await DB.batch([
      DB.prepare('DELETE FROM access_peers WHERE user_id=?').bind(uid), DB.prepare('DELETE FROM access_mutes WHERE user_id=?').bind(uid),
      DB.prepare('DELETE FROM access_log WHERE user_id=?').bind(uid), DB.prepare('UPDATE access SET dropped=0 WHERE user_id=?').bind(uid),
      DB.prepare("DELETE FROM bot_state WHERE tg_user_id=(SELECT tg_user_id FROM users WHERE id=?) AND json_extract(state,'$.kind')='wa_reply'").bind(uid),
    ]);
  }
  // Every other way in: site sessions but this one, signed links, agents' keys.
  const mine = (req.headers.get('cookie') ?? '').match(/(?:^|;\s*)hunt_s=([^;]+)/)?.[1];
  const keep = mine ? await sha256hex(mine) : '';
  const ws = await DB.prepare('DELETE FROM web_sessions WHERE user_id=? AND hash!=?').bind(uid, keep).run();
  const tk = await DB.prepare('UPDATE tokens SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').bind(now(), uid).run();
  await DB.prepare('UPDATE users SET link_gen=link_gen+1 WHERE id=?').bind(uid).run();
  rec.sessions = ws.meta.changes ?? 0;
  rec.agents = tk.meta.changes ?? 0;
  const id = rid('ar_'), at = now();
  await DB.prepare('INSERT INTO access_receipts (id, user_id, data, at) VALUES (?,?,?,?)').bind(id, uid, JSON.stringify(rec), at).run();
  return json({ ok: true, receipt: { id, at, ...rec } });
}

// ---------------------------------------------------------------- the app

export async function accessApp(req: Request, env: Env, path: string, user: { id: string; tg_user_id?: number | null; lang?: string; scope?: unknown }): Promise<Response | null> {
  if (path !== '/app/api/access' && !path.startsWith('/app/api/access/')) return null;
  if (user.scope) throw new HttpError(403, 'link_scope');
  const uid = user.id, DB = env.DB;
  if (path === '/app/api/access' && req.method === 'GET') {
    const [a, con, log, rec, cls, ai] = await DB.batch<any>([
      DB.prepare('SELECT * FROM access WHERE user_id=?').bind(uid),
      DB.prepare(`SELECT m.contact_id id, c.name, m.channel, COUNT(*) n, MAX(m.at) at, (SELECT 1 FROM access_mutes x WHERE x.user_id=?1 AND x.contact_id=m.contact_id) muted,
          (SELECT search_id FROM messages y WHERE y.contact_id=m.contact_id AND y.search_id IS NOT NULL ORDER BY y.at DESC LIMIT 1) search_id
          FROM messages m LEFT JOIN contacts c ON c.id=m.contact_id WHERE m.contact_id IS NOT NULL AND ${LIVE} GROUP BY m.contact_id, m.channel ORDER BY at DESC LIMIT 100`).bind(uid),
      DB.prepare('SELECT l.actor, u.display_name name, l.via, MAX(l.day) day, COUNT(*) days FROM access_log l LEFT JOIN users u ON u.id=l.actor WHERE l.user_id=? AND l.day >= ? GROUP BY l.actor, l.via ORDER BY day DESC LIMIT 20').bind(uid, new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10)),
      DB.prepare('SELECT id, data, at FROM access_receipts WHERE user_id=? ORDER BY at DESC LIMIT 5').bind(uid),
      DB.prepare("SELECT id, title, closed_at FROM searches WHERE owner_id=? AND status='closed' AND closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 5").bind(uid),
      DB.prepare(`SELECT kind, COUNT(*) n, SUM(usd) usd FROM ai_usage WHERE search_id IN ${S} GROUP BY kind`).bind(uid),
    ]);
    const r = a.results?.[0] as Row | undefined;
    const keep = r?.retain_days ?? 30;
    return json({
      bot: env.BOT_USERNAME, sealed: sealOn(env),
      tg: { status: r?.tg_status ?? 'off', mode: r?.tg_mode ?? null, extra: parseJson(r?.tg_extra, []) },
      wa: { status: r?.wa_status ?? 'off' },
      contacts: con.results ?? [], dropped: r?.dropped ?? 0, log: log.results ?? [], retain_days: keep, connected: !!r,
      purges: r ? (cls.results ?? []).map((s: any) => ({ id: s.id, title: s.title, at: new Date(Date.parse(s.closed_at) + keep * DAY).toISOString() })) : [],
      receipts: (rec.results ?? []).map((x: any) => ({ id: x.id, at: x.at, ...parseJson<any>(x.data, {}) })),
      ai: env.AI_ON === '1' ? { cap: r?.ai_cap ?? 15, by: ai.results ?? [] } : null,
    });
  }
  if (path === '/app/api/access/export' && req.method === 'GET') {
    await rateLimit(env, 'accexport', uid, 10);
    const rows = (await DB.prepare(`SELECT m.at, m.channel, m.direction, c.name contact, m.text, m.tr FROM messages m LEFT JOIN contacts c ON c.id=m.contact_id WHERE ${LIVE} ORDER BY m.at LIMIT 5000`).bind(uid).all<any>()).results ?? [];
    await openRows(env, rows, MSG);
    return new Response(JSON.stringify({ exported_at: now(), messages: rows }, null, 1), { headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="hunt-chats.json"', 'cache-control': 'no-store' } });
  }
  if (req.method !== 'POST') throw new HttpError(405, 'method');
  const b = await body(req);
  const what = path.slice('/app/api/access/'.length);
  if (what === 'set') {
    await ensure(env, uid);
    if (b.tg_mode === 'new' || b.tg_mode === 'only') await DB.prepare('UPDATE access SET tg_mode=?, updated_at=? WHERE user_id=?').bind(b.tg_mode, now(), uid).run();
    if (b.wa === 'button' || b.wa === 'off') await DB.prepare('UPDATE access SET wa_status=?, updated_at=? WHERE user_id=?').bind(b.wa, now(), uid).run();
    if (b.again) await DB.prepare("UPDATE access SET tg_status='off', tg_conn=NULL, updated_at=? WHERE user_id=? AND tg_status='revoking'").bind(now(), uid).run();
    if (b.cap != null) { const n = Number(b.cap); if (!(n >= 1 && n <= 200)) throw new HttpError(400, 'bad_cap'); await DB.prepare('UPDATE access SET ai_cap=?, updated_at=? WHERE user_id=?').bind(n, now(), uid).run(); }
    return json({ ok: true });
  }
  if (what === 'mute') {
    const cid = String(b.contact_id ?? '');
    if (!(await isOwnContact(env, uid, cid))) throw new HttpError(404, 'no_contact');
    await ensure(env, uid);
    await DB.prepare(b.on ? 'INSERT OR IGNORE INTO access_mutes (user_id, contact_id) VALUES (?,?)' : 'DELETE FROM access_mutes WHERE user_id=? AND contact_id=?').bind(uid, cid).run();
    return json({ ok: true });
  }
  // The first message, or any message outside the 24 hours: the person's own app with the text ready; "sent" is what the person says.
  if (what === 'open') {
    const d = await ownDraft(env, uid, b.draft_id);
    if (d.status !== 'pending') throw new HttpError(409, 'already_decided', d.status);
    const text = String(b.text ?? d.text).trim().slice(0, 2000);
    if (!text) throw new HttpError(400, 'no_text');
    if (sensitive(text)) throw new HttpError(400, 'sensitive');
    const url = chatUrl(d.channel, d.address, text);
    if (!url) throw new HttpError(409, 'no_link', 'No phone number or @name to open');
    if (text !== d.text) await DB.prepare("UPDATE drafts SET edited_text=?, updated_at=? WHERE id=? AND status='pending'").bind(await seal(env, uid, text), now(), d.id).run();
    return json({ ok: true, url });
  }
  if (what === 'sent') {
    const d = await ownDraft(env, uid, b.draft_id);
    const r = await DB.prepare("UPDATE drafts SET status='sent', decided_by=?, updated_at=? WHERE id=? AND status='pending'").bind(uid, now(), d.id).run();
    if (!r.meta.changes) throw new HttpError(409, 'already_decided', d.status);
    await event(env, d.search_id, 'draft_decided', d.id, uid, { status: 'sent', own: true });
    if (d.contact_id) {
      await logMessage(env, uid, { search_id: d.search_id, listing_id: d.listing_id, contact_id: d.contact_id, channel: d.channel, direction: 'out', text: d.edited_text ?? d.text, external_id: `app:${d.id}`, at: now() });
      const c = await DB.prepare('SELECT name FROM contacts WHERE id=?').bind(d.contact_id).first<any>();
      const ru = user.lang !== 'en', who = c?.name ?? (ru ? 'хозяин' : 'the owner');
      if (d.channel === 'whatsapp' && user.tg_user_id && !tgDry(env)) await tg(env, 'sendMessage', { chat_id: user.tg_user_id, text: ru ? `Отправлено: ${who}. Когда ответит, нажми и перешли текст сюда.` : `Sent: ${who}. When they answer, press and forward the text here.`,
        reply_markup: kb([[{ text: ru ? `${who} отвечает` : `${who} answered`, callback_data: `ar:go:${d.contact_id}` }]]) }).catch(() => null);
    }
    return json({ ok: true });
  }
  if (what === 'reply') {
    const r = await waReply(env, uid, String(b.contact_id ?? ''), String(b.text ?? ''));
    if (!r) throw new HttpError(404, 'no_contact');
    return json({ ok: true });
  }
  if (what === 'revoke') {
    await rateLimit(env, 'revoke', uid, 20);
    return revoke(req, env, uid, b.data !== false);
  }
  throw new HttpError(404, 'not_found');
}

// ---------------------------------------------------------------- the bot: an answer brought by hand

async function waReply(env: Env, uid: string, cid: string, text: string): Promise<boolean> {
  text = text.trim();
  if (!text || !(await isOwnContact(env, uid, cid))) return false;
  const at = await placeOf(env, uid, cid);
  if (!at) return false;
  const ch = await env.DB.prepare("SELECT channel FROM contact_channels WHERE contact_id=? ORDER BY channel='whatsapp' DESC LIMIT 1").bind(cid).first<{ channel: string }>();
  await logMessage(env, uid, { ...at, contact_id: cid, channel: ch?.channel ?? 'whatsapp', direction: 'in', text, external_id: `hand:${rid('')}`, at: now() });
  return true;
}
/** Button "X answered" → the next text in the bot is that person's answer. */
export async function replyCallback(env: Env, user: any, q: any, cid: string): Promise<string | null> {
  if (!(await isOwnContact(env, user.id, cid))) return null;
  const ru = user.lang !== 'en';
  await env.DB.prepare('INSERT OR REPLACE INTO bot_state (tg_user_id, state, at) VALUES (?,?,?)').bind(q.from.id, JSON.stringify({ kind: 'wa_reply', contact_id: cid }), now()).run();
  await tg(env, 'sendMessage', { chat_id: q.message.chat.id, text: ru ? 'Перешли или вставь ответ одним сообщением.' : 'Forward or paste the answer in one message.', reply_markup: { force_reply: true } }).catch(() => null);
  return ru ? 'Жду ответ' : 'Waiting';
}
export async function replyMessage(env: Env, user: any, chat: number, state: any, text: string): Promise<boolean> {
  if (state?.kind !== 'wa_reply') return false;
  await env.DB.prepare('DELETE FROM bot_state WHERE tg_user_id=?').bind(user.tg_user_id).run();
  const ok = await waReply(env, user.id, String(state.contact_id), text), ru = user.lang !== 'en';
  await tg(env, 'sendMessage', { chat_id: chat, text: ok ? (ru ? 'Записал в переписку.' : 'Added to the conversation.') : ru ? 'Не нашёл этого человека в открытых проектах.' : 'This person is not in an open project.' }).catch(() => null);
  return true;
}
