// Hunt on a big screen (≥ 1024 px, design/desktop): the rail, the screens as columns on one colour, Hunt as a black device that
// prints one ticket with the decision. Data, helpers and every secondary screen come from app.js (shown in a column), nothing is
// cut from the phone version. app.js imports this file; the names below are used only while rendering (circular import).
import { html, useState, useEffect, useRef, useMemo } from 'https://unpkg.com/htm@3.1.1/preact/standalone.module.js';
import {
  S, D, LANG, t, api, emit, toast, hap, go, sp, back, refresh, load, openSheet, openLink, pref, inTG, isDark, cssVar,
  Icon, Av, BigWord, Typed, Sticker, FloatPhoto, WaterCard, CountUp, Good, Receipt, TkPhoto, Img,
  money, scaled, bigMoney, dfmt, fmtTime, fmtDM, fmtDayMonth, wdShort, dayKey, cap, firstName, shortTitle, pl, skel, msgCard,
  listingById, memberById, votesFor, myVote, vote, photosOf, photoUrl, districtShort, districtName, priceText, minutesFor, km, interestOf, canVoteRole, isNewForMe,
  homeMode, homeListing, homePhase, homeStage, hmStay, hmDays, hmToday, hmName, useEventPlan, useSurf, surfBest, sfH, hm, briefMentionsSurf, nightMode,   sortedThreads, thArchived, chArchRoute, homeThreads, archThreads, archNew, homeRow, waitingUs, channelsOf, contactName, channelName,   useAfisha, AF, afTitle, afHM, afPlace, afPrice, afLang, afWhy, afTravel, afDay, afDayLong, afFeedback, afBook, afIcon, afArea,
  useOrders, ordSup, ordShelf, ordBasket, ordSetQty, ordName, ordShort, ordPrice, ordBadge, ordRot, ordTab, ordCan, ordAgain, ordLast, ordMoney, ordFlushAll,
  copyText, viewingsByDay, regionPack, subRegion, loadML, mapStyle, inviteFriends, docTitle, docSub, dealPaid, vStatus,
} from './app.js';
import { demoOn, demoStart, demoStop } from './demo.js';
import * as ax from './access.js';
import { loadAccess, canAccess } from './access.js';
import { DeskAgent } from './agent.js'; // "Подключить агента" on the desk (design/desktop/agent-desk-*)

/** A price with its unit (22 млн) and its parts for the big figures. */
const prc = (l) => (l?.price != null ? money(l.price, l.currency) : '');
const num = (s) => String(s).match(/^[\d.,  ]+/)?.[0].trim() || String(s);
const unit = (s) => String(s).slice(num(s).length).trim().replace(/^M$/, 'million').replace(/^k$/i, 'thousand');
const L = (ru, en) => (LANG === 'en' ? en : ru);
const WIDE = '(min-width: 1024px)';
export const deskWide = () => matchMedia(WIDE).matches && !(inTG && /^(ios|android)/.test(window.Telegram?.WebApp?.platform ?? ''));
export function useWide() {
  const [w, set] = useState(deskWide());
  useEffect(() => { const m = matchMedia(WIDE), f = () => set(deskWide()); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  useEffect(() => { document.documentElement.toggleAttribute('data-desk', w); }, [w]);
  return w;
}

// ---------------------------------------------------------------- what Hunt did and what waits for a yes
const deskCache = {};
function useDesk(sid) {
  const [v, setV] = useState(deskCache[sid] ?? null);
  useEffect(() => {
    let live = true;
    const get = () => api('/app/api/desk?s=' + encodeURIComponent(sid)).then((j) => { deskCache[sid] = j; live && setV(j); }).catch(() => null);
    get();
    const tm = setInterval(() => !document.hidden && get(), 60e3);
    return () => { live = false; clearInterval(tm); };
  }, [sid]);
  return v;
}
const agoWord = (iso) => {
  if (!iso) return L('ещё не заходил', 'not yet here');
  const m = Math.round((Date.now() - Date.parse(iso)) / 60e3);
  return m < 40 ? L('на связи', 'here') : m < 60 * 20 ? L(`был в ${fmtTime(iso)}`, `last at ${fmtTime(iso)}`) : L(`был ${fmtDM(iso)}`, `last on ${fmtDM(iso)}`);
};
function logLine(x) {
  const d = x.data ?? {};
  const l = x.ref ? listingById(x.ref) : null;
  const nm = l ? shortTitle(l.title) : '';
  switch (x.kind) {
    case 'sent': return L(`написал: ${firstName(d.name) || 'хозяину'}`, `wrote to ${firstName(d.name) || 'the owner'}`);
    case 'listing_added': return L(nm || d.title ? `нашёл: ${nm || d.title}` : 'нашёл дом', `found ${nm || d.title || 'a home'}`);
    case 'checks': return L(nm ? `проверил: ${nm}` : 'проверил дом', `checked ${nm || 'a home'}`);
    case 'viewing_changed': return L(`обновил просмотр${nm ? ': ' + nm : ''}`, `updated a viewing${nm ? ': ' + nm : ''}`);
    case 'thread': return L(`разобрал переписку${d.name ? ': ' + firstName(d.name) : ''}`, `read the chat${d.name ? ': ' + firstName(d.name) : ''}`);
    case 'expense': return L(d.title ? `записал: ${d.title}` : 'записал трату', `logged ${d.title ?? 'an expense'}`);
    case 'document': return L(d.title ? `разобрал: ${d.title}` : 'разобрал документ', `read ${d.title ?? 'a document'}`);
    case 'issue': return L(`передал про поломку`, `passed on the issue`);
    case 'event_booking': return L(`записал: ${d.title ?? 'событие'}`, `booked ${d.title ?? 'an event'}`);
    case 'flood': return L('проверил, топит ли', 'checked flooding');
    case 'dossier': return L('собрал досье', 'built the dossier');
    case 'stage_changed': return L('перевёл проект на новый этап', 'moved the project on');
    case 'useful_decided': return L('проверил ссылку', 'checked a link');
    case 'deal_date': return L('обновил даты договора', 'updated lease dates');
    case 'order_sent': return L('отправил заказ', 'sent the order');
    default: return null;
  }
}
const MANY = { document: () => L('разобрал документы', 'read documents'), listing_added: () => L('нашёл домов', 'homes found'), checks: () => L('проверил домов', 'homes checked'), expense: () => L('записал трат', 'expenses logged'), thread: () => L('разобрал переписок', 'chats read'), viewing_changed: () => L('обновил просмотров', 'viewings updated'), sent: () => L('отправил сообщений', 'messages sent') };
const deskLog = (v) => {
  const out = [];
  for (const x of v?.log ?? []) {
    const s = logLine(x), p = out[out.length - 1];
    if (!s || p?.s === s) continue;
    // A run of the same work within an hour is one line ("разобрал документы: 5").
    if (p && p.kind === x.kind && MANY[x.kind] && Date.parse(p.at0) - Date.parse(x.at) < 36e5) { p.n++; p.s = `${MANY[x.kind]()}: ${p.n}`; continue; }
    out.push({ at: x.at, at0: x.at, s, kind: x.kind, n: 1 });
  }
  return out;
};
/** What Hunt will do next: only dates the project really has. */
function nextLines() {
  const d = D(), now = Date.now(), out = [];
  for (const v of d.viewings ?? []) if (['proposed', 'confirmed'].includes(v.status) && Date.parse(v.starts_at) > now && Date.parse(v.starts_at) < now + 40 * 3600e3) out.push({ at: new Date(Date.parse(v.starts_at) - 3600e3).toISOString(), s: L(`напомню: ${shortTitle(v.title)}`, `remind about ${shortTitle(v.title)}`) });
  const today = hmToday();
  for (const x of d.dates ?? []) if (!x.done && x.date >= today && hmDays(x.date) <= 7) out.push({ at: x.date, s: L(`напомню: ${x.title}`, `remind: ${x.title}`) });
  return out.sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(0, 4);
}
const whenShort = (at) => (/^\d{4}-\d\d-\d\d$/.test(at) ? fmtDM(at) : dayKey(at) === hmToday() ? fmtTime(at) : fmtDM(at));

const later = { get: (id) => Number(pref.get('later.' + id) ?? 0) > Date.now(), set: (id, h = 3) => { pref.set('later.' + id, String(Date.now() + h * 3600e3)); emit(); } };
/** The decisions waiting for this person, the most urgent first. ctx narrows to a contact or a listing. */
function decisions(ctx = {}) {
  const d = D(), out = [], owner = d.me.role === 'owner', can = canVoteRole(d.me.role);
  for (const x of owner ? d.drafts ?? [] : []) out.push({ id: 'd' + x.id, kind: 'draft', draft: x, contact: x.contact_id, listing: x.listing_id });
  for (const x of can ? d.guest_drafts ?? [] : []) out.push({ id: 'd' + x.id, kind: 'draft', draft: { ...x, contact_name: x.dir_name ?? x.address, guest: true } });
  for (const v of can ? d.viewings ?? [] : []) if (v.status === 'proposed' && Date.parse(v.starts_at) > Date.now()) out.push({ id: 'v' + v.id, kind: 'viewing', v, listing: v.listing_id });
  if (homeMode() && can) {
    const pw = d.power?.days_left;
    if (pw != null && pw <= 4) out.push({ id: 'pw' + hmToday(), kind: 'power', n: Math.max(0, Math.floor(pw)) });
    const pay = (d.dates ?? []).find((x) => !x.done && x.kind === 'payment' && hmDays(x.date) != null && hmDays(x.date) <= 3 && hmDays(x.date) >= -5);
    if (pay) out.push({ id: 'p' + pay.date, kind: 'pay', pay });
    if (d.renewal?.status === 'open') out.push({ id: 'rn', kind: 'renewal' });
  }
  return out.filter((x) => !later.get(x.id) && !sending.has(x.id) && (!ctx.contact || x.contact === ctx.contact) && (!ctx.listing || x.listing === ctx.listing));
}

// ---------------------------------------------------------------- send with an undo of 8 seconds
const sending = new Map(); // id -> {until, label, run, timer}
function sendLater(id, label, run) {
  const fire = () => { const x = sending.get(id); if (!x) return; clearTimeout(x.timer); sending.delete(id); Promise.resolve(run()).catch(() => toast(t('err_generic'))).finally(() => { refresh(); emit(); }); emit(); };
  sending.set(id, { until: Date.now() + 8000, label, fire, timer: setTimeout(fire, 8000) });
  hap.ok();
  emit();
}
addEventListener('pagehide', () => { for (const x of sending.values()) x.fire(); });
function SentStrip() {
  const [, tick] = useState(0);
  useEffect(() => { if (!sending.size) return undefined; const i = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(i); });
  return html`${[...sending].map(([id, x]) => html`<div key=${id} class="dk-sent" role="status"><span class="grow">${x.label}</span><button onClick=${() => { clearTimeout(x.timer); sending.delete(id); hap.sel(); emit(); }}>${L('Отменить', 'Undo')} ${Math.max(0, Math.ceil((x.until - Date.now()) / 1000))}</button></div>`)}`;
}
const instruct = (text, kind, ref) => api('/app/api/instruction', { search_id: D().search.id, text, kind, ref });

// ---------------------------------------------------------------- the ticket
/** One decision: the stub (the fact), the question, two or three answers. up = out of the folded Hunt. */
function Ticket({ ctx = {}, up = false, empty = null, all = null }) {
  const list = all ?? decisions(ctx);
  const x = list[0];
  const [edit, setEdit] = useState(null);
  useEffect(() => setEdit(null), [x?.id]);
  if (!x && sending.size) return html`<div class=${'dk-tk none' + (up ? ' up' : '')}><${SentStrip} /></div>`;
  if (!x) return empty ? html`<div class=${'dk-tk none' + (up ? ' up' : '')}><p>${empty}</p></div>` : null;
  const n = list.length > 1 ? `1 ${L('из', 'of')} ${list.length}` : '';
  let stub, to, q, small, acts;
  const d = D();
  if (x.kind === 'draft') {
    const dr = x.draft, l = listingById(dr.listing_id), name = dr.contact_name || (dr.guest ? L('сосед', 'a contact') : channelName(dr.channel)) || '';
    const main = dr.tr || dr.text;
    stub = html`<b>${l?.price ? num(prc(l)) : html`<${Icon} n="send" />`}</b><span>${l?.price ? unit(prc(l)) : L('письмо', 'message')}</span>${n && html`<i>${n}</i>`}`;
    to = [firstName(name), channelName(dr.channel) !== name ? channelName(dr.channel) : null, dr.guest ? L('просит гость', 'a guest asks') : null].filter(Boolean).join(', ');
    q = edit != null ? html`<textarea class="dk-edit" aria-label=${t('edit_text')} value=${edit} onInput=${(e) => setEdit(e.currentTarget.value)}></textarea>` : main;
    small = edit != null ? L('уйдёт ровно этот текст', 'exactly this text goes') : dr.tr ? dr.text : dr.reason;
    const send = (action, text) => sendLater(x.id, action === 'send' ? L(`Отправляю: ${firstName(name)}`, `Sending to ${firstName(name)}`) : L('Не отправляю', 'Not sending'), () => api('/app/api/draft', { draft_id: dr.id, action, text }));
    acts = edit != null
      ? html`<button class="btn accent" disabled=${!edit.trim()} onClick=${() => send('send', edit.trim())}>${L('Отправить', 'Send')}</button><button class="btn surface" onClick=${() => setEdit(null)}>${t('cancel')}</button>`
      : html`<button class="btn accent" data-key="1" onClick=${() => send('send')}>${L('Отправить', 'Send')}</button><button class="btn surface" data-key="2" onClick=${() => setEdit(dr.text)}>${L('Поправить', 'Edit')}</button>
        ${dr.kind === 'negotiate' ? html`<button class="btn surface wide" data-key="3" onClick=${() => { send('skip'); instruct(L('Торгуйся ещё', 'Bargain more'), 'negotiate', dr.listing_id).catch(() => null); }}>${L('Торгуйся ещё', 'Bargain more')}</button>` : html`<button class="dk-x" data-key="3" aria-label=${L('Не отправлять', 'Skip')} title=${L('Не отправлять', 'Skip')} onClick=${() => send('skip')}><${Icon} n="x" cls="sm" /></button>`}`;
  } else if (x.kind === 'viewing') {
    const v = x.v;
    stub = html`<b class="s">${fmtTime(v.starts_at)}</b><span>${dayKey(v.starts_at) === hmToday() ? L('сегодня', 'today') : wdShort(v.starts_at) + ' ' + fmtDM(v.starts_at)}</span>${n && html`<i>${n}</i>`}`;
    to = shortTitle(v.title);
    q = L('Идём смотреть?', 'Shall we go and see it?');
    small = v.meet_note || districtName(v);
    const yes = (text, kind, label) => sendLater(x.id, label, () => instruct(text, kind, v.id));
    acts = html`<button class="btn accent" data-key="1" onClick=${() => yes(L('Подтверди просмотр, мы придём', 'Confirm the viewing, we will come'), 'viewing_yes', L('Подтверждаю', 'Confirming'))}>${L('Идём', 'Yes')}</button>
      <button class="btn surface" data-key="2" onClick=${() => yes(L('Попроси другое время для просмотра', 'Ask for another time'), 'viewing_other', L('Прошу другое время', 'Asking for another time'))}>${L('Другое время', 'Another time')}</button>`;
  } else if (x.kind === 'power') {
    stub = html`<b>${x.n}</b><span>${L(pl(x.n, 'день света', 'дня света', 'дней света'), pl(x.n, 'day of power', 'days of power'))}</span>${n && html`<i>${n}</i>`}`;
    to = L('в чат дома', 'to the house chat');
    q = L('Напомнить про токен на свет?', 'Remind about the power token?');
    small = d.power?.per_day_cost ? money(d.power.per_day_cost, d.power.currency) : '';
    acts = html`<button class="btn accent" data-key="1" onClick=${() => sendLater(x.id, L('Напоминаю', 'Reminding'), () => instruct(L('Напомни в чате дома купить токен на свет', 'Remind the house chat to buy a power token'), 'power_remind'))}>${L('Напомнить', 'Remind')}</button><button class="btn surface" data-key="2" onClick=${() => { later.set(x.id, 24); go(sp('power')); }}>${L('Куплю сам', 'I will buy it')}</button>`;
  } else if (x.kind === 'pay') {
    const k = hmDays(x.pay.date);
    stub = html`<b class="s">${fmtDM(x.pay.date)}</b><span>${k < 0 ? L('просрочен', 'overdue') : k === 0 ? L('сегодня', 'today') : L(`через ${k} ${pl(k, 'день', 'дня', 'дней')}`, `in ${k} days`)}</span>${n && html`<i>${n}</i>`}`;
    to = L('платёж по договору', 'lease payment');
    q = [x.pay.title, x.pay.amount != null ? money(x.pay.amount, x.pay.currency) : null].filter(Boolean).join(', ');
    small = x.pay.note ?? '';
    acts = html`<button class="btn accent" data-key="1" onClick=${() => go(sp('docs'))}>${L('Открыть', 'Open')}</button>`;
  } else {
    stub = html`<b><${Icon} n="calendar-clock" /></b>${n && html`<i>${n}</i>`}`;
    to = L('договор кончается', 'the lease ends');
    q = L('Что дальше: остаёмся или ищем?', 'What next: stay or search?');
    acts = html`<button class="btn accent" data-key="1" onClick=${() => go(sp('next'))}>${L('Решить', 'Decide')}</button>`;
  }
  return html`<div class=${'dk-tkw' + (up ? ' up' : '')}><section key=${x.id} class=${'dk-tk' + (up ? ' up' : '')} aria-label=${L('Решение', 'Decision')}>
    <div class="dk-stub">${stub}</div>
    <div class="dk-tk-in"><div class="dk-tk-h"><span class="grow ellipsis">${to}</span><button class="dk-later" onClick=${() => { hap.sel(); later.set(x.id); }}>${L('Позже', 'Later')}</button></div>
      <div class="dk-q">${q}</div>${small && html`<p class="dk-small">${small}</p>`}
      <div class="dk-acts">${acts}</div></div>
  </section><${SentStrip} /></div>`;
}

// ---------------------------------------------------------------- Hunt, the device
function HuntMark() { return html`<span class="dk-h" aria-hidden="true">h</span>`; }
function Ask({ ph }) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEffect(() => { const f = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ref.current?.focus(); } }; addEventListener('keydown', f); return () => removeEventListener('keydown', f); }, []);
  if (!canVoteRole(D().me.role) || D().path?.closed) return null;
  const send = async (e) => {
    e.preventDefault();
    const s = v.trim();
    if (!s || busy) return;
    setBusy(true);
    try { await instruct(s); setV(''); toast(L('Передал Ханту', 'Hunt has it')); } catch { toast(t('err_generic')); }
    setBusy(false);
  };
  return html`<form class="dk-ask" onSubmit=${send}><input ref=${ref} value=${v} maxlength="1000" placeholder=${ph ?? L('Скажи, что сделать', 'Say what to do')} aria-label=${L('Сказать Ханту', 'Tell Hunt')} onInput=${(e) => setV(e.currentTarget.value)} /><button aria-label=${L('Отправить', 'Send')} disabled=${!v.trim() || busy}><${Icon} n="arrow-up" /></button></form>`;
}
function Device({ desk, title, sub, children, log = true, ph }) {
  const lg = deskLog(desk).slice(0, 5), nx = nextLines();
  return html`<aside class="dk-dev" aria-label="Hunt">
    <header class="dk-dev-h"><${HuntMark} /><div class="grow"><b>Hunt</b><span><i class=${desk?.agent_seen_at && Date.now() - Date.parse(desk.agent_seen_at) < 40 * 60e3 ? 'on' : ''}></i>${agoWord(desk?.agent_seen_at ?? D().agent_last_seen)}</span></div>
      <button class="dk-dev-m" aria-label=${t('settings_btn')} onClick=${() => openSheet('settings')}><${Icon} n="menu" cls="sm" /></button></header>
    <div class="dk-dev-b">
      ${title && html`<h2>${title}</h2>`}${sub && html`<p class="dk-dev-s">${sub}</p>`}
      ${children}
      ${log && html`<div class="dk-log">${lg.length > 0 && html`<h3>${L('Сделал', 'Done')}</h3>${lg.map((x) => html`<div key=${x.at + x.s}><time>${whenShort(x.at)}</time><span>${x.s}</span></div>`)}`}
        ${nx.length > 0 && html`<h3>${L('Дальше', 'Next')}</h3>${nx.map((x) => html`<div key=${x.at + x.s}><time>${whenShort(x.at)}</time><span>${x.s}</span></div>`)}`}
        ${!lg.length && !nx.length && html`<p class="dk-dev-s">${L('Пока тихо. Напиши, что нужно: найти, узнать, записать.', 'Quiet so far. Tell me what you need: find, ask, book.')}</p>`}</div>`}
    </div>
    <${Ask} ph=${ph} />
  </aside>`;
}
/** Hunt folded into a pill (the right zone belongs to a house or an event); the ticket comes out of it. */
function HuntPill({ desk, n }) {
  return html`<div class="dk-pill"><${HuntMark} /><div class="grow"><b>Hunt</b><span>${deskLog(desk)[0]?.s ?? agoWord(desk?.agent_seen_at)}</span></div>${n > 0 && html`<i>${n}</i>`}</div>`;
}

