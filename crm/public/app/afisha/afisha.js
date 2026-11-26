// Split from app.js (wave 11): see the section comment below.
import { fxMount } from '../../fx.js';
import { api } from '../core/api.js';
import { D, canVoteRole, listingById, memberById, photoUrl, sceneStyle } from '../core/data.js';
import { TG, inTG, pref, tg } from '../core/env.js';
import { dfmt, firstName, fmtNum, money } from '../core/format.js';
import { LANG, STR, cap, t } from '../core/i18n.js';
import { back, go, openLink, sp } from '../core/routing.js';
import { closeSheet, emit, hap, openSheet, toast } from '../core/store.js';
import { fmtDMshort } from '../home/calendar.js';
import { Toggle } from '../home/docs.js';
import { BackIfWeb, hm, minLabel, msgCard, regionPack, skel } from '../home/helpers.js';
import { homeListing, homeMode } from '../home/homemode.js';
import { Av, Icon } from '../ui/icons.js';
import { Nav, Sticker, Typed, WaterCard } from '../ui/pieces.js';
import { AfParties, EventFeedback, ptDay, ptHM, ptUpcoming, useParties } from './parties.js';
import { html, useEffect, useRef, useState } from 'https://unpkg.com/htm@3.1.1/preact/standalone.module.js';

// ---------------------------------------------------------------- wave 7 · Афиша (E3 tickets, E2 detail, E5 Тусовки)
// /app/api/afisha: the 7-day strip, the day's ranked list (event of the day = the first 3, a swipeable stack), Тусовки with the
// weekday card. Each event photo may carry one category effect (fx.js, data from the region pack's events.yaml).
export const AF = { cache: {}, seed: 0, f: { all: [], social: [] }, d: [], day: null, hint: pref.get('af_hint') !== '0', rev: 0 };
export const AF_FILTERS = { all: ['ru', 'en', 'free', 'evening', 'morning', 'night', 'r20', 'book', 'beginner'], social: ['today', 'bars', 'clubs', 'sport'] };
export const AF_FICON = { evening: 'moon', morning: 'sunrise', night: 'moon', bars: 'martini', sport: 'trophy', free: null, r20: 'bike', book: 'message-circle' };
export const AF_CAT_ICON = { culture: 'flame', nature: 'mountain', sport: 'dumbbell', dance: 'music', music: 'music', food: 'utensils', workshop: 'palette', party: 'party-popper', wellness: 'sunrise',
  kids: 'party-popper', other: 'ticket', bar: 'martini', club: 'music', beach_club: 'party-popper', social_sport: 'trophy', meetup: 'users', quiz: 'mic' };
