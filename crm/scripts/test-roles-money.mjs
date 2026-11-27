#!/usr/bin/env node
// Roles see what DESIGN.md says (no budget cap in the app for anyone, the said budget and the negotiation numbers for the
// owner only, a viewer cannot spend), shared money (equal split, transfers, settlements, who may delete) and the cron
// (a viewing reminder goes out once, to the members, through a fake Telegram).
// Starts its own local server (wrangler dev, or the Node build with HUNT_TEST_SERVER=node).   node scripts/test-roles-money.mjs
import { createHash } from 'node:crypto';
import { fakeTelegram, localServer } from './local-server.mjs';

const TG = await fakeTelegram();
const srv = await localServer({ name: 'roles', port: 8790, inspector: 9790, vars: { TG_BOT_TOKEN: '123:test', TG_API: TG.url } });
const { BASE, exec, rows } = srv;
let pass = 0, fail = 0;
const ok = (c, name, x = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${name} ${JSON.stringify(x)?.slice(0, 400)}`); } };
const H = (t) => createHash('sha256').update(t).digest('hex'), T0 = '2026-01-01T00:00:00Z';
const soon = new Date(Date.now() + 60 * 60e3).toISOString(); // a viewing in an hour: the reminder window is 45–75 min
const brief = JSON.stringify({ currency: 'IDR', timezone: 'Asia/Makassar', budget_cap: 30000000, budget_said: 25000000, budget_max: 28000000, bedrooms: ['2'] });

exec([
  ...[['ann', 201, 'owner'], ['bob', 202, 'member'], ['eve', 203, 'viewer']].flatMap(([n, tg]) => [
    `INSERT INTO users (id, tg_user_id, display_name, lang, created_at) VALUES ('u_${n}', ${tg}, '${n}', 'ru', '${T0}')`,
    `INSERT INTO web_sessions (hash, id, user_id, device, created_at, last_at, expires_at) VALUES ('${H(`c-${n}`)}', 'ws_${n}', 'u_${n}', 'Chrome', '${T0}', '2099-01-01T00:00:00Z', '2099-01-02T00:00:00Z')`,
  ]),
  `INSERT INTO hunters (user_id, is_admin, created_at) VALUES ('u_ann', 0, '${T0}')`,
  `INSERT INTO searches (id, owner_id, title, region, brief, created_at, updated_at) VALUES ('s_a', 'u_ann', 'Bukit', 'bali/bukit', '${brief}', '${T0}', '${T0}')`,
  `INSERT INTO members (search_id, user_id, role) VALUES ('s_a', 'u_ann', 'owner'), ('s_a', 'u_bob', 'member'), ('s_a', 'u_eve', 'viewer')`,
  `INSERT INTO listings (id, search_id, title, status, fields, photos, created_at, updated_at) VALUES ('l_1', 's_a', 'Villa Lima', 'new', '{}', '[]', '${T0}', '${T0}')`,
  `INSERT INTO deals (listing_id, search_id, data, updated_at, asked, agreed) VALUES ('l_1', 's_a', '{}', '${T0}', 30000000, 27000000)`,
  `INSERT INTO viewings (id, search_id, listing_id, starts_at, status, created_at, updated_at) VALUES ('v_1', 's_a', 'l_1', '${soon}', 'confirmed', '${T0}', '${T0}')`,
].join(';'));

const A = 'hunt_s=c-ann', B = 'hunt_s=c-bob', E = 'hunt_s=c-eve';
const post = async (path, b, cookie) => { const r = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, cookie }, body: JSON.stringify(b) }); return { status: r.status, j: await r.json().catch(() => null) }; };
const get = async (path, cookie) => { const r = await fetch(BASE + path, { headers: { cookie } }); return { status: r.status, j: await r.json().catch(() => null) }; };
const state = async (cookie) => (await get('/app/api/state?s=s_a', cookie)).j;
const more = async (cookie) => (await get('/app/api/state-more?s=s_a', cookie)).j;

try {
  await srv.start();

  // ---- roles: what each one sees
  const sa = await state(A), sb = await state(B), se = await state(E);
  ok(sa?.me?.role === 'owner' && sb?.me?.role === 'member' && se?.me?.role === 'viewer', 'three roles', [sa?.me, sb?.me, se?.me]);
  for (const [who, s] of [['owner', sa], ['member', sb], ['viewer', se]]) ok(!JSON.stringify(s).includes('budget_cap'), `the budget cap never reaches the app (${who})`);
  ok(sa.search.brief.budget_said === 25000000, 'the owner sees the budget said', sa.search.brief);
  ok(!('budget_said' in sb.search.brief) && !('budget_said' in se.search.brief), 'members do not see the budget said', sb.search.brief);
  ok(sa.deal?.asked === 30000000 && sa.deal?.agreed === 27000000, 'the owner sees the negotiation numbers', sa.deal);
  ok(sb.deal && !('asked' in sb.deal) && !('agreed' in sb.deal), 'a member does not', sb.deal);
  ok(sb.search.brief.budget_max === 28000000, 'the public brief stays visible to members', sb.search.brief);

  // ---- money: equal split between the two who vote, transfers, settling, deleting
  ok((await post('/app/api/expense', { search_id: 's_a', title: 'Gas', amount: 300000, currency: 'IDR', kind: 'other', date: '2026-01-05' }, E)).status === 403, 'a viewer cannot add an expense');
  const ex = await post('/app/api/expense', { search_id: 's_a', title: 'Water', amount: 300000, currency: 'IDR', kind: 'water', date: '2026-01-05' }, A);
  ok(ex.status === 200 && ex.j?.expense?.id, 'the owner adds an expense', ex);
  let m = (await more(B)).money;
  ok(m?.totals?.total === 300000, 'the total', m?.totals);
  const tr = m?.balances?.IDR?.transfers ?? [];
  ok(tr.length === 1 && tr[0].from === 'u_bob' && tr[0].to === 'u_ann' && tr[0].amount === 150000, 'bob owes ann half', tr);
  ok(!('u_eve' in (m?.balances?.IDR?.net ?? {})), 'the viewer is outside the split', m?.balances);
  ok((await post('/app/api/expense-delete', { id: ex.j.expense.id }, B)).status === 403, 'bob cannot delete what ann paid');
  ok((await post('/app/api/settle', { search_id: 's_a', from: 'u_ann', to: 'u_eve', amount: 1, currency: 'IDR' }, B)).status === 403, 'only the two people involved mark a settlement');
  const st = await post('/app/api/settle', { search_id: 's_a', from: 'u_bob', to: 'u_ann', amount: 150000, currency: 'IDR' }, B);
  ok(st.status === 200 && (st.j?.money?.balances?.IDR?.transfers ?? []).length === 0, 'settled: nobody owes anybody', st.j?.money?.balances);
  ok((await post('/app/api/expense-delete', { id: ex.j.expense.id }, A)).status === 200, 'ann deletes her expense');
  m = (await more(A)).money;
  ok(m?.totals?.total === 0 && (m?.balances?.IDR?.transfers ?? []).length === 1, 'without the expense the settlement is a debt the other way', m?.balances);

  // ---- cron: the viewing reminder goes out once, to the members, through Telegram
  TG.clear();
  await srv.cron();
  const toAnn = TG.to(201), toBob = TG.to(202);
  ok(toAnn.some((c) => String(c.params.text).includes('Villa Lima')) && toBob.some((c) => String(c.params.text).includes('Villa Lima')), 'ann and bob get the reminder', TG.calls.map((c) => [c.method, c.params.chat_id]));
  ok(rows("SELECT reminded_at FROM viewings WHERE id='v_1'")[0]?.reminded_at, 'the viewing is marked reminded');
  const reminders = () => TG.calls.filter((c) => String(c.params.text ?? '').includes('Villa Lima')).length;
  const sent = reminders();
  await srv.cron();
  ok(reminders() === sent, 'a second tick does not send it again', reminders());
} catch (e) { fail++; console.log('ERROR', e.stack?.slice(0, 600), srv.log().slice(-1200)); } finally { await srv.cleanup(); await TG.stop(); }
console.log(`roles and money: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
