// The site in a normal browser: sign-in through the bot and cookie sessions.
// "Войти через Telegram": the page shows a number, the bot offers three, the person taps the one they see (so a link somebody
// else sent cannot sign that somebody in). "Ссылка из бота": /web gives a one-time link; its code is in the # part, so link
// previews never use it up. The cookie is HttpOnly and SameSite=Lax; writes with it must come from this origin.
import { Env, HttpError, json, body, now, rid, sha256hex, safeEqual, esc } from './util';
import { rateLimit } from './media';
import { tg, kb } from './tg';

const LOGIN_MIN = 5, SESSION_DAYS = 30, COOKIE = 'hunt_s';
const inMin = (m: number) => new Date(Date.now() + m * 60e3).toISOString();
function token(n = 32): string {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]!);
}
function device(req: Request): string {
  const ua = req.headers.get('user-agent') ?? '';
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '?';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '?';
  const c = (req.headers.get('cf-ipcountry') ?? '').replace(/[^A-Z]/g, '').slice(0, 2);
  return [`${b}, ${os}`, c].filter(Boolean).join(' · ');
}
const cookieOf = (req: Request) => (req.headers.get('cookie') ?? '').split(/;\s*/).find((x) => x.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) ?? '';
function setCookie(req: Request, v: string, maxAge: number): string {
  const local = /^(127\.0\.0\.1|localhost|\[::1\])$/.test(new URL(req.url).hostname);
  return `${COOKIE}=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${local ? '' : '; Secure'}`;
}
const withCookie = (req: Request, d: unknown, v: string, maxAge: number) => { const r = json(d); const h = new Headers(r.headers); h.append('set-cookie', setCookie(req, v, maxAge)); h.set('cache-control', 'no-store'); return new Response(r.body, { status: r.status, headers: h }); };

/** The signed-in user id of a cookie request, null without a cookie. A dead cookie and a cross-site write are 401/403. */
export async function webUser(req: Request, env: Env): Promise<string | null> {
  const c = cookieOf(req);
  if (!c) return null;
  if (!['GET', 'HEAD'].includes(req.method)) {
    const o = req.headers.get('origin'), site = req.headers.get('sec-fetch-site');
    if (o ? o !== new URL(req.url).origin : site !== 'same-origin') throw new HttpError(403, 'cross_site', 'Open Hunt itself and try again');
  }
  const s = await env.DB.prepare('SELECT hash, user_id, last_at, expires_at FROM web_sessions WHERE hash=?').bind(await sha256hex(c)).first<any>();
  if (!s || s.expires_at < now()) throw new HttpError(401, 'signed_out', 'Sign in again');
  if (Date.parse(s.last_at) < Date.now() - 3600e3) await env.DB.prepare('UPDATE web_sessions SET last_at=?, expires_at=? WHERE hash=?').bind(now(), inMin(SESSION_DAYS * 1440), s.hash).run();
  return s.user_id;
}
async function open(req: Request, env: Env, uid: string): Promise<Response> {
  const t = token();
  await env.DB.prepare('INSERT INTO web_sessions (hash, id, user_id, device, created_at, last_at, expires_at) VALUES (?,?,?,?,?,?,?)').bind(await sha256hex(t), rid('ws_'), uid, device(req), now(), now(), inMin(SESSION_DAYS * 1440)).run();
  await env.DB.prepare('DELETE FROM web_sessions WHERE user_id=?1 AND hash NOT IN (SELECT hash FROM web_sessions WHERE user_id=?1 ORDER BY last_at DESC LIMIT 20)').bind(uid).run();
  return withCookie(req, { ok: true }, t, SESSION_DAYS * 86400);
}

