// Split from app.js (wave 11): see the section comment below.
import { api } from '../core/api.js';
import { D, canVoteRole, districtShort, listingById, priceText } from '../core/data.js';
import { firstName, shortTitle } from '../core/format.js';
import { LANG, t } from '../core/i18n.js';
import { closeSheet, emit, hap, openSheet, toast } from '../core/store.js';
import { W2Head, regionPack } from '../home/helpers.js';
import { Icon } from '../ui/icons.js';
import { Nav } from '../ui/pieces.js';
import { areaName, areaOf, geoCache, useAreasGeo } from './districts.js';
import { html, useState } from 'https://unpkg.com/htm@3.1.1/preact/standalone.module.js';

// ---------------------------------------------------------------- flood risk (38)
export const FL_CLS = { low: 'ok', medium: 'mango', high: 'danger' };
export const FL_SRC_ICON = { terrain: 'map', chats: 'message-circle', notes: 'users', area: 'map-pin' };
export function areaFlood(l) {
  const areas = regionPack()?.areas ?? {};
  const id = areaOf(l, geoCache[D().search.country], areas);
  const a = id ? areas[id] : null;
  return a?.flood ? { id, a, level: a.flood.level, note: a.flood.note?.[LANG] ?? a.flood.note?.en ?? '' } : null;
}
export function Flood({ id }) {
  const d = D();
  useAreasGeo(d.search.country);
  const l = listingById(id);
  if (!l) return html`<main class="screen no-nav"><div class="center-msg">—</div></main>`;
  const f = l.flood ?? null;
  const af = areaFlood(l);
  const level = f?.level ?? af?.level ?? null;
  const sub = [districtShort(l), l.bedrooms != null ? t('br', { n: l.bedrooms }) : null, priceText(l)].filter(Boolean).join(' · ');
  const notes = f?.notes ?? [];
  const lv = ['low', 'medium', 'high'];
  const src = (f?.sources ?? []).filter((x) => x.kind !== 'area');
  return html`<main class="screen w2">
    <${W2Head} l=${l} title=${shortTitle(l.title)} sub=${sub} />
    ${level && html`<div class=${'fl-card ' + FL_CLS[level]}><div class="w3-warn-h"><${Icon} n="cloud-rain" /><b>${t('fl_title', { x: t('fl_' + level) })}</b></div>
      <div class="fl-bar">${lv.map((x, i) => html`<div class=${i <= lv.indexOf(level) ? 'on' : ''}><i></i><span class=${x === level ? 'cur' : ''}>${t('fl_l_' + x)}</span></div>`)}</div>
      ${(f?.summary || (!f && af)) && html`<p>${f?.summary ?? af.note}</p>`}</div>`}
    ${src.length || notes.length ? html`<div class="card w2-list"><div class="w2-lh"><span>${t('fl_sources')}</span></div>
      ${src.map((x) => html`<div class="w2-row w3-irow"><span class="sq big"><${Icon} n=${FL_SRC_ICON[x.kind] ?? 'info'} /></span><div class="grow"><b>${x.title || t('fl_' + x.kind)}</b>${x.text && html`<span>${x.text}</span>`}</div></div>`)}
      ${notes.length > 0 && html`<div class="w2-row w3-irow"><span class="sq big"><${Icon} n="users" /></span><div class="grow"><b>${t('fl_notes')}</b><span>${notes.slice(-3).map((n) => `${firstName(n.name)}: «${n.text}»`).join(' · ')}</span></div></div>`}
    </div>` : !f && html`<div class="card" style="padding:16px;margin-bottom:14px"><p class="muted" style="margin:0">${t('fl_none')}</p></div>`}
    ${af && html`<div class="card w2-list"><div class="w2-row w3-irow"><${Icon} n=${af.level === 'low' ? 'circle-check' : 'circle-alert'} cls=${af.level === 'low' ? 'pl-ic-ok' : 'pl-ic-over'} /><div class="grow"><b style="font-weight:500">${t('fl_area_line', { a: areaName(af.a), x: t('fl_' + af.level), n: LANG === 'ru' ? af.note.replace(/^./, (c) => c.toLowerCase()) : af.note })}</b></div></div></div>`}
    ${canVoteRole(d.me.role) && html`<button class="btn surface block" onClick=${() => openSheet('flood_note', l.id)}><${Icon} n="plus" cls="sm" />${t('fl_add')}</button>`}
    <${Nav} tab="listings" />
  </main>`;
}
export function FloodNoteSheet({ id }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try { const r = await api('/app/api/flood-note', { listing_id: id, text: text.trim() }); const l = listingById(id); if (l) l.flood = r.flood; hap.ok(); toast(t('fl_saved')); closeSheet(); emit(); }
    catch { toast(t('err_generic')); }
    setBusy(false);
  }
  return html`<h2>${t('fl_note_t')}</h2>
    <textarea class="e-input" rows="3" placeholder=${t('fl_note_ph')} value=${text} onInput=${(e) => setText(e.currentTarget.value)}></textarea>
    <button class="btn accent block" style="margin-top:12px" disabled=${busy || !text.trim()} onClick=${send}>${t('x_save')}</button>
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}
