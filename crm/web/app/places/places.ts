import { api, cssVar, refresh } from '../core/api.js';
import { D, canVoteRole, districtShort, listingById, minutesFor, photosOf, priceText, subRegion } from '../core/data.js';
import { fmtNum, km, shortTitle } from '../core/format.js';
import { LANG, STR, cap, human, t } from '../core/i18n.js';
import { go, openLink, sp } from '../core/routing.js';
import { S, closeSheet, emit, hap, openSheet, toast } from '../core/store.js';
import { BackIfWeb, W2Head, W3Head, dealListing, mapLink, postInstruction, regionPack } from '../home/helpers.js';
import { likedList } from '../screens/listings.js';
import { loadML, useThemeKey } from '../screens/map.js';
import { Icon, Img } from '../ui/icons.js';
import { Nav } from '../ui/pieces.js';
import { areaName, areaOf, districtStyle, useAreasGeo } from './districts.js';
import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';

// ---------------------------------------------------------------- places near (27)
export const AT_ICON = { surf: 'waves', beach: 'tree-palm', cowork: 'laptop', gym: 'dumbbell', yoga: 'heart-pulse', shop: 'shopping-cart', school: 'school', airport: 'plane', work: 'briefcase', friends: 'users', cafe: 'coffee', other: 'map-pin' };
export const AT_TYPES = Object.keys(AT_ICON);
export function anchorsOf() {
  const b = D()?.search?.brief ?? {};
  const out = [...(b.anchors ?? [])];
  if (b.anchor && !out.some((a) => a.id === 'anchor')) {
    const type = b.anchor.icon === 'waves' ? 'surf' : b.anchor.icon === 'plane' ? 'airport' : 'other';
    out.unshift({ id: 'anchor', name: b.anchor.label ?? '—', type, lat: b.anchor.lat, lng: b.anchor.lng, max_minutes: b.anchor.max_minutes ?? null, legacy: true });
  }
  return out;
}
/** Minutes from a listing to an anchor: the agent's route time, else a straight-line estimate (est: true). */
export function travelTo(l, a) {
  const tr = l?.travel?.[a.id];
  if (tr?.min != null) return { min: tr.min, mode: tr.mode ?? a.mode, est: false };
  if (l?.lat == null || a.lat == null) return null;
  return { min: minutesFor(km([l.lat, l.lng], [a.lat, a.lng])), mode: a.mode, est: true };
}
export function modeWord(m?) {
  if (m === 'walk' || m === 'pedestrian') return t('pl_walk');
  if (m === 'car' || m === 'auto') return t('pl_car');
  if (m === 'taxi') return t('pl_taxi');
  if (m === 'scooter' || m === 'motor_scooter') return t('pl_by');
  const r = D()?.search?.brief?.travel_mode || subRegion()?.travel?.mode || '';
  return /scooter/.test(r) ? t('pl_by') : /taxi|car/.test(r) ? t('pl_taxi') : '';
}
export function placesSummary(l) {
  const as = anchorsOf();
  if (!as.length) return null;
  const tr = as.map((a) => ({ a, x: travelTo(l, a) })).filter((y) => y.x);
  if (!tr.length) return null;
  const lim = tr.filter((y) => y.a.max_minutes);
  const ok = lim.filter((y) => y.x.min <= y.a.max_minutes);
  const over = lim.filter((y) => y.x.min > y.a.max_minutes);
  return [lim.length ? t('pl_row', { n: ok.length, m: lim.length }) : null, ...over.slice(0, 2).map((y) => `${y.a.name} ${y.x.est ? '~' : ''}${y.x.min}`)].filter(Boolean).join(' · ');
}
export function shortlistCompare(l) {
  const others = likedList(D()).filter((x) => x.id !== l.id);
  const as = anchorsOf();
  const close = [], far = [];
  for (const a of as) {
    const me = travelTo(l, a);
    if (!me) continue;
    const os = others.map((o) => ({ o, x: travelTo(o, a) })).filter((y) => y.x);
    if (!os.length) continue;
    const name = a.type && a.type !== 'other' && as.filter((y) => y.type === a.type).length === 1 ? t('at_' + a.type) : a.name;
    if (os.every((y) => me.min < y.x.min)) close.push(name);
    else {
      const better = os.filter((y) => y.x.min + 4 < me.min).sort((p, q) => p.x.min - q.x.min).slice(0, 2);
      if (better.length && (a.max_minutes ? me.min > a.max_minutes : true)) far.push({ name, list: better.map((y) => `${districtShort(y.o) || shortTitle(y.o.title)} (${t('em_min', { n: y.x.min })})`) });
    }
  }
  const andW = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} ${t('and')} ${xs[xs.length - 1]}` : xs[0]);
  const parts = [];
  if (close.length) parts.push(t('pl_closest', { a: andW(close.slice(0, 2)) }));
  for (const f of far.slice(0, 1)) parts.push(t('pl_farther', { a: cap(f.name), list: andW(f.list) }));
  return parts.length ? parts.join(' ') : others.length ? t('pl_same') : null;
}
export function Places({ id }) {
  const d = D();
  const l = listingById(id);
  if (!l) return html`<main class="screen no-nav"><div class="center-msg">—</div></main>`;
  const as = anchorsOf();
  const canEdit = canVoteRole(d.me.role);
  const sub = [districtShort(l), l.bedrooms != null ? t('br', { n: l.bedrooms }) : null, priceText(l)].filter(Boolean).join(' · ');
  const cmp = shortlistCompare(l);
  let anyEst = false;
  return html`<main class="screen w2">
    <${W2Head} l=${l} title=${shortTitle(l.title)} sub=${sub} />
    <div class="card w2-list">
      <div class="w2-lh"><span>${t('pl_title')}</span>${canEdit && html`<button class="w2-add" onClick=${() => openSheet('anchor_add')}><${Icon} n="plus" cls="sm" />${t('add')}</button>`}</div>
      ${as.length ? as.map((a) => {
        const x = travelTo(l, a);
        if (x?.est) anyEst = true;
        const over = x && a.max_minutes && x.min > a.max_minutes;
        const mw = x ? modeWord(x.mode) : '';
        const txt = x ? `${x.est ? '~' : ''}${t('em_min', { n: x.min })}${mw ? ' ' + mw : ''}${over ? ' · ' + t('pl_limit', { n: a.max_minutes }) : ''}` : '—';
        return html`<button key=${a.id} class="w2-row w3-irow" onClick=${() => openSheet('anchor', a.id)}><span class=${'sq big' + (over ? ' mango' : '')}><${Icon} n=${AT_ICON[a.type] ?? 'map-pin'} /></span>
          <div class="grow"><b>${a.name}</b><span class=${over ? 'pl-over' : ''}>${txt}</span></div>
          ${x && a.max_minutes ? html`<${Icon} n=${over ? 'circle-alert' : 'circle-check'} cls=${over ? 'pl-ic-over' : 'pl-ic-ok'} />` : null}</button>`;
      }) : html`<div class="w2-row"><span class="muted">${t('pl_none')}</span></div>`}
    </div>
    ${cmp && html`<div class="card w3-text"><p class="w3-ct">${t('pl_cmp')}</p><p>${cmp}</p></div>`}
    <p class="w2-foot">${t('pl_foot')}${anyEst ? ' ' + t('pl_est') : ''}</p>
    <${Nav} tab="listings" />
  </main>`;
}
export function AnchorAddSheet() {
  const d = D();
  const [name, setName] = useState('');
  const [type, setType] = useState('surf');
  const [where, setWhere] = useState('');
  const [max, setMax] = useState(20);
  const [mode, setMode] = useState(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    const m = where.trim().match(/^(-?\d{1,2}\.\d+)\s*[,; ]\s*(-?\d{1,3}\.\d+)$/);
    const anchor = { name: name.trim(), type, max_minutes: max, mode, ...(m ? { lat: Number(m[1]), lng: Number(m[2]) } : { map_url: where.trim() }) };
    if (!anchor.name || !where.trim()) return;
    setBusy(true);
    try {
      const r = await api('/app/api/anchor', { search_id: d.search.id, anchor });
      d.search.brief.anchors = r.anchors;
      hap.ok(); toast(t('pl_saved')); closeSheet(); emit();
    } catch (e) { toast(e.code === 'no_point' ? t('pl_bad_point') : t('err_generic')); }
    setBusy(false);
  }
  const chip = (on, label, f, ic?) => html`<button class=${'bchip' + (on ? ' on' : ' off')} aria-pressed=${on ? 'true' : 'false'} onClick=${() => { hap.sel(); f(); }}>${ic && html`<${Icon} n=${ic} cls="xs" />`}${label}</button>`;
  return html`<h2>${t('pl_add')}</h2>
    <div class="x-form">
      <p class="e-lbl">${t('pl_name')}</p><input class="e-input" value=${name} placeholder=${t('pl_name_ph')} onInput=${(e) => setName(e.currentTarget.value)} />
      <p class="e-lbl">${t('pl_type')}</p><div class="chips">${AT_TYPES.map((k) => chip(type === k, t('at_' + k), () => setType(k), AT_ICON[k]))}</div>
      <p class="e-lbl">${t('pl_where')}</p><input class="e-input" value=${where} placeholder=${t('pl_where_ph')} onInput=${(e) => setWhere(e.currentTarget.value)} />
      <p class="e-lbl">${t('pl_max')}</p><div class="chips">${[10, 15, 20, 30, 45, 60].map((n) => chip(max === n, String(n), () => setMax(n)))}</div>
      <p class="e-lbl">${t('pl_mode')}</p><div class="chips">${[['scooter', 'pl_by'], ['car', 'pl_car'], ['walk', 'pl_walk']].map(([k, s]) => chip(mode === k, t(s), () => setMode(mode === k ? null : k)))}</div>
    </div>
    <button class="btn accent block" style="margin-top:14px" disabled=${busy || !name.trim() || !where.trim()} onClick=${save}>${t('x_save')}</button>
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}
export function AnchorSheet({ id }) {
  const d = D();
  const a = anchorsOf().find((x) => x.id === id);
  if (!a) return html`<p class="muted">—</p><button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
  async function del() {
    try { const r = await api('/app/api/anchor', { search_id: d.search.id, remove: a.id }); d.search.brief.anchors = r.anchors; hap.ok(); toast(t('pl_removed')); closeSheet(); emit(); }
    catch { toast(t('err_generic')); }
  }
  const link = mapLink(a.lat, a.lng, a.map_url);
  return html`<h2>${a.name}</h2><p class="muted" style="margin:0 0 12px">${[t('at_' + a.type), a.max_minutes ? t('pl_limit', { n: a.max_minutes }) : null].filter(Boolean).join(' · ')}</p>
    ${link && html`<button class="btn surface block" style="margin-bottom:8px" onClick=${() => openLink(link)}><${Icon} n="map-pin" cls="sm" />${t('pl_open_map')}</button>`}
    ${!a.legacy && canVoteRole(d.me.role) && html`<button class="btn ghost block" onClick=${del}><${Icon} n="trash-2" cls="sm" />${t('pl_remove')}</button>`}
    <button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
}

