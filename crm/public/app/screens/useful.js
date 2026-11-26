// Split from app.js (wave 11): see the section comment below.
import { api } from '../core/api.js';
import { D } from '../core/data.js';
import { firstName, fmtDM } from '../core/format.js';
import { LANG, t } from '../core/i18n.js';
import { go, openLink, sp } from '../core/routing.js';
import { S, closeSheet, hap, openSheet, toast } from '../core/store.js';
import { GuestNav } from '../home/guests.js';
import { RoundBtn, W3Head, isGuest, msgCard, skel } from '../home/helpers.js';
import { homeMode } from '../home/homemode.js';
import { allPlaces, useBasePlaces } from '../places/places.js';
import { ICONS, Icon } from '../ui/icons.js';
import { Nav } from '../ui/pieces.js';
import { html, useEffect, useState } from 'https://unpkg.com/htm@3.1.1/preact/standalone.module.js';

// ---------------------------------------------------------------- sheets
// ---------------------------------------------------------------- wave 6 · B: Полезное (47)
// Region pack useful.yaml + instance-wide links members suggested and the agent/owner approved (/app/api/useful).
export const ufCache = {};
export let ufRev = 0; // bumped after a suggestion so an open Полезное screen reloads
export function useUseful(sid) {
  const [v, setV] = useState(ufCache[sid] ?? null);
  const reload = () => api('/app/api/useful?s=' + encodeURIComponent(sid)).then((j) => { ufCache[sid] = j; setV(j); }).catch((e) => setV({ failed: true, code: e.code }));
  useEffect(() => { reload(); }, [sid, ufRev]);
  return [v, reload];
}
export const UF_FILTERS = ['all', 'chats', 'apps', 'guides', 'maps'];
export const UF_FOLD = 5;
export const UF_GROUPS = ['telegram', 'apps', 'guides'];
export const UF_CATS = ['chats_rent', 'flea', 'bikes', 'news', 'visas', 'medicine', 'food', 'apps', 'guides', 'maps', 'other'];
export const UF_BADGE = { telegram: 'TG', app: 'App', web: 'Web', hunt: 'Hunt' };
export const UF_ICON = { telegram: 'send', app: 'smartphone', web: 'book-open', hunt: 'map' };
export const ufGroup = (x) => (x.kind === 'telegram' ? 'telegram' : x.kind === 'app' ? 'apps' : 'guides');
export const ufIsMap = (x) => x.kind === 'hunt' || x.category === 'maps';
export const ufMatch = (x, f) => f === 'all' || (f === 'chats' && x.kind === 'telegram') || (f === 'apps' && x.kind === 'app')
  || (f === 'maps' && ufIsMap(x)) || (f === 'guides' && x.kind !== 'telegram' && x.kind !== 'app' && !ufIsMap(x));
