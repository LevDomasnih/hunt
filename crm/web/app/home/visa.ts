import { api } from '../core/api.js';
import { D, memberById, minutesFor } from '../core/data.js';
import { firstName, fmtDM, km } from '../core/format.js';
import { LANG, t } from '../core/i18n.js';
import { openLink } from '../core/routing.js';
import { closeSheet, emit, hap, openSheet, toast } from '../core/store.js';
import { channelLink } from '../screens/chats.js';
import { Icon } from '../ui/icons.js';
import { Nav } from '../ui/pieces.js';
import { RoundBtn, W3Head, homeName, homePoint, mapLink, regionPack, telLink } from './helpers.js';
import { roleLabelHC } from './house.js';
import { html } from 'htm/preact';
import { useState } from 'preact/hooks';

// ---------------------------------------------------------------- visa & emergency (26)
export function visaText() {
  const d = D();
  const me = d.user.id;
  const lead = Number(regionPack()?.visa?.extend_lead_days) || 7;
  const before = Number(regionPack()?.visa?.remind_days_before) || 14;
  const leaseTo = d.deal?.data?.terms?.to ?? null;
  const vis = Object.fromEntries((d.visas ?? []).map((v) => [v.user_id, v.visa_until]));
  const mine = vis[me];
  const others = Object.entries(vis).filter(([u]) => u !== me && memberById(u));
  const w = before % 7 === 0 ? (before === 7 ? t('vi_week') : t('vi_weeks', { n: before / 7 })) : t('vi_days', { n: before });
  if (!mine) return { cls: 'acc', title: t('vi_title_none'), text: t('vi_none') };
  const bad = !leaseTo || mine < leaseTo;
  const applyBy = new Date(Date.parse(mine + 'T00:00:00Z') - lead * 864e5).toISOString().slice(0, 10);
  const parts = [leaseTo ? t('vi_mine', { v: fmtDM(mine), l: fmtDM(leaseTo) }) : t('vi_mine_nolease', { v: fmtDM(mine) })];
  if (bad) parts.push(t('vi_extend', { d: fmtDM(applyBy), w }));
  for (const [u, v] of others) parts.push(t(!leaseTo || v >= leaseTo ? 'vi_other_ok' : 'vi_other_bad', { name: LANG === 'ru' ? firstName(memberById(u).name).replace(/а$/, 'и').replace(/я$/, 'и').replace(/([бвгджзклмнпрстфхцчшщ])$/, '$1а').replace(/й$/, 'я') : firstName(memberById(u).name), v: fmtDM(v) }));
  return { cls: bad && leaseTo ? 'acc' : 'ok', title: bad && leaseTo ? t('vi_title_bad') : t('vi_title_ok'), text: parts.join(' ') };
}
export function nearest(places, kind, home) {
  const xs = places.filter((p) => p.kind === kind && p.lat != null);
  if (!home) return xs.find((p) => p.city === String(D().search.region).split('/')[1]) ?? xs[0] ?? null;
  return xs.map((p) => ({ p, k: km(home, [p.lat, p.lng]) })).sort((a, b) => a.k - b.k)[0]?.p ?? null;
}
export function Important() {
  const d = D();
  const em = regionPack()?.emergency ?? null;
  const home = homePoint();
  const vt = visaText();
  const places = em?.places ?? [];
  const hosp = nearest(places, 'hospital', home) ?? nearest(places, 'clinic', home);
  const pharm = nearest(places, 'pharmacy', home);
  const num = (id) => em?.numbers?.find((x) => x.id === id)?.phone ?? null;
  const owner = (d.house_contacts ?? []).find((c) => c.role === 'owner') ?? (d.house_contacts ?? []).find((c) => ['manager', 'repair'].includes(c.role));
  const mins = (p) => (home && p ? minutesFor(km(home, [p.lat, p.lng])) : null);
  const row = (key, ic, title, sub, btn) => html`<div key=${key} class="w2-row w3-irow"><span class="sq big mango"><${Icon} n=${ic} /></span><div class="grow"><b>${title}</b>${sub && html`<span>${sub}</span>`}</div>${btn}</div>`;
  const callBtn = (p) => p && html`<${RoundBtn} ic="phone" label=${t('dr_call')} onClick=${() => openLink(telLink(p))} />`;
  const mapBtn = (p) => html`<${RoundBtn} ic="map-pin" label=${t('dr_map')} onClick=${() => openLink(mapLink(p.lat, p.lng))} />`;
  return html`<main class="screen w2">
    <${W3Head} kicker=${homeName()} title=${t('w3_important')} />
    <button class=${'w3-visa ' + vt.cls} onClick=${() => openSheet('visa')}><div class="w3-warn-h"><${Icon} n="stamp" /><b>${vt.title}</b></div><p>${vt.text}</p></button>
    ${em ? html`<div class="card w2-list">
      <div class="w2-lh"><span>${t('em_title')}</span></div>
      ${hosp && row('h', 'hospital', hosp.name, [t('em_' + hosp.kind) + (hosp.hours === '24/7' ? ' ' + t('em_247') : ''), mins(hosp) ? t('em_min', { n: mins(hosp) }) : null].filter(Boolean).join(' · '), hosp.phone ? callBtn(hosp.phone) : mapBtn(hosp))}
      ${pharm && row('p', 'pill', pharm.name, [t('em_pharmacy'), mins(pharm) ? t('em_min', { n: mins(pharm) }) : null].filter(Boolean).join(' · '), mapBtn(pharm))}
      ${row('n', 'siren', t('em_ambulance', { a: num('ambulance') ?? num('emergency') ?? '112', p: num('police') ?? '—' }), num('tourist_police') ? t('em_tourist', { x: num('tourist_police') }) : num('emergency') ? `112 · ${num('emergency')}` : null, callBtn(num('ambulance') ?? num('emergency')))}
      ${em.power && row('w', 'zap-off', em.power.label?.[LANG] ?? em.power.label?.en ?? em.power.name, [`${em.power.name} ${em.power.phone ?? ''}`.trim(), regionPack()?.power?.prepaid ? t('em_power_tokens') : null].filter(Boolean).join(' · '), callBtn(em.power.phone))}
      ${owner && row('o', 'droplet', t('em_broken'), [`${owner.name}, ${roleLabelHC(owner.role)}`, owner.note].filter(Boolean).join(' · '), owner.channel === 'phone' || owner.channel === 'whatsapp' ? callBtn(owner.address) : channelLink(owner.channel, owner.address) && html`<${RoundBtn} ic="message-circle" label=${t('dr_write')} onClick=${() => openLink(channelLink(owner.channel, owner.address))} />`)}
    </div>` : html`<div class="card" style="padding:16px"><p class="muted" style="margin:0">${t('em_none')}</p></div>`}
    <p class="w2-foot">${t('em_foot')}</p>
    <${Nav} tab="today" />
  </main>`;
}
export function VisaSheet() {
  const d = D();
  const mine = (d.visas ?? []).find((v) => v.user_id === d.user.id)?.visa_until ?? '';
  const [v, setV] = useState(mine);
  async function save(val) {
    try {
      await api('/app/api/visa', { search_id: d.search.id, until: val || null });
      D().visas = [...(D().visas ?? []).filter((x) => x.user_id !== D().user.id), ...(val ? [{ user_id: D().user.id, visa_until: val }] : [])];
      hap.ok(); toast(t('vi_saved')); closeSheet(); emit();
    } catch { toast(t('err_generic')); }
  }
  return html`<h2>${t('vi_sheet')}</h2><p class="muted" style="margin:0 0 12px">${t('vi_sheet_text')}</p>
    <input class="e-input" type="date" value=${v} onInput=${(e) => setV(e.currentTarget.value)} />
    <button class="btn accent block" style="margin-top:12px" disabled=${!v} onClick=${() => save(v)}>${t('x_save')}</button>
    ${mine && html`<button class="btn ghost block" onClick=${() => save(null)}>${t('vi_clear')}</button>`}
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}
