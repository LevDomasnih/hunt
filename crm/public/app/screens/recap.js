// Split from app.js (wave 11): see the section comment below.
import { api, authHeaders, cssVar } from '../core/api.js';
import { D, photoUrl } from '../core/data.js';
import { inTG } from '../core/env.js';
import { firstName, initial, money } from '../core/format.js';
import { LANG, t } from '../core/i18n.js';
import { S, hap, toast } from '../core/store.js';
import { BackIfWeb, inPlace, msgCard, skel } from '../home/helpers.js';
import { Av, Icon } from '../ui/icons.js';
import { joinNames } from './deal.js';
import { html, useEffect, useState } from 'https://unpkg.com/htm@3.1.1/preact/standalone.module.js';

// ---------------------------------------------------------------- wave 5: search recap (43)
export function recapTexts(rc) {
  const [c, sub] = String(rc.search?.region ?? '').split('/');
  const reg = S.regions?.[c];
  const nm = (x) => x?.[LANG] ?? x?.en ?? null;
  const area = nm(reg?.sub?.[sub]?.name) ?? rc.search?.region_name ?? nm(reg?.name) ?? '';
  const country = nm(reg?.name) ?? rc.search?.region_name ?? '';
  const ms = rc.members ?? [];
  const title = t(ms.length > 1 ? 'rc_found' : 'rc_found1', { a: joinNames(ms.map((m) => firstName(m.name))), p: inPlace(area) }).trim();
  const k = rc.counts ?? {};
  const num = (x) => Number(x ?? 0);
  const tiles = [[num(k.contacted), t('rc_contacted')], [num(k.replied), t('rc_replied')], [num(k.viewings), t('rc_viewings', { n: num(k.viewings) })], [num(k.deals), t('rc_deals', { n: num(k.deals) })]];
  const p = rc.prices;
  const saved = p && p.saved_month > 0 ? (p.saved_term > p.saved_month ? t('rc_saved', { m: money(p.saved_month, p.currency), t: money(p.saved_term, p.currency) }) : t('rc_saved1', { m: money(p.saved_month, p.currency) })) : null;
  return { title, days: rc.days != null ? t('rc_in_days', { n: rc.days }) : null, tiles, saved, foot: ['hunt', country].filter(Boolean).join(' · ') };
}
export function RecapCard({ rc, x }) {
  const ph = photoUrl(rc.listing?.photo);
  return html`<div class="rc-card">
    <div class="rc-top"><span class="avs rc-avs">${(rc.members ?? []).slice(0, 5).map((m) => html`<${Av} key=${m.user_id} m=${m} size=${34} />`)}</span><b>${x.title}</b></div>
    ${ph && html`<img class="rc-photo" src=${ph} alt="" decoding="async" />`}
    ${x.days && html`<p class="rc-days">${x.days}</p>`}
    <div class="rc-tiles">${x.tiles.map(([v, lb], i) => html`<div key=${i}><b>${v}</b><span>${lb}</span></div>`)}</div>
    ${x.saved && html`<div class="rc-saved"><${Icon} n="trending-down" /><span>${x.saved}</span></div>`}
    <p class="rc-foot">${x.foot}</p>
  </div>`;
}
export const loadImg = (src) => new Promise((res) => {
  if (!src) return res(null);
  const im = new Image();
  try { if (new URL(src, location.href).origin !== location.origin) im.crossOrigin = 'anonymous'; } catch { /* keep */ }
  im.onload = () => res(im);
  im.onerror = () => res(null);
  im.src = src;
});
export function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
export function wrapLines(ctx, text, maxW) {
  const out = [];
  let cur = '';
  for (const w of String(text).split(/\s+/)) {
    const tst = cur ? cur + ' ' + w : w;
    if (cur && ctx.measureText(tst).width > maxW) { out.push(cur); cur = w; } else cur = tst;
  }
  if (cur) out.push(cur);
  return out;
}
/** The recap card drawn to a 1080 px wide PNG (same layout as RecapCard). */
export async function recapPng(rc, x) {
  await document.fonts?.ready;
  await Promise.all(['600 32px Unbounded', '600 16px Inter', '400 13px Inter'].map((f) => document.fonts?.load(f).catch(() => null)));
  const css = (n) => cssVar(n);
  const W = 358, k = 1080 / W, P = 20, IW = W - 2 * P;
  const ms = (rc.members ?? []).slice(0, 5);
  const [photo, ...avs] = await Promise.all([loadImg(photoUrl(rc.listing?.photo)), ...ms.map((m) => loadImg(m.animal ? `/art/${m.animal.pack}/avatars/${m.animal.slug}.svg` : null))]);
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  const avW = ms.length ? 34 + (ms.length - 1) * 24 : 0;
  ctx.font = '600 16px Inter';
  const tl = wrapLines(ctx, x.title, IW - avW - 12);
  ctx.font = '600 15px Inter';
  const sl = x.saved ? wrapLines(ctx, x.saved, IW - 28 - 32) : [];
  const topH = Math.max(34, tl.length * 21);
  let y = P + topH;
  const photoY = y + 14, photoH = photo ? 150 : 0;
  if (photo) y = photoY + photoH;
  const daysY = y + 18;
  if (x.days) y = daysY + 40;
  const tilesY = y + 14, tileH = 58;
  y = tilesY + tileH * 2 + 8;
  const savedY = y + 14, savedH = 28 + sl.length * 20;
  if (x.saved) y = savedY + savedH;
  const footY = y + 22;
  const H = footY + 14 + P;
  cv.width = 1080;
  cv.height = Math.round(H * k);
  ctx.scale(k, k);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = css('--rc-bg');
  rrect(ctx, 0, 0, W, H, 28);
  ctx.fill();
  // avatars
  const cy = P + topH / 2;
  ms.forEach((m, i) => {
    const cx = P + 17 + i * 24;
    ctx.fillStyle = css('--rc-ring');
    ctx.beginPath(); ctx.arc(cx, cy, 19, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = m.animal?.bg_light || '#E4E9E4';
    ctx.beginPath(); ctx.arc(cx, cy, 17, 0, Math.PI * 2); ctx.fill();
    if (avs[i]) ctx.drawImage(avs[i], cx - 13.25, cy - 13.25, 26.5, 26.5);
    else { ctx.fillStyle = '#132019'; ctx.font = '600 14px Inter'; ctx.textAlign = 'center'; ctx.fillText(initial(m.name), cx, cy + 5); ctx.textAlign = 'left'; }
  });
  ctx.fillStyle = css('--rc-ink');
  ctx.font = '600 16px Inter';
  tl.forEach((s, i) => ctx.fillText(s, P + avW + 12, cy - (tl.length * 21) / 2 + 15 + i * 21));
  if (photo) {
    ctx.save();
    rrect(ctx, P, photoY, IW, photoH, 18);
    ctx.clip();
    const sc = Math.max(IW / photo.naturalWidth, photoH / photo.naturalHeight);
    const w = photo.naturalWidth * sc, h = photo.naturalHeight * sc;
    ctx.drawImage(photo, P + (IW - w) / 2, photoY + (photoH - h) / 2, w, h);
    ctx.restore();
  }
  if (x.days) { ctx.fillStyle = css('--rc-ink'); ctx.font = '600 32px Unbounded'; ctx.fillText(x.days, P, daysY + 32); }
  const tw = (IW - 8) / 2;
  x.tiles.forEach(([v, lb], i) => {
    const tx = P + (i % 2) * (tw + 8), ty = tilesY + Math.floor(i / 2) * (tileH + 8);
    ctx.fillStyle = css('--rc-tile');
    rrect(ctx, tx, ty, tw, tileH, 16); ctx.fill();
    ctx.fillStyle = css('--rc-ink'); ctx.font = '600 22px Unbounded'; ctx.fillText(String(v), tx + 12, ty + 29);
    ctx.fillStyle = css('--rc-ink-2'); ctx.font = '400 12.5px Inter'; ctx.fillText(lb, tx + 12, ty + 47);
  });
  if (x.saved) {
    ctx.fillStyle = css('--rc-save');
    rrect(ctx, P, savedY, IW, savedH, 16); ctx.fill();
    ctx.save();
    ctx.translate(P + 14, savedY + 14 + 1);
    ctx.scale(20 / 24, 20 / 24);
    ctx.strokeStyle = css('--rc-green'); ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.stroke(new Path2D('M22 17 13.5 8.5l-5 5L2 7M16 17h6v-6'));
    ctx.restore();
    ctx.fillStyle = css('--rc-ink'); ctx.font = '600 15px Inter';
    sl.forEach((s, i) => ctx.fillText(s, P + 14 + 20 + 12, savedY + 14 + 15 + i * 20));
  }
  ctx.fillStyle = css('--rc-ink-2'); ctx.font = '600 12px Inter';
  ctx.fillText(x.foot, P, footY + 12);
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('png'))), 'image/png'));
}
export function RecapScreen() {
  const d = D();
  const [rc, setRc] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/app/api/recap?search_id=' + encodeURIComponent(d.search.id)).then(setRc).catch(() => setRc({ failed: true })); }, [d.search.id]);
  const x = rc && !rc.failed ? recapTexts(rc) : null;
  async function share() {
    setBusy(true);
    try {
      const blob = await recapPng(rc, x);
      if (inTG) {
        const r = await fetch('/app/api/recap-share?search_id=' + encodeURIComponent(d.search.id), { method: 'POST', headers: { ...authHeaders(), 'content-type': 'image/png' }, body: blob });
        if (!r.ok) throw new Error(String(r.status));
        hap.ok();
        toast(t('rc_sent'));
      } else {
        const file = new File([blob], 'hunt-recap.png', { type: 'image/png' });
        if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text: t('rc_share_text') }).catch(() => null);
        else {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'hunt-recap.png';
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        }
      }
    } catch { toast(t('err_generic')); }
    setBusy(false);
  }
  return html`<main class="screen w2 no-nav">
    ${!inTG && html`<div class="rc-back"><${BackIfWeb} /></div>`}
    ${rc == null ? skel(520) : rc.failed ? msgCard(t('err_generic')) : html`<${RecapCard} rc=${rc} x=${x} />
      ${rc.complete === false && html`<p class="w2-foot" style="margin-top:12px">${t('rc_incomplete')}</p>`}
      <button class="btn accent block big rc-share" disabled=${busy} onClick=${share}><${Icon} n="share-2" />${t('rc_share')}</button>`}
  </main>`;
}
