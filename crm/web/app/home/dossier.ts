import { api } from '../core/api.js';
import { D, canVoteRole, districtShort, listingById } from '../core/data.js';
import { dayKey, fmtDM, money, shortTitle } from '../core/format.js';
import { LANG, t } from '../core/i18n.js';
import { closeSheet, emit, hap, openSheet, toast } from '../core/store.js';
import { briefCur } from '../screens/deal.js';
import { ICONS, Icon } from '../ui/icons.js';
import { Nav } from '../ui/pieces.js';
import { W3Head, dealListing } from './helpers.js';
import { parseAmount } from './money.js';
import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';

// ---------------------------------------------------------------- house dossier (35)
export const DO_ICON = { issue: ['wrench', 'mango'], power: ['zap-off', 'mango'], cleaning: ['sparkles', 'jungle'], conflict: ['receipt-text', 'mango'], good: ['thumbs-up', 'jungle'], money: ['banknote', 'mango'], other: ['info', ''] };
export const dossierCache: Bag = {};
export function useDossier(lid) {
  const [v, setV] = useState(dossierCache[lid] ?? null);
  useEffect(() => {
    if (!lid) return;
    api('/app/api/dossier?listing_id=' + encodeURIComponent(lid)).then((j) => { dossierCache[lid] = j; setV(j); }).catch(() => setV({ dossiers: [] }));
  }, [lid]);
  return v;
}
export function Dossier({ id }) {
  const lid = id || dealListing()?.id;
  const l = listingById(lid);
  const v = useDossier(lid);
  const ds = v?.dossiers?.[0] ?? null;
  const st = ds?.stats ?? {};
  const items = ds ? (ds.items?.length ? ds.items : (ds.issues ?? []).map((i) => ({ id: i.id, kind: 'issue', title: i.title, text: [i.note, i.fixed_at ? fmtDM(i.fixed_at) : null].filter(Boolean).join(' · ') }))) : [];
  const issues = st.issues ?? ds?.issues?.length ?? null;
  return html`<main class="screen w2">
    <${W3Head} kicker=${[ds?.title ?? shortTitle(l?.title), ds?.area_text ?? districtShort(l)].filter(Boolean).join(' · ')} title=${t('do_title')} />
    ${v == null ? html`<div class="skeleton" style="height:200px"></div>` : !ds ? html`<div class="card" style="padding:16px"><p class="muted" style="margin:0">${t('do_none')}</p></div>` : html`
      <div class="w3-tiles do-tiles">
        <div class="card"><b>${st.months != null ? t('do_mo', { n: st.months }) : '—'}</b><span>${t('do_months')}</span></div>
        <div class="card"><b>${st.price != null ? money(st.price, st.currency) : '—'}</b><span>${st.price_note ?? t('do_price')}</span></div>
        <div class="card"><b>${issues ?? '—'}</b><span>${t('do_issues', { n: issues ?? 0 })}</span></div>
      </div>
      ${items.length > 0 && html`<div class="card w2-list"><div class="w2-lh"><span>${t('do_what')}</span></div>
        ${items.map((x) => { const [ic, cls] = DO_ICON[x.kind] ?? DO_ICON.other; return html`<div key=${x.id} class="w2-row"><${Icon} n=${ic} cls=${'do-ic ' + cls} /><div class="grow"><b>${x.title}</b>${x.text && html`<span>${x.text}</span>`}</div></div>`; })}</div>`}
      ${(ds.verdict_title || ds.verdict) && html`<div class="w2-note col"><b>${ds.verdict_title ? t('do_verdict', { x: ds.verdict_title }) : t('do_verdict', { x: '' })}</b>${ds.verdict && html`<span>${ds.verdict}</span>`}</div>`}`}
    <p class="w2-foot">${t('do_foot')}</p>
    <${Nav} tab="today" />
  </main>`;
}

