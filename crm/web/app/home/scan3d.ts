import { api } from '../core/api.js';
import { D, canVoteRole, photosOf } from '../core/data.js';
import { fmtDM, fmtNum, fmtTime } from '../core/format.js';
import { LANG, t } from '../core/i18n.js';
import { go, openLink, sp } from '../core/routing.js';
import { hap, toast } from '../core/store.js';
import { Icon } from '../ui/icons.js';
import { Nav } from '../ui/pieces.js';
import { W3Head, dealListing, homeName } from './helpers.js';
import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';

// ---------------------------------------------------------------- 3D act (34)
export const MODEL_VIEWER = 'https://unpkg.com/@google/model-viewer@4.0.0/dist/model-viewer.min.js';
export let mvPromise = null;
export function loadModelViewer() {
  if (customElements.get('model-viewer')) return Promise.resolve();
  return (mvPromise ??= new Promise<any>((res, rej) => {
    const s = document.createElement('script');
    s.type = 'module';
    s.src = MODEL_VIEWER;
    s.onload = () => customElements.whenDefined('model-viewer').then(res);
    s.onerror = () => { mvPromise = null; rej(new Error('model-viewer')); };
    document.head.append(s);
  }));
}
export function roomIcon(r) {
  const s = String(r).toLowerCase();
  return /гост|living|lounge/.test(s) ? 'sofa' : /спал|bed/.test(s) ? 'bed' : /кух|kitchen/.test(s) ? 'cooking-pot' : /терр|басс|pool|terrace/.test(s) ? 'waves' : /ван|душ|bath|shower/.test(s) ? 'shower-head' : /байк|bike/.test(s) ? 'bike' : 'box';
}
export const docUrlCache: Bag = {};
export async function docUrl(id) {
  const c = docUrlCache[id];
  if (c && Date.now() - c.at < 12 * 60e3) return c.url;
  const r = await api('/app/api/doc-link', { id });
  const u = new URL(r.url, location.href);
  const url = u.pathname + u.search; // same origin: model-viewer fetches it with XHR
  docUrlCache[id] = { url, at: Date.now() };
  return url;
}
export function Model({ scan, poster, label }) {
  const [src, setSrc] = useState(null);
  const [err, setErr] = useState(false);
  const mv = useRef(null);
  useEffect(() => {
    const el = mv.current;
    if (!el) return;
    const f = () => { setErr(true); setSrc(null); };
    el.addEventListener('error', f);
    return () => el.removeEventListener('error', f);
  }, [src]);
  useEffect(() => {
    let dead = false;
    setSrc(null); setErr(false);
    if (!scan?.doc_id || !scan.has_file) return;
    Promise.all([loadModelViewer(), docUrl(scan.doc_id)]).then(([, u]) => !dead && setSrc(u)).catch(() => !dead && setErr(true));
    return () => { dead = true; };
  }, [scan?.doc_id]);
  const cap = scan ? [t('ac_scan', { d: fmtDM(scan.doc_at ?? scan.created_at) }) + ' · ' + fmtTime(scan.doc_at ?? scan.created_at), scan.app, scan.doc_size ? `${fmtNum(Math.round(scan.doc_size / 1e5) / 10)} ${LANG === 'ru' ? 'МБ' : 'MB'}` : null].filter(Boolean).join(' · ') : '';
  return html`<div class="ac-view" style=${poster ? `--poster:url(${poster})` : ''}>
    ${src ? html`<model-viewer ref=${mv} src=${src} camera-controls touch-action="pan-y" ar ar-modes="webxr scene-viewer quick-look" shadow-intensity="0.6" exposure="1" interaction-prompt="none" style="width:100%;height:100%">
        <button slot="ar-button" class="ac-ar"><${Icon} n="scan" cls="sm" />AR</button></model-viewer>`
      : html`<div class="ac-ph">${err ? t('ac_fail') : scan?.has_file ? t('ac_loading') : ''}</div>`}
    <span class="ac-pill"><${Icon} n="box" cls="sm" />${label ?? t('ac_spin')}</span>
    ${!src && html`<span class="ac-ar ghost"><${Icon} n="scan" cls="sm" />AR</span>`}${!src && !err && html`<span class="ac-rot"><${Icon} n="rotate-3d" /></span>`}
    ${cap && html`<span class="ac-cap">${cap}</span>`}
  </div>`;
}
export function Act() {
  const d = D();
  const l = dealListing();
  const scans = (d.scans ?? []).filter((s) => s.phase !== 'bike');
  const ins = scans.filter((s) => s.phase === 'movein');
  const outs = scans.filter((s) => s.phase === 'moveout' && s.has_file);
  const withFile = ins.filter((s) => s.has_file);
  const [sel, setSel] = useState(withFile[0]?.id ?? null);
  const cur = ins.find((s) => s.id === sel) ?? withFile[0] ?? null;
  const pair = cur ? outs.find((o) => o.room.toLowerCase() === cur.room.toLowerCase()) ?? (outs.length && ins.length === 1 ? outs[0] : null) : null;
  const terms = d.deal?.data?.terms ?? {};
  const moveOut = d.moveout?.date ?? terms.to ?? null;
  const done = ins.filter((s) => s.has_file && s.status === 'ok').length;
  const send = async () => { try { await api('/app/api/scan-send', { search_id: d.search.id }); hap.ok(); toast(t('ac_sent')); } catch { toast(t('err_generic')); } };
  const ph = photosOf(l)[0];
  return html`<main class="screen w2">
    <${W3Head} kicker=${terms.from ? t('ac_kicker', { home: homeName(), d: fmtDM(terms.from) }) : homeName()} title=${t('ac_title')} />
    ${cur ? (pair ? html`<div class="ac-pair"><${Model} scan=${cur} poster=${ph} label=${t('ac_in')} /><${Model} scan=${pair} poster=${ph} label=${t('ac_out')} /></div>` : html`<${Model} scan=${cur} poster=${ph} />`)
      : html`<div class="w3-big acc"><p class="w3-big-k"><${Icon} n="box" />${t('ac_none_t')}</p><p class="w3-big-s">${t('ac_none')}</p></div>
        ${d.bot_username && html`<button class="btn surface block" style="margin-bottom:14px" onClick=${() => openLink(`https://t.me/${d.bot_username}`)}><${Icon} n="send" cls="sm" />${t('ac_open_bot')}</button>`}`}
    ${ins.length > 0 && html`<div class="card w2-list"><div class="w2-lh"><span>${t('ac_rooms', { x: done, n: ins.length })}</span></div>
      ${ins.map((s) => html`<button key=${s.id} class=${'w2-row w3-irow' + (cur?.id === s.id ? ' ac-sel' : '')} disabled=${!s.has_file} onClick=${() => { hap.sel(); setSel(s.id); }}>
        <span class="sq big"><${Icon} n=${roomIcon(s.room)} /></span><div class="grow"><b>${s.room}</b>
        <span>${s.status === 'redo' ? [t('ac_redo'), s.note].filter(Boolean).join(' — ') : s.status === 'todo' || !s.has_file ? [t('ac_todo'), s.note].filter(Boolean).join(' — ') : s.status === 'redo' ? [t('ac_redo'), s.note].filter(Boolean).join(' — ') : [fmtDM(s.doc_at ?? s.created_at), s.note].filter(Boolean).join(' · ')}</span></div>
        <${Icon} n=${s.status === 'ok' && s.has_file ? 'circle-check' : s.status === 'redo' ? 'circle-alert' : 'circle-dashed'} cls=${s.status === 'ok' && s.has_file ? 'pl-ic-ok' : s.status === 'redo' ? 'pl-ic-over' : 'muted'} /></button>`)}</div>`}
    <div class="ac-btns">
      <button class="btn accent big" disabled=${!withFile.length || !canVoteRole(d.me.role)} onClick=${send}><${Icon} n="send" />${t('ac_send')}</button>
      <button class="btn outline big" onClick=${() => go(sp('bikes'))}><${Icon} n="bike" />${t('bk_title')}</button>
    </div>
    <p class="w2-foot">${moveOut ? t('ac_foot', { d: fmtDM(moveOut) }) : t('ac_foot_nodate')}</p>
    <${Nav} tab="today" />
  </main>`;
}