export const AF_TOPIC_ICON = { sea: 'waves', snorkel: 'waves', diving: 'waves', boat: 'waves', surf: 'waves', surf_meetup: 'waves', cinema: 'film', stargazing: 'sparkles', yoga: 'sunrise', market: 'store', padel: 'trophy', kecak: 'flame', fire_show: 'flame' };
export const afIcon = (o) => AF_TOPIC_ICON[o.topic] ?? AF_CAT_ICON[o.category] ?? 'ticket';
export const afCat = (o) => (o.topic && STR[LANG]['af_t_' + o.topic] ? t('af_t_' + o.topic) : t('af_c_' + o.category));
export const afTitle = (o) => (LANG === 'en' && o.title_en ? o.title_en : o.title);
export const afAbout = (o) => o.about?.[LANG] ?? o.about?.ru ?? o.about?.en ?? '';
export const afPlace = (o) => String(o.place?.name ?? '').split(/[·,(]/)[0].trim();
export const afWhy = (o) => (o.why ? (LANG === 'en' ? o.why.en : o.why.ru) : null);
export const afHM = (o) => o.starts_at.slice(11, 16).replace(/^0(\d)/, '$1');
export const afDay = (occ) => `${dfmt(occ, { weekday: 'short' }).replace('.', '')} ${Number(occ.slice(8, 10))}`;
export const afDayLong = (occ) => cap(dfmt(occ, { weekday: 'short', day: 'numeric', month: 'long' }).replace('.', ''));
export function afPrice(o) {
  if (o.price_kind === 'free') return o.entry === 'free' || o.social ? t('af_entry_free') : t('af_free');
  if (o.price != null) return money(o.price, o.currency);
  if (o.price_kind === 'on_site') return t('af_on_site');
  return null;
}
export const afLang = (o) => (o.lang === 'none' ? t('af_l_none') : o.lang === 'mixed' ? 'RU/EN' : o.lang ? o.lang.toUpperCase() : null);
/** The one criteria badge on a ticket: 18+ for nightlife, else the language. */
export const afBadge = (o, small = false) => (o.age_min && (o.social || small) ? `${o.age_min}+` : afLang(o) ?? (o.social ? t('af_c_' + o.category) : null));
export function afLive(o) {
  if (o.live) return t('af_live');
  if (o.in_hours > 0 && o.in_hours < 6) return o.in_hours < 1 ? t('af_in_min', { n: Math.max(5, Math.round(o.in_hours * 60 / 5) * 5) }) : t('af_in_h', { n: Math.round(o.in_hours) });
  if (o.recurring && o.social) return t('af_from', { t: afHM(o) });
  return null;
}
export function afKey() { const d = D(); return `${d.search.id}|${AF.tab}|${AF.day ?? ''}|${(AF.f[AF.tab] ?? []).join(',')}|${AF.d.join(',')}|${AF.seed}`; }
/** Wave 8.1: ride time on a ticket; far ones (≥ 1 h) in hours: "1,5 ч на байке". */
export const afTravel = (o) => (o.minutes == null ? null : o.minutes >= 60 ? t('w81_far_bike', { x: minLabel(o.minutes) }) : t('af_min_bike', { n: o.minutes }));
export function useAfisha(tab) {
  const d = D();
  AF.tab = tab;
  const key = afKey();
  const [v, setV] = useState(AF.cache[key] ?? null);
  const [, bump] = useState(0);
  useEffect(() => {
    let live = true;
    const q = new URLSearchParams({ s: d.search.id, tab, seed: String(AF.seed) });
    if (AF.day && tab === 'all') q.set('day', AF.day);
    if ((AF.f[tab] ?? []).length) q.set('f', AF.f[tab].join(','));
    if (AF.d.length) q.set('d', AF.d.join(','));
    if (!AF.cache[key]) setV(null);
    api('/app/api/afisha?' + q).then((j) => { AF.cache[key] = j; if (live) setV(j); }).catch((e) => live && setV({ failed: true, code: e.code }));
    return () => { live = false; };
  }, [key, AF.rev]);
  return [v, () => bump((x) => x + 1)];
}
export const afReset = () => { AF.cache = {}; AF.rev++; };
export async function afFeedback(o, kind, on = true, extra = {}) {
  const d = D();
  hap.sel();
  try { await api('/app/api/event-feedback', { search_id: d.search.id, event_id: o.id, occ: o.occ, kind, on, ...extra }); afReset(); emit(); return true; }
  catch { toast(t('err_generic')); return false; }
}

/** Photo with the category effect inside a thick black frame (wave 8, V4-3/V4-8); no photo that passed the quality bar → the
 * styled category card. The title and the stub live under the frame now. */
export function TkPhoto({ o, big = false, pill = null, children }) {
  const fxRef = useRef(null), imgRef = useRef(null);
  const ph = photoUrl(o.photo);
  useEffect(() => (ph && o.effect ? fxMount(fxRef.current, { shader: o.effect.shader, mix: o.effect.mix ?? 1, img: imgRef.current }) : undefined), [ph, o.effect?.shader]);
  const live = afLive(o);
  const tl = pill ?? (o.recurring && o.social ? { ic: 'repeat', text: LANG === 'en' ? o.recurring.en : o.recurring.ru } : { ic: afIcon(o), text: afCat(o) });
  return html`<div class=${'frame tk8-frame' + (big ? '' : ' sm')}><div class=${'in tk-ph' + (big ? ' big' : '') + (ph ? '' : ' none')} style=${ph ? '' : sceneStyle(D().search.country)}>
    ${ph ? html`<img ref=${imgRef} src=${ph} alt="" draggable="false" decoding="async" loading=${big ? 'eager' : 'lazy'} />` : html`<span class="tk-motif"><${Icon} n=${afIcon(o)} /></span>`}
    ${ph && o.effect && html`<div class="fx" ref=${fxRef} aria-hidden="true"></div>`}
    ${big && html`<span class="tk-pill"><${Icon} n=${tl.ic} cls="xs" />${tl.text}</span>`}
    ${live && html`<span class="tk-live"><i></i>${live}</span>`}
    ${children}
  </div></div>`;
}
export const Perf = () => html`<div class="tk-perf" aria-hidden="true"><i></i></div>`;
export function TicketBig({ o, pill, onBook, onNope = null, front = true }) {
  const why = afWhy(o);
  const price = afPrice(o);
  const badge = afBadge(o);
  const st = o.booking_status;
  const meta = [o.social ? afCat(o) : afPlace(o), o.social ? afPlace(o) : null, `${afDay(o.occ)} ${afHM(o)}`, price, badge, afTravel(o)].filter(Boolean).join(' · ');
  return html`<article class="tk big tk8" onClick=${() => go(sp('event', o.key))}>
    <${TkPhoto} o=${o} big pill=${pill} />
    ${st && st !== 'cancelled' && st !== 'declined' ? html`<${Sticker} text=${t('w8_going')} style="right:-6px;top:-18px;--r:-12deg" />`
      : o.liked_before && html`<${Sticker} text=${t('fb_liked')} cls="sky" style="right:-6px;top:-18px;--r:-12deg" />`}
    <div class="tk8-body">
      <h2 class="tk8-t">${afTitle(o)}</h2>
      <p class="tk8-m">${meta}</p>
      ${front && html`<div class="w8-pills tk8-pills">
        <button class=${'btn ' + (st ? 'surface' : 'accent') + ' tk-go'} onClick=${(e) => { e.stopPropagation(); st ? go(sp('event', o.key)) : onBook(o); }}>${st ? t('af_st_' + st) : t('af_book')}</button>
        ${onNope && html`<button class="btn surface" onClick=${(e) => { e.stopPropagation(); onNope(o); }}>${t('af_nope')}</button>`}
      </div>`}
      ${why && front && html`<p class="tk-why"><${Icon} n="sparkles" cls="xs" />${why}</p>`}
    </div>
  </article>`;
}
export function TicketSmall({ o }) {
  return html`<button class="tk small tk8" onClick=${() => go(sp('event', o.key))}>
    <${TkPhoto} o=${o} />
    <span class="tk8-cap"><b>${afHM(o)}</b> ${afTitle(o)}</span>
    <span class="tk8-sub">${[afDay(o.occ), afTravel(o), afBadge(o, true)].filter(Boolean).join(' · ')}</span>
    ${o.liked_before && html`<span class="tk9-liked"><${Icon} n="sparkles" cls="xs" />${t('fb_liked')}</span>`}
  </button>`;
}
export function afBook(o) {
  if (D().me.role === 'viewer') return toast(t('af_viewer'));
  openSheet('ev_book', o);
}
/** Event of the day: a stack of up to 3 tickets; swipe right = записаться, left = не моё. */
export function AfStack({ list, social }) {
  const [i, setI] = useState(0);
  const [dx, setDx] = useState(0);
  const [anim, setAnim] = useState(false);
  const st = useRef(null);
  const topRef = useRef(null);
  useEffect(() => { setI(0); setDx(0); }, [list.map((x) => x.key).join()]);
  // Once a drag is horizontal, the page must not scroll with it (diagonal pulls used to scroll the list). touch-action
  // alone isn't enough in iOS WebViews, so a non-passive touchmove cancels the scroll while the card is held.
  useEffect(() => {
    const el = topRef.current;
    if (!el) return;
    let t0 = null, locked = false;
    const ts = (e) => { const p = e.touches[0]; t0 = { x: p.clientX, y: p.clientY }; locked = false; };
    // WebKit only lets the FIRST touchmove cancel scrolling, so the direction is decided on the first move: sideways
    // first = the card owns the whole gesture; vertical first = a normal page scroll.
    const tm = (e) => {
      if (!t0) return;
      const p = e.touches[0], mx = p.clientX - t0.x, my = p.clientY - t0.y;
      if (!locked) {
        if (!mx && !my) return;
        if (Math.abs(mx) < Math.abs(my)) { t0 = null; return; }
        locked = true; tg(() => TG.disableVerticalSwipes?.());
      }
      if (e.cancelable) e.preventDefault();
    };
    const te = () => { if (locked) tg(() => TG.enableVerticalSwipes?.()); t0 = null; locked = false; };
    el.addEventListener('touchstart', ts, { passive: true });
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('touchend', te);
    el.addEventListener('touchcancel', te);
    return () => { el.removeEventListener('touchstart', ts); el.removeEventListener('touchmove', tm); el.removeEventListener('touchend', te); el.removeEventListener('touchcancel', te); };
  }, [i, list.length > 0]);
  const cards = list.slice(i, i + 3);
  if (!cards.length) return null;
  const top = cards[0];
  const done = () => { if (AF.hint) { AF.hint = false; pref.set('af_hint', '0'); } };
  const fly = (dir) => {
    setAnim(true);
    setDx(dir * 520);
    setTimeout(() => {
      setAnim(false); setDx(0);
      if (dir > 0) afBook(top);
      else { afFeedback(top, 'nope'); toast(t('af_noped')); setI((x) => x + 1); }
      done();
    }, 220);
  };
  const down = (e) => { if (e.button > 0) return; st.current = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false }; };
  const move = (e) => {
    const s = st.current;
    if (!s) return;
    const mx = e.clientX - s.x, my = e.clientY - s.y;
    if (!s.moved && Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my)) { s.moved = true; e.currentTarget.setPointerCapture?.(s.id); }
    if (s.moved) setDx(mx);
  };
  const up = (e) => {
    const s = st.current;
    st.current = null;
    if (!s?.moved) return;
    e.preventDefault();
    if (Math.abs(dx) > 90) fly(dx > 0 ? 1 : -1);
    else { setAnim(true); setDx(0); setTimeout(() => setAnim(false), 260); }
  };
  const pill = social ? null : { ic: 'flame', text: t('af_of_day') };
  return html`<section class="af-stack" aria-label=${t('af_of_day')}>
    <div class="af-deck">
      ${cards.slice(1).reverse().map((o, k, arr) => html`<div key=${o.key} class=${'af-behind b' + (arr.length - k)} aria-hidden="true"><${TicketBig} o=${o} front=${false} /></div>`)}
      <div ref=${topRef} class=${'af-top' + (anim ? ' anim' : '')} style=${`transform:translateX(${dx}px) rotate(${dx / 30}deg)`}
        onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up} onDragStart=${(e) => e.preventDefault()} onClickCapture=${(e) => { if (Math.abs(dx) > 4) { e.stopPropagation(); e.preventDefault(); } }}>
        <${TicketBig} key=${top.key} o=${top} pill=${pill} onBook=${afBook} onNope=${() => fly(-1)} />
        ${dx !== 0 && html`<span class=${'af-stamp ' + (dx > 0 ? 'yes' : 'no')} style=${`opacity:${Math.min(1, Math.abs(dx) / 90)}`}>${dx > 0 ? t('af_book') : t('af_nope')}</span>`}
      </div>
    </div>
    ${AF.hint && html`<p class="af-hint"><span><${Icon} n="left" cls="xs" />${t('af_hint_l')}</span><span>${t('af_hint_r')}<${Icon} n="arrow-right" cls="xs" /></span></p>`}
  </section>`;
}
/** Wave 8.1: the empty Афиша — a statement, the next sweep on a sticker, the region's verified recurring events (events.yaml
 * sources with `recurring`, e.g. the Uluwatu kecak at sunset) as "каждый день" placeholders so it is never empty, interests. */
