import { cssVar, isDark } from '../core/api.js';
import { D, districtName, listingById, minutesFor, photosOf, priceText, subRegion, travelKmh, travelMode } from '../core/data.js';
import { MAPLIBRE, MAP_STYLE, pref } from '../core/env.js';
import { ROAD, fmtTime, km, shortTitle, wdShort } from '../core/format.js';
import { t } from '../core/i18n.js';
import { go, openLink, sp } from '../core/routing.js';
import { S, hap, openSheet, subs } from '../core/store.js';
import { regionPack } from '../home/helpers.js';
import { allPlaces, groupOfType, placeEmoji, useBasePlaces } from '../places/places.js';
import { ICONS, Icon, Img, VoteAvs } from '../ui/icons.js';
import { Nav } from '../ui/pieces.js';
import { usePlanDay, vStatus } from './plan.js';
import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';

// ---------------------------------------------------------------- map
export let mlPromise = null;
export function loadML() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  return (mlPromise ??= new Promise<any>((res, rej) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = MAPLIBRE + '.css';
    document.head.append(css);
    const s = document.createElement('script');
    s.src = MAPLIBRE + '.js';
    s.onload = () => res(window.maplibregl);
    s.onerror = () => { mlPromise = null; rej(new Error('maplibre')); };
    document.head.append(s);
  }));
}
export let baseStyle = null;
/** OpenFreeMap Positron, repainted with the app tokens (both themes). */
export async function mapStyle() {
  baseStyle ??= await fetch(MAP_STYLE).then((r) => r.json());
  const st = JSON.parse(JSON.stringify(baseStyle));
  const v = (n) => cssVar(n);
  const ground = v('--ground'), surface = v('--map-road'), s2 = v('--map-fill'), line = v('--map-line'), ink2 = v('--ink-2'), water = v('--map-water'); // wave 8: opaque map tokens
  const road = isDark() ? s2 : surface;
  for (const l of st.layers) {
    const p = (l.paint ??= {});
    const id = l.id;
    if (l.type === 'background') p['background-color'] = ground;
    else if (id === 'water') p['fill-color'] = water;
    else if (id.startsWith('waterway')) { if (l.type === 'line') p['line-color'] = water; }
    else if (id === 'park' || id.startsWith('landcover')) { p['fill-color'] = s2; p['fill-opacity'] = 0.6; }
    else if (id.startsWith('landuse')) { p['fill-color'] = ground; p['fill-opacity'] = 0; }
    else if (id === 'building') { p['fill-color'] = line; p['fill-outline-color'] = line; }
    else if (l.type === 'fill') p['fill-color'] = s2;
    else if (l.type === 'line') p['line-color'] = /casing|boundary|rail/.test(id) ? line : road;
    if (l.type === 'symbol') {
      p['text-color'] = ink2;
      p['text-halo-color'] = ground;
      p['text-halo-width'] = 1.2;
      if (/shield/.test(id)) (l.layout ??= {}).visibility = 'none';
    }
    if (l.type === 'raster') (l.layout ??= {}).visibility = 'none';
  }
  return st;
}
export function circle(lng, lat, kmR, n = 72) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    pts.push([lng + (kmR * Math.cos(a)) / (111.32 * Math.cos((lat * Math.PI) / 180)), lat + (kmR * Math.sin(a)) / 110.574]);
  }
  return pts;
}
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export function useThemeKey() {
  const [k, setK] = useState(isDark() ? 'd' : 'l');
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const f = () => setK(isDark() ? 'd' : 'l');
    mq.addEventListener?.('change', f);
    subs.add(f);
    return () => { mq.removeEventListener?.('change', f); subs.delete(f); };
  }, []);
  return k;
}
export function MapScreen({ arg }) {
  const d = D();
  const s = d.search;
  const [mode, setMode] = useState(arg === 'day' ? 'day' : 'all');
  const { byDay, days, day } = usePlanDay();
  const pts = d.listings.filter((l) => l.lat != null && l.lng != null);
  const firstSel = pts.find((l) => l.decision === 'take') ?? pts.find((l) => l.decision === 'want_view') ?? pts[0];
  const [sel, setSel] = useState(firstSel?.id ?? null);
  const [ready, setReady] = useState(false);
  const [fail, setFail] = useState(false);
  const box = useRef(null);
  const mapR = useRef(null);
  const marks = useRef([]);
  const fitted = useRef('');
  const theme = useThemeKey();
  const anchor = s.brief?.anchor;
  const kmh = travelKmh();
  const stops = (day ? byDay.get(day) ?? [] : []).map((v) => ({ v, l: listingById(v.listing_id) ?? v })).filter((x) => x.l.lat != null && x.l.lng != null);
  const [showPlaces, setShowPlaces0] = useState(pref.get('map_places') === '1');
  const setShowPlaces = (v) => { pref.set('map_places', v ? '1' : '0'); setShowPlaces0(v); };
  const basePl = useBasePlaces(s.country);
  const hasPlaces = !!S.regions?.[s.country]?.places || (d.places ?? []).length > 0;

  useEffect(() => {
    let dead = false;
    setReady(false);
    fitted.current = '';
    loadML().then(async (ml) => {
      const style = await mapStyle();
      if (dead || !box.current) return;
      const c = subRegion()?.center ?? (firstSel ? [firstSel.lat, firstSel.lng] : [0, 0]);
      const map = new ml.Map({ container: box.current, style, center: [c[1], c[0]], zoom: 11, attributionControl: false, dragRotate: false, pitchWithRotate: false, fadeDuration: 0 });
      map.touchZoomRotate.disableRotation();
      mapR.current = map;
      map.on('load', () => !dead && setReady(true));
      map.on('click', (e) => { if (e.originalEvent?.target === map.getCanvas()) setSel(null); });
    }).catch(() => !dead && setFail(true));
    return () => { dead = true; marks.current.forEach((m) => m.remove()); marks.current = []; mapR.current?.remove(); mapR.current = null; };
  }, [theme]);

  useEffect(() => {
    const map = mapR.current;
    const ml = window.maplibregl;
    if (!ready || !map || !ml) return;
    marks.current.forEach((m) => m.remove());
    marks.current = [];
    for (const id of ['ring', 'route']) { if (map.getLayer(id)) map.removeLayer(id); if (map.getSource(id)) map.removeSource(id); }
    const add = (el, lng, lat, z = 0) => { el.style.zIndex = String(z); marks.current.push(new ml.Marker({ element: el, anchor: 'center' }).setLngLat([lng, lat]).addTo(map)); };
    const bounds = new ml.LngLatBounds();
    const accent = cssVar('--map-accent');
    if (mode === 'all') {
      if (anchor) {
        const r = (kmh * 10) / 60;
        map.addSource('ring', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: circle(anchor.lng, anchor.lat, r) } } });
        map.addLayer({ id: 'ring', type: 'line', source: 'ring', paint: { 'line-color': accent, 'line-width': 1.5, 'line-opacity': 0.9 } });
        const lab = document.createElement('div');
        lab.className = 'ring-label';
        lab.textContent = t('ring', { n: 10, mode: travelMode() });
        const a = Math.PI / 3;
        add(lab, anchor.lng + (r * 0.62 * Math.cos(a)) / (111.32 * Math.cos((anchor.lat * Math.PI) / 180)), anchor.lat + (r * 0.92 * Math.sin(a)) / 110.574, 1);
        const an = document.createElement('div');
        an.className = 'anchor';
        an.innerHTML = `<span class="sq"><svg class="icon" viewBox="0 0 24 24">${ICONS[anchor.icon] ?? ICONS.target}</svg></span>${anchor.label ? `<span class="lb">${esc(anchor.label)}</span>` : ''}`;
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;transform:translateX(calc(50% - 15px))';
        wrap.append(an);
        add(wrap, anchor.lng, anchor.lat, 4);
        bounds.extend([anchor.lng, anchor.lat]);
      }
      if (showPlaces) for (const p of allPlaces(basePl)) {
        if (p.type === 'daytrip' && !p.own) continue;
        const el = document.createElement('button');
        el.className = `lpin sm g-${groupOfType(p.type)}`;
        el.textContent = placeEmoji(p, basePl?.types);
        el.setAttribute('aria-label', p.name);
        el.addEventListener('click', (e) => { e.stopPropagation(); openSheet('spot', p.id); });
        add(el, p.lng, p.lat, 0);
      }
      for (const l of pts) {
        const dec = l.decision ?? 'new';
        const isSel = l.id === sel;
        const el = document.createElement('button');
        el.className = 'pin-wrap';
        el.setAttribute('aria-label', `${priceText(l)} · ${l.title}`);
        el.innerHTML = `${isSel ? `<span class="pin-label">${esc(priceText(l))}</span>` : ''}<span class="pin d-${dec}${isSel ? ' sel' : ''}"></span>`;
        el.addEventListener('click', (e) => { e.stopPropagation(); hap.sel(); setSel(l.id); });
        add(el, l.lng, l.lat, isSel ? 5 : dec === 'not_interested' ? 1 : 3);
        bounds.extend([l.lng, l.lat]);
      }
    } else {
      if (stops.length > 1) {
        map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: stops.map((x) => [x.l.lng, x.l.lat]) } } });
        map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': accent, 'line-width': 4 } });
      }
      stops.forEach((x, k) => {
        const el = document.createElement('button');
        el.className = `stop st-${vStatus(x.v)}`;
        el.textContent = String(k + 1);
        el.setAttribute('aria-label', `${k + 1}. ${fmtTime(x.v.starts_at)} ${x.l.title}`);
        el.addEventListener('click', () => go(sp('listing', x.v.listing_id)));
        add(el, x.l.lng, x.l.lat, 3);
        bounds.extend([x.l.lng, x.l.lat]);
      });
    }
    const fitKey = mode + (mode === 'day' ? day : '');
    if (fitted.current !== fitKey && !bounds.isEmpty()) {
      fitted.current = fitKey;
      const mb = document.querySelector('.map-bottom')?.getBoundingClientRect();
      const mt = document.querySelector('.map-top')?.getBoundingClientRect();
      const H = box.current.clientHeight;
      const bottom = Math.min(H * 0.6, mb && mb.height ? H - mb.top + 28 : 180);
      const top = Math.min(H * 0.3, (mt ? mt.bottom : 100) + 28);
      map.fitBounds(bounds, { padding: { top, bottom, left: 36, right: 36 }, maxZoom: 14, duration: 0 });
    }
  }, [ready, mode, sel, day, d, showPlaces, basePl]);

  const counts: Bag = {};
  for (const l of d.listings) counts[l.decision ?? 'new'] = (counts[l.decision ?? 'new'] ?? 0) + 1;
  const selL = mode === 'all' ? listingById(sel) : null;
  const toAnchor = selL && anchor && selL.lat != null ? minutesFor(km([selL.lat, selL.lng], [anchor.lat, anchor.lng])) : null;
  let dayCard = null;
  if (mode === 'day') {
    const legs = stops.map((x, k) => (k ? km([stops[k - 1].l.lat, stops[k - 1].l.lng], [x.l.lat, x.l.lng]) : 0));
    const total = legs.reduce((a, b) => a + b, 0);
    const list = day ? byDay.get(day) ?? [] : [];
    const route = list.length ? d.routes?.[String(list[0].starts_at).slice(0, 10)] : null;
    const endMs = list.length ? Date.parse(list[list.length - 1].starts_at) + 45 * 60e3 : 0;
    dayCard = html`<div class="card day-card">
      <div class="hd"><div><div class="h2">${t('day_n', { n: list.length })}</div>
        ${stops.length > 1 && html`<div class="sub">${t('in_transit', { min: minutesFor(total), km: Math.round(total * ROAD), mode: travelMode() })}</div>`}</div>
        ${list.length > 0 && html`<span class="rng">${fmtTime(list[0].starts_at)} – ${fmtTime(new Date(endMs).toISOString())}</span>`}</div>
      <ol>${list.map((v, k) => {
        const l = listingById(v.listing_id) ?? v;
        const si = stops.findIndex((x) => x.v.id === v.id);
        return html`<li class=${'st-' + vStatus(v)}><span class="n">${k + 1}</span><b>${fmtTime(v.starts_at)}</b><span class="grow ellipsis">${[shortTitle(l.title), districtName(l)].filter(Boolean).join(' · ')}</span>
          <span class="leg">${si === 0 ? t('start') : si > 0 ? t('min', { n: minutesFor(legs[si]) }) : ''}</span></li>`;
      })}</ol>
      <button class="btn accent block" disabled=${!route} onClick=${() => openLink(route)}><${Icon} n="nav" />${t('open_gmaps')}</button>
    </div>`;
  }
  const order = ['take', 'want_view', 'thinking', 'not_interested', 'new'];
  return html`<main class="map-screen">
    <div class="map" ref=${box} role="application" aria-label=${t('nav_map')}></div>
    <div class="map-top">
      <div class="seg" role="group">
        <button aria-pressed=${mode === 'all' ? 'true' : 'false'} onClick=${() => { hap.sel(); setMode('all'); }}>${t('map_all')}</button>
        <button class="day-on" disabled=${!days.length} aria-pressed=${mode === 'day' ? 'true' : 'false'} onClick=${() => { hap.sel(); setMode('day'); }}>${day ? t('map_day_d', { d: wdShort(day) + ' ' + Number(day.slice(8, 10)) }) : t('map_day')}</button>
        ${regionPack()?.areas && html`<button aria-pressed="false" onClick=${() => { hap.sel(); go(sp('map', 'districts'), true); }}>${t('ds_mode')}</button>`}
      </div>
      ${mode === 'all' && html`<div class="legend">${order.filter((k) => counts[k]).map((k) => html`<span class=${'d-' + k}><span class="dot"></span>${t('legend_' + k, { n: counts[k] })}</span>`)}</div>`}
      ${mode === 'all' && hasPlaces && html`<div class="map-pl"><button class=${'ds-hint pl-tg' + (showPlaces ? ' on' : '')} aria-pressed=${showPlaces ? 'true' : 'false'} onClick=${() => { hap.sel(); setShowPlaces(!showPlaces); }}><${Icon} n="map-pin" cls="sm" />${t('sp_layer')}</button>
        <button class="ds-hint pl-tg" onClick=${() => go(sp('spots'))}><${Icon} n="layers" cls="sm" />${t('sp_list')}</button></div>`}
    </div>
    ${fail && html`<div class="center-msg" style="position:absolute;inset:40% 0 auto">${t('map_fail')}</div>`}
    ${ready && mode === 'all' && !pts.length && html`<div class="center-msg" style="position:absolute;inset:40% 0 auto">${t('map_none')}</div>`}
    <div class="map-bottom">
      ${selL && html`<button class="card map-card" onClick=${() => go(sp('listing', selL.id))}>
        <${Img} src=${photosOf(selL)[0]} />
        <div class="grow"><div class="p">${priceText(selL)} <small>${t('per_month')}</small></div><div class="t">${selL.title}</div>
          ${toAnchor && html`<div class="tr"><${Icon} n=${anchor.icon && ICONS[anchor.icon] ? anchor.icon : 'target'} cls="sm" />${anchor.to_label ? `${t('min', { n: toAnchor })} ${anchor.to_label}` : t('min_to', { n: toAnchor, label: anchor.label ?? '' })}</div>`}
          <div style="margin-top:8px"><${VoteAvs} lid=${selL.id} size=${24} /></div></div></button>`}
      ${dayCard}
    </div>
    <span class="attrib">© OpenFreeMap © OpenStreetMap</span>
    <${Nav} tab="map" />
  </main>`;
}
