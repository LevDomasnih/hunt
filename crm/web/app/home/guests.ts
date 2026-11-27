import { api } from '../core/api.js';
import { D, canVoteRole, minutesFor, photoUrl, sceneStyle } from '../core/data.js';
import { inTG } from '../core/env.js';
import { dayKey, firstName, fmtDayMonth, initial, km } from '../core/format.js';
import { cap, t } from '../core/i18n.js';
import { back, go, openLink, sp } from '../core/routing.js';
import { closeSheet, emit, hap, openSheet, toast } from '../core/store.js';
import { PT_ORDER, TYPE_EMOJI, TYPE_ICON, allPlaces, ptName, stars, useBasePlaces } from '../places/places.js';
import { channelLink } from '../screens/chats.js';
import { joinNames } from '../screens/deal.js';
import { Av, ICONS, Icon } from '../ui/icons.js';
import { Nav } from '../ui/pieces.js';
import { addDays, fmtDMshort } from './calendar.js';
import { RoundBtn, W3Head, askConfirm, copyText, genRu, homeName, hostNames, hostsGen, isGuest, mapLink, msgCard, rangeDM, shareTg, skel, telLink } from './helpers.js';
import { issueChip } from './house.js';
import { DG_BUILTIN, DG_ICON, dgName } from './people.js';
import { surfLine, useSurf } from './surf.js';
import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';

