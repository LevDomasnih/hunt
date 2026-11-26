// "Share a city" (a pull request through the bot). The agent prepares a request with the pack's files; the hunter gets a card with
// the full text of what would leave, and nothing leaves before "Отправить". Then this server passes it to the sources registry, the
// registry admin decides, and the hunter hears the answer. On the admin's own server the same bot shows the proposals to review.
import { Env, HttpError, json, body, now, rid, esc, sha256hex, sensitive, parseJson } from './util';
import { rateLimit } from './media';
import { registry } from './sources';
import { tg, kb, tgDry } from './tg';

const CARD_DAYS = 14;
interface PFile { path: string; content: string }
interface Payload { note: string; author: string | null; base: string | null; files: PFile[]; sources: { section: string; entry: Record<string, unknown> }[] }
const ru = (u: any) => u.lang !== 'en';
const line = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f​-‏‪-‮]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/** What the card says, counted from the files themselves, not from the agent's words. */
export function shareSummary(p: Payload, country: string) {
  const own = (re: RegExp) => p.files.filter((f) => re.test(f.path));
  const count = (re: RegExp, path: RegExp) => own(path).reduce((n, f) => n + (f.content.match(re)?.length ?? 0), 0);
  return {
    cities: own(new RegExp(`^regions/${country}/[a-z0-9_]+/pack\\.yaml$`)).map((f) => f.path.split('/')[2]),
    districts: count(/^ {2}[a-z0-9_]+:\s*$/gm, /\/districts\.yaml$/), places: count(/^ {2}- id:/gm, /\/places\.yaml$/),
    animals: own(/\/art\/avatars\/[a-z0-9_]+\.svg$/).length, files: p.files.length, bytes: p.files.reduce((n, f) => n + f.content.length, 0), sources: p.sources.length,
  };
}
function asText(title: string, p: Payload): string {
  const head = [title, p.note, p.author ? `author: ${p.author}` : 'author: not named', ''];
  const src = p.sources.length ? ['===== groups and sites =====', ...p.sources.map((s) => `${s.section}: ${JSON.stringify(s.entry)}`), ''] : [];
  return [...head, ...src, ...p.files.flatMap((f) => [`===== ${f.path} =====`, f.content, ''])].join('\n');
}
async function sendText(env: Env, chat: number, name: string, text: string, caption: string, rows: any[][]) {
  const fd = new FormData();
  fd.set('chat_id', String(chat));
  fd.set('document', new File(['﻿' + text], name, { type: 'text/plain; charset=utf-8' }), name);
  fd.set('caption', caption.slice(0, 1024));
  fd.set('parse_mode', 'HTML');
  fd.set('reply_markup', JSON.stringify(kb(rows)));
  return tg(env, 'sendDocument', fd);
}
/** Telegram HTML captions are cut at 1024 characters: keep the free text short so that no tag is cut. */
function card(u: any, title: string, p: Payload, country: string): string {
  const s = shareSummary(p, country), R = ru(u);
  const what = [s.cities.length ? `${R ? 'города' : 'cities'}: ${s.cities.join(', ')}` : '', s.districts ? `${R ? 'районы' : 'districts'}: ${s.districts}` : '', s.places ? `${R ? 'места' : 'places'}: ${s.places}` : '',
    s.animals ? `${R ? 'звери' : 'animals'}: ${s.animals}` : '', s.sources ? `${R ? 'группы и сайты' : 'groups and sites'}: ${s.sources}` : '', `${R ? 'файлов' : 'files'}: ${s.files} (${Math.max(1, Math.round(s.bytes / 1024))} KB)`].filter(Boolean);
  return R
    ? `<b>Поделиться с другими: ${esc(title.slice(0, 100))}</b>\n\nУйдёт в общий каталог Hunt на проверку:\n${esc(what.join('\n')).slice(0, 420)}\n\nНе уйдёт: твои дома, переписка, люди, деньги, заметки. Автор: ${p.author ? esc(p.author) : 'без имени'}.\n\nВсё, что уйдёт, лежит в файле. Без твоего «да» ничего не отправится.`
    : `<b>Share with others: ${esc(title.slice(0, 100))}</b>\n\nWould go to the shared Hunt catalogue for review:\n${esc(what.join('\n')).slice(0, 420)}\n\nWould not go: your homes, chats, people, money, notes. Author: ${p.author ? esc(p.author) : 'not named'}.\n\nEverything that would go is in the file. Nothing is sent without your yes.`;
}