/** Routes that need no sign-in yet (/app/api/web-login…) and the session list. */
export async function webRoutes(req: Request, env: Env, path: string): Promise<Response | null> {
  if (!path.startsWith('/app/api/web-')) return null;
  const ip = req.headers.get('cf-connecting-ip') ?? 'local';
  if (path === '/app/api/web-login' && req.method === 'POST') {
    await rateLimit(env, 'weblogin', ip, 30);
    const id = rid('wl_').replace(/[^a-z0-9_]/gi, ''), secret = token(), nums = new Set<number>();
    const rnd = () => { const b = new Uint8Array(1); do crypto.getRandomValues(b); while (b[0] >= 180); return 10 + (b[0] % 90); };
    while (nums.size < 3) nums.add(rnd());
    const opts = [...nums], k = new Uint8Array(1);
    crypto.getRandomValues(k);
    const number = opts[k[0] % 3];
    await env.DB.prepare("DELETE FROM web_logins WHERE expires_at < ?").bind(inMin(-60)).run();
    await env.DB.prepare("INSERT INTO web_logins (id, kind, secret_hash, number, options, device, status, expires_at, created_at) VALUES (?,'bot',?,?,?,?,'new',?,?)").bind(id, await sha256hex(secret), number, JSON.stringify(opts), device(req), inMin(LOGIN_MIN), now()).run();
    return json({ id, secret, number, url: env.BOT_USERNAME ? `https://t.me/${env.BOT_USERNAME}?start=${id}` : null, expires_in: LOGIN_MIN * 60 });
  }
  if (path === '/app/api/web-login-check' && req.method === 'POST') {
    const b = await body(req);
    const l = await env.DB.prepare("SELECT * FROM web_logins WHERE id=? AND kind='bot'").bind(String(b.id ?? '')).first<any>();
    if (!l || !safeEqual(l.secret_hash, await sha256hex(String(b.secret ?? '')))) throw new HttpError(404, 'no_login');
    if (l.status === 'denied') return json({ status: 'denied' });
    if (l.expires_at < now() || l.status === 'done') return json({ status: 'expired' });
    if (l.status !== 'approved') return json({ status: 'waiting', asked: l.status === 'asked' });
    const r = await env.DB.prepare("UPDATE web_logins SET status='done' WHERE id=? AND status='approved'").bind(l.id).run();
    return r.meta.changes ? open(req, env, l.user_id) : json({ status: 'expired' });
  }
  if (path === '/app/api/web-login-link' && req.method === 'POST') {
    await rateLimit(env, 'weblink', ip, 30);
    const b = await body(req), [id, code] = String(b.code ?? '').split('.');
    const l = id && code ? await env.DB.prepare("SELECT l.*, u.display_name FROM web_logins l JOIN users u ON u.id=l.user_id WHERE l.id=? AND l.kind='link'").bind(id).first<any>() : null;
    if (!l || !safeEqual(l.secret_hash, await sha256hex(code)) || l.status !== 'new' || l.expires_at < now()) throw new HttpError(404, 'link_used', 'The link is used or too old: send /web to the bot again');
    if (b.peek) return json({ name: l.display_name });
    const r = await env.DB.prepare("UPDATE web_logins SET status='done' WHERE id=? AND status='new'").bind(l.id).run();
    return r.meta.changes ? open(req, env, l.user_id) : json({ status: 'expired' });
  }
  if (path === '/app/api/web-sessions') {
    const uid = await webUser(req, env);
    if (!uid) throw new HttpError(401, 'no_auth');
    const cur = await sha256hex(cookieOf(req));
    if (req.method === 'GET') {
      const r = (await env.DB.prepare('SELECT id, hash, device, created_at, last_at FROM web_sessions WHERE user_id=? AND expires_at>? ORDER BY last_at DESC').bind(uid, now()).all<any>()).results ?? [];
      return json({ sessions: r.map(({ hash, ...x }) => ({ ...x, current: hash === cur })) });
    }
    if (req.method === 'POST') {
      const b = await body(req);
      if (b.end === 'all') { await env.DB.prepare('DELETE FROM web_sessions WHERE user_id=?').bind(uid).run(); return withCookie(req, { ok: true }, '', 0); }
      if (b.end === 'this') { await env.DB.prepare('DELETE FROM web_sessions WHERE hash=?').bind(cur).run(); return withCookie(req, { ok: true }, '', 0); }
      await env.DB.prepare('DELETE FROM web_sessions WHERE user_id=? AND id=?').bind(uid, String(b.end ?? '')).run();
      return json({ ok: true });
    }
  }
  return null;
}