// ---------------------------------------------------------------- the rail
function Rail({ screen }) {
  const d = D(), s = d.search, home = homeMode();
  const items = demoOn
    ? [['today', 'house', L('Дом', 'Home')], ['money', 'wallet', L('Деньги', 'Money')], ['afisha', 'ticket', L('Афиша', 'Events')], ['shop', 'shopping-basket', L('Заказы', 'Orders')], ['docs', 'file-text', L('Документы', 'Documents')], ['listings', 'map', L('Поиск', 'Search')], ['chats', 'msgs', L('Переписка', 'Chats')], ['plan', 'calendar', L('План', 'Plan')]].filter(([k]) => (home ? !['listings', 'chats', 'plan'].includes(k) : ['listings', 'chats', 'plan', 'docs'].includes(k) && k !== 'docs'))
    : home
    ? [['today', 'house', L('Дом', 'Home')], ['chats', 'msgs', L('Переписка', 'Chats')], ['money', 'wallet', L('Деньги', 'Money')], ['afisha', 'ticket', L('Афиша', 'Events')], ['shop', 'shopping-basket', L('Заказы', 'Orders')], ['docs', 'file-text', L('Документы', 'Documents')], ['more', 'layout-grid', L('Ещё', 'More')]]
    : [['today', 'sun', L('Сегодня', 'Today')], ['listings', 'map', L('Поиск', 'Search')], ['chats', 'msgs', L('Переписка', 'Chats')], ['plan', 'calendar', L('План', 'Plan')], ['money', 'wallet', L('Деньги', 'Money')], ['docs', 'file-text', L('Документы', 'Documents')], ['more', 'layout-grid', L('Ещё', 'More')]];
  const MAP = { home: 'today', listing: home ? 'more' : 'listings', deck: 'listings', compare: 'listings', map: home ? 'more' : 'listings', approve: 'chats', contact: 'chats', event: 'afisha', party: 'afisha', good: 'shop', basket: 'shop', 'order-check': 'shop', order: 'shop', orders: 'shop', deal: 'docs', doc: 'docs', split: 'money' };
  const cur = items.some(([k]) => k === screen) ? screen : MAP[screen] ?? 'more';
  const wait = waitingUs();
  const badge = { chats: wait || (d.drafts ?? []).length, listings: 0 };
  const where = home ? hmName() : shortTitle(s.title);
  return html`<nav class="dk-rail" aria-label="Hunt">
    <span class="dk-logo">hunt</span>
    <button class="dk-where" aria-haspopup="dialog" onClick=${() => openSheet('switch')}><b class="ellipsis">${where}</b><${Icon} n="chevd" cls="xs" /></button>
    ${demoOn && html`<button class="dk-demo-x" onClick=${demoStop}>${L('Демо, выйти', 'Demo, leave')}</button>`}
    <span class="dk-mode"><i class=${home ? 'full' : ''}></i>${d.path?.closed ? L('архив', 'archive') : home ? L('живём', 'living') : L('ищем', 'searching')}</span>
    <div class="dk-items">${items.map(([k, ic, label]) => html`<a key=${k} href=${'#' + sp(k)} aria-current=${cur === k ? 'page' : null} onClick=${(e) => { e.preventDefault(); hap.sel(); go(sp(k), true); }}><${Icon} n=${ic} /><span>${label}</span>${badge[k] > 0 && html`<i aria-label=${L('ждут тебя', 'waiting for you')}>${badge[k]}</i>`}</a>`)}</div>
    <div class="dk-who">${d.members.slice(0, 4).map((m) => html`<${Av} key=${m.user_id} m=${m} size=${46} free />`)}</div>
    ${canVoteRole(d.me.role) && s.invite_link && html`<button class="btn surface sm dk-inv" onClick=${() => inviteFriends(s)}><${Icon} n="userplus" cls="sm" /><span>${L('Позвать', 'Invite')}</span></button>`}
  </nav>`;
}

// ---------------------------------------------------------------- Home
function DeskHome({ desk }) {
  const d = D(), l = homeListing(), ph = photosOf(l)[0], phase = homePhase(), today = hmToday(), night = nightMode() || isDark();
  const sv = useSurf(d.search.id, phase !== 'closed' && (briefMentionsSurf() || !!d.me.surf));
  const ep = useEventPlan();
  const ord = useOrders();
  const b = phase !== 'closed' ? surfBest(sv) : null;
  const { from, to } = hmStay();
  const total = from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 864e5) : null;
  const day = from ? Math.max(1, 1 - hmDays(from)) : null;
  const pay = (d.dates ?? []).filter((x) => !x.done && x.kind === 'payment' && x.date >= today).sort((a, c) => a.date.localeCompare(c.date))[0];
  const act = (ord.v?.active ?? [])[0];
  const lines = [
    b && b.height != null ? (b.window?.to ? L(`Волна ${sfH(b.height)}, лучше до ${hm(b.window.to)}`, `Waves ${sfH(b.height)}, best until ${hm(b.window.to)}`) : null) : null,
    ep?.top ? L(`Вечером ${afTitle(ep.top).toLowerCase()}`, `Tonight: ${afTitle(ep.top)}`) : null,
    phase === 'before' && hmDays(from) > 0 ? L(`Заезжаем через ${hmDays(from)} ${pl(hmDays(from), 'день', 'дня', 'дней')}`, `Moving in in ${hmDays(from)} days`) : null,
    hmName(),
  ].filter(Boolean).slice(0, 2);
  const rows = [
    ...(ep?.bookings ?? []).filter((x) => x.status !== 'cancelled' && x.occ >= today).map((x) => ({ k: 'e' + x.id, at: x.starts_at ?? x.occ, title: x.title, sub: t('af_st_' + x.status), go: sp('event', x.event_id + '@' + x.occ), who: x.guests })),
    ...(d.dates ?? []).filter((x) => !x.done && x.date >= today && hmDays(x.date) <= 45).map((x) => ({ k: 'dt' + x.date + x.title, at: x.date, title: x.title, sub: x.amount != null ? money(x.amount, x.currency) : x.note, go: sp('docs') })),
    ...(d.issues ?? []).filter((x) => x.status !== 'fixed').map((x) => ({ k: 'is' + x.id, at: x.scheduled_at ?? null, title: x.title, sub: x.status === 'scheduled' ? L('мастер придёт', 'someone is coming') : L('ждём ответа хозяина', 'waiting for the owner'), go: sp('home') })),
    ...(d.guests ?? []).filter((g) => g.status === 'active' && hmDays(g.to) >= 0).map((g) => ({ k: 'g' + g.user_id, at: hmDays(g.from) > 0 ? g.from : today, title: hmDays(g.from) > 0 ? L(`Приезжает ${firstName(g.name)}`, `${firstName(g.name)} arrives`) : L(`${firstName(g.name)} в гостях`, `${firstName(g.name)} is staying`), sub: L(`до ${fmtDM(g.to)}`, `until ${fmtDM(g.to)}`), go: sp('guests'), m: g })),
    ...(act ? [{ k: 'or', at: act.day ? act.day + 'T' + (act.time ?? '12:00') : null, title: L(`Заказ: ${act.supplier}`, `Order: ${act.supplier}`), sub: act.status === 'confirmed' ? L('подтвердили', 'confirmed') : L('отправлен', 'sent'), go: sp('order', act.id) }] : []),
    ...(d.bikes ?? []).filter((x) => x.status !== 'returned' && x.paid_until && hmDays(x.paid_until) <= 7).map((x) => ({ k: 'bk' + x.id, at: x.paid_until, title: L('Продлить байк', 'Extend the bike'), sub: x.model, go: sp('bikes') })),
  ].sort((x, y) => String(x.at ?? '9').localeCompare(String(y.at ?? '9'))).slice(0, 6);
  const cur = d.money?.currency ?? 'IDR', bal = d.money?.balances?.[cur]?.transfers ?? [], mine = bal.find((x) => x.from === d.user.id || x.to === d.user.id) ?? bal[0];
  const balText = !mine ? L('все в расчёте', 'all square') : mine.to === d.user.id ? L(`${firstName(memberById(mine.from)?.name)}: тебе ${money(mine.amount, cur)}`, `${firstName(memberById(mine.from)?.name)} owes you ${money(mine.amount, cur)}`) : mine.from === d.user.id ? L(`ты: ${firstName(memberById(mine.to)?.name)} ${money(mine.amount, cur)}`, `you owe ${money(mine.amount, cur)}`) : money(mine.amount, cur);
  const facts = [
    pay && [L('платёж ', 'payment ') + fmtDM(pay.date), pay.amount != null ? money(pay.amount, pay.currency) : pay.title, 'docs'],
    d.money?.totals?.this_month ? [L('потратили за месяц', 'spent this month'), money(d.money.totals.this_month, cur), 'money'] : null,
    d.money?.mode !== 'shared' && (d.money?.expenses ?? []).length ? [L('между вами', 'between you'), balText, 'money'] : null,
    d.power?.days_left != null && !decisions().some((x) => x.kind === 'power') ? [L('свет', 'power'), L(`на ${Math.floor(d.power.days_left)} ${pl(Math.floor(d.power.days_left), 'день', 'дня', 'дней')}`, `${Math.floor(d.power.days_left)} days`), 'power'] : null,
    [L('этап', 'stage'), `${Math.min(homeStage().idx, homeStage().n)} ${L('из', 'of')} ${homeStage().n}`, 'path'],
  ].filter(Boolean).slice(0, 4);
  return html`<div class="dk-main dk-home">
    <section class="dk-l">
      <${Typed} as="h1" lines=${lines.length ? lines : [hmName()]} cls="dk-say" />
      <div class="dk-hero" style=${`--n:${(night ? L(4.2, 5) : L(3.4, 4.6))}`}><${BigWord} text=${night ? L('Ночь', 'Night') : L('Дом', 'Home')} /><div class="dk-ph">
        <${FloatPhoto} src=${ph} cls="dk-photo" label=${hmName()} tilt=${-2.4} onClick=${() => l && go(sp('listing', l.id))} />
        ${day != null && total && phase === 'living' && html`<${Sticker} text=${L(`день ${Math.min(day, total)} из ${total}`, `day ${Math.min(day, total)} of ${total}`)} cls="lg white" style="right:-3%;top:2%;--r:9deg" />`}
        ${b && b.height != null && html`<${WaterCard} cls="water-dot dk-surf" label=${t('sf_title')} onClick=${() => go(sp('surf'))}><b>${sfH(b.height)}</b><small>${b.name}</small><//>`}
        <div class="dk-toys">${d.members.slice(0, 3).map((m) => html`<${Av} key=${m.user_id} m=${m} size=${104} free />`)}</div>
      </div></div>
    </section>
    <section class="dk-r">
      <header class="dk-h2"><h2>${L('Ближайшее', 'Coming up')}</h2><span>${cap(dfmt(today, { weekday: 'short', day: 'numeric', month: 'long' }))}</span></header>
      <div class="dk-rows">${rows.map((r) => html`<button key=${r.k} class="dk-row" onClick=${() => go(r.go)}><time>${r.at ? (String(r.at).length > 10 && dayKey(r.at) === today ? fmtTime(r.at) : hmDays(dayKey(r.at)) === 0 ? L('сегодня', 'today') : wdShort(r.at).toLowerCase() + ' ' + Number(String(r.at).slice(8, 10))) : L('скоро', 'soon')}</time><span class="grow"><b class="ellipsis">${r.title}</b>${r.sub && html`<small class="ellipsis">${r.sub}</small>`}</span>${r.m && html`<${Av} m=${r.m} size=${30} />`}</button>`)}
        ${!rows.length && html`<p class="dk-none">${L('Ничего срочного. Можно на пляж.', 'Nothing urgent.')}</p>`}</div>
      <${Ticket} empty=${rows.length > 4 ? null : L('Решений нет. Hunt позовёт.', 'No decisions. Hunt will call.')} />
    </section>
    <footer class="dk-facts">${facts.map(([k, v, g]) => html`<button key=${k} onClick=${() => go(sp(g))}><span>${k}</span><b>${v}</b></button>`)}</footer>
    <div class="dk-pills">
      ${canVoteRole(d.me.role) && html`<button class="btn soft" onClick=${() => openSheet('add_expense')}><${Icon} n="plus" cls="sm" />${L('Добавить трату', 'Add expense')}</button>`}
      <button class="btn surface" onClick=${() => go(sp('shop'))}>${L('Заказать еду', 'Order food')}</button>
      <button class="btn surface" onClick=${() => go(sp('afisha'))}>${L('Что сегодня вечером', 'What is on tonight')}</button>
      ${phase === 'before' && d.deal && html`<button class="btn surface" onClick=${() => go(sp('deal'))}>${t('before_move')}</button>`}
      ${canVoteRole(d.me.role) && phase === 'living' && html`<button class="btn surface" onClick=${() => go(sp('home'))}>${L('Что-то сломалось', 'Something broke')}</button>`}
    </div>
  </div>`;
}
function HomeDevice({ desk }) {
  const ord = useOrders();
  const a = (ord.v?.active ?? [])[0];
  return html`<${Device} desk=${desk} title=${a ? L(`${a.supplier}: ${a.status === 'confirmed' ? 'везут' : 'ждём ответ'}`, `${a.supplier}: ${a.status === 'confirmed' ? 'on the way' : 'waiting'}`) : decisions().length ? L('Нужно твоё да', 'I need your yes') : L('Всё под присмотром', 'All looked after')}
    sub=${a ? [a.time ? hm(a.time) : null, a.total_est ? ordMoney(a.total_est, a.currency) : null].filter(Boolean).join(', ') : null}>${a && html`<button class="dk-scooter" onClick=${() => go(sp('order', a.id))} aria-label=${L('Открыть заказ', 'Open the order')}><${Good} slug="scooter" size=${210} big rot=${-3} /></button>`}<//>`;
}

