import { canAccess } from '../../access.js';
import { agentOn, agentSub } from '../../agent.js';
import { AF, afHM, afPlace, afTitle, afWhy } from '../afisha/afisha.js';
import { EveningHero, eveningOn, ptDay, ptHM, useEvening } from '../afisha/parties.js';
import { api, cssVar, themePref } from '../core/api.js';
import { D, agentAwayHours, canVoteRole, districtShort, homeMode, listingById, photoUrl, photosOf, sceneStyle } from '../core/data.js';
import { asDate, dayKey, firstName, fmtDM, fmtDayMonth, km, money, wdShort, whenLabel } from '../core/format.js';
import { LANG, cap, t } from '../core/i18n.js';
import { go, sp } from '../core/routing.js';
import { S, emit, hap, openSheet, toast } from '../core/store.js';
import { OR, OrderHome } from '../orders/orders.js';
import { allPlaces, groupOfType, locStale, modeWord, placeEmoji, scoreCls, topPoint, useBasePlaces, useLocation } from '../places/places.js';
import { briefCur, toggleCheck } from '../screens/deal.js';
import { ListingCard, likedList } from '../screens/listings.js';
import { loadML, mapStyle, useThemeKey } from '../screens/map.js';
import { ICONS, Icon, Img } from '../ui/icons.js';
import { AniStickers, BigWord, FloatPhoto, Nav, StageBar, Sticker, Typed, WaterCard, localHour } from '../ui/pieces.js';
import { addDays } from './calendar.js';
import { GuestDrafts } from './guests.js';
import { W3Head, dealListing, hm, homeName, inPlace, isLiving, rangeDM } from './helpers.js';
import { agoRel } from './house.js';
import { nxWeeks } from './moveout.js';
import { DG_ICON, dgName, dirEntries } from './people.js';
import { briefMentionsSurf, sfH, surfBest, surfLine, surfWind, useSurf } from './surf.js';
import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';

