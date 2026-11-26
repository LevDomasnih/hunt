// Split from app.js (wave 11): see the section comment below.
import { api, load } from '../core/api.js';
import { D, canVoteRole } from '../core/data.js';
import { inTG } from '../core/env.js';
import { dayKey, fmtDM, money, wdShort } from '../core/format.js';
import { LANG, cap, t } from '../core/i18n.js';
import { go, openLink, sp } from '../core/routing.js';
import { closeSheet, emit, hap, openSheet, toast } from '../core/store.js';
import { Icon } from '../ui/icons.js';
import { Nav, Sticker } from '../ui/pieces.js';
import { BackIfWeb, W2Head, dealListing, homeName } from './helpers.js';
import { html, useState } from 'https://unpkg.com/htm@3.1.1/preact/standalone.module.js';

// ---------------------------------------------------------------- documents and dates (21, 21b)
export const DOC_ICON = { lease: 'file-text', receipt: 'receipt-text', owner_consent: 'file-pen', movein_video: 'video', other: 'file' };
export const SUM_ICON = { users: 'users', calendar: 'cal', wallet: 'wallet', shield: 'shield', zap: 'zap', home: 'home', key: 'key-round', file: 'file', alert: 'triangle-alert', receipt: 'receipt-text', info: 'info' };
export function fileLabel(doc) {
  if (!doc.has_file) return null;
  if (doc.file_kind === 'photo' || /^image\//.test(doc.mime ?? '')) return t('f_photo');
  if (doc.file_kind === 'video' || /^video\//.test(doc.mime ?? '')) return t('f_video');
  if (/pdf/.test(doc.mime ?? '') || /\.pdf$/i.test(doc.file_name ?? '')) return t('f_pdf');
  return t('f_file');
}
export const docTitle = (doc) => (doc.version ? `${doc.title}, ${t('version_n', { n: doc.version })}` : doc.title);
export function docSub(doc) {
  if (doc.status !== 'have') return doc.note ?? '';
  const date = doc.signed_at ? t('signed_cap', { d: fmtDM(doc.signed_at) }) : doc.doc_date ? fmtDM(doc.doc_date) : null;
  return [date, fileLabel(doc), doc.pages ? t('pages_n', { n: doc.pages }) : null, doc.note].filter(Boolean).join(' · ');
}
export function docChip(doc) {
  if (doc.status === 'have') return html`<span class="st2 ok">${t('ds_have')}</span>`;
  if (doc.status === 'request') return html`<span class="st2 wait">${t('ds_request')}</span>`;
  const dd = doc.due_date;
  const soon = dd && Date.parse(dd) - Date.now() < 6 * 864e5 && Date.parse(dd) > Date.now() - 864e5;
  return html`<span class="st2">${dd ? (soon ? (LANG === 'ru' ? `В ${wdShort(dd).toLowerCase()}` : `On ${wdShort(dd)}`) : t('ds_due', { d: fmtDM(dd) })) : '—'}</span>`;
}
export const CAD = { payment: 'cad_payment', notice: 'cad_notice', deposit_return: 'cad_deposit_return' };
export function Docs() {
  const d = D();
  const l = dealListing();
  if (!d.deal) return html`<main class="screen"><div class="center-msg">—</div><${Nav} tab="today" /></main>`;
  const docs = d.documents ?? [];
  const dates = d.dates ?? [];
  const canAct = canVoteRole(d.me.role);
  const markDone = async (i, done) => {
    // wave 6 · A: dates of an extension term carry term_seq + their index inside that term
    try { const x = dates[i]; await api('/app/api/deal-date', { listing_id: d.deal.listing_id, index: x?.term_seq >= 2 ? x.index : i, ...(x?.term_seq >= 2 ? { term_seq: x.term_seq } : {}), done }); dates[i].done = done; hap.ok(); emit(); } catch { toast(t('err_generic')); }
  };
  return html`<main class="screen w2">
    <${W2Head} l=${l} kicker=${t('docs_kicker')} title=${homeName()} />
    <div class="card w2-list">
      <div class="w2-lh"><span>${t('docs')}</span>${canAct && html`<button class="w2-add" onClick=${() => openSheet('add_doc')}><${Icon} n="plus" cls="sm" />${t('add')}</button>`}</div>
      ${docs.length ? docs.map((doc) => html`<button key=${doc.id} class="w2-row doc-row" onClick=${() => (doc.has_file || doc.summary ? go(sp('doc', doc.id)) : openSheet('doc_req', doc))}>
        <span class="sq big"><${Icon} n=${DOC_ICON[doc.kind] ?? 'file'} /></span><div class="grow"><b>${docTitle(doc)}</b>${docSub(doc) && html`<span>${docSub(doc)}</span>`}</div>${docChip(doc)}</button>`)
        : html`<div class="w2-row"><span class="muted">—</span></div>`}
    </div>
    ${dates.length > 0 && html`<div class="card w2-list">
      <div class="w2-lh"><span>${t('dates_title')}</span></div>
      ${dates.map((x, i) => {
        if (x.done && x.kind === 'payment') return null;
        const dep = x.kind === 'deposit_return';
        const sub = [CAD[x.kind] && !x.done ? t(CAD[x.kind]) : null, x.note, x.done && dep ? t('returned') : null].filter(Boolean).join('. ');
        const due = dep && !x.done && x.date <= dayKey(new Date().toISOString());
        return html`<div key=${i} class=${'w2-row dt-row' + (x.done ? ' done' : '')}><b class=${'dt' + (dep ? ' acc' : '')}>${dep ? t('until_d', { d: fmtDM(x.date) }) : fmtDM(x.date)}</b>
          <div class="grow"><b>${x.title}${x.amount != null ? ' ' + money(x.amount, x.currency) : ''}</b>${sub && html`<span>${sub}</span>`}</div>
          ${due && canAct && html`<button class="st2 ok btn-chip" onClick=${() => markDone(i, true)}>${t('mark_returned')}</button>`}</div>`;
      })}
    </div>`}
    <p class="w2-foot">${t('docs_foot')}</p>
    <${Nav} tab="today" />
  </main>`;
}
export function DocDetail({ id }) {
  const d = D();
  const doc = (d.documents ?? []).find((x) => x.id === id);
  const [busy, setBusy] = useState(false);
  if (!doc) return html`<main class="screen no-nav"><div class="center-msg">—</div></main>`;
  const sm = doc.summary;
  const sub = [doc.version ? (doc.doc_date ? t('version_from', { n: doc.version, d: fmtDM(doc.doc_date) }) : cap(t('version_n', { n: doc.version }))) : doc.doc_date ? fmtDM(doc.doc_date) : null,
    doc.signed_at ? t('signed_on', { d: fmtDM(doc.signed_at) }) : null, doc.pages ? t('pages_n', { n: doc.pages }) : null].filter(Boolean).join(' · ');
  const fl = fileLabel(doc);
  const openLabel = fl === t('f_pdf') ? t('open_pdf') : fl === t('f_photo') ? t('open_photo') : fl === t('f_video') ? t('open_video') : t('open_file');
  async function open() {
    setBusy(true);
    try { const r = await api('/app/api/doc-link', { id }); openLink(r.url); } catch { toast(t('err_generic')); }
    setBusy(false);
  }
  async function send() {
    setBusy(true);
    try { await api('/app/api/doc-send', { id }); hap.ok(); toast(t('sent_tg')); } catch (e) { toast(e.code === 'no_tg_user' ? t('err_member') : t('err_generic')); }
    setBusy(false);
  }
  // V4-12: the paper itself as the hero (tilted, a "signed" sticker), the giant title, the points, the two pills
  const actions = doc.has_file ? html`<div class="doc-actions">
        <button class="btn accent" disabled=${busy} onClick=${open}><${Icon} n="file-down" />${openLabel}</button>
        <button class="btn surface outline" disabled=${busy} onClick=${send}><${Icon} n="send" />${t('to_tg')}</button></div>`
      : html`<p class="muted">${t('no_file')}</p>`;
  return html`<main class="screen no-nav w2 doc8-screen">
    ${!inTG && html`<div class="row w8-head-top"><${BackIfWeb} /></div>`}
    <div class="doc8" aria-hidden="true"><div class="doc8-paper"><b>${doc.title}</b>${Array.from({ length: 9 }, (_, k) => html`<i key=${k} style=${k % 4 === 3 ? 'width:62%' : ''}></i>`)}</div>
      ${doc.signed_at && html`<${Sticker} text=${t('w8_signed', { d: fmtDM(doc.signed_at) })} style="right:4%;top:-4%;--r:-12deg" />`}</div>
    <div class="head"><div><p class="kicker">${t('doc_kicker', { home: homeName() })}</p><h1 class="h1 doc8-h">${doc.title}</h1>${sub && html`<p class="w2-sub">${sub}</p>`}</div></div>
    ${sm?.sections?.length ? html`<div class="card w2-list"><div class="w2-lh"><span>${t('main_points')}</span></div>
      ${sm.sections.map((x, k) => html`<div key=${k} class="w2-row sig"><${Icon} n=${SUM_ICON[x.icon] ?? 'info'} cls="muted" /><div class="grow"><b>${x.title}</b><span>${x.text}</span></div></div>`)}</div>`
      : html`<div class="card" style="padding:16px"><p class="muted" style="margin:0">${t('no_summary')}</p></div>`}
    ${sm?.changes && html`<div class="w2-note col"><b>${sm.changes_from ? t('changes_from', { n: sm.changes_from }) : t('changes')}</b><span>${sm.changes}</span></div>`}
    ${actions}
  </main>`;
}
export function AddDocSheet() {
  const d = D();
  const req = async (kind) => {
    try { await api('/app/api/doc-request', { search_id: d.search.id, listing_id: d.deal?.listing_id, kind, title: t('dk_' + kind) }); hap.ok(); toast(t('doc_requested')); closeSheet(); load(d.search.id, { quiet: true }); }
    catch { toast(t('err_generic')); }
  };
  return html`<h2>${t('add_doc_title')}</h2><p class="muted" style="margin:0 0 12px">${t('add_doc_bot')}</p>
    ${d.bot_username && html`<button class="btn accent block" style="margin-bottom:14px" onClick=${() => openLink(`https://t.me/${d.bot_username}`)}><${Icon} n="send" cls="sm" />${t('open_bot')}</button>`}
    <p class="section" style="margin-top:0">${t('add_doc_req')}</p>
    <div class="card grp">${['lease', 'receipt', 'owner_consent', 'movein_video'].map((k) => html`<button class="opt" onClick=${() => req(k)}><${Icon} n=${DOC_ICON[k]} cls="sm" /><span class="grow">${t('dk_' + k)}</span><${Icon} n="chev" cls="sm muted" /></button>`)}</div>
    <button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
}
export function DocReqSheet({ doc }) {
  const d = D();
  const req = async () => {
    try { await api('/app/api/doc-request', { search_id: d.search.id, id: doc.id }); hap.ok(); toast(t('doc_requested')); closeSheet(); load(d.search.id, { quiet: true }); }
    catch { toast(t('err_generic')); }
  };
  return html`<h2>${docTitle(doc)}</h2>${doc.note && html`<p class="muted" style="margin:0 0 12px">${doc.note}</p>`}
    ${canVoteRole(d.me.role) && html`<button class="btn accent block" style="margin-bottom:8px" onClick=${req}><${Icon} n="sparkles" cls="sm" />${t('req_this')}</button>`}
    ${d.bot_username && html`<button class="btn surface block" style="margin-bottom:8px" onClick=${() => openLink(`https://t.me/${d.bot_username}`)}><${Icon} n="send" cls="sm" />${t('open_bot')}</button>`}
    <button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
}
export function Toggle({ on, onChange, label, sub }) {
  return html`<button class="opt tgl" role="switch" aria-checked=${on ? 'true' : 'false'} onClick=${() => onChange(!on)}>
    <div class="grow"><div>${label}</div>${sub && html`<div class="muted" style="font-size:13px">${sub}</div>`}</div><span class=${'sw' + (on ? ' on' : '')}><i></i></span></button>`;
}