// ---------------------------------------------------------------- Chats
const thCache = {};
function useThread(cid) {
  const sid = D().search.id, key = sid + cid;
  const [v, setV] = useState(thCache[key] ?? null);
  useEffect(() => {
    let live = true;
    setV(thCache[key] ?? null);
    const get = () => cid && api(`/app/api/thread?s=${encodeURIComponent(sid)}&c=${encodeURIComponent(cid)}`).then((j) => { thCache[key] = j; live && setV(j); }).catch(() => live && setV((x) => x ?? { failed: true }));
    get();
    const tm = setInterval(() => !document.hidden && get(), 30e3);
    return () => { live = false; clearInterval(tm); };
  }, [key, D().drafts?.length]);
  return v;
}
const thHome = (th) => { const l = listingById(th.listing_id); return l ? shortTitle(l.title) : contactName(th); };
const ARCH_NO = () => L('Не ответили', 'No answer');
function thGroups(q, arch) {
  const has = (th) => !q || [thHome(th), contactName(th), th.last, th.known].some((x) => String(x ?? '').toLowerCase().includes(q));
  const dr0 = new Set((D().drafts ?? []).map((x) => x.contact_id));
  if (arch) {
    // the search archive: who wrote after the move, homes we turned down, homes that never answered
    const a = [[L('Написали после заезда', 'Wrote after the move'), []], [L('Отказались', 'Turned down'), []], [ARCH_NO(), []]];
    for (const th of archThreads().filter(has)) a[th.state === 'waiting_us' || dr0.has(th.contact_id) ? 0 : th.state === 'waiting_them' ? 2 : 1][1].push(th);
    return a.filter(([, x]) => x.length);
  }
  if (homeMode()) {
    const h = [[L('Ждут тебя', 'Waiting for you'), []], [L('Дом', 'Home'), []]];
    for (const th of homeThreads().filter(has)) h[th.state === 'waiting_us' || dr0.has(th.contact_id) ? 0 : 1][1].push(th);
    return h.filter(([, x]) => x.length);
  }
  const list = sortedThreads().filter(has), g = [[L('Ждут тебя', 'Waiting for you'), []], [L('Торг', 'Bargaining'), []], [L('Ждём', 'We wait'), []], [L('Закрыто', 'Closed'), []]];
  const dr = new Set((D().drafts ?? []).map((x) => x.contact_id));
  for (const th of list) {
    const l = listingById(th.listing_id);
    g[th.state === 'closed' ? 3 : th.state === 'waiting_us' || dr.has(th.contact_id) ? 0 : l && ['want_view', 'take'].includes(l.decision) ? 1 : 2][1].push(th);
  }
  return g.filter(([, x]) => x.length);
}
function DeskChats({ arg }) {
  const [q, setQ] = useState('');
  const [openC, setOpenC] = useState(false);
  const all = D().threads ?? [];
  // the archive list stays on the left while an archived chat is open
  const arch = arg === 'archive' || thArchived(all.find((x) => x.contact_id === arg));
  const groups = thGroups(q.trim().toLowerCase(), arch);
  const flat = groups.flatMap(([, x]) => x);
  const cid = (arg === 'archive' ? null : arg) ?? flat[0]?.contact_id ?? null;
  const th = all.find((x) => x.contact_id === cid);
  const home = homeMode() && !arch, nArch = home ? archThreads().length : 0, nNew = nArch ? archNew() : 0;
  useEffect(() => {
    const f = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || /input|textarea|select/i.test(e.target.tagName)) return;
      const i = flat.findIndex((x) => x.contact_id === cid);
      if ((e.key === 'j' || e.key === 'о') && flat[i + 1]) go(sp('chats', flat[i + 1].contact_id), true);
      if ((e.key === 'k' || e.key === 'л') && flat[i - 1]) go(sp('chats', flat[i - 1].contact_id), true);
    };
    addEventListener('keydown', f);
    return () => removeEventListener('keydown', f);
  });
  return html`<div class="dk-main dk-chats">
    <section class="dk-list"><header class="dk-h2">${arch && html`<button class="round sm" aria-label=${L('Назад', 'Back')} onClick=${() => go(sp('chats'), true)}><${Icon} n="left" /></button>`}<h1>${arch ? L('Архив поиска', 'Search archive') : L('Переписка', 'Chats')}</h1></header>
      ${arch && html`<p class="dk-arch-note">${L('Дома, с которыми переписывались до заезда. Только почитать', 'Homes you wrote to before moving in. Read only')}</p>`}
      <label class="dk-search"><${Icon} n="search" cls="sm" /><input type="search" value=${q} placeholder=${L('Дом, имя, слово', 'Home, name, word')} aria-label=${L('Искать в переписке', 'Search chats')} onInput=${(e) => setQ(e.currentTarget.value)} /></label>
      <div class="dk-scroll">${groups.map(([name, list], gi) => { const closed = name === L('Закрыто', 'Closed') || (arch && name === ARCH_NO()); const shown = closed && !openC && !q ? [] : list; return html`<section key=${gi}>
        <h3>${closed ? html`<button onClick=${() => setOpenC(!openC)} aria-expanded=${openC ? 'true' : 'false'}>${name} <i>${list.length}</i><${Icon} n="chevd" cls="xs" /></button>` : html`${name} <i>${list.length}</i>`}</h3>
        ${shown.map((x) => { const l = listingById(x.listing_id), r = home ? homeRow(x) : null, ph = r ? r.photo : photosOf(l)[0]; return html`<a key=${x.contact_id} class="dk-th" href=${'#' + sp('chats', x.contact_id)} aria-current=${x.contact_id === cid ? 'true' : null} onClick=${(e) => { e.preventDefault(); hap.sel(); go(sp('chats', x.contact_id), true); }}>
          ${r && !ph ? html`<span class="dk-role"><${Icon} n=${r.icon} /></span>` : html`<${Img} src=${ph} />`}<span class="grow"><b class="ellipsis">${r ? r.title : thHome(x)}</b><small class="ellipsis">${r ? r.sub : [l ? firstName(contactName(x)) : null, channelName(channelsOf(x.contact_id)[0]?.channel)].filter(Boolean).join(', ')}</small></span>
          <span class="dk-th-r"><time>${x.last_at ? whenShort(x.last_at) : ''}</time>${!home && l?.price ? html`<b>${prc(l)}</b>` : null}</span></a>`; })}</section>`; })}
        ${!flat.length && html`<p class="dk-none">${q ? L('Ничего не нашлось', 'Nothing found') : arch ? L('Архив пуст', 'The archive is empty') : t('no_threads')}</p>`}</div>
      ${nArch > 0 && html`<a class="dk-th dk-arch" href=${'#' + sp('chats', 'archive')} onClick=${(e) => { e.preventDefault(); hap.sel(); go(sp('chats', 'archive'), true); }}>
        <span class="dk-role"><${Icon} n="archive" /></span><span class="grow"><b class="ellipsis">${L('Архив поиска', 'Search archive')}</b><small class="ellipsis">${L(`${nArch} ${pl(nArch, 'переписка', 'переписки', 'переписок')}, только почитать`, `${nArch} ${nArch === 1 ? 'chat' : 'chats'}, read only`)}</small></span>
        ${nNew > 0 && html`<span class="dk-new">${L(`${nNew} новое`, `${nNew} new`)}</span>`}</a>`}
    </section>
    ${th ? html`<${Thread} key=${cid} th=${th} />` : html`<section class="dk-thread"><p class="dk-none">${L('Hunt пока никому не писал.', 'Hunt has not written to anyone yet.')}</p></section>`}
  </div>`;
}
function Thread({ th }) {
  const d = D(), v = useThread(th.contact_id), l = listingById(th.listing_id), feed = useRef(null);
  const owner = d.me.role === 'owner', arch = thArchived(th), hr = homeMode() && !arch ? homeRow(th) : null;
  const [say, setSay] = useState(null);
  const [asIs, setAsIs] = useState(false);
  const items = useMemo(() => [...(v?.messages ?? []).map((m) => ({ ...m, m: 1 })), ...(v?.acts ?? []).map((a) => ({ ...a, act: 1 }))].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)), [v]);
  useEffect(() => { const el = feed.current; if (el) el.scrollTop = el.scrollHeight; }, [items.length, v?.drafts?.length]);
  const act = (a) => (a.kind === 'checks' ? L('Hunt проверил дом', 'Hunt checked the home') : a.kind === 'viewing_changed' ? L(`Просмотр: ${a.data?.starts_at ? fmtDM(a.data.starts_at) + ' ' + fmtTime(a.data.starts_at) : a.data?.status ?? ''}`, 'Viewing updated') : L('Даты договора обновлены', 'Lease dates updated'));
  const post = async () => {
    const text = say.trim();
    if (!text) return;
    const c = th.contact_id;
    setSay(null);
    sendLater('say' + c + Date.now(), asIs ? L(`Отправляю: ${firstName(contactName(th))}`, `Sending to ${firstName(contactName(th))}`) : L('Отдаю Ханту перевести', 'Hunt will translate'), () => api('/app/api/say', { search_id: d.search.id, contact_id: c, text, as_is: asIs }));
  };
  const asked = l?.price;
  const wasAsked = owner ? d.deal?.asked?.price ?? null : null;
  let lastDay = null;
  return html`<section class="dk-thread">
    <header class="dk-th-h">${hr && !hr.photo ? html`<span class="dk-role dk-role-lg"><${Icon} n=${hr.icon} /></span>` : html`<button class="frame sm" onClick=${() => l && go(sp('listing', l.id))} aria-label=${thHome(th)}><span class="in"><${Img} src=${photosOf(l)[0]} /></span></button>`}
      <button class="grow dk-th-n" onClick=${() => go(sp('contact', th.contact_id))}><h2 class="ellipsis">${hr ? hr.title : thHome(th)}</h2><span>${hr ? hr.sub : [contactName(th), channelName(channelsOf(th.contact_id)[0]?.channel)].filter(Boolean).join(', ')}</span></button>
      ${arch && html`<span class="dk-arch-chip"><${Icon} n="archive" cls="xs" />${L('архив', 'archive')}</span>`}
      ${!arch && wasAsked && asked && wasAsked !== asked && html`<span class="dk-was" aria-label=${L('просили', 'asked')}>${num(money(wasAsked, l.currency))}</span>`}
      ${asked && !arch && html`<b class="dk-price">${prc(l)}</b>`}</header>
    <div class="dk-feed" ref=${feed} tabindex="0" aria-label=${L('Сообщения', 'Messages')}>
      ${v == null ? skel(220) : v.failed ? msgCard(t('err_generic')) : items.length ? items.map((m) => { const dy = dayKey(m.at); const head = dy !== lastDay; lastDay = dy; return html`
        ${head && html`<p class="dk-day">${dy === hmToday() ? L('сегодня', 'today') : fmtDayMonth(m.at)}</p>`}
        ${m.act ? html`<p class="dk-did"><${HuntMark} />${act(m)}</p>` : m.direction === 'call_missed' ? html`<p class="dk-did"><${Icon} n="phone" cls="xs" />${L('пропущенный звонок', 'missed call')} ${fmtTime(m.at)}</p>` : html`<div class=${'dk-bub ' + (m.direction === 'out' ? 'out' : 'in')}><p>${m.tr || m.text || (m.media ? L(`вложений: ${m.media}`, `attachments: ${m.media}`) : '…')}</p>${m.tr && html`<small>${m.text}</small>`}<time>${fmtTime(m.at)}</time></div>`}`; })
        : html`<p class="dk-none">${th.last ?? L('Сообщений пока нет', 'No messages yet')}</p>`}
    </div>
    <${Ticket} ctx=${{ contact: th.contact_id }} />
    ${arch ? html`<div class="dk-own dk-locked"><span class="dk-role"><${Icon} n="lock" cls="sm" /></span><span>${L('Это архив поиска, писать отсюда нельзя. Ответить может Hunt, с твоим «да»', 'This is the search archive, no writing from here. Hunt can answer, with your yes')}</span></div>`
      : owner && !d.path?.closed && (say == null ? html`<div class="dk-own"><button class="btn surface" onClick=${() => setSay('')}><${Icon} n="pencil" cls="sm" />${L('Написать самому', 'Write yourself')}</button><span>${L('Hunt переведёт и покажет перед отправкой', 'Hunt translates and shows it before sending')}</span></div>`
      : html`<form class="dk-own edit" onSubmit=${(e) => { e.preventDefault(); post(); }}><textarea class="dk-edit" aria-label=${L('Твоё сообщение', 'Your message')} value=${say} onInput=${(e) => setSay(e.currentTarget.value)} onKeyDown=${(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); post(); } if (e.key === 'Escape') setSay(null); }}></textarea>
        <div class="dk-acts"><button class="btn accent" disabled=${!say.trim()}>${asIs ? L('Отправить как есть', 'Send as is') : L('Перевести', 'Translate')}</button><label class="dk-chk"><input type="checkbox" checked=${asIs} onChange=${(e) => setAsIs(e.currentTarget.checked)} />${L('без перевода', 'no translation')}</label><button type="button" class="btn ghost" onClick=${() => setSay(null)}>${t('cancel')}</button></div></form>`)}
  </section>`;
}
const ngC = {};
function ChatsDevice({ desk, arg }) {
  const d = D(), owner = d.me.role === 'owner';
  const cid = arg ?? thGroups('').flatMap(([, x]) => x)[0]?.contact_id;
  const th = (d.threads ?? []).find((x) => x.contact_id === cid), lid = th?.listing_id;
  const [n, setN] = useState(ngC[lid] ?? null);
  useEffect(() => { setN(ngC[lid] ?? null); if (owner && lid) api('/app/api/negotiation?listing_id=' + encodeURIComponent(lid)).then((j) => { ngC[lid] = j; setN(j); }).catch(() => null); }, [lid]);
  const open = String(th?.open ?? '').split(/[;\n•]|(?<=[?])\s/).map((s) => s.trim().replace(/^[-–]\s*/, '')).filter(Boolean).slice(0, 5);
  const cur = listingById(lid)?.currency;
  const marks = n ? [['ask', L('просят', 'asked'), n.asked ?? listingById(lid)?.price], ['med', L('медиана', 'median'), n.market?.median], ['offer', L('предложим', 'our offer'), n.offer?.price], ['cap', L('твой потолок', 'your limit'), d.search.brief?.budget_cap ?? null]].filter(([, , x]) => x > 0).reduce((a, m) => { const same = a.find((y) => Math.abs(y[2] - m[2]) < m[2] * 0.012); if (same && m[0] !== 'cap') same[1] += ', ' + m[1]; else a.push([...m]); return a; }, []) : [];
  const lo = Math.min(...marks.map((m) => m[2])), hi = Math.max(...marks.map((m) => m[2]));
  return html`<${Device} desk=${desk} title=${th ? (decisions({ contact: cid }).length ? L('Ответ готов', 'The answer is ready') : th.state === 'waiting_them' ? L('Ждём ответ', 'Waiting for an answer') : th.state === 'closed' ? L('Разговор закрыт', 'Closed') : L('Читаю переписку', 'Reading the chat')) : L('Пока тихо', 'Quiet')} sub=${th?.known ? String(th.known).split(/[;\n]/)[0] : null} log=${!th} ph=${L('Скажи Hunt, как ответить', 'Tell Hunt how to answer')}>
    ${marks.length > 1 && html`<div class="dk-scale" role="img" aria-label=${marks.map((m) => `${m[1]} ${money(m[2], cur)}`).join(', ')}>${marks.map(([k, nm, x]) => html`<div key=${k} class=${'m-' + k} style=${`top:${hi > lo ? Math.round((1 - (x - lo) / (hi - lo)) * 100) : 50}%`}><span>${nm}${k === 'cap' ? html`<${Icon} n="lock" cls="xs" />` : ''}</span><b>${money(x, cur)}</b></div>`)}</div>`}
    ${marks.some((m) => m[0] === 'cap') && html`<p class="dk-dev-s">${L('потолок видишь только ты', 'only you see the limit')}</p>`}
    ${open.length > 0 && html`<div class="dk-log q"><h3>${L('Ещё не знаем', 'Not known yet')}</h3>${open.map((s) => html`<div key=${s}><i class="o"></i><span>${s}</span></div>`)}</div>`}
    ${owner && lid && html`<button class="btn dk-inv2" onClick=${() => go(sp('nego', lid))}>${L('Доводы и цены рядом', 'Arguments and prices')}</button>`}
  <//>`;
}