// ---------------------------------------------------------------- wave 4: places, location score (31, 31b, 32)
export const TYPE_ICON = { beach: 'tree-palm', surf: 'waves', coworking: 'laptop', gym: 'dumbbell', yoga: 'heart-pulse', supermarket: 'shopping-cart', market: 'store', hospital: 'hospital', pharmacy: 'pill',
  coffee: 'coffee', food: 'utensils', daytrip: 'mountain', nightlife: 'volume-2', construction: 'hard-hat', other: 'map-pin' };
export const TYPE_EMOJI = { nightlife: '🎶', construction: '🚧', other: '📍' };
export const LGROUPS = { anchors: [], surf: ['surf', 'beach'], shops: ['supermarket', 'market'], cafes: ['coffee', 'food'], work: ['coworking'], sport: ['gym', 'yoga'], medical: ['hospital', 'pharmacy'], nightlife: ['nightlife'] };
export const LG_ICON = { anchors: 'target', surf: 'waves', shops: 'shopping-cart', cafes: 'coffee', work: 'laptop', sport: 'dumbbell', medical: 'hospital', nightlife: 'volume-2' };
export const PT_ORDER = ['surf', 'beach', 'coffee', 'food', 'coworking', 'supermarket', 'market', 'gym', 'yoga', 'hospital', 'pharmacy', 'nightlife', 'daytrip', 'construction', 'other'];
export const groupOfType = (ty) => Object.keys(LGROUPS).find((g) => LGROUPS[g].includes(ty)) ?? 'other';
export const ptName = (ty) => (STR[LANG]['pt_' + ty] ? t('pt_' + ty) : human(ty));
export const fmtW = (w) => '×' + fmtNum(Math.round(w * 10) / 10);
export const basePlacesCache: Bag = {};
export function useBasePlaces(country) {
  const [p, setP] = useState(basePlacesCache[country] ?? null);
  useEffect(() => {
    if (!country || basePlacesCache[country]) { setP(basePlacesCache[country] ?? null); return; }
    if (!S.regions?.[country]?.places) { basePlacesCache[country] = { types: {}, places: [] }; setP(basePlacesCache[country]); return; }
    fetch(`/art/${country}/places.json`).then((r) => (r.ok ? r.json() : null)).then((j) => { basePlacesCache[country] = j ?? { types: {}, places: [] }; setP(basePlacesCache[country]); }).catch(() => null);
  }, [country, !!S.regions]);
  return p;
}
/** Base (pack) + own (Google Maps) places of the search, one shape. */
export function allPlaces(base) {
  const own = (D()?.places ?? []).filter((p) => !p.hidden).map((p) => ({ ...p, own: true }));
  const nm = (x) => String(x).toLowerCase().replace(/[^a-zа-я0-9]+/gi, ' ').trim();
  const dup = (p) => own.some((o) => km([o.lat, o.lng], [p.lat, p.lng]) < 0.15 && (nm(o.name).includes(nm(p.name)) || nm(p.name).includes(nm(o.name))));
  const bp = (base?.places ?? []).map((p) => ({ ...p, id: 'b:' + p.id, own: false, note: p.note?.[LANG] ?? p.note?.en ?? null })).filter((p) => !dup(p));
  return [...own, ...bp];
}
export const placeEmoji = (p, types) => types?.[p.type]?.emoji ?? TYPE_EMOJI[p.type] ?? '📍';
export const stars = (tier) => '★'.repeat(tier === 1 ? 3 : tier === 2 ? 2 : 1);
export const scoreCls = (n) => (n >= 75 ? 'hi' : n >= 50 ? 'mid' : 'lo');
export const LocBadge = ({ n }) => (n == null ? null : html`<span class=${'loc-badge ' + scoreCls(n)}>${t('lc_badge', { n })}</span>`);

