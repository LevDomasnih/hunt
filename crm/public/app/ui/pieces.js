// Split from app.js (wave 11): see the section comment below.
import { fxMount } from '../../fx.js';
import { npTone } from '../../newproject.js';
import { cssVar, themePref } from '../core/api.js';
import { D, districtShort } from '../core/data.js';
import { TG, inTG, reduceMotion, tg } from '../core/env.js';
import { shortTitle, tzNow } from '../core/format.js';
import { LANG, STR, pl, t } from '../core/i18n.js';
import { back, go, sp } from '../core/routing.js';
import { hap, openSheet } from '../core/store.js';
import { HomeNav, homeListing, homeMode, homePhase } from '../home/homemode.js';
import { ordTone } from '../orders/orders.js';
import { chArchRoute } from '../screens/chats.js';
import { Av, ICONS, Icon } from './icons.js';
import { html, useEffect, useRef, useState } from 'https://unpkg.com/htm@3.1.1/preact/standalone.module.js';

// ---------------------------------------------------------------- wave 8 · Block vibe pieces (DESIGN.md)
Object.assign(STR.ru, {
  // wave 8.3: the home's chats and the search archive (design/mockup-v8)
  ch_home: 'Дом', ch_wait: 'Ждут тебя', ch_arch: 'Архив поиска', ch_arch_sub: (n) => `${n} ${pl(n, 'переписка', 'переписки', 'переписок')}, только почитать`,
  ch_arch_note: 'Дома, с которыми переписывались до заезда. Только почитать', ch_arch_new: '{n} новое', ch_arch_wrote: 'Написали после заезда',
  ch_arch_no: 'Отказались', ch_arch_quiet: 'Не ответили', ch_arch_empty: 'Архив пуст', ch_locked: 'Архив поиска: писать отсюда нельзя. Ответить может Hunt, с твоим «да»',
  ch_arch_tag: 'архив',
});
Object.assign(STR.en, {
  ch_home: 'Home', ch_wait: 'Waiting for you', ch_arch: 'Search archive', ch_arch_sub: (n) => `${n} ${pl(n, 'chat', 'chats')}, read only`,
  ch_arch_note: 'Homes you wrote to before moving in. Read only', ch_arch_new: '{n} new', ch_arch_wrote: 'Wrote after the move',
  ch_arch_no: 'Turned down', ch_arch_quiet: 'No answer', ch_arch_empty: 'The archive is empty', ch_locked: 'Search archive: no writing from here. Hunt can answer, with your yes',
  ch_arch_tag: 'archive',
});
// Presentational only: the top bar, the giant blurred word, the typing statement, stickers, the floating hero photo with
// parallax, the black frame, a number count-up. Reduced motion → static text, no bobbing, no parallax, final numbers.
Object.assign(STR.ru, {
  w8_home: 'Дом', w8_night: 'Ночь', w8_todo: 'Что сделать · {n}', w8_k_pay: 'платёж', w8_k_power: 'свет', w8_k_stage: 'этап', w8_k_tomorrow: 'завтра', w8_k_home: 'дома',
  w8_stage_v: '{i} из {n}', w8_power_v: (n) => `на ${n} ${pl(n, 'день', 'дня', 'дней')}`, w8_day_n: 'день {n}', w8_surf_line: 'Серф {h} до {t}', w8_surf_dot: 'серф до {t}',
  w8_tonight_btn: 'Афиша на вечер', w8_go_too: 'Иду тоже', w8_other: 'Другое', w8_quiet_night: 'Тихий вечер дома', w8_tonight_q: 'Что сегодня вечером?', w8_day_q: 'Планы на {d}',
  w8_going: 'иду', w8_here: 'ты здесь', w8_signed: 'подписан {d}', w8_who_wrote: 'Кто что написал', w8_n_of: '{i} / {n}', w8_new: 'новая трата', w8_paid_by: 'платил',
  w8_photo_hint: 'фото чека, если есть', w8_open: 'Открыть', w8_first: 'первым!', w8_villa: 'Вилла',
});
Object.assign(STR.en, {
  w8_home: 'Home', w8_night: 'Night', w8_todo: 'To do · {n}', w8_k_pay: 'payment', w8_k_power: 'power', w8_k_stage: 'stage', w8_k_tomorrow: 'tomorrow', w8_k_home: 'at home',
  w8_stage_v: '{i} of {n}', w8_power_v: (n) => `${n} ${pl(n, 'day', 'days')} left`, w8_day_n: 'day {n}', w8_surf_line: 'Surf {h} until {t}', w8_surf_dot: 'surf till {t}',
  w8_tonight_btn: 'Tonight’s events', w8_go_too: 'Count me in', w8_other: 'Something else', w8_quiet_night: 'A quiet night in', w8_tonight_q: 'What’s on tonight?', w8_day_q: 'Plans for {d}',
  w8_going: 'going', w8_here: 'you are here', w8_signed: 'signed {d}', w8_who_wrote: 'Who wrote what', w8_n_of: '{i} / {n}', w8_new: 'new expense', w8_paid_by: 'paid by',
  w8_photo_hint: 'receipt photo, if any', w8_open: 'Open', w8_first: 'first!', w8_villa: 'Villa',
});
Object.assign(ICONS, {
  menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
  'arrow-up-right': '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
});
// wave 8.1: main tabs get their own colours, Home/Афиша/Деньги/Ещё in the home nav, designed empty states
Object.assign(STR.ru, {
  hm_nav_afisha: 'Афиша', hm_nav_money: 'Деньги', w81_near: 'Рядом', w81_districts: 'Районы', w81_far_bike: '{x} на байке', w81_day: 'день {d} из {n}', w81_map: 'Карта', w81_plan: 'План', w81_map_sub: 'дом, места и контакты рядом', w81_plan_sub: 'платежи, праздники, события',
  w81_home_dn: 'Дом {p}', w81_home: 'Дом', w81_rename: 'Название дома', w81_rename_hint: 'Коротко, как вы его зовёте: «Дом в Унгасане», «Вилла с бассейном»',
  w81_rename_ph: 'Дом в Унгасане', w81_save: 'Сохранить', w81_saved: 'Название сохранено', w81_tonight: 'Сегодня вечером', w81_tonight_n: (n) => `ещё ${n} ${pl(n, 'событие', 'события', 'событий')}`,
  w81_ev_line: 'Вечером: {t}', w81_offline: (h) => `Агент не заходил ${h >= 48 ? `${Math.floor(h / 24)} ${pl(Math.floor(h / 24), 'день', 'дня', 'дней')}` : `${h} ${pl(h, 'час', 'часа', 'часов')}`}: голоса и одобрения ждут его`,
  w81_af_big: 'Афиша собирается', w81_af_sub: 'Агент проверяет чаты и площадки рядом с домом каждое утро. Пока вот что идёт всегда:', w81_af_sweep: 'сбор в {t}',
  w81_af_daily: 'каждый день', w81_af_prefs: 'Что мне интересно', w81_af_rec: 'постоянное', w81_af_none_sub: 'Агент проверяет чаты и площадки рядом с домом каждое утро. Первые события появятся после сбора',
  w81_m_paid: 'Оплачено по договору', w81_m_rent: 'Аренда', w81_m_rent_for: 'аренда {p}', w81_m_deposit: 'Залог у хозяина', w81_m_dep_back: 'вернут {d}', w81_m_dep_note: 'не трата: вернётся при выезде',
  w81_m_first: 'первый месяц в доме', w81_m_rent_of: 'из них аренда {x}', w81_m_dep_line: 'и {x} залога у хозяина',
  w81_m_empty_k: 'общие траты', w81_m_empty: 'Тут будут общие траты', w81_m_empty_sub: 'Аренда, свет, байки, уборка: кто платил и кто кому должен. Агент добавит платежи по договору сам',
  w81_m_soon: 'скоро', w81_m_none_month: 'в {m} пока без трат', w81_m_all_line: 'всего {x} с заезда', w81_m_add: 'Добавить трату',
});
Object.assign(STR.en, {
  hm_nav_afisha: 'Events', hm_nav_money: 'Money', w81_near: 'Nearby', w81_districts: 'Districts', w81_far_bike: '{x} by bike', w81_day: 'day {d} of {n}', w81_map: 'Map', w81_plan: 'Plan', w81_map_sub: 'home, places and contacts nearby', w81_plan_sub: 'payments, holidays, events',
  w81_home_dn: 'Home {p}', w81_home: 'Home', w81_rename: 'Home name', w81_rename_hint: 'Short, the way you call it: “Ungasan house”, “Villa with a pool”',
  w81_rename_ph: 'Ungasan house', w81_save: 'Save', w81_saved: 'Name saved', w81_tonight: 'Tonight', w81_tonight_n: (n) => `${n} more ${pl(n, 'event', 'events')}`,
  w81_ev_line: 'Tonight: {t}', w81_offline: (h) => `The agent has been away for ${h >= 48 ? `${Math.floor(h / 24)} ${pl(Math.floor(h / 24), 'day', 'days')}` : `${h} ${pl(h, 'hour', 'hours')}`}: votes and approvals are waiting for it`,
  w81_af_big: 'Events are on their way', w81_af_sub: 'The agent checks chats and venues near your home every morning. Meanwhile, this is always on:', w81_af_sweep: 'sweep at {t}',
  w81_af_daily: 'every day', w81_af_prefs: 'My interests', w81_af_rec: 'regular', w81_af_none_sub: 'The agent checks chats and venues near your home every morning. The first events show up after the sweep',
  w81_m_paid: 'Paid under the lease', w81_m_rent: 'Rent', w81_m_rent_for: 'rent {p}', w81_m_deposit: 'Deposit with the landlord', w81_m_dep_back: 'back on {d}', w81_m_dep_note: 'not spending: it comes back at move-out',
  w81_m_first: 'your first month here', w81_m_rent_of: 'rent {x} of it', w81_m_dep_line: 'plus {x} deposit with the landlord',
  w81_m_empty_k: 'shared spending', w81_m_empty: 'Shared spending lives here', w81_m_empty_sub: 'Rent, power, bikes, cleaning: who paid and who owes whom. The agent adds the lease payments itself',
  w81_m_soon: 'soon', w81_m_none_month: 'nothing spent in {m} yet', w81_m_all_line: '{x} since move-in', w81_m_add: 'Add expense',
});
Object.assign(ICONS, {
  'arrow-up': '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  'shopping-basket': '<path d="m15 11-1 9"/><path d="m19 11-4-7"/><path d="M2 11h20"/><path d="m3.5 11 1.6 7.4a2 2 0 0 0 2 1.6h9.8a2 2 0 0 0 2-1.6l1.7-7.4"/><path d="M4.5 15.5h15"/><path d="m5 11 4-7"/><path d="m9 11 1 9"/>',
  languages: '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
});
Object.assign(ICONS, { navigation: '<polygon points="3 11 22 2 13 21 11 13 3 11"/>' });
/** Local hour (0–23) in the project's time zone. */
export const localHour = () => Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tzNow() }).format(new Date()));
/** Screen colour of a route (wave 8.1: every main tab its own): region (Home / Today, path, checklists), afisha (night palette in the
 * evening, afisha-day = hot coral 06:00–17:00), money (mint), more (sky), night (evening Home, dark theme via CSS), grey (secondary
 * screens: docs, lists, details). KZ / TH swaps for a clash with the region colour live in app.css. */
