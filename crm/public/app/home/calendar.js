// Split from app.js (wave 11): see the section comment below.
import { AfPlanCard } from '../afisha/afisha.js';
import { D, districtShort, memberById } from '../core/data.js';
import { dayKey, firstName, fmtDM, money } from '../core/format.js';
import { LANG, cap, t } from '../core/i18n.js';
import { go, sp } from '../core/routing.js';
import { areaName, areaOf, useAreasGeo } from '../places/districts.js';
import { Icon } from '../ui/icons.js';
import { Nav } from '../ui/pieces.js';
import { CAD } from './docs.js';
import { dealListing, rangeDM, regionPack } from './helpers.js';
import { hmName, hmStay, hmTerms, hmToday, homeListing } from './homemode.js';
import { html } from 'https://unpkg.com/htm@3.1.1/preact/standalone.module.js';

// ---------------------------------------------------------------- local calendar (37)
export const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export function calendarRows() {
  const d = D();
  const L = (o) => o?.[LANG] ?? o?.en ?? '';
  const today = dayKey(new Date().toISOString());
  const terms = d.deal?.data?.terms ?? {};
  const until = terms.to && terms.to > today ? addDays(terms.to, 14) : addDays(today, 200);
  const owner = (d.house_contacts ?? []).find((c) => c.role === 'owner' || c.role === 'manager');
  const on = owner ? firstName(owner.name) : null;
  const rows = [];
  const moveOut = d.moveout?.date ?? (d.dates ?? []).find((x) => x.kind === 'moveout')?.date ?? terms.to ?? null;
  if (terms.from) rows.push({ go: 'deal', date: terms.from, cls: 'acc', title: t('cl_movein'), sub: on ? t('cl_movein_sub', { o: on }) : t('cl_movein_sub0') });
  for (const x of d.dates ?? []) {
    if (x.done || x.kind === 'moveout' || (x.kind === 'deposit_return' && x.date === moveOut)) continue;
    rows.push({ go: x.kind === 'payment' ? 'deal' : 'docs', date: x.date, cls: x.kind === 'deposit_return' ? 'acc' : '', title: x.kind === 'payment' && x.amount != null ? `${cap(x.title.split(/[,(]/)[0].trim())} ${money(x.amount, x.currency)}` : x.title, sub: CAD[x.kind] ? t(CAD[x.kind]) : x.note });
  }
  if (moveOut) rows.push({ go: d.moveout ? 'moveout' : 'docs', k: 'moveout', date: moveOut, cls: 'acc', title: t('cl_moveout'), sub: on ? t('cl_moveout_sub', { o: on }) : t('cl_moveout_sub0') });
  for (const b of d.bikes ?? []) if (b.status !== 'returned' && b.paid_until && (!b.rider_id || b.rider_id === d.user.id)) rows.push({ go: 'bikes', date: b.paid_until, cls: '', title: t('cl_pay_bike', { m: b.model }), sub: b.rental_name });
  const myVisa = (d.visas ?? []).find((v) => v.user_id === d.user.id)?.visa_until;
  if (myVisa && (!terms.to || myVisa < terms.to)) {
    const lead = Number(regionPack()?.visa?.extend_lead_days) || 7;
    rows.push({ go: 'important', date: addDays(myVisa, -lead), cls: 'mango', title: t('cl_visa'), sub: t('cl_visa_sub', { d: fmtDM(myVisa) }) });
  }
  const cal = regionPack()?.calendar;
  const alts = [];
  for (const ev of cal?.events ?? []) {
    if (!ev.date || (ev.to ?? ev.date) < today || ev.date > until) continue;
    for (const r of ev.remind ?? []) { const dd = addDays(ev.date, -Number(r.days)); if (dd >= today) rows.push({ date: dd, by: true, cls: 'mango', title: L(r.title), sub: L(r.note) }); }
    rows.push({ date: ev.date, to: ev.to, cls: ev.impact === 'high' ? 'mango' : '', title: L(ev.title), sub: L(ev.note) });
    if (ev.alt) alts.push(L(ev.alt));
  }
  let season = null;
  for (const s0 of cal?.seasons ?? []) {
    const y = Number(today.slice(0, 4));
    const inSeason = (md) => (s0.from <= s0.to ? md >= s0.from && md <= s0.to : md >= s0.from || md <= s0.to);
    if (inSeason(today.slice(5))) season = `${L(s0.title)}. ${L(s0.note)}`;
    else for (const yy of [y, y + 1]) { const dd = `${yy}-${s0.from}`; if (dd > today && dd <= until) { rows.push({ date: dd, cls: '', title: L(s0.title), sub: L(s0.note) }); break; } }
  }
  return { rows: rows.filter((r) => r.date >= today || (r.to && r.to >= today)).sort((a, b) => a.date.localeCompare(b.date) || Number(!!b.by) - Number(!!a.by)), alts, season };
}
export function Calendar({ toViewings }) {
  const d = D();
  const { rows, alts, season } = calendarRows();
  const geo = useAreasGeo(d.search.country);
  const areas = regionPack()?.areas ?? {};
  const homeA = dealListing() && geo ? areaOf(dealListing(), geo, areas) : null;
  const rn = regionPack()?.name;
  const region = rn ? (LANG === 'ru' ? rn.ru : rn.en) : '';
  const aname = homeA ? areaName(areas[homeA]) : districtShort(dealListing());
  const loc = (s) => (LANG === 'ru' ? String(s).replace(/ан$/, 'ане').replace(/ну$/, 'ну').replace(/ак$/, 'аке').replace(/ур$/, 'уре').replace(/ад$/, 'аде') : s);
  return html`<main class="screen w2">
    <div class="head w3-head"><div><p class="kicker">${aname && d.deal ? t('cl_kicker_home', { r: region, a: loc(aname) }) : region}</p><h1 class="h1 w3-h1">${t('cl_title')}</h1></div>
      ${toViewings && html`<button class="sort-pill" onClick=${toViewings}><${Icon} n="eye" cls="sm" />${t('cl_viewings')}</button>`}</div>
    ${rows.length ? html`<div class="card w2-list">${rows.map((r, i) => html`<div key=${i} class="w2-row cl-row"><span class=${'cl-d ' + r.cls}>${r.by ? t('cl_by', { d: fmtDMshort(r.date) }) : fmtDMshort(r.date) + (r.to && r.to !== r.date ? '–' + fmtDMshort(r.to) : '')}</span>
        <div class="grow"><b>${r.title}</b>${r.sub && html`<span>${r.sub}</span>`}</div></div>`)}</div>`
      : html`<div class="card" style="padding:16px"><p class="muted" style="margin:0">${t('cl_none')}</p></div>`}
    ${season && html`<p class="w2-foot">${t('cl_now_season', { x: season })}</p>`}
    ${alts.map((a) => html`<p class="w2-foot">${a}. ${LANG === 'ru' ? 'Агент уточнит ближе к дате.' : 'The agent re-checks closer to the date.'}</p>`)}
    <${Nav} tab="plan" />
  </main>`;
}
/** "6.03" (no leading zero on the day). */
export const fmtDMshort = (dd) => `${Number(dd.slice(8, 10))}.${dd.slice(5, 7)}`;

