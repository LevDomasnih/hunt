// Split from app.js (wave 11): see the section comment below.
import { api, refresh } from '../core/api.js';
import { D, photoUrl, sceneStyle } from '../core/data.js';
import { dayKey, firstName, fmtDM, money, shortTitle, tzNow, whenLabel } from '../core/format.js';
import { LANG, STR, cap, t } from '../core/i18n.js';
import { go, sp } from '../core/routing.js';
import { S, closeSheet, emit, hap, openSheet, toast } from '../core/store.js';
import { W3Head } from '../home/helpers.js';
import { Av, ICONS, Icon } from '../ui/icons.js';
import { BackRound, Nav, Skeletons, StageBar, Sticker } from '../ui/pieces.js';
import { html, useState } from 'https://unpkg.com/htm@3.1.1/preact/standalone.module.js';

// ---------------------------------------------------------------- wave 6 · A: project pipeline (00c cards, 45 path, Today strip)
Object.assign(ICONS, {
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  'calendar-plus': '<path d="M8 2v4"/><path d="M16 2v4"/><path d="M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8"/><path d="M3 10h18"/><path d="M16 19h6"/><path d="M19 16v6"/>',
});
export const PP_ICON = { start: 'flag', search: 'search', viewings: 'eye', choice: 'heart', deal: 'file-text', movein: 'key-round', living: 'home', extension: 'calendar-plus',
  next: 'calendar-clock', relet: 'refresh-cw', moveout: 'log-out', closed: 'archive' };