// ---------------------------------------------------------------- wave 6 · D: home mode (46 before move-in, 46b living, 46c "Ещё")
Object.assign(ICONS, {
  'layout-grid': '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  'book-open': '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
});
export const HM_IDX = { start: 1, search: 2, viewings: 3, choice: 4, deal: 5, movein: 6, living: 7, extension: 7, next: 8, relet: 9, moveout: 9, closed: 9 };
export const HM_BEFORE = ['choice', 'deal', 'movein'];
/** Home mode: the project has a chosen home (path.home_listing_id; before the pipeline lands: a deal). Guests keep their own app. */
export { homeMode } from '../core/data.js';
export const hmToday = () => dayKey(new Date().toISOString());
export const hmDays = (day) => (day ? Math.round((Date.parse(String(day).slice(0, 10) + 'T00:00:00Z') - Date.parse(hmToday() + 'T00:00:00Z')) / 864e5) : null);
export const hmRow = (key) => (D()?.path?.rows ?? []).find((r) => r.key === key) ?? null;
/** Deal facts for the badges: lease signed, payments before move-in done (path.rows deal.facts; else documents + deal dates). */
export function hmDealFacts() {
  const d = D();
  const f = hmRow('deal')?.facts;
  if (f) return { signed: !!f.signed_at, paid: Number(f.paid) > 0 && !(Number(f.pending) > 0) };
  const from = d.deal?.data?.terms?.from;
  const pays = (d.dates ?? []).filter((x) => x.kind === 'payment' && (!from || x.date <= from));
  return { signed: (d.documents ?? []).some((x) => x.kind === 'lease' && x.signed_at), paid: pays.length > 0 && pays.every((x) => x.done) };
}
/** {key, idx, n, closed}: path (A) when present, else a rough guess from the search status and the deal. */
export function homeStage() {
  const d = D();
  const p = d.path;
  if (p?.key) return { key: p.key, idx: p.idx ?? HM_IDX[p.key] ?? 1, n: p.n ?? 9, closed: !!p.closed || p.key === 'closed' };
  if (d.search.status === 'closed') return { key: 'closed', idx: 9, n: 9, closed: true };
  if (isLiving()) return { key: 'living', idx: 7, n: 9, closed: false };
  const k = hmDealFacts().signed ? 'movein' : 'deal';
  return { key: k, idx: HM_IDX[k], n: 9, closed: false };
}
/** 'before' (choice/deal/movein) | 'living' (living/extension/next/relet/moveout) | 'closed'. */
export function homePhase() {
  const st = homeStage();
  return st.closed ? 'closed' : HM_BEFORE.includes(st.key) ? 'before' : 'living';
}
export const homeListing = () => listingById(D()?.path?.home_listing_id) ?? dealListing();
export const hmTerms = () => D()?.path?.terms ?? [];
export const hmCurTerm = () => hmTerms().find((x) => x.current) ?? null;
/** The whole stay: first move-in → end of the current term (path living facts / terms; else the deal's first term). */
export function hmStay() {
  const tm = D()?.deal?.data?.terms ?? {};
  const lv = hmRow('living')?.facts;
  const ct = hmCurTerm();
  const from = lv?.from ?? hmTerms()[0]?.from ?? tm.from ?? null;
  const to = ct?.to ?? lv?.to ?? tm.to ?? null;
  return { from, to };
}
export const hmMoveIn = () => hmRow('movein')?.facts?.date ?? hmRow('movein')?.date ?? D()?.deal?.data?.terms?.from ?? null;
/** "3 спальни в Унгасане" / "3 bedrooms in Ungasan"; falls back to the home name. */
export function homeDesc(l) {
  const dn = l ? districtShort(l) : '';
  if (l?.bedrooms == null) return dn ? cap(inPlace(dn)) : '';
  return [t('bedrooms', { n: l.bedrooms }), dn ? inPlace(dn) : null].filter(Boolean).join(' ');
}
/** Home name for home-mode titles (wave 8.1: the short name, see homeName). */
export const hmName = () => homeName();
/** Evening Home (V4-6): living in the home, 18:00–04:00 local. */
export function nightMode() {
  if (themePref() === 'light') return false;
  if (!homeMode() || homePhase() !== 'living') return false;
  const h = localHour();
  return h >= 18 || h < 4;
}
/** Home Plan data (bookings + today's top event), shared by the day and the evening Home. */
export function useEventPlan() {
  const d = D();
  const [v, setV] = useState(null);
  useEffect(() => {
    let live = true;
    api('/app/api/event-plan?s=' + encodeURIComponent(d.search.id)).then((j) => live && setV(j)).catch(() => live && setV({ failed: true }));
    return () => { live = false; };
  }, [d.search.id, AF.rev]);
  return v;
}
/** Wave 8.1: today's top event as a small ticket on Home ("Сегодня вечером"), linking to the event and the Афиша. */
export function TonightTicket({ ev, total }) {
  if (!ev) return null;
  const d = D();
  const evening = Number(String(ev.starts_at ?? '').slice(11, 13)) >= 17;
  const meta = [afHM(ev), afPlace(ev), ev.minutes != null ? t('em_min', { n: ev.minutes }) : null].filter(Boolean).join(' · ');
  const more = Math.max(0, (total ?? 0) - 1);
  return html`<div class="hm81-tk">
    <button class="hm81-tk-main" onClick=${() => { hap.sel(); go(sp('event', ev.key)); }}>
      <span class="frame hm81-tk-ph"><span class="in">${photoUrl(ev.photo) ? html`<img src=${photoUrl(ev.photo)} alt="" decoding="async" />` : html`<span class="scene solid" style=${sceneStyle(d.search.country)}></span>`}</span></span>
      <span class="grow hm81-tk-t"><small>${evening ? t('w81_tonight') : cap(t('pp_today'))}</small><b>${afTitle(ev)}</b><span>${meta}</span></span>
    </button>
    <button class="hm81-tk-all" onClick=${() => { hap.sel(); go(sp('afisha')); }}>${more ? t('w81_tonight_n', { n: more }) : t('af_title')}<${Icon} n="arrow-up-right" cls="sm" /></button>
  </div>`;
}
export function HomeHero({ sv = null }) {
  const d = D();
  const l = homeListing();
  const ph = photosOf(l)[0];
  const phase = homePhase();
  const ep = useEventPlan();
  const name = hmName();
  let over = name, title = name, sub;
  if (phase === 'before') {
    const mi = hmMoveIn();
    const n = hmDays(mi);
    title = mi == null ? t('hm_movein_none') : n < 0 ? t('hm_moved_in', { d: fmtDayMonth(mi) }) : n === 0 ? t('hm_movein_today') : n === 1 ? t('hm_movein_tomorrow')
      : n < 7 ? t('hm_movein_wd', { wd: t('hm_wd_acc', { n: asDate(mi).getUTCDay() }) }) : t('hm_movein_date', { d: fmtDayMonth(mi) });
    sub = [l?.bedrooms != null ? t('bedrooms', { n: l.bedrooms }) : null, n != null && n > 1 ? t('hm_in_days', { n }) : null].filter(Boolean).join(' · ');
  } else if (phase === 'living') {
    const { from, to } = hmStay();
    const lv = hmRow('living')?.facts;
    const total = lv?.days ?? (from && to ? Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 864e5) : null);
    const day = lv?.day ?? (from ? Math.max(1, 1 - hmDays(from)) : null);
    if (day != null && total) over = `${name} · ${t('w81_day', { d: Math.min(day, total), n: total })}`;
    const left = hmDays(to);
    const today = hmToday();
    sub = [`${wdShort(today)} ${fmtDayMonth(today)}`, left != null && left >= 0 ? t('hm_left_lease', { n: left }) : null].filter(Boolean).join(' · ');
  } else sub = t('hm_closed');
  // V4-1 / wave 8.1: the one statement types and cycles through 2–3 real facts: the title (move-in countdown / day), the next
  // payment, the surf (when there is a forecast), tonight's top event
  const today = hmToday();
  const pay = (d.dates ?? []).filter((x) => !x.done && x.kind === 'payment' && x.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const b = phase !== 'closed' ? surfBest(sv) : null;
  const surfLine = b && b.height != null ? (b.window?.to ? t('w8_surf_line', { h: sfH(b.height), t: hm(b.window.to) }) : `${t('sf_title')} ${sfH(b.height)}`) : null;
  const payLine = pay ? (pay.amount != null ? t('hm_pay', { x: money(pay.amount, pay.currency), w: t('hm_in_days', { n: hmDays(pay.date) }) }) : `${pay.title} ${t('hm_in_days', { n: hmDays(pay.date) })}`) : null;
  const top = phase !== 'closed' && ep && !ep.failed ? ep.top : null;
  const evLine = top ? t('w81_ev_line', { t: afTitle(top) }) : null;
  const ordA = (OR.sid === d.search.id ? OR.v?.active ?? [] : []).find((o) => o.status === 'confirmed' && o.time && (!o.day || o.day === today)); // wave 10
  const ordLine = ordA ? t('or_line_by', { s: ordA.supplier, t: hm(ordA.time) }) : null;
  const lines = (phase === 'living' ? [ordLine, surfLine, evLine, payLine] : [ordLine, title, payLine, surfLine, evLine]).filter(Boolean).slice(0, 3);
  if (!lines.length) lines.push(title);
  const open = (d.deal?.data?.checklist ?? []).filter((c) => !c.done).length;
  const st = homeStage();
  const pw = d.power?.days_left != null ? Math.max(0, Math.floor(d.power.days_left)) : null;
  const stats = [
    pay && { k: t('w8_k_pay'), v: t('hm_in_days', { n: hmDays(pay.date) }), go: 'deal' },
    pw != null && { k: t('w8_k_power'), v: t('w8_power_v', { n: pw }), go: 'power' },
    { k: t('w8_k_stage'), v: t('w8_stage_v', { i: Math.min(st.idx, st.n), n: st.n }), go: 'path' },
  ].filter(Boolean);
  const ms = d.members.slice(0, 2);
  return html`<section class="w8-hero hm8">
    <${BigWord} text=${t('w8_home')} />
    ${b && b.height != null && html`<${WaterCard} cls="water-dot hm8-surf" label=${t('sf_title')} onClick=${() => go(sp('surf'))}><b>${sfH(b.height)}</b><small>${b.window?.to ? t('w8_surf_dot', { t: hm(b.window.to) }) : b.name}</small><//>`}
    <div class="hm8-stage">
      <${FloatPhoto} src=${ph} cls="hm8-ph" label=${name} onClick=${() => l && go(sp('listing', l.id))} />
      <${AniStickers} ms=${ms} size=${58} pos=${['left:2%;top:-6%', 'right:2%;bottom:-12%']} />
    </div>
    <p class="kicker hm8-over">${over}</p>
    <${Typed} lines=${lines} />
    ${sub && html`<p class="w8-sub">${sub}</p>`}
    ${phase !== 'closed' && html`<${OrderHome} />`}
    <div class="w8-pills">
      ${phase === 'before' && d.deal && html`<button class="btn accent" onClick=${() => go(sp('deal'))}>${open ? t('w8_todo', { n: open }) : t('before_move')}</button>`}
      ${phase === 'living' && html`<button class="btn accent" onClick=${() => go(sp('afisha'))}>${t('w8_tonight_btn')}</button>`}
      ${surfLine ? html`<button class="btn surface" onClick=${() => go(sp('surf'))}>${t('sf_title')} ${sfH(b.height)}</button>`
        : html`<button class="btn surface" onClick=${() => go(sp('path'))}>${t('pp_title')}</button>`}
    </div>
    <div class="w8-stats">${stats.map((x) => html`<button key=${x.k} onClick=${() => go(sp(x.go))}><small>${x.k}</small><b>${x.v}</b></button>`)}</div>
    <${TonightTicket} ev=${top} total=${ep?.total} />
    <div class="hm81-links">
      <button class="hm81-link" onClick=${() => { hap.sel(); go(sp('map')); }}><${Icon} n="map" cls="sm" />${t('w81_map')}</button>
      <button class="hm81-link" onClick=${() => { hap.sel(); go(sp('plan')); }}><${Icon} n="calendar" cls="sm" />${t('w81_plan')}</button>
      ${phase !== 'closed' && canVoteRole(d.me.role) && html`<button class="hm81-link" onClick=${() => { hap.sel(); go(sp('party-edit', 'new')); }}><${Icon} n="party-popper" cls="sm" />${t('w9_party_link')}</button>`}
    </div>
  </section>`;
}
/** V4-6: the evening Home (living, 18:00–04:00) — night palette, "Ночь", tonight's event in a black frame. */
export function NightHero() {
  const d = D();
  const v = useEventPlan();
  const today = hmToday();
  const bk = (v?.bookings ?? []).find((x) => x.occ === today && x.status !== 'cancelled');
  const top = v?.top;
  const ev = bk ? { key: bk.event_id + '@' + bk.occ, title: bk.title, time: String(bk.starts_at ?? '').slice(11, 16), place: bk.place, photo: photoUrl(bk.photo), st: bk.status }
    : top ? { key: top.key, title: afTitle(top), time: afHM(top), place: afPlace(top), photo: photoUrl(top.photo), why: afWhy(top), mins: top.minutes } : null;
  const tmr = addDays(today, 1);
  const pay = (d.dates ?? []).filter((x) => !x.done && x.kind === 'payment' && x.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const lv = hmRow('living')?.facts;
  return html`<section class="w8-hero hm8 hm8-night">
    <${BigWord} text=${t('w8_night')} />
    ${ev ? html`<div class="hm8-stage">
        <button class="frame hm8-frame" aria-label=${ev.title} onClick=${() => go(sp('event', ev.key))}><span class="in">${ev.photo ? html`<img src=${ev.photo} alt="" decoding="async" />` : html`<span class="float-none" style=${sceneStyle(d.search.country)}></span>`}</span></button>
        ${ev.time && html`<${Sticker} text=${hm(ev.time)} cls="lime" style="right:4%;top:-8%;--r:-12deg" />`}
      </div>
      <${Typed} lines=${[ev.title]} />
      <p class="w8-sub">${[ev.place, ev.mins != null ? t('em_min', { n: ev.mins }) : null, ev.st ? t('af_st_' + ev.st) : ev.why].filter(Boolean).join(' · ')}</p>
      <div class="w8-pills"><button class="btn accent" onClick=${() => go(sp('event', ev.key))}>${ev.st ? t('af_st_' + ev.st) : t('w8_go_too')}</button>
        <button class="btn surface" onClick=${() => go(sp('afisha'))}>${t('w8_other')}</button></div>`
      : html`<div class="hm8-stage"><${FloatPhoto} src=${photosOf(homeListing())[0]} cls="hm8-ph" label=${hmName()} onClick=${() => homeListing() && go(sp('listing', homeListing().id))} /></div>
      <${Typed} lines=${[v && !v.failed ? t('w8_quiet_night') : hmName()]} />
      <div class="w8-pills"><button class="btn accent" onClick=${() => go(sp('afisha'))}>${t('w8_tonight_btn')}</button></div>`}
    <div class="w8-stats">
      <button onClick=${() => go(sp('plan'))}><small>${t('w8_k_tomorrow')}</small><b>${fmtDM(tmr)}</b></button>
      ${pay && html`<button onClick=${() => go(sp('deal'))}><small>${t('w8_k_pay')}</small><b>${t('hm_in_days', { n: hmDays(pay.date) })}</b></button>`}
      ${lv?.day && html`<button onClick=${() => go(sp('path'))}><small>${t('w8_k_home')}</small><b>${t('w8_day_n', { n: lv.day })}</b></button>`}
    </div>
  </section>`;
}
export function HomeStageCard() {
  const st = homeStage();
  const f = homePhase() === 'before' ? hmDealFacts() : null;
  return html`<button class="card hm-stage" onClick=${() => go(sp('path'))}>
    <span class="hm-stage-h"><span class="grow">${t('hm_stage_k', { i: Math.min(st.idx, st.n), n: st.n, k: t('hm_st_' + st.key) })}</span>
      ${f && html`<span class=${'chip ' + (f.signed ? 'jungle' : 'mango')}>${f.signed && html`<${Icon} n="check" cls="xs" />`}${t('hm_b_lease')}</span>
        <span class=${'chip ' + (f.paid ? 'jungle' : 'mango')}>${f.paid && html`<${Icon} n="check" cls="xs" />`}${t('hm_b_paid')}</span>`}</span>
    <${StageBar} idx=${st.idx} n=${st.n} closed=${st.closed} />
  </button>`;
}
/** Checklist toggle of an extension term (seq ≥ 2): optimistic, like toggleCheck. */
export async function toggleTermCheck(term, i) {
  const c = term?.checklist?.[i];
  if (!c) return;
  c.done = !c.done;
  hap.sel(); emit();
  try { await api('/app/api/term-check', { search_id: D().search.id, seq: term.seq, index: i, done: c.done }); }
  catch { c.done = !c.done; emit(); toast(t('err_generic')); }
}
export function HomeChecklist({ list, title, deal, term, ro }) {
  if (!list?.length) return null;
  const k = list.filter((c) => c.done).length;
  const can = !ro && (deal || term);
  return html`<div class="card w2-list hm-check"><div class="w2-lh"><span>${t(title, { k, n: list.length })}</span></div>
    <div class="checklist">${list.map((c, i) => html`<button key=${i} class=${'check' + (c.done ? ' done' : '')} role="checkbox" aria-checked=${c.done ? 'true' : 'false'}
      disabled=${!can} onClick=${() => (term ? toggleTermCheck(term, i) : deal && toggleCheck(deal, i))}><span class="box">${c.done && html`<${Icon} n="check" />`}</span><span>${c.text ?? c.label}</span></button>`)}</div></div>`;
}
export function HomeSurf({ v }) {
  const b = surfBest(v);
  if (!b || b.height == null) return null;
  const mw = modeWord();
  return html`<${WaterCard} cls="hm-surf" label=${t('sf_title')} onClick=${() => go(sp('surf'))}>
    <span class="hm-surf-k">${t('hm_surf_k')}</span>
    <b class="hm-surf-t">${b.window?.to ? t('hm_surf_t', { s: b.name, t: hm(b.window.to) }) : b.name}</b>
    <span class="hm-surf-s">${[sfH(b.height), surfWind(b.wind), b.minutes != null ? t('em_min', { n: b.minutes }) + (mw ? ' ' + mw : '') : null].filter(Boolean).join(' · ')}</span>
  <//>`;
}
/** The "Сегодня" rows (46b): only what the data has; each row opens its screen. */
export function homeTodayRows() {
  const d = D();
  const today = hmToday();
  const rows = [];
  const r = d.renewal;
  if (r && r.status === 'open') rows.push({ k: 'next', ic: 'calendar-clock', cls: 'mango', title: t('nx_card'), sub: nxWeeks(r), go: 'next' });
  const pay = (d.dates ?? []).filter((x) => !x.done && x.kind === 'payment' && x.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (pay) {
    const n = hmDays(pay.date);
    rows.push({ k: 'pay', ic: 'wallet', cls: n <= 3 ? 'mango' : '', title: pay.amount != null ? t('hm_pay', { x: money(pay.amount, pay.currency), w: t('hm_in_days', { n }) }) : `${pay.title} ${t('hm_in_days', { n })}`,
      sub: [fmtDM(pay.date), pay.amount != null ? pay.title : null].filter(Boolean).join(' · '), go: 'deal' });
  }
  for (const i of (d.issues ?? []).filter((x) => x.status !== 'fixed').slice(0, 2)) {
    rows.push({ k: 'is' + i.id, ic: 'wrench', cls: 'mango', title: i.title, sub: i.status === 'scheduled' && i.scheduled_at ? t('is_scheduled', { when: whenLabel(i.scheduled_at) }) : [t('is_open'), agoRel(i.updated_at)].filter(Boolean).join(' · '), go: 'home' });
  }
  const pw = d.power;
  if (pw?.days_left != null) {
    const n = Math.max(0, Math.floor(pw.days_left));
    rows.push({ k: 'pw', ic: 'zap', cls: n <= 5 ? 'mango' : '', title: t('hm_power', { n }), sub: pw.runout ? t('hm_power_sub', { d: fmtDM(new Date(Date.parse(pw.runout) - 864e5).toISOString()) }) : null, go: 'power' });
  }
  for (const b of (d.bikes ?? []).filter((x) => x.status !== 'returned' && x.paid_until && hmDays(x.paid_until) <= 5).slice(0, 2)) {
    const n = hmDays(b.paid_until);
    rows.push({ k: 'bk' + b.id, ic: 'bike', cls: 'mango', title: n < 0 ? t('hm_bike_late') : t('hm_bike', { w: t('hm_in_days', { n }) }), sub: [b.model, b.rental_name].filter(Boolean).join(' · '), go: 'bikes' });
  }
  for (const g of (d.guests ?? []).filter((x) => x.status === 'active')) {
    const n = hmDays(g.from);
    if (n > 7 || hmDays(g.to) < 0) continue;
    rows.push({ k: 'g' + g.user_id, ic: 'userplus', cls: '', title: n > 0 ? t('hm_guest_in', { g: firstName(g.name), w: t('hm_in_days', { n }) }) : t('hm_guest_here', { g: firstName(g.name), d: fmtDM(g.to) }), sub: rangeDM(g.from, g.to), go: 'guests' });
  }
  return rows;
}
export function HomeTodayList() {
  const rows = homeTodayRows();
  if (!rows.length) return null;
  return html`<div class="card w2-list hm-list"><div class="w2-lh"><span>${t('hm_today')}</span></div>
    ${rows.map((r) => html`<button key=${r.k} class="w2-row w3-irow" onClick=${() => go(sp(r.go))}><span class=${'sq big ' + r.cls}><${Icon} n=${r.ic} /></span>
      <div class="grow"><b>${r.title}</b>${r.sub && html`<span>${r.sub}</span>`}</div><${Icon} n="chev" cls="sm muted" /></button>`)}</div>`;
}
export function HomeActions() {
  const d = D();
  const phase = homePhase();
  const act = (k, ic, screen, sub = null) => html`<button key=${k} class="card hm-act" onClick=${() => go(sp(screen))}><span class="sq"><${Icon} n=${ic} /></span><b>${t('hm_q_' + k)}</b>${sub != null && html`<span>${sub}</span>`}</button>`;
  const cur = d.money?.currency ?? briefCur(d.search);
  const month = d.money?.totals?.this_month;
  const bikes = (d.bikes ?? []).filter((b) => b.status !== 'returned').length;
  const items = phase === 'before'
    ? [act('lease', 'file-text', 'deal'), act('money', 'wallet', 'money'), act('contacts', 'users', 'directory'), act('bikes', 'bike', 'bikes')]
    : [act('money', 'wallet', 'money', month ? money(month, cur) : null), act('contacts', 'users', 'directory'), act('bikes', 'bike', 'bikes', bikes ? String(bikes) : null),
      canVoteRole(d.me.role) && phase !== 'closed' ? act('guests', 'userplus', 'guests') : act('docs', 'file-text', 'docs')];
  return html`<div class="hm-acts">${items}</div>`;
}
export function HomeToday() {
  const d = D();
  const phase = homePhase();
  const live = phase === 'living';
  const sv = useSurf(d.search.id, phase !== 'closed' && (briefMentionsSurf() || !!d.me.surf));
  const ro = phase === 'closed' || !canVoteRole(d.me.role);
  const ct = hmCurTerm();
  const termList = live && ct && ct.seq > 1 && Array.isArray(ct.checklist) && ct.checklist.some((c) => !c.done) ? ct.checklist : null;
  const night = nightMode();
  const ev = useEvening(); // wave 9: tonight's event / party takes over the hero in the evening
  return html`<main class="screen hm-screen">
    ${phase !== 'closed' && eveningOn(ev) ? html`<${EveningHero} v=${ev} /><${OrderHome} />` : night ? html`<${NightHero} /><${OrderHome} />` : html`<${HomeHero} sv=${sv} />`}
    <${HomeStageCard} />
    <${GuestDrafts} />
    ${phase === 'before' && html`<${HomeChecklist} list=${d.deal?.data?.checklist} title="hm_checklist" deal=${d.deal} ro=${ro} />`}
    ${termList && html`<${HomeChecklist} list=${termList} title="hm_term_checklist" term=${ct} ro=${ro} />`}
    ${live && night && html`<${HomeSurf} v=${sv} />`}
    ${live && html`<${HomeTodayList} />`}
    <${HomeActions} />
    <${Nav} tab="today" />
  </main>`;
}

// ---------------------------------------------------------------- wave 6 · D: "Ещё" (46c) and the listings archive
export function MoreScreen() {
  const d = D();
  const st = homeStage();
  const row = (k, ic, title, sub, screen) => html`<button key=${k} class="w2-row w3-irow" onClick=${() => go(sp(screen))}><span class="sq big"><${Icon} n=${ic} /></span>
    <div class="grow"><b>${title}</b>${sub && html`<span>${sub}</span>`}</div><${Icon} n="chev" cls="sm muted" /></button>`;
  const card = (title, rows) => html`<div class="card w2-list hm-more"><div class="w2-lh"><span>${title}</span></div>${rows.filter(Boolean)}</div>`;
  const nDocs = (d.documents ?? []).length;
  const cur = d.money?.currency ?? briefCur(d.search);
  const month = d.money?.totals?.this_month;
  const today = hmToday();
  const all = dirEntries();
  const grps = [...new Set(all.map((e) => e.grp))].map((k) => dgName(k).toLowerCase());
  const bikes = (d.bikes ?? []).filter((b) => b.status !== 'returned');
  const nextPay = bikes.map((b) => b.paid_until).filter(Boolean).sort()[0];
  const nG = (d.guests ?? []).filter((g) => g.status === 'active').length;
  const iv = d.items ?? { items: [] };
  const mi = hmMoveIn();
  const hid = homeListing()?.id;
  const nArch = (d.listings ?? []).filter((l) => l.id !== hid).length;
  const openIssues = (d.issues ?? []).filter((i) => i.status !== 'fixed').length;
  const away = agentAwayHours();
  return html`<main class="screen w2 mo8">
    <div class="head"><div><h1 class="w8-title">${t('hm_more')}</h1></div></div>
    <div class="card w2-list hm-more mo81-top">
      ${row('map', 'map', t('w81_map'), t('w81_map_sub'), 'map')}
      ${row('plan', 'calendar', t('w81_plan'), t('w81_plan_sub'), 'plan')}
      ${row('orders', 'basket', t('or_title'), OR.v?.active.length ? t('or_more_active') : t('or_more_sub'), 'orders')}
    </div>
    ${card(t('hm_more_home'), [
      row('docs', 'file-text', t('hm_m_docs'), [nDocs ? t('hm_files', { n: nDocs }) : null, (d.dates ?? []).length ? t('hm_dates_word') : null].filter(Boolean).join(' · ') || null, 'docs'),
      row('contacts', 'users', t('hm_m_contacts'), grps.length ? grps.join(', ') : t('hm_m_contacts0'), 'directory'),
      row('bikes', 'bike', t('hm_m_bikes'), bikes.length ? (nextPay ? t('hm_m_bikes_sub', { n: bikes.length, d: fmtDM(nextPay) }) : String(bikes.length)) : t('hm_m_bikes0'), 'bikes'),
      d.deal && row('house', 'wrench', t('hm_m_house'), openIssues ? t('is_open').toLowerCase() + ` · ${openIssues}` : t('hm_m_house_sub'), 'home'),
    ])}
    ${card(t('hm_more_life'), [
      canVoteRole(d.me.role) && row('guests', 'userplus', t('hm_m_guests'), nG ? t('gi_row_sub', { n: nG }) : t('hm_m_guests_sub'), 'guests'),
      row('items', 'box', t('hm_m_items'), iv.items?.length ? `${iv.items.length} · ${money(iv.total, iv.currency ?? cur)}` : t('hm_m_items0'), 'items'),
      row('act', 'rotate-3d', t('hm_m_act'), mi ? t('hm_m_act_sub', { d: fmtDM(mi) }) : t('hm_m_act0'), 'act'),
      row('useful', 'book-open', t('hm_m_useful'), t('hm_m_useful_sub'), 'useful'),
      d.renewal && row('next', 'calendar-clock', t('hm_m_next'), d.renewal.status === 'open' ? nxWeeks(d.renewal) : t('hm_m_next_sub'), 'next'),
    ])}
    ${card(t('hm_more_search'), [
      html`<button key="agent" class="w2-row w3-irow mo-agent" onClick=${() => go(sp('agent'))}><span class=${'sq big ink' + (agentOn() ? ' on' : '')}><${Icon} n="plug" /></span>
        <div class="grow"><b>${LANG === 'ru' ? 'Подключить агента' : 'Connect the agent'}</b><span>${agentSub()}</span></div><${Icon} n="chev" cls="sm muted" /></button>`,
      canAccess() && row('access', 'shield-check', LANG === 'ru' ? 'Доступ к чатам' : 'Access to chats', LANG === 'ru' ? 'Что видит Hunt, отозвать всё' : 'What Hunt sees, take it back', 'access'),
      row('archive', 'layers', t('hm_m_archive'), t('hm_m_archive_sub', { n: nArch }), 'archive'),
      row('path', 'route', t('hm_m_path'), t('hm_m_path_sub', { i: Math.min(st.idx, st.n), n: st.n }), 'path'),
    ])}
    ${away > 0 && html`<p class="w81-away"><${Icon} n="eyeoff" cls="xs" />${t('w81_offline', { n: away })}</p>`}
    <${Nav} tab="more" />
  </main>`;
}
/** Read-only archive of the search's listings once a home is chosen (voting is off in home mode). */
export function Archive() {
  const d = D();
  const hid = homeListing()?.id;
  const liked = likedList(d).filter((l) => l.id !== hid);
  const seen = new Set(liked.map((l) => l.id));
  const list = [...liked, ...d.listings.filter((l) => l.id !== hid && !seen.has(l.id))];
  return html`<main class="screen w2">
    <${W3Head} kicker=${hmName()} title=${t('hm_m_archive')} />
    <p class="w2-foot hm-arch-note">${t('hm_arch_note')}</p>
    ${list.length ? html`<div class="stack">${list.map((l) => html`<${ListingCard} key=${l.id} l=${l} />`)}</div>` : html`<p class="empty-note">—</p>`}
    <${Nav} tab="more" />
  </main>`;
}

// ---------------------------------------------------------------- wave 6 · D: home-centred map
export let hmLayers = null;
export function HomeMap({ arg }) {
  const d = D();
  const l = homeListing();
  if (!l || l.lat == null || l.lng == null) return html`<main class="screen"><div class="center-msg">${t('hm_map_none')}</div><${Nav} tab="map" /></main>`;
  return html`<${HomeMapInner} l=${l} evening=${arg === 'evening'} />`;
}
/** Wave 9 · map "Вечер": tonight's events (from 16:00, not over) around the home, the district filter of Афиша, and today's party. */
export function useEveningPins(on) {
  const d = D();
  const [v, setV] = useState(null);
  useEffect(() => {
    if (!on) return undefined;
    let live = true;
    const q = new URLSearchParams({ s: d.search.id, tab: 'all', day: hmToday() });
    if (AF.d.length) q.set('d', AF.d.join(','));
    Promise.all([api('/app/api/afisha?' + q).catch(() => null), api('/app/api/parties?s=' + encodeURIComponent(d.search.id)).catch(() => null)]).then(([f, pp]) => {
      if (!live) return;
      const all = f && !f.failed ? [...f.top, ...f.items] : [];
      const evs = all.filter((o) => o.pt && Number(o.starts_at.slice(11, 13)) >= 16 && Date.parse(o.ends_at ?? o.starts_at) + (o.ends_at ? 0 : 2 * 3600e3) > Date.now());
      const party = (pp?.parties ?? []).find((x) => ptDay(x.starts_at) === hmToday() && x.status === 'active') ?? null;
      setV({ evs, party });
    });
    return () => { live = false; };
  }, [on, d.search.id, AF.rev]);
  return on ? v : null;
}
export function HomeMapInner({ l, evening = false }) {
  const d = D();
  const s = d.search;
  const v = useLocation(l.id);
  const basePl = useBasePlaces(s.country);
  const [layers, setLayers0] = useState(() => (evening ? { places: false, contacts: false, evening: true } : { ...(hmLayers ?? { places: true, contacts: true }), evening: !!hmLayers?.evening })); // map/evening: tonight only, places off
  const eve = useEveningPins(layers.evening);
  const setLayers = (x) => { hmLayers = x; setLayers0(x); };
  const [ready, setReady] = useState(false);
  const [fail, setFail] = useState(false);
  const box = useRef(null);
  const mapR = useRef(null);
  const marks = useRef([]);
  const fitted = useRef(false);
  const theme = useThemeKey();
  const dirPins = (d.directory ?? []).filter((e) => e.lat != null && e.lng != null);
  useEffect(() => {
    let dead = false;
    setReady(false);
    fitted.current = false;
    loadML().then(async (ml) => {
      const style = await mapStyle();
      if (dead || !box.current) return;
      const map = new ml.Map({ container: box.current, style, center: [l.lng, l.lat], zoom: 13, attributionControl: false, dragRotate: false, pitchWithRotate: false, fadeDuration: 0 });
      map.touchZoomRotate.disableRotation();
      mapR.current = map;
      map.on('load', () => !dead && setReady(true));
    }).catch(() => !dead && setFail(true));
    return () => { dead = true; marks.current.forEach((m) => m.remove()); marks.current = []; mapR.current?.remove(); mapR.current = null; };
  }, [theme]);
  useEffect(() => {
    const map = mapR.current;
    const ml = window.maplibregl;
    if (!ready || !map || !ml) return;
    marks.current.forEach((m) => m.remove());
    marks.current = [];
    const add = (el, ll, z) => { el.style.zIndex = String(z); marks.current.push(new ml.Marker({ element: el, anchor: 'center' }).setLngLat(ll).addTo(map)); };
    const b = new ml.LngLatBounds();
    b.extend([l.lng, l.lat]);
    const accent = cssVar('--map-accent');
    const geo = v && !locStale(v) ? v.geo : null;
    const grs = [...new Set((geo?.features ?? []).map((f) => Number(f.properties?.ring)).filter((x) => !Number.isNaN(x)))].sort((a, c) => +(a) - +(c));
    const r0 = grs[0], r1 = grs[1] ?? grs[0], rl = grs[grs.length - 1];
    if (geo && grs.length && !map.getSource('iso')) {
      map.addSource('iso', { type: 'geojson', data: geo });
      const fillOp = grs.length >= 3 ? ['match', ['get', 'ring'], r0, 0.22, r1, 0.13, 0.06] : grs.length === 2 ? ['match', ['get', 'ring'], r0, 0.22, 0.1] : 0.18;
      map.addLayer({ id: 'iso-fill', type: 'fill', source: 'iso', paint: { 'fill-color': accent, 'fill-opacity': fillOp } });
      map.addLayer({ id: 'iso-line', type: 'line', source: 'iso', layout: { 'line-join': 'round' }, paint: { 'line-color': accent, 'line-width': 1.5, 'line-dasharray': [2, 1.6], 'line-opacity': 0.8 } });
    }
    for (const f of geo?.features ?? []) {
      if (Number(f.properties.ring) === r1) { const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates; for (const p of polys) for (const pt of p[0]) b.extend(pt); }
      if (grs.length > 1 && Number(f.properties.ring) === rl) continue;
      const tp = topPoint(f.geometry);
      if (!tp) continue;
      const el = document.createElement('div');
      el.className = 'ring-tag';
      el.textContent = t('lc_min', { n: f.properties.ring });
      add(el, tp, 8);
    }
    if (layers.places) {
      // Places in the rings when the agent computed them, else the pack/own places within ~8 km of the home.
      const pins = (v?.places?.length ? v.places.filter((p) => p.ring !== rl || p.tier === 1 || p.own) : allPlaces(basePl).filter((p) => p.type !== 'daytrip' && km([l.lat, l.lng], [p.lat, p.lng]) <= 8)).slice(0, 40);
      for (const p of pins) {
        const el = document.createElement('button');
        el.className = `lpin sm g-${groupOfType(p.type)}`;
        el.textContent = p.emoji ?? placeEmoji(p, basePl?.types);
        el.setAttribute('aria-label', p.name);
        el.addEventListener('click', (e) => { e.stopPropagation(); openSheet('spot', p.id); });
        add(el, [p.lng, p.lat], 3);
        if (!geo) b.extend([p.lng, p.lat]);
      }
    }
    if (layers.contacts) for (const e of dirPins) {
      const el = document.createElement('button');
      el.className = 'hm-dpin';
      el.innerHTML = `<svg class="icon" viewBox="0 0 24 24">${ICONS[e.icon] ?? ICONS[DG_ICON[e.grp]] ?? (ICONS as any).store}</svg>`;
      el.setAttribute('aria-label', e.name);
      el.addEventListener('click', (ev) => { ev.stopPropagation(); openSheet('dir_entry', e.id); });
      add(el, [e.lng, e.lat], 4);
      b.extend([e.lng, e.lat]);
    }
    if (layers.evening && eve) for (const o of eve.evs) {
      // a small black frame with the start time (wave 9); tap → the ticket
      const el = document.createElement('button');
      el.className = 'ev9-pin';
      el.textContent = afHM(o);
      el.setAttribute('aria-label', `${afTitle(o)}, ${afHM(o)}`);
      el.addEventListener('click', (e) => { e.stopPropagation(); hap.sel(); openSheet('ev_ticket', o); });
      add(el, [o.pt[1], o.pt[0]], 7);
      b.extend([o.pt[1], o.pt[0]]);
    }
    const home = document.createElement(layers.evening && eve?.party ? 'button' : 'div');
    home.className = 'lhome' + (layers.evening && eve?.party ? ' ev9-home' : '');
    home.setAttribute('aria-label', layers.evening && eve?.party ? `${eve.party.title}, ${ptHM(eve.party.starts_at)}` : hmName());
    if (layers.evening && eve?.party) {
      home.innerHTML = `<span class="ev9-hs">${t('pt_at_home')} ${ptHM(eve.party.starts_at)}</span>`;
      home.addEventListener('click', (e) => { e.stopPropagation(); go(sp('party', eve.party.id)); });
    }
    add(home, [l.lng, l.lat], 6);
    if (!fitted.current) {
      fitted.current = !!v;
      const H = box.current.clientHeight;
      const top = Math.min(H * 0.3, (document.querySelector('.hm-map-top')?.getBoundingClientRect().bottom ?? 120) + 24);
      map.fitBounds(b, { padding: { top, bottom: Math.min(H * 0.3, 130), left: 32, right: 32 }, maxZoom: 14, duration: 0 });
    }
  }, [ready, v, layers, basePl, d, eve]);
  const loc = v && !locStale(v) ? v.location : null;
  const sub = [districtShort(l), l.bedrooms != null ? t('br', { n: l.bedrooms }) : null].filter(Boolean).join(' · ');
  const hasPlaces = !!S.regions?.[s.country]?.places || (d.places ?? []).length > 0 || (v?.places ?? []).length > 0;
  const tg2 = (k, ic) => html`<button class=${'ds-hint pl-tg' + (layers[k] ? ' on' : '')} aria-pressed=${layers[k] ? 'true' : 'false'} onClick=${() => { hap.sel(); setLayers({ ...layers, [k]: !layers[k] }); }}><${Icon} n=${ic} cls="sm" />${t('hm_layer_' + k)}</button>`;
  return html`<main class="map-screen hm-map">
    <div class="map" ref=${box} role="application" aria-label=${t('hm_nav_map')}></div>
    <div class="map-top hm-map-top">
      <button class="card lc-card" onClick=${() => go(sp(loc ? 'location' : 'listing', l.id))}>
        <${Img} src=${photosOf(l)[0]} cls="lc-thumb" /><div class="grow"><b>${hmName()}</b><span>${sub}</span></div>
        ${loc && html`<span class=${'lc-score ' + scoreCls(loc.score)}><b>${loc.score}</b><small>${t('lc_word')}</small></span>`}</button>
      ${html`<div class="map-pl">${tg2('evening', 'moon')}${hasPlaces && tg2('places', 'map-pin')}${dirPins.length > 0 && tg2('contacts', 'users')}
        ${hasPlaces && html`<button class="ds-hint pl-tg" onClick=${() => go(sp('spots'))}><${Icon} n="layers" cls="sm" />${t('sp_list')}</button>`}</div>`}
      ${layers.evening && eve && !eve.evs.length && !eve.party && html`<p class="ds-hint ev9-none">${t('mp_evening_none')}</p>`}
    </div>
    ${fail && html`<div class="center-msg" style="position:absolute;inset:40% 0 auto">${t('map_fail')}</div>`}
    <span class="attrib">© OpenFreeMap © OpenStreetMap</span>
    <${Nav} tab="map" />
  </main>`;
}