// ---------------------------------------------------------------- the bot
/** /start wl_… : ask which number the person sees. True = it was a sign-in. */
export async function webStart(env: Env, user: any, chat: number, arg: string): Promise<boolean> {
  if (!arg.startsWith('wl_')) return false;
  const ru = user.lang !== 'en';
  const l = await env.DB.prepare("SELECT * FROM web_logins WHERE id=? AND kind='bot'").bind(arg).first<any>();
  if (!l || l.status !== 'new' || l.expires_at < now()) {
    await tg(env, 'sendMessage', { chat_id: chat, text: ru ? 'Этот вход уже не действует. Нажми «Войти» на сайте ещё раз.' : 'This sign-in is over. Press Sign in on the site again.' }).catch(() => null);
    return true;
  }
  const r = await env.DB.prepare("UPDATE web_logins SET status='asked', user_id=? WHERE id=? AND status='new'").bind(user.id, l.id).run();
  if (!r.meta.changes) return true;
  await tg(env, 'sendMessage', {
    chat_id: chat, parse_mode: 'HTML',
    text: ru ? `Вход на сайт Hunt: <b>${esc(l.device)}</b>\n\nКакое число ты видишь на сайте? Если ты ничего не открывал, нажми «Это не я».` : `Sign-in to the Hunt site: <b>${esc(l.device)}</b>\n\nWhich number do you see there? If you opened nothing, press “Not me”.`,
    reply_markup: kb([JSON.parse(l.options).map((n: number) => ({ text: String(n), callback_data: `wl:${n}:${l.id}` })), [{ text: ru ? 'Это не я' : 'Not me', callback_data: `wl:no:${l.id}` }]]),
  }).catch(() => null);
  return true;
}
export async function webCallback(env: Env, user: any, q: any, a: string, id: string): Promise<string | null> {
  const ru = user.lang !== 'en';
  const l = await env.DB.prepare("SELECT * FROM web_logins WHERE id=? AND kind='bot' AND user_id=?").bind(id, user.id).first<any>();
  if (!l) return null;
  if (l.status !== 'asked' || l.expires_at < now()) return ru ? 'Уже не действует' : 'Over';
  const good = a === String(l.number);
  await env.DB.prepare("UPDATE web_logins SET status=? WHERE id=? AND status='asked'").bind(good ? 'approved' : 'denied', id).run();
  const text = good ? (ru ? 'Вошли. Выйти: /logout' : 'Signed in. To sign out: /logout') : a === 'no' ? (ru ? 'Вход отклонён. Если тебе прислали эту ссылку, тебя пытались обмануть.' : 'Refused. If somebody sent you the link, it was a trick.') : (ru ? 'Число не то, вход отклонён' : 'Wrong number, refused');
  await tg(env, 'editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text }).catch(() => null);
  return good ? (ru ? 'Готово' : 'Done') : (ru ? 'Отклонено' : 'Refused');
}
/** /web: a one-time link. /logout: end every browser session. */
export async function webCommand(env: Env, user: any, chat: number, command: string): Promise<boolean> {
  const ru = user.lang !== 'en';
  if (command === '/logout') {
    await env.DB.prepare('DELETE FROM web_sessions WHERE user_id=?').bind(user.id).run();
    await tg(env, 'sendMessage', { chat_id: chat, text: ru ? 'Вышел на всех компьютерах.' : 'Signed out everywhere.' }).catch(() => null);
    return true;
  }
  if (command !== '/web') return false;
  await rateLimit(env, 'webcmd', user.id, 10);
  const id = rid('wk_').replace(/[^a-z0-9_]/gi, ''), code = token();
  await env.DB.prepare("INSERT INTO web_logins (id, kind, secret_hash, status, user_id, expires_at, created_at) VALUES (?,'link',?,'new',?,?,?)").bind(id, await sha256hex(code), user.id, inMin(LOGIN_MIN), now()).run();
  await tg(env, 'sendMessage', { chat_id: chat, link_preview_options: { is_disabled: true }, protect_content: true, text: ru ? `Вход на сайт, ссылка на один раз и на ${LOGIN_MIN} минут. Никому её не пересылай.` : `Sign in on the site. One use, ${LOGIN_MIN} minutes. Don't forward it.`, reply_markup: kb([[{ text: ru ? 'Открыть сайт' : 'Open the site', url: `${env.PUBLIC_URL}/app#login=${id}.${code}` }]]) }).catch(() => null);
  return true;
}