export const ppToday = (tz) => dayKey(new Date().toISOString(), tz || tzNow());
export const ppDays = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 864e5);
/** "завтра" / "сегодня" / "через 3 дня" for a future day (null for a past one). */
export function ppWhen(day, tz) {
  if (!day) return null;
  const n = ppDays(ppToday(tz), day);
  return n < 0 ? null : n === 0 ? t('pp_today') : n === 1 ? t('pp_tomorrow') : t('pp_in_days', { n });
}
export const ppRange = (a, b) => (!a ? '' : !b || a === b ? fmtDM(a) : a.slice(5, 7) === b.slice(5, 7) ? `${a.slice(8, 10)}–${fmtDM(b)}` : `${fmtDM(a)}–${fmtDM(b)}`);
export const ppFirst = (who) => String(who ?? '').split(/[\s,(]/)[0];
/** The one status line of a project card (00c): "Заезд через 3 дня", "Поиск · 14 вариантов", "Закрыт · досье". */
export function ppLine(s) {
  const st = s.stage ?? { key: 'start' };
  const tz = s.brief?.timezone;
  if (s.role === 'guest') return s.guest?.to ? t('pp_l_guest', { d: fmtDM(s.guest.to) }) : t('gi_role');
  const nw = s.counts?.new ? ` · ${t('n_new', { n: s.counts.new })}` : '';
  switch (st.key) {
    case 'start': return t('pp_l_start');
    case 'search': return (st.listings ?? s.counts?.listings ? t('pp_l_search', { x: t('pp_f_listings', { n: st.listings ?? s.counts.listings }) }) : t('pp_l_search0')) + nw;
    case 'viewings': {
      const next = (s.upcoming ?? []).find((x) => Date.parse(x) > Date.now() - 30 * 60e3);
      return next ? t('pp_l_viewings_at', { w: whenLabel(next, tz) }) : t('pp_l_viewings') + nw;
    }
    case 'choice': return t('pp_l_choice');
    case 'deal': return st.date ? t('pp_l_deal_d', { d: fmtDM(st.date) }) : t('pp_l_deal');
    case 'movein': return st.date ? cap(t('pp_l_movein', { w: ppWhen(st.date, tz) ?? fmtDM(st.date) })) : t('pp_k_movein');
    case 'living': case 'extension': return st.date ? t('pp_l_living', { d: fmtDM(st.date) }) : t('pp_l_living0');
    case 'next': return t('pp_l_next');
    case 'moveout': return st.date ? cap(t('pp_l_moveout', { w: ppWhen(st.date, tz) ?? fmtDM(st.date) })) : t('pp_k_moveout');
    case 'closed': return t('pp_l_closed');
    default: return '';
  }
}
export function SearchCard({ s }) {
  const st = s.stage ?? { key: 'start', idx: 1, n: 9 };
  const photo = s.role === 'guest' ? null : photoUrl(st.home?.photo ?? st.photo ?? null);
  const own = s.role !== 'owner' && s.role !== 'guest' ? t('invited_by', { name: firstName(s.owner_name) }) : null;
  // V4-13: a block of the region colour (closed projects stay warm grey), name, one status line, stage dashes, a framed photo
  return html`<button class=${'pp-card pk8-card' + (st.closed ? ' closed' : '')} data-region=${s.country} onClick=${() => { hap.sel(); go(`/s/${s.id}/today`); }}>
    <span class="pk8-t"><b>${s.title}</b><span>${ppLine(s)}</span>${own && html`<span class="pp-own">${own}</span>`}
      ${s.role !== 'guest' && html`<${StageBar} idx=${st.idx ?? 1} n=${st.n ?? 9} closed=${!!st.closed} cls="pp-bar" />`}</span>
    <span class="frame sm pk8-ph"><span class="in">${photo ? html`<img src=${photo} alt="" loading="lazy" decoding="async" />` : html`<span class="float-none" style=${sceneStyle(s.country)}></span>`}</span></span>
    ${(s.members ?? []).length > 1 && html`<span class="avs pk8-avs">${(s.members ?? []).slice(0, 3).map((m) => html`<${Av} key=${m.user_id} m=${m} size=${30} ring />`)}</span>`}
  </button>`;
}
/** Read-only banner of a closed project (45, Today; D can reuse it in home mode). */
export function ClosedBanner() {
  const p = D()?.path;
  if (!p?.closed) return null;
  return html`<div class="banner pp-closed" role="status"><${Icon} n="archive" /><div><b>${t('pp_closed_t')}</b><span>${t('pp_closed_s')}${p.can_edit ? `. ${t('pp_closed_owner')}` : ''}</span></div></div>`;
}
/** "заезд через 3 дня" after "Этап 6 из 9" (45 header, Today strip). */
export function ppHint(p) {
  const r = (k) => p.rows?.find((x) => x.key === k)?.facts ?? {};
  const tz = tzNow();
  switch (p.key) {
    case 'search': { const f = r('search'); return f.listings ? t('pp_f_listings', { n: f.listings }) : t('pp_h_search'); }
    case 'movein': { const f = r('movein'); const w = ppWhen(f.date, tz); return f.date ? (w ? t('pp_h_movein', { w }) : t('pp_h_movein_past', { d: fmtDM(f.date) })) : t('pp_k_movein').toLowerCase(); }
    case 'living': { const f = r('living'); return f.day && f.days ? t('pp_f_day', { d: f.day, n: f.days }).toLowerCase() : t('pp_k_living').toLowerCase(); }
    case 'moveout': { const f = r('moveout'); const w = ppWhen(f.date, tz); return f.date ? (w ? t('pp_h_moveout', { w }) : t('pp_h_moveout_past', { d: fmtDM(f.date) })) : t('pp_k_moveout').toLowerCase(); }
    default: return STR[LANG]['pp_h_' + p.key] ? t('pp_h_' + p.key) : '';
  }
}
/** The one-line status of a path row, from its facts (numbers only come from the server). */
export function ppRowLine(row) {
  const f = row.facts ?? {};
  const todo = row.status === 'todo';
  const cur = D()?.search?.brief?.currency ?? f.currency;
  switch (row.key) {
    case 'search':
      if (f.contacted) return [t('pp_f_contacted', { n: f.contacted }), t('pp_f_replied', { n: f.replied ?? 0 })].join(' · ');
      return f.listings ? t('pp_f_listings', { n: f.listings }) : t('pp_d_search');
    case 'viewings':
      if (!f.count) return t('pp_d_viewings');
      return `${S.regions?.[D()?.search?.country]?.homes === 'villas' ? t('pp_f_villas', { n: f.count }) : t('pp_f_views', { n: f.count })}${f.days ? ' ' + t('pp_f_days', { n: f.days }) : ''}`;
    case 'choice':
      if (f.title) return `${shortTitle(f.title)} — ${t('pp_how_' + (f.how ?? 'deal'))}`;
      return f.takes ? t('pp_f_takes', { n: f.takes }) : t('pp_d_choice');
    case 'deal': {
      if (todo && !f.signed && !f.paid) return t('pp_d_deal');
      const parts = [f.signed ? t(f.stamp ? 'pp_f_signed_stamp' : 'pp_f_signed') : t('pp_f_unsigned')];
      if (f.paid) parts.push(t('pp_f_paid', { x: money(f.paid, f.currency ?? cur) }));
      if (f.pending) parts.push(t('pp_f_pending', { x: money(f.pending, f.currency ?? cur) }));
      return parts.join(', ');
    }
    case 'movein': return f.landlord ? t('pp_f_movein', { who: ppFirst(f.landlord) }) : t('pp_f_movein_home');
    case 'living': return row.status === 'current' && f.day && f.days ? t('pp_f_day', { d: f.day, n: f.days }) : t('pp_d_living');
    case 'extension': {
      if (f.status === 'pending' || !f.seq) return t('pp_f_ext_wait');
      return [f.landlord, f.deposit_prev ? t('pp_dep_' + f.deposit_prev) : null].filter(Boolean).join(' · ') || t('pp_d_extension');
    }
    case 'next':
      if (f.status === 'open') return t('pp_f_votes', { v: f.votes ?? 0, n: f.voters ?? 0 });
      if (f.status === 'decided' && f.choice) return t('pp_f_next_' + f.choice);
      return t('pp_d_next');
    case 'relet': return STR[LANG]['pp_relet_' + f.status] ? t('pp_relet_' + f.status) : t('pp_d_relet');
    case 'moveout':
      if (f.total) return [t('pp_f_steps', { d: f.done ?? 0, n: f.total }), f.deposit_status === 'done' ? t('pp_f_dep_done') : f.deposit_status === 'wait' ? t('pp_f_dep_wait') : null].filter(Boolean).join(' · ');
      return f.landlord ? t('pp_f_moveout', { who: ppFirst(f.landlord) }) : t('pp_d_moveout');
    default: return STR[LANG]['pp_d_' + row.key] ? t('pp_d_' + row.key) : '';
  }
}
export function ppRowDate(row) {
  if (row.key === 'search') return ppRange(row.date, row.date_to);
  if (row.key === 'living' || row.key === 'next') return row.key === 'living' ? (row.date_to ? t('pp_until', { d: fmtDM(row.date_to) }) : '') : row.date ? t('pp_until', { d: fmtDM(row.date) }) : '';
  if (row.key === 'extension' || row.key === 'relet') return row.date ? fmtDM(row.date) : '';
  return row.date ? fmtDM(row.date) : '';
}
export function ppGo(row) {
  if (!row.go) return;
  const [scr, ...rest] = row.go.split('/');
  hap.sel();
  go(sp(scr, rest.length ? decodeURIComponent(rest.join('/')) : undefined));
}
/** Screen 45: the project path. */
export function PathScreen() {
  const d = D();
  const p = d.path;
  if (!p) return html`<main class="screen w2"><${W3Head} kicker=${d.search.title} title=${t('pp_title')} /><${Skeletons} n=${1} /><${Nav} tab="today" /></main>`;
  const sub = [t('stage_n_of', { i: Math.min(p.idx, p.n), n: p.n }), ppHint(p), p.manual ? t('pp_h_manual') : null].filter(Boolean).join(' · ');
  // V4-9: a giant title, then the stages as a hairline list with circles; "ты здесь" sticker on the current one
  return html`<main class="screen w2 pp-screen pp8">
    <div class="row pp8-top"><${BackRound} /><span class="grow"></span>
      ${p.can_edit && html`<button class="round" aria-label=${t('pp_change')} onClick=${() => { hap.sel(); openSheet('pp_stage'); }}><${Icon} n="pencil" /></button>`}</div>
    <h1 class="w8-title">${t('pp_title')}</h1>
    <p class="w8-cap">${[shortTitle(d.search.title), sub].filter(Boolean).join(' · ')}</p>
    <${ClosedBanner} />
    <div class="pp-list pp8-list">${p.rows.map((r, i) => {
      const title = r.key === 'extension' && r.date_to ? t('pp_ext_title', { d: fmtDM(r.date_to) }) : t('pp_k_' + r.key);
      return html`<button key=${r.key + i} class=${'pp-row ' + r.status} aria-current=${r.status === 'current' ? 'step' : null} onClick=${() => ppGo(r)}>
        <span class="pp-ic">${r.status === 'done' && html`<${Icon} n="check" />`}</span>
        <span class="grow"><b>${title}</b>${(r.status === 'current' || r.status === 'done') && ppRowLine(r) && html`<span>${ppRowLine(r)}</span>`}</span>
        <span class="pp-d">${ppRowDate(r)}</span>
        ${r.status === 'current' && !p.closed && html`<${Sticker} text=${t('w8_here')} cls="sm" style="right:17%;top:50%;margin-top:-32px;--r:10deg" />`}
      </button>`;
    })}</div>
    <${Nav} tab="today" />
  </main>`;
}
/** Search mode Today: a compact stage bar at the top, opens the path. */
export function PathStrip() {
  const p = D()?.path;
  if (!p) return null;
  const hint = ppHint(p);
  return html`${p.closed && html`<${ClosedBanner} />`}<button class="card pp-strip" onClick=${() => { hap.sel(); go(sp('path')); }}>
    <span class="pp-strip-h"><span class="grow">${t('stage_n_of', { i: Math.min(p.idx, p.n), n: p.n })} · ${t('pp_k_' + p.key)}${hint ? html`<span class="muted"> · ${hint}</span>` : null}</span><${Icon} n="chev" cls="sm muted" /></span>
    <${StageBar} idx=${p.idx} n=${p.n} closed=${p.closed} />
  </button>`;
}
/** Owner sheet: set the stage by hand, back to automatic, close / reopen. */
export function StageSheet() {
  const d = D();
  const p = d.path;
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!p) return null;
  async function set(stage) {
    setBusy(true);
    try {
      const r = await api('/app/api/stage', { search_id: d.search.id, stage });
      d.path = r.path;
      if (r.path) document.documentElement.toggleAttribute('data-closed', !!r.path.closed);
      hap.ok();
      toast(t('pp_set_ok'));
      closeSheet();
      refresh();
    } catch { toast(t('err_generic')); setBusy(false); }
  }
  if (confirm) {
    return html`<h2>${t('pp_close_q')}</h2><p class="muted" style="margin:0 0 16px">${t('pp_close_text')}</p>
      <button class="btn danger block pp-ok" disabled=${busy} onClick=${() => set('closed')}><${Icon} n="archive" />${t('pp_close_yes')}</button>
      <button class="btn ghost block" style="margin-top:8px" onClick=${() => setConfirm(false)}>${t('cancel')}</button>`;
  }
  const keys = ['start', 'search', 'viewings', 'choice', 'deal', 'movein', 'living', 'extension', 'next', 'moveout'];
  return html`<h2>${t('pp_change')}</h2>
    ${p.closed ? html`<button class="btn accent block pp-ok" disabled=${busy} onClick=${() => set('auto')}><${Icon} n="refresh-cw" />${t('pp_reopen')}</button>` : html`
    <div class="card grp">
      <button class="opt" disabled=${busy} onClick=${() => set('auto')}><${Icon} n="sparkles" cls="sm" /><span class="grow"><span style="display:block">${t('pp_auto')}</span><span class="muted" style="font-size:13px">${t('pp_auto_sub', { k: t('pp_k_' + p.derived_key) })}</span></span>${!p.manual && html`<${Icon} n="check" cls="check" />`}</button>
      ${keys.map((k) => html`<button key=${k} class="opt" disabled=${busy} onClick=${() => set(k)}><${Icon} n=${PP_ICON[k]} cls="sm" /><span class="grow">${t('pp_k_' + k)}</span>${p.manual && p.key === k && html`<${Icon} n="check" cls="check" />`}</button>`)}
    </div>
    <button class="btn danger block" disabled=${busy} onClick=${() => setConfirm(true)}><${Icon} n="archive" />${t('pp_close')}</button>`}
    <button class="btn ghost block" style="margin-top:8px" onClick=${closeSheet}>${t('close')}</button>`;
}

