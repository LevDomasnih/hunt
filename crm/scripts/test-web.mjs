#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { localServer } from './local-server.mjs';

const srv = await localServer({ name: 'web', port: 8798, inspector: 9798 });
const { BASE, exec, rows } = srv;
const log = { slice: (...a) => srv.log().slice(...a) };
let pass = 0, fail = 0;
const ok = (c, name, x = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${name} ${JSON.stringify(x)?.slice(0, 300)}`); } };
const H = (t) => createHash('sha256').update(t).digest('hex'), T0 = '2026-01-01T00:00:00Z';
exec([['ann', 201], ['bob', 202], ['eve', 203]].flatMap(([n, tg]) => [`INSERT INTO users (id, tg_user_id, display_name, lang, created_at) VALUES ('u_${n}', ${tg}, '${n}', 'ru', '${T0}')`, `INSERT INTO hunters (user_id, is_admin, created_at) VALUES ('u_${n}', 0, '${T0}')`, `INSERT INTO tokens (hash, user_id, label, created_at) VALUES ('${H(`tok-${n}`)}', 'u_${n}', 't', '${T0}')`]).join(';'));
try {
  await srv.start();
  const post = async (path, b, h = {}) => { const r = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/140 Safari/537', ...h }, body: JSON.stringify(b ?? {}) }); return { status: r.status, j: await r.json().catch(() => null), cookie: r.headers.get('set-cookie') }; };
  const get = async (path, cookie) => { const r = await fetch(BASE + path, { headers: cookie ? { cookie } : {} }); return { status: r.status, j: await r.json().catch(() => null) }; };
  const hook = (u) => fetch(`${BASE}/tg/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'hook' }, body: JSON.stringify(u) });
  const say = (id, text) => hook({ message: { from: { id, first_name: 'x', language_code: 'ru' }, chat: { id, type: 'private' }, message_id: 1, text } });
  const press = (id, data) => hook({ callback_query: { id: '1', from: { id, first_name: 'x', language_code: 'ru' }, data, message: { chat: { id }, message_id: 2 } } });
  const jar = (c) => c?.split(';')[0];
  const begin = async () => (await post('/app/api/web-login')).j;

  // ---- number match
  let l = await begin();
  ok(/^wl_/.test(l.id) && l.number >= 10 && l.url === `https://t.me/test_bot?start=${l.id}`, 'a sign-in begins', l);
  const check = (x = l) => post('/app/api/web-login-check', { id: x.id, secret: x.secret });
  ok((await check()).j.status === 'waiting' && (await post('/app/api/web-login-check', { id: l.id, secret: 'x' })).status === 404, 'nobody else can poll it');
  ok(!JSON.stringify(rows('SELECT secret_hash FROM web_logins')).includes(l.secret), 'the secret is stored as a hash');
  await say(201, `/start ${l.id}`);
  await press(202, `wl:${l.number}:${l.id}`);
  ok((await check()).j.status === 'waiting', "another person's press does nothing");
  await press(201, `wl:${l.number}:${l.id}`);
  const good = await check();
  ok(good.j.ok && /HttpOnly; SameSite=Lax/.test(good.cookie) && (await check()).j.status === 'expired', 'the right number signs in, once', good);
  const C = jar(good.cookie);
  ok((await get('/app/api/state', C)).j.user?.id === 'u_ann' && (await get('/app/api/state')).status === 401 && (await get('/app/api/state', 'hunt_s=nope')).status === 401, 'the cookie works, no other does');
  l = await begin(); await say(203, `/start ${l.id}`); await press(203, `wl:${l.number === 99 ? 98 : l.number + 1}:${l.id}`); await press(203, `wl:${l.number}:${l.id}`);
  ok((await check()).j.status === 'denied', 'a wrong number refuses for good');
  l = await begin(); await say(203, `/start ${l.id}`); await press(203, `wl:no:${l.id}`);
  ok((await check()).j.status === 'denied', 'not me');
  l = await begin(); await say(201, `/start ${l.id}`); await say(203, `/start ${l.id}`); await press(203, `wl:${l.number}:${l.id}`);
  ok((await check()).j.status === 'waiting', 'the first person who opened it keeps it');
  l = await begin(); exec(`UPDATE web_logins SET expires_at='2020-01-01T00:00:00Z' WHERE id='${l.id}'`); await say(201, `/start ${l.id}`);
  ok((await check()).j.status === 'expired', 'too late');

  // ---- cross-site, sessions
  ok((await post('/app/api/lang', { lang: 'ru' }, { cookie: C, origin: 'https://evil.example' })).status === 403, 'a write from another site is refused');
  const bare = await fetch(`${BASE}/app/api/lang`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: C }, body: '{"lang":"ru"}' });
  ok(bare.status === 403, 'and without an origin');
  ok((await post('/app/api/lang', { lang: 'ru' }, { cookie: C })).status === 200, 'from the site itself it works');
  await say(201, '/web');
  ok(rows("SELECT kind FROM web_logins WHERE kind='link'").length === 1, '/web makes a link');
  const code = 'K'.repeat(43);
  exec(`UPDATE web_logins SET secret_hash='${H(code)}' WHERE kind='link'`);
  const lid = rows("SELECT id FROM web_logins WHERE kind='link'")[0].id;
  ok((await post('/app/api/web-login-link', { code: `${lid}.${code}`, peek: true })).j.name && (await post('/app/api/web-login-link', { code: `${lid}.${code}x` })).status === 404, 'the page shows who it signs in');
  const via = await post('/app/api/web-login-link', { code: `${lid}.${code}` });
  ok(via.j.ok && (await post('/app/api/web-login-link', { code: `${lid}.${code}` })).status === 404, 'the link works once');
  const C2 = jar(via.cookie);
  const list = (await get('/app/api/web-sessions', C)).j.sessions;
  ok(list.length === 2 && list.filter((x) => x.current).length === 1 && /Chrome, macOS/.test(list[0].device) && !('hash' in list[0]), 'the list of sessions', list);
  ok((await post('/app/api/web-sessions', { end: list.find((x) => !x.current).id }, { cookie: C })).j.ok && (await get('/app/api/state', C2)).status === 401 && (await get('/app/api/state', C)).status === 200, 'one can be ended');
  l = await begin(); await say(202, `/start ${l.id}`); await press(202, `wl:${l.number}:${l.id}`);
  const CB = jar((await check()).cookie);
  ok((await post('/app/api/web-sessions', { end: list[0].id }, { cookie: CB })).status === 200 && (await get('/app/api/state', C)).status === 200, "never somebody else's");

  // ---- the chat in two languages
  const api = async (m, path, b, who = 'ann') => { const r = await fetch(BASE + path, { method: m, headers: { authorization: `Bearer tok-${who}`, 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return r.json(); };
  const S = (await api('POST', '/api/searches', { title: 'A', region: 'bali/bukit', brief: { currency: 'IDR' } })).search.id;
  const con = (await api('PUT', '/api/contacts/new', { name: 'Wayan', role: 'owner', lang: 'id', channels: [{ channel: 'whatsapp', address: '+6281200000033' }] })).contact.id;
  await api('PUT', '/api/threads', { search_id: S, contact_id: con, state: 'waiting_us', last: 'x' });
  const msg = { channel: 'whatsapp', direction: 'in', text: 'Kosong, kak', at: new Date(Date.now() - 2 * 3600e3).toISOString(), external_id: 'e1', search_id: S, contact_id: con };
  await api('POST', '/api/messages', [msg]); await api('POST', '/api/messages', [{ ...msg, tr: 'Свободен. паспорт 4509 123456' }]);
  await api('POST', '/api/messages', [{ ...msg, external_id: 'e2', direction: 'out', text: 'hello', tr: 'hello' }]);
  const dr = (await api('POST', '/api/drafts', { search_id: S, contact_id: con, channel: 'whatsapp', address: '+6281200000033', text: 'Deal 22 juta', tr: 'По рукам, 22' })).draft;
  let th = (await get(`/app/api/thread?s=${S}&c=${con}`, C)).j;
  ok(th.messages?.length === 2 && th.messages[0].tr?.startsWith('Свободен') && !th.messages[0].tr.includes('4509') && th.messages[1].tr === null && th.drafts[0].tr === 'По рукам, 22' && th.channels[0].address, 'messages and the draft with translations', th);
  ok((await get(`/app/api/thread?s=${S}&c=${con}`, CB)).status === 403, 'not for others');
  exec(`INSERT INTO members (search_id, user_id, role) VALUES ('${S}','u_bob','member')`);
  th = (await get(`/app/api/thread?s=${S}&c=${con}`, CB)).j;
  ok(th.messages?.length === 2 && th.drafts.length === 0 && !('address' in th.channels[0]), 'a member reads, without drafts and numbers', th);
  ok((await get(`/app/api/thread?s=${S}&c=c_none`, C)).status === 404, 'only contacts of this search');
  ok((await post('/app/api/say', { search_id: S, contact_id: con, text: 'привет', as_is: true }, { cookie: CB })).status === 403, 'a member does not write to the owner');
  ok((await post('/app/api/say', { search_id: S, contact_id: con, text: 'паспорт 4509 123456', as_is: true }, { cookie: C })).j?.error === 'sensitive', 'no passport numbers');
  const own = await post('/app/api/say', { search_id: S, contact_id: con, text: 'halo', as_is: true }, { cookie: C });
  ok(own.j.status === 'approved' && rows(`SELECT channel, status, text FROM drafts WHERE id='${own.j.draft_id}'`)[0].channel === 'whatsapp', 'the owner writes as is', own);
  ok((await post('/app/api/say', { search_id: S, contact_id: con, text: 'переведи' }, { cookie: C })).j.status === 'translating' && rows(`SELECT data FROM events WHERE search_id='${S}' AND kind='instruction'`)[0].data.includes('"say"'), 'or asks to translate');
  // A new project from the app (newproject.js): invited hunters only; the brief through the whitelist; a wish reaches the agent.
  ok((await get('/app/api/state', C)).j.user?.can_create === true, 'a hunter may start projects');
  const np = await post('/app/api/searches', { region: 'bali/canggu', title: 'Чангу', mode: 'search', wish: 'рядом с пляжем', brief: { districts: ['canggu_center'], bedrooms: ['2'], budget_cap: 25000000, currency: 'IDR', timezone: 'Asia/Makassar', evil: 'x' } }, { cookie: C });
  const npRow = np.j?.id && rows(`SELECT owner_id, region, status, brief FROM searches WHERE id='${np.j.id}'`)[0];
  ok(np.status === 201 && npRow?.owner_id === 'u_ann' && npRow.region === 'bali/canggu' && JSON.parse(npRow.brief).budget_cap === 25000000 && !('evil' in JSON.parse(npRow.brief)) && /start=/.test(np.j.invite_link ?? ''), 'a project from the app', np.j);
  ok(rows(`SELECT role FROM members WHERE search_id='${np.j?.id}' AND user_id='u_ann'`)[0]?.role === 'owner' && rows(`SELECT data FROM events WHERE search_id='${np.j?.id}' AND kind='instruction'`)[0]?.data.includes('рядом с пляжем'), 'the owner, and the wish for the agent');
  ok((await post('/app/api/searches', { region: 'rs/belgrade', title: 'Белград', mode: 'living' }, { cookie: C })).status === 201 && rows("SELECT status FROM searches WHERE title='Белград'")[0]?.status === 'living', 'already living');
  ok((await post('/app/api/searches', { region: 'bali/canggu', title: 'x', wish: 'паспорт 4509 123456' }, { cookie: C })).j?.error === 'sensitive' && (await post('/app/api/searches', { region: 'Bali', title: 'x' }, { cookie: C })).status === 400, 'no passports, a real region');
  exec("DELETE FROM hunters WHERE user_id='u_bob'");
  ok((await post('/app/api/searches', { region: 'bali/canggu', title: 'x' }, { cookie: CB })).status === 403 && (await get('/app/api/state', CB)).j.user?.can_create === false, 'a member who is not a hunter cannot');
  await post('/app/api/draft', { draft_id: dr.id, action: 'send' }, { cookie: C });
  ok(rows(`SELECT status FROM drafts WHERE id='${dr.id}'`)[0].status === 'approved', 'approving with the cookie');
  const desk = (await get(`/app/api/desk?s=${S}`, C)).j;
  ok(Array.isArray(desk.log) && desk.log.some((x) => x.kind === 'sent' && x.data.name === 'Wayan') && desk.agent_seen_at, 'what Hunt did', desk);
  ok((await get(`/app/api/desk?s=${S}`, jar('hunt_s=x'))).status === 401, 'closed without a session');

  await say(201, '/logout');
  ok((await get('/app/api/state', C)).status === 401, '/logout ends the sessions');
} catch (e) { fail++; console.log('ERROR', e.stack?.slice(0, 600), log.slice(-1200)); } finally { await srv.cleanup(); }
console.log(`web: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
