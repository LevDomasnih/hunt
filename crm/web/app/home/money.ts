// Split from app.js (wave 11): see the section comment below.
import { api, load } from '../core/api.js';
import { D, canVoteRole, districtShort, memberById } from '../core/data.js';
import { LOC, SYM, dayKey, dfmt, firstName, fmtDM, fmtDMY, fmtNum, money, shortTitle, wdShort } from '../core/format.js';
import { LANG, cap, t } from '../core/i18n.js';
import { back, go, sp } from '../core/routing.js';
import { closeSheet, emit, hap, openSheet, toast } from '../core/store.js';
import { Good, OrderReceiptOf } from '../orders/orders.js';
import { briefCur } from '../screens/deal.js';
import { Av, Icon } from '../ui/icons.js';
import { BigWord, CountUp, Nav, Sticker, Typed, bigMoney } from '../ui/pieces.js';
import { BackIfWeb, dealListing, isLiving, pickFiles, scaled, uploadImage } from './helpers.js';
import { homeMode } from './homemode.js';
import { html } from 'htm/preact';
import { useState } from 'preact/hooks';

// ---------------------------------------------------------------- money (17)
export const XK_ICON = { rent: 'key-round', deposit: 'key-round', power: 'zap', water: 'droplets', internet: 'wifi', cleaning: 'sparkles', pool: 'waves', repair: 'wrench', food: 'utensils', transport: 'car', other: 'receipt-text' };
export const XKINDS = ['rent', 'deposit', 'power', 'cleaning', 'pool', 'water', 'internet', 'repair', 'food', 'transport', 'other'];
export function splitLabel(e, m) {
  const voters = d2voters();
  const w = e.split;
  if (!w && m.rent_weights) return e.kind === 'rent' ? t('w3_split_sub') : m.rooms?.others_equal === false ? t('split_shares') : voters.length === 2 ? t('split_half') : t('split_equal');
  if (!w) {
    const vals = Object.values(m.shares ?? {});
    const equal = vals.every((x) => x === vals[0]);
    return equal ? (vals.length === 2 ? t('split_half') : t('split_equal')) : t('split_shares');
  }
  const keys = Object.keys(w);
  if (keys.length === 1 && keys[0] === e.paid_by) return t('split_self');
  if (keys.length < voters.length) return t('split_custom');
  const vals = Object.values(w);
  return vals.every((x) => x === vals[0]) ? (vals.length === 2 ? t('split_half') : t('split_equal')) : t('split_shares');
}
export const d2voters = () => (D()?.members ?? []).filter((m) => canVoteRole(m.role)).map((m) => m.user_id);
/**
 * Wave 8.1: payments already made under the deal (deal dates of kind payment, done, with an amount). The deposit part (deal terms
 * deposit; a payment that says "залог / депозит" or covers rent + deposit) is held by the landlord: not spending, it comes back
 * on the deposit_return date. The rest is rent, spent for its period (the k-th rent payment covers month k from the move-in).
 * Skipped when an expense of the same kind and amount within a week already records it.
 */