// ---------------------------------------------------------------- things bought with the villa (36)
export function itemIcon(it) {
  if (it.icon && ICONS[it.icon]) return it.icon;
  const s = String(it.name).toLowerCase();
  return /доск|board|surf/.test(s) ? 'waves' : /блендер|blender|миксер/.test(s) ? 'blend' : /суш|бель|dryer|laundry/.test(s) ? 'shirt' : /комод|шкаф|полк|drawer|shelf|wardrobe/.test(s) ? 'archive'
    : /сетк|net|mosquito/.test(s) ? 'shield' : /вентил|fan/.test(s) ? 'fan' : /холод|fridge/.test(s) ? 'refrigerator' : /байк|bike/.test(s) ? 'bike' : /посуд|кастр|pan|pot|kitchen/.test(s) ? 'cooking-pot' : 'box';
}
export function Items() {
  const d = D();
  const iv = d.items ?? { items: [] };
  const items = iv.items ?? [];
  const cur = iv.currency ?? briefCur(d.search);
  const sellers: Bag = {};
  for (const i of items) if (i.seller) sellers[i.seller] = (sellers[i.seller] ?? 0) + 1;
  const top = Object.entries(sellers).sort((a, b) => +(b[1]) - +(a[1]))[0]?.[0];
  const terms = d.deal?.data?.terms ?? {};
  const moveOut = d.moveout?.date ?? terms.to ?? null;
  const canEdit = canVoteRole(d.me.role);
  const gen = (s) => (LANG === 'ru' ? String(s).replace(/ья$/, 'ьи').replace(/ия$/, 'ии').replace(/а$/, 'ы').replace(/я$/, 'и') : s);
  return html`<main class="screen w2">
    <${W3Head} kicker=${top ? t('it_kicker', { s: gen(top), n: t('it_kicker0', { n: items.length }) }) : t('it_kicker0', { n: items.length })} title=${items.length ? t('it_title', { x: money(iv.total, cur) }) : t('it_title0')} />
    <div class="card w2-list"><div class="w2-lh"><span>${t('it_ours')}</span>${canEdit && html`<button class="w2-add" onClick=${() => openSheet('item', 'new')}><${Icon} n="plus" cls="sm" />${t('it_add')}</button>`}</div>
      ${items.length ? items.map((it) => html`<button key=${it.id} class=${'w2-row w3-irow' + (it.status === 'sold' ? ' it-sold' : '')} onClick=${() => openSheet('item', it.id)}><span class="sq big"><${Icon} n=${itemIcon(it)} /></span>
        <div class="grow"><b>${it.name}</b><span>${[it.price != null ? money(it.price, it.currency ?? cur) : null, it.seller || it.bought_at ? t('it_at', { s: it.seller ? gen(it.seller) : '', d: it.bought_at ? fmtDM(it.bought_at) : '' }).replace(/\s+/g, ' ').trim() : null].filter(Boolean).join(' · ')}</span></div>
        ${it.status !== 'have' && html`<span class=${'st2 ' + (it.status === 'sold' ? 'ok' : 'wait')}>${t('it_' + it.status)}</span>`}</button>`)
      : html`<div class="w2-row"><span class="muted">${t('it_none')}</span></div>`}
    </div>
    ${items.some((i) => i.status !== 'sold') && html`<div class="card w3-text"><div class="w3-warn-h it-resale"><${Icon} n="recycle" /><b>${t('it_resale_t')}</b></div>
      <p>${moveOut ? t('it_resale', { d: fmtDM(moveOut), x: money(iv.resale_target, cur) }) : t('it_resale_nodate', { x: money(iv.resale_target, cur) })}</p></div>`}
    <${Nav} tab="today" />
  </main>`;
}
export function ItemSheet({ id }) {
  const d = D();
  const it = (d.items?.items ?? []).find((x) => x.id === id) ?? null;
  const [f, setF] = useState(() => ({ name: it?.name ?? '', price: it?.price != null ? String(it.price) : '', seller: it?.seller ?? '', bought_at: it?.bought_at ?? dayKey(new Date().toISOString()) }));
  const [sold, setSold] = useState(it?.sold_price != null ? String(it.sold_price) : '');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.currentTarget.value });
  const cur = d.items?.currency ?? briefCur(d.search);
  async function save(extra = {}) {
    setBusy(true);
    try { const r = await api('/app/api/item', { search_id: d.search.id, id: it?.id ?? 'new', ...f, price: parseAmount(f.price), currency: cur, ...extra }); D().items = r.items; hap.ok(); toast(t('it_saved')); closeSheet(); emit(); }
    catch { toast(t('err_generic')); }
    setBusy(false);
  }
  async function del() {
    setBusy(true);
    try { const r = await api('/app/api/item-delete', { id: it.id }); D().items = r.items; hap.ok(); closeSheet(); emit(); } catch { toast(t('err_generic')); }
    setBusy(false);
  }
  return html`<h2>${it ? it.name : t('it_new')}</h2>
    <div class="x-form">
      <p class="e-lbl">${t('pl_name')}</p><input class="e-input" value=${f.name} placeholder=${t('it_name_ph')} onInput=${set('name')} />
      <p class="e-lbl">${t('it_price')}</p><input class="e-input" inputmode="decimal" value=${f.price} placeholder="300 000" onInput=${set('price')} />
      <p class="e-lbl">${t('it_seller')}</p><input class="e-input" value=${f.seller} placeholder=${t('it_seller_ph')} onInput=${set('seller')} />
      <p class="e-lbl">${t('it_date')}</p><input class="e-input" type="date" value=${f.bought_at} onInput=${set('bought_at')} />
      ${it && html`<p class="e-lbl">${t('it_sold_price')}</p><input class="e-input" inputmode="decimal" value=${sold} onInput=${(e) => setSold(e.currentTarget.value)} />`}
    </div>
    <button class="btn accent block" style="margin-top:14px" disabled=${busy || !f.name.trim()} onClick=${() => save()}>${t('x_save')}</button>
    ${it && it.status !== 'sold' && html`<button class="btn surface block" style="margin-top:8px" disabled=${busy} onClick=${() => save({ status: 'sold', sold_price: parseAmount(sold) })}><${Icon} n="check" cls="sm" />${t('it_mark_sold')}</button>`}
    ${it && it.status === 'sold' && html`<button class="btn surface block" style="margin-top:8px" disabled=${busy} onClick=${() => save({ status: 'have' })}>${t('it_unsold')}</button>`}
    ${it && html`<button class="btn ghost block" disabled=${busy} onClick=${del}><${Icon} n="trash-2" cls="sm" />${t('it_delete')}</button>`}
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}