export function AfRecCard({ r }) {
  const d = D();
  const fx = useRef(null);
  const eff = (r.topics ?? []).map((k) => regionPack()?.events?.effects?.[k]).find((x) => x !== undefined) ?? null;
  useEffect(() => (eff ? fxMount(fx.current, { shader: eff.shader, mix: eff.mix ?? 1 }) : undefined), [eff?.shader]);
  const ru = LANG === 'ru';
  const title = (ru && r.name_ru) || r.name;
  const when = (ru && r.recurring_ru) || r.recurring;
  const daily = /daily|каждый день|every day/i.test(`${r.recurring} ${r.recurring_ru ?? ''}`);
  const ic = AF_TOPIC_ICON[(r.topics ?? []).find((k) => AF_TOPIC_ICON[k])] ?? 'ticket';
  return html`<div class="af81-rec">
    <div class="frame af81-rec-ph"><div class="in">
      <span class="scene solid" style=${sceneStyle(d.search.country)}></span><span class="tk-motif"><${Icon} n=${ic} /></span>
      ${eff && html`<div class="fx" ref=${fx} aria-hidden="true"></div>`}
      <span class="af81-rec-pill"><${Icon} n="repeat" cls="xs" />${daily ? t('w81_af_daily') : t('w81_af_rec')}</span>
    </div></div>
    ${r.starts && html`<${Sticker} text=${r.starts} cls="sm" style="right:-6px;top:-14px;--r:10deg" />`}
    <p class="af81-rec-t">${title}</p>
    <p class="af81-rec-m">${[when, r.area ? afArea(r.area) : null].filter(Boolean).join(' · ')}</p>
  </div>`;
}
export function AfEmpty() {
  const pk = regionPack();
  const l = homeListing() ?? listingById(D()?.listings?.[0]?.id);
  const dist = l?.district;
  const city = dist ? Object.values(pk?.areas ?? {}).find((a) => (a.districts ?? []).includes(dist))?.city ?? null : null;
  const recs = (pk?.events?.sources ?? []).filter((x) => x.recurring).sort((a, b) => (b.city === city) - (a.city === city)).slice(0, 3);
  return html`<section class="af81-empty">
    <div class="af81-e-hd">
      <${Typed} lines=${[t('w81_af_big')]} cls="af81-big" />
      <${Sticker} text=${t('w81_af_sweep', { t: '08:00' })} cls="lg" style="right:-4px;top:-18px;--r:12deg" />
    </div>
    <p class="w8-sub">${recs.length ? t('w81_af_sub') : t('w81_af_none_sub')}</p>
    ${recs.map((r) => html`<${AfRecCard} key=${r.id} r=${r} />`)}
    <div class="w8-pills af81-e-pills"><button class="btn accent" onClick=${() => { hap.sel(); openSheet('af_prefs'); }}><${Icon} n="sparkles" cls="sm" />${t('w81_af_prefs')}</button></div>
  </section>`;
}
export function Afisha({ arg }) {
  const d = D();
  const tab = arg === 'social' ? 'social' : 'all';
  const [v, rerender] = useAfisha(tab);
  const fs = AF.f[tab] ?? [];
  const setF = (k) => {
    hap.sel();
    const cur = new Set(fs);
    if (k === 'all') cur.clear(); else if (cur.has(k)) cur.delete(k); else cur.add(k);
    AF.f[tab] = [...cur];
    rerender();
  };
  const reshuffle = () => { hap.impact(); AF.seed = (AF.seed + 1 + Math.floor(Math.random() * 1000)) % 1e6; rerender(); };
  const setDay = (day) => { hap.sel(); AF.day = day; rerender(); };
  // wave 8.1: "Рядом" (no district: the whole region, near first) or any districts (multi-select)
  const setD = (k) => { hap.sel(); const cur = new Set(AF.d); if (k == null) cur.clear(); else if (cur.has(k)) cur.delete(k); else cur.add(k); AF.d = [...cur]; rerender(); };
  const pkAreas = regionPack()?.areas ?? {};
  const dChips = [...new Set([...AF.d, ...(v?.areas ?? []).map((x) => x.id)])].filter((k) => pkAreas[k]);
  const area = v?.area ? afArea(v.area) : null;
  const kick = [v?.day || v?.today ? cap(dfmt(v.day || v.today, { weekday: 'long', day: 'numeric', month: 'long' })) : ' ', area].filter((x) => x && x.trim()).join(' · ') || ' ';
  const hm = homeMode();
  const all = v && !v.failed ? [...v.top, ...v.items] : [];
  const isToday = !v?.day || v.day === v.today;
  const q = tab === 'social' ? t('af_social') : isToday ? t('w8_tonight_q') : t('w8_day_q', { d: afDay(v.day) });
  // wave 8.1: nothing collected at all (not just filtered out) → the designed empty state instead of a grey box
  const nothing = !!v && !v.failed && !all.length && !v.total && !fs.length;
  return html`<main class="screen af-screen">
    <div class="head w3-head w8-head">${!inTG && html`<div class="row w8-head-top"><${BackIfWeb} /></div>`}
      <div class="row af8-hd"><div class="grow"><p class="kicker">${kick}</p><h1 class="sr">${t(tab === 'social' ? 'af_social' : 'af_title')}</h1><${Typed} lines=${[q]} /></div>
      <button class="round af-more" aria-label=${t('af_more')} title=${t('af_more')} onClick=${reshuffle}><${Icon} n="shuffle" /></button></div></div>
    <div class="seg af-tabs" role="tablist">
      <button role="tab" aria-pressed=${tab === 'all' ? 'true' : 'false'} onClick=${() => tab !== 'all' && go(sp('afisha'), true)}>${t('af_title')}</button>
      <button role="tab" aria-pressed=${tab === 'social' ? 'true' : 'false'} onClick=${() => tab !== 'social' && go(sp('afisha', 'social'), true)}>${t('af_social')}</button>
      <button class="af-prefs" aria-label=${t('af_prefs')} onClick=${() => openSheet('af_prefs')}><${Icon} n="settings-2" cls="sm" /></button>
    </div>
    ${hm && tab === 'all' && html`<${AfParties} />`}
    ${!nothing && dChips.length > 0 && html`<div class="w3-chips af81-dist" role="group" aria-label=${t('w81_districts')}>
      <button aria-pressed=${AF.d.length ? 'false' : 'true'} onClick=${() => setD(null)}><${Icon} n="navigation" cls="xs" />${t('w81_near')}</button>
      ${dChips.map((k) => html`<button key=${k} aria-pressed=${AF.d.includes(k) ? 'true' : 'false'} onClick=${() => setD(k)}>${pkAreas[k].name?.[LANG] ?? pkAreas[k].name?.en ?? k}${(v?.areas ?? []).find((x) => x.id === k) ? html`<i class="af81-n">${v.areas.find((x) => x.id === k).n}</i>` : null}</button>`)}
    </div>`}
    ${!nothing && html`<div class="w3-chips" role="group">
      ${tab === 'all' && html`<button aria-pressed=${fs.length ? 'false' : 'true'} onClick=${() => setF('all')}>${t('af_f_all')}</button>`}
      ${AF_FILTERS[tab].map((k) => html`<button key=${k} class="ic-chip" aria-pressed=${fs.includes(k) ? 'true' : 'false'} onClick=${() => setF(k)}>${AF_FICON[k] && html`<${Icon} n=${AF_FICON[k]} cls="xs" />`}${t('af_f_' + k)}</button>`)}
    </div>`}
    ${tab === 'all' && v?.days && !nothing && html`<div class="af-days" role="group">${v.days.map((x) => html`<button key=${x.day} aria-pressed=${x.day === v.day ? 'true' : 'false'} disabled=${!x.n && x.day !== v.day} onClick=${() => setDay(x.day)}>
      <span>${dfmt(x.day, { weekday: 'short' }).replace('.', '')}</span><b>${Number(x.day.slice(8, 10))}</b>${x.n ? html`<i>${x.n}</i>` : html`<i class="z">·</i>`}</button>`)}</div>`}
    ${!v ? html`${skel(420)}${skel(200)}` : v.failed ? msgCard(t('err_generic')) : nothing ? html`<${AfEmpty} />` : !all.length ? html`<div class="card af-empty"><span class="scene solid" style=${sceneStyle(d.search.country)}></span>
        <b>${t('af_empty_f')}</b><span>${t('af_empty_f_sub')}</span></div>` : html`
      <${AfStack} list=${v.top} social=${tab === 'social'} />
      ${v.items.length > 0 && html`<div class="af-grid">${v.items.map((o) => html`<${TicketSmall} key=${o.key} o=${o} />`)}</div>`}`}
    ${tab === 'social' && v?.weekly?.length > 0 && html`<div class="card af-week"><p>${t('af_by_wd')}</p><div>${v.weekly.slice(0, 4).map((w) => html`<button key=${w.wd} onClick=${() => go(sp('event', w.key))}>
      <span>${t('af_wd' + w.wd)}</span><b>${w.title}</b></button>`)}</div></div>`}
    <${Nav} tab=${hm ? 'afisha' : 'today'} />
  </main>`;
}
export const afArea = (id) => {
  const pk = regionPack();
  const ar = Object.values(pk?.areas ?? {}).find((a) => (a.districts ?? []).includes(id)) ?? pk?.areas?.[id];
  return ar?.name ? ar.name[LANG] ?? ar.name.en : null;
};