export async function sharesAgent(req: Request, env: Env, p: string[], user: any): Promise<Response | null> {
  if (p[1] !== 'shares' || p.length !== 2) return null;
  if (req.method === 'GET') {
    const r = await env.DB.prepare('SELECT id, country, title, status, comment, created_at, updated_at FROM pack_shares WHERE user_id=? ORDER BY created_at DESC LIMIT 50').bind(user.id).all();
    return json({ shares: r.results ?? [] });
  }
  if (req.method !== 'POST') return null;
  if (!registry(env)) throw new HttpError(404, 'sources_off', 'This Hunt server has no sources registry: there is nowhere to share to');
  if (!user.tg_user_id) throw new HttpError(409, 'no_tg_user', 'The hunter has not started the bot: there is nobody to ask');
  await rateLimit(env, 'shares', user.id, 20, 86400);
  const raw = await req.text();
  if (raw.length > 1_000_000) throw new HttpError(413, 'too_big', 'At most about 900 KB of text files');
  const b = parseJson<any>(raw, null);
  if (!b || typeof b !== 'object') throw new HttpError(400, 'bad_json', 'Body must be JSON');
  const country = line(b.country, 20).toLowerCase(), title = line(b.title, 120);
  if (!/^[a-z]{2,20}$/.test(country) || !title) throw new HttpError(400, 'missing', 'country and title');
  const files: PFile[] = Array.isArray(b.files) ? b.files.filter((f: any) => f && typeof f.path === 'string' && typeof f.content === 'string').map((f: any) => ({ path: f.path, content: f.content })) : [];
  const sources = (Array.isArray(b.sources) ? b.sources : []).filter((s: any) => s && typeof s.section === 'string' && s.entry && typeof s.entry === 'object').map((s: any) => ({ section: s.section, entry: s.entry }));
  if (!files.length && !sources.length) throw new HttpError(400, 'nothing', 'No files and no sources');
  for (const f of files) {
    if (!new RegExp(`^regions/${country}/(?:[a-z0-9_]+/){0,3}[a-z0-9_-]+\\.(yaml|md|geojson|svg)$`).test(f.path)) throw new HttpError(400, 'bad_path', f.path.slice(0, 120));
    const hit = /\.(yaml|md)$/.test(f.path) ? sensitive(f.content) : null;
    if (hit) throw new HttpError(400, 'sensitive', `${f.path} has ${hit}: remove it`);
  }
  const author = b.author ? line(b.author, 40) : null;
  const pay: Payload = { note: String(b.note ?? '').slice(0, 2000), author: author && !author.startsWith('@') ? author : author?.slice(1) || null, base: b.base ? line(b.base, 40) : null, files, sources };
  const digest = await sha256hex(JSON.stringify([country, files, sources]));
  const prev = await env.DB.prepare('SELECT * FROM pack_shares WHERE user_id=? ORDER BY created_at DESC').bind(user.id).all<any>();
  const mine = prev.results ?? [];
  // hunter_asked: they asked to share in their own words, so an earlier no does not count. The card still asks.
  const asks = b.hunter_asked === true;
  if (asks) await env.DB.prepare("UPDATE pack_shares SET status='declined' WHERE user_id=? AND status='off'").bind(user.id).run();
  else if (mine.some((x) => x.status === 'off')) return json({ status: 'off', message: 'The hunter asked not to be asked about sharing' });
  const same = mine.find((x) => x.digest === digest && x.status !== 'returned' && !(asks && ['declined', 'off'].includes(x.status)));
  if (same) return json({ id: same.id, status: same.status, known: true });
  // Answered "no" for this country lately: don't come back with a new version of it every day.
  const week = new Date(Date.now() - 7 * 86400e3).toISOString();
  if (!asks && mine.some((x) => x.country === country && x.status === 'declined' && x.updated_at > week)) return json({ status: 'declined', message: 'The hunter said no to sharing this country less than a week ago' });
  // A newer version replaces the question that is still open; a returned proposal is answered under the same id.
  const open = mine.find((x) => x.country === country && x.status === 'asked'), back = mine.find((x) => x.country === country && x.status === 'returned');
  const id = open?.id ?? back?.id ?? rid('shr_');
  const rows = ru(user) ? [[{ text: 'Отправить', callback_data: `ps:ok:${id}` }, { text: 'Не надо', callback_data: `ps:no:${id}` }], [{ text: 'Больше не спрашивать', callback_data: `ps:nv:${id}` }]]
    : [[{ text: 'Send', callback_data: `ps:ok:${id}` }, { text: 'No', callback_data: `ps:no:${id}` }], [{ text: 'Never ask', callback_data: `ps:nv:${id}` }]];
  await env.DB.prepare(`INSERT INTO pack_shares (id, user_id, country, title, digest, payload, status, created_at, updated_at) VALUES (?,?,?,?,?,?,'asked',?,?)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title, digest=excluded.digest, payload=excluded.payload, status='asked', comment=NULL, updated_at=excluded.updated_at`)
    .bind(id, user.id, country, title, digest, JSON.stringify(pay), now(), now()).run();
  let asked = true;
  try { await sendText(env, user.tg_user_id, `hunt-${country}.txt`, asText(title, pay), card(user, title, pay, country), rows); } catch (e) { asked = false; console.error('share card', id, String((e as Error)?.message ?? e).slice(0, 200)); }
  if (!asked && !tgDry(env)) { await env.DB.prepare('DELETE FROM pack_shares WHERE id=? AND status=\'asked\'').bind(id).run(); throw new HttpError(502, 'telegram', 'The bot could not show the request to the hunter; nothing was sent'); }
  return json({ id, status: 'asked', summary: shareSummary(pay, country), message: 'The bot shows the hunter what would go. Nothing leaves before they press "Отправить".' }, 201);
}