export let spotArea = null, spotType = 'all';
export function Spots() {
  const d = D();
  const base = useBasePlaces(d.search.country);
  const geo = useAreasGeo(d.search.country);
  const areas = regionPack()?.areas ?? {};
  const all = allPlaces(base);
  const areaKey = (p) => p.area ?? (geo ? areaOf(p, geo, areas) : null) ?? 'trip';
  const counts: Bag = {};
  for (const p of all) counts[areaKey(p)] = (counts[areaKey(p)] ?? 0) + 1;
  const homeA = dealListing() && geo ? areaOf(dealListing(), geo, areas) : null;
  const def = homeA ?? (d.search.brief.districts ?? []).find((x) => counts[x]) ?? Object.entries(counts).filter(([k]) => k !== 'trip').sort((a, b) => +(b[1]) - +(a[1]))[0]?.[0] ?? 'trip';
  const [area, setArea0] = useState(spotArea && counts[spotArea] ? spotArea : def);
  const [type, setType0] = useState(spotType);
  const setType = (k) => { spotType = k; setType0(k); };
  useEffect(() => { if (!spotArea && def && def !== area) setArea0(def); }, [def]);
  S.spotSetArea = (k) => { spotArea = k; setArea0(k); setType('all'); };
  const inArea = all.filter((p) => areaKey(p) === area);
  const typesHere = PT_ORDER.filter((ty) => inArea.some((p) => p.type === ty));
  const shown = inArea.filter((p) => type === 'all' || p.type === type || (type === 'surf' && p.type === 'beach'))
    .sort((a, b) => a.tier - b.tier || Number(b.own) - Number(a.own) || a.name.localeCompare(b.name));
  const aName = area === 'trip' ? t('sp_trip') : areaName(areas[area]) || area;
  const chipTypes = typesHere.filter((ty) => !(ty === 'beach' && typesHere.includes('surf')));
  return html`<main class="screen w2">
    <div class="head w3-head"><div class="row" style="align-items:flex-start"><${BackIfWeb} /><div>
      <button class="kicker sp-kick" onClick=${() => openSheet('spot_area')}>${aName} · ${t('sp_n', { n: inArea.length })} <${Icon} n="chevd" cls="xs" /></button>
      <h1 class="h1 w3-h1">${t('sp_title')}</h1></div></div></div>
    <div class="w3-chips" role="group">
      <button aria-pressed=${type === 'all' ? 'true' : 'false'} onClick=${() => setType('all')}>${t('sp_all')}</button>
      ${chipTypes.map((ty) => html`<button key=${ty} class="ic-chip" aria-pressed=${type === ty ? 'true' : 'false'} onClick=${() => { hap.sel(); setType(ty); }}><${Icon} n=${TYPE_ICON[ty]} cls="sm" />${ptName(ty)}</button>`)}
    </div>
    ${shown.length ? html`<div class="card w2-list">${shown.map((p) => html`<button key=${p.id} class="w2-row w3-irow" onClick=${() => openSheet('spot', p.id)}>
        <span class="sq big"><${Icon} n=${TYPE_ICON[p.type] ?? 'map-pin'} /></span>
        <div class="grow"><b>${p.name}</b><span>${[ptName(p.type), p.note ? p.note.replace(/^./, (c) => c.toLowerCase()) : null].filter(Boolean).join(' · ')}</span></div>
        <span class="sp-stars" aria-label=${t('sp_tier') + ' ' + p.tier}>${stars(p.tier)}</span></button>`)}</div>`
      : html`<div class="card" style="padding:16px;margin-bottom:14px"><p class="muted" style="margin:0">${base ? t('sp_none') : '…'}</p></div>`}
    ${canVoteRole(d.me.role) && html`<button class="card w4-add" onClick=${() => openSheet('spot_link')}><${Icon} n="link" /><span>${t('sp_add')}</span></button>`}
    <${Nav} tab="map" />
  </main>`;
}
export function SpotAreaSheet() {
  const d = D();
  const base = useBasePlaces(d.search.country);
  const geo = useAreasGeo(d.search.country);
  const areas = regionPack()?.areas ?? {};
  const counts: Bag = {};
  for (const p of allPlaces(base)) { const k = p.area ?? (geo ? areaOf(p, geo, areas) : null) ?? 'trip'; counts[k] = (counts[k] ?? 0) + 1; }
  const keys = Object.keys(counts).sort((a, b) => +((a === 'trip')) - +((b === 'trip')) || counts[b] - counts[a]);
  return html`<h2>${t('sp_areas')}</h2><div class="card grp">${keys.map((k) => html`<button class="opt" onClick=${() => { S.spotSetArea?.(k); closeSheet(); }}>
      <span class="grow">${k === 'trip' ? t('sp_trip') : areaName(areas[k]) || k}</span><span class="muted">${counts[k]}</span></button>`)}</div>
    <button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
}
export function SpotSheet({ id }) {
  const d = D();
  const base = useBasePlaces(d.search.country);
  const p = allPlaces(base).find((x) => x.id === id) ?? (d.places ?? []).find((x) => x.id === id);
  const [busy, setBusy] = useState(false);
  if (!p) return html`<p class="muted">—</p><button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
  const types = PT_ORDER.filter((x) => x !== 'daytrip' || p.type === 'daytrip');
  async function save(patch) {
    setBusy(true);
    try {
      const r = await api('/app/api/place', { id: p.id, ...patch });
      D().places = (D().places ?? []).map((x) => (x.id === p.id ? { ...x, ...r.place } : x));
      hap.ok(); toast(t('sp_saved')); if (patch.hidden) closeSheet(); emit(); refresh();
    } catch { toast(t('err_generic')); }
    setBusy(false);
  }
  const link = mapLink(p.lat, p.lng, p.url && /\/maps\//.test(p.url) && !/entitylist|\/d\//.test(p.url) ? p.url : null);
  const edit = p.own && canVoteRole(d.me.role);
  const chip = (on, label, f) => html`<button class=${'bchip' + (on ? ' on' : ' off')} aria-pressed=${on ? 'true' : 'false'} disabled=${busy} onClick=${() => { hap.sel(); f(); }}>${label}</button>`;
  return html`<h2>${p.name}</h2><p class="muted" style="margin:0 0 12px">${[ptName(p.type), stars(p.tier), p.own ? t('sp_own') : t('sp_pack')].join(' · ')}</p>
    ${p.note && html`<p style="margin:0 0 12px">${p.note}</p>`}
    ${p.address && html`<p class="muted" style="margin:0 0 12px;font-size:14px">${p.address}</p>`}
    ${edit && html`<div class="x-form"><p class="e-lbl">${t('sp_type')}</p><div class="chips">${types.map((ty) => chip(p.type === ty, ptName(ty), () => save({ type: ty })))}</div>
      <p class="e-lbl">${t('sp_tier')}</p><div class="chips">${[1, 2, 3].map((n) => chip(p.tier === n, stars(n), () => save({ tier: n })))}</div></div>`}
    ${link && html`<button class="btn surface block" style="margin:14px 0 8px" onClick=${() => openLink(link)}><${Icon} n="map-pin" cls="sm" />${t('pl_open_map')}</button>`}
    ${edit && html`<button class="btn ghost block" disabled=${busy} onClick=${() => save({ hidden: true })}><${Icon} n="eyeoff" cls="sm" />${t('sp_hide')}</button>`}
    <button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
}
export function SpotLinkSheet() {
  const d = D();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try { await api('/app/api/places-link', { search_id: d.search.id, url: url.trim() }); hap.ok(); toast(t('sp_link_sent')); closeSheet(); }
    catch (e) { toast(e.code === 'bad_url' ? t('sp_bad_link') : t('err_generic')); }
    setBusy(false);
  }
  return html`<h2>${t('sp_link_t')}</h2><p class="muted" style="margin:0 0 12px">${t('sp_link_text')}</p>
    <input class="e-input" value=${url} placeholder=${t('sp_link_ph')} inputmode="url" onInput=${(e) => setUrl(e.currentTarget.value)} />
    <button class="btn accent block" style="margin-top:12px" disabled=${busy || !/^https?:\/\//.test(url.trim())} onClick=${send}><${Icon} n="send" cls="sm" />${t('x_save')}</button>
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}

export const locCache: Bag = {};
export function useLocation(id) {
  const [v, setV] = useState(locCache[id] ?? null);
  useEffect(() => {
    api('/app/api/location?id=' + encodeURIComponent(id)).then((j) => { locCache[id] = j; setV(j); }).catch(() => setV({ location: null, failed: true }));
  }, [id]);
  return v;
}
/** Ring minutes of a location view: the keys of location.rings (legacy 5/10/30 still read), else the ring set, else the pack's. */
export const DEF_RINGS = [10, 20, 40], DEF_RW = [1, 0.7, 0.3];
export const packRings = () => subRegion()?.location?.rings ?? regionPack()?.location?.rings ?? DEF_RINGS;
export function ringKeys(v) {
  const ks = Object.keys(v?.location?.rings ?? {}).map(Number).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  return ks.length ? ks : v?.ring_set ?? v?.location?.ring_set ?? packRings();
}
export const ringSet = (v) => v?.ring_set ?? v?.location?.ring_set ?? packRings();
export const ringWeights = (v) => v?.ring_weights ?? v?.location?.ring_weights ?? subRegion()?.location?.weights ?? regionPack()?.location?.weights ?? DEF_RW;
export const locStale = (v) => !!(v?.stale || v?.location?.stale);
export function lcHowText(v) {
  const rs = ringSet(v), w = ringWeights(v);
  const rush = Number(v?.rush_factor ?? v?.location?.rush_factor ?? 1.3);
  const mw = modeWord();
  return `${t('lc_how_text', { rings: rs.map((r, i) => `${t('lc_min', { n: r })} ${fmtNum(w[i] ?? 0)}`).join(', '), r: rs[1] ?? rs[0] })} ${t('lc_rush', { m: mw ? ' ' + mw : t('lc_rush_m'), p: Math.max(0, Math.round((rush - 1) * 100)) })}.`;
}
/** The north-most point of a ring: where its "N мин" label sits. */
export function topPoint(geom) {
  const polys = geom?.type === 'Polygon' ? [geom.coordinates] : geom?.coordinates ?? [];
  let best = null;
  for (const p of polys) for (const pt of p[0] ?? []) if (!best || pt[1] > best[1]) best = pt;
  return best;
}
export function LocationScreen({ id }) {
  const d = D();
  const l = listingById(id);
  const v = useLocation(id);
  const [ready, setReady] = useState(false);
  const [fail, setFail] = useState(false);
  const box = useRef(null);
  const mapR = useRef(null);
  const marks = useRef([]);
  const theme = useThemeKey();
  useEffect(() => {
    let dead = false;
    setReady(false);
    loadML().then(async (ml) => {
      const style = await districtStyle();
      if (dead || !box.current) return;
      const c = l?.lat != null ? [l.lat, l.lng] : subRegion()?.center ?? [0, 0];
      const map = new ml.Map({ container: box.current, style, center: [c[1], c[0]], zoom: 12, attributionControl: false, dragRotate: false, pitchWithRotate: false, fadeDuration: 0 });
      map.touchZoomRotate.disableRotation();
      mapR.current = map;
      map.on('load', () => !dead && setReady(true));
    }).catch(() => !dead && setFail(true));
    return () => { dead = true; marks.current.forEach((m) => m.remove()); marks.current = []; mapR.current?.remove(); mapR.current = null; };
  }, [theme]);
  useEffect(() => {
    const map = mapR.current;
    const ml = window.maplibregl;
    if (!ready || !map || !ml || !v || !l) return;
    marks.current.forEach((m) => m.remove());
    marks.current = [];
    const accent = cssVar('--map-accent');
    const geo = v.geo;
    const grs = [...new Set((geo?.features ?? []).map((f) => Number(f.properties?.ring)).filter((x) => !Number.isNaN(x)))].sort((a, c) => +(a) - +(c));
    const rs = grs.length ? grs : ringKeys(v);
    const r0 = rs[0], r1 = rs[1] ?? rs[0], rl = rs[rs.length - 1];
    const add = (el, ll, z) => { el.style.zIndex = String(z); marks.current.push(new ml.Marker({ element: el, anchor: 'center' }).setLngLat(ll).addTo(map)); };
    if (geo && !map.getSource('iso')) {
      map.addSource('iso', { type: 'geojson', data: geo });
      const fillOp = rs.length >= 3 ? ['match', ['get', 'ring'], r0, 0.26, r1, 0.16, 0.08] : rs.length === 2 ? ['match', ['get', 'ring'], r0, 0.26, 0.12] : 0.2;
      map.addLayer({ id: 'iso-fill', type: 'fill', source: 'iso', paint: { 'fill-color': accent, 'fill-opacity': fillOp } });
      map.addLayer({ id: 'iso-line', type: 'line', source: 'iso', layout: { 'line-join': 'round' }, paint: { 'line-color': accent, 'line-width': 2, 'line-dasharray': [2, 1.6], 'line-opacity': rs.length > 1 ? ['match', ['get', 'ring'], rl, 0.55, 0.9] : 0.9 } });
    }
    const b = new ml.LngLatBounds();
    b.extend([l.lng, l.lat]);
    for (const f of geo?.features ?? []) {
      if (f.properties.ring === r1) { const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates; for (const p of polys) for (const pt of p[0]) b.extend(pt); }
      if (rs.length > 1 && f.properties.ring === rl) continue;
      const tp = topPoint(f.geometry);
      if (!tp) continue;
      const el = document.createElement('div');
      el.className = 'ring-tag';
      el.textContent = t('lc_min', { n: f.properties.ring });
      add(el, tp, 8);
    }
    // Pins: own places and tier-1 first, at most 36.
    const pins = [...(v.places ?? [])].filter((p) => p.ring !== rl || p.tier === 1 || p.own).sort((a, c) => a.ring - c.ring || a.tier - c.tier || Number(c.own) - Number(a.own)).slice(0, 24);
    for (const p of pins) {
      const el = document.createElement('button');
      el.className = `lpin g-${groupOfType(p.type)}${p.ring === rl ? ' far' : ''}`;
      el.textContent = p.emoji ?? TYPE_EMOJI[p.type] ?? '📍';
      el.setAttribute('aria-label', p.name);
      el.addEventListener('click', (e) => { e.stopPropagation(); openSheet('spot', p.id); });
      add(el, [p.lng, p.lat], p.ring === r0 ? 4 : 3);
    }
    const home = document.createElement('div');
    home.className = 'lhome';
    add(home, [l.lng, l.lat], 6);
    const sheetH = document.querySelector('.lc-sheet')?.getBoundingClientRect().height ?? 0;
    const H = box.current.clientHeight;
    map.fitBounds(b, { padding: { top: 120, bottom: Math.min(H * 0.62, sheetH + 16), left: 28, right: 28 }, maxZoom: 14, duration: 0 });
  }, [ready, v]);
  if (!l) return html`<main class="screen no-nav"><div class="center-msg">—</div></main>`;
  const stale = locStale(v);
  const loc = stale ? null : v?.location;
  const rj = ringSet(v).join('/');
  const sub = [districtShort(l), l.bedrooms != null ? t('br', { n: l.bedrooms }) : null, priceText(l)].filter(Boolean).join(' · ');
  const ask = async () => { try { await postInstruction(t('lc_ask_text', { r: rj }) + `: ${l.title}`, 'location_refresh', l.id); hap.ok(); toast(t('lc_asked')); } catch { toast(t('err_generic')); } };
  return html`<main class="map-screen lc-screen">
    <div class="map" ref=${box} role="application" aria-label=${t('lc_row')}></div>
    <div class="map-top lc-top"><button class="card lc-card" onClick=${() => go(sp('listing', l.id))}>
      <${Img} src=${photosOf(l)[0]} cls="lc-thumb" /><div class="grow"><b>${shortTitle(l.title)}</b><span>${sub}</span></div>
      ${loc && html`<span class=${'lc-score ' + scoreCls(loc.score)}><b>${loc.score}</b><small>${t('lc_word')}</small></span>`}</button></div>
    ${fail && html`<div class="center-msg" style="position:absolute;inset:40% 0 auto">${t('map_fail')}</div>`}
    <div class="lc-sheet"><div class="grip"></div>
      ${v == null ? html`<div class="skeleton" style="height:120px"></div>` : !loc ? html`<p class=${stale ? 'lc-stale' : 'muted'} style="margin:4px 0 14px">${stale ? t('lc_stale') : t('lc_none', { r: rj })}</p>
          ${canVoteRole(d.me.role) && html`<button class="btn accent block" onClick=${ask}><${Icon} n="sparkles" cls="sm" />${t('lc_ask')}</button>`}`
        : html`${ringKeys(v).map((r, ri) => {
          const ring = loc.rings[String(r)] ?? { points: 0, places: [] };
          const list = ring.places.filter((p) => p.contribution > 0 || p.own);
          const extra = Math.max(0, list.length - 5);
          return html`<div key=${r} class="lc-ring"><div class="lc-rh"><i class=${'lc-dot i' + ri}></i><b>${t('lc_min', { n: r })}</b><span class="grow"></span><span class="muted">${t('lc_points', { n: ring.points })}</span></div>
            <div class="lc-chips">${list.slice(0, 5).map((p) => html`<button class=${'lc-chip' + (p.tier === 1 ? ' top' : '')} onClick=${() => openSheet('spot', p.id)}><${Icon} n=${TYPE_ICON[p.type] ?? 'map-pin'} cls="sm" />${p.name}${p.tier === 1 ? ' ★' : ''}</button>`)}
              ${extra > 0 && html`<span class="lc-chip more">${t('lc_more', { n: extra })}</span>`}${!list.length && html`<span class="muted" style="font-size:14px">—</span>`}</div></div>`;
        })}
        <p class="lc-rush">${t('lc_rush', { m: modeWord() ? ' ' + modeWord() : t('lc_rush_m'), p: Math.max(0, Math.round((Number(v.rush_factor ?? loc.rush_factor ?? 1.3) - 1) * 100)) })}</p>
        <button class="btn outline block big lc-how" onClick=${() => go(sp('score', l.id))}><${Icon} n="info-circle" />${t('lc_how', { n: loc.score })}</button>`}
    </div>
    <span class="attrib" style="display:none">© OpenFreeMap © OpenStreetMap</span>
  </main>`;
}
export function ScoreScreen({ id }) {
  const l = listingById(id);
  const v = useLocation(id);
  if (!l) return html`<main class="screen no-nav"><div class="center-msg">—</div></main>`;
  const stale = locStale(v);
  const loc = stale ? null : v?.location;
  const r2 = ringSet(v)[1] ?? ringSet(v)[0];
  const groups = (loc?.groups ?? []).filter((g) => g.key !== 'nightlife' || g.weight > 0 || loc.quiet || g.n).sort((a, b) => +((b.key === 'anchors')) - +((a.key === 'anchors')) || b.weight - a.weight);
  const bar = (g) => (g.weight <= 0 ? '' : g.s >= 75 ? 'hi' : g.s >= 55 ? 'mid' : 'lo');
  const pen = loc?.penalties ?? [];
  return html`<main class="screen w2 no-nav">
    <${W3Head} kicker=${[shortTitle(l.title), districtShort(l)].filter(Boolean).join(' · ')} title=${loc ? t('lc_title', { n: loc.score }) : t('lc_row')} />
    ${v == null ? html`<div class="skeleton" style="height:240px"></div>` : !loc ? html`<div class="card" style="padding:16px"><p class="muted" style="margin:0">${stale ? t('lc_stale') : t('lc_none', { r: ringSet(v).join('/') })}</p></div>` : html`
      <div class="card lc-types"><p class="w3-ct">${t('lc_by_type')}</p>
        ${groups.map((g) => html`<div class="lc-tr"><${Icon} n=${LG_ICON[g.key]} /><span class="nm">${t('lg_' + g.key)}</span><span class="w">${fmtW(g.weight)}</span>
          <div class="lc-bar"><i class=${bar(g)} style=${`width:${g.weight > 0 ? Math.max(3, g.s) : 0}%`}></i></div><b>${g.weight > 0 ? g.s : '—'}</b></div>`)}
      </div>
      <div class="w2-note col"><b>${t('lc_how_t')}</b><span>${lcHowText(v)}</span></div>
      ${pen.length ? html`<div class="card w2-list">${pen.map((p) => html`<div class="w2-row w3-irow"><${Icon} n=${p.key === 'no_shop' ? 'shopping-cart' : 'volume-2'} cls="pl-ic-over" /><div class="grow"><b style="font-weight:500">${t('lc_' + p.key, { p: p.place ?? '', r: r2 })}</b></div></div>`)}</div>`
        : loc.quiet ? html`<div class="card w2-list"><div class="w2-row w3-irow"><${Icon} n="volume-x" cls="pl-ic-over" /><div class="grow"><b style="font-weight:500">${t('lc_quiet_ok')}</b></div></div></div>` : null}`}
  </main>`;
}
