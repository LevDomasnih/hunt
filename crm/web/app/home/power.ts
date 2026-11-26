// Split from app.js (wave 11): see the section comment below.
import { D, canVoteRole } from '../core/data.js';
import { dfmt, fmtDM, fmtNum, money } from '../core/format.js';
import { LANG, cap, t } from '../core/i18n.js';
import { go, sp } from '../core/routing.js';
import { emit, hap, toast } from '../core/store.js';
import { briefCur } from '../screens/deal.js';
import { Icon } from '../ui/icons.js';
import { Nav } from '../ui/pieces.js';
import { W3Head, homeName, pickFiles, regionPack, uploadImage } from './helpers.js';
import { d2voters } from './money.js';
import { html } from 'htm/preact';
import { useState } from 'preact/hooks';

// ---------------------------------------------------------------- power tokens (25)
export function Power() {
  const d = D();
  const pw = d.power ?? {};
  const pk = regionPack()?.power ?? null;
  const [busy, setBusy] = useState(false);
  const canAct = canVoteRole(d.me.role);
  async function shoot() {
    const [f] = await pickFiles({ capture: true });
    if (!f) return;
    setBusy(true);
    try { const r = await uploadImage('/app/api/meter-photo?search_id=' + encodeURIComponent(d.search.id), f); d.power = r.power; hap.ok(); toast(t('pw_sent')); emit(); }
    catch { toast(t('err_generic')); }
    setBusy(false);
  }
  const days = pw.days_left != null ? Math.max(0, Math.floor(pw.days_left)) : null;
  const low = days != null && days <= 5;
  const weeks = pw.weeks ?? [];
  const max = Math.max(1, ...weeks.map((w) => w.kwh));
  const tot = d.money?.totals ?? {};
  const cur = d.money?.currency ?? briefCur(d.search);
  const monthMoney = tot.power_per_month ?? (pw.month_kwh && pk?.tariff_kwh ? Math.round(pw.month_kwh * pk.tariff_kwh) : null);
  const voters = d2voters();
  const splitWord = d.money?.mode === 'shared' ? t('pw_split_shared') : voters.length === 2 ? t('pw_split_half') : t('pw_split_eq');
  const lastNote = [...(pw.readings ?? [])].reverse().find((r) => r.kind === 'reading' && r.note)?.note;
  const howTo = pk?.tokens ? pk.tokens[LANG] ?? pk.tokens.en : null;
  return html`<main class="screen w2">
    <${W3Head} kicker=${homeName()} title=${t('w3_power')} />
    ${pw.balance != null ? html`<div class=${'w3-big ' + (low ? 'mango' : 'acc')}>
        <p class="w3-big-k"><${Icon} n="zap" />${t('pw_left')}</p>
        <p class="w3-big-v">${days != null ? `${t('pw_days', { n: days })} · ` : ''}${fmtNum(Math.round(pw.balance))} ${LANG === 'ru' ? 'кВт·ч' : 'kWh'}</p>
        <p class="w3-big-s">${[pw.runout ? t('pw_topup_by', { d: LANG === 'ru' ? dfmt(new Date(Date.parse(pw.runout) - 864e5).toISOString(), { weekday: 'long' }).replace(/а$/, 'ы').replace(/^(понедельник|вторник|четверг)$/, '$1а').replace(/^воскресенье$/, 'воскресенья').replace(/^(среды|пятницы|субботы)$/, '$1') : dfmt(new Date(Date.parse(pw.runout) - 864e5).toISOString(), { weekday: 'long' }) }) : null,
          pw.daily != null ? t('pw_daily', { n: fmtNum(Math.round(pw.daily)) }) + (lastNote ? `, ${lastNote.replace(/^./, (c) => c.toLowerCase())}` : '') : null].filter(Boolean).join(' ')}</p></div>`
      : html`<div class="w3-big acc"><p class="w3-big-k"><${Icon} n="zap" />${t('pw_none_t')}</p><p class="w3-big-s">${pw.waiting_photo ? t('pw_photo_wait') : t('pw_none')}</p></div>`}
    ${weeks.length > 0 && html`<div class="card pw-chart"><p class="w3-ct">${t('pw_weeks')}</p>
      <div class="pw-bars">${weeks.map((w, i) => html`<div class="pw-col"><b>${w.kwh}</b><i class=${i === weeks.length - 1 ? 'on' : ''} style=${`height:${Math.max(8, Math.round((w.kwh / max) * 100))}%`}></i><span>${Number(w.from.slice(8))}–${Number(w.to.slice(8))}</span></div>`)}</div></div>`}
    <div class="card w2-list">
      ${monthMoney != null && html`<button class="w2-row w3-irow" onClick=${() => go(sp('money'))}><span class="sq big"><${Icon} n="wallet" /></span><div class="grow"><b>${t('pw_month', { x: money(monthMoney, cur) })}</b>
        <span>${[cap(splitWord), tot.power_per_month ? t('pw_in_money') : t('pw_month_tariff', { x: money(pk?.tariff_kwh, cur, true) })].join(' · ')}</span></div></button>`}
      ${pw.last_photo_at && html`<div class="w2-row w3-irow"><span class="sq big"><${Icon} n="camera" /></span><div class="grow"><b>${t('pw_photo_at', { d: fmtDM(pw.last_photo_at) })}</b><span>${pw.waiting_photo ? t('pw_photo_wait') : t('pw_photo_read')}</span></div></div>`}
      ${howTo && html`<div class="w2-row w3-irow"><span class="sq big"><${Icon} n="store" /></span><div class="grow"><b>${pk.prepaid ? t('pw_where') : t('pw_where_post')}</b><span>${howTo}</span></div></div>`}
    </div>
    ${canAct && html`<button class="btn accent block big" disabled=${busy} onClick=${shoot}><${Icon} n="camera" />${t('pw_shoot')}</button>`}
    <${Nav} tab="today" />
  </main>`;
}
