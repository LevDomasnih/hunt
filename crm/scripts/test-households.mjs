#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { localServer } from './local-server.mjs';

const srv = await localServer({ name: 'hh', port: 8796, inspector: 9796, vars: { SETUP_KEY: 'setup', LINK_SECRET: 'link-secret' } });
const { BASE, exec, rows, kvKeys } = srv;
const log = { slice: (...a) => srv.log().slice(...a) };
let pass = 0, fail = 0;
const ok = (c, name, x = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${name} ${JSON.stringify(x)?.slice(0, 400)}`); } };
const H = (t) => createHash('sha256').update(t).digest('hex'), T0 = '2026-01-01T00:00:00Z';

exec([['ann', 201, 0], ['bob', 202, 0], ['adm', 203, 1]].flatMap(([n, tg, a]) => [
  `INSERT INTO users (id, tg_user_id, display_name, lang, created_at) VALUES ('u_${n}', ${tg}, '${n}', 'ru', '${T0}')`,
  `INSERT INTO hunters (user_id, is_admin, created_at) VALUES ('u_${n}', ${a}, '${T0}')`,
  `INSERT INTO tokens (hash, user_id, label, created_at) VALUES ('${H(`tok-${n}`)}', 'u_${n}', 't', '${T0}')`]).join(';'));
const stop = () => srv.stop();
process.on('SIGINT', () => { stop(); process.exit(1); });
try {
  await srv.start();
  const api = async (who, method, path, body) => {
    const r = await fetch(BASE + path, { method, headers: { authorization: `Bearer tok-${who}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, j: await r.json().catch(() => null) };
  };
  const linkOf = async (who) => new URL((await (await fetch(`${BASE}/link`, { method: 'POST', headers: { authorization: `Bearer tok-${who}` }, body: '{}' })).json()).url).searchParams.get('k');
  const app = async (k, path, body, type = 'application/json') => {
    const r = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: { 'x-hunt-link': k, ...(body ? { 'content-type': type } : {}) }, body: body && type === 'application/json' ? JSON.stringify(body) : body });
    return { status: r.status, j: await r.json().catch(() => null) };
  };
  const A = (await api('ann', 'POST', '/api/searches', { title: 'A', region: 'kz/almaty', brief: { currency: 'KZT' } })).j.search.id;
  const B = (await api('bob', 'POST', '/api/searches', { title: 'B', region: 'kz/almaty', brief: { currency: 'KZT' } })).j.search.id;
  const [ka, kb, kadm] = [await linkOf('ann'), await linkOf('bob'), await linkOf('adm')];

  // ---- the same listing in two households
  const l1 = await api('ann', 'PUT', `/api/searches/${A}/listings/krisha-1`, { title: 'House A', price: 400000, currency: 'KZT', lat: 43.2, lng: 76.9 });
  const l2 = await api('bob', 'PUT', `/api/searches/${B}/listings/krisha-1`, { title: 'House B', lat: 43.2, lng: 76.9 });
  ok(l1.j.listing.id === 'krisha-1' && l2.status === 201 && l2.j.listing.id === `krisha-1--${B}`, 'both keep their own copy', l2);
  const l2b = await api('bob', 'PUT', `/api/searches/${B}/listings/krisha-1`, { summary: 's' });
  ok(l2b.status === 200 && l2b.j.listing.id === l2.j.listing.id && rows('SELECT COUNT(*) n FROM listings')[0].n === 2, 'a second write by the short id updates the copy', l2b);
  const g = await api('bob', 'GET', '/api/listings/krisha-1');
  ok(g.status === 200 && JSON.stringify(g.j).includes('House B') && !JSON.stringify(g.j).includes('House A'), 'the short id opens my own copy', g);
  ok((await api('bob', 'PATCH', '/api/listings/krisha-1', { status: 'talking' })).status === 200 && rows("SELECT status FROM listings WHERE id='krisha-1'")[0].status === 'new', 'PATCH by the short id changes only my copy');
  ok((await app(kb, '/app/api/vote', { listing_id: l2.j.listing.id, decision: 'want_view' })).status === 200, 'voting on the copy');
  ok((await app(kb, '/app/api/vote', { listing_id: 'krisha-1', decision: 'want_view' })).status === 404, "voting on the other's listing is closed");
  ok((await api('bob', 'PUT', '/api/viewings/new', { search_id: B, listing_id: 'krisha-1', starts_at: '2027-01-05T10:00:00+05:00' })).j?.viewing?.listing_id === l2.j.listing.id || rows('SELECT listing_id FROM viewings')[0]?.listing_id === l2.j.listing.id, 'a viewing by the short id lands on my copy');

  // ---- contacts
  const ch = [{ channel: 'whatsapp', address: '+77010000001', display: 'Owner' }];
  const ca = await api('ann', 'PUT', '/api/contacts/new', { name: 'Owner Ann knows', notes: 'secret of ann', channels: ch });
  const cb0 = await api('bob', 'POST', '/api/contacts/resolve', { channel: 'whatsapp', address: '+77010000001' });
  ok(ca.status === 200 && cb0.j.contact === null, "the exact number does not open another's contact", cb0);
  const cb = await api('bob', 'PUT', '/api/contacts/new', { name: 'Owner', channels: ch });
  const CA = ca.j.contact.id, CB = cb.j.contact.id;
  ok(cb.status === 200 && CA !== CB && !JSON.stringify(cb.j).includes('secret'), 'the same number is a separate contact', cb);
  ok((await api('bob', 'POST', '/api/contacts/resolve', { channel: 'whatsapp', address: '+77010000001' })).j.contact.id === CB, 'resolve finds mine');
  ok((await api('ann', 'POST', '/api/contacts/resolve', { q: 'Owner' })).j.contact.id === CA, 'free text finds mine');
  ok((await api('ann', 'PUT', '/api/contacts/new', { name: 'x', channels: ch })).j.error === 'channel_taken', 'one person keeps one contact per number');
  for (const [m, u, b] of [['GET', `/api/contacts/${CA}`], ['PUT', `/api/contacts/${CA}`, { name: 'x' }], ['POST', `/api/contacts/${CA}/link`, { listing_id: l2.j.listing.id }], ['POST', `/api/contacts/${CA}/notes`, { text: 'x', search_id: B }], ['GET', `/api/contacts/${CA}/messages`],
    ['POST', '/api/messages', [{ search_id: B, contact_id: CA, channel: 'whatsapp', direction: 'in', text: 'x' }]], ['POST', '/api/drafts', { search_id: B, contact_id: CA, channel: 'whatsapp', address: '+7', text: 'x' }],
    ['PUT', '/api/threads', { search_id: B, contact_id: CA }], ['PUT', '/api/house-contacts/new', { search_id: B, contact_id: CA, name: 'x', role: 'owner' }]]) {
    const r = await api('bob', m, u, b); ok(r.status === 404, `another's contact is closed: ${m} ${u}`, r);
  }
  ok(rows(`SELECT name, owner_id FROM contacts WHERE id='${CA}'`)[0].name === 'Owner Ann knows', 'the contact is unchanged');
  await api('ann', 'POST', `/api/contacts/${CA}/link`, { listing_id: 'krisha-1' });
  await api('bob', 'POST', `/api/contacts/${CB}/link`, { listing_id: 'krisha-1' });
  ok(rows(`SELECT listing_id FROM listing_contacts WHERE contact_id='${CB}'`)[0].listing_id === l2.j.listing.id, 'a link by the short id lands on my copy');
  // ---- notes about people
  ok((await api('ann', 'POST', `/api/contacts/${CA}/notes`, { text: 'ann thinks: late with the deposit', sentiment: -1, search_id: A })).status === 201, 'a note');
  const cb2 = await api('bob', 'GET', `/api/contacts/${CB}`);
  ok(cb2.status === 200 && !JSON.stringify(cb2.j).includes('ann thinks'), 'notes do not cross households (same phone number)', cb2);
  ok((await api('ann', 'GET', `/api/contacts/${CA}`)).j.notes.length === 1, 'my own notes are there');
  ok(!JSON.stringify((await app(kb, `/app/api/contact?id=${CB}&s=${B}`)).j).includes('ann thinks'), 'nor in the Mini App');
  ok((await app(kb, '/app/api/note', { search_id: B, contact_id: CA, text: 'x' })).status === 404, "no notes on another's contact from the Mini App");
  // ---- dossiers (both listings are at the same point)
  const ds = await api('ann', 'PUT', '/api/dossiers/new', { listing_id: 'krisha-1', verdict: 'ann: mould in the bathroom' });
  ok(ds.status === 201, 'dossier', ds);
  ok((await api('bob', 'GET', '/api/dossiers/match?listing_id=krisha-1')).j.dossiers.length === 0, 'the same house does not open the other dossier');
  ok((await api('ann', 'GET', '/api/dossiers/match?listing_id=krisha-1')).j.dossiers.length === 1, 'mine is there');
  const D = ds.j.dossier.id;
  for (const [m, u, b] of [['GET', `/api/dossiers/${D}`], ['PUT', `/api/dossiers/${D}`, { verdict: 'x' }], ['PUT', `/api/dossiers/${D}`, { verdict: 'x', listing_id: l2.j.listing.id }], ['POST', `/api/dossiers/${D}/items`, { title: 'x', search_id: B }]])
    ok((await api('bob', m, u, b)).status === 404, `another's dossier is closed: ${m}`);
  ok((await app(kb, `/app/api/dossier?listing_id=${l2.j.listing.id}`)).j.dossiers.length === 0, 'nor in the Mini App');
  // ---- useful links
  const ul = await app(ka, '/app/api/useful-suggest', { search_id: A, name: 'Ann link', url: 'https://example.com/ann' });
  ok(ul.status === 200 && ul.j.link.status === 'approved', "an owner's own link", ul);
  const has = async (k, s, t) => JSON.stringify((await app(k, `/app/api/useful?s=${s}`)).j).includes(t);
  ok((await has(ka, A, 'Ann link')) && !(await has(kb, B, 'Ann link')), "a hunter's link stays in their projects");
  ok((await app(kb, '/app/api/useful-suggest', { search_id: B, name: 'Bob', url: 'https://example.com/ann' })).status === 200, 'the same address can be added by another, without learning about it');
  ok((await api('bob', 'PUT', `/api/useful/${ul.j.link.id}`, { status: 'rejected' })).status === 403, "another's link cannot be changed");
  const C = (await api('adm', 'POST', '/api/searches', { title: 'C', region: 'kz/almaty' })).j.search.id;
  await app(kadm, '/app/api/useful-suggest', { search_id: C, name: 'Admin link', url: 'https://example.com/adm' });
  ok((await has(kb, B, 'Admin link')) && (await has(ka, A, 'Admin link')), "an admin's link is for everyone");
  // ---- other projects stay closed
  for (const u of [`/api/searches/${A}`, `/api/searches/${A}/listings`, `/api/searches/${A}/digest`, `/api/searches/${A}/expenses`]) ok((await api('bob', 'GET', u)).status === 404, `closed: ${u}`);
  ok((await app(kb, `/app/api/listing?id=krisha-1`)).status === 404, "another's listing in the Mini App");

  // ---- /delete
  const me = (await api('ann', 'GET', '/api/me')).j.user.id;
  await api('ann', 'POST', `/api/searches/${A}/expenses`, { title: 'Taxi', amount: 10, paid_by: me });
  const su = await api('ann', 'PUT', `/api/searches/${A}/suppliers/new`, { name: 'Market', kind: 'fruit', channel: 'whatsapp', address: '+77010000009' });
  await api('ann', 'POST', `/api/searches/${A}/suppliers/${su.j.supplier.id}/import`, { items: [{ name_id: 'Alma', name_ru: 'Яблоко', name_en: 'Apple', grp: 'fruit', unit: 'kg', price: 100 }] });
  await api('ann', 'POST', `/api/searches/${A}/suppliers/${su.j.supplier.id}/import`, { items: [{ name_id: 'Alma', price: 120 }] });
  await api('ann', 'POST', '/api/messages', [{ search_id: A, contact_id: CA, channel: 'whatsapp', direction: 'in', text: 'hi', external_id: 'e1' }]);
  await api('ann', 'PUT', '/api/threads', { search_id: A, contact_id: CA, last: 'hi' });
  await api('ann', 'POST', `/api/dossiers/${D}/items`, { title: 'note', search_id: A });
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const rc = await app(ka, `/app/api/expense-receipt?search_id=${A}&s=${A}`, jpg, 'image/jpeg');
  ok(rc.status === 200 && kvKeys().some((k) => k.startsWith(`r/${A}/`)), 'a receipt photo is stored', rc);
  exec(`INSERT INTO members (search_id, user_id, role) VALUES ('${B}','u_ann','member')`);
  await app(ka, '/app/api/vote', { listing_id: l2.j.listing.id, decision: 'take' });
  const hook = (id, text) => fetch(`${BASE}/tg/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'hook' }, body: JSON.stringify({ message: { message_id: 1, from: { id, first_name: 'x', language_code: 'ru' }, chat: { id, type: 'private' }, text } }) });
  await hook(201, '/delete');
  ok(rows(`SELECT COUNT(*) n FROM searches WHERE id='${A}'`)[0].n === 1, '/delete asks first');
  await hook(203, '/delete yes');
  ok(rows(`SELECT COUNT(*) n FROM searches WHERE id='${C}'`)[0].n === 1, 'an admin is not deleted by the bot');
  const before = rows('SELECT COUNT(*) n FROM listings')[0].n;
  await hook(201, '/delete yes');
  ok(rows(`SELECT COUNT(*) n FROM searches WHERE id='${A}'`)[0].n === 0, 'the project is gone', log.slice(-600));
  ok(rows('PRAGMA foreign_key_check').length === 0, 'no broken references', rows('PRAGMA foreign_key_check'));
  const tables = rows("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'").map((r) => r.name);
  const dump = tables.map((t) => [t, JSON.stringify(rows(`SELECT * FROM "${t}"`))]);
  for (const s of [A, CA, 'secret of ann', 'ann thinks', 'mould', 'House A', '+77010000009', 'Alma', 'Ann link', H('tok-ann')]) { const hit = dump.filter(([, d]) => d.includes(s)).map(([t]) => t); ok(!hit.length, `nothing left with "${String(s).slice(0, 24)}"`, hit); }
  ok(!kvKeys().some((k) => k.startsWith(`r/${A}/`)), 'the photos are gone');
  ok(rows("SELECT display_name, tg_user_id FROM users WHERE id='u_ann'")[0].tg_user_id === null && rows(`SELECT COUNT(*) n FROM members WHERE search_id='${B}' AND user_id='u_ann'`)[0].n === 1, "in Bob's project the person is anonymous");
  ok((await api('ann', 'GET', '/api/me')).status === 401, 'the token is dead');
  ok(before === 2 && rows('SELECT COUNT(*) n FROM listings')[0].n === 1 && (await api('bob', 'GET', '/api/listings/krisha-1')).status === 200 && (await api('bob', 'GET', `/api/contacts/${CB}`)).status === 200, "Bob's things are untouched");
  ok((await app(kb, '/app/api/state')).status === 200, "Bob's Mini App opens");
} catch (e) { fail++; console.log('ERROR', e.stack?.slice(0, 600), log.slice(-1200)); } finally { await srv.cleanup(); }
console.log(`households: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
