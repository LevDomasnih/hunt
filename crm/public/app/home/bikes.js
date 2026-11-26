// Split from app.js (wave 11): see the section comment below.
import { api } from '../core/api.js';
import { D, canVoteRole, districtShort, memberById } from '../core/data.js';
import { dayKey, fmtDM, money } from '../core/format.js';
import { LANG, t } from '../core/i18n.js';
import { openLink } from '../core/routing.js';
import { closeSheet, emit, hap, openSheet, toast } from '../core/store.js';
import { channelLink } from '../screens/chats.js';
import { briefCur } from '../screens/deal.js';
import { Av, Icon } from '../ui/icons.js';
import { Nav } from '../ui/pieces.js';
import { RoundBtn, W3Head, dealListing, homeName, meOrName, telLink } from './helpers.js';
import { parseAmount } from './money.js';
import { html, useState } from 'https://unpkg.com/htm@3.1.1/preact/standalone.module.js';

// ---------------------------------------------------------------- bikes (33)
export const BK_CHECK = [['video', 'camera'], ['helmets', 'helmet'], ['stnk', 'file-text'], ['fuel', 'fuel']];
export const origPassport = (s) => !!s && /паспорт|passport|paspor/i.test(s) && !/коп|copy|scan|скан|salinan|fotokop/i.test(s);
export function bikeStatus(b) {
  if (b.status === 'returned') return html`<span class="st2">${t('bk_returned')}</span>`;
  if (!b.paid_until) return null;
  const left = Math.round((Date.parse(b.paid_until + 'T00:00:00Z') - Date.parse(dayKey(new Date().toISOString()) + 'T00:00:00Z')) / 864e5);
  if (left < 0) return html`<span class="st2 bad">${t('bk_late')}</span>`;
  if (left === 0) return html`<span class="st2 wait">${t('bk_today')}</span>`;
  if (left <= 3) return html`<span class="st2 wait">${t('bk_in', { n: left })}</span>`;
  return html`<span class="st2 ok">${t('bk_ok')}</span>`;
}
export const perMonth = (b) => (b.price == null ? 0 : b.period === 'week' ? Math.round(b.price * 4.35) : b.period === 'day' ? b.price * 30 : b.price);
export function Bikes() {
  const d = D();
  const bikes = d.bikes ?? [];
  const active = bikes.filter((b) => b.status !== 'returned');
  const cur = active[0]?.currency ?? briefCur(d.search);
  const sum = active.reduce((a, b) => a + perMonth(b), 0);
  const canEdit = canVoteRole(d.me.role);
  const ckBike = active.find((b) => BK_CHECK.some(([k]) => !b.checklist?.[k]?.done)) ?? active[0];
  const kick = [districtShort(dealListing()) || homeName(), active.length ? t('bk_n', { n: active.length }) : null, sum ? t('bk_per', { x: money(sum, cur) }) : null].filter(Boolean).join(' · ');
  const tick = async (b, k) => {
    const done = !b.checklist?.[k]?.done;
    b.checklist = { ...(b.checklist ?? {}), [k]: { ...(b.checklist?.[k] ?? {}), done } };
    emit(); hap.sel();
    try { await api('/app/api/bike-check', { id: b.id, key: k, done }); } catch { toast(t('err_generic')); }
  };
  return html`<main class="screen w2">
    <${W3Head} kicker=${kick} title=${t('bk_title')} right=${canEdit && html`<button class="w3-plus" aria-label=${t('bk_add')} onClick=${() => openSheet('bike', 'new')}><${Icon} n="plus" cls="lg" /></button>`} />
    ${bikes.some((b) => b.status !== 'returned' && origPassport(b.deposit)) && html`<div class="w3-warn"><div class="w3-warn-h"><${Icon} n="shield-alert" /><b>${t('bk_passport')}</b></div></div>`}
    ${bikes.length ? bikes.map((b) => {
      const rider = b.rider_id ? memberById(b.rider_id) : null;
      const wl = b.channel === 'whatsapp' || b.channel === 'telegram' ? channelLink(b.channel, b.address) : null;
      const ph = b.phone || (b.channel === 'phone' ? b.address : null);
      return html`<div key=${b.id} class=${'card bk-card' + (b.status === 'returned' ? ' off' : '')} role="button" tabindex="0" onClick=${() => openSheet('bike', b.id)}>
        <div class="bk-hd"><span class="sq big"><${Icon} n="bike" /></span><div class="grow"><b class="bk-model">${b.model}</b>
          <div class="bk-meta">${b.plate && html`<span class="bk-plate">${b.plate}</span>`}${rider ? html`<${Av} m=${rider} size=${24} /><span>${meOrName(rider.user_id)}</span>` : html`<span>${t('bk_shared')}</span>`}</div></div>${bikeStatus(b)}</div>
        <div class="bk-tiles"><div><b>${b.price != null ? money(b.price, b.currency) + (b.period === 'month' ? (LANG === 'ru' ? '/мес' : '/mo') : b.period === 'week' ? (LANG === 'ru' ? '/нед' : '/wk') : (LANG === 'ru' ? '/день' : '/day')) : '—'}</b><span>${t('bk_price')}</span></div>
          <div><b>${b.paid_until ? t('bk_until', { d: fmtDM(b.paid_until) }) : '—'}</b><span>${t('bk_paid')}</span></div></div>
        ${(b.rental_name || b.deposit || wl || ph) && html`<div class="bk-rent"><div class="grow"><b>${b.rental_name ?? ''}</b>${b.deposit && html`<span class=${origPassport(b.deposit) ? 'pl-over' : ''}>${b.deposit}</span>`}</div>
          <div class="dr-btns">${wl && html`<span class="dr-w" role="button" tabindex="0" onClick=${(e) => { e.stopPropagation(); openLink(wl); }}><${Icon} n="message-circle" />${b.channel === 'whatsapp' ? 'WA' : 'TG'}</span>`}
            ${ph && html`<${RoundBtn} ic="phone" label=${t('dr_call')} onClick=${() => openLink(telLink(ph))} />`}</div></div>`}
      </div>`;
    }) : html`<div class="card" style="padding:16px;margin-bottom:14px"><p class="muted" style="margin:0">${t('bk_none')}</p></div>`}
    ${ckBike && html`<div class="card w2-list"><div class="w2-lh"><span>${t('bk_pickup')}${active.length > 1 ? ' · ' + ckBike.model : ''}</span></div>
      ${BK_CHECK.map(([k, ic]) => html`<button class="w2-row w3-irow bk-ck" disabled=${!canEdit} onClick=${() => tick(ckBike, k)}><${Icon} n=${ic} cls="os-ic" /><div class="grow"><b style="font-weight:500">${t('bk_' + k)}${k === 'helmets' && ckBike.checklist?.helmets?.note ? ` — ${ckBike.checklist.helmets.note}` : ''}</b></div>
        <${Icon} n=${ckBike.checklist?.[k]?.done ? 'circle-check' : 'circle-dashed'} cls=${ckBike.checklist?.[k]?.done ? 'pl-ic-ok' : 'muted'} /></button>`)}</div>`}
    <p class="w2-foot">${t('bk_foot')}</p>
    <${Nav} tab="today" />
  </main>`;
}
export function BikeSheet({ id }) {
  const d = D();
  const b0 = (d.bikes ?? []).find((x) => x.id === id) ?? null;
  const [f, setF] = useState(() => ({ model: b0?.model ?? '', plate: b0?.plate ?? '', rider_id: b0 ? b0.rider_id : d.user.id, price: b0?.price != null ? String(b0.price) : '', period: b0?.period ?? 'month',
    paid_until: b0?.paid_until ?? '', deposit: b0?.deposit ?? '', rental_name: b0?.rental_name ?? '', address: b0?.address ?? '', return_date: b0?.return_date ?? '' }));
  const [pay, setPay] = useState(false);
  const [amount, setAmount] = useState(b0?.price != null ? String(b0.price) : '');
  const [until, setUntil] = useState(() => (b0?.paid_until ? new Date(Date.parse(b0.paid_until + 'T00:00:00Z') + (b0.period === 'week' ? 7 : b0.period === 'day' ? 1 : 30) * 864e5).toISOString().slice(0, 10) : ''));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.currentTarget.value });
  const cur = b0?.currency ?? briefCur(d.search);
  async function save(extra = {}) {
    setBusy(true);
    try {
      const r = await api('/app/api/bike', { search_id: d.search.id, id: b0?.id ?? 'new', ...f, price: parseAmount(f.price), currency: cur, channel: f.address ? (f.address.trim().startsWith('@') ? 'telegram' : 'whatsapp') : null, ...extra });
      d.bikes = [...(d.bikes ?? []).filter((x) => x.id !== r.bike.id), r.bike];
      hap.ok(); toast(r.warning === 'original_passport' ? t('bk_passport') : t('bk_saved')); closeSheet(); emit();
    } catch { toast(t('err_generic')); }
    setBusy(false);
  }
  async function doPay() {
    setBusy(true);
    try {
      const r = await api('/app/api/bike-pay', { id: b0.id, amount: parseAmount(amount), until });
      d.bikes = (d.bikes ?? []).map((x) => (x.id === b0.id ? r.bike : x));
      if (r.money) d.money = r.money;
      hap.ok(); toast(t('bk_paid_ok')); closeSheet(); emit();
    } catch { toast(t('err_generic')); }
    setBusy(false);
  }
  const chip = (on, label, fn) => html`<button class=${'bchip' + (on ? ' on' : ' off')} aria-pressed=${on ? 'true' : 'false'} onClick=${() => { hap.sel(); fn(); }}>${label}</button>`;
  if (pay && b0) return html`<h2>${t('bk_pay_t')}</h2><p class="muted" style="margin:0 0 12px">${b0.model}${b0.plate ? ' · ' + b0.plate : ''}</p>
    <div class="x-form"><p class="e-lbl">${t('bk_pay_sum')}</p><input class="e-input" inputmode="decimal" value=${amount} onInput=${(e) => setAmount(e.currentTarget.value)} />
      <p class="e-lbl">${t('bk_pay_until')}</p><input class="e-input" type="date" value=${until} onInput=${(e) => setUntil(e.currentTarget.value)} /></div>
    <button class="btn accent block" style="margin-top:14px" disabled=${busy || !parseAmount(amount) || !until} onClick=${doPay}><${Icon} n="check" cls="sm" />${t('bk_pay')}</button>
    <button class="btn ghost block" onClick=${() => setPay(false)}>${t('cancel')}</button>`;
  return html`<h2>${b0 ? b0.model : t('bk_add')}</h2>
    <div class="x-form">
      <p class="e-lbl">${t('bk_model')}</p><input class="e-input" value=${f.model} placeholder=${t('bk_model_ph')} onInput=${set('model')} />
      <p class="e-lbl">${t('bk_plate')}</p><input class="e-input" value=${f.plate} placeholder=${t('bk_plate_ph')} onInput=${set('plate')} />
      <p class="e-lbl">${t('bk_rider')}</p><div class="chips">${d.members.filter((m) => canVoteRole(m.role)).map((m) => chip(f.rider_id === m.user_id, meOrName(m.user_id), () => setF({ ...f, rider_id: m.user_id })))}${chip(!f.rider_id, t('bk_shared'), () => setF({ ...f, rider_id: null }))}</div>
      <p class="e-lbl">${t('bk_price_l')}</p><div class="row" style="gap:8px"><input class="e-input grow" inputmode="decimal" value=${f.price} placeholder="1 400 000" onInput=${set('price')} /></div>
      <div class="chips" style="margin-top:8px">${['month', 'week', 'day'].map((k) => chip(f.period === k, t('bk_period_' + k), () => setF({ ...f, period: k })))}</div>
      <p class="e-lbl">${t('bk_paid_l')}</p><input class="e-input" type="date" value=${f.paid_until} onInput=${set('paid_until')} />
      <p class="e-lbl">${t('bk_deposit')}</p><input class="e-input" value=${f.deposit} placeholder=${t('bk_deposit_ph')} onInput=${set('deposit')} />
      ${origPassport(f.deposit) && html`<p class="pl-over" style="margin:6px 0 0;font-size:14px">${t('bk_passport')}</p>`}
      <p class="e-lbl">${t('bk_rental')}</p><input class="e-input" value=${f.rental_name} placeholder=${t('bk_rental_ph')} onInput=${set('rental_name')} />
      <p class="e-lbl">${t('bk_wa')}</p><input class="e-input" value=${f.address} placeholder="+62 812…" inputmode="tel" onInput=${set('address')} />
      <p class="e-lbl">${t('bk_return_date')}</p><input class="e-input" type="date" value=${f.return_date} onInput=${set('return_date')} />
    </div>
    <button class="btn accent block" style="margin-top:14px" disabled=${busy || !f.model.trim()} onClick=${() => save()}>${t('x_save')}</button>
    ${b0 && b0.status !== 'returned' && html`<button class="btn surface block" style="margin-top:8px" onClick=${() => setPay(true)}><${Icon} n="wallet" cls="sm" />${t('bk_pay')}</button>
      <button class="btn ghost block" disabled=${busy} onClick=${() => save({ status: 'returned' })}><${Icon} n="check" cls="sm" />${t('bk_return')}</button>`}
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}
