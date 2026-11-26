// Split from app.js (wave 11): see the section comment below.
import { api, authHeaders } from '../core/api.js';
import { D, canVoteRole, districtShort, listingById, memberById, photosOf } from '../core/data.js';
import { TG, inTG } from '../core/env.js';
import { LOC, dfmt, firstName, fmtDayMonth, fmtNum } from '../core/format.js';
import { LANG, cap, t } from '../core/i18n.js';
import { back, openLink } from '../core/routing.js';
import { S, hap, toast } from '../core/store.js';
import { joinNames } from '../screens/deal.js';
import { Icon } from '../ui/icons.js';
import { homeListing } from './homemode.js';
import { html } from 'https://unpkg.com/htm@3.1.1/preact/standalone.module.js';

// ---------------------------------------------------------------- wave 2: shared helpers
export const dealListing = () => (D()?.deal ? listingById(D().deal.listing_id) : null);
/** Wave 8.1: the home's short name: listings.short_name (agent / owner), the deal's name, else "Дом в Унгасане" / "Дом" (never the
 * long listing title, which reads like an ad: "3 спальни, …"). */
export function homeName() {
  const d = D();
  const l = homeListing();
  const sn = String(l?.short_name ?? '').trim();
  if (sn) return sn;
  if (d?.deal?.data?.name) return d.deal.data.name;
  const dn = l ? districtShort(l) : '';
  return dn ? t('w81_home_dn', { p: inPlace(dn) }) : t('w81_home');
}
export const isLiving = () => D()?.search?.status === 'living';
export const regionPack = () => S.regions?.[D()?.search?.country] ?? null;
/** Amount in the scale of `ref` without a unit: 34 800 000 next to 69,6 млн → "34,8". */
export function scaled(n, ref) {
  const r = Math.abs(ref ?? n);
  return fmtNum(r >= 1e6 ? n / 1e6 : r >= 1e4 ? n / 1e3 : n);
}
export function BackIfWeb() {
  return !inTG ? html`<button class="round w2-back" aria-label=${t('back')} onClick=${back}><${Icon} n="arrow-left" /></button>` : null;
}
export function W2Head({ l, kicker, kickerCls = '', title, sub, right = null }) {
  const ph = photosOf(l)[0];
  return html`<div class="w2-head w8-head">
    ${(!inTG || l !== undefined) && html`<div class="row w8-head-top"><${BackIfWeb} /><span class="grow"></span>${right}${l !== undefined && html`<span class="frame sm w8-thumb"><span class="in">${ph ? html`<img src=${ph} alt="" loading="lazy" />` : null}</span></span>`}</div>`}
    <div>${kicker && html`<p class=${'kicker ' + kickerCls}>${kicker}</p>`}<h1 class="h1">${title}</h1>${sub && html`<p class="w2-sub">${sub}</p>`}</div>
  </div>`;
}
export async function postInstruction(text, kind, ref) {
  await api('/app/api/instruction', { search_id: D().search.id, text, kind, ref });
}
/** Upload an image file to an endpoint that takes a raw image/* body. */
export async function uploadImage(url, file) {
  const r = await fetch(url, { method: 'POST', headers: { ...authHeaders(), 'content-type': file.type || 'image/jpeg' }, body: file });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || String(r.status));
  return j;
}
export function pickFiles({ multiple = false, capture = false } = {}) {
  return new Promise((res) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = 'image/*';
    if (multiple) i.multiple = true;
    if (capture) i.setAttribute('capture', 'environment');
    i.onchange = () => res([...(i.files ?? [])]);
    i.click();
  });
}

// ---------------------------------------------------------------- wave 3: shared helpers
export const meOrName = (u) => (u === D()?.user.id ? t('sp_you') : firstName(memberById(u)?.name));
export function homePoint() {
  const l = dealListing();
  return l?.lat != null && l?.lng != null ? [l.lat, l.lng] : null;
}
/** "18 мин" / "1 ч" / "1,5 ч". */
export const minLabel = (m) => (m >= 60 ? t('ds_h', { n: fmtNum(Math.round(m / 6) / 10) }) : t('em_min', { n: m }));
export function W3Head({ kicker, title, right }) {
  // wave 8: back circle and actions on their own row under the top bar, then the kicker and the giant title
  return html`<div class="head w3-head w8-head">${(!inTG || right) && html`<div class="row w8-head-top"><${BackIfWeb} /><span class="grow"></span>${right}</div>`}
    <div>${kicker && html`<p class="kicker">${kicker}</p>`}<h1 class="h1 w3-h1">${title}</h1></div></div>`;
}
export const telLink = (p) => (p ? `tel:${String(p).replace(/[^\d+]/g, '')}` : null);
export const mapLink = (lat, lng, url) => url || (lat != null && lng != null ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : null);
export function RoundBtn({ ic, label, onClick, cls = '' }) {
  return html`<button class=${'w3-rb ' + cls} aria-label=${label} onClick=${(e) => { e.stopPropagation(); onClick(); }}><${Icon} n=${ic} /></button>`;
}