export function ufHandle(url) {
  const m = String(url ?? '').match(/^https:\/\/t\.me\/([A-Za-z0-9_]{3,})\/?$/);
  if (m) return '@' + m[1];
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}
export function ufAbout(x, nPlaces) {
  let a = x.about?.[LANG] ?? x.about?.ru ?? x.about?.en ?? x.note ?? '';
  if (a.includes('{n}')) a = nPlaces ? a.replace('{n}', String(nPlaces)) : a.replace(/\{n\}\s*/, '');
  return a;
}
export function ufSub(x, nPlaces) {
  const about = ufAbout(x, nPlaces);
  // Pack guides/apps carry their source in the text; a Telegram chat or a suggested link shows its handle / host first.
  const h = x.kind === 'telegram' || x.source === 'crm' ? ufHandle(x.url) : null;
  return [h, about].filter(Boolean).join(' · ');
}
export function ufOpen(x) {
  if (x.kind === 'hunt') {
    const scr = String(x.url).replace(/^hunt:/, '');
    if (isGuest()) { if (D().me.guest?.areas?.places) go(sp('gplaces'), true); return; }
    go(sp(scr === 'spots' || scr === 'map' ? scr : 'spots'));
    return;
  }
  hap.sel();
  openLink(x.url);
}
export let ufFilter = 'all';
export function Useful() {
  const d = D();
  const [v, reload] = useUseful(d.search.id);
  const [f, setF0] = useState(ufFilter);
  const [allTg, setAllTg] = useState(false);
  const setF = (k) => { ufFilter = k; setF0(k); };
  const base = useBasePlaces(d.search.country);
  const nPlaces = base ? allPlaces(base).length : 0;
  const region = S.regions?.[d.search.country]?.name?.[LANG] ?? S.regions?.[d.search.country]?.name?.en ?? '';
  const kicker = v?.verified ? t('uf_kicker', { r: region, d: fmtDM(v.verified) }) : region || ' ';
  const canAdd = !!v?.can_suggest;
  const guest = isGuest();
  const items = (v?.items ?? []).filter((x) => !(guest && x.kind === 'hunt' && !d.me.guest?.areas?.places));
  const shown = items.filter((x) => ufMatch(x, f));
  const pending = f === 'all' ? v?.pending ?? [] : [];
  async function decide(x, status) {
    hap.sel();
    try { await api('/app/api/useful-decide', { search_id: d.search.id, id: x.id, status }); hap.ok(); toast(t(status === 'approved' ? 'uf_approved' : 'uf_rejected')); reload(); }
    catch { toast(t('err_generic')); }
  }
  const row = (x, trail, sub = ufSub(x, nPlaces)) => html`<div key=${x.id} class="w2-row uf-row" role="button" tabindex="0" onClick=${() => ufOpen(x)} onKeyDown=${(e) => e.key === 'Enter' && ufOpen(x)}>
    <span class="sq big"><${Icon} n=${x.icon && ICONS[x.icon] ? x.icon : UF_ICON[x.kind] ?? 'link'} /></span>
    <div class="grow"><b>${x.name}</b>${sub && html`<span>${sub}</span>`}${x.attribution && html`<span class="uf-attr">${t('uf_source', { s: x.attribution })}</span>`}</div>
    ${trail ?? html`<span class="chip uf-kind">${UF_BADGE[x.kind] ?? 'Web'}</span>`}</div>`;
  const pendTrail = (x) => (x.can_decide
    ? html`<span class="uf-dec"><${RoundBtn} ic="check" label=${t('uf_approve')} onClick=${() => decide(x, 'approved')} /><${RoundBtn} ic="x" cls="gray" label=${t('uf_reject')} onClick=${() => decide(x, 'rejected')} /></span>`
    : html`<span class="chip mango uf-kind">${t('uf_pending')}</span>`);
  return html`<main class="screen w2">
    <${W3Head} kicker=${kicker} title=${t('uf_title')}
      right=${canAdd && html`<button class="w3-plus" aria-label=${t('uf_add')} onClick=${() => openSheet('useful_add')}><${Icon} n="plus" cls="lg" /></button>`} />
    <div class="w3-chips" role="group">${UF_FILTERS.map((k) => html`<button key=${k} aria-pressed=${f === k ? 'true' : 'false'} onClick=${() => { hap.sel(); setF(k); }}>${t('uf_f_' + k)}</button>`)}</div>
    ${!v ? skel(220) : v.failed ? msgCard(t('err_generic')) : html`
      ${pending.length > 0 && html`<div class="card w2-list uf-pend"><div class="w2-lh"><span>${t(pending.some((x) => x.can_decide) ? 'uf_review' : 'uf_mine')}</span></div>
        ${pending.map((x) => row(x, pendTrail(x), [ufSub(x, nPlaces), x.can_decide && x.suggested_by_name ? t('uf_by', { name: firstName(x.suggested_by_name) }) : null].filter(Boolean).join(' · ')))}</div>`}
      ${UF_GROUPS.map((g) => ({ g, list: shown.filter((x) => ufGroup(x) === g) })).filter((x) => x.list.length).map(({ g, list }) => {
        // "Все": a long Telegram list folds to the first few (city chats first); the "Чаты" filter shows them all.
        const fold = g === 'telegram' && f === 'all' && !allTg && list.length > UF_FOLD;
        const vis = g === 'telegram' ? [...list.filter((x) => x.city), ...list.filter((x) => !x.city)] : list;
        return html`<div key=${g} class="card w2-list">
          <div class="w2-lh"><span>${t('uf_g_' + g)}</span></div>${(fold ? vis.slice(0, UF_FOLD) : vis).map((x) => row(x))}
          ${fold && html`<button class="w2-row uf-more" onClick=${() => { hap.sel(); setAllTg(true); }}><span class="grow">${t('uf_more', { n: list.length - UF_FOLD })}</span><${Icon} n="chevd" cls="sm muted" /></button>`}</div>`;
      })}
      ${!shown.length && !pending.length && msgCard(t('uf_none'))}`}
    ${guest ? html`<${GuestNav} tab="today" />` : html`<${Nav} tab=${typeof homeMode === 'function' && homeMode() ? 'more' : 'today'} />`}
  </main>`;
}
export function UsefulAddSheet() {
  const d = D();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [about, setAbout] = useState('');
  const [cat, setCat] = useState('chats_rent');
  const [busy, setBusy] = useState(false);
  const region = S.regions?.[d.search.country]?.name?.[LANG] ?? '';
  const urlOk = /^@[A-Za-z0-9_]{4,}$/.test(url.trim()) || /^(https:\/\/|t\.me\/)\S+\.?\S*$/i.test(url.trim());
  async function save() {
    if (!name.trim() || !urlOk) return;
    setBusy(true);
    try {
      const r = await api('/app/api/useful-suggest', { search_id: d.search.id, name: name.trim(), url: url.trim(), about: about.trim() || null, category: cat });
      hap.ok();
      toast(t(r.link?.status === 'approved' ? 'uf_approved' : 'uf_sent'));
      delete ufCache[d.search.id];
      ufRev++;
      closeSheet();
      go(sp('useful'), true);
    } catch (e) {
      toast(e.code === 'useful_exists' ? t('uf_exists') : e.code === 'bad_url' ? t('uf_bad_url') : e.code === 'sensitive' ? e.message : e.code === 'rate_limited' ? t('uf_rate') : t('err_generic'));
    }
    setBusy(false);
  }
  const chip = (on, label, fn) => html`<button class=${'bchip' + (on ? ' on' : ' off')} aria-pressed=${on ? 'true' : 'false'} onClick=${() => { hap.sel(); fn(); }}>${label}</button>`;
  return html`<h2>${t('uf_add')}</h2>
    <div class="x-form">
      <p class="e-lbl">${t('uf_name')}</p><input class="e-input" value=${name} maxlength="80" placeholder=${t('uf_name_ph')} onInput=${(e) => setName(e.currentTarget.value)} />
      <p class="e-lbl">${t('uf_link')}</p><input class="e-input" value=${url} inputmode="url" autocapitalize="off" placeholder=${t('uf_link_ph')} onInput=${(e) => setUrl(e.currentTarget.value)} />
      <p class="e-lbl">${t('uf_about')}</p><input class="e-input" value=${about} maxlength="200" placeholder=${t('uf_about_ph')} onInput=${(e) => setAbout(e.currentTarget.value)} />
      <p class="e-lbl">${t('uf_cat')}</p><div class="chips">${UF_CATS.map((k) => chip(cat === k, t('uf_c_' + k), () => setCat(k)))}</div>
      <p class="muted uf-note">${t(d.me.role === 'owner' ? 'uf_note_owner' : 'uf_note', { r: region })}</p>
    </div>
    <button class="btn accent block" style="margin-top:14px" disabled=${busy || !name.trim() || !urlOk} onClick=${save}>${t(d.me.role === 'owner' ? 'uf_add_btn_owner' : 'uf_add_btn')}</button>
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}
