// Split from app.js (wave 11): see the section comment below.
import { api } from '../core/api.js';
import { D } from '../core/data.js';
import { dayKey, wdShort } from '../core/format.js';
import { LANG, STR, t } from '../core/i18n.js';
import { go, openLink, sp } from '../core/routing.js';
import { emit, hap, toast } from '../core/store.js';
import { modeWord, useBasePlaces } from '../places/places.js';
import { Icon } from '../ui/icons.js';
import { Nav, WaterCard } from '../ui/pieces.js';
import { fmtDMshort } from './calendar.js';
import { GuestNav } from './guests.js';
import { W3Head, fmt1, hOnly, hm, isGuest, mapLink, msgCard, skel } from './helpers.js';
import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';

// ---------------------------------------------------------------- wave 5: surf (39)
export function briefMentionsSurf() {
  const b = D()?.search?.brief ?? {};
  if ((b.anchors ?? []).some((a) => a.type === 'surf') || b.anchor?.icon === 'waves') return true;
  return /surf|серф|волн|wave/i.test([b.must_have, b.nice_to_have].filter(Boolean).join(' '));
}
export const surfCache: Bag = {};
export function useSurf(sid, on = true) {
  const [v, setV] = useState(surfCache[sid] ?? null);
  useEffect(() => {
    if (!on || !sid) return;
    const c = surfCache[sid];
    if (c && Date.now() - c._at < 15 * 60e3) { setV(c); return; }
    api('/app/api/surf?search_id=' + encodeURIComponent(sid))
      .then((j) => { j._at = Date.now(); surfCache[sid] = j; setV(j); emit(); })
      .catch((e) => setV({ failed: true, code: e.code, spots: [] }));
  }, [sid, on]);
  return v;
}
export const sfH = (h) => (h == null ? '—' : t('sf_m', { x: fmt1(h) }));
export const surfBest = (v) => v?.spots?.find((x) => x.id === v.best) ?? null;
export function surfWind(w) {
  if (!w) return null;
  if (w.offshore_until) return t('sf_off_until', { h: hOnly(w.offshore_until) }) + (w.later && STR.en['sf_later_' + w.later] ? t('sf_later_' + w.later) : '');
  if (w.offshore_from) return t('sf_off_from', { h: hOnly(w.offshore_from) });
  return w.later === 'onshore' ? t('sf_onshore') : null;
}
export function surfSpotSub(x) {
  const kind = [x.bottom ? t('sf_' + x.bottom) : null, x.level ? t('sf_lv_' + x.level) : null].filter(Boolean).join(', ');
  return [x.minutes != null ? t('em_min', { n: x.minutes }) : null, kind || null].filter(Boolean).join(' · ');
}
/** "Сегодня Green Bowl 1,2 м, лучше до 10:00". */
export function surfLine(v) {
  const b = surfBest(v);
  if (!b || b.height == null) return null;
  return b.window?.to ? t('sf_line', { s: b.name, h: sfH(b.height), t: hm(b.window.to) }) : t('sf_line0', { s: b.name, h: sfH(b.height) });
}
export async function setSurfPref(v) {
  const d = D();
  hap.sel();
  d.me.surf = v;
  d.me.surf_auto = false;
  emit();
  try { await api('/app/api/prefs', { search_id: d.search.id, surf: v }); toast(t(v ? 'sf_on' : 'sf_off')); }
  catch { toast(t('err_generic')); }
}
/** Surf as a living-water card (search-mode Today; K0 "Серф сегодня · Green Bowl до 10:00 · 1,2 м · ветер с берега"). */
export function SurfWaterCard({ v }) {
  const b = surfBest(v);
  const ok = b && b.height != null;
  return html`<${WaterCard} cls="pw-surf" label=${t('sf_title')} onClick=${() => go(sp('surf'))}>
    <span class="water-k">${t('sf_row_today')}</span>
    <b class="water-v">${ok ? (b.window?.to ? t('pw_surf_until', { s: b.name, t: hm(b.window.to) }) : b.name) : t('sf_row')}</b>
    <span class="water-s">${ok ? [sfH(b.height), surfWind(b.wind)].filter(Boolean).join(' · ') : t('sf_row_sub')}</span>
  <//>`;
}
export function SurfScreen() {
  const d = D();
  const v = useSurf(d.search.id);
  const base = useBasePlaces(d.search.country);
  const guest = isGuest();
  const best = surfBest(v);
  const spots = v?.spots ? [...v.spots].sort((a, b) => +((b.id === v.best)) - +((a.id === v.best))) : [];
  const date = v?.date ?? dayKey(new Date().toISOString());
  const wd = wdShort(date);
  const kicker = [v?.area_name || v?.home?.label || null, `${t('today')}, ${LANG === 'ru' ? wd.toLowerCase() : wd} ${fmtDMshort(date)}`].filter(Boolean).join(' · ');
  const mw = modeWord();
  const linkOf = (x) => {
    const p = (base?.places ?? []).find((y) => y.id === x.id) ?? (d.places ?? []).find((y) => y.id === x.id);
    return p?.lat != null ? mapLink(p.lat, p.lng) : null;
  };
  const heroSub = best && `${[sfH(best.height), best.period != null ? t('sf_period', { n: best.period }) : null, surfWind(best.wind)].filter(Boolean).join(' · ')}${best.minutes != null ? ` · ${t('em_min', { n: best.minutes })}${mw ? ' ' + mw : ''}` : ''}`;
  let body;
  if (v == null) body = skel(150);
  else if (!spots.length) body = msgCard(v.failed || v.error ? t('sf_err') : !v.home ? t('sf_no_home') : t('sf_none'));
  else {
    body = html`<${WaterCard} cls="pw-surf-hd"><span class="water-k">${t('sf_best')}</span>
        ${best ? html`<b class="water-v">${best.name}${best.window && html` · <span class="nw">${hm(best.window.from)}–${hm(best.window.to)}</span>`}</b><span class="water-s">${heroSub}</span>`
          : html`<b class="water-v">${t('sf_flat_t')}</b><span class="water-s">${v.error ? t('sf_err_short') : t('sf_flat')}</span>`}<//>
      <div class="card w2-list"><div class="w2-lh"><span>${t('sf_near')}</span></div>
        ${spots.map((x) => {
          const link = linkOf(x);
          const st = x.stars ?? 1;
          const inner = html`<span class="sq"><${Icon} n="waves" /></span><div class="grow"><b>${x.name}</b><span>${surfSpotSub(x)}</span></div>
            <div class="sf-r"><b>${sfH(x.height)}</b>${x.period != null && html`<span class=${'sf-q s' + st} aria-label=${t('sp_tier') + ' ' + st}>${t('sf_s', { n: x.period })} · ${'★'.repeat(st)}</span>`}</div>`;
          return link ? html`<button key=${x.id} class="w2-row w3-irow" onClick=${() => openLink(link)}>${inner}</button>` : html`<div key=${x.id} class="w2-row w3-irow">${inner}</div>`;
        })}
      </div>
      ${v.error && best && html`<p class="w2-foot" style="margin:0 2px 14px">${t('sf_err_short')}</p>`}`;
  }
  return html`<main class="screen w2">
    <${W3Head} kicker=${kicker} title=${t('sf_title')} />
    ${body}
    ${!guest && html`<button class="w2-note" role="switch" aria-checked=${d.me.surf ? 'true' : 'false'} onClick=${() => setSurfPref(!d.me.surf)}><${Icon} n="sunrise" /><span>${t(d.me.surf ? 'sf_note_on' : 'sf_note_off')}</span></button>`}
    ${guest ? html`<${GuestNav} tab="today" />` : html`<${Nav} tab="today" />`}
  </main>`;
}