/** E2: the event page. */
export function EventDetail({ id }) {
  const d = D();
  const [eid, occ] = String(id ?? '').split('@');
  const [v, setV] = useState(null);
  const [rev, setRev] = useState(0);
  useEffect(() => {
    api(`/app/api/event?s=${encodeURIComponent(d.search.id)}&id=${encodeURIComponent(eid)}&occ=${encodeURIComponent(occ ?? '')}`).then(setV).catch((e) => setV({ failed: true, code: e.code }));
  }, [id, rev, AF.rev]);
  const fxRef = useRef(null), imgRef = useRef(null);
  const o = v?.occurrence;
  useEffect(() => (photoUrl(o?.photo) && o.effect ? fxMount(fxRef.current, { shader: o.effect.shader, mix: o.effect.mix ?? 1, img: imgRef.current }) : undefined), [photoUrl(o?.photo), o?.effect?.shader]);
  if (!v) return html`<main class="screen no-nav">${skel(300)}${skel(160)}</main>`;
  if (v.failed || !o) return html`<main class="screen no-nav"><${BackIfWeb} />${msgCard(v.event?.past ? t('af_past') : t('err_generic'))}</main>`;
  const me = d.user.id;
  const voters = d.members.filter((m) => m.role === 'owner' || m.role === 'member');
  const others = voters.filter((m) => m.user_id !== me);
  const wanted = d.members.filter((m) => o.want.includes(m.user_id) || o.going.includes(m.user_id));
  const end = o.ends_at ? '–' + o.ends_at.slice(11, 16).replace(/^0(\d)/, '$1') : '';
  const price = afPrice(o);
  const meta = [afDayLong(o.occ), afHM(o) + end, price ? price + (o.price_note && o.price != null && LANG === 'ru' ? ` ${o.price_note}` : '') : null].filter(Boolean).join(' · ');
  const kick = [afCat(o), afPlace(o) || afArea(o.place?.area)].filter(Boolean).join(' · ');
  const why = afWhy(o);
  const sea = o.sea ? o.sea_state : null;
  const band = Number(o.starts_at.slice(11, 13)) < 12 ? 'morning' : Number(o.starts_at.slice(11, 13)) < 17 ? 'day' : 'evening';
  const ch = v.organizer?.channel;
  const chName = { whatsapp: 'WhatsApp', telegram: 'Telegram', instagram: 'Instagram', facebook: 'Messenger', email: 'email', phone: 'SMS' }[ch] ?? null;
  const nGo = 1 + others.length;
  const st = o.booking_status;
  const badges = [afLang(o) && (o.lang === 'none' ? t('af_l_none') : afLang(o)), o.age_min && `${o.age_min}+`, o.entry && o.entry !== 'free' && t('af_e_' + o.entry), o.dress_code, o.beginner && t('af_beginner'), o.vibe && t('af_v_' + o.vibe), o.crowd && t('af_cr_' + o.crowd)].filter(Boolean);
  const wantOn = o.mine.want;
  const toggleWant = async () => { if (await afFeedback(o, 'want', !wantOn)) { if (!wantOn) toast(t('af_want_sent')); setRev((x) => x + 1); } };
  const bookmark = async () => { if (await afFeedback(o, 'bookmark', !o.mine.bookmark)) { toast(t(o.mine.bookmark ? 'af_unsaved' : 'af_saved')); setRev((x) => x + 1); } };
  const nope = async () => { if (await afFeedback(o, 'nope', !o.mine.nope)) { toast(t(o.mine.nope ? 'af_unnoped' : 'af_noped')); setRev((x) => x + 1); } };
  const cancel = async () => {
    const b = v.bookings?.find((x) => x.status !== 'cancelled');
    if (!b) return;
    try { await api('/app/api/event-book-cancel', { search_id: d.search.id, booking_id: b.id }); hap.ok(); toast(t('af_cancelled')); afReset(); setRev((x) => x + 1); } catch { toast(t('err_generic')); }
  };
  const bookLabel = o.booking === 'ticket' ? t('af_tickets') : nGo === 2 ? t('af_book_two') : nGo === 3 ? t('af_book_three') : t('af_book');
  // V4-8: back circle, the photo in a black frame with one category effect, a language sticker, then the words
  return html`<main class="detail evd evd8">
    ${!inTG && html`<div class="row evd8-top"><button class="round w8-back" aria-label=${t('back')} onClick=${back}><${Icon} n="arrow-left" /></button></div>`}
    <div class="evd8-stage">
      <div class="frame evd8-frame"><div class="in evd-hero">
        ${o.photo ? html`<img ref=${imgRef} src=${photoUrl(o.photo)} alt="" decoding="async" />` : html`<span class="scene solid" style=${sceneStyle(d.search.country)}></span><span class="tk-motif"><${Icon} n=${afIcon(o)} /></span>`}
        ${o.photo && o.effect && html`<div class="fx" ref=${fxRef} aria-hidden="true"></div>`}
        ${o.photo?.credit && html`<a class="evd-credit" href=${o.photo.source_url || null} onClick=${(e) => { if (o.photo.source_url) { e.preventDefault(); openLink(o.photo.source_url); } }}>${o.photo.credit.startsWith('©') ? o.photo.credit : '© ' + o.photo.credit}</a>`}
      </div></div>
      ${afLang(o) && html`<${Sticker} text=${afLang(o)} cls="sky" style="right:-4px;top:-22px;--r:10deg" />`}
    </div>
    <div class="sheet-body evd-body">
      <p class="kicker">${kick}</p>
      <h1 class="evd-h">${afTitle(o)}</h1>
      <p class="meta">${meta}</p>
      ${o.recurring && html`<span class="chip evd-rec"><${Icon} n="repeat" cls="xs" />${LANG === 'en' ? o.recurring.en : o.recurring.ru}${o.minutes != null ? ' · ' + afTravel(o) : ''}</span>`}
      ${sea && html`<${WaterCard} cls="evd-sea"><span class="evd-sea-in"><${Icon} n="waves" /><span><b>${t(sea.calm ? 'af_sea_calm' : 'af_sea_rough', { w: t('af_band_' + band) })}</b>
        <span>${[sea.wave != null ? t('af_wave', { x: fmtNum(sea.wave) }) : null, sea.wind != null ? t(sea.wind <= 12 ? 'af_wind_low' : sea.wind <= 22 ? 'af_wind_mid' : 'af_wind_high') : null].filter(Boolean).join(' · ')}</span></span></span><//>`}
      ${why && html`<p class="tk-why evd-why"><${Icon} n="sparkles" cls="xs" />${why}</p>`}
      ${o.liked_before && html`<p class="tk-why evd-why tk9-liked-line"><${Icon} n="sparkles" cls="xs" />${t('fb_liked_line', { r: '★'.repeat(o.liked_before.rating) })}</p>`}
      <${EventFeedback} o=${o} onDone=${() => setRev((x) => x + 1)} />
      ${afAbout(o) && html`<p class="evd-about">${afAbout(o)}</p>`}
      ${badges.length > 0 && html`<div class="chips evd-badges">${badges.map((b) => html`<span class="chip">${b}</span>`)}</div>`}
      <div class="card w2-list evd-agent">
        <div class="w2-lh"><span>${t(o.booking === 'none' ? 'af_how' : o.booking === 'ticket' ? 'af_how' : 'af_agent')}</span></div>
        ${o.booking === 'message' && html`<div class="w2-row"><span class="sq big accent-sq"><${Icon} n="message-circle" /></span><div class="grow"><b>${chName ? t('af_ag_msg', { c: chName }) : t('af_ag_msg0')}</b><span>${t('af_ag_msg_s')}</span></div></div>`}
        ${o.booking === 'ticket' && html`<button class="w2-row" onClick=${() => openLink(o.ticket_url)}><span class="sq big accent-sq"><${Icon} n="ticket" /></span><div class="grow"><b>${t('af_ag_ticket')}</b><span>${t('af_ag_ticket_s')}</span></div><${Icon} n="ext" cls="sm muted" /></button>`}
        ${o.booking === 'none' && html`<div class="w2-row"><span class="sq big accent-sq"><${Icon} n="door-open" /></span><div class="grow"><b>${t('af_ag_none')}</b><span>${t('af_ag_none_s')}</span></div></div>`}
        ${o.booking !== 'none' && html`<div class="w2-row"><span class="sq big accent-sq"><${Icon} n="users" /></span><div class="grow"><b>${others.length ? t('af_ag_seats', { n: nGo, names: others.map((m) => firstName(m.name)).join(', ') }) : t('af_ag_seat1')}</b><span>${t('af_ag_seats_s')}</span></div></div>`}
        ${o.price_kind !== 'free' && html`<div class="w2-row"><span class="sq big accent-sq"><${Icon} n="wallet" /></span><div class="grow"><b>${t('af_ag_pay')}</b><span>${t('af_ag_pay_s')}</span></div></div>`}
      </div>
      <div class="evd-who">
        ${wanted.length ? html`<span class="avs free">${wanted.slice(0, 4).map((m) => html`<${Av} key=${m.user_id} m=${m} size=${32} free />`)}</span>` : html`<span class="avs free"><${Av} m=${memberById(me)} size=${32} free /></span>`}
        <span class="grow">${wanted.length ? whoText(o, wanted, me) : t('af_who_none')}</span>
        ${canVoteRole(d.me.role) && html`<button class=${'btn sm ' + (wantOn ? 'surface' : 'link')} onClick=${toggleWant}>${t(wantOn ? 'af_want_on' : 'af_want')}</button>`}
      </div>
      ${(o.source?.url || o.source?.name) && html`<p class="evd-src">${t('af_source')}: ${o.source.url ? html`<a href=${o.source.url} onClick=${(e) => { e.preventDefault(); openLink(o.source.url); }}>${o.source.name || hostOf(o.source.url)}</a>` : o.source.name}</p>`}
      ${canVoteRole(d.me.role) && html`<button class="btn ghost block" onClick=${nope}>${t(o.mine.nope ? 'af_unnope' : 'af_nope')}</button>`}
    </div>
    ${canVoteRole(d.me.role) && html`<div class="evd-bar">
      <button class="round evd-bm" aria-label=${t('sh_title')} onClick=${() => openSheet('share', { kind: 'event', o })}><${Icon} n="share" /></button>
      <button class=${'round evd-bm' + (o.mine.bookmark ? ' on' : '')} aria-label=${t('af_save')} aria-pressed=${o.mine.bookmark ? 'true' : 'false'} onClick=${bookmark}><${Icon} n="bookmark" /></button>
      ${st && st !== 'cancelled' && st !== 'declined'
        ? html`<div class="evd-st"><b>${t('af_st_' + st)}</b><button class="btn link" onClick=${cancel}>${t('af_cancel')}</button></div>`
        : html`<button class="btn accent big grow" onClick=${() => afBook(o)}>${bookLabel}</button>`}
    </div>`}
  </main>`;
}
export const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
export function whoText(o, ms, me) {
  const going = ms.filter((m) => o.going.includes(m.user_id));
  if (going.length) return t('af_going', { names: going.map((m) => (m.user_id === me ? t('af_you') : firstName(m.name))).join(', ') });
  const w = ms.filter((m) => m.user_id !== me);
  if (!w.length) return t('af_you_want');
  return w.length === 1 ? t('af_wants1', { name: firstName(w[0].name) }) : t('af_wantsN', { names: w.map((m) => firstName(m.name)).join(', ') });
}

/** "Записаться": who goes (members + guests), what to ask (nightlife: guest list / table; padel: a slot), a note. */
export function EventBookSheet({ o }) {
  const d = D();
  const voters = d.members.filter((m) => m.role === 'owner' || m.role === 'member');
  const [who, setWho] = useState(() => new Set(voters.map((m) => m.user_id).filter((u) => u === d.user.id || o.want.includes(u)).concat(d.user.id)));
  const [guests, setGuests] = useState(0);
  const kinds = o.category === 'social_sport' ? ['slot', 'join'] : ['bar', 'club', 'beach_club', 'party'].includes(o.category) ? ['join', 'guest_list', 'table'] : ['join'];
  const [kind, setKind] = useState(kinds[0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const toggle = (u) => { hap.sel(); const n = new Set(who); n.has(u) ? n.delete(u) : n.add(u); if (!n.size) n.add(d.user.id); setWho(n); };
  const ticket = o.booking === 'ticket';
  async function save() {
    setBusy(true);
    try {
      await api('/app/api/event-book', { search_id: d.search.id, event_id: o.id, occ: o.occ, who: [...who], guests, kind, note: note.trim() || null });
      hap.ok();
      toast(t(ticket || o.booking === 'none' ? 'af_booked_self' : 'af_booked_req'));
      afReset();
      closeSheet();
      if (ticket && o.ticket_url) openLink(o.ticket_url);
    } catch (e) { toast(e.code === 'event_past' ? t('af_past') : e.code === 'sensitive' ? e.message : t('err_generic')); }
    setBusy(false);
  }
  const n = who.size + guests;
  return html`<h2>${t('af_who_title')}</h2>
    <p class="muted af-sheet-sub">${afTitle(o)} · ${afDayLong(o.occ)}, ${afHM(o)}</p>
    <div class="card grp">${voters.map((m) => html`<button key=${m.user_id} class="opt" role="checkbox" aria-checked=${who.has(m.user_id) ? 'true' : 'false'} onClick=${() => toggle(m.user_id)}>
      <${Av} m=${m} size=${36} /><span class="grow">${m.user_id === d.user.id ? t('af_you_cap') : m.name}</span><span class=${'cbox' + (who.has(m.user_id) ? ' on' : '')}>${who.has(m.user_id) && html`<${Icon} n="check" />`}</span></button>`)}
      <div class="opt"><span class="sq"><${Icon} n="userplus" /></span><span class="grow">${t('af_guests')}</span>
        <span class="stepper"><button aria-label="−" disabled=${!guests} onClick=${() => { hap.sel(); setGuests(Math.max(0, guests - 1)); }}><${Icon} n="minus" cls="sm" /></button><b>${guests}</b><button aria-label="+" disabled=${guests >= 10} onClick=${() => { hap.sel(); setGuests(guests + 1); }}><${Icon} n="plus" cls="sm" /></button></span></div>
    </div>
    ${kinds.length > 1 && html`<div class="seg full af-kind" role="group">${kinds.map((k) => html`<button key=${k} aria-pressed=${kind === k ? 'true' : 'false'} onClick=${() => { hap.sel(); setKind(k); }}>${t('af_k_' + k)}</button>`)}</div>`}
    ${!ticket && o.booking !== 'none' && html`<input class="e-input af-note" value=${note} maxlength="300" placeholder=${t('af_note_ph')} onInput=${(e) => setNote(e.currentTarget.value)} />`}
    <p class="muted af-sheet-note">${t(ticket ? 'af_book_note_ticket' : o.booking === 'none' ? 'af_book_note_none' : 'af_book_note', { n })}</p>
    <button class="btn accent block" disabled=${busy} onClick=${save}>${t(ticket ? 'af_book_ticket_btn' : o.booking === 'none' ? 'af_book_none_btn' : 'af_book_btn', { n })}</button>
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}
export const AF_INTERESTS = ['nightlife', 'sport', 'surf', 'culture', 'nature', 'food', 'wellness', 'music', 'creative', 'social'];
export function AfPrefsSheet() {
  const d = D();
  const cur = Object.values(AF.cache).find((x) => x?.prefs)?.prefs ?? {};
  const [night, setNight] = useState(cur.nightlife !== false);
  const [line, setLine] = useState(cur.afisha ?? homeMode());
  const [ints, setInts] = useState(new Set(cur.taste?.interests ?? []));
  const [age, setAge] = useState(cur.taste?.age_band ?? null);
  const save = async (patch) => {
    try { await api('/app/api/afisha-prefs', { search_id: d.search.id, ...patch }); afReset(); } catch { toast(t('err_generic')); }
  };
  const tog = (k) => { hap.sel(); const n = new Set(ints); n.has(k) ? n.delete(k) : n.add(k); setInts(n); save({ taste: { age_band: age, interests: [...n] } }); };
  return html`<h2>${t('af_prefs')}</h2>
    <div class="card grp">
      <${Toggle} on=${night} label=${t('af_p_night')} sub=${t('af_p_night_sub')} onChange=${(v) => { hap.sel(); setNight(v); save({ nightlife: v ? null : false }); }} />
      <${Toggle} on=${line} label=${t('af_p_line')} sub=${t('af_p_line_sub')} onChange=${(v) => { hap.sel(); setLine(v); save({ afisha: v }); }} />
    </div>
    <p class="section">${t('af_p_like')}</p>
    <div class="chips af-ints">${AF_INTERESTS.map((k) => html`<button key=${k} class=${'bchip' + (ints.has(k) ? ' on' : ' off')} aria-pressed=${ints.has(k) ? 'true' : 'false'} onClick=${() => tog(k)}>${t('af_i_' + k)}</button>`)}</div>
    <p class="section">${t('af_p_age')}</p>
    <div class="seg full" role="group">${['18-24', '25-30', '31-40', '40+'].map((a) => html`<button key=${a} aria-pressed=${age === a ? 'true' : 'false'} onClick=${() => { hap.sel(); setAge(a); save({ taste: { age_band: a, interests: [...ints] } }); }}>${a}</button>`)}</div>
    <p class="muted af-sheet-note">${t('af_p_note')}</p>
    <button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
}
/** Home Plan: today's top event and the upcoming bookings (/app/api/event-plan). */
export function AfPlanCard() {
  const d = D();
  const parties = ptUpcoming(useParties()); // wave 9: the members' own parties in the Plan
  const [v, setV] = useState(null);
  useEffect(() => { api('/app/api/event-plan?s=' + encodeURIComponent(d.search.id)).then(setV).catch(() => setV({ failed: true })); }, [d.search.id, AF.rev]);
  if (!v || v.failed || (!v.top && !v.bookings?.length && !v.total && !parties.length)) return null;
  const top = v.top;
  return html`<div class="card w2-list af-plan">
    <button class="w2-lh af-plan-h" onClick=${() => go(sp('afisha'))}><span>${t('af_title')}${v.total ? ` · ${t('af_n_week', { n: v.total })}` : ''}</span><span class="af-plan-all">${t('af_all')}<${Icon} n="chev" cls="sm" /></span></button>
    ${parties.map((p) => html`<button key=${p.id} class="w2-row cl-row hm-cl-go" onClick=${() => go(sp('party', p.id))}><span class="cl-d acc">${fmtDMshort(ptDay(p.starts_at))}</span>
      <div class="grow"><b>${p.title}</b><span>${[ptHM(p.starts_at), t('pt_at_home'), t('pt_going_n', { n: p.counts?.heads ?? 0 })].join(' · ')}</span></div><${Icon} n="chev" cls="sm muted" /></button>`)}
    ${v.bookings.map((b) => html`<button key=${b.id} class="w2-row cl-row hm-cl-go" onClick=${() => go(sp('event', b.event_id + '@' + b.occ))}><span class="cl-d">${fmtDMshort(b.occ)}</span>
      <div class="grow"><b>${b.title}</b><span>${[b.starts_at.slice(11, 16), b.place, t('af_st_' + b.status)].filter(Boolean).join(' · ')}</span></div><${Icon} n="chev" cls="sm muted" /></button>`)}
    ${top && !v.bookings.some((b) => b.event_id === top.id && b.occ === top.occ) && html`<button class="w2-row af-plan-top" onClick=${() => go(sp('event', top.key))}>
      ${top.photo ? html`<img class="af-thumb" src=${photoUrl(top.photo)} alt="" loading="lazy" />` : html`<span class="sq big"><${Icon} n=${afIcon(top)} /></span>`}
      <div class="grow"><b>${afTitle(top)}</b><span>${[t('af_today_at', { t: afHM(top) }), afPlace(top), afWhy(top)].filter(Boolean).join(' · ')}</span></div><${Icon} n="chev" cls="sm muted" /></button>`}
  </div>`;
}