export const ORD_SCREENS = new Set(['shop', 'good', 'basket', 'order-check', 'order', 'orders', 'set-apply']);
export const TONE_REGION = new Set(['today', 'path', 'deal', 'onsite', 'moveout', 'next']);
export function toneFor(screen, arg) {
  const d = D();
  if (screen === 'newproject') return npTone();
  if (!d?.search || screen === 'picker' || screen === 'start') return 'grey';
  if (d.me?.role === 'guest') return screen === 'today' || !screen ? 'region' : 'grey';
  if (screen === 'afisha' || screen === 'event' || screen === 'party') { if (themePref() === 'light') return 'afisha-day'; if (themePref() === 'dark') return 'afisha'; const h = localHour(); return h >= 6 && h < 17 ? 'afisha-day' : 'afisha'; }
  if (screen === 'money') return 'money';
  if (screen === 'more') return 'more';
  if (screen === 'access') return ['sees', 'off', 'receipt'].includes(arg) ? 'grey' : arg === 'limit' ? 'money' : 'access';
  if (screen === 'agent') return 'access'; // "Подключить агента": sky like connecting the chats
  if (screen === 'chats' && arg && d.me?.role === 'owner' && (d.drafts ?? []).some((x) => x.contact_id === arg)) return 'access';
  if (screen === 'chats' && homeMode()) return chArchRoute(arg) ? 'grey' : 'access'; // wave 8.3: the home's chats sky, the archive calm grey
  if (ORD_SCREENS.has(screen)) return ordTone(screen, arg); // wave 10: lilac, the fish shop sky
  if (screen === 'today' && nightMode()) return 'night';
  return TONE_REGION.has(screen) ? 'region' : 'grey';
}
/** Evening Home (V4-6): living in the home, 18:00–04:00 local. */
export function nightMode() {
  if (themePref() === 'light') return false;
  if (!homeMode() || homePhase() !== 'living') return false;
  const h = localHour();
  return h >= 18 || h < 4;
}
export function applyTone(tone) {
  const el = document.documentElement;
  if (el.dataset.tone === tone) return;
  el.dataset.tone = tone;
  tg(() => {
    if (!inTG) return;
    const g = cssVar('--ground');
    TG.setHeaderColor(g);
    TG.setBackgroundColor(g);
    TG.setBottomBarColor?.(g);
  });
}
/** K1 top bar: "hunt" · where we are (opens the project switcher) · menu (settings). Projects list: "+" instead. */
export function TopBar({ screen }) {
  const d = D();
  const s = d?.search;
  const picker = screen === 'picker' || !s;
  const where = s ? (homeMode() ? districtShort(homeListing()) || shortTitle(s.title) : shortTitle(s.title)) : '';
  return html`<header class="w8-bar">
    <span class="w8-logo">hunt</span>
    ${!picker && where && html`<button class="w8-where" aria-haspopup="dialog" aria-label=${t('my_searches') + ': ' + where} onClick=${() => { hap.sel(); openSheet('switch'); }}><span class="ellipsis">${where}</span></button>`}
    ${picker ? (D()?.user?.can_create ? html`<button class="w8-burger" aria-label=${t('np_new')} onClick=${() => { hap.sel(); go('/new'); }}><${Icon} n="plus" /></button>` : null)
      : d?.user && html`<button class="w8-burger" aria-label=${t('settings_btn')} onClick=${() => { hap.sel(); openSheet('settings'); }}><${Icon} n="menu" /></button>`}
  </header>`;
}
/** Giant blurred word behind the hero (Дом, Ночь, Деньги…): a legible shape, never read out. */
export const BigWord = ({ text, cls = '' }) => html`<div class=${'bigword ' + cls} aria-hidden="true">${text}</div>`;
/** The one key statement of a screen, typed with a caret; cycles 2–3 lines when given. Screen readers get the lines as text. */
export function Typed({ lines, cls = '', as = 'p' }) {
  const list = (Array.isArray(lines) ? lines : [lines]).filter(Boolean).map(String);
  const key = list.join('|');
  const [txt, setTxt] = useState(reduceMotion() ? list[0] ?? '' : '');
  useEffect(() => {
    if (!list.length) return undefined;
    if (reduceMotion()) { setTxt(list[0]); return undefined; }
    let li = 0, i = 0, del = false, alive = true, tm = 0;
    const step = () => {
      if (!alive) return;
      const s0 = list[li];
      if (!del) { i++; setTxt(s0.slice(0, i)); if (i >= s0.length) { if (list.length < 2) return; del = true; tm = setTimeout(step, 2600); return; } }
      else { i--; setTxt(s0.slice(0, i)); if (i <= 0) { del = false; li = (li + 1) % list.length; } }
      tm = setTimeout(step, del ? 22 : 45 + Math.random() * 40);
    };
    tm = setTimeout(step, 180);
    return () => { alive = false; clearTimeout(tm); };
  }, [key]);
  const El = as;
  return html`<${El} class=${'typed ' + cls}><span class="sr">${list.join('. ')}</span><span aria-hidden="true">${txt}<span class="caret"></span></span><//>`;
}
/** Round sticker with 1–2 words, rotated (K1). */
export const Sticker = ({ text, cls = '', style = '' }) => html`<span class=${'sticker ' + cls} style=${style}><span>${text}</span></span>`;
/** Members' animals as white-ringed stickers that gently bob (decorative; names stay in the title attribute). */
export function AniStickers({ ms, size = 64, pos = [] }) {
  return html`${ms.slice(0, pos.length).map((m, k) => html`<span key=${m.user_id ?? k} class="ani" style=${`${pos[k]};--r:${k % 2 ? 8 : -10}deg;animation-delay:${-1.6 * k}s`}><${Av} m=${m} size=${size} free /></span>`)}`;
}
/** Hero photo floating with a long soft shadow and a small tilt; parallax ≤ 10 px on pointer move / scroll. */
export function FloatPhoto({ src, alt = '', cls = '', onClick = null, label = null, tilt = -3, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduceMotion()) return undefined;
    let raf = 0, x = 0, y = 0;
    const paint = () => { raf = 0; el.style.transform = `rotate(${tilt + x * 3}deg) translate(${x * 10}px, ${y * 8}px)`; };
    const pm = (e) => { if (e.pointerType === 'touch') return; x = e.clientX / innerWidth - 0.5; y = e.clientY / innerHeight - 0.5; raf ||= requestAnimationFrame(paint); };
    const sc = () => { y = Math.max(-0.5, Math.min(0.5, scrollY / 800)); raf ||= requestAnimationFrame(paint); };
    addEventListener('pointermove', pm, { passive: true });
    addEventListener('scroll', sc, { passive: true });
    return () => { removeEventListener('pointermove', pm); removeEventListener('scroll', sc); cancelAnimationFrame(raf); };
  }, [tilt]);
  const inner = html`${src ? html`<img src=${src} alt=${alt} decoding="async" draggable="false" />` : html`<span class="float-none"></span>`}${children}`;
  const st = `transform:rotate(${tilt}deg)`;
  return onClick ? html`<button ref=${ref} class=${'float-ph ' + cls} style=${st} aria-label=${label} onClick=${onClick}>${inner}</button>`
    : html`<div ref=${ref} class=${'float-ph ' + cls} style=${st}>${inner}</div>`;
}
/** A number that counts up from 0 on mount (money); reduced motion → the final value at once. */
export function CountUp({ value, fmt = (n) => String(Math.round(n)), ms = 1100 }) {
  const [v, setV] = useState(reduceMotion() ? value : 0);
  useEffect(() => {
    if (reduceMotion() || !Number.isFinite(value)) { setV(value); return undefined; }
    const t0 = performance.now();
    let raf = 0;
    const f = (now) => { const p = Math.min(1, (now - t0) / ms); setV(value * (1 - Math.pow(1 - p, 3))); if (p < 1) raf = requestAnimationFrame(f); };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return fmt(v);
}
/** Big number + unit split of a money amount for the giant figure (26,4 · млн рупий). */
export function bigMoney(n, cur) {
  const a = Math.abs(n);
  const unit = a >= 1e6 ? (LANG === 'ru' ? 'млн' : 'million') : a >= 1e4 ? (LANG === 'ru' ? 'тыс' : 'thousand') : '';
  const div = a >= 1e6 ? 1e6 : a >= 1e4 ? 1e3 : 1;
  const curWord = LANG === 'ru' ? { IDR: 'рупий', KZT: 'тенге', THB: 'бат', RUB: 'рублей', USD: 'долларов', EUR: 'евро' }[cur] : cur;
  return { v: n / div, dec: div > 1 && a / div < 100 ? 1 : 0, unit: [unit, curWord].filter(Boolean).join(' ') };
}
/** Round back button under the top bar (outside Telegram, where Telegram has its own). */
export const BackRound = () => (!inTG ? html`<button class="round w8-back" aria-label=${t('back')} onClick=${back}><${Icon} n="arrow-left" /></button>` : null);

// ---------------------------------------------------------------- shared pieces
export function Nav({ tab }) {
  if (homeMode()) return html`<${HomeNav} tab=${tab} />`;
  const items = [['today', 'sun'], ['listings', 'layers'], ['map', 'map'], ['plan', 'calendar']];
  return html`<nav class="nav" aria-label="Hunt">
    ${items.map(([k, ic]) => html`<a href=${'#' + sp(k)} aria-current=${tab === k ? 'page' : null} aria-label=${t('nav_' + k)}
      onClick=${(e) => { e.preventDefault(); if (tab !== k) { hap.sel(); go(sp(k), true); } }}>
      <${Icon} n=${ic} /><span>${t('nav_' + k)}</span></a>`)}
  </nav>`;
}
/** Wave 6: the project stage bar (00c, 45, 46): n segments, the first idx-1 done, idx current (mango), closed = all done. */
export function StageBar({ idx, n = 9, closed = false, cls = '' }) {
  return html`<span class=${'stagebar ' + cls} role="img" aria-label=${t('stage_n_of', { i: Math.min(idx, n), n })}>
    ${Array.from({ length: n }, (_, k) => html`<i class=${closed ? (k === n - 1 ? 'end' : 'done') : k + 1 < idx ? 'done' : k + 1 === idx ? 'cur' : ''}></i>`)}</span>`;
}
/** Wave 6: a "living water" shape (surf on Home, own pool on a villa, sea on an event): a circle or a pill since wave 8. Static
 * gradient underneath; fx.js (the one WebGL effect system, shader "water") paints a canvas into .water-bg, at most 2 animated
 * effects at a time, paused off-screen, a still frame under reduced motion, nothing without WebGL. Children are the text. */
export function WaterCard({ children, cls = '', onClick = null, label = null }) {
  const bg = useRef(null);
  useEffect(() => fxMount(bg.current, { shader: 'water', cell: 72 }), []);
  const inner = html`<span class="water-bg" aria-hidden="true" ref=${bg}></span><span class="water-txt">${children}</span>`;
  return onClick ? html`<button class=${'water-card ' + cls} aria-label=${label} onClick=${onClick}>${inner}</button>` : html`<div class=${'water-card ' + cls}>${inner}</div>`;
}
export function Skeletons({ n = 2 }) {
  return html`<div class="stack" aria-hidden="true">${Array.from({ length: n }, () => html`<div class="skeleton"><div class="ph"></div><div class="ln"></div><div class="ln"></div></div>`)}</div>`;
}