const done = async (env: Env, q: any, text: string) => {
  await tg(env, 'editMessageCaption', { chat_id: q.message.chat.id, message_id: q.message.message_id, parse_mode: 'HTML', caption: `${esc(q.message.caption ?? '').slice(0, 700)}\n\n<b>${esc(text)}</b>` }).catch(() => null);
};

/** ps:* the hunter's answer; pr:* the registry admin's. Returns the toast, or null when the button is not for this person. */
export async function sharesCallback(env: Env, user: any, q: any, kind: string, a: string, id: string): Promise<string | null> {
  const R = ru(user);
  if (kind === 'ps') {
    const s = await env.DB.prepare('SELECT * FROM pack_shares WHERE id=? AND user_id=?').bind(id, user.id).first<any>();
    if (!s) return null;
    if (s.status !== 'asked') return R ? 'Уже решено' : 'Already decided';
    const set = (status: string, remote: string | null = null) => env.DB.prepare("UPDATE pack_shares SET status=?, remote_id=COALESCE(?, remote_id), payload=NULL, updated_at=? WHERE id=? AND status='asked'").bind(status, remote, now(), id).run();
    if (a === 'no' || a === 'nv') {
      await set(a === 'no' ? 'declined' : 'off');
      await done(env, q, a === 'no' ? (R ? 'Не отправлено' : 'Not sent') : (R ? 'Не отправлено, больше не спрошу' : 'Not sent, I will not ask again'));
      return R ? 'Хорошо' : 'OK';
    }
    if (a !== 'ok') return null;
    const call = registry(env), p = parseJson<Payload | null>(s.payload, null);
    if (!call || !p) return R ? 'Каталог не подключён' : 'No catalogue';
    const r = await call('/v1/proposals', { method: 'POST', body: JSON.stringify({ ref: s.id, country: s.country, title: s.title, note: p.note, author: p.author, base: p.base, files: p.files, sources: p.sources }) });
    if (!r.ok) {
      const why = line(r.data?.message ?? r.data?.error ?? '', 150);
      if (r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 429) { await env.DB.prepare("UPDATE pack_shares SET status='returned', comment=?, payload=NULL, updated_at=? WHERE id=?").bind(why, now(), id).run(); await done(env, q, (R ? 'Каталог не принял: ' : 'Refused: ') + why); }
      return R ? 'Не отправилось, попробуй позже' : 'Could not send, try later';
    }
    await set(['approved', 'merged', 'rejected'].includes(r.data?.status) ? r.data.status : 'sent', String(r.data?.id ?? ''));
    await done(env, q, R ? 'Отправлено на проверку' : 'Sent for review');
    return R ? 'Отправлено' : 'Sent';
  }
  if (kind === 'pr') {
    if (!(await isAdmin(env, user.id))) return null;
    if (a === 'ok') return decide(env, q, user, id, 'approved');
    if (a === 'bk' || a === 'no') {
      await env.DB.prepare('INSERT OR REPLACE INTO bot_state (tg_user_id, state, at) VALUES (?,?,?)').bind(q.from.id, JSON.stringify({ kind: 'proposal', id, status: a === 'bk' ? 'returned' : 'rejected' }), now()).run();
      await tg(env, 'sendMessage', { chat_id: q.message.chat.id, text: a === 'bk' ? (R ? 'Что поправить? Автор увидит этот текст.' : 'What to fix? The author will see it.') : (R ? 'Почему нет? Автор увидит этот текст.' : 'Why not? The author will see it.'), reply_markup: { force_reply: true } }).catch(() => null);
      return R ? 'Напиши ответ' : 'Write the answer';
    }
  }
  return null;
}
const isAdmin = async (env: Env, uid: string) => !!(await env.DB.prepare('SELECT 1 FROM hunters WHERE user_id=? AND is_admin=1').bind(uid).first());
async function decide(env: Env, q: any, user: any, id: string, status: string, comment?: string): Promise<string> {
  const call = registry(env, true), R = ru(user);
  if (!call) return R ? 'Нет ключа каталога' : 'No admin key';
  const seen = await env.DB.prepare('SELECT seen FROM share_reviews WHERE id=?').bind(id).first<any>();
  const r = await call('/admin/proposals/decide', { method: 'POST', body: JSON.stringify({ id, status, comment, seen: seen?.seen }) });
  if (!r.ok) return r.data?.error === 'changed' ? (R ? 'Автор прислал новую версию, жди новую карточку' : 'A new version came') : r.status === 409 ? (R ? `Уже решено: ${r.data?.message ?? ''}` : 'Already decided') : (R ? 'Не получилось, попробуй позже' : 'Failed');
  const txt = status === 'approved' ? (R ? 'Принято. Группы уже у всех, файлы попадут в hunt-data при слиянии.' : 'Approved') : status === 'returned' ? (R ? 'Вернул автору' : 'Returned') : (R ? 'Отклонено' : 'Rejected');
  if (q) await done(env, q, txt);
  return txt.slice(0, 190);
}
/** The admin's typed comment for "return" / "no". True = the message was one. */
export async function proposalComment(env: Env, user: any, chat: number, st: any, text: string): Promise<boolean> {
  if (st.kind !== 'proposal') return false;
  await env.DB.prepare('DELETE FROM bot_state WHERE tg_user_id=?').bind(chat).run();
  if (!(await isAdmin(env, user.id))) return true;
  await tg(env, 'sendMessage', { chat_id: chat, text: await decide(env, null, user, st.id, st.status, text) }).catch(() => null);
  return true;
}

