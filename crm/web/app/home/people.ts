// Split from app.js (wave 11): see the section comment below.
import { api } from '../core/api.js';
import { D, canVoteRole, districtShort, listingById, memberById } from '../core/data.js';
import { channelName, dfmt, firstName, fmtDM, shortTitle } from '../core/format.js';
import { LANG, STR, t } from '../core/i18n.js';
import { go, openLink, sp } from '../core/routing.js';
import { S, closeSheet, emit, hap, openSheet, toast } from '../core/store.js';
import { ordSupOfDir, useOrders } from '../orders/orders.js';
import { channelLink, roleLabel } from '../screens/chats.js';
import { Av, ICONS, Icon } from '../ui/icons.js';
import { Nav } from '../ui/pieces.js';
import { BackIfWeb, RoundBtn, W3Head, dealListing, homeName, mapLink, postInstruction, telLink } from './helpers.js';
import { hcSub } from './house.js';
import { MO_STEPS } from './moveout.js';
import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';

// ---------------------------------------------------------------- people notes (23)
export const contactCache: Bag = {};
export function replyLabel(m) {
  if (m == null) return '—';
  if (m < 60) return t('pn_min', { n: Math.max(1, m) });
  if (m < 1440) return t('pn_h', { n: Math.round(m / 60) });
  return t('pn_d', { n: Math.round(m / 1440) });
}
export function noteWhen(iso) {
  const days = (Date.now() - Date.parse(iso)) / 864e5;
  return days < 30 ? fmtDM(iso) : dfmt(iso, { month: 'short' }).replace('.', '');
}
export function Person({ cid }) {
  const d = D();
  const [data, setData] = useState(contactCache[cid] ?? null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    api(`/app/api/contact?id=${encodeURIComponent(cid)}&s=${encodeURIComponent(d.search.id)}`).then((r) => { contactCache[cid] = r; setData(r); }).catch(() => setErr(true));
  }, [cid, S.sheet == null]);
  if (err && !data) return html`<main class="screen"><${W3Head} title="—" /><div class="center-msg">${t('err_generic')}</div><${Nav} tab="listings" /></main>`;
  if (!data) return html`<main class="screen"><div class="skeleton" style="height:90px;border-radius:24px"></div><${Nav} tab="listings" /></main>`;
  const c = data.contact ?? {};
  const th = (d.threads ?? []).find((x) => x.contact_id === cid);
  const lc = (d.listing_contacts ?? []).find((x) => x.contact_id === cid);
  const hc = (d.house_contacts ?? []).find((x) => x.contact_id === cid);
  const l = listingById(th?.listing_id ?? lc?.listing_id) ?? (hc ? dealListing() : null);
  const sub = [roleLabel(c.role), l ? [shortTitle(l.title), districtShort(l)].filter(Boolean).join(', ') : null].filter(Boolean).join(' · ');
  const st = data.stats ?? {};
  const words = String(c.name ?? '?').trim().split(/\s+/);
  const ini = (words[0]?.[0] ?? '?') + (words[1]?.[0] ?? '');
  const canAct = canVoteRole(d.me.role);
  return html`<main class="screen w2">
    <div class="w3-person"><${BackIfWeb} /><span class="w3-ini">${ini.toUpperCase()}</span><div class="grow"><h1 class="h1 w3-h1">${c.name ?? '—'}</h1>${sub && html`<p class="w2-sub">${sub}</p>`}</div></div>
    <div class="w3-tiles">
      <div class="card"><b>${st.searches ?? 0}</b><span>${t('pn_searches', { n: st.searches ?? 0 })}</span></div>
      <div class="card"><b>${st.notes ?? 0}</b><span>${t('pn_notes', { n: st.notes ?? 0 })}</span></div>
      <div class="card"><b>${replyLabel(st.reply_minutes)}</b><span>${t('pn_reply')}</span></div>
    </div>
    <div class="card w2-list">
      <div class="w2-lh"><span>${t('pn_notes_title')}</span>${canAct && html`<button class="w2-add" onClick=${() => openSheet('note_add', cid)}><${Icon} n="plus" cls="sm" />${t('add')}</button>`}</div>
      ${(data.notes ?? []).length ? data.notes.map((n) => {
        const m = memberById(n.author);
        return html`<div key=${n.id} class="w2-row sig pn-row"><${Icon} n=${n.sentiment > 0 ? 'thumbs-up' : n.sentiment < 0 ? 'thumbs-down' : 'info'} cls=${n.sentiment > 0 ? 'pn-good' : n.sentiment < 0 ? 'pn-bad' : 'muted'} />
          <div class="grow"><b>${n.text}</b><span class="pn-by">${n.author === 'agent' ? html`<span class="feed-ic xs"><${Icon} n="sparkles" cls="xs" /></span>` : html`<${Av} m=${m ?? { name: n.author_name }} size=${22} />`}
            ${[n.author === 'agent' ? t('agent') : firstName(n.author_name), noteWhen(n.at), n.search_id && n.search_id !== d.search.id ? shortTitle(n.search_title) : null].filter(Boolean).join(' · ')}</span></div></div>`;
      }) : html`<div class="w2-row"><span class="muted">${t('pn_none')}</span></div>`}
    </div>
    <p class="w2-foot">${t('pn_foot')}</p>
    <${Nav} tab="listings" />
  </main>`;
}
export function NoteSheet({ cid }) {
  const d = D();
  const [text, setText] = useState('');
  const [sent, setSent] = useState(1);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const r = await api('/app/api/note', { search_id: d.search.id, contact_id: cid, text: text.trim(), sentiment: sent });
      const c = contactCache[cid];
      if (c) { c.notes = [r.note, ...(c.notes ?? [])]; c.stats = { ...(c.stats ?? {}), notes: (c.stats?.notes ?? 0) + 1 }; }
      hap.ok(); toast(t('pn_saved')); closeSheet();
    } catch (e) { toast(e.code === 'sensitive' ? e.message : t('err_generic')); }
    setBusy(false);
  }
  return html`<h2>${t('pn_add')}</h2>
    <div class="seg full" role="group" style="margin-bottom:12px">
      <button aria-pressed=${sent > 0 ? 'true' : 'false'} onClick=${() => setSent(1)}><${Icon} n="thumbs-up" cls="sm" /> ${t('pn_good')}</button>
      <button aria-pressed=${sent < 0 ? 'true' : 'false'} onClick=${() => setSent(-1)}><${Icon} n="thumbs-down" cls="sm" /> ${t('pn_bad')}</button>
    </div>
    <textarea class="e-input" rows="3" placeholder=${t('pn_ph')} value=${text} onInput=${(e) => setText(e.currentTarget.value)}></textarea>
    <p class="muted" style="font-size:13px;margin:8px 2px 0">${t('pn_foot')}</p>
    <button class="btn accent block" style="margin-top:12px" disabled=${busy || !text.trim()} onClick=${save}>${t('x_save')}</button>
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}

// ---------------------------------------------------------------- contacts directory (30)
export const DG_BUILTIN = ['home', 'bikes', 'food', 'services', 'health'];
export const DG_ICON = { home: 'house', bikes: 'bike', food: 'shopping-cart', services: 'shirt', health: 'pill' };
export const dgName = (k, long = false) => {
  if (DG_BUILTIN.includes(k)) return long && STR[LANG]['dgl_' + k] ? t('dgl_' + k) : t('dg_' + k);
  return (D()?.search?.dir_groups ?? D()?.dir_groups ?? []).find((g) => g.key === k)?.name ?? k;
};
export function dirEntries() {
  const d = D();
  const hc = (d.house_contacts ?? []).map((c) => ({ id: 'hc:' + c.id, grp: 'home', name: c.name, subtitle: hcSub(c), channel: c.channel === 'whatsapp' || c.channel === 'telegram' ? c.channel : c.channel === 'phone' ? 'phone' : null, address: c.address, phone: c.channel === 'whatsapp' || c.channel === 'phone' ? c.address : null, icon: c.role === 'owner' ? 'key-round' : c.role === 'cleaning' ? 'sparkles' : c.role === 'pool' ? 'waves' : 'house', house: true, contact_id: c.contact_id }));
  return [...hc, ...(d.directory ?? [])];
}
export let dirSeg = 'all';
export function Directory() {
  const d = D();
  const [seg, setSeg0] = useState(dirSeg);
  const setSeg = (k) => { dirSeg = k; setSeg0(k); };
  const all = dirEntries();
  const custom = (d.search.dir_groups ?? []).map((g) => g.key);
  const groups = [...DG_BUILTIN.filter((k) => k !== 'health' || all.some((e) => e.grp === 'health')), ...custom];
  const shown = (seg === 'all' ? groups : [seg]).map((k) => ({ k, items: all.filter((e) => e.grp === k) })).filter((g) => g.items.length || seg !== 'all');
  const canEdit = canVoteRole(d.me.role);
  useOrders(); // wave 10: suppliers get "Заказать"
  const write = (e) => (e.channel === 'whatsapp' ? channelLink('whatsapp', e.address) : e.channel === 'telegram' ? channelLink('telegram', e.address) : null);
  return html`<main class="screen w2">
    <${W3Head} kicker=${[districtShort(dealListing()) || homeName(), t('dr_kicker')].join(' · ')} title=${t('dr_title')}
      right=${canEdit && html`<button class="w3-plus" aria-label=${t('dr_add')} onClick=${() => openSheet('dir_add', seg === 'all' ? null : seg)}><${Icon} n="plus" cls="lg" /></button>`} />
    <div class="w3-chips" role="group">
      <button aria-pressed=${seg === 'all' ? 'true' : 'false'} onClick=${() => setSeg('all')}>${t('dr_all')}</button>
      ${groups.map((k) => html`<button key=${k} aria-pressed=${seg === k ? 'true' : 'false'} onClick=${() => { hap.sel(); setSeg(k); }}>${dgName(k)}</button>`)}
      ${canEdit && html`<button class="add" aria-label=${t('dr_new_group')} onClick=${() => openSheet('dir_group')}><${Icon} n="plus" cls="sm" /></button>`}
    </div>
    ${shown.length ? shown.map((g) => html`<div key=${g.k} class="card w2-list">
      <div class="w2-lh"><span>${dgName(g.k, true)}</span></div>
      ${g.items.length ? g.items.map((e) => {
        const wl = write(e);
        const ph = e.phone || (e.channel === 'phone' ? e.address : null);
        const ml = e.channel === 'map' || (!wl && !ph) ? mapLink(e.lat, e.lng, e.map_url) : null;
        return html`<div key=${e.id} class="w2-row w3-irow dr-row" role="button" tabindex="0" onClick=${() => openSheet('dir_entry', e.id)} onKeyDown=${(ev) => ev.key === 'Enter' && openSheet('dir_entry', e.id)}><span class="sq big"><${Icon} n=${e.icon && ICONS[e.icon] ? e.icon : DG_ICON[e.grp] ?? 'store'} /></span>
          <div class="grow"><b>${e.name}</b>${e.subtitle && html`<span>${e.subtitle}</span>`}</div>
          <div class="dr-btns">${ordSupOfDir(e.id) && html`<span class="dr-w" role="button" tabindex="0" aria-label=${t('or_order_btn') + ': ' + e.name} onClick=${(ev) => { ev.stopPropagation(); go(sp('shop', ordSupOfDir(e.id).id)); }} onKeyDown=${(ev) => { if (ev.key === 'Enter') { ev.stopPropagation(); go(sp('shop', ordSupOfDir(e.id).id)); } }}><${Icon} n="basket" />${t('or_order_btn')}</span>`}${wl && !ordSupOfDir(e.id) && html`<span class="dr-w" role="button" tabindex="0" aria-label=${t('dr_write')} onClick=${(ev) => { ev.stopPropagation(); openLink(wl); }}><${Icon} n="message-circle" />${e.channel === 'whatsapp' ? 'WA' : 'TG'}</span>`}
            ${ph && html`<${RoundBtn} ic="phone" label=${t('dr_call')} onClick=${() => openLink(telLink(ph))} />`}
            ${ml && html`<${RoundBtn} ic="map-pin" cls="gray" label=${t('dr_map')} onClick=${() => openLink(ml)} />`}</div></div>`;
      }) : html`<div class="w2-row"><span class="muted">—</span></div>`}
    </div>`) : html`<div class="card" style="padding:16px"><p class="muted" style="margin:0">${t('dr_none')}</p></div>`}
    <${Nav} tab="today" />
  </main>`;
}
export function DirAddSheet({ grp }) {
  const d = D();
  const custom = (d.search.dir_groups ?? []).map((g) => g.key);
  const [g, setG] = useState(grp && grp !== 'home' ? grp : 'services');
  const [name, setName] = useState('');
  const [sub, setSub] = useState('');
  const [ch, setCh] = useState('whatsapp');
  const [addr, setAddr] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    const body: Bag = { search_id: d.search.id, grp: g, name: name.trim(), subtitle: sub.trim() || null, channel: ch };
    if (ch === 'map') body.map_url = addr.trim() || null; else body.address = addr.trim() || null;
    try { const r = await api('/app/api/dir-entry', body); (d.directory ??= []).push(r.entry); hap.ok(); toast(t('dr_saved')); closeSheet(); emit(); }
    catch (e) { toast(e.code === 'bad_map_url' ? e.message : t('err_generic')); }
    setBusy(false);
  }
  const chip = (on, label, f) => html`<button class=${'bchip' + (on ? ' on' : ' off')} aria-pressed=${on ? 'true' : 'false'} onClick=${() => { hap.sel(); f(); }}>${label}</button>`;
  return html`<h2>${t('dr_add')}</h2>
    <div class="x-form">
      <p class="e-lbl">${t('dr_group')}</p><div class="chips">${[...DG_BUILTIN.filter((k) => k !== 'home'), ...custom].map((k) => chip(g === k, dgName(k), () => setG(k)))}</div>
      <p class="e-lbl">${t('pl_name')}</p><input class="e-input" value=${name} placeholder=${t('dr_name_ph')} onInput=${(e) => setName(e.currentTarget.value)} />
      <p class="e-lbl">${t('dr_sub')}</p><input class="e-input" value=${sub} placeholder=${t('dr_sub_ph')} onInput=${(e) => setSub(e.currentTarget.value)} />
      <p class="e-lbl">${t('dr_channel')}</p><div class="chips">${[['whatsapp', 'WhatsApp'], ['telegram', 'Telegram'], ['phone', t('dr_addr_phone')], ['map', t('ch_map')]].map(([k, lb]) => chip(ch === k, lb, () => setCh(k)))}</div>
      <input class="e-input" style="margin-top:10px" value=${addr} placeholder=${t(ch === 'whatsapp' ? 'dr_addr_wa' : ch === 'telegram' ? 'dr_addr_tg' : ch === 'map' ? 'dr_addr_map' : 'dr_addr_phone')} onInput=${(e) => setAddr(e.currentTarget.value)} />
    </div>
    <button class="btn accent block" style="margin-top:14px" disabled=${busy || !name.trim()} onClick=${save}>${t('x_save')}</button>
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}
export function DirGroupSheet() {
  const d = D();
  const [name, setName] = useState('');
  async function save() {
    if (!name.trim()) return;
    try { const r = await api('/app/api/dir-group', { search_id: d.search.id, name: name.trim() }); d.search.dir_groups = r.groups; hap.ok(); toast(t('dr_group_saved')); closeSheet(); emit(); }
    catch { toast(t('err_generic')); }
  }
  return html`<h2>${t('dr_new_group')}</h2><input class="e-input" value=${name} placeholder=${t('dr_group_ph')} onInput=${(e) => setName(e.currentTarget.value)} />
    <button class="btn accent block" style="margin-top:12px" disabled=${!name.trim()} onClick=${save}>${t('x_save')}</button>
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}
export function DirEntrySheet({ id }) {
  const d = D();
  const e = dirEntries().find((x) => x.id === id);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  if (!e) return html`<p class="muted">—</p><button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
  const wl = e.channel === 'whatsapp' || e.channel === 'telegram' ? channelLink(e.channel, e.address) : null;
  const ph = e.phone || (e.channel === 'phone' ? e.address : null);
  const ml = mapLink(e.lat, e.lng, e.map_url);
  async function ask() {
    if (!text.trim()) return;
    setBusy(true);
    try { await postInstruction(`${e.name}${e.address ? ` (${channelName(e.channel)} ${e.address})` : ''}: ${text.trim()}`, 'dir_message', e.house ? e.id.slice(3) : e.id); hap.ok(); toast(t('dr_agent_sent')); closeSheet(); }
    catch { toast(t('err_generic')); }
    setBusy(false);
  }
  async function del() {
    try { await api('/app/api/dir-delete', { id: e.id }); d.directory = (d.directory ?? []).filter((x) => x.id !== e.id); hap.ok(); toast(t('dr_deleted')); closeSheet(); emit(); }
    catch { toast(t('err_generic')); }
  }
  const canAct = canVoteRole(d.me.role);
  return html`<h2>${e.name}</h2>${e.subtitle && html`<p class="muted" style="margin:0 0 12px">${e.subtitle}</p>`}
    <div class="doc-actions">
      ${ordSupOfDir(e.id) && html`<button class="btn accent" onClick=${() => { closeSheet(); go(sp('shop', ordSupOfDir(e.id).id)); }}><${Icon} n="basket" />${t('or_order_btn')}</button>`}
      ${wl && html`<button class=${'btn ' + (ordSupOfDir(e.id) ? 'surface outline' : 'accent')} onClick=${() => openLink(wl)}><${Icon} n="message-circle" />${t('dr_write')}</button>`}
      ${ph && html`<button class="btn surface outline" onClick=${() => openLink(telLink(ph))}><${Icon} n="phone" />${t('dr_call')}</button>`}
      ${ml && html`<button class="btn surface outline" onClick=${() => openLink(ml)}><${Icon} n="map-pin" />${t('dr_map')}</button>`}
    </div>
    ${e.contact_id && html`<button class="btn surface block" style="margin-bottom:10px" onClick=${() => { closeSheet(); go(sp('contact', e.contact_id)); }}><${Icon} n="users" cls="sm" />${t('pn_person')}</button>`}
    ${canAct && (e.address || e.phone) && html`<p class="section" style="margin-top:4px">${t('dr_agent')}</p>
      <textarea class="e-input" rows="2" placeholder=${t('dr_agent_ph')} value=${text} onInput=${(ev) => setText(ev.currentTarget.value)}></textarea>
      <button class="btn surface block" style="margin-top:8px" disabled=${busy || !text.trim()} onClick=${ask}><${Icon} n="sparkles" cls="sm" />${t('dr_agent')}</button>`}
    ${canAct && !e.house && html`<button class="btn ghost block" onClick=${del}><${Icon} n="trash-2" cls="sm" />${t('dr_delete')}</button>`}
    <button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
}
export function W3Links() {
  const d = D();
  const pw = d.power;
  const nDir = (d.directory ?? []).length + (d.house_contacts ?? []).length;
  const row = (screen, ic, title, sub, cls = '') => html`<button class=${'card chats-row ' + cls} onClick=${() => go(sp(screen))}><span class="ic"><${Icon} n=${ic} /></span><div class="grow"><b>${title}</b><span>${sub}</span></div><${Icon} n="chev" cls="sm muted" /></button>`;
  const days = pw?.days_left != null ? Math.max(0, Math.floor(pw.days_left)) : null;
  return html`<div class="w2-links w3-links">
    ${d.moveout && row('moveout', 'door-open', t('w3_moveout'), d.moveout.date ? fmtDM(d.moveout.date) + ' · ' + `${MO_STEPS.filter((k) => d.moveout.steps?.[k]?.status === 'done').length}/${MO_STEPS.length}` : t('mo_date_none'))}
    ${d.relet && row('relet', 'megaphone', t('w3_relet'), t('rl_leads', { n: (d.relet.leads ?? []).length }))}
    ${row('important', 'stamp', t('w3_important'), t('w3_important_sub'))}
    ${row('power', 'zap', t('w3_power'), days != null ? t('w3_power_sub', { n: days }) : t('w3_power_sub_none'), days != null && days <= 3 ? 'warn' : '')}
    ${row('directory', 'store', t('w3_directory'), t('w3_dir_sub', { n: nDir }))}
    ${d.money?.mode !== 'shared' && row('split', 'bed', t('w3_split'), d.search.rooms?.rooms?.length ? t('w3_split_sub') : t('w3_split_sub_none'))}
  </div>`;
}
