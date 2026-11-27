#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { localServer } from './local-server.mjs';

const srv = await localServer({ name: 'agent', port: 8792, inspector: 9792 });
const { BASE, exec, rows } = srv;
const log = { slice: (...a) => srv.log().slice(...a) };
let pass = 0, fail = 0;
const ok = (c, name, x = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${name} ${JSON.stringify(x)?.slice(0, 300)}`); } };
const H = (t) => createHash('sha256').update(t).digest('hex'), T0 = '2026-01-01T00:00:00Z';
exec([
  ...[['ann', 201], ['bob', 202], ['eve', 203]].flatMap(([n, tg]) => [
    `INSERT INTO users (id, tg_user_id, display_name, lang, created_at) VALUES ('u_${n}', ${tg}, '${n}', 'ru', '${T0}')`,
    `INSERT INTO hunters (user_id, is_admin, created_at) VALUES ('u_${n}', 0, '${T0}')`,
    `INSERT INTO tokens (hash, user_id, label, created_at) VALUES ('${H(`tok-${n}`)}', 'u_${n}', 'telegram', '${T0}')`,
    `INSERT INTO web_sessions (hash, id, user_id, device, created_at, last_at, expires_at) VALUES ('${H(`c-${n}`)}', 'ws_${n}', 'u_${n}', 'Chrome', '${T0}', '2099-01-01T00:00:00Z', '2099-01-02T00:00:00Z')`,
  ]),
  `INSERT INTO tokens (hash, user_id, label, created_at) VALUES ('${H('tok-ann-2')}', 'u_ann', 'telegram', '${T0}')`,
  `INSERT INTO searches (id, owner_id, title, region, brief, created_at, updated_at) VALUES ('s_a', 'u_ann', 'Bukit', 'bali/bukit', '{}', '${T0}', '${T0}')`,
  `INSERT INTO members (search_id, user_id, role) VALUES ('s_a', 'u_ann', 'owner'), ('s_a', 'u_bob', 'member')`,
].join(';'));
try {
  await srv.start();
  const A = 'hunt_s=c-ann', B = 'hunt_s=c-bob', E = 'hunt_s=c-eve';
  const post = async (path, b, cookie) => { const r = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(b ?? {}) }); return { status: r.status, j: await r.json().catch(() => null), cache: r.headers.get('cache-control') }; };
  const get = async (path, cookie) => { const r = await fetch(BASE + path, { headers: cookie ? { cookie } : {} }); return { status: r.status, j: await r.json().catch(() => null) }; };
  const agent = async (path, tok, client) => { const r = await fetch(BASE + path, { headers: { authorization: `Bearer ${tok}`, ...(client ? { 'x-hunt-client': client } : {}) } }); return { status: r.status, j: await r.json().catch(() => null) }; };
  const issue = (cookie = A) => post('/app/api/agent-token', { search_id: 's_a' }, cookie);

  // ---- who may
  ok((await issue(null)).status === 401, 'closed without a session');
  ok((await issue(B)).status === 403, 'a member cannot issue the owner token');
  ok([403, 404].includes((await issue(E)).status), 'a stranger cannot');
  ok(rows("SELECT COUNT(*) n FROM tokens WHERE revoked_at IS NOT NULL")[0].n === 0, 'refusals revoke nothing');

  // ---- issue: the earlier agent tokens die, nothing else does
  const gen0 = rows("SELECT link_gen FROM users WHERE id='u_ann'")[0].link_gen;
  const r = await issue();
  const tok = r.j?.token ?? '';
  ok(r.status === 200 && /^hunt_[A-Za-z0-9_-]{30,}$/.test(tok) && r.j.api_url === BASE && r.j.revoked === 2 && r.cache === 'no-store', 'a new token, the address, two revoked', { ...r.j, token: tok ? 'hunt_…' : null });
  const mine = rows("SELECT hash, label, revoked_at FROM tokens WHERE user_id='u_ann' ORDER BY created_at");
  ok(mine.length === 3 && mine.filter((x) => x.revoked_at).length === 2 && mine.find((x) => !x.revoked_at)?.hash === H(tok) && mine.find((x) => !x.revoked_at)?.label === 'app', 'stored as its sha256 only', mine.map((x) => ({ ...x, hash: x.hash.slice(0, 8) })));
  const dump = ['tokens', 'events', 'users', 'web_sessions'].map((t) => JSON.stringify(rows(`SELECT * FROM ${t}`))).join('\n');
  ok(tok && !dump.includes(tok), 'the token itself is nowhere in the database');
  ok((await agent('/api/me', 'tok-ann')).status === 401 && (await agent('/api/me', 'tok-ann-2')).status === 401, 'the old agent tokens stop working at once');
  ok((await agent('/api/me', tok)).status === 200, 'the new one works');
  ok((await agent('/api/me', 'tok-bob')).status === 200, "other people's tokens stay");
  ok((await get('/app/api/state?s=s_a', A)).status === 200 && rows("SELECT link_gen FROM users WHERE id='u_ann'")[0].link_gen === gen0
    && rows("SELECT COUNT(*) n FROM web_sessions WHERE user_id='u_ann'")[0].n === 1, 'web links and site sessions stay (unlike /revoke)');
  const ev = rows("SELECT search_id, actor, data FROM events WHERE kind='agent_token'");
  ok(ev.length === 1 && ev[0].search_id === 's_a' && ev[0].actor === 'u_ann' && JSON.parse(ev[0].data).revoked === 2, 'logged like other access changes', ev);
  ok(!(await get('/app/api/state?s=s_a', A)).j.feed.some((x) => x.kind === 'agent_token'), 'not in the feed');

  // ---- which client
  await agent('/api/searches', tok, 'codex');
  const st = (await get('/app/api/state?s=s_a', A)).j;
  ok(st.agent_client === 'codex' && st.agent_last_seen, 'X-Hunt-Client is stored with the last seen time', { c: st.agent_client, s: st.agent_last_seen });
  ok((await get('/app/api/state?s=s_a', B)).j.agent_client === 'codex', 'a member sees which agent too');
  await agent('/api/searches', tok, 'claude-code');
  ok(rows("SELECT agent_client FROM searches WHERE id='s_a'")[0].agent_client === 'claude-code', 'a new client is stored at once (not throttled)');
  await agent('/api/searches', tok);
  await agent('/api/searches', tok, 'evil<script>');
  ok(rows("SELECT agent_client FROM searches WHERE id='s_a'")[0].agent_client === 'claude-code', 'a missing or unknown header keeps it');

  // ---- rate limit (6 an hour)
  let last = 0;
  for (let i = 0; i < 6; i++) last = (await issue()).status;
  ok(last === 429, 'the seventh in an hour is refused', last);
  ok((await agent('/api/me', tok)).status === 401, 'each new one revoked the previous');
} catch (e) { fail++; console.log('ERROR', e.stack?.slice(0, 600), log.slice(-1200)); } finally { await srv.cleanup(); }
console.log(`agent token: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