export function Reveal() {
  const d = D();
  const s = d.search;
  const [busy, setBusy] = useState(false);
  const a = d.me.animal;
  const others = d.members.filter((m) => m.user_id !== d.user.id);
  const name = a ? a.name[LANG] ?? a.name.en : '';
  async function done() {
    setBusy(true);
    d.me.reveal_seen = true;
    emit();
    hap.ok();
    api('/app/api/seen-reveal', { search_id: s.id }).catch(() => null);
  }
  async function again() {
    hap.sel();
    setBusy(true);
    try {
      const r = await api('/app/api/reroll-animal', { search_id: s.id });
      d.me.animal = r.animal;
      const m = d.members.find((x) => x.user_id === d.user.id);
      if (m) m.animal = r.animal;
    } catch { toast(t('err_generic')); }
    setBusy(false);
  }
  return html`<main class="screen no-nav"><div class="reveal">
    <div class="scene" style=${sceneStyle(s.country)}></div>
    <div class="hero-av"><${Av} m=${{ animal: a, name: d.user.display_name }} size=${150} free /></div>
    <p class="kicker" style="margin-top:16px">${s.role === 'owner' ? t('reveal_mine', { title: s.title }) : t('reveal_kicker', { title: s.title, owner: firstName(s.owner_name) })}</p>
    <h1>${t('reveal_h1')}<br />${t('reveal_h2', { name })}</h1>
    <p>${t('reveal_p')}</p>
    ${others.length > 0 && html`<div class="others">${others.map((m) => html`<div key=${m.user_id}><${Av} m=${m} size=${48} free /><span>${firstName(m.name)} · ${m.animal ? m.animal.name[LANG] ?? m.animal.name.en : ''}</span></div>`)}</div>`}
    <div class="actions">
      <button class="btn accent block big" disabled=${busy && !d.me.reveal_seen ? false : null} onClick=${done}>${t('reveal_go')}</button>
      <button class="btn link block" style="margin-top:8px" disabled=${busy} onClick=${again}>${t('reveal_again')}</button>
    </div>
  </div></main>`;
}
