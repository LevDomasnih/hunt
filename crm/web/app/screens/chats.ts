import type { Thread } from '../../types/api.js';
import { DraftScreen } from '../../access.js';
import { api, refresh } from '../core/api.js';
import { D, listingById, photosOf, priceText, shortLabel } from '../core/data.js';
import { CHANNEL, agoLabel, channelName, dayKey, firstName, fmtTime, initial, shortTitle } from '../core/format.js';
import { LANG, STR, cap, t } from '../core/i18n.js';
import { back, go, openLink, sp } from '../core/routing.js';
import { emit, hap, toast } from '../core/store.js';
import { homeListing, homeMode } from '../home/homemode.js';
import { Icon } from '../ui/icons.js';
import { Nav, Typed } from '../ui/pieces.js';
import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';

// ---------------------------------------------------------------- chats
export const CH_ORDER = ['telegram', 'whatsapp', 'viber', 'line', 'messenger', 'instagram', 'email', 'phone'];
export const CH_ICON = { telegram: 'send', whatsapp: 'msg', messenger: 'msgs', instagram: 'insta', email: 'mail', phone: 'phone', viber: 'phone', line: 'msg' };
export const ST_ORDER = { waiting_us: 0, waiting_them: 1, closed: 2 };
export function channelsOf(cid) {
  return (D()?.channels ?? []).filter((c) => c.contact_id === cid).sort((a, b) => (CH_ORDER.indexOf(a.channel) + 99) % 99 - (CH_ORDER.indexOf(b.channel) + 99) % 99);
}
export function channelLink(ch, addr) {
  const a = String(addr ?? '').trim();
  if (!a) return null;
  if (ch === 'whatsapp') { const n = a.replace(/\D/g, ''); return n ? `https://wa.me/${n}` : null; }
  if (ch === 'telegram') { const u = a.replace(/^@/, ''); return /^\d+$/.test(u) ? `tg://user?id=${u}` : `https://t.me/${u}`; }
  if (ch === 'messenger') return `https://www.facebook.com/messages/t/${encodeURIComponent(a)}`;
  if (ch === 'instagram') return `https://ig.me/m/${a.replace(/^@/, '')}`;
  if (ch === 'viber') { const n = a.replace(/\D/g, ''); return n ? `viber://chat?number=%2B${n}` : null; }
  if (ch === 'line') return a.startsWith('@') ? `https://line.me/R/ti/p/${encodeURIComponent(a)}` : /line\.me\//i.test(a) ? a : `https://line.me/R/ti/p/~${encodeURIComponent(a)}`;
  if (ch === 'email') return `mailto:${a}`;
  if (ch === 'phone') return `tel:${a.replace(/[^\d+]/g, '')}`;
  return null;
}
export function fmtAddr(ch, a) {
  if (!['whatsapp', 'viber', 'phone'].includes(ch)) return a;
  const n = String(a).replace(/\D/g, '');
  if (n.startsWith('62') && n.length >= 10) return `+62 ${n.slice(2, 5)}-${n.slice(5, 9)}-${n.slice(9)}`;
  if (n.startsWith('7') && n.length === 11) return `+7 ${n.slice(1, 4)} ${n.slice(4, 7)}-${n.slice(7, 9)}-${n.slice(9)}`;
  if (n.startsWith('66') && n.length >= 10) return `+66 ${n.slice(2, 4)} ${n.slice(4, 7)} ${n.slice(7)}`;
  return a;
}
export const roleLabel = (r) => (!r ? null : STR[LANG]['role_' + r] ? t('role_' + r) : r);
export function contactName(th) {
  const ch = channelsOf(th.contact_id)[0];
  return th.contact_name || ch?.display || (ch ? fmtAddr(ch.channel, ch.address) : '?');
}
export function sortedThreads() {
  return [...(D()?.threads ?? [])].sort((a, b) => (ST_ORDER[a.state] ?? 3) - (ST_ORDER[b.state] ?? 3) || String(b.last_at ?? '').localeCompare(String(a.last_at ?? '')));
}
/** Wave 8.3 (design/mockup-v8): once the home is chosen, chats about other homes are the search archive, read only. The home's
 * chats stay: the chosen home, house contacts, and everyone not tied to a listing (suppliers, bikes, couriers). */
