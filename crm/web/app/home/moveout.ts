// Split from app.js (wave 11): see the section comment below.
import { api, refresh } from '../core/api.js';
import { D, canVoteRole, districtShort, memberById, photoUrl, votersN } from '../core/data.js';
import { channelName, dayKey, dfmt, fmtDM, money } from '../core/format.js';
import { LANG, STR, human, t } from '../core/i18n.js';
import { go, openLink, sp } from '../core/routing.js';
import { closeSheet, emit, hap, openSheet, toast } from '../core/store.js';
import { channelLink } from '../screens/chats.js';
import { Av, Icon } from '../ui/icons.js';
import { Nav } from '../ui/pieces.js';
import { W3Head, dealListing, homeName, isGuest, msgCard, postInstruction, regionPack } from './helpers.js';
import { html } from 'htm/preact';
import { useState } from 'preact/hooks';

// ---------------------------------------------------------------- move-out (22)
export const MO_STEPS = ['notice', 'keys', 'video', 'cleaning', 'deposit'];
export const MO_ICON = { done: 'circle-check', wait: 'circle-help', todo: 'circle-dashed', info: 'info' };
export function moTitle(k, st) {
  if (k === 'notice') return st?.status === 'done' ? t('mo_notice') : t('mo_notice_todo');
  return t('mo_' + k);
}
export function moSub(k, st) {
  if (st?.note) return st.note;
  if (k === 'notice' && st?.status === 'done' && st.date) return t('mo_in', { d: fmtDM(st.date), ch: st.channel ? channelName(st.channel) : '' }).replace(/ (в|on) $/, '');
  if (k === 'deposit' && st?.date) return [t('mo_deposit_sub', { d: fmtDM(st.date) }), st.amount != null ? money(st.amount, st.currency) : null].filter(Boolean).join(' · ');
  return t('mo_' + k + '_sub');
}
export function Moveout() {
  const d = D();
  const mo = d.moveout;
  const l = dealListing();
  const [busy, setBusy] = useState(false);
  if (!mo) return html`<main class="screen w2"><${W3Head} title=${t('w3_moveout')} /><div class="card" style="padding:16px"><p class="muted" style="margin:0">${t('mo_date_none')}</p></div><${Nav} tab="today" /></main>`;
  const villa = (l?.property_type ?? '') === 'villa';
  const pb = mo.pushback;
  const canAct = canVoteRole(d.me.role);
  const wd = mo.date ? (LANG === 'ru' ? dfmt(mo.date, { weekday: 'long' }).replace(/^(\S+)$/, (w) => (/^(среда|пятница|суббота)$/.test(w) ? w.slice(0, -1) + 'у' : w)) : dfmt(mo.date, { weekday: 'long' })) : null;
  const head = mo.date ? t('mo_date', { d: `${LANG === 'ru' ? (/^вт/.test(wd) ? 'во ' : 'в ') : 'on '}${wd}, ${fmtDM(mo.date)}` }) : t('mo_date_none');
  async function draft() {
    setBusy(true);
    try { await postInstruction(t('mo_draft_text', { who: pb?.who ?? '' }), 'moveout_reply', 'moveout'); hap.ok(); toast(t('mo_draft_sent')); }
    catch { toast(t('err_generic')); }
    setBusy(false);
  }
  const showRelet = !!d.relet || (d.deal?.data?.terms?.to && mo.date && d.deal.data.terms.to > mo.date);
  return html`<main class="screen w2">
    <${W3Head} kicker=${[homeName(), homeName().includes(districtShort(l)) ? null : districtShort(l)].filter(Boolean).join(' · ')} title=${villa ? t('mo_title_villa') : t('mo_title')} />
    <div class="card w2-list">
      <div class="w2-lh"><span>${head}</span></div>
      ${MO_STEPS.map((k) => {
        const st = mo.steps?.[k] ?? { status: 'todo' };
        return html`<button key=${k} class="w2-row sig mo-row" disabled=${!canAct} onClick=${() => openSheet('mo_step', k)}>
          <${Icon} n=${MO_ICON[st.status] ?? 'circle-dashed'} cls=${'mo-' + st.status} /><div class="grow"><b>${moTitle(k, st)}</b><span>${moSub(k, st)}</span></div></button>`;
      })}
    </div>
    ${pb && html`<div class="w3-warn"><div class="w3-warn-h"><${Icon} n="message-circle-warning" /><b>${pb.who ? `${pb.who}: «${pb.quote ?? ''}»` : `«${pb.quote ?? ''}»`}</b></div>${pb.points && html`<p>${pb.points}</p>`}</div>`}
    ${canAct && pb && html`<button class="btn accent block big" disabled=${busy} onClick=${draft}><${Icon} n="sparkles" />${pb.to ? t('mo_draft_to', { to: pb.to }) : t('mo_draft')}</button>`}
    ${showRelet && html`<button class="btn surface block big w3-second" onClick=${() => go(sp('relet'))}><${Icon} n="megaphone" />${t('mo_relet')}</button>`}
    <${Nav} tab="today" />
  </main>`;
}
export function MoStepSheet({ k }) {
  const d = D();
  const st = d.moveout?.steps?.[k] ?? { status: 'todo' };
  const done = st.status === 'done';
  async function mark(status) {
    try { const r = await api('/app/api/moveout-step', { search_id: d.search.id, key: k, status }); d.moveout = r.moveout; hap.ok(); toast(t('mo_saved')); closeSheet(); emit(); }
    catch { toast(t('err_generic')); }
  }
  return html`<h2>${moTitle(k, st)}</h2><p class="muted" style="margin:0 0 14px">${moSub(k, st)}</p>
    ${k === 'video' && !done && html`<p style="margin:0 0 12px">${t('mo_video_bot')}</p>${d.bot_username && html`<button class="btn surface block" style="margin-bottom:10px" onClick=${() => openLink(`https://t.me/${d.bot_username}`)}><${Icon} n="send" cls="sm" />${t('open_bot')}</button>`}`}
    <button class="btn accent block" onClick=${() => mark(done ? 'todo' : 'done')}><${Icon} n=${done ? 'undo' : 'circle-check'} cls="sm" />${done ? t('mo_mark_todo') : t('mo_mark_done')}</button>
    <button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
}

// ---------------------------------------------------------------- re-let (29)
export const LS_CLS = { viewing: 'ok', agreed: 'ok', reply: 'wait', new: 'acc', not_suitable: '' };
export function chLabel(c) {
  if (c.label) return c.label;
  const k = c.kind;
  if (STR[LANG]['ch_' + k]) return typeof STR[LANG]['ch_' + k] === 'function' ? t('ch_' + k, { n: c.count ?? 1 }) : t('ch_' + k);
  return human(k);
}
export function monthsBetween(a, b) {
  return Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / (30.44 * 864e5)));
}
export function Relet() {
  const d = D();
  const r = d.relet;
  const l = dealListing();
  const [busy, setBusy] = useState(false);
  // Pack rule (housing_ads): relet 'plain_with_consent' = post only after the owner agrees and only as a normal rental;
  // 'friends_only' = privately to people the members know. Roommate ads are never posted (agent rule).
  const ha = regionPack()?.housing_ads;
  const rmode = ha?.relet ?? (ha?.mode === 'friends_only' ? 'friends_only' : null);
  const noteKey = rmode === 'friends_only' ? 'rl_friends' : rmode === 'plain_with_consent' ? (r?.consent === 'yes' ? 'rl_plain_ok' : 'rl_plain_wait') : null;
  const note = noteKey && html`<p class="rl-note"><${Icon} n="shield-alert" cls="sm" /><span>${t(noteKey)}</span></p>`;
  const askKey = rmode === 'friends_only' ? 'friends' : rmode === 'plain_with_consent' ? 'plain' : '';
  async function ask() {
    setBusy(true);
    try { await postInstruction(t(askKey ? 'rl_ask_text_' + askKey : 'rl_ask_text'), 'relet', 'relet'); hap.ok(); toast(t(askKey ? 'rl_asked_' + askKey : 'rl_asked')); } catch { toast(t('err_generic')); }
    setBusy(false);
  }
  const kicker = `${homeName()} · ${t('rl_kicker')}`;
  if (!r) return html`<main class="screen w2"><${W3Head} kicker=${kicker} title=${t('rl_title')} />
    ${note}<div class="card" style="padding:18px"><p style="margin:0 0 14px">${t('rl_none')}</p>${canVoteRole(d.me.role) && html`<button class="btn accent block" disabled=${busy} onClick=${ask}><${Icon} n="sparkles" />${t('rl_ask')}</button>`}</div><${Nav} tab="today" /></main>`;
  const photos = (r.photos?.length ? r.photos : l?.photos ?? []).map(photoUrl).filter(Boolean).slice(0, 3);
  const head = [r.date_from && r.date_to ? t('rl_months', { n: monthsBetween(r.date_from, r.date_to) }) : null, r.date_from && r.date_to ? `${fmtDM(r.date_from)} – ${fmtDM(r.date_to)}` : null, r.price ? `${money(r.price, r.currency)}${t('per_month')}` : null].filter(Boolean).join(' · ');
  const leads = r.leads ?? [];
  return html`<main class="screen w2">
    <${W3Head} kicker=${kicker} title=${t('rl_title')} />
    <div class="m-hero rl-hero"><p class="rl-h">${head || '—'}</p>
      <p class="rl-c"><${Icon} n=${r.consent === 'yes' ? 'circle-check' : r.consent === 'no' ? 'circle-x' : 'circle-help'} cls=${'c-' + r.consent} />${r.consent_note || t('rl_c_' + r.consent)}</p></div>
    ${note}
    <div class="card rl-ad"><p class="w3-ct">${t('rl_ad')}</p>
      ${photos.length > 0 && html`<div class="rl-ph">${photos.map((p) => html`<img src=${p} alt="" loading="lazy" decoding="async" />`)}</div>`}
      ${r.ad_text && html`<p class="rl-txt">${r.ad_text}</p>`}
      ${(r.channels ?? []).length > 0 && html`<div class="chips">${r.channels.map((c) => html`<span class="ds-tag">${chLabel(c)}</span>`)}</div>`}
    </div>
    <div class="card w2-list">
      <div class="w2-lh"><span>${t('rl_leads', { n: leads.length })}</span></div>
      ${leads.length ? leads.map((x) => {
        const link = x.channel && x.address ? channelLink(x.channel, x.address) : null;
        const Tag = link ? 'button' : 'div';
        return html`<${Tag} key=${x.id} class="w2-row rl-row" onClick=${link ? () => openLink(link) : null}><div class="grow"><b>${x.name}</b>${x.note && html`<span>${x.note}</span>`}</div><span class=${'st2 ' + (LS_CLS[x.status] ?? '')}>${t('ls_' + x.status)}</span></${Tag}>`;
      }) : html`<div class="w2-row"><span class="muted">${t('rl_no_leads')}</span></div>`}
    </div>
    <${Nav} tab="today" />
  </main>`;
}