/** Cron: answers for the authors, new proposals for the registry admin. */
export async function sharesCron(env: Env): Promise<void> {
  const call = registry(env);
  if (call) {
    const rows = (await env.DB.prepare("SELECT s.id, s.title, s.status, s.comment, u.tg_user_id, u.lang FROM pack_shares s JOIN users u ON u.id=s.user_id WHERE s.status IN ('sent','approved') ORDER BY s.updated_at LIMIT 20").all<any>()).results ?? [];
    if (rows.length) {
      const r = await call(`/v1/proposals?refs=${rows.map((x) => x.id).join(',')}`);
      for (const x of r.ok ? r.data?.proposals ?? [] : []) {
        const s = rows.find((y) => y.id === x.ref), status = x.status === 'pending' ? 'sent' : x.status;
        if (!s || status === s.status) continue;
        const comment = x.comment ? line(x.comment, 600) : null;
        await env.DB.prepare('UPDATE pack_shares SET status=?, comment=?, updated_at=? WHERE id=?').bind(status, comment, now(), s.id).run();
        const R = s.lang !== 'en', T = `<b>${esc(s.title)}</b>\n`;
        const text = status === 'approved' ? T + (R ? 'Приняли в общий каталог. Спасибо, теперь это поможет другим.' : 'Accepted into the shared catalogue. Thank you.')
          : status === 'returned' ? T + (R ? 'Вернули на доработку: ' : 'Returned: ') + esc(comment ?? '') + (R ? '\n\nСкажи своему Ханту поправить, он снова спросит.' : '')
          : status === 'rejected' ? T + (R ? 'Не взяли: ' : 'Not taken: ') + esc(comment ?? '') : null;
        if (text && s.tg_user_id) await tg(env, 'sendMessage', { chat_id: s.tg_user_id, text, parse_mode: 'HTML' }).catch(() => null);
      }
    }
  }
  const stale = new Date(Date.now() - CARD_DAYS * 86400e3).toISOString();
  await env.DB.prepare("UPDATE pack_shares SET status='declined', payload=NULL, updated_at=? WHERE status='asked' AND updated_at<?").bind(now(), stale).run();
  const adm = registry(env, true);
  if (!adm) return;
  const r = await adm('/admin/proposals?status=pending');
  const list: any[] = r.ok ? r.data?.proposals ?? [] : [];
  if (!list.length) return;
  const known = new Map(((await env.DB.prepare('SELECT id, seen FROM share_reviews').all<any>()).results ?? []).map((x) => [x.id, x.seen]));
  const admins = (await env.DB.prepare('SELECT u.tg_user_id, u.lang FROM hunters h JOIN users u ON u.id=h.user_id WHERE h.is_admin=1 AND u.tg_user_id IS NOT NULL').all<any>()).results ?? [];
  let n = 0;
  for (const x of list) {
    if (known.get(x.id) === x.updated_at || n >= 3) continue;
    n++;
    const full = await adm(`/admin/proposals/${x.id}`);
    if (!full.ok) continue;
    const p: Payload = { note: full.data.note, author: full.data.author, base: full.data.base, files: full.data.files ?? [], sources: full.data.sources ?? [] };
    const s = shareSummary(p, x.country), fl: any[] = full.data.flags ?? [];
    const kinds = [...new Set(fl.map((f) => f.what))];
    const head = `<b>Заявка: ${esc(x.title.slice(0, 100))}</b>\nот: ${esc(x.author ?? 'без имени')}, сервер ${esc(String(x.server).slice(0, 40))}\n${esc([s.cities.join(', '), `районы ${s.districts}`, `места ${s.places}`, `звери ${s.animals}`, `группы и сайты ${s.sources}`, `файлов ${s.files}`].filter(Boolean).join(' · ')).slice(0, 300)}\n${esc(p.note.slice(0, 200))}\n\n${fl.length ? `Проверка заметила (${fl.length}): ${esc(kinds.join(', ')).slice(0, 200)}` : 'Проверка ничего не заметила'}`;
    const text = (fl.length ? ['===== что заметила проверка =====', ...fl.map((f) => `${f.path}:${f.line} ${f.what}: ${f.text}`), ''] : []).join('\n') + asText(x.title, p);
    let sent = 0;
    for (const a of admins) { try { await sendText(env, a.tg_user_id, `proposal-${x.country}.txt`, text, head, [[{ text: 'Принять', callback_data: `pr:ok:${x.id}` }, { text: 'Вернуть', callback_data: `pr:bk:${x.id}` }, { text: 'Нет', callback_data: `pr:no:${x.id}` }]]); sent++; } catch (e) { console.error('proposal card', x.id, String((e as Error)?.message ?? e).slice(0, 200)); } }
    if (sent) await env.DB.prepare('INSERT INTO share_reviews (id, seen, at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET seen=excluded.seen, at=excluded.at').bind(x.id, x.updated_at, now()).run();
  }
}
