// Split from app.js (wave 11): see the section comment below.
import { api, cssVar } from '../core/api.js';
import { D, canVoteRole, subRegion } from '../core/data.js';
import { reduceMotion } from '../core/env.js';
import { km, money } from '../core/format.js';
import { LANG, t } from '../core/i18n.js';
import { go, sp } from '../core/routing.js';
import { S, emit, hap, toast } from '../core/store.js';
import { BackIfWeb, minLabel, postInstruction, regionPack, scaled } from '../home/helpers.js';
import { briefCur } from '../screens/deal.js';
import { loadML, mapStyle, useThemeKey } from '../screens/map.js';
import { Icon } from '../ui/icons.js';
import { Nav } from '../ui/pieces.js';
import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';

// ---------------------------------------------------------------- districts (28, 28b, 28c)
export const SCORE_KEYS = ['surf', 'quiet', 'no_traffic', 'food', 'coworking', 'nightlife'];
export const geoCache: Bag = {};
export function useAreasGeo(country) {
  const [g, setG] = useState(geoCache[country] ?? null);
  useEffect(() => {
    if (!country || geoCache[country]) { setG(geoCache[country] ?? null); return; }
    fetch(`/art/${country}/districts.geojson`).then((r) => (r.ok ? r.json() : null)).then((j) => { geoCache[country] = j; setG(j); }).catch(() => null);
  }, [country]);
  return g;
}
export function inRing(pt, ring) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
export function inGeom(pt, g) {
  const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
  return polys.some((p) => inRing(pt, p[0]) && !p.slice(1).some((h) => inRing(pt, h)));
}
export function areaOf(l, geo, areas) {
  if (l.lat != null && l.lng != null && geo) {
    const f = geo.features.find((x) => inGeom([l.lng, l.lat], x.geometry));
    if (f) return f.properties.id;
  }
  if (l.district && areas) for (const [id, a] of Object.entries(areas)) if (id === l.district || (a.districts ?? []).includes(l.district)) return id;
  return null;
}
/** "2 сп" — or "2-комн." in Kazakhstan, where the pack prices are per number of rooms. */
export const dsBr = (n) => (S.regions?.[D()?.search?.country]?.rooms === 'total' ? t('ds_rooms', { n }) : t('ds_br', { n }));
export const briefBeds = () => {
  const b = (D()?.search?.brief?.bedrooms ?? []).map((x) => parseInt(x, 10)).filter((x) => x > 0);
  return b[0] ?? 2;
};
export function briefWeights(b) {
  const w = { surf: 0.5, quiet: 1, no_traffic: 1, food: 1, coworking: 0.5, nightlife: 0.5 };
  if (b.priorities && typeof b.priorities === 'object') { for (const k of SCORE_KEYS) if (Number.isFinite(Number(b.priorities[k]))) w[k] = Number(b.priorities[k]); return w; }
  const txt = [b.must_have, b.nice_to_have, b.deal_breakers, b.style, b.transport, (b.anchors ?? []).map((a) => a.type).join(' '), b.anchor?.icon === 'waves' ? 'surf' : ''].filter(Boolean).join(' ').toLowerCase();
  if (/серф|surf|волн/.test(txt)) w.surf = 2;
  if (/тих|quiet|calm|спокой|стройк|construction/.test(txt) || b.construction_tolerance === 'dealbreaker') w.quiet = 2;
  if (/пробк|traffic/.test(txt)) w.no_traffic = 2;
  if (/кафе|еда|food|cafe|рестора/.test(txt)) w.food = 1.5;
  if (/коворк|cowork|удалён|remote/.test(txt)) w.coworking = 2;
  if (/тусов|party|nightlife|клуб/.test(txt)) w.nightlife = 2;
  return w;
}
export function fitPct(id, a) {
  const b = D()?.search?.brief ?? {};
  const w = briefWeights(b);
  let s = 0, m = 0;
  for (const [k, x] of Object.entries(w)) { const v = Number(a.scores?.[k]); if (!v || !(x > 0)) continue; s += x * v; m += x * 5; }
  let p = m ? (s / m) * 100 : 50;
  const bd = b.districts ?? [];
  if (bd.includes(id) || (a.districts ?? []).some((x) => bd.includes(x))) p += 8;
  const lo = a.price?.[String(briefBeds())]?.[0];
  if (b.budget_max && lo && lo > b.budget_max) p -= 15;
  // Wave 4: the average location score of the search's listings in the area pulls the fit towards it.
  const geo = geoCache[D()?.search?.country];
  const sc = geo ? (D()?.listings ?? []).filter((l) => l.location_score != null && areaOf(l, geo, regionPack()?.areas) === id).map((l) => l.location_score) : [];
  if (sc.length) p = 0.6 * p + 0.4 * (sc.reduce((x, y) => x + y, 0) / sc.length);
  return Math.max(5, Math.min(99, Math.round(p)));
}
/** Listings of this search inside the area + a price range for `beds` bedrooms (quartiles of ≥3 listings, else the pack). */
export function areaStats(id, a, geo, beds = briefBeds()) {
  const d = D();
  const ls = d.listings.filter((l) => areaOf(l, geo, regionPack()?.areas) === id);
  const prices = ls.filter((l) => Number(l.bedrooms) === beds && l.price > 0).map((l) => Number(l.price)).sort((x, y) => x - y);
  const q = (p) => prices[Math.min(prices.length - 1, Math.max(0, Math.round(p * (prices.length - 1))))];
  const range = prices.length >= 3 ? [q(0.25), q(0.75)] : a.price?.[String(beds)] ?? null;
  return { listings: ls, range, fromCrm: prices.length >= 3, n: prices.length };
}
export const rangeText = (r, cur) => (r ? (r[0] === r[1] ? money(r[0], cur) : `${scaled(r[0], r[1])}–${money(r[1], cur)}`) : '—');
export const areaName = (a) => a?.name?.[LANG] ?? a?.name?.en ?? '';
export function inBrief(id, a) {
  const bd = D()?.search?.brief?.districts ?? [];
  return bd.includes(id);
}
export async function addAreaToBrief(id, a) {
  const d = D();
  try {
    if (d.me.role === 'owner') {
      const r = await api('/app/api/brief', { search_id: d.search.id, brief: { districts: [...new Set([...(d.search.brief.districts ?? []), id])] } }, 'PATCH');
      if (r.brief) d.search.brief = { ...d.search.brief, districts: r.brief.districts };
      toast(t('ds_added'));
    } else {
      await postInstruction(`${t('ds_to_brief')}: ${areaName(a)} (${id})`, 'brief_area', id);
      toast(t('ds_asked'));
    }
    hap.ok();
    emit();
  } catch { toast(t('err_generic')); }
}
export function labelPoint(geom, center) {
  const polys = geom?.type === 'Polygon' ? [geom.coordinates] : geom?.coordinates ?? [];
  let best = null, bestA = 0;
  for (const p of polys) {
    const r = p[0];
    let A = 0, cx = 0, cy = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const f = r[j][0] * r[i][1] - r[i][0] * r[j][1]; A += f; cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f; }
    if (Math.abs(A) > bestA) { bestA = Math.abs(A); best = [cx / (3 * A), cy / (3 * A)]; }
  }
  if (center && geom && inGeom([center[1], center[0]], geom)) return [center[1], center[0]];
  return best;
}
export function geomBounds(ml, geom) {
  const b = new ml.LngLatBounds();
  const polys = geom?.type === 'Polygon' ? [geom.coordinates] : geom?.coordinates ?? [];
  for (const p of polys) for (const pt of p[0]) b.extend(pt);
  return b;
}
export async function districtStyle() {
  const st = await mapStyle();
  for (const l of st.layers) if (l.type === 'symbol') (l.layout ??= {}).visibility = 'none';
  return st;
}
export function DistrictsMap({ sel: sel0 }) {
  const d = D();
  const s = d.search;
  const areas = regionPack()?.areas ?? {};
  const geo = useAreasGeo(s.country);
  const [sel, setSel] = useState(sel0 && areas[sel0] ? sel0 : null);
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
      const c = subRegion()?.center ?? (Object.values(areas)[0] as any)?.center ?? [0, 0];
      const map = new ml.Map({ container: box.current, style, center: [c[1], c[0]], zoom: 10, attributionControl: false, dragRotate: false, pitchWithRotate: false, fadeDuration: 0 });
      map.touchZoomRotate.disableRotation();
      mapR.current = map;
      map.on('load', () => !dead && setReady(true));
    }).catch(() => !dead && setFail(true));
    return () => { dead = true; marks.current.forEach((m) => m.remove()); marks.current = []; mapR.current?.remove(); mapR.current = null; };
  }, [theme]);
  // Outlines + fills; the first time also fits the city's areas.
  useEffect(() => {
    const map = mapR.current;
    const ml = window.maplibregl;
    if (!ready || !map || !ml || !geo) return;
    const accent = cssVar('--map-accent'), ink2 = cssVar('--ink-2'), s2 = cssVar('--map-fill');
    if (!map.getSource('areas')) {
      map.addSource('areas', { type: 'geojson', data: geo, promoteId: 'id' });
      map.addLayer({ id: 'areas-fill', type: 'fill', source: 'areas', paint: { 'fill-color': ['case', ['boolean', ['feature-state', 'sel'], false], accent, s2], 'fill-opacity': ['case', ['boolean', ['feature-state', 'sel'], false], 0.2, 0.45] } });
      map.addLayer({ id: 'areas-line', type: 'line', source: 'areas', layout: { 'line-join': 'round' }, paint: { 'line-color': ['case', ['boolean', ['feature-state', 'sel'], false], accent, ink2], 'line-width': ['case', ['boolean', ['feature-state', 'sel'], false], 3, 1.4], 'line-opacity': ['case', ['boolean', ['feature-state', 'sel'], false], 1, 0.75] } });
      map.on('click', 'areas-fill', (e) => { const id = e.features?.[0]?.properties?.id; if (id) { hap.sel(); setSel(id); } });
      map.on('mouseenter', 'areas-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'areas-fill', () => { map.getCanvas().style.cursor = ''; });
      const city = String(s.region).split('/')[1];
      const cc = subRegion()?.center;
      const near = geo.features.filter((f) => { const a = areas[f.properties.id]; return a && (a.city === city || (cc && a.center && km(cc, a.center) < 30)); });
      const b = new ml.LngLatBounds();
      for (const f of near.length ? near : geo.features) b.extend(geomBounds(ml, f.geometry));
      const sheetH = document.querySelector('.ds-sheet')?.getBoundingClientRect().height ?? 0;
      if (!b.isEmpty()) map.fitBounds(b, { padding: { top: 90, bottom: sheetH ? sheetH + 10 : 40, left: 24, right: 24 }, duration: 0, maxZoom: 13 });
    }
  }, [ready, geo]);
  // Selection: highlight, labels, bring the area into view above the sheet.
  useEffect(() => {
    const map = mapR.current;
    const ml = window.maplibregl;
    if (!ready || !map || !ml || !geo || !map.getSource('areas')) return;
    for (const f of geo.features) map.setFeatureState({ source: 'areas', id: f.properties.id }, { sel: f.properties.id === sel });
    marks.current.forEach((m) => m.remove());
    marks.current = [];
    for (const f of geo.features) {
      const a = areas[f.properties.id];
      const pt = labelPoint(f.geometry, a?.center);
      if (!pt) continue;
      const el = document.createElement('button');
      el.className = 'ds-label' + (f.properties.id === sel ? ' sel' : '');
      el.textContent = areaName(a) || f.properties.name_en;
      el.addEventListener('click', (e) => { e.stopPropagation(); hap.sel(); setSel(f.properties.id); });
      el.style.zIndex = f.properties.id === sel ? '5' : '1';
      marks.current.push(new ml.Marker({ element: el, anchor: 'center' }).setLngLat(pt).addTo(map));
    }
    if (sel) {
      const f = geo.features.find((x) => x.properties.id === sel);
      if (f) {
        const b = geomBounds(ml, f.geometry);
        const view = map.getBounds();
        const H = box.current.clientHeight;
        const sheetH = document.querySelector('.ds-sheet')?.getBoundingClientRect().height ?? H * 0.45;
        const nw = map.unproject([30, 80]), se = map.unproject([box.current.clientWidth - 30, H - sheetH - 20]);
        const visible = b.getWest() > nw.lng && b.getEast() < se.lng && b.getNorth() < nw.lat && b.getSouth() > se.lat;
        if (!visible || !view.contains(b.getCenter())) map.fitBounds(b, { padding: { top: 110, bottom: sheetH + 40, left: 60, right: 60 }, maxZoom: 12, duration: reduceMotion() ? 0 : 450 });
      }
    }
  }, [ready, geo, sel, LANG]);
  const a = sel ? areas[sel] : null;
  const st = a ? areaStats(sel, a, geo) : null;
  const pct = a ? fitPct(sel, a) : 0;
  const cur = briefCur(s);
  const tile2 = a ? (a.ocean_min != null && a.ocean_min > 30 ? [minLabel(a.ocean_min), t('ds_ocean')] : a.airport_min != null ? [minLabel(a.airport_min), t('ds_airport')] : a.ocean_min != null ? [minLabel(a.ocean_min), t('ds_ocean')] : null) : null;
  const rname = regionPack()?.name;
  const regionWord = rname ? (LANG === 'ru' ? rname.ru : rname.en) : '';
  return html`<main class="map-screen ds-screen">
    <div class="map" ref=${box} role="application" aria-label=${t('ds_mode')}></div>
    <div class="map-top ds-top">
      <button class="ds-pill" onClick=${() => go(sp('map'), true)}><${Icon} n="map" />${regionWord ? t('ds_map', { r: regionWord }) : t('ds_map_plain')}</button>
      ${!sel && html`<span class="ds-hint">${t('ds_hint')}</span>`}
      ${sel && html`<span class="ds-hint">${t('ds_hint')}</span>`}
    </div>
    ${fail && html`<div class="center-msg" style="position:absolute;inset:40% 0 auto">${t('map_fail')}</div>`}
    ${a ? html`<div class="ds-sheet" role="dialog" aria-label=${areaName(a)}><div class="grip"></div>
      <button class="ds-hd" onClick=${() => go(sp('district', sel))}><h2 class="ds-name">${areaName(a)}</h2><span class=${'ds-fit ' + (pct >= 75 ? 'hi' : pct >= 50 ? 'mid' : 'lo')}>${t('ds_fit', { n: pct })}</span></button>
      <div class="chips ds-tags">${(a.tags?.[LANG] ?? a.tags?.en ?? []).map((x) => html`<span class="ds-tag">${x}</span>`)}</div>
      <p class="ds-vibe">${a.vibe?.[LANG] ?? a.vibe?.en}</p>
      ${a.flood && html`<p class=${'ds-flood ' + a.flood.level}><${Icon} n="cloud-rain" cls="sm" />${t('ds_flood', { x: t('fl_' + a.flood.level) })}</p>`}
      <div class="w3-tiles ds-tiles">
        <div class="card"><b>${rangeText(st.range, cur)}</b><span>${dsBr(briefBeds())}</span></div>
        <div class="card"><b>${tile2 ? tile2[0] : '—'}</b><span>${tile2 ? tile2[1] : ''}</span></div>
        <div class="card"><b>${st.listings.length}</b><span>${t('ds_listings', { n: st.listings.length })}</span></div>
      </div>
      <div class="ds-btns">
        <button class="btn accent big" onClick=${() => go(sp('listings', 'area-' + sel))}>${t('ds_here')}</button>
        ${inBrief(sel, a) ? html`<button class="btn outline big" disabled><${Icon} n="check" />${t('ds_in_brief')}</button>`
          : html`<button class="btn outline big" disabled=${!canVoteRole(d.me.role)} onClick=${() => addAreaToBrief(sel, a)}><${Icon} n="plus" />${t('ds_to_brief')}</button>`}
      </div></div>` : html`<${Nav} tab="map" />`}
    <span class="attrib" style=${a ? 'display:none' : ''}>© OpenFreeMap © OpenStreetMap</span>
  </main>`;
}
export function DistrictDetail({ id }) {
  const d = D();
  const a = regionPack()?.areas?.[id];
  const geo = useAreasGeo(d.search.country);
  if (!a) return html`<main class="screen no-nav"><div class="center-msg">—</div></main>`;
  const pct = fitPct(id, a);
  const cur = briefCur(d.search);
  const beds = briefBeds();
  const b2 = [beds, beds + 1];
  const stats = b2.map((n) => areaStats(id, a, geo, n));
  const crmN = stats.reduce((x, s0) => x + (s0.fromCrm ? s0.n : 0), 0);
  const L = (o) => o?.[LANG] ?? o?.en ?? [];
  return html`<main class="screen w2 no-nav">
    <div class="head w3-head"><div class="row" style="align-items:flex-start"><${BackIfWeb} /><div><p class="kicker">${L(a.group)}</p><h1 class="h1 w3-h1">${areaName(a)}</h1></div></div>
      <div class=${'ds-badge ' + (pct >= 75 ? 'hi' : pct >= 50 ? 'mid' : 'lo')}><b>${pct}</b><span>${t('ds_fit_short')}</span></div></div>
    <p class="ds-vibe big">${L(a.vibe)}</p>
    ${a.flood && html`<div class="card w2-list"><div class="w2-row w3-irow"><${Icon} n="cloud-rain" cls=${a.flood.level === 'low' ? 'pl-ic-ok' : 'pl-ic-over'} /><div class="grow"><b>${t('ds_flood', { x: t('fl_' + a.flood.level) })}</b><span>${L(a.flood.note)}</span></div></div></div>`}
    <div class="card ds-scores"><p class="w3-ct">${t('ds_scores')}</p>
      ${SCORE_KEYS.filter((k) => a.scores?.[k] != null).map((k) => html`<div class="ds-sc"><span>${t('sc_' + k)}</span><div class="ds-seg" role="img" aria-label=${`${a.scores[k]} / 5`}>${[1, 2, 3, 4, 5].map((i) => html`<i class=${i <= a.scores[k] ? 'on' : ''}></i>`)}</div></div>`)}
    </div>
    <div class="w3-tiles">
      ${b2.map((n, i) => html`<div class="card"><b>${rangeText(stats[i].range, cur)}</b><span>${dsBr(n)}</span></div>`)}
      <div class="card"><b>${a.airport_min != null ? minLabel(a.airport_min) : a.ocean_min != null ? minLabel(a.ocean_min) : '—'}</b><span>${a.airport_min != null ? t('ds_airport') : t('ds_ocean')}</span></div>
    </div>
    <div class="ds-pc">
      <div class="card"><p class="pros">${t('ds_pros')}</p>${L(a.pros).map((x) => html`<p>· ${x}</p>`)}</div>
      <div class="card"><p class="cons">${t('ds_cons')}</p>${L(a.cons).map((x) => html`<p>· ${x}</p>`)}</div>
    </div>
    <div class="ds-btns" style="margin-top:14px">
      <button class="btn accent big" onClick=${() => go(sp('listings', 'area-' + id))}>${t('ds_here')}</button>
      ${inBrief(id, a) ? html`<button class="btn outline big" disabled><${Icon} n="check" />${t('ds_in_brief')}</button>`
        : html`<button class="btn outline big" disabled=${!canVoteRole(d.me.role)} onClick=${() => addAreaToBrief(id, a)}><${Icon} n="plus" />${t('ds_to_brief')}</button>`}
    </div>
    <p class="w2-foot">${crmN ? t('ds_foot_crm', { n: crmN }) : t('ds_foot_pack')}</p>
  </main>`;
}