// ---------------------------------------------------------------- Search
let seg = null;
const SEGS = () => {
  const d = D(), mine = new Set(d.votes.filter((v) => v.user_id === d.user.id).map((v) => v.listing_id));
  const alive = d.listings.filter((l) => !['rejected', 'taken', 'closed'].includes(l.status));
  return [['want', L('Хотим', 'Want'), alive.filter((l) => ['want_view', 'take'].includes(l.decision))], ['think', L('Думаем', 'Thinking'), alive.filter((l) => l.decision === 'thinking')], ['new', L('Новые', 'New'), alive.filter((l) => isNewForMe(l, mine))], ['all', L('Все', 'All'), alive.filter((l) => l.decision !== 'not_interested')]].filter(([k, , x]) => x.length || k === 'all');
};
function DeskSearch({ arg, desk }) {
  const d = D(), segs = SEGS();
  const pick = segs.find(([k]) => k === seg) ?? segs.find(([, , x]) => x.length) ?? segs[0];
  const list = pick[2];
  const known = arg && d.listings.some((l) => l.id === arg) ? arg : null;
  const sel = listingById(known) ?? list[0] ?? null;
  const n = list.length;
  const line = !d.listings.length ? L('Начал искать. Первые дома скоро', 'Started searching. First homes soon') : L(`${d.listings.length} ${pl(d.listings.length, 'дом', 'дома', 'домов')}, смотреть ${segs.find(([k]) => k === 'want')?.[2].length ?? 0}`, `${d.listings.length} homes, ${segs.find(([k]) => k === 'want')?.[2].length ?? 0} to see`);
  return html`<div class="dk-main dk-srch">
    <section class="dk-list"><${Typed} as="h1" lines=${[line]} cls="dk-say sm" />
      <div class="dk-chips" role="group">${segs.map(([k, name, x]) => html`<button key=${k} aria-pressed=${k === pick[0] ? 'true' : 'false'} onClick=${() => { hap.sel(); seg = k; emit(); }}>${name} ${x.length}</button>`)}</div>
      <div class="dk-scroll">${list.map((l) => html`<a key=${l.id} class="dk-lst" href=${'#' + sp('listings', l.id)} aria-current=${l.id === sel?.id ? 'true' : null} onClick=${(e) => { e.preventDefault(); hap.sel(); go(sp('listings', l.id), true); }}>
        <${Img} src=${photosOf(l)[0]} /><span class="grow"><b class="ellipsis">${shortTitle(l.title)}</b><small class="ellipsis">${[l.bedrooms != null ? t('br', { n: l.bedrooms }) : null, districtShort(l)].filter(Boolean).join(', ')}</small><span class="dk-lst-p"><b>${priceText(l)}</b><span class="grow"></span>${votesFor(l.id).slice(0, 3).map((v) => html`<${Av} key=${v.user_id} m=${memberById(v.user_id)} size=${31} badge=${v.decision} />`)}</span></span></a>`)}
        ${!n && html`<p class="dk-none">${L('Здесь пусто. Hunt собирает дома каждый день.', 'Empty here. Hunt collects homes every day.')}</p>`}</div>
      <div class="dk-links"><button onClick=${() => go(sp('deck'))}>${L('Смотреть по одному', 'One by one')}</button><button onClick=${() => go(sp('compare'))}>${L('Сравнить', 'Compare')}</button><button onClick=${() => go(sp('brief'))}>${L('Что ищем', 'The brief')}</button></div>
    </section>
    <${Land} list=${list} sel=${sel} />
    <${House} l=${sel} desk=${desk} />
  </div>`;
}
/** The map: the toy land of the place when the pack has one that fits, else MapLibre painted as a sea of the screen colour. */
const islands = {};
function useIsland() {
  const s = D().search, sub = String(s.region).split('/')[1], names = (S.regions?.[s.country]?.islands ?? []);
  const name = names.includes(sub) ? sub : names.includes('') && !sub ? '' : null;
  const key = name == null ? null : demoOn ? `/demo-home/island-${name}` : `/art/${s.country}/island${name ? '-' + name : ''}`;
  const [v, setV] = useState(islands[key] ?? null);
  useEffect(() => { if (!key) { setV(null); return; } if (islands[key]) { setV(islands[key]); return; } fetch(key + '.json').then((r) => r.json()).then((j) => { islands[key] = { ...j, src: key + '.webp' }; setV(islands[key]); }).catch(() => null); }, [key]);
  return v;
}
/** v2 city map: district borders as live light walls over the picture (a 2D canvas, no WebGL): a glowing white line on the ground for
 * contrast, a turquoise-white wall fading upwards, scan bands, a light running along each border and a slow shimmer. Paused off-screen and
 * in a hidden tab; one still frame under reduced motion. */
function Walls({ isl }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !isl?.walls?.lines?.length) return undefined;
    const ctx = cv.getContext('2d'), still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lines = isl.walls.lines.map((l) => { let d = 0; return l.map((p, i) => { if (i) d += Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1]); return [p[0], p[1], d]; }); });
    let raf = 0, seen = true, dpr = 1;
    const size = () => { const r = cv.getBoundingClientRect(); dpr = Math.min(2, devicePixelRatio || 1); cv.width = Math.max(1, r.width * dpr); cv.height = Math.max(1, r.height * dpr); };
    const draw = (t) => {
      const k = cv.width / isl.width, H = isl.walls.h * k * 0.32;   // low: a hint of a wall, the border is what matters
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.globalCompositeOperation = 'source-over';
      for (const l of lines) {
        const len = l[l.length - 1][2], run = ((t * 90) % (len + 600)) - 300;   // where the running light is
        for (let i = 1; i < l.length; i++) {
          const [x0, y0, d0] = l[i - 1], [x1, y1] = l[i], ym = Math.min(y0, y1) * k;
          const sh = 0.5 + 0.5 * Math.sin(d0 * 0.018 - t * 1.4), hl = Math.max(0, 1 - Math.abs(d0 - run) / 90);
          const g = ctx.createLinearGradient(0, ym, 0, ym - H);
          g.addColorStop(0, `rgba(${190 + 65 * hl | 0},${244 + 11 * hl | 0},255,${0.6 + 0.2 * hl})`);
          g.addColorStop(0.35, `rgba(${140 + 80 * hl | 0},${226 + 20 * sh | 0},255,${0.16 + 0.08 * sh + 0.2 * hl})`);
          g.addColorStop(1, 'rgba(120,225,255,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x0 * k, y0 * k); ctx.lineTo(x1 * k, y1 * k); ctx.lineTo(x1 * k, y1 * k - H); ctx.lineTo(x0 * k, y0 * k - H); ctx.closePath(); ctx.fill();
        }
      }
      // scan bands moving up: cut thin stripes out of the walls only
      ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = 'rgba(0,0,0,.2)';
      const step = 3 * dpr, off = (t * 9 * dpr) % step;
      for (let y = cv.height - off; y > 0; y -= step) ctx.fillRect(0, y, cv.width, 1.4 * dpr);
      ctx.globalCompositeOperation = 'source-over'; ctx.lineJoin = ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(64,214,255,.8)'; ctx.shadowBlur = 5 * dpr;
      for (const l of lines) {   // a white line on the ground with a turquoise glow, a bright top edge
        ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 1.6 * dpr; ctx.beginPath(); l.forEach(([x, y], i) => (i ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, y * k))); ctx.stroke();
      }
      ctx.shadowBlur = 0;
      for (const l of lines) { ctx.strokeStyle = 'rgba(235,252,255,.55)'; ctx.lineWidth = 1 * dpr; ctx.beginPath(); l.forEach(([x, y], i) => (i ? ctx.lineTo(x * k, y * k - H) : ctx.moveTo(x * k, y * k - H))); ctx.stroke(); }
      ctx.shadowBlur = 0;
    };
    let lastT = 0;
    const loop = (now) => { raf = requestAnimationFrame(loop); if (!seen || document.hidden || now - lastT < 40) return; lastT = now; draw(now / 1000); };
    size(); draw(1.3);
    const ro = new ResizeObserver(() => { size(); draw(still ? 1.3 : performance.now() / 1000); }); ro.observe(cv);
    const io = new IntersectionObserver(([e]) => { seen = e.isIntersecting; }); io.observe(cv);
    if (!still) raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, [isl]);
  return html`<canvas ref=${ref} class="dk-walls" aria-hidden="true"></canvas>`;
}
function Land({ list, sel, stops = null, word = null, children }) {
  const d = D(), isl = useIsland();
  const pts = (stops ? stops.map((x) => ({ ...x.l, stop: x })) : list).filter((l) => l.lat != null && l.lng != null);
  // v2 (citymap.py): an orthographic 3D picture, lon/lat -> pixel is the affine map in the JSON; v1: a flat plan view
  const at = (l) => (isl.affine ? [isl.affine[0] * l.lng + isl.affine[1] * l.lat + isl.affine[2], isl.affine[3] * l.lng + isl.affine[4] * l.lat + isl.affine[5]] : [isl.pad + (l.lng - isl.west) * isl.px_per_lng, isl.pad + (isl.north - l.lat) * isl.px_per_lat]);
  const inside = isl ? pts.filter((l) => { const [x, y] = at(l); return x > 10 && y > 10 && x < isl.width - 10 && y < isl.height - 10; }) : [];
  const useToy = isl && (!pts.length || inside.length >= pts.length * 0.8);
  const w = word ?? subRegion()?.name?.[LANG] ?? shortTitle(d.search.title);
  const pin = (l) => html`<button key=${l.id} class=${'dk-pin' + (l.id === sel?.id ? ' on' : '') + (l.stop ? ' at' : '')} style=${(() => { const [x, y] = at(l); return `left:${(x / isl.width) * 100}%;top:${(y / isl.height) * 100}%`; })()} onClick=${() => { hap.sel(); go(l.stop ? sp('listing', l.id) : sp('listings', l.id), !l.stop); }} aria-label=${`${shortTitle(l.title)}, ${priceText(l)}`}>${l.stop ? fmtTime(l.stop.v.starts_at) : prc(l)}</button>`;
  return html`<section class="dk-land" aria-label=${t('nav_map')}>${useToy && html`<div class="dk-bw" aria-hidden="true">${w}</div>`}
    ${useToy ? html`<div class=${'dk-isl' + (isl.v === 2 ? ' v2' : '')} style=${`aspect-ratio:${isl.width}/${isl.height}`}><img src=${isl.src} alt="" draggable="false" />${isl.walls && html`<${Walls} isl=${isl} />`}
        ${Object.entries(isl.areas ?? {}).map(([id, [x, y]]) => html`<span key=${id} class=${isl.v === 2 ? 'dk-sign' : 'dk-ar'} style=${`left:${(x / isl.width) * 100}%;top:${(y / isl.height) * 100}%`}>${isl.names?.[id]?.[LANG === 'ru' ? 'ru' : 'en'] ?? afArea(id) ?? ''}</span>`)}
        ${(isl.rivers ?? []).map((r) => html`<span key=${r.ru} class="dk-river" style=${`left:${(r.xy[0] / isl.width) * 100}%;top:${(r.xy[1] / isl.height) * 100}%;--rot:${r.rot}deg`}>${LANG === 'ru' ? r.ru : r.en}</span>`)}
        ${inside.map(pin)}</div>`
      : html`<${SeaMap} pts=${pts} sel=${sel} />`}
    ${children}<span class="attrib">© OpenStreetMap${useToy ? '' : ' © OpenFreeMap'}</span></section>`;
}
function SeaMap({ pts, sel }) {
  const box = useRef(null), map = useRef(null), marks = useRef([]);
  const [ready, setReady] = useState(false), [fail, setFail] = useState(false);
  useEffect(() => {
    let dead = false;
    loadML().then(async (ml) => {
      const st = await mapStyle();
      if (dead || !box.current) return;
      const g = cssVar('--ground'), scr = cssVar('--screen'), land = isDark() ? '#2A2826' : !scr || scr.toLowerCase() === g.toLowerCase() ? (g.toLowerCase() === '#e8e35c' ? '#9ED0F2' : '#E8E35C') : scr;
      for (const l of st.layers) { const p = (l.paint ??= {}); if (l.id === 'water') p['fill-color'] = g; else if (l.type === 'background') p['background-color'] = land; else if (/^landuse|^landcover|park/.test(l.id) && l.type === 'fill') { p['fill-color'] = land; } else if (l.type === 'symbol') p['text-halo-color'] = land; }
      const c = subRegion()?.center ?? (pts[0] ? [pts[0].lat, pts[0].lng] : regionPack()?.center ?? [0, 0]);
      const m = new ml.Map({ container: box.current, style: st, center: [c[1], c[0]], zoom: 11, attributionControl: false, dragRotate: false, pitchWithRotate: false, fadeDuration: 0 });
      m.addControl(new ml.NavigationControl({ showCompass: false }), 'bottom-right');
      map.current = m;
      m.on('load', () => !dead && setReady(true));
    }).catch(() => !dead && setFail(true));
    return () => { dead = true; marks.current.forEach((x) => x.remove()); map.current?.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    const ml = window.maplibregl, m = map.current;
    if (!ready || !m) return;
    marks.current.forEach((x) => x.remove());
    marks.current = [];
    const b = new ml.LngLatBounds();
    for (const l of pts) {
      const el = document.createElement('button');
      el.className = 'dk-pin' + (l.id === sel?.id ? ' on' : '');
      el.textContent = l.stop ? fmtTime(l.stop.v.starts_at) : prc(l);
      el.setAttribute('aria-label', shortTitle(l.title));
      el.addEventListener('click', () => go(l.stop ? sp('listing', l.id) : sp('listings', l.id), !l.stop));
      marks.current.push(new ml.Marker({ element: el, anchor: 'bottom' }).setLngLat([l.lng, l.lat]).addTo(m));
      b.extend([l.lng, l.lat]);
    }
    if (!b.isEmpty()) m.fitBounds(b, { padding: 90, maxZoom: 13, duration: 0 });
  }, [ready, pts.map((l) => l.id).join(), sel?.id]);
  return html`<div class="dk-map" ref=${box}></div>${fail && html`<p class="dk-none">${t('map_fail')}</p>`}`;
}
const VOTE = () => [['want_view', 'eye', L('Хочу', 'Want')], ['thinking', 'help', L('Думаю', 'Maybe')], ['not_interested', 'x', L('Нет', 'No')]];
function House({ l, desk }) {
  const d = D();
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [l?.id]);
  if (!l) return html`<aside class="dk-house"><div class="dk-dev-like"><${Typed} lines=${[L('Ищу дома под ваш запрос', 'Looking for homes')]} cls="sm" /><p>${L('Пришли ссылку или группу, где посмотреть.', 'Send a link or a group to look at.')}</p><${Ask} ph=${L('Ссылка или группа', 'A link or a group')} /></div><${HuntPill} desk=${desk} n=${decisions().length} /></aside>`;
  const nd0 = decisions({ listing: l.id }).length;
  const ph = photosOf(l), anchor = d.search.brief?.anchor;
  const near = anchor && l.lat != null ? minutesFor(km([l.lat, l.lng], [anchor.lat, anchor.lng])) : null;
  const ck = l.checks?.verdict;
  const mine = myVote(l.id);
  const facts = [
    near != null && ['navigation', anchor.label ? L('До: ', 'To: ') + anchor.label : L('До места', 'To the place'), L(`${near} мин`, `${near} min`)],
    l.flood?.level && ['droplets', L('Дождь', 'Rain'), { low: L('не топит', 'stays dry'), medium: L('бывает', 'sometimes'), high: L('топит', 'floods') }[l.flood.level]],
    l.fields?.internet_mbps && ['wifi', L('Интернет', 'Internet'), `${l.fields.internet_mbps} ${L('Мбит', 'Mbps')}`],
    ck && ['shield', L('Проверка', 'Check'), { ok: L('чисто', 'clean'), caution: L('осторожно', 'careful'), danger: L('опасно', 'danger') }[ck], ck !== 'ok'],
    [ 'sparkles', L('Голоса', 'Votes'), `${Math.max(0, interestOf(l.id).score)} ${L('из', 'of')} ${interestOf(l.id).max}`],
  ].filter(Boolean).slice(0, nd0 ? 3 : 4);
  const nd = nd0;
  return html`<aside class="dk-house">
    <button class="frame dk-hph" aria-label=${L('Следующее фото', 'Next photo')} onClick=${() => ph.length > 1 && setI((i + 1) % ph.length)}><span class="in"><${Img} src=${ph[i]} alt=${shortTitle(l.title)} /></span>${ph.length > 1 && html`<em>${i + 1} ${L('из', 'of')} ${ph.length}</em>`}</button>
    <a class="dk-hn" href=${'#' + sp('listing', l.id)} onClick=${(e) => { e.preventDefault(); go(sp('listing', l.id)); }}><h2>${shortTitle(l.title)}</h2><${Icon} n="arrow-up-right" cls="sm" /></a>
    <p class="dk-hp"><b>${prc(l)}</b></p>
    <div class="dk-kv">${facts.map(([ic, k, v, warn]) => html`<div key=${k} class=${warn ? 'warn' : ''}><${Icon} n=${ic} cls="sm" /><span class="grow">${k}</span><b>${v}</b></div>`)}</div>
    ${canVoteRole(d.me.role) && html`<div class="dk-vote" role="group" aria-label=${L('Твой голос', 'Your vote')}>${VOTE().map(([k, ic, label]) => html`<button key=${k} aria-pressed=${mine === k ? 'true' : 'false'} onClick=${() => { hap.sel(); vote(l.id, k); }}><${Icon} n=${ic} cls="sm" />${label}</button>`)}</div>`}
    <div class="dk-up">${nd > 0 && html`<${Ticket} ctx=${{ listing: l.id }} up />`}<${HuntPill} desk=${desk} n=${decisions().length} /></div>
  </aside>`;
}

