import { api, refresh } from '../core/api.js';
import { D, canVoteRole } from '../core/data.js';
import { channelName, dayKey, fmtDM, initial, money, relIn, whenLabel } from '../core/format.js';
import { LANG, STR, t } from '../core/i18n.js';
import { go, openLink, sp } from '../core/routing.js';
import { closeSheet, emit, hap, openSheet, toast } from '../core/store.js';
import { useAreasGeo } from '../places/districts.js';
import { areaFlood } from '../places/flood.js';
import { locCache, locStale, packRings, ringKeys, ringSet } from '../places/places.js';
import { channelLink } from '../screens/chats.js';
import { briefCur } from '../screens/deal.js';
import { Icon } from '../ui/icons.js';
import { Nav } from '../ui/pieces.js';
import { perMonth } from './bikes.js';
import { useDossier } from './dossier.js';
import { GuestDrafts } from './guests.js';
import { W2Head, chevRow, dealListing, homeName } from './helpers.js';
import { hmDays, homeListing } from './homemode.js';
import { NextCard } from './moveout.js';
import { W3Links } from './people.js';
import { briefMentionsSurf, surfCache, surfLine } from './surf.js';
import { html } from 'htm/preact';
import { useState } from 'preact/hooks';

// ---------------------------------------------------------------- life in the villa (19)
export const HC_ICON = (c) => (c.channel === 'phone' ? 'phone' : c.channel === 'telegram' ? 'send' : 'message-circle');
export function issueChip(i) {
  if (i.status === 'fixed') return html`<span class="st2 ok">${t('is_fixed')}</span>`;
  if (i.status === 'scheduled') return html`<span class="st2 wait">${i.scheduled_at ? t('is_scheduled', { when: whenLabel(i.scheduled_at) }) : t('is_scheduled_plain')}</span>`;
  return html`<span class="st2">${t('is_open')}</span>`;
}
export function hcSub(c) {
  const per = c.period ? t('per_' + c.period + '_s') : '';
  return [[roleLabelHC(c.role), c.schedule].filter(Boolean).join(' '), c.cost != null ? `${money(c.cost, c.currency)}${per}` : null, c.payer ? t('payer_' + c.payer) : null, c.note].filter(Boolean).join(' · ');
}
export const roleLabelHC = (r) => (STR[LANG]['hc_' + r] ? t('hc_' + r) : r);
export function datesBanner() {
  const today = dayKey(new Date().toISOString());
  const ds = (D()?.dates ?? []).filter((x) => !x.done && x.date >= today).slice(0, 2);
  if (!ds.length) return null;
  return ds.map((x) => `${fmtDM(x.date)} — ${x.title.replace(/^./, (c) => c.toLowerCase())}${x.amount != null ? ' ' + money(x.amount, x.currency) : ''}${x.note ? ` (${x.note.replace(/^./, (c) => c.toLowerCase())})` : ''}`).join('. ') + '.';
}
/** Wave 8.1: the owner names the home (listings.short_name) — the titles use it instead of the long listing title. */
export function HomeNameSheet() {
  const d = D();
  const l = homeListing();
  const [v, setV] = useState(l?.short_name ?? '');
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!l) return;
    setBusy(true);
    try {
      const r = await api('/app/api/home-name', { search_id: d.search.id, listing_id: l.id, short_name: v.trim() || null });
      l.short_name = r.short_name;
      hap.ok(); toast(t('w81_saved')); closeSheet(); emit();
    } catch { toast(t('err_generic')); }
    setBusy(false);
  }
  return html`<h2>${t('w81_rename')}</h2><p class="muted" style="margin:0 0 14px">${t('w81_rename_hint')}</p>
    <input class="e-input" maxlength="40" value=${v} placeholder=${t('w81_rename_ph')} onInput=${(e) => setV(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && save()} />
    <button class="btn accent block" style="margin-top:14px" disabled=${busy} onClick=${save}>${t('w81_save')}</button>
    <button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
}
export function Home() {
  const d = D();
  const l = dealListing();
  const terms = d.deal?.data?.terms ?? {};
  let kicker = t('home_living_short');
  if (terms.from && hmDays(terms.from) > 0) kicker = `${t('pp_k_movein')} ${t('hm_in_days', { n: hmDays(terms.from) })}`;
  else if (terms.from && terms.to) {
    const day0 = Date.parse(terms.from + 'T00:00:00Z'), day1 = Date.parse(terms.to + 'T00:00:00Z');
    const nowD = Date.parse(dayKey(new Date().toISOString()) + 'T00:00:00Z');
    kicker = t('home_living', { d: Math.max(1, Math.min(Math.round((day1 - day0) / 864e5), Math.round((nowD - day0) / 864e5) + 1)), n: Math.round((day1 - day0) / 864e5) });
  }
  const issues = d.issues ?? [];
  const hcs = d.house_contacts ?? [];
  const banner = datesBanner();
  const canAct = canVoteRole(d.me.role);
  return html`<main class="screen w2">
    <${W2Head} l=${l} kicker=${kicker} kickerCls="jungle" title=${homeName()}
      right=${d.me.role === 'owner' && homeListing() && html`<button class="round sm w81-rename" aria-label=${t('w81_rename')} onClick=${() => { hap.sel(); openSheet('home_name'); }}><${Icon} n="pencil" /></button>`} />
    <${NextCard} />
    <${GuestDrafts} />
    <div class="card w2-list">
      <div class="w2-lh"><span>${t('issues')}</span>${canAct && html`<button class="w2-add" onClick=${() => openSheet('issue')}><${Icon} n="plus" cls="sm" />${t('report')}</button>`}</div>
      ${issues.length ? issues.map((i) => html`<div key=${i.id} class="w2-row is-row"><div class="grow"><div class="is-hd"><b>${i.title}</b>${issueChip(i)}</div>
        <span>${(i.status === 'fixed' ? [i.fixed_at ? fmtDM(i.fixed_at) : null, i.note] : [i.note, agoRel(i.updated_at)]).filter(Boolean).join(' · ')}</span></div></div>`)
        : html`<div class="w2-row"><span class="muted">${t('no_issues')}</span></div>`}
    </div>
    <div class="card w2-list">
      <div class="w2-lh"><span>${t('contacts')}</span></div>
      ${hcs.length ? hcs.map((c) => {
        const link = channelLink(c.channel, c.address);
        return html`<div key=${c.id} class="w2-row hc-row" onClick=${c.contact_id ? () => go(sp('contact', c.contact_id)) : null}><span class="letter-av">${initial(c.name)}</span><div class="grow"><b>${c.name}</b><span>${hcSub(c)}</span></div>
          ${link && html`<button class="hc-go" aria-label=${t('open_in', { ch: channelName(c.channel) })} onClick=${() => openLink(link)}><${Icon} n=${HC_ICON(c)} /></button>`}</div>`;
      }) : html`<div class="w2-row"><span class="muted">${t('no_hcontacts')}</span></div>`}
    </div>
    ${banner && html`<button class="w2-note" onClick=${() => go(sp('docs'))}><${Icon} n="calendar-clock" /><span>${banner}</span></button>`}
    <${W3Links} />
    <${W4Links} />
    <${W5Links} />
    <${W2Links} />
    <${Nav} tab="today" />
  </main>`;
}
/** "2 ч назад" for recent, else a date. */
export function agoRel(iso) {
  if (!iso) return null;
  const ms = Date.now() - Date.parse(iso);
  return ms < 864e5 ? relIn(-ms) : fmtDM(iso);
}
export function W2Links() {
  const d = D();
  const n = (d.money?.expenses ?? []).length;
  const docs = (d.documents ?? []).length;
  return html`<div class="w2-links">
    ${d.deal && html`<button class="card chats-row" onClick=${() => go(sp('docs'))}><span class="ic"><${Icon} n="file-text" /></span><div class="grow"><b>${t('deal_links_docs')}</b><span>${[docs ? `${t('docs')}: ${docs}` : null, (d.dates ?? []).length ? `${t('dates_title').toLowerCase()}: ${d.dates.length}` : null].filter(Boolean).join(' · ') || '—'}</span></div><${Icon} n="chev" cls="sm muted" /></button>`}
    <button class="card chats-row" onClick=${() => go(sp('money'))}><span class="ic"><${Icon} n="wallet" /></span><div class="grow"><b>${t('deal_links_money')}</b><span>${t('money_row_sub', { n })}</span></div><${Icon} n="chev" cls="sm muted" /></button>
  </div>`;
}
export function IssueSheet() {
  const d = D();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const r = await api('/app/api/issue', { search_id: d.search.id, title: title.trim(), note: note.trim() || null });
      (D().issues ??= []).unshift(r.issue);
      hap.ok();
      toast(t('is_sent'));
      closeSheet();
      refresh();
    } catch { toast(t('err_generic')); }
    setBusy(false);
  }
  return html`<h2>${t('is_report_title')}</h2>
    <input class="e-input" value=${title} placeholder=${t('is_report_ph')} onInput=${(e) => setTitle(e.currentTarget.value)} />
    <textarea class="e-input" style="margin-top:10px" rows="3" placeholder=${t('is_note_ph')} value=${note} onInput=${(e) => setNote(e.currentTarget.value)}></textarea>
    <button class="btn accent block" style="margin-top:12px" disabled=${busy || !title.trim()} onClick=${send}><${Icon} n="send" cls="sm" />${t('report')}</button>
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}

