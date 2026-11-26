// The demo without sign-in: an invented project recorded by scripts/make-demo.mjs, played back in this browser only. Nothing is sent anywhere.
let data = null;
const on = () => { try { return sessionStorage.getItem('hunt.demo') === '1'; } catch { return false; } };
export const demoOn = on();
export function demoStart() { try { sessionStorage.setItem('hunt.demo', '1'); } catch { /* private window */ } location.hash = ''; location.reload(); }
export function demoStop() { try { sessionStorage.removeItem('hunt.demo'); } catch { /* ok */ } location.hash = ''; location.reload(); }
async function get() {
  if (data) return data;
  const txt = await (await fetch(`/demo-home/demo${/^ru|^uk|^be|^kk/i.test(navigator.language) ? '' : '.en'}.json`)).text();
  // Every date moves by the same number of days, so "tomorrow" in the recording is tomorrow now.
  const rec = JSON.parse(txt).day, today = new Date(Date.now() + 8 * 36e5).toISOString().slice(0, 10), by = Date.parse(today) - Date.parse(rec);
  const moved = by ? txt.replace(/\b20\d\d-\d\d-\d\d\b/g, (d) => new Date(Date.parse(d) + by).toISOString().slice(0, 10)) : txt;
  data = JSON.parse(moved);
  for (const s of [data.SR, data.HM, data.BG].filter(Boolean)) data['/app/api/desk?s=' + s].agent_seen_at = new Date(Date.now() - 3 * 6e4).toISOString();
  return data;
}
export const demoRegions = async () => (await get()).regions;
const fail = (code, status = 400) => { throw Object.assign(new Error(code), { code, status }); };
export async function demoApi(path, body) {
  const d = await get(), u = new URL(path, location.origin), q = u.searchParams;
  const copy = (x) => JSON.parse(JSON.stringify(x));
  // Access to conversations (access.js): invented, changes only here. sessionStorage hunt.demo.ac = JSON overrides for pictures.
  if (u.pathname.startsWith('/app/api/access')) {
    const st0 = d['/app/api/state?s=' + d.SR], day = new Date().toISOString();
    if (!d.ac) {
      let over: Bag = {};
      try { over = JSON.parse(sessionStorage.getItem('hunt.demo.ac') || '{}'); } catch { /* ok */ }
      d.ac = { bot: 'hunt_bot', sealed: true, connected: true, tg: { status: 'on', mode: 'new', extra: [] }, wa: { status: 'button' }, dropped: 2, retain_days: 30, purges: [], receipts: [], ai: null,
        contacts: st0.threads.map((x, i) => ({ id: x.contact_id, name: x.contact_name, channel: (st0.channels ?? []).find((c) => c.contact_id === x.contact_id)?.channel ?? 'whatsapp', n: [12, 4, 3, 2, 6][i % 5] })).slice(0, 3),
        log: [{ actor: st0.user.id, name: st0.user.display_name, via: 'app', day: day.slice(0, 10) }, { actor: 'o', name: 'Олег', via: 'app', day: day.slice(0, 10) }], ...over };
    }
    const ac = d.ac, what = u.pathname.slice('/app/api/access/'.length);
    if (!body) return copy(ac);
    if (what === 'set') { if (body.wa) ac.wa.status = body.wa; if (body.tg_mode) ac.tg.mode = body.tg_mode; if (body.cap && ac.ai) ac.ai.cap = body.cap; if (body.again) ac.tg = { status: 'off', mode: null, extra: [] }; return { ok: true }; }
    if (what === 'mute') { const c = ac.contacts.find((x) => x.id === body.contact_id); if (c) c.muted = body.on ? 1 : null; return { ok: true }; }
    if (what === 'revoke') {
      const n = ac.contacts.reduce((a, c) => a + c.n, 0);
      ac.receipts = [{ id: 'ar_demo', at: day, tg: ac.tg.status === 'off' ? 'off' : 'wait', wa: ac.wa.status === 'off' ? 'off' : 'done', data: body.data === false ? 'kept' : 'done', messages: n, copies: 'erased', sessions: 2, agents: 1 }];
      if (ac.tg.status !== 'off') ac.tg.status = 'revoking';
      ac.wa.status = 'off'; if (body.data !== false) { ac.contacts = []; ac.log = []; ac.dropped = 0; }
      return { ok: true, receipt: ac.receipts[0] };
    }
    return fail('demo');
  }
  if (!body) {
    if (u.pathname === '/app/api/afisha') return copy(d.afisha[q.get('day') ?? ''] ?? d.afisha['']);
    if (u.pathname === '/app/api/state' && !q.get('s')) return copy({ ...d['/app/api/state'], ...(q.get('l') ? {} : {}) });
    return d[path] ? copy(d[path]) : fail('demo', 404);
  }
  const st = (s) => d['/app/api/state?s=' + s];
  if (u.pathname === '/app/api/draft') {
    for (const s of [d.SR, d.HM]) {
      const x = st(s).drafts.find((y) => y.id === body.draft_id);
      if (!x) continue;
      st(s).drafts = st(s).drafts.filter((y) => y !== x);
      const th = d[`/app/api/thread?s=${s}&c=${x.contact_id}`];
      if (th) { th.drafts = []; if (body.action === 'send') th.messages.push({ id: 'demo' + Date.now(), at: new Date().toISOString(), channel: x.channel, direction: 'out', text: body.text ?? x.text, tr: body.text ? null : x.tr ?? th.messages.at(-1)?.tr ?? null }); }
    }
    return { ok: true };
  }
  if (u.pathname === '/app/api/order-line') {
    const sh = d['/app/api/shop?s=' + d.HM], K = sh.keys, b = sh.baskets[0], row = Object.values(sh.items).flat().find((a) => a[K.indexOf('id')] === body.item_id), v = (n) => row[K.indexOf(n)];
    if (b && row) {
      b.lines = b.lines.filter((l) => l.item_id !== body.item_id || body.qty > 0);
      const l = b.lines.find((x) => x.item_id === body.item_id);
      if (l) l.qty = body.qty; else if (body.qty > 0) b.lines.push({ item_id: body.item_id, qty: body.qty, by: sh.baskets[0].lines[0]?.by, unit: v('unit'), step: v('step'), toy: v('toy'), name_id: v('name_id'), name_ru: v('ru'), name_en: v('en'), price: v('price'), unsure: false });
      b.sum = b.lines.reduce((a, x) => a + (x.price ?? 0) * x.qty, 0);
      Object.assign(d['/app/api/orders?s=' + d.HM], { baskets: copy(sh.baskets) });
    }
    return copy({ suppliers: sh.suppliers, baskets: sh.baskets, active: sh.active, history: sh.history });
  }
  if (u.pathname === '/app/api/vote') { const s = st(d.SR); s.votes = s.votes.filter((x) => x.listing_id !== body.listing_id || x.user_id !== s.user.id).concat({ listing_id: body.listing_id, user_id: s.user.id, decision: body.decision, at: new Date().toISOString() }); return { ok: true }; }
  if (['/app/api/instruction', '/app/api/say', '/app/api/lang', '/app/api/event-feedback'].includes(u.pathname)) return { ok: true, status: 'translating' };
  return fail('demo');
}