// ---------------------------------------------------------------- Plan (viewings)
function DeskPlan() {
  const d = D(), by = viewingsByDay(), today = hmToday();
  const days = [...by.keys()].sort();
  const [day, setDay] = useState(days.find((x) => x >= today) ?? days[days.length - 1] ?? null);
  const list = day ? (by.get(day) ?? []).slice().sort((a, b) => a.starts_at.localeCompare(b.starts_at)) : [];
  const stops = list.map((v) => ({ v, l: listingById(v.listing_id) ?? v })).filter((x) => x.l.lat != null);
  const legs = stops.slice(1).map((x, i) => km([stops[i].l.lat, stops[i].l.lng], [x.l.lat, x.l.lng]));
  const mins = legs.reduce((a, x) => a + minutesFor(x), 0);
  const route = list.length ? d.routes?.[String(list[0].starts_at).slice(0, 10)] : null;
  const prices = list.map((v) => listingById(v.listing_id)?.price).filter(Boolean);
  const n = list.length, rel = day === today ? L('Сегодня', 'Today') : hmDays(day) === 1 ? L('Завтра', 'Tomorrow') : day ? cap(dfmt(day, { weekday: 'long', day: 'numeric', month: 'long' })) : '';
  return html`<div class="dk-main dk-plan">
    <section class="dk-l"><${Typed} as="h1" lines=${[n ? `${rel} ${n} ${L(pl(n, 'дом', 'дома', 'домов'), pl(n, 'home', 'homes'))}` : L('Просмотров пока нет', 'No viewings yet')]} cls="dk-say" />
      ${days.length > 1 && html`<div class="dk-chips" role="group">${days.filter((x) => x >= today || x === day).slice(0, 6).map((x) => html`<button key=${x} aria-pressed=${x === day ? 'true' : 'false'} onClick=${() => setDay(x)}>${wdShort(x)} ${Number(x.slice(8))}</button>`)}</div>`}
      <${Land} key=${day} stops=${stops} list=${[]} sel=${null} word=${n ? L('Едем', 'Go') : L('План', 'Plan')} /></section>
    <section class="dk-r"><header class="dk-h2"><h2>${L('Маршрут', 'Route')}</h2><span>${day ? cap(dfmt(day, { weekday: 'short', day: 'numeric', month: 'long' })) : ''}</span></header>
      <div class="dk-rows">${list.map((v) => { const l = listingById(v.listing_id) ?? v; return html`<button key=${v.id} class="dk-row" onClick=${() => go(sp('listing', v.listing_id))}><time>${fmtTime(v.starts_at)}</time><span class="grow"><b class="ellipsis">${shortTitle(l.title)}</b><small class="ellipsis">${[t('s_' + vStatus(v)), v.meet_note ?? districtShort(l)].filter(Boolean).join(', ')}</small></span><b>${prc(l)}</b></button>`; })}
        ${!n && html`<p class="dk-none">${L('Скажи Hunt, какие дома посмотреть и когда вам удобно.', 'Tell Hunt which homes to see and when.')}</p>`}</div>
      <${Ticket} all=${decisions().filter((x) => x.kind === 'viewing' || x.draft?.kind === 'schedule')} /></section>
    ${n > 0 && html`<footer class="dk-facts">${mins > 0 && html`<button onClick=${() => openLink(route)}><span>${L('в дороге', 'on the road')}</span><b>${L(`${mins} мин`, `${mins} min`)}</b></button>`}${prices.length > 0 && html`<button onClick=${() => go(sp('compare'))}><span>${L('цены', 'prices')}</span><b>${prices.length > 1 && Math.min(...prices) !== Math.max(...prices) ? L(`от ${num(money(Math.min(...prices), list[0].currency))} до ${money(Math.max(...prices), list[0].currency)}`, `${num(money(Math.min(...prices), list[0].currency))} to ${money(Math.max(...prices), list[0].currency)}`) : money(prices[0], list[0].currency)}</b></button>`}</footer>`}
    <div class="dk-pills"><button class="btn soft" disabled=${!route} onClick=${() => openLink(route)}><${Icon} n="nav" cls="sm" />${L('Открыть маршрут', 'Open the route')}</button>${n > 0 && html`<button class="btn surface" onClick=${() => openSheet('late', { day })}>${L('Опаздываем', 'Running late')}</button>`}<button class="btn surface" onClick=${() => go(sp('calendar'))}>${L('Календарь', 'Calendar')}</button></div>
  </div>`;
}

