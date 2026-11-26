// Split from app.js (wave 11): see the section comment below.
import { api, refresh } from '../core/api.js';
import { D, districtShort, listingById, photosOf, sceneStyle, shortLabel, travelMode } from '../core/data.js';
import { inTG } from '../core/env.js';
import { dayKey, firstName, fmtDM, fmtDMY, fmtDayMonth, fmtNum, money, shortTitle, termLabel, wdShort } from '../core/format.js';
import { INC, LANG, STR, TERMS, cap, human, pick2, t } from '../core/i18n.js';
import { back, go, sp } from '../core/routing.js';
import { S, emit, hap, toast } from '../core/store.js';
import { BackIfWeb, W2Head, monthYear, msgCard, prepRu, scaled, skel } from '../home/helpers.js';
import { W2Links } from '../home/house.js';
import { ICONS, Icon, Img } from '../ui/icons.js';
import { Nav } from '../ui/pieces.js';
import { html, useEffect, useState } from 'https://unpkg.com/htm@3.1.1/preact/standalone.module.js';

// ---------------------------------------------------------------- deal
export async function toggleCheck(deal, i) {
  const c = deal.data?.checklist?.[i];
  if (!c) return;
  const done = !c.done;
  if (typeof c === 'object') c.done = done;
  hap.sel();
  emit();
  try { await api('/app/api/deal-check', { listing_id: deal.listing_id, index: i, done }); }
  catch { if (typeof c === 'object') c.done = !done; emit(); toast(t('err_generic')); }
}
export function Deal() {
  const d = D();
  const deal = d.deal;
  if (!deal) return html`<main class="screen"><div class="center-msg">—</div><${Nav} tab="today" /></main>`;
  const data = deal.data ?? {};
  const l = listingById(deal.listing_id);
  const terms = data.terms ?? {};
  const pays = (data.payments ?? []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const nextIdx = pays.findIndex((p) => !p.paid && p.kind !== 'refund' && dayKey(p.date) >= dayKey(new Date().toISOString()));
  const checklist = data.checklist ?? [];
  const kind = terms.type === 'sublease' ? t('sublease') : terms.type ? t('lease') : null;
  const kDone = checklist.filter((c) => c.done).length;
  // V4-2: the checklist leads (giant title, big circles); the home and the payments follow as hairline rows
  return html`<main class="screen dl8">
    ${!inTG && html`<div class="row w8-head-top"><${BackIfWeb} /></div>`}
    ${checklist.length > 0 && html`<h1 class="w8-title">${t('before_move')}</h1>
      <p class="w8-cap">${[t('w8_stage_v', { i: kDone, n: checklist.length }), terms.from ? `${wdShort(terms.from)} ${fmtDM(terms.from)}` : null].filter(Boolean).join(' · ')}</p>
      <div class="card checklist dl8-check">${checklist.map((c, i) => html`<button class=${'check' + (c.done ? ' done' : '')} role="checkbox" aria-checked=${c.done ? 'true' : 'false'} disabled=${d.me.role === 'viewer'} onClick=${() => toggleCheck(deal, i)}><span class="box">${c.done && html`<${Icon} n="check" />`}</span><span>${c.text ?? c.label}</span></button>`)}</div>`}
    <div class="deal-head"><${Img} src=${photosOf(l)[0]} />
      <div class="grow"><div class="k">${[t('taking'), kind].filter(Boolean).join(' · ')}</div><h1>${l ? shortLabel(l) : ''}</h1>
        ${terms.from && html`<div class="dates">${fmtDMY(terms.from)}${terms.to ? ' → ' + fmtDMY(terms.to) : ''}</div>`}</div></div>
    ${pays.length > 0 && html`<div class="card pay">${pays.map((p, k) => html`<div class=${'pay-row' + (p.paid ? ' paid' : '')}>
      <span class=${'dt' + (k === nextIdx ? ' next' : '')}>${k === nextIdx ? `${wdShort(p.date)} ${fmtDM(p.date)}` : fmtDM(p.date)}</span>
      <span class="lb">${p.label ?? ''}</span>
      <span class=${'am' + (p.kind === 'refund' ? ' refund' : '')}>${p.kind === 'refund' ? '+' : ''}${money(p.amount, p.currency ?? l?.currency)}</span></div>`)}</div>`}
    <${W2Links} />
    <div class="privacy"><${Icon} n="lock" cls="sm" /><span>${t('privacy')}</span></div>
    <${Nav} tab="today" />
  </main>`;
}

// ---------------------------------------------------------------- brief
export const PT_ALL = ['villa', 'house', 'apartment', 'condo', 'townhouse', 'room'];
export const PT_BASE = { bali: ['villa', 'house', 'apartment'], th: ['condo', 'house', 'villa'], kz: ['apartment', 'house'] };
export const BEDS = ['studio', '1', '2', '3', '4+'];
export const BUDGET_SCALE = {
  IDR: { div: 1e6, min: 5, max: 45, step: 1, ru: 'млн IDR', en: 'M IDR' },
  KZT: { div: 1e3, min: 100, max: 1500, step: 10, ru: 'тыс ₸', en: 'k ₸' },
  THB: { div: 1e3, min: 10, max: 200, step: 1, ru: 'тыс ฿', en: 'k ฿' },
  RUB: { div: 1e3, min: 20, max: 500, step: 5, ru: 'тыс ₽', en: 'k ₽' },
  USD: { div: 1, min: 300, max: 10000, step: 50, ru: '$', en: '$' },
  EUR: { div: 1, min: 300, max: 10000, step: 50, ru: '€', en: '€' },
};
export function budgetScale(cur, vals = []) {
  const base = BUDGET_SCALE[cur] ?? { div: 1, min: 0, max: 5000, step: 50, ru: cur ?? '', en: cur ?? '' };
  const need = vals.filter((v) => v != null).map((v) => Math.ceil((v / base.div) * 1.15 / base.step) * base.step);
  return { ...base, max: Math.max(base.max, ...need), unit: base[LANG] };
}
export const unitNum = (v, sc) => fmtNum(v / sc.div);
export const briefCur = (s) => s?.brief?.currency ?? S.regions?.[s?.country]?.currency ?? null;
export function packDistricts(s) {
  const reg = S.regions?.[s?.country];
  const sub = reg?.sub?.[String(s?.region).split('/')[1]];
  return Object.entries(sub?.districts ?? {});
}
/** Brief slug → pack slug ('melasti' → 'melasti_pandawa'), else itself. */
export function packSlug(slug, s) {
  const ds = packDistricts(s);
  if (ds.some(([k]) => k === slug)) return slug;
  return ds.find(([k]) => k.startsWith(slug + '_') || k.startsWith(slug))?.[0] ?? slug;
}
export function districtLabel(slug, s) {
  const k = packSlug(slug, s);
  const nm = packDistricts(s).find(([x]) => x === k)?.[1] ?? S.regions?.[s?.country]?.areas?.[slug]?.name;
  return nm ? nm[LANG] ?? nm.en : human(slug);
}
export function bedroomsText(arr) {
  const xs = (arr ?? []).map(String);
  if (!xs.length) return '—';
  const nums = xs.filter((x) => /^\d+$/.test(x)).map(Number).sort((a, b) => a - b);
  const rest = xs.filter((x) => !/^\d+$/.test(x)).map((x) => (x === 'studio' ? t('studio') : x));
  const contiguous = nums.length > 1 && nums.every((n, i) => !i || n === nums[i - 1] + 1);
  const numTxt = contiguous ? `${nums[0]}–${nums[nums.length - 1]}` : nums.join(', ');
  return [rest.includes(t('studio')) ? t('studio') : null, numTxt || null, ...rest.filter((x) => x !== t('studio'))].filter(Boolean).join(', ');
}
export function joinNames(names) {
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} ${t('and')} ${names[names.length - 1]}`;
}
export function payLabel(x) {
  const m = String(x).match(/^(\d+)\s*months?\s*upfront/i);
  if (x === 'monthly') return t('pay_monthly');
  if (m) return STR[LANG]['pay_' + m[1]] ? t('pay_' + m[1]) : x;
  if (/^12|year/i.test(x)) return t('pay_12');
  return x;
}
export function importantLines(b) {
  const out = [b.must_have, b.nice_to_have].filter(Boolean).map((x) => cap(String(x).trim()));
  if (b.living_room === 'closed_ac_required') out.push(t('pref_lr_req'));
  if (b.living_room === 'closed_ac_preferred') out.push(t('pref_lr_pref'));
  if (b.pool === 'private') out.push(t('pref_pool_private'));
  if (b.pool === 'shared_ok') out.push(t('pref_pool_shared'));
  return out.map((x) => x.replace(/[.\s]+$/, '')).join('. ');
}
export function noLines(b) {
  const out = [b.deal_breakers ? String(b.deal_breakers).trim().replace(/[.\s]+$/, '') : null];
  if (b.construction_tolerance === 'dealbreaker' && !/стро|constr/i.test(b.deal_breakers ?? '')) out.push(t('pref_construction'));
  return cap(out.filter(Boolean).join(', '));
}
export function budgetFact(b, isOwner, sc) {
  if (b.budget_min != null && b.budget_max != null) return `${unitNum(b.budget_min, sc)}–${unitNum(b.budget_max, sc)}`;
  if (b.budget_max != null) return t('up_to', { x: unitNum(b.budget_max, sc) });
  if (isOwner && b.budget_said != null) return t('up_to', { x: unitNum(b.budget_said, sc) });
  return '—';
}
export function Brief({ arg }) {
  const d = D();
  const s = d.search;
  const isOwner = d.me.role === 'owner';
  const [allD, setAllD] = useState(false);
  if (arg === 'edit') return isOwner ? html`<${BriefEdit} />` : html`<main class="screen no-nav"><div class="center-msg">—</div></main>`;
  const b = s.brief ?? {};
  const sc = budgetScale(briefCur(s));
  const types = b.property_type ?? [];
  const typeChips = [...types, ...(PT_BASE[s.country] ?? ['apartment', 'house', 'villa']).filter((x) => !types.includes(x))];
  const ds = b.districts ?? [];
  const shownD = allD ? ds : ds.slice(0, 7);
  const term = [termLabel(b.term), ...(b.payment_terms ?? []).map(payLabel)].filter(Boolean).join(' · ');
  const imp = importantLines(b);
  const no = noLines(b);
  const anchor = b.anchor;
  const people = [joinNames(d.members.map((m) => firstName(m.name))), s.created_at ? t('created_on', { d: fmtDayMonth(s.created_at) }) : null].filter(Boolean).join(' · ');
  const sec = (ic, title, body) => html`<div class="b-sec"><div class="b-lbl"><${Icon} n=${ic} cls="sm" />${title}</div>${body}</div>`;
  return html`<main class="brief">
    <div class="brief-hero scene" style=${sceneStyle(s.country)}>
      <button class="hero-btn round sm" aria-label=${t('back')} onClick=${back}><${Icon} n="left" /></button>
      ${isOwner && html`<button class="hero-btn pill" onClick=${() => go(sp('brief', 'edit'))}><${Icon} n="pencil" cls="sm" />${t('change')}</button>`}
    </div>
    <div class="brief-body">
      <h1 class="h1">${s.title}</h1>
      <p class="kicker" style="margin-top:6px">${people}</p>
      <div class="facts3">
        <div class="card"><b>${bedroomsText(b.bedrooms)}</b><span>${t('k_bedrooms')}</span></div>
        <div class="card"><b>${budgetFact(b, isOwner, sc)}</b><span>${sc.unit}${t('k_month')}</span></div>
        <div class="card"><b>${b.move_in ? fmtDM(b.move_in) : '—'}</b><span>${t('k_move_in')}</span></div>
      </div>
      <div class="card b-card">
        ${types.length > 0 && sec('home', t('sec_housing'), html`<div class="chips">${typeChips.map((x) => html`<span class=${'bchip' + (types.includes(x) ? ' on' : '')}>${STR[LANG]['pt_' + x] ? t('pt_' + x) : x}</span>`)}</div>`)}
        ${ds.length > 0 && sec('pin', `${t('sec_districts')} · ${ds.length}`, html`<div class="chips">${shownD.map((x) => html`<span class="bchip on">${districtLabel(x, s)}</span>`)}
          ${!allD && ds.length > 7 && html`<button class="bchip" onClick=${() => setAllD(true)}>${t('more_n', { n: ds.length - 7 })}</button>`}</div>`)}
        ${term && sec('cal', t('sec_term'), html`<p>${cap(term)}</p>`)}
        ${imp && sec('sofa', t('sec_important'), html`<p>${imp}</p>`)}
        ${no && sec('ban', t('sec_no'), html`<p>${no}</p>`)}
        ${(anchor || b.anchor_text) && sec(anchor?.icon && ICONS[anchor.icon] ? anchor.icon : 'waves', t('sec_near'), html`<p><b>${anchor?.label ?? b.anchor_text}</b>${anchor?.max_minutes ? html`<span class="muted"> · ${t('near_min', { n: anchor.max_minutes, mode: travelMode() })}</span>` : null}</p>`)}
      </div>
      ${isOwner && b.budget_said != null && html`<div class="said"><${Icon} n="lock" cls="sm" /><div><b>${t('said_title', { x: money(b.budget_said, briefCur(s)) })}</b><span>${t('said_text')}</span></div></div>`}
    </div>
  </main>`;
}

export function DualRange({ lo, hi, min, max, step, onLo, onHi }) {
  const pct = (v) => ((v - min) / Math.max(1, max - min)) * 100;
  return html`<div class="dual">
    <div class="track"></div><div class="fill" style=${`left:${pct(lo)}%;right:${100 - pct(hi)}%`}></div>
    <input type="range" min=${min} max=${max} step=${step} value=${lo} aria-label="min" onInput=${(e) => onLo(Math.min(Number(e.currentTarget.value), hi))} />
    <input type="range" min=${min} max=${max} step=${step} value=${hi} aria-label="max" onInput=${(e) => onHi(Math.max(Number(e.currentTarget.value), lo))} />
  </div>`;
}
export function BriefEdit() {
  const d = D();
  const s = d.search;
  const b0 = s.brief ?? {};
  const cur = briefCur(s);
  const sc = budgetScale(cur, [b0.budget_min, b0.budget_max, b0.budget_said]);
  const toU = (v) => Math.round(v / sc.div / sc.step) * sc.step;
  const said0 = b0.budget_said != null ? b0.budget_said / sc.div : null;
  const [beds, setBeds] = useState(() => new Set((b0.bedrooms ?? []).map(String)));
  const [lo, setLo] = useState(() => (b0.budget_min != null ? toU(b0.budget_min) : said0 != null ? Math.max(sc.min, toU(b0.budget_said * 0.87)) : sc.min));
  const [hi, setHi] = useState(() => (b0.budget_max != null ? toU(b0.budget_max) : said0 != null ? Math.min(sc.max, toU(b0.budget_said * 1.3)) : Math.round((sc.min + sc.max) / 2)));
  const [touched, setTouched] = useState(false);
  const [said, setSaid] = useState(said0 != null ? String(+said0.toFixed(2)) : '');
  const [editSaid, setEditSaid] = useState(false);
  const [ds, setDs] = useState(() => new Set((b0.districts ?? []).map((x) => packSlug(x, s))));
  const [moveIn, setMoveIn] = useState(b0.move_in ?? '');
  const [term, setTerm] = useState(b0.term ?? '');
  const [types, setTypes] = useState(() => new Set(b0.property_type ?? []));
  const [must, setMust] = useState(b0.must_have ?? '');
  const [no, setNo] = useState(b0.deal_breakers ?? '');
  const [busy, setBusy] = useState(false);
  const flip = (set, setter, k) => { hap.sel(); const n = new Set(set); n.has(k) ? n.delete(k) : n.add(k); setter(n); };
  const allDistricts = packDistricts(s);
  const extraD = [...ds].filter((k) => !allDistricts.some(([x]) => x === k)).map((k) => [k, { [LANG]: human(k) }]);
  const ptList = [...new Set([...(PT_BASE[s.country] ?? []), ...PT_ALL])];
  async function save() {
    const patch = {};
    const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    const arr = (set, order) => { const xs = [...set]; return order ? xs.sort((a, b) => order.indexOf(a) - order.indexOf(b)) : xs; };
    const nb = arr(beds, BEDS);
    if (!same(nb.length ? nb : null, b0.bedrooms?.length ? b0.bedrooms.map(String) : null)) patch.bedrooms = nb;
    if (touched || b0.budget_min != null) { const v = Math.round(lo * sc.div); if (v !== b0.budget_min) patch.budget_min = v; }
    if (touched || b0.budget_max != null) { const v = Math.round(hi * sc.div); if (v !== b0.budget_max) patch.budget_max = v; }
    const sv = said.trim() === '' ? null : Math.round(Number(said.replace(',', '.')) * sc.div);
    if (sv != null && !Number.isFinite(sv)) return toast(t('err_generic'));
    if (sv !== (b0.budget_said ?? null)) patch.budget_said = sv;
    const nd = [...ds];
    const od = (b0.districts ?? []);
    if (nd.length !== od.length || nd.some((x) => !od.includes(x))) patch.districts = nd;
    if ((moveIn || null) !== (b0.move_in ?? null)) patch.move_in = moveIn || null;
    if ((term || null) !== (b0.term ?? null)) patch.term = term || null;
    const nt = arr(types, PT_ALL);
    if (!same(nt.length ? nt : null, b0.property_type?.length ? b0.property_type : null)) patch.property_type = nt;
    if ((must.trim() || null) !== (b0.must_have ?? null)) patch.must_have = must.trim() || null;
    if ((no.trim() || null) !== (b0.deal_breakers ?? null)) patch.deal_breakers = no.trim() || null;
    if (!Object.keys(patch).length) { toast(t('unchanged')); back(); return; }
    setBusy(true);
    try {
      const r = await api('/app/api/brief', { search_id: s.id, brief: patch }, 'PATCH');
      if (r.brief) {
        s.brief = r.brief;
        const sum = d.searches.find((x) => x.id === s.id);
        if (sum) sum.brief = r.brief;
      }
      hap.ok();
      toast(t('brief_saved'));
      back();
      refresh();
    } catch { toast(t('err_generic')); }
    setBusy(false);
  }
  const lbl = (k, vars) => html`<p class="e-lbl">${t(k, vars)}</p>`;
  return html`<main class="screen no-nav brief-edit">
    <div class="e-top"><button class="btn ghost" onClick=${back}>${t('cancel')}</button><b>${t('brief')}</b><button class="btn link" disabled=${busy} onClick=${save}>${t('done')}</button></div>
    ${lbl('e_bedrooms')}
    <div class="beds" role="group">${BEDS.map((k) => html`<button aria-pressed=${beds.has(k) ? 'true' : 'false'} onClick=${() => flip(beds, setBeds, k)}>${k === 'studio' ? t('studio') : k}</button>`)}</div>
    ${lbl('e_budget', { unit: sc.unit })}
    <div class="card budget">
      <div class="nums"><b>${fmtNum(lo)}</b><b>${fmtNum(hi)}</b></div>
      <${DualRange} lo=${lo} hi=${hi} min=${sc.min} max=${sc.max} step=${sc.step} onLo=${(v) => { setTouched(true); setLo(v); }} onHi=${(v) => { setTouched(true); setHi(v); }} />
      <div class="said-row"><${Icon} n="lock" cls="sm" />
        ${editSaid ? html`<input class="said-in" inputmode="decimal" value=${said} aria-label=${t('e_said', { x: '' })} onInput=${(e) => setSaid(e.currentTarget.value)} onBlur=${() => setEditSaid(false)} ref=${(el) => el && !el.dataset.f && (el.dataset.f = 1, el.focus())} />`
          : html`<span class="grow">${said.trim() ? t('e_said', { x: said }) : t('e_said_none')}</span>`}
        <button class="icon-btn sm" aria-label=${t('edit_text')} onClick=${() => setEditSaid(!editSaid)}><${Icon} n="pencil" cls="sm" /></button></div>
    </div>
    ${(allDistricts.length > 0 || extraD.length > 0) && html`${lbl('e_districts')}
      <div class="chips">${[...allDistricts, ...extraD].map(([k, nm]) => html`<button class=${'bchip' + (ds.has(k) ? ' on' : ' off')} aria-pressed=${ds.has(k) ? 'true' : 'false'} onClick=${() => flip(ds, setDs, k)}>${nm[LANG] ?? nm.en}</button>`)}</div>
      <p class="e-note">${t('e_note')}</p>`}
    ${lbl('e_move_in')}
    <input class="e-input" type="date" value=${moveIn} onInput=${(e) => setMoveIn(e.currentTarget.value)} />
    ${lbl('e_term')}
    <div class="chips">${Object.keys(TERMS).map((k) => html`<button class=${'bchip' + (term === k ? ' on' : ' off')} aria-pressed=${term === k ? 'true' : 'false'} onClick=${() => { hap.sel(); setTerm(term === k ? '' : k); }}>${termLabel(k)}</button>`)}</div>
    ${lbl('e_types')}
    <div class="chips">${ptList.map((k) => html`<button class=${'bchip' + (types.has(k) ? ' on' : ' off')} aria-pressed=${types.has(k) ? 'true' : 'false'} onClick=${() => flip(types, setTypes, k)}>${t('pt_' + k)}</button>`)}</div>
    ${lbl('e_must')}
    <textarea class="e-input" rows="3" placeholder=${t('e_must_ph')} value=${must} onInput=${(e) => setMust(e.currentTarget.value)}></textarea>
    ${lbl('e_no')}
    <textarea class="e-input" rows="2" placeholder=${t('e_no_ph')} value=${no} onInput=${(e) => setNo(e.currentTarget.value)}></textarea>
  </main>`;
}

// ---------------------------------------------------------------- wave 5: negotiation helper (42)
export const ngCache = {};
export function ngArgs(n) {
  const cur = n.listing?.currency;
  const ref = n.offer?.price ?? n.asked ?? n.market?.median;
  const fem = ['villa', 'apartment'].includes(n.listing?.property_type);
  const parts = [];
  let empty = null, season = null;
  for (const a of n.arguments ?? []) {
    if (a.key === 'median' && a.value != null) parts.push(t('ng_a_median', { x: scaled(a.value, ref) }));
    else if (a.key === 'not_included') {
      const xs = (a.items ?? []).map((k) => pick2(INC[k]) ?? human(k).toLowerCase());
      if (xs.length) parts.push(xs.length > 1 ? t('ng_a_noinc_n', { x: joinNames(xs) }) : t(/а$/.test(xs[0]) ? 'ng_a_noinc_f' : 'ng_a_noinc', { x: xs[0] }));
    } else if (a.key === 'empty_since' && a.date) empty = t(fem ? 'ng_a_empty' : 'ng_a_empty_m', { d: fmtDM(a.date) });
    else if (a.key === 'season' && STR.en['ng_a_season_' + a.season]) season = t('ng_a_season_' + a.season);
    else if (a.key === 'term_upfront' && a.months && !n.offer?.months_upfront) parts.push(t('ng_a_term', { n: a.months }));
    else if (a.key === 'long_listed' && a.days) parts.push(t('ng_a_long', { n: a.days }));
    else if (a.key === 'was_cheaper' && a.price != null) parts.push(t('ng_a_cheaper', { x: money(a.price, cur), d: monthYear(a.date).toLowerCase() }));
  }
  const tail = [empty, season].filter(Boolean).join(' — ');
  if (tail) parts.push(tail);
  return parts.join(', ');
}
export function NegoScreen({ id }) {
  const d = D();
  const l = listingById(id);
  const [n, setN] = useState(ngCache[id] ?? null);
  useEffect(() => {
    api('/app/api/negotiation?listing_id=' + encodeURIComponent(id)).then((j) => { ngCache[id] = j; setN(j); }).catch((e) => setN({ failed: true, code: e.code }));
  }, [id]);
  const li = { ...(l ?? {}), ...(n?.listing ?? {}) };
  const cur = li.currency;
  const asked = n?.asked ?? li.price;
  const dn = li.district ? districtLabel(li.district, d.search).split(/\s+\/\s+/)[0] : districtShort(li);
  const sub = [dn, li.bedrooms != null ? t('br', { n: li.bedrooms }) : null, asked != null ? t('ng_asked', { x: money(asked, cur) }) : null].filter(Boolean).join(' · ');
  let body;
  if (n == null) body = skel(220);
  else if (n.failed) body = msgCard(n.code === 'owner_only' ? t('ng_owner_only') : t('err_generic'));
  else {
    const o = n.offer;
    const args = ngArgs(n);
    const mk = n.market;
    let market;
    if (!mk || mk.median == null) market = msgCard(t('ng_market_none'));
    else {
      const ds = joinNames((mk.districts ?? []).map((s) => prepRu(districtLabel(s, d.search).split(/\s+\/\s+/)[0])));
      const beds = mk.bedrooms != null ? t('ng_beds', { n: mk.bedrooms }) : t('ng_similar');
      const title = ds ? t('ng_in', { b: beds, d: ds }) : beds;
      const mn = mk.min ?? mk.median, mx = mk.max ?? mk.median;
      const lo = Math.min(mn, asked ?? mn), hi = Math.max(mx, asked ?? mx);
      const pos = (x) => (hi > lo ? ((x - lo) / (hi - lo)) * 100 : 50);
      const p25 = mk.p25 ?? mk.median, p75 = mk.p75 ?? mk.median;
      market = html`<div class="card ng-mk"><p class="w3-ct">${title}</p>
        <div class="ng-range" role="img" aria-label=${[t('ng_median', { x: money(mk.median, cur) }), asked != null ? t('ng_asked', { x: money(asked, cur) }) : null].filter(Boolean).join(', ')}>
          <i class="ng-track"></i><i class="ng-band" style=${`left:${pos(p25)}%;width:${Math.max(0, pos(p75) - pos(p25))}%`}></i>
          <i class="ng-med" style=${`left:${pos(mk.median)}%`}></i>${asked != null && html`<i class="ng-dot" style=${`left:${pos(asked)}%`}></i>`}</div>
        <div class="ng-lbl"><span>${money(mn, cur)}</span><b>${t('ng_median', { x: scaled(mk.median, mx) })} · ${mk.source === 'pack' ? t('ng_pack') : t('ng_count', { n: mk.count ?? 0 })}</b><span>${money(mx, cur)}</span></div></div>`;
    }
    const pt = li.property_type;
    const hist = n.history ?? [];
    body = html`
      <div class="m-hero w5-hero"><p class="m-k">${t('ng_offer')}</p>
        ${o ? html`<p class="w5-big">${money(o.price, cur)}${o.months_upfront ? ' · ' + t('ng_upfront', { n: o.months_upfront }) : ''}</p>
            ${args && html`<p class="w5-sub">${t('ng_args', { x: args })}</p>`}${o.capped && html`<p class="w5-sub">${t('ng_capped')}</p>`}`
          : html`<p class="w5-big">${t('ng_none_t')}</p><p class="w5-sub">${args ? t('ng_args', { x: args }) : t('ng_none')}</p>`}</div>
      ${market}
      <div class="card w2-list"><div class="w2-lh"><span>${t(pt === 'villa' ? 'ng_hist_villa' : ['apartment', 'condo'].includes(pt) ? 'ng_hist_flat' : 'ng_hist_house')}</span></div>
        ${hist.length ? hist.map((h, i) => {
          const s2 = [h.note || h.title || h.source, h.match && h.match !== 'same' && STR.en['ng_m_' + h.match] ? t('ng_m_' + h.match) : null].filter(Boolean).join(' · ');
          return html`<div key=${i} class="w2-row w3-irow"><${Icon} n="history" cls="ng-hic" /><div class="grow"><b>${monthYear(h.date)} · ${money(h.price, h.currency ?? cur)}</b>${s2 && html`<span>${s2}</span>`}</div></div>`;
        }) : html`<div class="w2-row"><span class="muted" style="margin:0">${t('ng_hist_none')}</span></div>`}
      </div>
      <p class="w5-foot"><${Icon} n="eyeoff" /><span>${t('ng_foot')}</span></p>`;
  }
  return html`<main class="screen w2">
    <${W2Head} l=${l ?? null} title=${shortTitle(li.title) || '—'} sub=${sub} />
    ${body}
    <${Nav} tab="listings" />
  </main>`;
}