// ---------------------------------------------------------------- wave 5: guest guide (40)
export const RULE_ICON = { smoke: 'cigarette-off', water: 'droplets', zap: 'zap', trash: 'trash-2', moon: 'moon', key: 'key', car: 'car', dog: 'dog', pool: 'waves', shoe: 'footprints', info: 'info' };
export const RULE_KEYS = Object.keys(RULE_ICON);
export const guideCache: Bag = {};
export function useGuide(sid) {
  const [g, setG] = useState(guideCache[sid] ?? null);
  useEffect(() => {
    api('/app/api/guide?search_id=' + encodeURIComponent(sid)).then((j) => { guideCache[sid] = j.guide ?? {}; setG(guideCache[sid]); }).catch((e) => setG({ failed: true, code: e.code }));
  }, [sid]);
  return [g, (x) => { guideCache[sid] = x; setG(x); }];
}
export const guideEmpty = (g) => !g || (!g.address && !g.map_url && !g.wifi_name && !(g.rules ?? []).length && !g.note);
export function GuideBody({ g, bleed = false }) {
  const d = D();
  const [show, setShow] = useState(false);
  const ph = photoUrl(g.photo);
  const ml = mapLink(g.lat, g.lng, g.map_url);
  const title = g.title || (isGuest() ? d.home?.title : homeName()) || d.search.title;
  const places = (g.places ?? []).slice(0, 6);
  const em = (g.emergency ?? []).filter((x) => x.phone);
  const host = g.host;
  const hostLink = host?.tg_username ? `https://t.me/${String(host.tg_username).replace(/^@/, '')}` : null;
  return html`
    <div class=${'gd-hero' + (bleed ? ' bleed' : '')}>${ph ? html`<img src=${ph} alt="" decoding="async" />` : html`<div class="scene" style=${sceneStyle(d.search.country)}></div>`}</div>
    <p class="kicker">${hostNames().length ? t('gd_kicker', { h: hostsGen() }) : t('gd_title')}</p>
    <h1 class="h1 gd-h1">${title}</h1>
    ${(g.address || ml) && html`<div class="card gd-card"><${Icon} n="map-pin" cls="gd-ic" /><div class="grow gd-addr">${g.address || t('gd_map')}</div>
      ${ml && html`<button class="gd-pill acc" onClick=${() => openLink(ml)}>${t('gd_map')}</button>`}</div>`}
    ${g.wifi_name && html`<div class="card gd-card"><${Icon} n="wifi" cls="gd-ic" /><div class="grow"><b>${t('gd_wifi', { x: g.wifi_name })}</b>${g.wifi_password && html`<span>${t('gd_pass', { x: show ? g.wifi_password : '••••••••' })}</span>`}</div>
      ${g.wifi_password && html`<button class="gd-pill" onClick=${() => (show ? copyText(g.wifi_password) : setShow(true))}>${show ? t('gd_copy') : t('gd_show')}</button>`}</div>`}
    ${(g.rules ?? []).length > 0 && html`<div class="card w2-list"><div class="w2-lh"><span>${t('gd_rules')}</span></div>
      ${g.rules.map((r, i) => html`<div key=${i} class="w2-row w3-irow gd-rule"><${Icon} n=${RULE_ICON[r.icon] ?? 'info'} /><div class="grow">${r.text}</div></div>`)}</div>`}
    ${g.note && html`<div class="card w3-text"><p>${g.note}</p></div>`}
    ${places.length > 0 && html`<div class="gd-places">${places.map((p, i) => html`<div key=${i} class="card gd-place"><span>${p.emoji ?? TYPE_EMOJI[p.type] ?? '📍'} ${p.minutes != null ? t('em_min', { n: p.minutes }) : ptName(p.type)}</span><b>${p.name}</b></div>`)}</div>`}
    ${em.length > 0 && html`<div class="card w2-list"><div class="w2-lh"><span>${t('gd_emergency')}</span></div>
      ${em.map((x, i) => html`<div key=${i} class="w2-row w3-irow"><span class="sq mango"><${Icon} n="siren" /></span><div class="grow"><b>${x.label}</b><span>${x.phone}</span></div><${RoundBtn} ic="phone" label=${t('dr_call')} onClick=${() => openLink(telLink(x.phone))} /></div>`)}</div>`}
    ${host && html`<div class="card w2-list"><div class="w2-row w3-irow"><span class="letter-av">${initial(host.name)}</span><div class="grow"><b>${host.name}</b><span>${t('gd_host')}</span></div>
      ${hostLink && html`<${RoundBtn} ic="send" label=${t('gd_write')} onClick=${() => openLink(hostLink)} />`}</div></div>`}`;
}
export function GuideGuest() {
  const d = D();
  const [g] = useGuide(d.search.id);
  return html`<main class="screen gd-screen">
    ${!inTG && html`<button class="back-btn" aria-label=${t('back')} onClick=${back}><${Icon} n="left" /></button>`}
    ${g == null ? html`<div class="gd-hero bleed skeleton"></div>${skel(120)}` : g.failed ? html`<div style="height:calc(var(--safe-top) + 60px)"></div>${msgCard(t('err_generic'))}`
      : html`<${GuideBody} g=${g} bleed />${guideEmpty(g) && msgCard(t('gd_empty'))}`}
    <${GuestNav} tab="today" />
  </main>`;
}
export function GuideMember() {
  const d = D();
  const [g, setG] = useGuide(d.search.id);
  const [mode, setMode] = useState(null);
  const [f, setF] = useState(null);
  const [showPw, setShowPw] = useState(false);
  const [icAt, setIcAt] = useState(-1);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!g || g.failed || f) return;
    setF({ address: g.address ?? '', map_url: g.map_url ?? '', wifi_name: g.wifi_name ?? '', wifi_password: g.wifi_password ?? '', note: g.note ?? '',
      rules: (g.rules ?? []).map((r) => ({ icon: RULE_ICON[r.icon] ? r.icon : 'info', text: r.text ?? '' })) });
  }, [g]);
  const m = mode ?? (guideEmpty(g) ? 'edit' : 'view');
  const set = (k, val) => setF({ ...f, [k]: val });
  const setRule = (i, patch) => set('rules', f.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  async function save() {
    setBusy(true);
    try {
      const body = { address: f.address.trim() || null, map_url: f.map_url.trim() || null, wifi_name: f.wifi_name.trim() || null, wifi_password: f.wifi_password || null, note: f.note.trim() || null,
        rules: f.rules.filter((r) => r.text.trim()).map((r) => ({ icon: r.icon, text: r.text.trim() })) };
      const r = await api('/app/api/guide', { search_id: d.search.id, ...body });
      setG({ ...g, ...body, ...(r.guide ?? {}) });
      setF(null);
      hap.ok(); toast(t('gd_saved')); setMode('view'); window.scrollTo(0, 0);
    } catch (e) { toast(e.code === 'sensitive' ? t('gd_sensitive') : t('err_generic')); }
    setBusy(false);
  }
  async function link(action) {
    if (action === 'regenerate' && !(await askConfirm(t('gd_regen_q')))) return null;
    if (action === 'revoke' && !(await askConfirm(t('gd_revoke_q')))) return null;
    try {
      const r = await api('/app/api/guide-link', { search_id: d.search.id, action });
      setG({ ...guideCache[d.search.id], url: r.url ?? null });
      D().guide_ready = !!r.url;
      emit();
      if (action === 'regenerate') toast(t('gd_regen_ok'));
      if (action === 'revoke') { hap.ok(); toast(t('gd_revoked')); }
      return r.url ?? null;
    } catch { toast(t('err_generic')); return null; }
  }
  const share = async () => { const url = await link('share'); if (url) shareTg(url, t('gd_share_text')); };
  const copy = async () => { const url = g.url || (await link('share')); if (url) copyText(url); };
  const lrow = (ic, label, onClick, cls = '') => html`<button class="w2-row w3-irow" onClick=${onClick}><span class=${'sq ' + cls}><${Icon} n=${ic} /></span><div class="grow"><b>${label}</b></div></button>`;
  let body;
  if (g == null || (!g.failed && !f && m === 'edit')) body = skel(260);
  else if (g.failed) body = msgCard(t('err_generic'));
  else {
    const editor = f && html`<div class="x-form gd-form">
        <p class="e-lbl">${t('gd_address')}</p><textarea class="e-input" rows="2" placeholder=${t('gd_address_ph')} value=${f.address} onInput=${(e) => set('address', e.currentTarget.value)}></textarea>
        <p class="e-lbl">${t('gd_map_url')}</p><input class="e-input" inputmode="url" placeholder="https://maps.app.goo.gl/…" value=${f.map_url} onInput=${(e) => set('map_url', e.currentTarget.value)} />
        <p class="e-lbl">${t('gd_wifi_name')}</p><input class="e-input" value=${f.wifi_name} placeholder="ToyaNing_5G" onInput=${(e) => set('wifi_name', e.currentTarget.value)} />
        <p class="e-lbl">${t('gd_wifi_pass')}</p><div class="gd-pw"><input class="e-input" type=${showPw ? 'text' : 'password'} autocomplete="off" value=${f.wifi_password} onInput=${(e) => set('wifi_password', e.currentTarget.value)} />
          <button class="gd-pill" aria-pressed=${showPw ? 'true' : 'false'} onClick=${() => setShowPw(!showPw)}>${showPw ? t('gd_hide') : t('gd_show')}</button></div>
        <p class="e-lbl">${t('gd_rules')}</p>
        <div class="card w2-list gd-rules-ed">
          ${f.rules.map((r, i) => html`<div key=${i} class="gd-rule-ed">
            <div class="gd-rule-row"><button class="gd-ic-btn" aria-label=${t('gd_rule_icon') + ': ' + t('gd_ic_' + r.icon)} aria-expanded=${icAt === i ? 'true' : 'false'} onClick=${() => setIcAt(icAt === i ? -1 : i)}><${Icon} n=${RULE_ICON[r.icon] ?? 'info'} /></button>
              <input class="gd-rule-in" value=${r.text} placeholder=${t('gd_rule_ph')} aria-label=${t('gd_rules')} onInput=${(e) => setRule(i, { text: e.currentTarget.value })} />
              <button class="icon-btn" aria-label=${t('gd_rule_del')} onClick=${() => { set('rules', f.rules.filter((_, j) => j !== i)); setIcAt(-1); }}><${Icon} n="x" cls="sm" /></button></div>
            ${icAt === i && html`<div class="gd-icons" role="group" aria-label=${t('gd_rule_icon')}>${RULE_KEYS.map((k) => html`<button key=${k} class=${'gd-ic-opt' + (r.icon === k ? ' on' : '')} aria-pressed=${r.icon === k ? 'true' : 'false'} aria-label=${t('gd_ic_' + k)} title=${t('gd_ic_' + k)} onClick=${() => { hap.sel(); setRule(i, { icon: k }); setIcAt(-1); }}><${Icon} n=${RULE_ICON[k]} /></button>`)}</div>`}
          </div>`)}
          ${f.rules.length < 12 && html`<button class="w2-add gd-add" onClick=${() => { set('rules', [...f.rules, { icon: 'info', text: '' }]); setIcAt(f.rules.length); }}><${Icon} n="plus" cls="sm" />${t('gd_rule_add')}</button>`}
        </div>
        <p class="e-lbl">${t('gd_note')}</p><textarea class="e-input" rows="2" placeholder=${t('gd_note_ph')} value=${f.note} onInput=${(e) => set('note', e.currentTarget.value)}></textarea>
      </div>
      <button class="btn accent block big" style="margin:16px 0 14px" disabled=${busy} onClick=${save}><${Icon} n="check" />${t('gd_save')}</button>`;
    body = html`
      <div class="seg full gd-seg" role="group">
        <button aria-pressed=${m === 'view' ? 'true' : 'false'} onClick=${() => { hap.sel(); setMode('view'); }}>${t('gd_view')}</button>
        <button aria-pressed=${m === 'edit' ? 'true' : 'false'} onClick=${() => { hap.sel(); setMode('edit'); }}>${t('gd_edit')}</button>
      </div>
      ${m === 'view' ? (guideEmpty(g) ? msgCard(t('gd_empty_member')) : html`<div class="gd-preview"><${GuideBody} g=${g} /></div>`) : editor}
      <div class="card w2-list">
        <div class="w2-lh"><span>${t('gd_link')}</span></div>
        <div class="w2-row"><span class="muted" style="margin:0">${g.url ? t('gd_link_on') : t('gd_link_none')}</span></div>
        ${lrow('send', t('gd_share'), share)}
        ${lrow('copy', t('gd_copy_link'), copy)}
        ${g.url && lrow('refresh-cw', t('gd_regen'), () => link('regenerate'))}
        ${g.url && lrow('ban', t('gd_revoke'), () => link('revoke'), 'mango')}
      </div>`;
  }
  return html`<main class="screen w2">
    <${W3Head} kicker=${homeName()} title=${t('gd_title')} />
    ${body}
    <${Nav} tab="today" />
  </main>`;
}