// ---------------------------------------------------------------- Money
function DeskMoney() {
  const d = D(), m = d.money ?? { expenses: [], balances: {}, totals: {} }, cur = m.currency || d.deal?.data?.terms?.currency || 'IDR';
  const paid = dealPaid(m.expenses ?? [], cur), today = hmToday(), ym = today.slice(0, 7);
  const xs = [...(m.expenses ?? []).filter((e) => e.currency === cur && e.kind !== 'deposit'), ...paid.rent];
  const mon = xs.filter((e) => String(e.date).slice(0, 7) === ym), sum = mon.reduce((a, e) => a + Number(e.amount), 0);
  const rent = mon.filter((e) => e.kind === 'rent').reduce((a, e) => a + Number(e.amount), 0);
  const dayN = Number(today.slice(8)), daysIn = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0).getDate();
  const perDay = (sum - rent) / Math.max(1, dayN), fc = rent + perDay * daysIn;
  const bm = bigMoney(sum, cur), bf = bigMoney(fc, cur);
  const f = (b) => (n) => new Intl.NumberFormat(LANG === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: b.dec }).format(n);
  const kinds = Object.entries(mon.reduce((a, e) => ({ ...a, [e.kind]: (a[e.kind] ?? 0) + Number(e.amount) }), {})).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const list = [...(m.expenses ?? [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const tr = m.balances?.[cur]?.transfers ?? [], top = tr.find((x) => x.from === d.user.id || x.to === d.user.id) ?? tr[0];
  const can = canVoteRole(d.me.role) && !d.path?.closed;
  const [busy, setBusy] = useState(false);
  const settle = async () => { setBusy(true); try { const r = await api('/app/api/settle', { search_id: d.search.id, from: top.from, to: top.to, amount: top.amount, currency: cur }); d.money = r.money; toast(t('settled_toast')); emit(); } catch { toast(t('err_generic')); } setBusy(false); };
  return html`<div class="dk-main dk-money">
    <header class="dk-fig"><div><p>${L('потратили в этом месяце', 'spent this month')}, ${bm.unit}</p><b class="dk-big"><${CountUp} value=${bm.v} fmt=${f(bm)} /></b></div>
      ${sum > 0 && dayN > 2 && dayN < daysIn && html`<div class="fc"><p>${L(`прогноз к ${daysIn}-му`, 'forecast')}</p><b class="dk-big blur">${f(bf)(bf.v)}</b></div>`}</header>
    <section class="dk-l"><${Typed} as="h1" lines=${[sum - rent > 0 ? L(`Живём на ${money(perDay, cur)} в день`, `${money(perDay, cur)} a day`) : L('Тут будут общие траты', 'Shared spending lives here')]} cls="dk-say sm" />
      ${kinds.length > 0 && html`<div class="dk-bars">${kinds.map(([k, v]) => html`<div key=${k}><span>${t('xk_' + k)}</span><i><u style=${`width:${Math.max(3, Math.round((v / kinds[0][1]) * 100))}%`}></u></i><b>${money(v, cur)}</b></div>`)}</div>`}
      ${m.mode !== 'shared' && html`<h2>${L('Кто кому', 'Who owes whom')}</h2>${top ? html`<div class="dk-owe"><${Av} m=${memberById(top.from)} size=${96} free /><div><b>${money(top.amount, cur)}</b><span class="dk-arrow" aria-hidden="true"></span><small>${firstName(memberById(top.from)?.name)} → ${top.to === d.user.id ? L('тебе', 'you') : firstName(memberById(top.to)?.name)}</small>${can && (top.from === d.user.id || top.to === d.user.id || d.me.role === 'owner') && html`<button class="btn surface sm" disabled=${busy} onClick=${settle}>${L('Рассчитались', 'Settled')}</button>`}</div><${Av} m=${memberById(top.to)} size=${96} free /></div>` : html`<p class="dk-none">${t('all_square')}</p>`}`}
    </section>
    <section class="dk-r"><header class="dk-h2"><h2>${L('Лента', 'Ledger')}</h2><span>${list.length ? L(`${list.filter((e) => e.receipt).length} из ${list.length} с чеком`, `${list.filter((e) => e.receipt).length} of ${list.length} with receipts`) : ''}</span></header>
      <div class="dk-rows dk-scroll">${[...paid.rent, ...list].slice(0, 60).map((e) => html`<button key=${e.id} class="dk-row" onClick=${() => (e.deal ? go(sp('docs')) : openSheet('expense', e.id))}><span class="dk-ic"><${Icon} n=${e.receipt ? 'receipt-text' : e.deal ? 'key-round' : 'plus'} cls="sm" /></span><span class="grow"><b class="ellipsis">${e.title ?? t('xk_' + e.kind)}</b><small class="ellipsis">${[fmtDM(e.date), e.deal ? L('по договору', 'under the lease') : null, !e.receipt && !e.deal ? L('без чека', 'no receipt') : null].filter(Boolean).join(', ')}</small></span><b>${money(e.amount, e.currency ?? cur)}</b>${e.paid_by && html`<${Av} m=${memberById(e.paid_by) ?? { name: '?' }} size=${30} />`}</button>`)}
        ${!list.length && !paid.rent.length && html`<p class="dk-none">${L('Первая трата появится здесь.', 'The first expense shows here.')}</p>`}</div></section>
    <div class="dk-pills">${can && html`<button class="btn accent" onClick=${() => openSheet('add_expense')}><${Icon} n="plus" cls="sm" />${L('Добавить трату', 'Add expense')}</button>`}${m.mode !== 'shared' && can && html`<button class="btn surface" onClick=${() => go(sp('split'))}>${L('Доли и комнаты', 'Shares and rooms')}</button>`}${d.me.role === 'owner' && html`<button class="btn surface" onClick=${() => openSheet('money_mode')}>${L('Как считаем', 'How we split')}</button>`}</div>
  </div>`;
}

// ---------------------------------------------------------------- Events
function DeskAfisha({ arg, desk }) {
  const d = D();
  const [v, again] = useAfisha('all');
  const [pickK, setPickK] = useState(null);
  useEffect(() => setPickK(null), [AF.day, v?.day]);
  const all = v && !v.failed ? [...(v.top ?? []), ...(v.items ?? [])] : [];
  const o = all.find((x) => x.key === pickK) ?? all[0] ?? null;
  const setDay = (x) => { hap.sel(); AF.day = x; again(); };
  if (!v) return html`<div class="dk-main dk-af">${skel(420)}</div>`;
  if (v.failed) return html`<div class="dk-main dk-af">${msgCard(t('err_generic'))}</div>`;
  const isToday = !v.day || v.day === v.today;
  const who = o ? d.members.filter((m) => [...(o.want ?? []), ...(o.going ?? [])].includes(m.user_id)) : [];
  return html`<div class="dk-main dk-af">
    <section class="dk-afl"><header class="dk-afh"><${Typed} as="h1" lines=${[isToday ? L('Что сегодня?', 'What is on today?') : L(`Что ${afDay(v.day)}?`, `What is on ${afDay(v.day)}?`)]} cls="dk-say" /><button class="btn surface sm" onClick=${() => openSheet('af_prefs')}><${Icon} n="sparkles" cls="sm" />${L('Что нам нравится', 'Our taste')}</button></header>
      ${o ? html`<div class="dk-post"><div class="dk-bw" aria-hidden="true">${(t('af_c_' + o.category) || '').split(' ')[0]}</div><button class="dk-post-b" aria-label=${afTitle(o)} onClick=${() => go(sp('event', o.key))}><${TkPhoto} key=${o.key} o=${o} big /></button><${Sticker} text=${`${isToday ? '' : afDay(o.occ) + ' '}${afHM(o)}`} cls="lg" style="right:0;top:7%;--r:8deg" /><div class="dk-toys">${who.slice(0, 3).map((m) => html`<${Av} key=${m.user_id} m=${m} size=${96} free />`)}</div></div>`
        : html`<div class="dk-post none"><p>${L('На этот день пусто. Hunt ищет.', 'Nothing this day. Hunt is looking.')}</p></div>`}
      <div class="dk-week" role="group">${(v.days ?? []).slice(0, 7).map((x) => html`<button key=${x.day} aria-pressed=${x.day === v.day ? 'true' : 'false'} onClick=${() => setDay(x.day)}><span>${dfmt(x.day, { weekday: 'short' }).replace('.', '')} ${Number(x.day.slice(8))}</span><b>${x.n || '·'}</b></button>`)}</div>
      <div class="dk-evs">${all.filter((x) => x !== o).slice(0, 12).map((x) => html`<button key=${x.key} class="dk-ev" onClick=${() => { hap.sel(); setPickK(x.key); }}><span class="ph">${photoUrl(x.photo) ? html`<img src=${photoUrl(x.photo)} alt="" loading="lazy" />` : html`<${Icon} n=${afIcon(x)} />`}</span><b class="ellipsis">${afTitle(x)}</b><small>${afHM(x)}${x.minutes != null ? ' · ' + L(`${x.minutes} мин`, `${x.minutes} min`) : ''}</small></button>`)}</div></section>
    <aside class="dk-house ev">${o && html`<a class="dk-hn" href=${'#' + sp('event', o.key)} onClick=${(e) => { e.preventDefault(); go(sp('event', o.key)); }}><h2>${afTitle(o)}</h2><${Icon} n="arrow-up-right" cls="sm" /></a>
      <div class="dk-kv">${[afPlace(o) && ['map-pin', afPlace(o), afTravel(o) ?? ''], afPrice(o) && ['wallet', L('Вход', 'Price'), afPrice(o)], afLang(o) && ['languages', L('Язык', 'Language'), afLang(o)]].filter(Boolean).map(([ic, k, x]) => html`<div key=${k}><${Icon} n=${ic} cls="sm" /><span class="grow ellipsis">${k}</span><b>${x}</b></div>`)}</div>
      ${afWhy(o) && afWhy(o) !== afPrice(o) && html`<p class="dk-why">${afWhy(o)}</p>`}
      <div class="dk-up"><div class="dk-tkw up"><section class="dk-tk up"><div class="dk-stub">${o.price != null ? html`<b>${num(money(o.price, o.currency))}</b><span>${unit(money(o.price, o.currency)) + ' ' + L('с человека', 'each')}</span>` : html`<b>${afHM(o)}</b><span>${afPrice(o) ?? ''}</span>`}</div>
        <div class="dk-tk-in"><div class="dk-tk-h"><span class="grow">${o.booking_status ? t('af_st_' + o.booking_status) : afDayLong(o.occ)}</span></div><div class="dk-q">${o.booking_status ? L('Идём', 'We are going') : o.booking === 'none' ? L('Идём?', 'Going?') : L('Записать нас?', 'Book us in?')}</div>
          <div class="dk-acts">${o.booking_status ? html`<button class="btn surface" onClick=${() => go(sp('event', o.key))}>${L('Открыть', 'Open')}</button>` : html`<button class="btn accent" onClick=${() => (o.booking === 'none' ? afFeedback(o, 'want', true).then(() => toast(t('af_want_sent'))) : afBook(o))}>${o.booking === 'ticket' ? t('af_tickets') : o.booking === 'none' ? L('Идём', 'Going') : L('Записать нас', 'Book us')}</button><button class="btn surface" onClick=${() => afFeedback(o, 'nope', true)}>${L('Не идём', 'No')}</button>`}</div></div></section></div>
        <${HuntPill} desk=${desk} n=${decisions().length} /></div>`}
      ${!o && html`<div class="dk-up"><${HuntPill} desk=${desk} n=${decisions().length} /></div>`}</aside>
  </div>`;
}

// ---------------------------------------------------------------- Orders
function DeskShop({ arg }) {
  const { v, items, err } = useOrders(true);
  const [q, setQ] = useState('');
  if (err) return html`<div class="dk-main dk-shop">${msgCard(t('err_generic'))}</div>`;
  if (!v || !items) return html`<div class="dk-main dk-shop">${skel(420)}</div>`;
  const s = ordSup(arg) ?? v.suppliers[0];
  if (!s) return html`<div class="dk-main dk-shop"><${Typed} lines=${[t('or_no_sup')]} cls="dk-say" /><p class="dk-none">${t('or_no_sup_s')}</p></div>`;
  const all = items[s.id] ?? [], shelf = ordShelf(s.id), basket = ordBasket(s.id), inB = new Map(basket.lines.map((l) => [l.item_id, l]));
  const needle = q.trim().toLowerCase().replace(/ё/g, 'е');
  const list = needle ? all.filter((x) => [x.ru, x.en, x.name_id].some((y) => String(y).toLowerCase().replace(/ё/g, 'е').includes(needle))).slice(0, 40) : null;
  const toy = (x, i, big) => { const n = inB.get(x.id)?.qty ?? 0, by = memberById(inB.get(x.id)?.by); return html`<div key=${x.id} class=${'dk-toy' + (big ? ' big' : '')}><button class="art" onClick=${() => { hap.sel(); go(sp('good', x.id)); }} aria-label=${ordName(x)}><${Good} slug=${x.toy} size=${big ? 230 : 148} rot=${ordRot(i)} big=${big} />${by && html`<span class="by"><${Av} m=${by} size=${56} free /></span>`}</button>
    ${ordCan() && html`<button class=${'add' + (n ? ' on' : '')} aria-label=${t('or_add', { t: ordName(x) })} onClick=${() => ordSetQty(x, n + (x.step || 1))}>${n ? ordBadge(x.unit, n) : html`<${Icon} n="plus" cls="sm" />`}</button>`}<b>${ordShort(x)}</b><span>${ordPrice(x, s.currency, true)}</span></div>`; };
  const rest = all.filter((x) => !shelf.list.includes(x));
  return html`<div class="dk-main dk-shop"><header class="dk-afh"><${Typed} as="h1" key=${s.id} lines=${[t('or_q_' + (s.kind ?? 'other'))]} cls="dk-say" /><div class="dk-chips" role="group">${v.suppliers.map((x) => html`<button key=${x.id} aria-pressed=${x.id === s.id ? 'true' : 'false'} onClick=${() => { hap.sel(); go(sp('shop', x.id), true); }}>${ordTab(x)}</button>`)}<button onClick=${() => go(sp('shop', 'services'))}>${t('or_services')}</button>${ordLast(s.id) && ordCan() && html`<button onClick=${() => ordAgain(s.id)}>${L('Как в прошлый раз', 'Same as last time')}</button>`}</div></header>
    <label class="dk-search"><${Icon} n="search" cls="sm" /><input type="search" value=${q} placeholder=${t('or_search')} aria-label=${t('or_search')} onInput=${(e) => setQ(e.currentTarget.value)} /></label>
    <div class="dk-scroll"><div class="dk-bw" aria-hidden="true">${t('or_w_' + (s.kind ?? 'other'))}</div>
      ${list ? html`<div class="dk-shelf">${list.map((x, i) => toy(x, i, false))}</div>${!list.length && html`<p class="dk-none">${t('or_none_found')}</p>`}` : html`<div class="dk-shelf first">${shelf.list.map((x, i) => toy(x, i, i < 2))}</div><div class="dk-shelf">${rest.map((x, i) => toy(x, i, false))}</div>`}</div></div>`;
}
function ShopDevice({ desk, arg }) {
  const { v, items } = useOrders(true);
  const s = v && (ordSup(arg) ?? v.suppliers[0]);
  const b = s && items ? ordBasket(s.id) : null;
  return html`<${Device} desk=${desk} log=${!b?.count} title=${b?.count ? null : L('Собираю заказ', 'Making an order')} sub=${b?.count ? null : L('Нажми плюс у товара, чек напечатается здесь', 'Press plus, the receipt prints here')} ph=${L('Добавь лёд и лаймы', 'Add ice and limes')}>
    ${b?.count > 0 && html`<div class="dk-rcpt"><${Receipt} o=${b} s=${s} edit date=${fmtDM(new Date().toISOString())} /><button class="btn dk-inv2 full" onClick=${async () => { await ordFlushAll(); go(sp('order-check', s.id)); }}>${L('Проверить и заказать', 'Check and order')}</button></div>`}<//>`;
}

// ---------------------------------------------------------------- Documents
function DeskDocs() {
  const d = D(), docs = d.documents ?? [], lease = docs.find((x) => x.kind === 'lease' && x.status === 'have') ?? docs.find((x) => x.kind === 'lease'), today = hmToday();
  const tm = d.deal?.data?.terms ?? {}, cur = tm.currency;
  const need = docs.filter((x) => x.status !== 'have').length;
  const dates = (d.dates ?? []).filter((x) => !x.done && x.date >= today).slice(0, 5);
  if (!d.deal) return html`<div class="dk-main dk-docs"><${Typed} as="h1" lines=${[L('Бумаги появятся, когда выберете дом', 'Papers come when you choose a home')]} cls="dk-say" /></div>`;
  const facts = [tm.from && tm.to ? [L('Живём', 'Stay'), `${fmtDM(tm.from)} – ${fmtDM(tm.to)}`] : null, tm.rent ? [L('Платим', 'Rent'), money(tm.rent, cur)] : null, tm.deposit ? [L('Залог', 'Deposit'), money(tm.deposit, cur)] : null].filter(Boolean);
  return html`<div class="dk-main dk-docs">
    <section class="dk-l"><${Typed} as="h1" lines=${[lease?.signed_at ? L('Договор подписан', 'The lease is signed') + (need ? L(`, не хватает: ${need}`, `, missing: ${need}`) : '') : L('Договор ещё не подписан', 'The lease is not signed yet')]} cls="dk-say" />
      <div class="dk-hero" style=${`--n:${L(6.4, 6)}`}><${BigWord} text=${L('Бумаги', 'Papers')} /><button class="dk-paper" onClick=${() => lease && go(sp('doc', lease.id))}><b>${lease ? docTitle(lease) : L('Договор', 'Lease')}</b><small>${hmName()}</small><i></i><i></i><i class="s"></i>${facts.map(([k, v]) => html`<p key=${k}><span>${k}</span><b>${v}</b></p>`)}<i></i><i class="s"></i></button>
        ${lease?.signed_at && html`<${Sticker} text=${L(`подписан ${fmtDM(lease.signed_at)}`, `signed ${fmtDM(lease.signed_at)}`)} cls="lg" style="left:62%;top:-4%;--r:9deg" />`}</div></section>
    <section class="dk-r"><header class="dk-h2"><h2>${L('Бумаги', 'Papers')}</h2><span>${L(`${docs.length - need} из ${docs.length} готово`, `${docs.length - need} of ${docs.length} ready`)}</span></header>
      <div class="dk-rows">${docs.map((x) => html`<button key=${x.id} class="dk-row" onClick=${() => (x.has_file || x.summary ? go(sp('doc', x.id)) : openSheet('doc_req', x))}><span class="dk-ic"><${Icon} n="file-text" cls="sm" /></span><span class="grow"><b class="ellipsis">${docTitle(x)}</b><small class="ellipsis">${docSub(x)}</small></span>${x.status === 'have' ? html`<${Icon} n="check" cls="sm ok" />` : html`<i class="dk-o" aria-label=${L('нет', 'missing')}></i>`}</button>`)}
        ${!docs.length && html`<p class="dk-none">${L('Пришли договор боту, Hunt разложит по пунктам.', 'Send the lease to the bot, Hunt will sort it out.')}</p>`}</div>
      ${dates.length > 0 && html`<header class="dk-h2"><h2>${L('Даты', 'Dates')}</h2></header><div class="dk-rows">${dates.map((x) => html`<div key=${x.date + x.title} class="dk-row"><time>${fmtDM(x.date)}</time><span class="grow"><b class="ellipsis">${x.title}</b></span><b>${x.amount != null ? money(x.amount, x.currency) : ''}</b></div>`)}</div>`}
      <${Ticket} all=${decisions().filter((x) => x.kind === 'pay' || x.kind === 'renewal')} /></section>
    <div class="dk-pills">${canVoteRole(d.me.role) && html`<button class="btn soft" onClick=${() => openSheet('add_doc')}><${Icon} n="plus" cls="sm" />${L('Добавить бумагу', 'Add a paper')}</button>`}<button class="btn surface" onClick=${() => go(sp('deal'))}>${L('Список заезда', 'Move-in list')}</button><button class="btn surface" onClick=${() => go(sp('path'))}>${L('Путь проекта', 'Project path')}</button></div>
  </div>`;
}

// ---------------------------------------------------------------- the shell
/** Screen colour on the desk: search and chats are sky, the rest as on the phone. */
export function deskTone(screen, base, arg) {
  if (isDark()) return base;
  if (screen === 'chats' && homeMode() && chArchRoute(arg)) return 'grey'; // wave 8.3: the search archive is calm grey
  if (['chats', 'approve', 'contact'].includes(screen) || (!homeMode() && ['listings', 'listing', 'map', 'deck', 'compare'].includes(screen))) return D()?.search?.country === 'kz' && screen !== 'chats' ? 'desk-lime' : 'desk-sky';
  if (screen === 'plan' && !homeMode()) return 'region';
  return base;
}
export function Desk({ route, view }) {
  const d = D(), screen = route.screen, a = route.arg, home = homeMode(), desk = useDesk(d.search.id);
  useEffect(() => {
    const f = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || /input|textarea|select/i.test(e.target.tagName) || S.sheet) return;
      if (['1', '2', '3'].includes(e.key)) { const b = document.querySelector(`.dk-tk [data-key="${e.key}"]`); if (b) { e.preventDefault(); b.focus(); } }
    };
    addEventListener('keydown', f);
    return () => removeEventListener('keydown', f);
  }, []);
  const n = decisions().length;
  const dev0 = () => html`<${Device} desk=${desk} title=${n ? L('Нужно твоё да', 'I need your yes') : L('Я рядом', 'I am here')}>${n > 0 && html`<button class="btn dk-inv2" onClick=${() => go(sp(home ? 'today' : 'chats'))}>${L(`Ждут тебя: ${n}`, `Waiting: ${n}`)}</button>`}<//>`;
  const own = {
    today: () => (home ? [html`<${DeskHome} desk=${desk} />`, html`<${HomeDevice} desk=${desk} />`] : null),
    chats: () => [html`<${DeskChats} arg=${a} />`, html`<${ChatsDevice} desk=${desk} arg=${a} />`],
    listings: () => (home ? null : [html`<${DeskSearch} arg=${a} desk=${desk} />`, null]),
    plan: () => (home ? null : [html`<${DeskPlan} />`, html`<${Device} desk=${desk} title=${decisions().some((x) => x.kind === 'viewing') ? L('Жду твоё да', 'Waiting for your yes') : L('Веду по маршруту', 'I keep the route')} sub=${L('напомню за час до каждого дома', 'a reminder an hour before each')} />`]),
    money: () => [html`<${DeskMoney} />`, html`<${Device} desk=${desk} title=${L('Считаю вместе с вами', 'Counting with you')} sub=${L('чек можно прислать боту', 'send a receipt to the bot')} ph=${L('Например: обед 64 тыс', 'For example: lunch 64k')} />`],
    afisha: () => [html`<${DeskAfisha} arg=${a} desk=${desk} />`, null],
    shop: () => (a === 'services' ? null : [html`<${DeskShop} arg=${a} />`, html`<${ShopDevice} desk=${desk} arg=${a} />`]),
    access: () => (a === 'limit' || !canAccess() ? null : [html`<${DeskAccess} key=${a ?? ''} arg=${a} />`, html`<${AccessDevice} arg=${a} desk=${desk} />`]),
    agent: () => [html`<${DeskAgent} />`, dev0()],
    docs: () => [html`<${DeskDocs} />`, html`<${Device} desk=${desk} title=${(d.documents ?? []).some((x) => x.status !== 'have') ? L('Не всё собрано', 'Not all collected') : L('Бумаги в порядке', 'Papers in order')} sub=${L('номера паспортов я не храню', 'I keep no passport numbers')} />`],
  }[screen]?.() ?? null;
  return html`<div class=${'dk' + (own && !own[1] ? ' two' : '')} data-screen=${screen}>
    <a class="dk-skip" href="#dk-main" onClick=${(e) => { e.preventDefault(); document.querySelector('.dk-main')?.focus(); }}>${L('К содержанию', 'Skip to content')}</a>
    <${Rail} screen=${screen} />
    ${own ? own[0] : html`<div class="dk-main dk-col" tabindex="-1"><div class="dk-colin">${!['today', 'more', 'picker'].includes(screen) && html`<button class="round dk-back" aria-label=${t('back')} onClick=${back}><${Icon} n="arrow-left" /></button>`}${view}</div></div>`}
    ${own ? own[1] : dev0()}
    <div class="dk-bar"><${HuntMark} /><span class="grow">${n ? L('Hunt ждёт тебя', 'Hunt waits for you') : agoWord(desk?.agent_seen_at)}</span>${n > 0 && html`<i>${n}</i>`}<${Ask} ph=${L('Скажи Hunt', 'Tell Hunt')} /></div>
  </div>`;
}

// ---------------------------------------------------------------- access to conversations (design/desktop/final-access.pen)
/** The screen in two columns (what it is, the choice) + the ticket; Hunt on the right lists what is open and what stays closed. */
const axKind = (arg, a) => (arg === 'receipt' && !a?.receipts?.[0] ? 'sees' : ['sees', 'off', 'receipt'].includes(arg) ? arg : 'connect');
const msgsN = (k) => ax.pn(k, LANG === 'ru' ? ['{n} сообщение', '{n} сообщения', '{n} сообщений'] : ['{n} message', '{n} messages']).replace('{n}', k);
const axContacts = (a) => [...a.contacts.reduce((m, c) => m.set(c.id, m.has(c.id) ? { ...m.get(c.id), n: m.get(c.id).n + c.n } : c), new Map()).values()];
const tgOpen = (a) => new Set(a.contacts.filter((c) => c.channel === 'telegram').map((c) => c.id)).size;
/** Squares on the device: what Hunt can touch (yellow) and what stays closed or stays yours (paper); the state is also in words. */
function Tiles({ list, keep = false }) {
  return html`<ul class="dk-axt">${list.map(([ic, label, on]) => html`<li key=${label} class=${on ? 'on' : ''}><${Icon} n=${ic} /><b>${label}</b><span class="dk-vh">${on ? L('открыто', 'open') : keep ? L('останется', 'stays') : L('закрыто', 'closed')}</span></li>`)}</ul>`;
}
const Lines = ({ title, list }) => html`<div class="dk-log q"><h3>${title}</h3>${list.map(([k, s]) => html`<div key=${s}><time>${k}</time><span>${s}</span></div>`)}</div>`;
const KEEP = () => [['house', L('дом', 'home')], ['wallet', L('деньги', 'money')], ['ticket', L('афиша', 'events')], ['calendar', L('план', 'plan')], ['file-text', L('бумаги', 'papers')], ['users', L('компания', 'friends')]];
function AxTicket({ stub, to, q, small, acts, later, laterLabel }) {
  return html`<div class="dk-tkw dk-axtk"><section class="dk-tk" aria-label=${L('Решение', 'Decision')}>
    <div class="dk-stub">${stub}</div>
    <div class="dk-tk-in"><div class="dk-tk-h"><span class="grow ellipsis">${to}</span>${later && html`<button class="dk-later" onClick=${later}>${laterLabel ?? L('Позже', 'Later')}</button>`}</div>
      <div class="dk-q">${q}</div>${small && html`<p class="dk-small">${small}</p>`}<div class="dk-acts">${acts}</div></div>
  </section></div>`;
}
const AxHero = ({ word, h, children }) => html`<section class="dk-axh" style=${`height:${h}px`}>${word && html`<${BigWord} text=${word} cls="dk-axw" />`}${children}</section>`;
const Steps = ({ list }) => html`<ol class="dk-axs">${list.map((s, i) => html`<li key=${i}><span>${i + 1}</span><span class="grow">${s}</span></li>`)}</ol>`;
const tgSteps = (a, last) => [L('Настройки Telegram', 'Telegram settings'), L('Автоматизация чатов', 'Chat automation'), last ?? html`@${a.bot}, ${L('право «Отвечать»', 'the right to reply')}`];