// ---------------------------------------------------------------- wave 4 links on the house screen
export function W4Links() {
  const d = D();
  const row = (screen, ic, title, sub) => html`<button class="card chats-row" onClick=${() => go(sp(screen))}><span class="ic"><${Icon} n=${ic} /></span><div class="grow"><b>${title}</b><span>${sub}</span></div><${Icon} n="chev" cls="sm muted" /></button>`;
  const bikes = (d.bikes ?? []).filter((b) => b.status !== 'returned');
  const ins = (d.scans ?? []).filter((s) => s.phase === 'movein');
  const iv = d.items ?? { items: [] };
  const cur = bikes[0]?.currency ?? briefCur(d.search);
  return html`<div class="w2-links w3-links">
    ${row('act', 'box', t('w4_act'), ins.length ? t('w4_act_sub', { x: ins.filter((s) => s.has_file).length, n: ins.length }) : t('w4_act_sub0'))}
    ${row('bikes', 'bike', t('w4_bikes'), bikes.length ? [t('bk_n', { n: bikes.length }), t('bk_per', { x: money(bikes.reduce((a, b) => a + perMonth(b), 0), cur) })].join(' · ') : t('w4_bikes_sub0'))}
    ${row('items', 'archive', t('w4_items'), iv.items?.length ? `${t('it_kicker0', { n: iv.items.length })} · ${money(iv.total, iv.currency ?? cur)}` : t('w4_items_sub0'))}
    ${d.deal && row('dossier', 'file-text', t('w4_dossier'), t('w4_dossier_sub'))}
  </div>`;
}

