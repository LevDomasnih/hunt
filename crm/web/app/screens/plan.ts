import { D, defaultDay, districtName, listingById, photosOf, priceText, viewingsByDay } from '../core/data.js';
import { fmtTime, shortTitle, wdShort } from '../core/format.js';
import { t } from '../core/i18n.js';
import { go, openLink, sp } from '../core/routing.js';
import { S, hap, openSheet } from '../core/store.js';
import { Calendar } from '../home/calendar.js';
import { Icon, Img } from '../ui/icons.js';
import { Nav } from '../ui/pieces.js';
import { html } from 'htm/preact';
import { useState } from 'preact/hooks';

// ---------------------------------------------------------------- plan
export function usePlanDay() {
  const byDay = viewingsByDay();
  const days = [...byDay.keys()].sort();
  const [day, setDay] = useState(() => (S.planDay && days.includes(S.planDay) ? S.planDay : defaultDay(days)));
  const choose = (k) => { S.planDay = k; setDay(k); };
  return { byDay, days, day: days.includes(day) ? day : defaultDay(days), choose };
}
export const vStatus = (v) => (v.status === 'confirmed' && Date.parse(v.starts_at) < Date.now() - 3 * 3600e3 ? 'done' : v.status);
export function Plan() {
  const d = D();
  const { byDay, days, day, choose } = usePlanDay();
  const [mode, setMode0] = useState(planMode ?? (!days.length || d.deal || ['found', 'living'].includes(d.search.status) ? 'calendar' : 'viewings'));
  const setMode = (m) => { planMode = m; hap.sel(); setMode0(m); };
  if (mode === 'calendar') return html`<${Calendar} toViewings=${days.length ? () => setMode('viewings') : null} />`;
  const list = day ? byDay.get(day) ?? [] : [];
  const route = list.length ? d.routes?.[String(list[0].starts_at).slice(0, 10)] : null;
  const firstMap = list.find((v) => v.map_url)?.map_url;
  return html`<main class="screen">
    <div class="head"><div><h1 class="h1">${t('plan')}</h1></div><button class="sort-pill" onClick=${() => setMode('calendar')}><${Icon} n="cal" cls="sm" />${t('cl_open')}</button></div>
    ${!days.length ? html`<div class="card" style="padding:18px"><p class="muted" style="margin:0">${t('no_plan')}</p></div>` : html`
      <div class="days" role="toolbar">${days.map((k) => html`<button key=${k} class="day" aria-pressed=${k === day ? 'true' : 'false'} onClick=${() => { hap.sel(); choose(k); }}>
        <span>${wdShort(k)}</span><b>${Number(k.slice(8, 10))}</b></button>`)}</div>
      <div class="stack">${list.map((v) => {
        const l = listingById(v.listing_id) ?? v;
        const st = vStatus(v);
        const sub = [districtName(l), l.bedrooms != null ? t('br', { n: l.bedrooms }) : null, priceText(l), v.meet_note].filter(Boolean).join(' · ');
        return html`<button key=${v.id} class="card v-card" onClick=${() => go(sp('listing', v.listing_id))}>
          <${Img} src=${photosOf(l)[0] ?? photosOf(v)[0]} />
          <div class="grow"><div class="tm"><b>${fmtTime(v.starts_at)}</b><span class=${'st s-' + st}><span class="dot"></span>${t('s_' + st)}</span></div>
          <div class="nm">${shortTitle(l.title)}</div><div class="sub">${sub}</div></div></button>`;
      })}</div>
      ${!list.length && html`<p class="empty-note">${t('plan_empty')}</p>`}
      <div class="plan-actions">
        <button class="btn accent" disabled=${!route && !firstMap} onClick=${() => openLink(route ?? firstMap)}><${Icon} n="nav" />${t('route_day')}</button>
        <button class="btn surface" onClick=${() => openSheet('late', { day })}><${Icon} n="hourglass" />${t('late')}</button>
      </div>`}
    <${Nav} tab="plan" />
  </main>`;
}
export let planMode = null;