function AxConnect({ a, arg }) {
  const tg = a.tg.status, waOn = a.wa.status === 'button';
  const [m, setM] = useState(a.tg.mode ?? 'new');
  const [hide, setHide] = useState(false);
  const [busy, setBusy] = useState(false);
  const n = tgOpen(a);
  const start = () => { api('/app/api/access/set', { tg_mode: m }).catch(() => null); ax.openTg(); };
  const phone = () => { copyText('@' + a.bot); toast(L(`На телефоне: ${ax.TG_PATH()}, добавь @${a.bot}`, `On your phone: ${ax.TG_PATH()}, add @${a.bot}`)); };
  const setWa = async (v) => { setBusy(true); try { await ax.post('set', { wa: v }); hap.ok(); if (arg === 'wa') go(sp('access'), true); } catch (e) { ax.oops(e); } setBusy(false); };
  const tgSub = { off: L('Hunt видит только чаты, которые ты открыл', 'Hunt sees only the chats you open'), on: L('Открыты только те чаты, что ты выбрал', 'Only the chats you picked are open'), rights: L('Прав больше, чем нужно', 'More rights than needed'), revoking: L('Отзываем, осталось отключить бота', 'Taking it back: remove the bot') }[tg];
  let tk = null;
  if (arg === 'wa' && !waOn) tk = html`<${AxTicket} stub=${html`<b><${Icon} n="smartphone" /></b><span>${L('кнопкой', 'a button')}</span>`} to=${L('Твой WhatsApp', 'Your WhatsApp')} q=${L('Включить WhatsApp кнопкой?', 'Turn on WhatsApp by a button?')}
    small=${L('Hunt пишет текст и открывает твой WhatsApp, отправляешь ты', 'Hunt writes and opens your WhatsApp, you press send')} later=${() => go(sp('access'), true)}
    acts=${html`<button class="btn accent" data-key="1" disabled=${busy} onClick=${() => setWa('button')}>${L('Включить', 'Turn on')}</button>`} />`;
  else if (tg === 'off') tk = html`<${AxTicket} stub=${html`<b><${Icon} n="lock" /></b><span>${L('открыто', 'open')}<br />${L('0 чатов', '0 chats')}</span>`} to=${L('Твой Telegram', 'Your Telegram')}
    q=${m === 'new' ? L('Подключить новых людей?', 'Connect new people?') : L('Подключить только хозяев?', 'Connect owners only?')} small=${L('пароль и код не спрошу', 'no password, no code')} later=${() => setHide(true)}
    acts=${html`<button class="btn accent" data-key="1" onClick=${start}>${L('Открыть', 'Open')}</button><button class="btn surface" data-key="2" onClick=${phone}>${L('С телефона', 'From the phone')}</button>`} />`;
  else if (tg === 'rights') tk = html`<${AxTicket} stub=${html`<b>${a.tg.extra.length}</b><span>${L(ax.pn(a.tg.extra.length, ['лишнее', 'лишних', 'лишних']), 'too many')}</span>`} to=${L('Твой Telegram', 'Your Telegram')}
    q=${L('Убрать лишние права?', 'Remove the extra rights?')} small=${L('пока они включены, Hunt не читает и не пишет', 'while they are on, Hunt neither reads nor writes')}
    acts=${html`<button class="btn accent" data-key="1" onClick=${ax.openTg}>${L('Открыть настройки', 'Open settings')}</button><button class="btn surface" data-key="2" onClick=${loadAccess}>${L('Проверить', 'Check')}</button>`} />`;
  else if (tg === 'revoking') tk = html`<${AxTicket} stub=${html`<b><${Icon} n="hourglass" /></b><span>${L('ждём тебя', 'your turn')}</span>`} to="Telegram" q=${L('Осталось отключить бота', 'Only the bot is left')}
    acts=${html`<button class="btn accent" data-key="1" onClick=${() => go(sp('access', 'receipt'), true)}>${L('Открыть чек', 'Open the receipt')}</button>`} />`;
  return html`<div class="dk-main dk-ax">
    <section class="dk-axm">
      <${Typed} lines=${[L('Откуда пишем?', 'Where do we write from?')]} as="h1" cls="dk-say" />
      <${AxHero} h=${268}><${ax.Toy} n="chat-sky" s=${210} x="38%" y=${40} r=${-7} /><${ax.Toy} n="chat-green" s=${170} x="72%" y=${36} r=${9} /><${ax.Ani} x="86%" y=${178} s=${84} />
        ${tg === 'off' && !waOn && html`<${Sticker} text=${L('без паролей', 'login-free')} cls="ax-sticker" style="left:0;top:20px" />`}<//>
      <div class="ax-list dk-axl">
        <${ax.Row} title="Telegram" sub=${tgSub} right=${tg === 'on' ? html`<${ax.St} k="done">${L('подключён', 'connected')}<//>` : tg === 'off' ? html`<${ax.St} k="wait">${L('выбери чаты', 'pick chats')}<//>` : html`<${ax.St} k="wait">${L('ждём тебя', 'your turn')}<//>`}
          onClick=${tg === 'revoking' ? () => go(sp('access', 'receipt'), true) : null} />
        <${ax.Row} title="WhatsApp" sub=${L('Текст готовит Hunt, отправляешь ты', 'Hunt writes, you send')} right=${waOn ? html`<button class="btn sm surface" disabled=${busy} onClick=${() => setWa('off')}>${L('Выключить', 'Turn off')}</button>` : html`<button class="btn sm surface" disabled=${busy} onClick=${() => setWa('button')}>${L('Включить', 'Turn on')}</button>`} />
        <${ax.Row} title=${L('Что видит Hunt', 'What Hunt sees')} sub=${n || a.dropped ? L(`${n} ${ax.pn(n, ['чат', 'чата', 'чатов'])} с хозяевами`, `${n} chats with owners`) : L('пока ничего', 'nothing yet')} right=${html`<${ax.Go} />`} onClick=${() => go(sp('access', 'sees'))} />
        ${a.ai && html`<${ax.Row} title=${L('Деньги на ИИ', 'Money for AI')} right=${html`<${ax.Go} />`} onClick=${() => go(sp('access', 'limit'))} />`}
      </div>
      <p class="dk-axf">${L('Хозяевам пишешь ты, со своих аккаунтов. Hunt готовит текст и ждёт твоё «да»', 'You write to the owners from your own accounts. Hunt prepares the text and waits for your yes')}</p>
    </section>
    <section class="dk-axc">
      ${tg === 'on' ? html`<h2>${L('Что открыто', 'What is open')}</h2><div class="ax-list">
          <${ax.Row} ic="check" title=${L('Отвечать хозяевам', 'Reply to owners')} sub=${L('24 часа после их сообщения, с твоим «да»', '24 hours after their message, with your yes')} />
          <${ax.Row} ic="archive" title=${L('Старая переписка и группы', 'Old messages and groups')} right=${html`<${ax.St} k="lock">${L('закрыто', 'closed')}<//>`} />
          <${ax.Row} ic="users" title=${L('Остальные чаты', 'Other chats')} sub=${a.tg.mode === 'only' ? L('Только те, кого ты добавил', 'Only those you added') : L('Как ты выбрал в Telegram', 'As you picked in Telegram')} right=${html`<${ax.St} k="lock">Telegram<//>`} />
          <${ax.Row} ic="user-pen" title=${L('Имя, фото и звёзды', 'Name, photo and stars')} right=${html`<${ax.St} k="lock">${L('закрыто', 'closed')}<//>`} /></div>
          <div class="dk-pills"><button class="btn surface" onClick=${ax.openTg}>${L('Изменить в Telegram', 'Change in Telegram')}</button></div>`
        : tg === 'rights' ? html`<h2>${L('Это нам не нужно', 'We do not need this')}</h2><div class="ax-list">${a.tg.extra.map((k) => html`<${ax.Row} key=${k} ic="x" title=${ax.rightName(k)} right=${html`<${ax.St} k="wait">${L('убери', 'remove')}<//>`} />`)}<${ax.Row} ic="check" title=${L('Отвечать на сообщения', 'Reply to messages')} right=${html`<${ax.St} k="done">${L('нужно', 'needed')}<//>`} /></div>`
        : html`<h2>${L('Какие чаты открыть?', 'Which chats to open?')}</h2>
          <div class="ax-list" role="radiogroup" aria-label=${L('Какие чаты открыть', 'Which chats to open')}>
            <${ax.Radio} on=${m === 'new'} onClick=${() => { hap.sel(); setM('new'); }} title=${L('Только новые люди', 'New people only')} tag=${L('советуем', 'our pick')} sub=${L('Закрыты все старые чаты и все, кто у тебя в контактах', 'All old chats and everyone in your contacts stay closed')} />
            <${ax.Radio} on=${m === 'only'} onClick=${() => { hap.sel(); setM('only'); }} title=${L('Только хозяева', 'Owners only')} sub=${L('Добавляешь каждого сам. Чужих Hunt не увидит вообще', 'You add each one. Hunt sees nobody else at all')} />
          </div>`}
      ${tg !== 'on' && html`<h2>${L('Где это', 'Where')}</h2><${Steps} list=${tg === 'rights' ? tgSteps(a, html`@${a.bot}, ${L('сними лишние галочки', 'untick the extras')}`) : tgSteps(a)} />
        ${tg === 'off' && html`<div class="dk-pills"><button class="btn sm surface" onClick=${() => copyText('@' + a.bot)}><${Icon} n="copy" cls="sm" />@${a.bot}</button></div>`}`}
      ${!hide && tk}
    </section>
  </div>`;
}
const dayWord = (day) => { const k = Math.round((Date.parse(hmToday()) - Date.parse(day)) / 864e5); return k <= 0 ? L('сегодня', 'today') : k === 1 ? L('вчера', 'yesterday') : fmtDM(day); };
function AxSees({ a }) {
  const list = axContacts(a), n = list.filter((c) => !c.muted).length, gone = a.purges[0];
  const mute = async (c) => { hap.sel(); try { await ax.post('mute', { contact_id: c.id, on: !c.muted }); } catch (e) { ax.oops(e); } };
  return html`<div class="dk-main dk-ax">
    <section class="dk-axm">
      <${AxHero} word=${L('Вижу', 'I see')} h=${150}><${ax.Toy} n="eye" s=${150} x="58%" y=${-14} r=${-6} /><${ax.Ani} x="84%" y=${96} s=${70} /><//>
      <h1 class="dk-axn"><b>${n}</b> ${ax.pn(n, LANG === 'ru' ? ['чат', 'чата', 'чатов'] : ['chat', 'chats'])}</h1>
      <p class="dk-axsub">${n ? L('с хозяевами, больше ничего', 'with owners, nothing else') : L('пока никто из хозяев не писал', 'no owner has written yet')}</p>
      <div class="ax-list dk-axl dk-scroll">${list.map((c) => html`<${ax.Row} key=${c.id} cls=${c.muted ? 'off' : ''} title=${c.name ?? L('Без имени', 'No name')} sub=${[channelName(c.channel), c.muted ? L('не читаем', 'not read') : msgsN(c.n)].join(', ')}
        right=${html`<button class="btn sm surface thin" aria-label=${(c.muted ? L('Читать снова', 'Read again') : L('Не читать', 'Do not read')) + ': ' + (c.name ?? '')} onClick=${() => mute(c)}>${c.muted ? L('Читать', 'Read') : L('Не читать', 'Do not read')}</button>`} />`)}</div>
      <footer class="dk-axfig"><div><span>${L('чужого выброшено', 'thrown away')}</span><b>${a.dropped}${a.dropped ? L(', не глядя', ', unread') : ''}</b></div>${a.connected && html`<div><span>${L('удалим сами', 'we delete')}</span><b>${gone ? fmtDM(gone.at) : L(`через ${a.retain_days} дн. после поиска`, `${a.retain_days} days after`)}</b></div>`}</footer>
      <div class="dk-pills"><button class="btn surface" onClick=${() => go(sp('access', 'off'))}>${L('Отозвать всё', 'Take it all back')}</button><button class="btn surface" onClick=${ax.download}>${L('Скачать переписку', 'Download the chats')}</button></div>
    </section>
    <section class="dk-axc">
      <header class="dk-h2"><h1>${L('Кто открывал', 'Who opened')}</h1><span>${L('за месяц', 'this month')}</span></header>
      <div class="ax-list">${a.log.length ? a.log.map((x) => { const mm = x.via === 'agent' ? null : memberById(x.actor); const self = x.actor === D().user.id;
        return html`<div key=${x.actor + x.via} class="ax-row dk-axwho">${x.via === 'agent' ? html`<${HuntMark} />` : mm ? html`<${Av} m=${mm} size=${40} />` : html`<${Icon} n="user" />`}<span class="grow"><b>${x.via === 'agent' ? L('Твой агент', 'Your agent') : self ? L('Ты', 'You') : firstName(x.name ?? '')}</b><i>${dayWord(x.day)}${x.days > 1 ? L(`, дней: ${x.days}`, `, ${x.days} days`) : ''}</i></span></div>`; })
        : html`<p class="dk-none">${L('За месяц никто', 'Nobody this month')}</p>`}</div>
      <h2>${L('Как хранится', 'How it is kept')}</h2>
      <div class="ax-list">
        <${ax.Row} ic="lock" title=${a.sealed ? L('Зашифровано', 'Encrypted') : L('Не зашифровано', 'Not encrypted')} sub=${a.sealed ? L('твоим ключом, он не в базе', 'with your key, it is not in the database') : L('владелец сервера может открыть базу', 'whoever runs the server can open the database')} />
        ${a.sealed && html`<${ax.Row} ic="building" title=${L('Владелец сервера', 'Whoever runs the server')} sub=${L('технически может прочитать', 'can still read it, technically')} />`}
        ${a.connected && html`<${ax.Row} ic="calendar-clock" title=${L('Удаляем сами', 'We delete it ourselves')} sub=${L(`через ${a.retain_days} дней после поиска`, `${a.retain_days} days after the search`)} />`}
        ${a.receipts[0] && html`<${ax.Row} ic="receipt-text" title=${L('Чек отзыва', 'Receipt')} sub=${fmtDM(a.receipts[0].at) + ', ' + fmtTime(a.receipts[0].at)} right=${html`<${ax.Go} />`} onClick=${() => go(sp('access', 'receipt'))} />`}
      </div>
    </section>
  </div>`;
}
function AxOff({ a }) {
  const [busy, setBusy] = useState(false);
  const list = axContacts(a), total = list.reduce((s, c) => s + c.n, 0);
  const run = async (data) => { setBusy(true); try { await ax.post('revoke', { data }); hap.ok(); go(sp('access', 'receipt'), true); refresh(); } catch (e) { ax.oops(e); setBusy(false); } };
  return html`<div class="dk-main dk-ax">
    <section class="dk-axm">
      <${Typed} lines=${[L('Отзываем всё?', 'Take it all back?')]} as="h1" cls="dk-say" />
      <${AxHero} word=${L('Всё', 'All')} h=${300}><${ax.Toy} n="broom" s=${250} x="58%" y=${30} r=${6} /><${ax.Ani} x="22%" y=${170} s=${78} /><//>
      <div class="ax-list dk-axl">
        <${ax.Row} ic="eyeoff" title=${L('Перестанем читать и писать', 'We stop reading and writing')} sub=${L('Сразу, в Telegram и WhatsApp', 'At once, in Telegram and WhatsApp')} />
        <${ax.Row} ic="trash-2" title=${L('Удалим переписку', 'We delete conversations')} sub=${a.sealed ? L('Копии тоже станут нечитаемыми', 'Copies become unreadable too') : L('Копии базы живут ещё до 30 дней', 'Database copies live up to 30 days more')} />
        <${ax.Row} ic="log-out" title=${L('Выйдем на других устройствах', 'Other devices are signed out')} sub=${L('Сайт, ссылки и агент на компьютере', 'The site, links and the agent on a computer')} />
        <${ax.Row} ic="ban" title=${L('Что не вернуть', 'What cannot be undone')} sub=${L('Письма хозяевам, карточки в боте и то, что уже прочитал ИИ', 'Messages to owners, cards in the bot and what AI has read')} />
      </div>
      <p class="dk-axf">${L('Дом, деньги, афиша и планы останутся', 'The home, money, events and plans stay')}</p>
    </section>
    <section class="dk-axc">
      <header class="dk-h2"><h1>${L('Что уйдёт', 'What goes')}</h1><span>${msgsN(total)}</span></header>
      <div class="ax-list dk-scroll dk-axcl">${list.length ? list.map((c) => html`<${ax.Row} key=${c.id} title=${c.name ?? L('Без имени', 'No name')} sub=${[channelName(c.channel), msgsN(c.n)].join(', ')} />`) : html`<p class="dk-none">${L('Переписки нет', 'No conversations')}</p>`}</div>
      <h2>${L('Кто выйдет', 'Who is signed out')}</h2>
      <div class="ax-list"><${ax.Row} ic="smartphone" title=${L('Сайт и ссылки', 'The site and links')} sub=${L('все устройства, кроме этого', 'every device but this one')} /><${ax.Row} ic="laptop" title=${L('Агент на компьютере', 'The agent on a computer')} sub=${L('его ключи', 'its keys')} /></div>
      <${AxTicket} stub=${html`<b>${total}</b><span>${L(ax.pn(total, ['письмо', 'письма', 'писем']), total === 1 ? 'message' : 'messages')}</span>`} to=${L('Доступ к чатам', 'Access to chats')} q=${L('Отозвать и удалить переписку?', 'Take back and delete the chats?')}
        small=${L('обратно не вернуть', 'cannot be undone')} later=${back} laterLabel=${L('Назад', 'Back')}
        acts=${html`<button class="btn accent" data-key="1" disabled=${busy} onClick=${() => run(true)}>${L('Удалить', 'Delete')}</button><button class="btn surface" data-key="2" disabled=${busy} onClick=${() => run(false)}>${L('Только отключить', 'Only disconnect')}</button>`} />
    </section>
  </div>`;
}
function AxReceipt({ a }) {
  const r = a.receipts[0], wait = r.tg === 'wait' && a.tg.status === 'revoking';
  const again = async () => { try { await ax.post('set', { again: true }); go(sp('access'), true); } catch (e) { ax.oops(e); } };
  return html`<div class="dk-main dk-ax">
    <section class="dk-axm">
      <${Typed} lines=${[ax.rcTitle(r, wait)]} as="h1" cls="dk-say" />
      <${AxHero} word=${L('Отзыв', 'Revoke')} h=${wait ? 250 : 300}><${ax.Toy} n="lock" s=${wait ? 200 : 236} x="42%" y=${20} r=${-4} /><${ax.Ani} x="78%" y=${wait ? 150 : 190} s=${74} />
        ${r.copies === 'erased' && html`<${Sticker} text=${L('ключ стёрт', 'key erased')} cls="ax-sticker" style="left:58%;top:4px" />`}<//>
      <p class="dk-axf">${ax.rcSub(r, wait)}</p>
      ${wait && html`<${Steps} list=${tgSteps(a, html`@${a.bot}, ${L('«Убрать»', '“Remove”')}`)} />`}
      <div class="dk-pills">${wait ? html`<button class="btn accent" onClick=${ax.openTg}><${Icon} n="arrow-up-right" cls="sm" />${L('Отключить в Telegram', 'Remove in Telegram')}</button><button class="btn surface" onClick=${loadAccess}>${L('Проверить', 'Check')}</button>`
        : html`<button class="btn accent" onClick=${() => go(sp('today'), true)}>${L('Закрыть', 'Close')}</button><button class="btn surface" onClick=${again}>${L('Вернуться', 'Come back')}</button>`}</div>
    </section>
    <section class="dk-axc dk-axrc"><${ax.RcptPaper} a=${a} r=${r} wait=${wait} /></section>
  </div>`;
}
function DeskAccess({ arg }) {
  const { v: a, err } = ax.useAccess(['tg', 'tg-ok', 'receipt', undefined, null, ''].includes(arg));
  if (!a) return html`<div class="dk-main dk-col"><div class="dk-colin">${err ? msgCard(t('err_generic')) : skel(420)}</div></div>`;
  const k = axKind(arg, a);
  return k === 'sees' ? html`<${AxSees} a=${a} />` : k === 'off' ? html`<${AxOff} a=${a} />` : k === 'receipt' ? html`<${AxReceipt} a=${a} />` : html`<${AxConnect} a=${a} arg=${arg} />`;
}
function AccessDevice({ arg, desk }) {
  const { v: a } = ax.useAccess();
  if (!a) return html`<${Device} desk=${desk} log=${false} />`;
  const k = axKind(arg, a), tgOn = ['on', 'rights', 'revoking'].includes(a.tg.status);
  const r = a.receipts[0], wait = r?.tg === 'wait' && a.tg.status === 'revoking';
  if (k === 'sees') return html`<${Device} desk=${desk} title=${L('Чужое не смотрю', 'I do not look at the rest')} sub=${a.dropped ? L(`${a.dropped} ${ax.pn(a.dropped, ['письмо', 'письма', 'писем'])} выбросил, не открыв`, `${a.dropped} thrown away unopened`) : L('чужих писем не было', 'nothing foreign came in')} ph=${L('Спроси, что я видел', 'Ask what I saw')}>
    <${Tiles} list=${[['users', L('контакты', 'contacts')], ['archive', L('старое', 'old')], ['users-round', L('группы', 'groups')], ['phone', L('личный WhatsApp', 'own WhatsApp')], ['star', L('звёзды', 'stars')], ['undo', L('хозяева', 'owners'), true]]} /><//>`;
  if (k === 'off') return html`<${Device} desk=${desk} log=${false} title=${L('Уйду сразу', 'I leave at once')} sub=${tgOn ? L('дальше одно нажатие в Telegram', 'then one tap in Telegram') : L('без лишних шагов', 'no extra steps')} ph=${L('Спроси, что останется', 'Ask what stays')}>
    <${Lines} title=${L('По порядку', 'In order')} list=${[['1', L('перестаю читать', 'I stop reading')], ['2', L('стираю переписку и ключ', 'I erase the chats and the key')], ['3', L('выхожу на других устройствах', 'I sign out other devices')], ...(tgOn ? [['4', L('ты убираешь бота', 'you remove the bot')]] : [])]} />
    <h3 class="dk-axh3">${L('Останется', 'Stays')}</h3><${Tiles} list=${KEEP()} keep /><//>`;
  if (k === 'receipt') return html`<${Device} desk=${desk} log=${false} title=${L('Вот чек', 'Here is the receipt')} sub=${L('что сделано и что осталось', 'what is done and what is left')} ph=${L('Спроси про отзыв', 'Ask about it')}>
    <${Lines} title=${L('Осталось', 'Left')} list=${wait ? [['1', L('отключить бота в Telegram', 'remove the bot in Telegram')]] : [['—', L('ничего', 'nothing')]]} />
    <${Lines} title=${L('Если передумаешь', 'If you change your mind')} list=${[['1', L('подключишь заново, с нуля', 'connect again, from zero')], ...(r?.data === 'kept' ? [] : [['2', L('новый ключ, пустая переписка', 'a new key, no old chats')]])]} />
    <h3 class="dk-axh3">${L('Останется', 'Stays')}</h3><${Tiles} list=${KEEP()} keep /><//>`;
  return html`<${Device} desk=${desk} log=${false} title=${L('Личное закрыто', 'Private stays private')} sub=${L('так проверяет Telegram, а не я', 'Telegram enforces it, not me')} ph=${L('Спроси про доступ', 'Ask about access')}>
    <${Tiles} list=${[['users', L('контакты', 'contacts')], ['message-circle', L('старое', 'old')], ['users-round', L('группы', 'groups')], ['user-pen', L('профиль', 'profile')], ['star', L('звёзды', 'stars')], ['undo', L('ответить', 'reply'), true]]} />
    <${Lines} title=${L('Что смогу', 'What I can do')} list=${[[L('24 ч', '24 h'), L('ответить хозяину после его письма', 'reply to an owner after their message')], [L('да', 'yes'), L('только после твоего «да»', 'only after your yes')], [L('нет', 'no'), L('читать старое и группы', 'read old chats and groups')]]} /><//>`;
}

// ---------------------------------------------------------------- the door
/** Not signed in, in a normal browser: what Hunt is, sign-in through the bot with a number, or a one-time link. */
export function Door({ onIn }) {
  const code = (location.hash.match(/login=([\w.-]+)/) ?? [])[1];
  const [st, setSt] = useState(code ? { step: 'link', code } : { step: 'idle' });
  const [bad, setBad] = useState('');
  useEffect(() => { document.documentElement.dataset.tone = 'desk-lime'; }, []);
  const raw = async (path, body) => { const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error), { code: j.error, message: j.message }); return j; };
  useEffect(() => { if (code) raw('/app/api/web-login-link', { code, peek: true }).then((j) => setSt({ step: 'link', code, name: j.name })).catch(() => { setSt({ step: 'idle' }); setBad(L('Ссылка уже использована или устарела. Напиши боту /web ещё раз.', 'The link is used or too old. Send /web to the bot again.')); history.replaceState(null, '', location.pathname); }); }, []);
  useEffect(() => {
    if (st.step !== 'wait') return undefined;
    let live = true;
    const tick = async () => {
      if (!live) return;
      try {
        const j = await raw('/app/api/web-login-check', { id: st.id, secret: st.secret });
        if (!live) return;
        if (j.ok) return onIn();
        if (j.status === 'denied') { setBad(L('Вход отклонён. Попробуй ещё раз.', 'Refused. Try again.')); return setSt({ step: 'idle' }); }
        if (j.status === 'expired') { setBad(L('Время вышло. Попробуй ещё раз.', 'Time is up. Try again.')); return setSt({ step: 'idle' }); }
      } catch { /* try again */ }
      setTimeout(tick, 1800);
    };
    const tm = setTimeout(tick, 1500);
    return () => { live = false; clearTimeout(tm); };
  }, [st.step, st.id]);
  const begin = async () => { setBad(''); try { const j = await raw('/app/api/web-login'); setSt({ step: 'wait', ...j }); if (j.url) window.open(j.url, '_blank', 'noopener'); } catch (e) { setBad(e.message || t('err_generic')); } };
  const byLink = async () => { try { const j = await raw('/app/api/web-login-link', { code }); history.replaceState(null, '', location.pathname); if (j.ok) onIn(); else setBad(L('Ссылка устарела', 'The link is too old')); } catch { setBad(L('Ссылка устарела', 'The link is too old')); setSt({ step: 'idle' }); } };
  const steps = [[L('Расскажи', 'Tell'), L('куда, с кем, сколько', 'where, with whom, how much')], [L('Hunt ищет и пишет', 'Hunt searches and writes'), 'Telegram, WhatsApp'], [L('Ты говоришь «да»', 'You say yes'), L('цена и деньги через тебя', 'price and money through you')], [L('Живите', 'Live'), L('вода, свет, афиша', 'water, power, events')]];
  return html`<main class="dk-door">
    <section class="dk-door-l"><span class="dk-logo">hunt</span>
      <${Typed} as="h1" lines=${[L('Hunt найдёт дом, собьёт цену и поможет жить', 'Hunt finds a home, bargains and helps you live there')]} cls="dk-say xl" />
      <p class="dk-lead">${L('Личный ассистент, чтобы снять дом за границей с друзьями. Сам пишет хозяевам, решаешь ты.', 'A personal assistant for renting a home abroad with friends. It writes to owners, you decide.')}</p>
      ${st.step === 'wait' ? html`<div class="dk-num" role="status"><b>${st.number}</b><p>${L('Открой бота и нажми это число.', 'Open the bot and press this number.')}<br /><a href=${st.url} target="_blank" rel="noopener">${L('Открыть бота ещё раз', 'Open the bot again')}</a> · <button onClick=${() => setSt({ step: 'idle' })}>${t('cancel')}</button></p></div>`
        : st.step === 'link' ? html`<div class="dk-acts"><button class="btn accent big" disabled=${!st.name} onClick=${byLink}>${L(`Войти как ${st.name ?? '…'}`, `Sign in as ${st.name ?? '…'}`)}</button></div>`
        : html`<div class="dk-acts"><button class="btn accent big" onClick=${begin}><${Icon} n="send" cls="sm" />${L('Войти через Telegram', 'Sign in with Telegram')}</button></div><div class="dk-demo"><button onClick=${demoStart}>${L('Посмотреть демо', 'See the demo')} →</button><a href="https://github.com/LevDomasnih/hunt" target="_blank" rel="noopener">${L('Поставить свой', 'Run your own')}</a></div><p class="dk-hint">${L('Или напиши боту /web, он пришлёт ссылку на один раз.', 'Or send /web to the bot for a one-time link.')}</p>`}
      ${bad && html`<p class="dk-bad" role="alert">${bad}</p>`}
    </section>
    <section class="dk-door-m" aria-hidden="true">
      <div class="dk-door-ph"><div class="frame"><span class="in"><img src="/demo-home/field.webp" alt="" /></span></div><${Sticker} text=${L('ты сказал да', 'you said yes')} cls="lg" style="left:-4%;top:-7%;--r:-10deg" /><div class="dk-toys"><img src="/demo-home/animals/kingfisher-full-192.webp" alt="" /><img src="/demo-home/animals/myna-full-192.webp" alt="" /></div></div>
      <div class="dk-deal"><div><b class="dk-big blur">25</b><span>${L('просили, млн', 'asked, m')}</span></div><div class="dk-deal-b"><div class="dk-bub in"><p>${L('25 миллионов', '25 million')}</p><small>25 juta, kak</small></div><div class="dk-bub out"><p>${L('Рядом похожие по 23. Уступите?', 'Similar ones are 23. Less?')}</p><small>Di sini 23, kurang ya?</small></div></div></div>
      <div class="dk-tkw"><div class="dk-tk"><div class="dk-stub"><b>22</b><span>${L('млн в месяц', 'm a month')}</span></div><div class="dk-tk-in"><div class="dk-tk-h"><span>Wayan, WhatsApp</span></div><div class="dk-q">${L('Дешевле на 3 миллиона', '3 million less')}</div><p class="dk-small">${L('без твоего «да» ничего не уходит', 'nothing goes without your yes')}</p></div></div></div>
    </section>
    <aside class="dk-dev" aria-hidden="true"><header class="dk-dev-h"><${HuntMark} /><div class="grow"><b>Hunt</b><span><i class="on"></i>${L('пример, вилла на Буките', 'an example, a villa on Bukit')}</span></div></header>
      <div class="dk-dev-b"><h2>${L('Сторговался за вечер', 'A deal in one evening')}</h2><p class="dk-dev-s">${L('вы в это время ужинали', 'you were having dinner')}</p>
        <svg class="dk-lines" viewBox="0 0 250 190"><path d="M4 12 L122 92 L236 150" stroke="#F2E33A" /><path d="M54 182 L150 150 L236 150" stroke="#F2F0EA" /><circle cx="4" cy="12" r="6" fill="#F2E33A" /><circle cx="122" cy="92" r="6" fill="#F2E33A" /><circle cx="54" cy="182" r="6" fill="#F2F0EA" /><circle cx="150" cy="150" r="6" fill="#F2F0EA" /><circle cx="236" cy="150" r="13" fill="#F2E33A" /><text x="18" y="17">Wayan</text><text x="14" y="187">${L('мы', 'us')}</text></svg>
        <div class="dk-log"><h3>${L('Что сделал', 'What it did')}</h3>${[['18:52', L('узнал цену', 'asked the price')], ['19:04', L('сверил 14 домов рядом', 'compared 14 homes')], ['19:30', L('написал по-индонезийски', 'wrote in Indonesian')], ['19:40', L('не показал твой потолок', 'kept your limit private')], ['19:41', L('спросил тебя', 'asked you')]].map(([a, b]) => html`<div key=${a}><time>${a}</time><span>${b}</span></div>`)}</div></div></aside>
    <ol class="dk-steps">${steps.map(([a, b], i) => html`<li key=${i}><b>${i + 1}</b><div><strong>${a}</strong><span>${b}</span></div></li>`)}</ol>
  </main>`;
}
/** Signed-in browsers (settings): end one, end all. Only for the cookie sign-in. */
export function Sessions() {
  const [v, setV] = useState(null);
  useEffect(() => { fetch('/app/api/web-sessions').then((r) => (r.ok ? r.json() : null)).then((j) => setV(j?.sessions ?? [])).catch(() => setV([])); }, []);
  const end = async (id) => { await api('/app/api/web-sessions', { end: id }).catch(() => null); if (id === 'all' || id === 'this') location.reload(); else setV((x) => x.filter((y) => y.id !== id)); };
  if (!v?.length) return null;
  return html`<p class="section" style="margin-top:0">${L('Где открыт сайт', 'Signed in on')}</p><div class="card grp">${v.map((x) => html`<div key=${x.id} class="opt"><div class="grow"><div>${x.device ?? '?'}</div><div class="muted" style="font-size:13px">${x.current ? L('этот браузер', 'this browser') : fmtDM(x.last_at) + ' ' + fmtTime(x.last_at)}</div></div><button class="btn link" onClick=${() => end(x.current ? 'this' : x.id)}>${L('Выйти', 'Sign out')}</button></div>`)}</div>${v.length > 1 && html`<button class="btn ghost block" onClick=${() => end('all')}>${L('Выйти везде', 'Sign out everywhere')}</button>`}`;
}