/** Listing detail rows: location score, flood risk, a house dossier from earlier searches. */
export function ListingW4({ l, noLoc = false }) {
  const d = D();
  useAreasGeo(d.search.country);
  const dos = useDossier(l.id);
  const lv = locCache[l.id];
  const stale = locStale(lv);
  const loc = stale ? null : lv?.location;
  const r0 = loc ? ringKeys(lv)[0] : null;
  const near = loc ? (loc.rings?.[String(r0)]?.places ?? []).filter((p) => p.contribution > 0).slice(0, 3).map((p) => p.name).join(', ') : '';
  const fl = l.flood?.level ?? areaFlood(l)?.level ?? null;
  return html`${dos?.dossiers?.length > 0 && html`<button class="w2-note dos-banner" onClick=${() => go(sp('dossier', l.id))}><${Icon} n="file-text" /><span>${t('do_banner')}</span></button>`}
    ${!noLoc && (l.location_score != null || l.lat != null) && html`<button class="card chats-row" onClick=${() => go(sp('location', l.id))}><span class="ic"><${Icon} n="map-pin" /></span>
      <div class="grow"><b>${l.location_score != null ? t('lc_badge', { n: l.location_score }) : t('lc_row')}</b><span>${near ? t('lc_row_sub', { x: near, r: r0 }) : stale ? t('lc_stale') : l.location_score != null ? t('lc_how', { n: l.location_score }) : t('lc_none', { r: (lv ? ringSet(lv) : packRings()).join('/') })}</span></div><${Icon} n="chev" cls="sm muted" /></button>`}
    ${fl && html`<button class="card chats-row" onClick=${() => go(sp('flood', l.id))}><span class=${'ic' + (fl === 'low' ? '' : ' fl-ic')}><${Icon} n="cloud-rain" /></span>
      <div class="grow"><b>${t('fl_title', { x: t('fl_' + fl) })}</b><span>${l.flood?.summary ?? areaFlood(l)?.note ?? ''}</span></div><${Icon} n="chev" cls="sm muted" /></button>`}`;
}

// ---------------------------------------------------------------- wave 5 links on the house screen
export function W5Links() {
  const d = D();
  const nG = (d.guests ?? []).filter((g) => g.status === 'active').length;
  const sv = surfCache[d.search.id];
  return html`<div class="w2-links w3-links">
    ${(d.me.surf || briefMentionsSurf()) && chevRow(() => go(sp('surf')), 'waves', t('sf_row'), surfLine(sv) ?? t('sf_row_sub'))}
    ${chevRow(() => go(sp('guide')), 'key', t('gd_title'), d.guide_ready ? t('gd_row_ready') : t('gd_row_sub'))}
    ${canVoteRole(d.me.role) && chevRow(() => go(sp('guests')), 'users', t('gi_row'), nG ? t('gi_row_sub', { n: nG }) : t('gi_row_sub0'), nG ? html`<span class="count-badge acc">${nG}</span>` : null)}
    ${d.deal && chevRow(() => go(sp('recap')), 'share-2', t('rc_title'), t('rc_row_sub'))}
  </div>`;
}