// ---------------------------------------------------------------- wave 5: guests (44, 44b)
export const GAREAS = [['guide', 'key'], ['places', 'map'], ['contacts', 'users'], ['issues', 'wrench']];
export function GuestNav({ tab }) {
  const a = D()?.me?.guest?.areas ?? {};
  const items = [['today', 'house', 'gs_nav_home'], a.places && ['gplaces', 'map', 'gs_nav_places'], a.contacts && ['gcontacts', 'users', 'gs_nav_contacts']].filter(Boolean);
  return html`<nav class="nav" aria-label="Hunt">
    ${items.map(([k, ic, lb]) => html`<a key=${k} href=${'#' + sp(k)} aria-current=${tab === k ? 'page' : null} aria-label=${t(lb)}
      onClick=${(e) => { e.preventDefault(); if (tab !== k) { hap.sel(); go(sp(k), true); } }}><${Icon} n=${ic} /><span>${t(lb)}</span></a>`)}
  </nav>`;
}
export const guestTitle = () => D()?.home?.title || D()?.search?.title || '';
export function GuestSurfCard({ v }) {
  const line = surfLine(v);
  return line ? html`<button class="card gs-surf" onClick=${() => go(sp('surf'))}><${Icon} n="waves" /><span>${line}</span></button>` : null;
}
export function GuestHome() {
  const d = D();
  const g = d.me.guest ?? {};
  const a = g.areas ?? {};
  const sv = useSurf(d.search.id, !!a.places);
  const hosts = (g.hosts ?? []).map(genRu);
  const kicker = [hosts.length ? t('gs_kicker', { h: joinNames(hosts) }) : t('gs_kicker0'), g.from && g.to ? rangeDM(g.from, g.to) : null].filter(Boolean).join(' · ');
  const sees = [a.guide && t('gs_a_guide'), a.places && t('gs_a_places'), a.contacts && t('gs_a_contacts')].filter(Boolean);
  const until = g.to ? fmtDMshort(g.to) : '—';
  const tile = (k, ic, onClick) => html`<button key=${k} class="card gs-tile" onClick=${onClick}><span class="sq"><${Icon} n=${ic} /></span><b>${t('gs_' + k)}</b><span>${t('gs_' + k + '_sub')}</span></button>`;
  const tiles = [a.guide && tile('guide', 'key', () => go(sp('guide'))), a.places && tile('places', 'map', () => go(sp('gplaces'), true)),
    a.contacts && tile('contacts', 'users', () => go(sp('gcontacts'), true)), a.issues && tile('issue', 'wrench', () => openSheet('issue'))].filter(Boolean);
  const issues = a.issues ? d.issues ?? [] : [];
  return html`<main class="screen w2">
    <div class="head"><div><p class="kicker">${kicker}</p><h1 class="h1 w3-h1">${guestTitle()}</h1></div>
      <button class="gs-me" aria-label=${t('settings')} onClick=${() => openSheet('settings')}><${Av} m=${{ animal: d.me.animal, name: d.user.display_name }} size=${56} /></button></div>
    <div class="gs-banner"><${Icon} n="user" /><span>${sees.length ? t('gs_banner', { x: joinNames(sees), d: until }) : t('gs_banner0', { d: until })}</span></div>
    ${tiles.length > 0 && html`<div class="gs-tiles">${tiles}</div>`}
    ${a.places && html`<${GuestSurfCard} v=${sv} />`}
    ${issues.length > 0 && html`<div class="card w2-list"><div class="w2-lh"><span>${t('gs_my_issues')}</span></div>
      ${issues.map((i) => html`<div key=${i.id} class="w2-row is-row"><div class="grow"><div class="is-hd"><b>${i.title}</b>${issueChip(i)}</div>${i.note && html`<span>${i.note}</span>`}</div></div>`)}</div>`}
    <p class="w5-foot"><${Icon} n="lock" /><span>${t('gs_lock')}</span></p>
    <${GuestNav} tab="today" />
  </main>`;
}
export let gpType = 'all';
export function GuestPlaces() {
  const d = D();
  const base = useBasePlaces(d.search.country);
  const sv = useSurf(d.search.id, true);
  const [type, setType0] = useState(gpType);
  const setType = (k) => { gpType = k; setType0(k); };
  const home = d.home?.lat != null ? [d.home.lat, d.home.lng] : null;
  const all = allPlaces(base).filter((p) => p.lat != null && !['construction', 'daytrip'].includes(p.type))
    .map((p) => ({ ...p, min: home ? minutesFor(km(home, [p.lat, p.lng])) : null }))
    .filter((p) => p.min == null || p.min <= 40)
    .sort((a, b) => (a.min ?? 999) - (b.min ?? 999) || a.tier - b.tier);
  const types = PT_ORDER.filter((ty) => all.some((p) => p.type === ty));
  const shown = all.filter((p) => type === 'all' || p.type === type).slice(0, 60);
  return html`<main class="screen w2">
    <div class="head w3-head"><div><p class="kicker">${guestTitle()}</p><h1 class="h1 w3-h1">${t('gs_places')}</h1></div></div>
    <${GuestSurfCard} v=${sv} />
    ${types.length > 1 && html`<div class="w3-chips" role="group">
      <button aria-pressed=${type === 'all' ? 'true' : 'false'} onClick=${() => setType('all')}>${t('sp_all')}</button>
      ${types.map((ty) => html`<button key=${ty} class="ic-chip" aria-pressed=${type === ty ? 'true' : 'false'} onClick=${() => { hap.sel(); setType(ty); }}><${Icon} n=${TYPE_ICON[ty] ?? 'map-pin'} cls="sm" />${ptName(ty)}</button>`)}
    </div>`}
    ${shown.length ? html`<div class="card w2-list">${shown.map((p) => html`<button key=${p.id} class="w2-row w3-irow" onClick=${() => openLink(mapLink(p.lat, p.lng))}>
        <span class="sq big"><${Icon} n=${TYPE_ICON[p.type] ?? 'map-pin'} /></span>
        <div class="grow"><b>${p.name}</b><span>${[p.min != null ? t('em_min', { n: p.min }) : null, ptName(p.type), p.note ? p.note.replace(/^./, (c) => c.toLowerCase()) : null].filter(Boolean).join(' · ')}</span></div>
        <span class="sp-stars" aria-label=${t('sp_tier') + ' ' + p.tier}>${stars(p.tier)}</span></button>`)}</div>`
      : msgCard(base ? t('gs_places_none') : '…')}
    <${GuestNav} tab="gplaces" />
  </main>`;
}
export const dirWrite = (e) => (e.channel === 'whatsapp' || e.channel === 'telegram' ? channelLink(e.channel, e.address) : null);
export function GuestContacts() {
  const d = D();
  const all = d.directory ?? [];
  const ord = (k) => { const i = DG_BUILTIN.indexOf(k); return i < 0 ? 99 : i; };
  const groups = [...new Set(all.map((e) => e.grp))].sort((a, b) => ord(a) - ord(b));
  return html`<main class="screen w2">
    <div class="head w3-head"><div><p class="kicker">${guestTitle()}</p><h1 class="h1 w3-h1">${t('gs_contacts')}</h1></div></div>
    ${groups.length ? groups.map((k) => html`<div key=${k} class="card w2-list"><div class="w2-lh"><span>${dgName(k, true)}</span></div>
      ${all.filter((e) => e.grp === k).map((e) => {
        const wl = dirWrite(e);
        const ph = e.phone || (e.channel === 'phone' ? e.address : null);
        const ml = e.channel === 'map' || (!wl && !ph) ? mapLink(e.lat, e.lng, e.map_url) : null;
        return html`<div key=${e.id} class="w2-row w3-irow dr-row" role="button" tabindex="0" onClick=${() => openSheet('gcontact', e.id)} onKeyDown=${(ev) => ev.key === 'Enter' && openSheet('gcontact', e.id)}>
          <span class="sq big"><${Icon} n=${e.icon && ICONS[e.icon] ? e.icon : DG_ICON[e.grp] ?? 'store'} /></span>
          <div class="grow"><b>${e.name}</b>${e.subtitle && html`<span>${e.subtitle}</span>`}</div>
          <div class="dr-btns">${wl && html`<span class="dr-w" role="button" tabindex="0" aria-label=${t('dr_write')} onClick=${(ev) => { ev.stopPropagation(); openLink(wl); }}><${Icon} n="message-circle" />${e.channel === 'whatsapp' ? 'WA' : 'TG'}</span>`}
            ${ph && html`<${RoundBtn} ic="phone" label=${t('dr_call')} onClick=${() => openLink(telLink(ph))} />`}
            ${ml && html`<${RoundBtn} ic="map-pin" cls="gray" label=${t('dr_map')} onClick=${() => openLink(ml)} />`}</div></div>`;
      })}</div>`) : msgCard(t('gs_contacts_none'))}
    <${GuestNav} tab="gcontacts" />
  </main>`;
}
export function GuestContactSheet({ id }) {
  const d = D();
  const e = (d.directory ?? []).find((x) => x.id === id);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  if (!e) return html`<p class="muted">—</p><button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
  const wl = dirWrite(e);
  const ph = e.phone || (e.channel === 'phone' ? e.address : null);
  const ml = mapLink(e.lat, e.lng, e.map_url);
  async function ask() {
    setBusy(true);
    try { await api('/app/api/guest-message', { search_id: d.search.id, directory_id: e.id, text: text.trim() }); hap.ok(); toast(t('gs_ask_sent')); closeSheet(); }
    catch { toast(t('err_generic')); }
    setBusy(false);
  }
  return html`<h2>${e.name}</h2>${e.subtitle && html`<p class="muted" style="margin:0 0 12px">${e.subtitle}</p>`}
    <div class="doc-actions">
      ${wl && html`<button class="btn accent" onClick=${() => openLink(wl)}><${Icon} n="message-circle" />${t('dr_write')}</button>`}
      ${ph && html`<button class="btn surface outline" onClick=${() => openLink(telLink(ph))}><${Icon} n="phone" />${t('dr_call')}</button>`}
      ${ml && html`<button class="btn surface outline" onClick=${() => openLink(ml)}><${Icon} n="map-pin" />${t('dr_map')}</button>`}
    </div>
    ${wl && html`<p class="section" style="margin-top:4px">${t('gs_ask')}</p><p class="muted" style="margin:0 0 10px;font-size:14px">${t('gs_ask_text')}</p>
      <textarea class="e-input" rows="3" placeholder=${t('gs_ask_ph')} value=${text} onInput=${(ev) => setText(ev.currentTarget.value)}></textarea>
      <button class="btn surface block" style="margin-top:10px" disabled=${busy || !text.trim()} onClick=${ask}><${Icon} n="sparkles" cls="sm" />${t('gs_ask')}</button>`}
    <button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
}
export function GuestsScreen() {
  const d = D();
  const today = dayKey(new Date().toISOString());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 7));
  const [areas, setAreas] = useState({ guide: true, places: true, contacts: true, issues: true });
  const [link, setLink] = useState(null);
  const [busy, setBusy] = useState(false);
  const active = (d.guests ?? []).filter((g) => g.status === 'active');
  async function invite() {
    if (to < from) return toast(t('gi_bad_dates'));
    if (!Object.values(areas).some(Boolean)) return toast(t('gi_no_areas'));
    setBusy(true);
    try {
      const r = await api('/app/api/guest-invite', { search_id: d.search.id, from, to, areas });
      setLink(r.link);
      hap.ok();
      if (r.link) shareTg(r.link, t('gi_share_text'));
    } catch { toast(t('err_generic')); }
    setBusy(false);
  }
  async function upd(g, body, msg) {
    try { const r = await api('/app/api/guest', { search_id: d.search.id, user_id: g.user_id, ...body }); if (r.guests) D().guests = r.guests; hap.ok(); toast(msg); emit(); }
    catch { toast(t('err_generic')); }
  }
  const extend = (g) => { const nt = addDays(g.to > today ? g.to : today, 7); upd(g, { to: nt }, t('gi_extended', { d: fmtDMshort(nt) })); };
  const revoke = async (g) => { if (await askConfirm(t('gi_revoke_q', { x: firstName(g.name) }))) upd(g, { revoke: true }, t('gi_revoked')); };
  const areaTxt = (a) => GAREAS.filter(([k]) => a?.[k]).map(([k]) => t('gi_a_' + k)).join(', ');
  const dateCard = (lbl, val, set, min) => html`<label class="card gi-date"><span>${lbl}</span><b>${val ? fmtDayMonth(val) : '—'}</b>
    <input type="date" value=${val} min=${min} aria-label=${lbl} onInput=${(e) => e.currentTarget.value && set(e.currentTarget.value)} /></label>`;
  return html`<main class="screen w2">
    <${W3Head} kicker=${t('gi_kicker', { h: homeName() })} title=${t('gi_title')} />
    ${active.length > 0 && html`<div class="card w2-list"><div class="w2-lh"><span>${t('gi_now')}</span></div>
      ${active.map((g) => html`<div key=${g.user_id} class="w2-row gi-row"><${Av} m=${g} size=${44} /><div class="grow"><b>${g.name}</b><span>${[rangeDM(g.from, g.to), areaTxt(g.areas)].filter(Boolean).join(' · ')}</span>
        <div class="gi-btns"><button class="gi-btn" onClick=${() => extend(g)}>${t('gi_extend')}</button><button class="gi-btn gray" onClick=${() => revoke(g)}>${t('gi_revoke')}</button></div></div></div>`)}</div>`}
    <div class="gi-dates">${dateCard(t('gi_from'), from, (v) => { setFrom(v); if (to < v) setTo(addDays(v, 7)); }, today)}${dateCard(t('gi_to'), to, setTo, from)}</div>
    <div class="card w2-list"><div class="w2-lh"><span>${t('gi_sees')}</span></div>
      ${GAREAS.map(([k, ic]) => html`<button key=${k} class="gt-row" role="switch" aria-checked=${areas[k] ? 'true' : 'false'} onClick=${() => { hap.sel(); setAreas({ ...areas, [k]: !areas[k] }); }}>
        <${Icon} n=${ic} /><span class="grow">${t('gi_' + k)}</span><span class=${'sw' + (areas[k] ? ' on' : '')}><i></i></span></button>`)}
      ${[['money', 'wallet'], ['docs', 'file-text'], ['chats', 'msgs']].map(([k, ic]) => html`<div key=${k} class="gt-row off" role="switch" aria-checked="false" aria-disabled="true">
        <${Icon} n=${ic} /><span class="grow">${t('gi_' + k)}</span><span class="sw"><i></i></span></div>`)}
    </div>
    <button class="btn accent block big" disabled=${busy} onClick=${invite}><${Icon} n="send" />${t('gi_send')}</button>
    ${link && html`<button class="btn surface block w3-second" onClick=${() => copyText(link)}><${Icon} n="copy" />${t('gi_copy')}</button>`}
    <p class="w2-foot">${cap(t('gi_foot', { d: fmtDayMonth(to) }))}</p>
    <${Nav} tab="today" />
  </main>`;
}
export function GuestDraftCard({ x }) {
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(x.text ?? '');
  const [busy, setBusy] = useState(false);
  async function act(action) {
    setBusy(true);
    try {
      await api('/app/api/draft', { draft_id: x.id, action, ...(action === 'send' && text !== x.text ? { text } : {}) });
      D().guest_drafts = (D().guest_drafts ?? []).filter((y) => y.id !== x.id);
      hap.ok(); toast(t(action === 'send' ? 'gq_sent' : 'gq_skipped')); emit();
    } catch { toast(t('err_generic')); }
    setBusy(false);
  }
  return html`<div class="card gq-card">
    <div class="gq-h"><${Icon} n="message-circle" /><b>${t('gq_req', { g: firstName(x.requester_name) || '?', c: x.dir_name || x.address || '' })}</b></div>
    ${edit ? html`<textarea class="e-input" rows="3" value=${text} onInput=${(e) => setText(e.currentTarget.value)}></textarea>` : html`<p class="gq-text">«${text}»</p>`}
    <div class="gq-btns"><button class="btn accent" disabled=${busy || !text.trim()} onClick=${() => act('send')}><${Icon} n="send" cls="sm" />${t('gq_send')}</button>
      <button class="btn surface outline" disabled=${busy} onClick=${() => act('skip')}>${t('gq_skip')}</button></div>
    ${!edit && html`<button class="btn link gq-edit" onClick=${() => setEdit(true)}><${Icon} n="pencil" cls="sm" />${t('gq_edit')}</button>`}
  </div>`;
}
export function GuestDrafts() {
  const d = D();
  const xs = d.guest_drafts ?? [];
  if (!xs.length || !canVoteRole(d.me.role)) return null;
  return html`${xs.map((x) => html`<${GuestDraftCard} key=${x.id} x=${x} />`)}`;
}