export function thArchived(th) {
  if (!th?.listing_id || !homeMode()) return false;
  const hl = homeListing();
  return !!hl && th.listing_id !== hl.id && !(D().house_contacts ?? []).some((c) => c.contact_id === th.contact_id);
}
/** The archive list or an archived chat is open (route arg). */
export const chArchRoute = (arg) => arg === 'archive' || thArchived((D()?.threads ?? []).find((x) => x.contact_id === arg));
export const homeThreads = () => sortedThreads().filter((x) => !thArchived(x));
export const archThreads = () => sortedThreads().filter(thArchived);
/** An archived home that wrote after the move: the agent marks it waiting_us; it never counts as "waiting for you". */
export const archNew = () => archThreads().filter((x) => x.state === 'waiting_us').length;
export const HC_ROLE_IC = { owner: 'key-round', manager: 'key-round', cleaning: 'sparkles', pool: 'waves', repair: 'wrench', security: 'lock', internet: 'wifi', garden: 'house', other: 'house' };
/** A home chat row: {title, sub, icon, photo}. House contacts read as their role ("Бассейн"), the home's own chat as the owner. */
export function homeRow(th) {
  const hc = (D().house_contacts ?? []).find((c) => c.contact_id === th.contact_id);
  const ch = channelName(channelsOf(th.contact_id)[0]?.channel);
  const l = listingById(th.listing_id);
  if (hc) return { title: cap(t('hc_' + hc.role)), sub: [firstName(hc.name || contactName(th)), ch].filter(Boolean).join(', '), icon: HC_ROLE_IC[hc.role] ?? 'house' };
  if (l) return { title: cap(roleLabel(th.contact_role) ?? t('role_owner')), sub: [firstName(contactName(th)), ch].filter(Boolean).join(', '), photo: photosOf(l)[0] };
  return { title: contactName(th), sub: [roleLabel(th.contact_role), ch].filter(Boolean).join(', '), icon: 'msg' };
}
export const waitingUs = () => homeThreads().filter((x) => x.state === 'waiting_us').length;
export const threadsForListing = (lid) => sortedThreads().filter((x) => x.listing_id === lid);
export function threadSub(th) {
  const l = listingById(th.listing_id);
  if (!l) return '';
  return [shortLabel(l), l.decision === 'take' ? t('d_take') : priceText(l)].filter(Boolean).join(' · ');
}
export function ThreadThumb({ th }) {
  const l = listingById(th.listing_id);
  const ch = channelsOf(th.contact_id)[0]?.channel;
  const ph = photosOf(l)[0];
  return html`<span class="th-thumb">${ph ? html`<img src=${ph} alt="" loading="lazy" decoding="async" />` : html`<span class="letter">${initial(contactName(th))}</span>`}
    ${ch && html`<span class=${'ch-badge ch-' + ch}><${Icon} n=${CH_ICON[ch] ?? 'msg'} /></span>`}</span>`;
}
export function ThreadCard({ th }) {
  // V4-11: a hairline row — name + channel, a status pill on the right, the last message under it
  const ch = channelsOf(th.contact_id)[0]?.channel;
  return html`<button class="th-card th8" onClick=${() => { hap.sel(); go(sp('chats', th.contact_id)); }}>
    <div class="row th-hd"><b class="ellipsis">${contactName(th)}</b>${ch && html`<span class="th8-ch">${CHANNEL[ch] ?? ch}</span>`}<span class="grow"></span><span class=${'st-chip s-' + th.state}>${t('st_' + th.state)}</span></div>
    ${threadSub(th) && html`<div class="th-sub ellipsis">${[threadSub(th), th.last_at ? agoLabel(th.last_at) : null].filter(Boolean).join(' · ')}</div>`}
    ${th.last && html`<div class="th-last">${th.last}</div>`}
  </button>`;
}
export function Chats({ arg }) {
  const d = D();
  const all = sortedThreads();
  const nUs = all.filter((x) => x.state === 'waiting_us').length;
  const nThem = all.filter((x) => x.state === 'waiting_them').length;
  const [f, setF] = useState(nUs ? 'waiting_us' : 'all');
  if (arg && arg !== 'archive') return html`<${ChatDetail} cid=${arg} />`;
  if (homeMode()) return html`<${HomeChats} arch=${arg === 'archive'} />`;
  const list = f === 'all' ? all : all.filter((x) => x.state === f);
  return html`<main class="screen ch8">
    <div class="head"><div><p class="kicker">${[shortTitle(d.search.title), t('n_convs', { n: all.length })].join(' · ')}</p><h1 class="sr">${t('chats')}</h1><${Typed} lines=${[t('w8_who_wrote')]} /></div></div>
    ${all.length ? html`<div class="filters" role="toolbar">
        <button class="filter" aria-pressed=${f === 'waiting_us' ? 'true' : 'false'} onClick=${() => { hap.sel(); setF('waiting_us'); }}>${t('f_waiting_us')} <b>${nUs}</b></button>
        <button class="filter" aria-pressed=${f === 'waiting_them' ? 'true' : 'false'} onClick=${() => { hap.sel(); setF('waiting_them'); }}>${t('f_waiting_them')} <b>${nThem}</b></button>
        <button class="filter" aria-pressed=${f === 'all' ? 'true' : 'false'} onClick=${() => { hap.sel(); setF('all'); }}>${t('f_all_chats')}</button>
      </div>
      <div class="th8-list">${list.map((th) => html`<${ThreadCard} key=${th.contact_id} th=${th} />`)}</div>
      ${!list.length && html`<p class="empty-note">—</p>`}`
    : html`<div class="card" style="padding:18px"><p class="muted" style="margin:0">${t('no_threads')}</p></div>`}
    <${Nav} tab="today" />
  </main>`;
}
/** Wave 8.3 (design/mockup-v8): once the home is chosen, the list is the home (waiting first) + one row into the search archive. */
export function HomeRow({ th, arch }) {
  const r = arch ? null : homeRow(th), l = listingById(th.listing_id), ph = r ? r.photo : photosOf(l)[0];
  const sub = r ? r.sub : [firstName(contactName(th)), channelName(channelsOf(th.contact_id)[0]?.channel)].filter(Boolean).join(', ');
  return html`<button class="hc8-row" onClick=${() => { hap.sel(); go(sp('chats', th.contact_id)); }}>
    ${ph ? html`<img class="hc8-ph" src=${ph} alt="" loading="lazy" decoding="async" />` : html`<span class="hc8-ic"><${Icon} n=${r?.icon ?? 'msg'} /></span>`}
    <span class="grow"><b class="ellipsis">${r ? r.title : shortTitle(l?.title) || contactName(th)}</b><span class="ellipsis">${th.state === 'waiting_us' && th.last ? th.last : sub}</span></span>
    <span class="hc8-end">${th.last_at && html`<time>${agoLabel(th.last_at)}</time>`}${arch && l?.price ? html`<b>${priceText(l)}</b>` : null}</span></button>`;
}
export function HomeChats({ arch }) {
  const d = D(), dr = new Set((d.drafts ?? []).map((x) => x.contact_id));
  const wait = (th) => th.state === 'waiting_us' || dr.has(th.contact_id);
  const groups: [string, Thread[]][] = arch
    ? [[t('ch_arch_wrote'), archThreads().filter(wait)], [t('ch_arch_no'), archThreads().filter((x) => !wait(x) && x.state !== 'waiting_them')], [t('ch_arch_quiet'), archThreads().filter((x) => !wait(x) && x.state === 'waiting_them')]]
    : [[t('ch_wait'), homeThreads().filter(wait)], [t('ch_home'), homeThreads().filter((x) => !wait(x))]];
  const nArch = arch ? 0 : archThreads().length, nNew = nArch ? archNew() : 0;
  return html`<main class="screen no-nav ch8 hc8">
    <div class="head"><button class="round sm" aria-label=${t('back')} onClick=${() => (arch ? go(sp('chats'), true) : back())}><${Icon} n="left" /></button>
      <div class="grow"><h1 class="sr">${arch ? t('ch_arch') : t('chats')}</h1><${Typed} key=${arch ? 'a' : 'h'} lines=${[arch ? t('ch_arch') : t('w8_who_wrote')]} /></div></div>
    ${arch && html`<p class="hc8-note">${t('ch_arch_note')}</p>`}
    ${groups.filter(([, x]) => x.length).map(([g, list]) => html`<section key=${g}><h3 class="hc8-cap">${g} <i>${list.length}</i></h3>${list.map((th) => html`<${HomeRow} key=${th.contact_id} th=${th} arch=${arch} />`)}</section>`)}
    ${groups.every(([, x]) => !x.length) && html`<p class="empty-note">${arch ? t('ch_arch_empty') : t('no_threads')}</p>`}
    ${nArch > 0 && html`<button class="hc8-row hc8-arch" onClick=${() => { hap.sel(); go(sp('chats', 'archive')); }}><span class="hc8-ic"><${Icon} n="archive" /></span>
      <span class="grow"><b>${t('ch_arch')}</b><span>${t('ch_arch_sub', { n: nArch })}</span></span>${nNew > 0 && html`<span class="hc8-new">${t('ch_arch_new', { n: nNew })}</span>`}</button>`}
  </main>`;
}
export function ChatDetail({ cid }) {
  const d = D();
  const th = (d.threads ?? []).find((x) => x.contact_id === cid);
  const draft = (d.drafts ?? []).find((x) => x.contact_id === cid);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  useEffect(() => { setEditing(false); setText(draft?.text ?? ''); setMore(false); }, [draft?.id]);
  if (draft && d.me.role === 'owner' && !more) return html`<${DraftScreen} draft=${draft} th=${th} onMore=${() => { if (th) setMore(true); else back(); }} />`;
  if (!th) return html`<main class="screen no-nav"><div class="center-msg">—</div></main>`;
  const chs = channelsOf(cid);
  const main = chs[0];
  const l = listingById(th.listing_id);
  const sub = [main ? channelName(main.channel) : null, roleLabel(th.contact_role), l ? shortLabel(l) : null].filter(Boolean).join(' · ');
  const upd = th.updated_at ? (dayKey(th.updated_at) === dayKey(new Date().toISOString()) ? t('at_time', { t: fmtTime(th.updated_at) }) : agoLabel(th.updated_at)) : null;
  const others = [
    ...chs.slice(1).map((c) => ({ c, who: null })),
    ...(d.listing_contacts ?? []).filter((x) => x.listing_id === th.listing_id && x.contact_id !== cid)
      .flatMap((x) => channelsOf(x.contact_id).map((c) => ({ c, who: firstName(x.name ?? '') }))),
  ];
  async function act(action) {
    setBusy(true);
    try {
      await api('/app/api/draft', { draft_id: draft.id, action, text: action === 'send' && editing ? text : undefined });
      action === 'send' ? hap.ok() : hap.sel();
      toast(t(action === 'send' ? 'approved_toast' : 'skipped_toast'));
      D().drafts = D().drafts.filter((x) => x.id !== draft.id);
      emit();
      refresh();
    } catch (e) { toast(e.code === 'already_decided' ? t('approve_done') : t('err_generic')); }
    setBusy(false);
  }
  const blk = (ic, cls, title, body) => body && html`<div class="b-sec"><div class=${'b-lbl ' + cls}><${Icon} n=${ic} cls="sm" />${title}</div><p>${body}</p></div>`;
  const arch = thArchived(th), link = main && !arch ? channelLink(main.channel, main.address) : null;
  return html`<main class="screen no-nav chat">
    <div class="chat-head"><button class="round sm" aria-label=${t('back')} onClick=${back}><${Icon} n="left" /></button>
      <button class="grow chat-who" onClick=${() => go(sp('contact', cid))}><h1 class="h1 ellipsis">${contactName(th)}</h1>${sub && html`<p class="kicker ellipsis">${sub}</p>`}</button>
      <button class="round sm" aria-label=${t('pn_person')} onClick=${() => go(sp('contact', cid))}><${Icon} n="users" /></button></div>
    <div class="row" style="margin:4px 0 14px;flex-wrap:wrap;gap:8px">${arch && html`<span class="hc8-tag"><${Icon} n="archive" cls="xs" />${t('ch_arch_tag')}</span>`}<span class=${'st-chip big s-' + th.state}>${t('stl_' + th.state)}</span>${upd && html`<span class="muted" style="font-size:13px">${t('updated_by_agent', { when: upd })}</span>`}</div>
    <div class="card b-card">
      ${blk('circlecheck', 'ok', t('known'), th.known)}
      ${blk('help', 'q', t('open_q'), th.open)}
      ${blk('msg', '', t('last_msg'), th.last ? `${th.last}${th.last_at ? ' · ' + agoLabel(th.last_at) : ''}` : null)}
      ${!th.known && !th.open && !th.last && html`<div class="b-sec"><p class="muted">—</p></div>`}
    </div>
    ${draft && d.me.role === 'owner' && html`<div class="card draft-card">
      <div class="b-lbl acc"><${Icon} n="sparkles" cls="sm" />${t('agent_draft')}</div>
      ${editing ? html`<textarea class="edit-area" aria-label=${t('edit_text')} value=${text} onInput=${(e) => setText(e.currentTarget.value)}></textarea>`
        : html`<div class="bubble out">${draft.text}</div>`}
      <div class="row" style="margin-top:12px">
        <button class="btn accent grow" disabled=${busy || (editing && !text.trim())} onClick=${() => act('send')}><${Icon} n="send" cls="sm" />${t('send')}</button>
        <button class="round sm soft" aria-label=${t('edit_text')} aria-pressed=${editing} onClick=${() => setEditing(!editing)}><${Icon} n="pencil" cls="sm" /></button>
        <button class="round sm soft" aria-label=${t('dont_send')} disabled=${busy} onClick=${() => act('skip')}><${Icon} n="x" cls="sm" /></button>
      </div></div>`}
    <div class="chat-foot">
      ${arch && html`<p class="hc8-lock"><${Icon} n="lock" cls="sm" />${t('ch_locked')}</p>`}
      ${link && html`<button class="btn surface block big" onClick=${() => openLink(link)}><${Icon} n=${CH_ICON[main.channel] ?? 'msg'} cls="sm" />${t('open_in', { ch: channelName(main.channel) })}<${Icon} n="ext" cls="sm muted" /></button>`}
      ${others.length > 0 && html`<p class="also">${t('more_contacts')} ${others.map(({ c, who }, i) => html`${i ? ', ' : ''}<button class="lnk" onClick=${() => openLink(channelLink(c.channel, c.address))}>${[channelName(c.channel), who].filter(Boolean).join(' ')} · ${fmtAddr(c.channel, c.address)}</button>`)}</p>`}
    </div>
  </main>`;
}