export function dealPaid(expenses, cur) {
  const d = D();
  const terms = d.deal?.data?.terms ?? {};
  const dep0 = Number(terms.deposit) || 0, rent0 = Number(terms.rent) || 0;
  const back = (d.dates ?? []).filter((x) => x.kind === 'deposit_return' && !x.done).sort((a, b) => a.date.localeCompare(b.date))[0]?.date ?? terms.to ?? null;
  const near = (kind, amt, day) => expenses.some((e) => e.kind === kind && Math.abs(Number(e.amount) - amt) <= Math.max(1, amt * 0.02) && Math.abs(Date.parse(String(e.date).slice(0, 10)) - Date.parse(day)) <= 7 * 864e5);
  const addMonths = (day, n) => { const x = new Date(day + 'T12:00:00Z'); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
  const out = { rent: [], deposit: null };
  let depLeft = dep0, k = 0;
  const pays = (d.dates ?? []).filter((x) => x.kind === 'payment' && x.done && Number(x.amount) > 0 && (!x.currency || !cur || x.currency === cur)).sort((a, b) => a.date.localeCompare(b.date));
  for (const x of pays) {
    const amt = Number(x.amount);
    if (near('rent', amt, x.date) || near('deposit', amt, x.date) || near('other', amt, x.date)) { k++; continue; } // already an expense as a whole
    const says = /залог|депозит|deposit/i.test(`${x.title ?? ''} ${x.note ?? ''}`);
    const dep = depLeft > 0 && (says || (rent0 && amt >= rent0 + depLeft)) ? Math.min(depLeft, amt) : 0;
    depLeft -= dep;
    const rent = amt - dep;
    if (dep > 0 && !near('deposit', dep, x.date)) out.deposit = { amount: (out.deposit?.amount ?? 0) + dep, currency: x.currency ?? cur, date: x.date, back };
    if (rent > 0) {
      const from = terms.from ? addMonths(terms.from, k) : null;
      const to = terms.from ? addMonths(terms.from, k + 1) : null;
      k++;
      if (!near('rent', rent, x.date)) out.rent.push({ id: `deal-${x.date}-${k}`, kind: 'rent', amount: rent, currency: x.currency ?? cur, date: x.date, title: x.title, deal: true, from, to });
    }
  }
  return out;
}
/** The deal payments as hairline rows: rent for its period, the deposit with the landlord (back on …). */
export function DealPaidList({ paid, cur }) {
  if (!paid.rent.length && !paid.deposit) return null;
  return html`<div class="card w2-list ms81-paid">
    <div class="w2-lh"><span>${t('w81_m_paid')}</span></div>
    ${paid.rent.map((r) => html`<button key=${r.id} class="w2-row x-row" onClick=${() => go(sp('deal'))}><span class="sq"><${Icon} n="home" /></span>
      <div class="grow"><b>${t('w81_m_rent')}${r.from ? ` · ${fmtDM(r.from)}–${fmtDM(r.to)}` : ''}</b><span>${[fmtDM(r.date), r.title].filter(Boolean).join(' · ')}</span></div>
      <div class="x-r"><b>${money(r.amount, r.currency ?? cur)}</b></div></button>`)}
    ${paid.deposit && html`<button class="w2-row x-row ms81-dep" onClick=${() => go(sp('deal'))}><span class="sq"><${Icon} n="key-round" /></span>
      <div class="grow"><b>${t('w81_m_deposit')}${paid.deposit.back ? ` · ${t('w81_m_dep_back', { d: fmtDM(paid.deposit.back) })}` : ''}</b><span>${t('w81_m_dep_note')}</span></div>
      <div class="x-r"><b>${money(paid.deposit.amount, paid.deposit.currency ?? cur)}</b></div></button>`}
  </div>`;
}
/** Wave 8.1: a brand-new project's money screen: what will appear here (ghost rows), a sticker, the "Добавить трату" pill. */
export function MoneyEmpty({ canEdit }) {
  const d = D();
  const me = memberById(d.user.id);
  const ghost = [['rent', 92], ['power', 34], ['transport', 22], ['cleaning', 14]];
  return html`<section class="w8-hero ms81-empty">
    <${BigWord} text=${t('money')} />
    <p class="ms-k">${t('w81_m_empty_k')}</p>
    <div class="ms81-e-stage">
      <${Sticker} text=${t('w81_m_soon')} cls="lg" style="right:6%;top:4px;--r:-12deg" />
      ${me && html`<span class="ani" style="left:2%;top:18px;--r:-8deg"><${Av} m=${me} size=${58} free /></span>`}
    </div>
    <${Typed} lines=${[t('w81_m_empty')]} />
    <p class="w8-sub">${t('w81_m_empty_sub')}</p>
    <div class="ms8-rows ms81-ghost" aria-hidden="true">${ghost.map(([k, w]) => html`<div key=${k} class="ms8-row"><span class="n">${t('xk_' + k)}</span><span class="bar"><i style=${`width:${w}%`}></i></span><b>${t('w81_m_soon')}</b></div>`)}</div>
    ${canEdit && html`<button class="btn accent block big ms8-add" onClick=${() => { hap.sel(); openSheet('add_expense'); }}><${Icon} n="plus" />${t('w81_m_add')}</button>`}
  </section>`;
}
export function Money() {
  const d = D();
  const m = d.money ?? { expenses: [], balances: {}, totals: {}, shares: {} };
  const me = d.user.id;
  const terms = d.deal?.data?.terms ?? {};
  const cur = m.currency || terms.currency || briefCur(d.search);
  const bal = m.balances?.[cur] ?? { transfers: [] };
  const mine = bal.transfers.filter((x) => x.from === me || x.to === me);
  const top = mine[0] ?? bal.transfers[0] ?? null;
  const [busy, setBusy] = useState(false);
  const n = d2voters().length;
  const shared = m.mode === 'shared';
  const kicker = [isLiving() || d.deal ? districtShort(dealListing()) || shortTitle(d.search.title) : shortTitle(d.search.title), shared ? t('mm_shared') : isLiving() ? t('live_n', { n }) : t('members_n', { n: d.members.length })].filter(Boolean).join(' · ');
  const other = (x) => memberById(x.from === me ? x.to : x.from);
  const line = (x) => (x.to === me ? t('owes_you', { name: firstName(memberById(x.from)?.name) }) : x.from === me ? t('you_owe', { name: firstName(memberById(x.to)?.name) }) : t('owes', { a: firstName(memberById(x.from)?.name), b: firstName(memberById(x.to)?.name) }));
  async function settle() {
    if (!top) return;
    setBusy(true);
    try {
      const r = await api('/app/api/settle', { search_id: d.search.id, from: top.from, to: top.to, amount: top.amount, currency: cur });
      d.money = r.money;
      hap.ok();
      toast(t('settled_toast'));
      emit();
    } catch { toast(t('err_generic')); }
    setBusy(false);
  }
  const tot = m.totals ?? {};
  // Newest first (Q3); the payer's animal leads the row.
  const list = [...(m.expenses ?? [])].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.created_at).localeCompare(String(a.created_at)));
  const paid = dealPaid(m.expenses ?? [], cur);
  const canEdit = canVoteRole(d.me.role);
  const myShare = tot.per_member?.[me];
  const equalShares = new Set(Object.values(m.shares ?? {})).size <= 1 && !m.rent_weights;
  const gear = d.me.role === 'owner' && html`<button class="round sm w2-back" aria-label=${t('mm_settings')} onClick=${() => openSheet('money_mode')}><${Icon} n="settings-2" /></button>`;
  const head = html`<div class="head w8-head"><div class="row w8-head-top"><${BackIfWeb} /><span class="grow"></span>${gear}</div><p class="kicker">${kicker}</p><h1 class="sr">${t('money')}</h1></div>`;
  const nav = html`<${Nav} tab=${homeMode() ? 'money' : 'today'} />`;
  if (!list.length && !paid.rent.length && !paid.deposit) return html`<main class="screen w2 ms81">${head}<${MoneyEmpty} canEdit=${canEdit} />${nav}</main>`;
  const addBtn = canEdit && html`<button class="btn accent block big ms8-add" onClick=${() => { hap.sel(); openSheet('add_expense'); }}><${Icon} n="plus" />${t('w81_m_add')}</button>`;
  const expensesCard = html`<div class="card w2-list">
      <div class="w2-lh"><span>${t('expenses')}</span>${canEdit && html`<button class="w2-add" onClick=${() => { hap.sel(); openSheet('add_expense'); }}><${Icon} n="plus" cls="sm" />${t('add')}</button>`}</div>
      ${list.length ? list.map((e) => html`<button key=${e.id} class="w2-row x-row" onClick=${() => openSheet('expense', e.id)}>
        ${e.order_id ? html`<span class="or-xrow"><${Good} slug="bag" size=${52} rot=${-8} shadow=${false} /><${Av} m=${memberById(e.paid_by) ?? { name: '?' }} size=${28} /></span>` : html`<${Av} m=${memberById(e.paid_by) ?? { name: '?' }} size=${36} />`}
        <div class="grow"><b>${e.title}</b><span>${[memberById(e.paid_by) ? (e.paid_by === me ? t('sp_you') : firstName(memberById(e.paid_by).name)) : null, fmtDM(e.date), e.method ? t('pm_' + e.method) : null, shared ? null : splitLabel(e, m), e.receipt ? t('receipt') : null].filter(Boolean).join(' · ')}</span></div>
        <div class="x-r"><b>${money(e.amount, e.currency)}</b></div></button>`)
      : html`<div class="w2-row"><span class="muted">${t('no_expenses')}</span></div>`}</div>`;
  if (shared) {
    const months = Object.entries(tot.by_month ?? {}).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6);
    return html`<main class="screen w2 ms81">
      ${head}
      <${MoneyStat} list=${list} cur=${cur} paid=${paid} />
      ${addBtn}
      <${DealPaidList} paid=${paid} cur=${cur} />
      ${months.length > 1 && html`<div class="card w2-list"><div class="w2-lh"><span>${t('mm_by_month')}</span></div>
        ${months.map(([mth, v]) => html`<div class="w2-row mm-row"><div class="grow"><b>${cap(dfmt(mth + '-15', { month: 'long', year: 'numeric' }))}</b></div><b>${money(v, cur)}</b></div>`)}</div>`}
      ${expensesCard}
      ${nav}
    </main>`;
  }
  return html`<main class="screen w2 ms81">
    ${head}
    <${MoneyStat} list=${list} cur=${cur} paid=${paid} />
    ${addBtn}
    ${list.length > 0 && html`<div class="m-hero">
      <p class="m-k">${t('money_today')}</p>
      ${top ? html`<div class="m-row">${mine.length ? html`<${Av} m=${other(top)} size=${44} />` : null}<span class="grow">${line(top)}</span><b>${money(top.amount, cur)}</b></div>`
        : html`<div class="m-row"><span class="grow">${t('all_square')}</span></div>`}
      ${bal.transfers.slice(1).map((x) => html`<div class="m-more">${line(x)} · ${money(x.amount, cur)}</div>`)}
      ${top && canEdit && (top.from === me || top.to === me || d.me.role === 'owner') && html`<button class="btn block m-settle" disabled=${busy} onClick=${settle}>${t('settle')}</button>`}
    </div>`}
    ${list.length > 0 && html`<div class="m-tiles">
      <div class="card"><b>${money(tot.total, cur)}</b><span>${t('m_total')}</span></div>
      <button class="card" onClick=${() => canEdit && go(sp('split'))}><b>${scaled(equalShares ? tot.equal_share : myShare ?? 0, tot.total)}</b><span>${equalShares ? t('m_each') : t('m_mine')}</span></button>
      <div class="card">${tot.power_per_month ? html`<b>~${scaled(tot.power_per_month, tot.power_per_month)}</b><span>${t('m_power')}</span>` : html`<b>${list.length}</b><span>${t('m_count', { n: list.length })}</span>`}</div>
    </div>`}
    <div style="height:14px"></div>
    <${DealPaidList} paid=${paid} cur=${cur} />
    ${expensesCard}
    ${nav}
  </main>`;
}
/** Q3 stat card: what the group spent this week / month / all time, compared with the previous period, with period bars. */
export const PW_MONTH_IN = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
export const pwMonthIn = (ym) => (LANG === 'ru' ? PW_MONTH_IN[Number(ym.slice(5, 7)) - 1] : dfmt(ym + '-15', { month: 'long' }));
export const pwMonthOf = (ym) => (LANG === 'ru' ? dfmt(ym + '-15', { day: 'numeric', month: 'long' }).replace(/^\d+\s*/, '') : dfmt(ym + '-15', { month: 'long' }));
export const pwShift = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export function MoneyStat({ list, cur, paid = { rent: [], deposit: null } }) {
  // wave 8.1: rent paid under the deal counts as spending; the deposit is not spending (a typed side line)
  const xs = [...list.filter((e) => e.currency === cur && e.date && e.kind !== 'deposit'), ...paid.rent];
  const today = dayKey(new Date().toISOString());
  const sum = (f) => xs.filter((e) => f(String(e.date).slice(0, 10))).reduce((a, e) => a + Number(e.amount || 0), 0);
  // never a dead "0": a month without spending yet opens on "all time" when there is history
  const [per, setPer] = useState(() => (sum((dd) => dd.startsWith(today.slice(0, 7))) > 0 || !xs.length ? 'month' : 'all'));
  if (!xs.length && !paid.deposit) return null;
  let label, total, prev = null, cmp = null, bars;
  if (per === 'week') {
    const from = pwShift(today, -6), pfrom = pwShift(today, -13);
    total = sum((d) => d >= from && d <= today);
    prev = sum((d) => d >= pfrom && d < from);
    label = t('pw_spent_week');
    if (prev > 0 && total !== prev) cmp = t(total < prev ? 'pw_less_week' : 'pw_more_week', { x: money(Math.abs(total - prev), cur) });
    bars = Array.from({ length: 7 }, (_, k) => { const d = pwShift(from, k); return { lb: wdShort(d), v: sum((x) => x === d), on: d === today }; });
  } else if (per === 'month') {
    const ym = today.slice(0, 7);
    const pym = pwShift(ym + '-01', -1).slice(0, 7);
    total = sum((d) => d.startsWith(ym));
    prev = sum((d) => d.startsWith(pym));
    label = t('pw_spent_in', { m: pwMonthIn(ym) });
    if (prev > 0 && total !== prev) cmp = t(total < prev ? 'pw_less' : 'pw_more', { x: money(Math.abs(total - prev), cur), m: pwMonthOf(pym) });
    const end = Number(new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate());
    const day = Number(today.slice(8, 10));
    bars = [[1, 7], [8, 14], [15, 21], [22, end]].map(([a, b]) => ({ lb: `${a}–${b}`, v: sum((d) => d.startsWith(ym) && Number(d.slice(8, 10)) >= a && Number(d.slice(8, 10)) <= b), on: day >= a && day <= b }));
  } else {
    total = sum(() => true);
    label = t('pw_spent_all');
    const ms = [...new Set(xs.map((e) => String(e.date).slice(0, 7)))].sort().slice(-6);
    bars = ms.map((m) => ({ lb: cap(dfmt(m + '-15', { month: 'short' })).replace('.', ''), v: sum((d) => d.startsWith(m)), on: m === today.slice(0, 7) }));
  }
  // wave 8 (V4-5): the giant counted-up figure, its unit, the typed comparison, then the period's categories as bar rows
  const inPer = per === 'week' ? ((dd) => dd >= pwShift(today, -6) && dd <= today) : per === 'month' ? ((dd) => dd.startsWith(today.slice(0, 7))) : () => true;
  const byKind: Bag = {};
  for (const e of xs) if (inPer(String(e.date).slice(0, 10))) byKind[e.kind || 'other'] = (byKind[e.kind || 'other'] ?? 0) + Number(e.amount || 0);
  const kinds = Object.entries(byKind).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const kmax = Math.max(1, ...kinds.map((x) => x[1]));
  const bm = bigMoney(total, cur);
  const f = (n) => new Intl.NumberFormat(LOC(), { minimumFractionDigits: bm.dec, maximumFractionDigits: bm.dec }).format(n);
  // the typed line (V4-5): the comparison, else what the figure is made of (rent from the lease, the deposit aside)
  const rentIn = paid.rent.filter((r) => inPer(String(r.date).slice(0, 10))).reduce((a, r) => a + r.amount, 0);
  const lines = [
    cmp,
    !cmp && total === 0 && per === 'month' ? t('w81_m_none_month', { m: pwMonthIn(today.slice(0, 7)) }) : null,
    !cmp && total === 0 && per === 'month' && sum(() => true) > 0 ? t('w81_m_all_line', { x: money(sum(() => true), cur) }) : null,
    !cmp && rentIn > 0 && rentIn < total ? t('w81_m_rent_of', { x: money(rentIn, cur) }) : null,
    !cmp && rentIn > 0 && rentIn === total && per !== 'all' && !paid.rent.some((r) => String(r.date).slice(0, 7) < today.slice(0, 7)) ? t('w81_m_first') : null,
    paid.deposit ? t('w81_m_dep_line', { x: money(paid.deposit.amount, paid.deposit.currency ?? cur) }) : null,
  ].filter(Boolean).slice(0, 3);
  return html`<div class="ms8">
    <p class="ms-k">${label}</p>
    <p class="ms8-big" aria-label=${money(total, cur)}><span aria-hidden="true"><${CountUp} key=${per} value=${bm.v} fmt=${f} /></span></p>
    ${bm.unit && html`<p class="ms8-unit">${bm.unit}</p>`}
    ${lines.length > 0 && html`<${Typed} key=${per + lines.join('|')} cls="xs ms8-cmp" lines=${lines} />`}
    <div class="seg ms-seg" role="group">${['week', 'month', 'all'].map((k) => html`<button key=${k} aria-pressed=${per === k ? 'true' : 'false'} onClick=${() => { hap.sel(); setPer(k); }}>${t('pw_per_' + k)}</button>`)}</div>
    ${kinds.length > 0 && html`<div class="ms8-rows">${kinds.map(([k, v]) => html`<div key=${k} class="ms8-row"><span class="n">${t('xk_' + k)}</span><span class="bar"><i style=${`width:${Math.max(3, Math.round((v / kmax) * 100))}%`}></i></span><b>${scaled(v, kmax)}</b></div>`)}</div>`}
    <span class="sr">${bars.map((b) => `${b.lb}: ${money(b.v, cur)}`).join(', ')}</span>
  </div>`;
}
/** "1,5 млн" / "800k" / "1500000" → number in main units. */
export function parseAmount(s) {
  const x = String(s ?? '').trim().toLowerCase().replace(/\s/g, '').replace(',', '.');
  const m = x.match(/^(\d+(?:\.\d+)?)(млн|m|mio|jt|тыс|k|rb)?$/);
  if (!m) return NaN;
  const mul = { 'млн': 1e6, m: 1e6, mio: 1e6, jt: 1e6, 'тыс': 1e3, k: 1e3, rb: 1e3 }[m[2]] ?? 1;
  return Math.round(Number(m[1]) * mul);
}
export function AddExpense() {
  const d = D();
  const cur = d.money?.currency ?? briefCur(d.search) ?? 'IDR';
  const voters = d2voters();
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState('other');
  const [paid, setPaid] = useState(d.user.id);
  const [who, setWho] = useState(() => new Set<string>(voters));
  const [method, setMethod] = useState(null);
  const [date, setDate] = useState(dayKey(new Date().toISOString()));
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [busy, setBusy] = useState(false);
  async function addReceipt() {
    const [f] = await pickFiles({ capture: true });
    if (!f) return;
    setBusy(true);
    try { const r = await uploadImage('/app/api/expense-receipt?search_id=' + encodeURIComponent(d.search.id), f); setReceipt(r.key); hap.ok(); }
    catch { toast(t('err_generic')); }
    setBusy(false);
  }
  async function save() {
    const a = parseAmount(amount);
    if (!title.trim() || !(a > 0)) return toast(t('x_need'));
    const everyone = voters.every((u) => who.has(u)) && who.size === voters.length;
    setBusy(true);
    try {
      await api('/app/api/expense', {
        search_id: d.search.id, title: title.trim(), amount: a, currency: cur, kind, paid_by: paid, method, date, note: note.trim() || null, receipt,
        split: everyone ? null : Object.fromEntries([...who].map((u) => [u, d.money?.shares?.[u] ?? 1])),
      });
      hap.ok();
      toast(t('x_saved'));
      closeSheet();
      load(d.search.id, { quiet: true });
    } catch { toast(t('err_generic')); }
    setBusy(false);
  }
  const chip = (on, label, f, extra = null) => html`<button class=${'bchip' + (on ? ' on' : ' off')} aria-pressed=${on ? 'true' : 'false'} onClick=${() => { hap.sel(); f(); }}>${extra}${label}</button>`;
  return html`<p class="kicker">${t('w8_new')}</p><h2 class="sr">${t('x_add')}</h2>
    <div class="x-form">
      <label class="amount-in"><input inputmode="decimal" value=${amount} placeholder="1 500 000" aria-label=${t('x_amount', { cur: SYM[cur] ?? cur })} onInput=${(e) => setAmount(e.currentTarget.value)} /><span>${SYM[cur] ?? cur}</span></label>
      <p class="amount-hint">${parseAmount(amount) > 0 ? t('pw_approx', { x: money(parseAmount(amount), cur) }) : ''}</p>
      <p class="e-lbl">${t('pw_category')}</p><div class="chips">${XKINDS.map((k) => chip(kind === k, t('xk_' + k), () => setKind(k), html`<${Icon} n=${XK_ICON[k]} cls="xs" />`))}</div>
      <p class="e-lbl">${t('x_title')}</p><input class="e-input" value=${title} placeholder=${t('x_title_ph')} onInput=${(e) => setTitle(e.currentTarget.value)} />
      <p class="e-lbl">${t('x_paid_by')}</p><div class="chips">${voters.map((u) => chip(paid === u, firstName(memberById(u)?.name), () => setPaid(u)))}</div>
      <p class="e-lbl">${t('x_split')}</p><div class="chips">${voters.map((u) => chip(who.has(u), firstName(memberById(u)?.name), () => { const n = new Set(who); n.has(u) ? n.size > 1 && n.delete(u) : n.add(u); setWho(n); }))}</div>
      <p class="e-lbl">${t('x_method')}</p><div class="chips">${['cash', 'transfer', 'card'].map((k) => chip(method === k, t('pm_' + k), () => setMethod(method === k ? null : k)))}</div>
      <p class="e-lbl">${t('x_date')}</p><input class="e-input" type="date" value=${date} onInput=${(e) => setDate(e.currentTarget.value)} />
      <p class="e-lbl">${t('x_note')}</p><input class="e-input" value=${note} onInput=${(e) => setNote(e.currentTarget.value)} />
      <button class="e-row" disabled=${busy} onClick=${addReceipt}><${Icon} n=${receipt ? 'circle-check' : 'camera'} /><span>${receipt ? t('x_receipt') : t('x_receipt_add')}</span>${!receipt && html`<small>${t('pw_optional')}</small>`}</button>
    </div>
    <button class="btn accent block big" style="margin-top:14px" disabled=${busy} onClick=${save}>${t('x_save')}</button>
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}
export function ExpenseSheet({ id }) {
  const d = D();
  const e = (d.money?.expenses ?? []).find((x) => x.id === id);
  if (!e) return html`<p class="muted">—</p><button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
  const canDel = e.created_by === d.user.id || e.paid_by === d.user.id || d.me.role === 'owner';
  async function del() {
    try { await api('/app/api/expense-delete', { id }); hap.ok(); toast(t('x_deleted')); closeSheet(); load(d.search.id, { quiet: true }); }
    catch { toast(t('err_generic')); }
  }
  const rcpt = e.receipt ? `/app/kv/${encodeURIComponent(e.receipt)}?k=${encodeURIComponent(d.photo_token ?? '')}` : null;
  return html`<h2>${e.title}</h2>
    <div class="card grp">
      <div class="opt"><span class="grow muted">${t('x_amount', { cur: SYM[e.currency] ?? e.currency })}</span><b>${money(e.amount, e.currency, true)}</b></div>
      <div class="opt"><${Av} m=${memberById(e.paid_by)} size=${28} /><span class="grow">${t('x_paid', { name: firstName(memberById(e.paid_by)?.name) })}</span><span class="muted">${fmtDMY(e.date)}</span></div>
      <div class="opt"><span class="grow muted">${t('x_split')}</span><span>${splitLabel(e, d.money)}</span></div>
      ${e.note && html`<div class="opt"><span class="grow">${e.note}</span></div>`}
    </div>
    ${e.order_id && html`<${OrderReceiptOf} id=${e.order_id} />`}
    ${rcpt && html`<img class="x-receipt" src=${rcpt} alt=${t('x_receipt')} />`}
    ${canDel && html`<button class="btn danger block" onClick=${del}><${Icon} n="trash-2" cls="sm" />${t('x_delete')}</button>`}
    <button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
}
export function SharesSheet() {
  const d = D();
  const voters = d2voters();
  const [w, setW] = useState(() => Object.fromEntries(voters.map((u) => [u, d.money?.shares?.[u] ?? 1])));
  const sum = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  const step = (u, x) => { hap.sel(); setW({ ...w, [u]: Math.max(0, Math.min(10, Math.round(((w[u] ?? 0) + x) * 2) / 2)) }); };
  async function save() {
    try { const r = await api('/app/api/shares', { search_id: d.search.id, shares: w }); d.money = r.money; hap.ok(); toast(t('shares_saved')); closeSheet(); emit(); }
    catch { toast(t('err_generic')); }
  }
  return html`<h2>${t('shares')}</h2><p class="muted" style="margin:0 0 14px">${t('shares_text')}</p>
    <div class="card grp">${voters.map((u) => html`<div class="opt"><${Av} m=${memberById(u)} size=${36} /><span class="grow">${firstName(memberById(u)?.name)} <span class="muted">· ${Math.round(((w[u] ?? 0) / sum) * 100)}%</span></span>
      <button class="round sm soft" aria-label="−" onClick=${() => step(u, -0.5)}><${Icon} n="minus" cls="sm" /></button><b class="sh-n">${fmtNum(w[u] ?? 0)}</b>
      <button class="round sm soft" aria-label="+" onClick=${() => step(u, 0.5)}><${Icon} n="plus" cls="sm" /></button></div>`)}</div>
    <button class="btn accent block" disabled=${!Object.values(w).some((x) => x > 0)} onClick=${save}>${t('x_save')}</button>
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}