// ---------------------------------------------------------------- wave 5: what next (41)
export const NX = [['stay', 'house'], ['new', 'search'], ['leave', 'plane']];
export const nxWeeks = (r) => (r.weeks_left > 0 ? t('nx_weeks', { n: r.weeks_left }) : t('nx_soon'));
export const ownerContactName = () => (D()?.house_contacts ?? []).find((c) => c.role === 'owner')?.name ?? null;
export function NextCard() {
  const r = D()?.renewal;
  if (!r || r.status !== 'open' || isGuest()) return null;
  return html`<button class="w2-banner nx-card" onClick=${() => go(sp('next'))}><${Icon} n="calendar-clock" /><div class="grow"><b>${t('nx_card')}</b><span>${nxWeeks(r)}</span></div><${Icon} n="chev" cls="sm muted" /></button>`;
}
export async function nextVote(choice) {
  const d = D();
  const r = d.renewal;
  if (!r || r.status !== 'open' || !canVoteRole(d.me.role)) return;
  hap.sel();
  const prev = r.votes ?? [];
  r.votes = [...prev.filter((v) => v.user_id !== d.user.id), { user_id: d.user.id, name: d.user.display_name, choice, at: new Date().toISOString() }];
  emit();
  try {
    const x = await api('/app/api/next-vote', { search_id: d.search.id, choice });
    if (x.renewal) d.renewal = x.renewal;
    hap.ok(); emit();
    if (x.renewal?.status === 'decided') refresh();
  } catch { r.votes = prev; emit(); toast(t('err_generic')); }
}
export function NextScreen() {
  const d = D();
  const r = d.renewal;
  const o = ownerContactName() ?? t('nx_owner');
  const leaseTo = r?.lease_to ?? d.deal?.data?.terms?.to;
  const kicker = [homeName(), leaseTo ? t('nx_lease_to', { d: fmtDM(leaseTo) }) : null].filter(Boolean).join(' · ');
  if (!r) return html`<main class="screen w2"><${W3Head} kicker=${kicker} title=${t('nx_title')} />${msgCard(t('nx_none'))}<${Nav} tab="today" /></main>`;
  const today = dayKey(new Date().toISOString());
  const votes = r.votes ?? [];
  const decided = r.status === 'decided';
  const sel = decided ? r.choice : votes.find((v) => v.user_id === d.user.id)?.choice ?? null;
  const canVote = canVoteRole(d.me.role) && !decided;
  const avs = (c) => {
    const vs = votes.filter((v) => v.choice === c);
    return vs.length ? html`<span class="avs nx-avs">${vs.map((v) => html`<${Av} key=${v.user_id} m=${memberById(v.user_id) ?? { name: v.name }} size=${26} ring />`)}</span>` : null;
  };
  const sub = (c) => (c === 'stay' ? t('nx_stay_sub', { o }) : t('nx_' + c + '_sub'));
  let head;
  if (decided) {
    const what = r.choice === 'stay' ? t('nx_do_stay', { o }) : r.choice === 'new' ? t(r.new_search_id ? 'nx_do_new' : 'nx_do_new_wait') : t('nx_do_leave');
    head = html`<div class="m-hero w5-hero"><p class="m-k">${t('nx_decided')}</p><p class="w5-big">${t('nx_' + r.choice)}</p>
      <p class="w5-sub">${what}${r.decided_how === 'owner' ? ' ' + t('nx_by_owner') : ''}</p>
      ${r.choice === 'new' && r.new_search_id && html`<button class="btn block m-settle" onClick=${() => go(`/s/${r.new_search_id}/today`)}><${Icon} n="search" cls="sm" />${t('nx_open_new')}</button>`}
      ${r.choice === 'leave' && html`<button class="btn block m-settle" onClick=${() => go(sp('moveout'))}><${Icon} n="door-open" cls="sm" />${t('nx_to_moveout')}</button>`}</div>`;
  } else {
    head = html`<div class="w3-warn nx-note"><div class="w3-warn-h"><${Icon} n="calendar-clock" /><b>${nxWeeks(r)}</b></div>
      <p>${[r.note, r.deadline && r.deadline >= today ? t('nx_by', { d: fmtDM(r.deadline) }) : t('nx_late')].filter(Boolean).join(' ')}</p></div>`;
  }
  return html`<main class="screen w2">
    <${W3Head} kicker=${kicker} title=${t('nx_title')} />
    ${head}
    ${NX.map(([c, ic]) => html`<button key=${c} class=${'card nx-opt' + (sel === c ? ' on' : '')} aria-pressed=${sel === c ? 'true' : 'false'} disabled=${!canVote} onClick=${() => nextVote(c)}>
      <${Icon} n=${ic} cls="nx-ic" /><div class="grow"><b>${t('nx_' + c)}</b><span>${sub(c)}</span>${avs(c)}</div>${canVote && html`<${Icon} n="chev" cls="sm nx-chev" />`}</button>`)}
    <p class="w2-foot">${t('nx_foot')} ${t('nx_voted', { n: votes.length, m: r.voters ?? votersN() })}</p>
    <${Nav} tab="today" />
  </main>`;
}
