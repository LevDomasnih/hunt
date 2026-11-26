// Split from app.js (wave 11): see the section comment below.
import { api } from '../core/api.js';
import { D, canVoteRole, memberById } from '../core/data.js';
import { fmtNum, money } from '../core/format.js';
import { t } from '../core/i18n.js';
import { closeSheet, emit, hap, openSheet, toast } from '../core/store.js';
import { Av, Icon } from '../ui/icons.js';
import { Nav } from '../ui/pieces.js';
import { Toggle } from './docs.js';
import { W3Head, dealListing, homeName, meOrName } from './helpers.js';
import { d2voters } from './money.js';
import { html } from 'htm/preact';
import { useState } from 'preact/hooks';

// ---------------------------------------------------------------- rent split by rooms (24)
export function rentOf() {
  const tm = D()?.deal?.data?.terms ?? {};
  const rent = Number(tm.rent) || Number(dealListing()?.price) || null;
  return { rent, cur: tm.currency ?? dealListing()?.currency ?? D()?.money?.currency ?? null };
}
export function rebalance(rooms, id) {
  const fixed = rooms.find((r) => r.id === id);
  const others = rooms.filter((r) => r.id !== id && r.share > 0);
  const rest = Math.max(0, 100 - (fixed?.share ?? 0));
  const sum = others.reduce((a, r) => a + r.share, 0);
  if (!others.length) { if (fixed) fixed.share = 100; return rooms; }
  let left = rest;
  others.forEach((r, i) => { r.share = i === others.length - 1 ? Math.round(left * 10) / 10 : Math.round(((sum ? r.share / sum : 1 / others.length) * rest) * 10) / 10; left -= r.share; });
  return rooms;
}
export async function saveRooms(rooms, othersEqual) {
  const d = D();
  const r = await api('/app/api/rooms', { search_id: d.search.id, rooms: rooms ? { rooms, others_equal: othersEqual } : null });
  d.search.rooms = r.rooms;
  d.money = r.money;
  emit();
}
export function Split() {
  const d = D();
  const rr = d.search.rooms;
  const rooms = rr?.rooms ?? [];
  const { rent, cur } = rentOf();
  const voters = d2voters();
  const canEdit = canVoteRole(d.me.role);
  const w = d.money?.rent_weights ?? null;
  const wsum = w ? Object.values(w).reduce((a: any, b) => a + b, 0) || 1 : 1;
  async function start() {
    const n = Math.max(voters.length, Number(dealListing()?.bedrooms) || voters.length);
    const list = Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}`, name: t('sp_bedroom', { n: i + 1 }), user_id: voters[i] ?? null, share: 0 }));
    const assigned = list.filter((x) => x.user_id);
    assigned.forEach((x, i) => { x.share = i === assigned.length - 1 ? Math.round((100 - (Math.round((100 / assigned.length) * 10) / 10) * (assigned.length - 1)) * 10) / 10 : Math.round((100 / assigned.length) * 10) / 10; });
    try { await saveRooms(list, true); hap.ok(); } catch { toast(t('err_generic')); }
  }
  async function toggle(v) {
    hap.sel();
    try { await saveRooms(rooms, v); } catch { toast(t('err_generic')); }
  }
  return html`<main class="screen w2">
    <${W3Head} kicker=${[homeName(), rent ? `${money(rent, cur)}${t('per_month')}` : t('sp_no_rent')].join(' · ')} title=${t('sp_split_title')} />
    ${rooms.length ? html`<div class="card w2-list">
      <div class="w2-lh"><span>${t('sp_rooms')}</span>${canEdit && html`<button class="w2-add" onClick=${() => openSheet('room', 'new')}><${Icon} n="plus" cls="sm" />${t('add')}</button>`}</div>
      ${rooms.map((r) => html`<button key=${r.id} class="w2-row sp-row" disabled=${!canEdit} onClick=${() => openSheet('room', r.id)}>
        ${r.user_id ? html`<${Av} m=${memberById(r.user_id)} size=${36} />` : html`<span class="w3-shared"><${Icon} n="users" cls="sm" /></span>`}
        <div class="grow"><div class="sp-hd"><div class="grow"><b>${r.name}</b><span>${r.user_id ? meOrName(r.user_id) : t('sp_shared')}</span></div><b class="sp-pc">${r.share > 0 ? `${fmtNum(r.share)}%` : '—'}</b></div>
          ${r.share > 0 && r.user_id && html`<div class="sp-bar"><i style=${`width:${Math.min(100, r.share)}%`}></i></div>`}</div></button>`)}
    </div>
    <div class="m-hero sp-hero"><p class="m-k">${t('sp_rent')}</p>
      ${voters.map((u) => html`<div class="m-row sp-mr"><${Av} m=${memberById(u)} size=${36} ring /><span class="grow">${meOrName(u)}</span><b>${rent && w ? money(Math.round((rent * (w[u] ?? 0)) / +(wsum)), cur) : '—'}</b></div>`)}
    </div>
    <div class="card grp sp-tgl"><${Toggle} on=${rr.others_equal !== false} label=${voters.length === 2 ? t('sp_others_two') : t('sp_others_n')} onChange=${(v) => canEdit && toggle(v)} /></div>
    ${rr.others_equal === false && html`<button class="btn link" onClick=${() => openSheet('shares')}>${t('sp_shares_link')}</button>`}`
    : html`<div class="card" style="padding:18px"><p style="margin:0 0 14px">${t('sp_empty')}</p>${canEdit && html`<button class="btn accent block" onClick=${start}>${t('sp_start')}</button>`}</div>`}
    <${Nav} tab="today" />
  </main>`;
}
export function RoomSheet({ id }) {
  const d = D();
  const rr = d.search.rooms ?? { rooms: [], others_equal: true };
  const cur = rr.rooms.find((r) => r.id === id);
  const [name, setName] = useState(cur?.name ?? '');
  const [who, setWho] = useState(cur ? cur.user_id : null);
  const [share, setShare] = useState(cur?.share ?? 0);
  const [busy, setBusy] = useState(false);
  const voters = d2voters();
  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    const rooms = rr.rooms.map((r) => ({ ...r }));
    const rid = cur?.id ?? `r${Date.now().toString(36)}`;
    const row = { id: rid, name: name.trim(), user_id: who, share: Math.max(0, Math.min(100, share)) };
    if (cur) rooms[rooms.findIndex((r) => r.id === id)] = row; else rooms.push(row);
    try { await saveRooms(rebalance(rooms, rid), rr.others_equal !== false); hap.ok(); toast(t('sp_split_saved')); closeSheet(); }
    catch (e) { toast(e.message && e.code === 'bad_rooms' ? e.message : t('err_generic')); }
    setBusy(false);
  }
  async function del() {
    const rooms = rr.rooms.filter((r) => r.id !== id).map((r) => ({ ...r }));
    try { await saveRooms(rooms.length ? rebalance(rooms, rooms.find((r) => r.share > 0)?.id ?? rooms[0].id) : null, rr.others_equal !== false); hap.ok(); closeSheet(); }
    catch { toast(t('err_generic')); }
  }
  const chip = (on, label, f) => html`<button class=${'bchip' + (on ? ' on' : ' off')} aria-pressed=${on ? 'true' : 'false'} onClick=${() => { hap.sel(); f(); }}>${label}</button>`;
  return html`<h2>${cur ? cur.name : t('sp_room')}</h2>
    <div class="x-form">
      <p class="e-lbl">${t('sp_room')}</p><input class="e-input" value=${name} placeholder=${t('sp_room_ph')} onInput=${(e) => setName(e.currentTarget.value)} />
      <p class="e-lbl">${t('sp_who')}</p><div class="chips">${voters.map((u) => chip(who === u, meOrName(u), () => setWho(u)))}${chip(who == null, t('sp_shared'), () => setWho(null))}</div>
      <p class="e-lbl">${t('sp_share')}</p>
      <div class="row"><button class="round sm soft" aria-label="−" onClick=${() => setShare(Math.max(0, share - 5))}><${Icon} n="minus" cls="sm" /></button>
        <b class="sh-n grow" style="font-size:22px">${share > 0 ? `${fmtNum(share)}%` : '—'}</b>
        <button class="round sm soft" aria-label="+" onClick=${() => setShare(Math.min(100, share + 5))}><${Icon} n="plus" cls="sm" /></button></div>
    </div>
    <button class="btn accent block" style="margin-top:14px" disabled=${busy || !name.trim()} onClick=${save}>${t('x_save')}</button>
    ${cur && html`<button class="btn ghost block" onClick=${del}><${Icon} n="trash-2" cls="sm" />${t('sp_delete')}</button>`}
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}
export function MoneyModeSheet() {
  const d = D();
  const mode = d.money?.mode ?? 'split';
  async function set(m) {
    if (m === mode) return closeSheet();
    try { const r = await api('/app/api/money-mode', { search_id: d.search.id, mode: m }); d.money = r.money; d.search.money_mode = m; hap.ok(); toast(t('mm_saved')); closeSheet(); emit(); }
    catch { toast(t('err_generic')); }
  }
  return html`<h2>${t('mm_settings')}</h2>
    <div class="card grp">${[['split', 'scale'], ['shared', 'wallet']].map(([m, ic]) => html`<button class="opt sw-opt" aria-current=${mode === m ? 'true' : null} onClick=${() => set(m)}>
      <${Icon} n=${ic} cls="sm" /><div class="grow"><div style="font-weight:600">${t('mm_' + m + '_t')}</div><div class="muted" style="font-size:13px">${t('mm_' + m + '_s')}</div></div>${mode === m && html`<${Icon} n="check" cls="check" />`}</button>`)}</div>
    <button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
}
