import { api } from '../core/api.js';
import { D, canVoteRole, listingById } from '../core/data.js';
import { dayKey, fmtTime, shortTitle } from '../core/format.js';
import { pick2, t } from '../core/i18n.js';
import { go, sp } from '../core/routing.js';
import { closeSheet, hap, openSheet, toast } from '../core/store.js';
import { ICONS, Icon } from '../ui/icons.js';
import { BackIfWeb, pickFiles, regionPack, uploadImage } from './helpers.js';
import { html } from 'htm/preact';
import { useState } from 'preact/hooks';

// ---------------------------------------------------------------- on-site checklist (18)
/** The viewing the checklist belongs to: one that started (latest), else today's next, else none. */
export function onsiteViewing(lid) {
  const vs = (D()?.viewings ?? []).filter((v) => v.listing_id === lid);
  const now = Date.now();
  const started = vs.filter((v) => Date.parse(v.starts_at) <= now + 60 * 60e3);
  return started[started.length - 1] ?? vs.find((v) => dayKey(v.starts_at) === dayKey(new Date().toISOString())) ?? null;
}
export function Onsite({ id }) {
  const d = D();
  const l = listingById(id);
  const v = onsiteViewing(id);
  const vid = v?.id ?? '';
  const items = regionPack()?.checklist ?? [];
  const mineRows = () => (d.onsite ?? []).filter((r) => r.listing_id === id && r.viewing_id === vid && r.user_id === d.user.id);
  const [, force] = useState(0);
  const [up, setUp] = useState(false);
  if (!l || !canVoteRole(d.me.role)) return html`<main class="screen no-nav"><div class="center-msg">${t('err_generic')}</div></main>`;
  const rowOf = (item) => mineRows().find((r) => r.item === item);
  const photos = (d.onsite_photos ?? []).filter((p) => p.listing_id === id).reduce((a, p) => a + Number(p.n), 0);
  async function set(item, ok, note?) {
    let r = rowOf(item);
    if (!r) { r = { listing_id: id, viewing_id: vid, user_id: d.user.id, item, ok: null, note: null }; (d.onsite ??= []).push(r); }
    const body: Bag = { listing_id: id, viewing_id: vid, item, ok: ok === undefined ? (r.ok == null ? null : r.ok === 1) : ok };
    if (ok !== undefined) r.ok = ok == null ? null : ok ? 1 : 0;
    if (note !== undefined) { r.note = note; body.note = note; }
    hap.sel();
    force((x) => x + 1);
    try { await api('/app/api/onsite', body); } catch { toast(t('err_generic')); }
  }
  const tap = (it, ok) => {
    const r = rowOf(it.id);
    const cur = r?.ok == null ? null : r.ok === 1;
    const next = cur === ok ? null : ok;
    set(it.id, next);
    if (next === false && !r?.note) openSheet('onsite_note', { item: it, set });
  };
  async function addPhotos() {
    const files = await pickFiles({ multiple: true, capture: true });
    if (!files.length) return;
    setUp(true);
    try {
      let count = photos;
      for (const f of files) count = (await uploadImage(`/app/api/onsite-photo?listing_id=${encodeURIComponent(id)}&viewing_id=${encodeURIComponent(vid)}`, f)).count;
      const row = (d.onsite_photos ??= []).find((p) => p.listing_id === id);
      if (row) row.n = count; else d.onsite_photos.push({ listing_id: id, viewing_id: vid, n: count });
      hap.ok();
      toast(t('os_uploaded'));
    } catch { toast(t('err_generic')); }
    setUp(false);
  }
  const answered = items.filter((it) => rowOf(it.id)?.ok != null).length;
  const kicker = [v ? fmtTime(v.starts_at) : null, shortTitle(l.title)].filter(Boolean).join(' · ');
  return html`<main class="screen no-nav w2">
    <div class="head"><div class="row" style="align-items:flex-start"><${BackIfWeb} /><div><p class="kicker">${kicker}</p><h1 class="h1">${t('os_title')}</h1></div></div>
      ${items.length > 0 && html`<span class="os-count">${t('os_of', { x: answered, n: items.length })}</span>`}</div>
    ${items.length ? html`<div class="card w2-list">${items.map((it) => {
      const r = rowOf(it.id);
      const ok = r?.ok == null ? null : r.ok === 1;
      const label = pick2([it.label?.ru, it.label?.en]) ?? it.id;
      return html`<div key=${it.id} class="w2-row os-row">
        <${Icon} n=${ICONS[it.icon] ? it.icon : 'circle-dashed'} cls="os-ic" />
        <button class="grow os-txt" onClick=${() => openSheet('onsite_note', { item: it, set })}><span class="lb">${label}</span>${r?.note && html`<span class=${'nt' + (ok === false ? ' bad' : '')}>${r.note}</span>`}</button>
        <button class=${'os-b ok' + (ok === true ? ' on' : '')} aria-pressed=${ok === true ? 'true' : 'false'} aria-label=${t('yes')} onClick=${() => tap(it, true)}><${Icon} n="check" /></button>
        <button class=${'os-b no' + (ok === false ? ' on' : '')} aria-pressed=${ok === false ? 'true' : 'false'} aria-label=${t('no')} onClick=${() => tap(it, false)}><${Icon} n="x" /></button>
      </div>`;
    })}</div>` : html`<div class="card" style="padding:16px"><p class="muted" style="margin:0">${t('os_none')}</p></div>`}
    <div class="os-actions">
      <button class="btn surface" disabled=${up} onClick=${addPhotos}><${Icon} n="camera" />${photos ? t('os_photos', { n: photos }) : t('os_photo')}</button>
      <button class="btn accent" onClick=${() => go(sp('rate', id))}>${t('os_rate')}<${Icon} n="arrow-right" /></button>
    </div>
  </main>`;
}
export function OnsiteNoteSheet({ arg }) {
  const d = D();
  const it = arg.item;
  const cur = (d.onsite ?? []).find((r) => r.item === it.id && r.user_id === d.user.id);
  const [txt, setTxt] = useState(cur?.note ?? '');
  const save = () => { arg.set(it.id, undefined, txt.trim() || null); closeSheet(); };
  return html`<h2>${pick2([it.label?.ru, it.label?.en])}</h2>
    ${it.hint && html`<p class="muted" style="margin:0 0 12px">${pick2([it.hint.ru, it.hint.en])}</p>`}
    <input class="e-input" value=${txt} placeholder=${t('os_note_ph')} aria-label=${t('os_note')} onInput=${(e) => setTxt(e.currentTarget.value)} onKeyDown=${(e) => e.key === 'Enter' && save()} />
    <button class="btn accent block" style="margin-top:12px" onClick=${save}>${t('done')}</button>
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}