// ---------------------------------------------------------------- wave 6 · D: home plan (one calendar list)
export function homePlanRows() {
  const d = D();
  const { rows, alts, season } = calendarRows();
  const today = hmToday();
  const me = d.user.id;
  const terms = hmTerms();
  const last = terms.length > 1 ? terms[terms.length - 1] : null;
  let out = rows;
  if (last) {
    // An extension: the first term's end is no longer the move-out; show the new terms instead.
    out = out.filter((r) => r.k !== 'moveout' || d.moveout?.date || r.date >= (last.to ?? ''));
    for (const x of terms.slice(1)) {
      if (x.from && x.from >= today) out.push({ go: 'path', date: x.from, cls: 'acc', title: t('hm_cl_term'), sub: x.landlord ?? null });
      if (x === last && x.to && x.to >= today && !d.moveout?.date && !out.some((r) => r.k === 'moveout')) out.push({ go: 'next', date: x.to, cls: 'acc', title: t('hm_cl_term_end'), sub: x.landlord ?? null });
    }
  }
  for (const b of d.bikes ?? []) if (b.status !== 'returned' && b.return_date && b.return_date >= today) out.push({ go: 'bikes', date: b.return_date, cls: '', title: t('hm_cl_bike_return', { m: b.model }), sub: b.rental_name });
  if (d.me.role === 'owner') {
    const stayTo = hmStay().to;
    const lead = Number(regionPack()?.visa?.extend_lead_days) || 7;
    for (const v of d.visas ?? []) {
      if (v.user_id === me || !memberById(v.user_id) || !v.visa_until || (stayTo && v.visa_until >= stayTo)) continue;
      const dd = addDays(v.visa_until, -lead);
      if (dd >= today) out.push({ go: 'important', date: dd, cls: 'mango', title: t('hm_cl_visa', { g: firstName(memberById(v.user_id).name) }), sub: t('hm_cl_visa_sub', { d: fmtDM(v.visa_until) }) });
    }
  }
  for (const g of (d.guests ?? []).filter((x) => x.status === 'active')) {
    if (g.from && g.from >= today) out.push({ go: 'guests', date: g.from, cls: '', title: t('hm_cl_guest_in', { g: firstName(g.name) }), sub: rangeDM(g.from, g.to) });
    if (g.to && g.to >= today) out.push({ go: 'guests', date: g.to, cls: '', title: t('hm_cl_guest_out', { g: firstName(g.name) }), sub: null });
  }
  out = out.filter((r) => r.date >= today || (r.to && r.to >= today)).sort((a, b) => a.date.localeCompare(b.date) || Number(!!b.by) - Number(!!a.by));
  return { rows: out, alts, season };
}
export function HomePlan() {
  const d = D();
  const { rows, alts, season } = homePlanRows();
  const rn = regionPack()?.name;
  const region = rn ? (LANG === 'ru' ? rn.ru : rn.en) : '';
  const l = homeListing();
  const dn = l ? districtShort(l) : '';
  const dateCell = (r) => html`<span class=${'cl-d ' + r.cls}>${r.by ? t('cl_by', { d: fmtDMshort(r.date) }) : fmtDMshort(r.date) + (r.to && r.to !== r.date ? '–' + fmtDMshort(r.to) : '')}</span>`;
  return html`<main class="screen w2">
    <div class="head w3-head"><div><p class="kicker">${[region, dn].filter(Boolean).join(' · ') || hmName()}</p><h1 class="h1 w3-h1">${t('cl_title')}</h1></div></div>
    <${AfPlanCard} />
    ${rows.length ? html`<div class="card w2-list">${rows.map((r, i) => r.go
        ? html`<button key=${i} class="w2-row cl-row hm-cl-go" onClick=${() => go(sp(r.go))}>${dateCell(r)}<div class="grow"><b>${r.title}</b>${r.sub && html`<span>${r.sub}</span>`}</div><${Icon} n="chev" cls="sm muted" /></button>`
        : html`<div key=${i} class="w2-row cl-row">${dateCell(r)}<div class="grow"><b>${r.title}</b>${r.sub && html`<span>${r.sub}</span>`}</div></div>`)}</div>`
      : html`<div class="card" style="padding:16px"><p class="muted" style="margin:0">${t('cl_none')}</p></div>`}
    ${season && html`<p class="w2-foot">${t('cl_now_season', { x: season })}</p>`}
    ${alts.map((a) => html`<p class="w2-foot">${a}. ${LANG === 'ru' ? 'Агент уточнит ближе к дате.' : 'The agent re-checks closer to the date.'}</p>`)}
    <${Nav} tab="plan" />
  </main>`;
}