// ---------------------------------------------------------------- wave 5: shared helpers
export const isGuest = () => D()?.me?.role === 'guest';
export const fmt1 = (x) => new Intl.NumberFormat(LOC(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(x);
/** "06:30" → "6:30"; hOnly("10:00") → "10". */
export const hm = (s) => String(s ?? '').replace(/^0(\d):/, '$1:');
export const hOnly = (s) => hm(String(s ?? '').replace(/:00$/, ''));
export const msgCard = (s) => html`<div class="card" style="padding:16px;margin-bottom:14px"><p class="muted" style="margin:0">${s}</p></div>`;
export const skel = (h = 140) => html`<div class="skeleton" style=${`height:${h}px;margin-bottom:14px`}></div>`;
/** Russian genitive of a first name: Лев → Льва, Игорь → Игоря, Маша → Маши. Latin names stay. */
export function genRu(n) {
  const s = String(n ?? '');
  if (LANG !== 'ru' || !/[а-яё]$/i.test(s)) return s;
  const irr = { Лев: 'Льва', Павел: 'Павла', Пётр: 'Петра', Петр: 'Петра' };
  if (irr[s]) return irr[s];
  if (/[гкхжчшщ]а$/i.test(s) || /я$/i.test(s)) return s.slice(0, -1) + 'и';
  if (/а$/i.test(s)) return s.slice(0, -1) + 'ы';
  if (/[йь]$/i.test(s)) return s.slice(0, -1) + 'я';
  if (/[бвгджзклмнпрстфхцчшщ]$/i.test(s)) return s + 'а';
  return s;
}
/** Russian prepositional of a one-word place name: Букит → Буките, Астана → Астане; Меласти, Алматы stay. */
export function prepRu(n) {
  const s = String(n ?? '');
  if (LANG !== 'ru' || /\s/.test(s) || !/[а-яё]$/i.test(s)) return s;
  if (/ия$/i.test(s) || /ь$/i.test(s)) return s.slice(0, -1) + 'и';
  if (/[аяй]$/i.test(s)) return s.slice(0, -1) + 'е';
  if (/[бвгджзклмнпрстфхцчшщ]$/i.test(s)) return s + 'е';
  return s;
}
export const NA_PLACES = /^(Бали|Букит|Пхукет|Самуи|Панган|Ко Панган|Ланта|Ломбок|Гили)/i;
/** "на Буките", "в Чангу"; en "in Bukit". */
export const inPlace = (name) => (!name ? '' : LANG !== 'ru' ? `in ${name}` : `${NA_PLACES.test(name) ? 'на' : 'в'} ${prepRu(name)}`);
export const hostNames = () => (isGuest() ? D().me.guest?.hosts ?? [] : (D()?.members ?? []).filter((m) => canVoteRole(m.role)).map((m) => firstName(m.name)));
export const hostsGen = () => joinNames(hostNames().map(genRu));
/** "1–8 декабря" / "28 ноября – 5 декабря". */
export function rangeDM(a, b) {
  if (!a || !b) return a ? fmtDayMonth(a) : b ? fmtDayMonth(b) : '';
  if (a.slice(0, 7) === b.slice(0, 7)) return `${Number(a.slice(8, 10))}–${fmtDayMonth(b)}`;
  return `${fmtDayMonth(a)} – ${fmtDayMonth(b)}`;
}
/** "2026-03" → "Март 2026". */
export function monthYear(ym) {
  const s = String(ym ?? '');
  if (!/^\d{4}-\d{2}/.test(s)) return s;
  return cap(dfmt(s.slice(0, 7) + '-01', { month: 'long', year: 'numeric' }).replace(/\s*г\.?$/, ''));
}
export function askConfirm(msg) {
  return new Promise((res) => {
    if (inTG && TG.showConfirm) { try { TG.showConfirm(msg, (ok) => res(!!ok)); return; } catch { /* fall back */ } }
    res(window.confirm(msg));
  });
}
export async function copyText(s) {
  try { await navigator.clipboard.writeText(s); hap.ok(); toast(t('gd_copied')); } catch { window.prompt(t('gd_copy_link'), s); }
}
export function shareTg(url, text) {
  const link = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  if (inTG) openLink(link);
  else if (navigator.share) navigator.share({ url, text }).catch(() => null);
  else window.open(link, '_blank', 'noopener');
}
export const chevRow = (onClick, ic, title, sub, extra = null, cls = '') => html`<button class=${'card chats-row ' + cls} onClick=${onClick}><span class="ic"><${Icon} n=${ic} /></span><div class="grow"><b>${title}</b><span>${sub}</span></div>${extra}<${Icon} n="chev" cls="sm muted" /></button>`;
