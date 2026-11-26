// Split from app.js (wave 11): see the section comment below.
import { D, canVoteRole, districtName, fmtScore, listingById, memberById, photosOf, priceText, sceneStyle, shortLabel, votesFor } from '../core/data.js';
import { inTG } from '../core/env.js';
import { agoLabel, channelName, firstName, fmtDayMonth, fmtTime, money, relIn, shortTitle, todayTitle, tzNow, whenLabel } from '../core/format.js';
import { LANG, STR, human, t } from '../core/i18n.js';
import { go, openLink, sp } from '../core/routing.js';
import { hap, openSheet, toast } from '../core/store.js';
import { GuestDrafts } from '../home/guests.js';
import { chevRow } from '../home/helpers.js';
import { NextCard } from '../home/moveout.js';
import { SurfWaterCard, briefMentionsSurf, surfCache } from '../home/surf.js';
import { Av, Icon, Img } from '../ui/icons.js';
import { AniStickers, FloatPhoto, Nav, Sticker, Typed } from '../ui/pieces.js';
import { contactName, waitingUs } from './chats.js';
import { PathStrip } from './path.js';
import { html } from 'htm/preact';

// ---------------------------------------------------------------- today
export function feedView(item, all?) {
  const d = D();
  const tz = tzNow();
  if (item.type === 'message') {
    const l = listingById(item.listing_id);
    return {
      av: html`<${Av} m=${{ name: item.contact_name ?? '?' }} size=${36} />`,
      t1: item.contact_name ? `${item.contact_name}: «${item.text ?? ''}»` : `«${item.text ?? ''}»`,
      t2: [channelName(item.channel), agoLabel(item.at), l ? shortLabel(l) : null].filter(Boolean).join(' · '),
      go: l ? sp('listing', l.id) : null,
    };
  }
  const m = memberById(item.actor);
  const name = m ? firstName(m.name) : item.name ? firstName(item.name) : t('agent');
  const memberAv = html`<${Av} m=${m ?? { name }} size=${36} />`;
  const agentAv = html`<span class="feed-ic"><${Icon} n="sparkles" cls="sm" /></span>`;
  const l = listingById(item.ref);
  const title = l?.title ?? item.data?.title ?? '';
  const lsub = l ? [priceText(l), districtName(l), agoLabel(item.at)].filter(Boolean).join(' · ') : agoLabel(item.at);
  switch (item.kind) {
    case 'vote':
      return { av: memberAv, t1: t('feed_' + (item.data?.decision ?? 'want_view'), { name, title }), t2: lsub, go: l ? sp('listing', l.id) : null };
    case 'rating':
      return { av: memberAv, t1: t('feed_rating', { name, title: shortTitle(title), score: item.data?.score != null ? fmtScore(item.data.score) : '' }), t2: [item.data?.note, agoLabel(item.at)].filter(Boolean).join(' · '), go: l ? sp('listing', l.id) : null };
    case 'comment':
    case 'chat':
      return { av: memberAv, t1: t('feed_' + item.kind, { name, text: item.data?.text ?? '' }), t2: l ? lsub : `${t('chat')} · ${agoLabel(item.at)}`, go: l ? sp('listing', l.id) : null };
    case 'instruction':
      return { av: memberAv, t1: t('feed_instruction', { name, text: item.data?.text ?? '' }), t2: agoLabel(item.at) };
    case 'draft_decided':
      return { av: memberAv, t1: t('feed_draft_' + (item.data?.status ?? 'approved')), t2: `${name} · ${agoLabel(item.at)}` };
    case 'listing_added': {
      const n = item.group ?? 1;
      return { av: agentAv, t1: n > 1 ? t('feed_found_n', { n }) : t('feed_found_one', { title }), t2: n > 1 ? agoLabel(item.at) : lsub, go: n > 1 ? sp('listings') : l ? sp('listing', l.id) : null };
    }
    case 'viewing_changed': {
      const v = d.viewings.find((x) => x.id === item.ref);
      const vl = v ? listingById(v.listing_id) ?? { title: v.title } : null;
      const st = item.data?.status ?? v?.status ?? 'proposed';
      const time = item.data?.starts_at ? fmtTime(item.data.starts_at, tz) : v ? fmtTime(v.starts_at, tz) : '';
      const vt = vl?.title ?? '';
      const key = { confirmed: 'feed_confirmed', done: 'feed_done', cancelled: 'feed_cancelled' }[st] ?? 'feed_proposed';
      return { av: html`<${Av} m=${{ name: vt }} size=${36} />`, t1: t(key, { title: vt, time }), t2: agoLabel(item.at), go: v ? sp('listing', v.listing_id) : null };
    }
    case 'brief_changed': {
      const keys = item.data?.keys ?? (item.data?.changes ?? []).map((c) => c.key);
      const what = [...new Set(keys.map((k) => (/^budget/.test(k) ? 'budget' : k)))].map((k) => (STR[LANG]['bk_' + k] ? t('bk_' + k) : human(k))).join(', ');
      return { av: memberAv, t1: t('feed_brief', { what }), t2: `${name} · ${agoLabel(item.at)}`, go: sp('brief') };
    }
    case 'checklist':
      return { av: memberAv, t1: t(item.data?.done ? 'feed_check_on' : 'feed_check_off', { name, text: item.data?.text ?? '' }), t2: agoLabel(item.at), go: sp('deal') };
    case 'thread': {
      const th = (d.threads ?? []).find((x) => x.contact_id === item.ref);
      const who = th ? contactName(th) : item.data?.contact_name ?? '?';
      const st = th?.state ?? item.data?.state;
      return {
        av: html`<${Av} m=${{ name: who }} size=${36} />`,
        t1: `${who}: ${item.data?.last ?? th?.last ?? ''}`,
        t2: [st ? t('feed_thread_sub', { state: t('st_' + st).toLowerCase() }) : null, agoLabel(item.at)].filter(Boolean).join(' · '),
        go: th ? sp('chats', th.contact_id) : null,
      };
    }
    case 'expense':
      return { av: m ? memberAv : agentAv, t1: t('feed_expense', { name, title: item.data?.title ?? '', x: money(item.data?.amount, item.data?.currency) }), t2: agoLabel(item.at), go: sp('money') };
    case 'settled':
      return { av: memberAv, t1: t('feed_settled', { name, x: money(item.data?.amount, item.data?.currency) }), t2: agoLabel(item.at), go: sp('money') };
    case 'issue':
      return { av: m ? memberAv : agentAv, t1: t('feed_issue_' + (item.data?.status ?? 'open'), { title: item.data?.title ?? '' }), t2: [item.data?.note, agoLabel(item.at)].filter(Boolean).join(' · '), go: sp('home') };
    case 'document':
      return { av: m ? memberAv : agentAv, t1: t(item.data?.status === 'request' ? 'feed_document_request' : 'feed_document', { title: item.data?.title ?? '' }), t2: `${m ? name + ' · ' : ''}${agoLabel(item.at)}`, go: sp('docs') };
    case 'stage_changed': {
      const k = t('pp_k_' + (item.data?.to ?? 'start'));
      return { av: m ? memberAv : agentAv, t1: m ? t('pp_stage_feed_m', { name, k }) : t('pp_stage_feed', { k }), t2: [item.data?.note, agoLabel(item.at)].filter(Boolean).join(' · '), go: sp('path') };
    }
    case 'checks':
      return { av: agentAv, t1: t('feed_checks', { title: shortTitle(title), x: t('v_' + (item.data?.verdict ?? 'ok')) }), t2: lsub, go: l ? sp('check', l.id) : null };
    default:
      return { av: agentAv, t1: human(item.kind), t2: agoLabel(item.at) };
  }
}
export function groupFeed(feed) {
  const out = [];
  for (const it of feed) {
    const prev = out[out.length - 1];
    if (it.type === 'event' && it.kind === 'listing_added' && prev?.kind === 'listing_added' && Math.abs(Date.parse(prev.at) - Date.parse(it.at)) < 3 * 3600e3) {
      prev.group = (prev.group ?? 1) + 1;
      continue;
    }
    out.push({ ...it });
  }
  return out;
}
export function Feed({ limit = 6 }) {
  const items = groupFeed(D().feed ?? []).slice(0, limit);
  if (!items.length) return html`<div class="card" style="padding:16px"><p class="muted" style="margin:0">${t('nothing_new')}</p></div>`;
  return html`<div class="card feed">${items.map((it) => {
    const v = feedView(it);
    const inner = html`${v.av}<div class="grow"><div class="t1">${v.t1}</div><div class="t2">${v.t2}</div></div>`;
    return v.go ? html`<button key=${it.id} class="feed-item" onClick=${() => go(v.go)}>${inner}</button>` : html`<div key=${it.id} class="feed-item">${inner}</div>`;
  })}</div>`;
}
export function nextViewing() {
  const now = Date.now();
  return (D().viewings ?? []).find((v) => v.status !== 'done' && Date.parse(v.starts_at) > now - 20 * 60e3) ?? null;
}
export function Hero() {
  const d = D();
  const s = d.search;
  const v = nextViewing();
  if (!v) {
    return html`<button class="hero no-photo" onClick=${() => go(sp('listings'))}>
      <div class="scene solid" style=${sceneStyle(s.country)}></div>
      <div class="txt"><b>${t('no_viewing')}</b><span>${t('no_viewing_sub')}</span></div>
    </button>`;
  }
  const l = listingById(v.listing_id) ?? v;
  const ph = photosOf(l)[0] ?? photosOf(v)[0];
  const ms = Date.parse(v.starts_at) - Date.now();
  const when = ms > 0 && ms < 864e5 ? relIn(ms) : whenLabel(v.starts_at);
  const nameShort = (l.title && l.title.length <= 24 ? l.title : shortTitle(l.title)) || shortLabel(l);
  const sub = [districtName(l), v.meet_note].filter(Boolean).join(' · ');
  const dest = l.lat != null ? `https://www.google.com/maps/dir/?api=1&destination=${l.lat},${l.lng}` : l.map_url;
  // V4-1 pattern: the next viewing as a floating photo with a time sticker, the words under it
  return html`<section class="w8-hero td8-hero">
    <div class="td8-stage">
      <${FloatPhoto} src=${ph} cls="td8-ph" tilt=${-2} label=${`${fmtTime(v.starts_at)} · ${nameShort}`} onClick=${() => go(sp('listing', v.listing_id))} />
      <${Sticker} text=${when} style="right:-2%;top:-14%;--r:12deg" />
      <${AniStickers} ms=${votesFor(v.listing_id).map((x) => memberById(x.user_id)).filter(Boolean)} size=${48} pos=${['left:-3%;bottom:-10%', 'left:13%;bottom:-14%']} />
    </div>
    <div class="row td8-cap">
      <button class="grow td8-t" onClick=${() => go(sp('listing', v.listing_id))}><b>${fmtTime(v.starts_at)} · ${nameShort}</b>${sub && html`<span>${sub}</span>`}</button>
      ${dest && html`<button class="round" aria-label=${t('on_map')} onClick=${() => openLink(dest)}><${Icon} n="nav" /></button>`}
    </div>
  </section>`;
}
export function Today() {
  const d = D();
  const s = d.search;
  if (!d.listings.length && !d.viewings.length) return html`<${EmptySearch} tab="today" />`;
  const v = nextViewing();
  const isOwner = d.me.role === 'owner';
  const wantN = d.listings.filter((l) => l.decision === 'want_view' || l.decision === 'take').length;
  const kicker = [shortTitle(s.title), s.brief?.move_in ? t('since', { d: fmtDayMonth(s.brief.move_in) }) : null].filter(Boolean).join(' · ');
  const deal = d.deal;
  const dealL = deal ? listingById(deal.listing_id) : null;
  return html`<main class="screen td8">
    <div class="head">
      <div><button class="kicker kicker-btn" aria-haspopup="dialog" aria-label=${t('my_searches')} onClick=${() => { hap.sel(); openSheet('switch'); }}>${kicker}<${Icon} n="chevd" cls="xs" /></button><${Typed} as="h1" cls="h1 td8-h1" lines=${[todayTitle(tzNow())]} /></div>
      <div class="row head-avs">
        <button class="avs" style="min-height:44px" aria-label=${t('settings_btn')} onClick=${() => openSheet('settings')}>
          ${d.members.slice(0, 4).map((m) => html`<${Av} key=${m.user_id} m=${m} size=${40} ring badge=${v ? votesFor(v.listing_id).find((x) => x.user_id === m.user_id)?.decision ?? null : null} />`)}
        </button>
        ${canVoteRole(d.me.role) && s.invite_link && html`<button class="round add-friend" aria-label=${t('invite')} onClick=${() => { hap.sel(); inviteFriends(s); }}><${Icon} n="userplus" cls="sm" /></button>`}
      </div>
    </div>
    <${PathStrip} />
    ${deal && html`<button class="card deal-strip" onClick=${() => go(sp('deal'))}>
      <${Img} src=${photosOf(dealL)[0]} /><div class="grow"><b class="display ellipsis" style="display:block;font-size:15px">${t('deal')}${dealL ? ' · ' + shortLabel(dealL) : ''}</b><div class="muted ellipsis" style="font-size:13px">${t('deal_strip_sub')}</div></div>
      <span class="chip jungle">${t('taking')}</span></button>`}
    <${NextCard} />
    <${GuestDrafts} />
    <${Hero} />
    <h2 class="section">${t('waiting')}</h2>
    <div class="tiles">
      <button class="card tile t-accent" onClick=${() => go(sp('deck'))}><span class="ic"><${Icon} n="layers" /></span><b>${d.counts.new}</b><span style="white-space:pre-line">${t('tile_new', { n: d.counts.new })}</span></button>
      ${isOwner
        ? html`<button class="card tile t-mango" onClick=${() => go(sp('approve'))}><span class="ic"><${Icon} n="send" /></span><b>${d.counts.drafts}</b><span style="white-space:pre-line">${t('tile_drafts', { n: d.counts.drafts })}</span></button>`
        : html`<button class="card tile t-mango" onClick=${() => go(sp('compare'))}><span class="ic"><${Icon} n="eye" /></span><b>${wantN}</b><span style="white-space:pre-line">${t('tile_want', { n: wantN })}</span></button>`}
      <button class="card tile t-jungle" onClick=${() => go(sp('listings', 'replies'))}><span class="ic"><${Icon} n="msg" /></span><b>${d.counts.replies_24h}</b><span style="white-space:pre-line">${t('tile_replies', { n: d.counts.replies_24h })}</span></button>
    </div>
    ${(d.threads ?? []).length > 0 && html`<button class="card chats-row" onClick=${() => go(sp('chats'))}>
      <span class="ic"><${Icon} n="msgs" /></span><div class="grow"><b>${t('chats')}</b><span>${[t('chats_row_sub', { n: waitingUs() }), t('n_convs', { n: d.threads.length })].join(' · ')}</span></div>
      ${waitingUs() > 0 && html`<span class="count-badge">${waitingUs()}</span>`}<${Icon} n="chev" cls="sm muted" /></button>`}
    ${(deal || (d.money?.expenses ?? []).length > 0) && html`<button class="card chats-row" onClick=${() => go(sp('money'))}>
      <span class="ic"><${Icon} n="wallet" /></span><div class="grow"><b>${t('money')}</b><span>${t('money_row_sub', { n: (d.money?.expenses ?? []).length })}</span></div><${Icon} n="chev" cls="sm muted" /></button>`}
    ${briefMentionsSurf() && html`<${SurfWaterCard} v=${surfCache[s.id]} />`}
    ${deal && chevRow(() => go(sp('recap')), 'share-2', t('rc_title'), t('rc_row_sub'))}
    <h2 class="section">${t('whats_new')}</h2>
    <${Feed} />
    <${Nav} tab="today" />
  </main>`;
}

// ---------------------------------------------------------------- invite
export function inviteFriends(s) {
  if (!s?.invite_link) return toast(t('err_generic'));
  const url = `https://t.me/share/url?url=${encodeURIComponent(s.invite_link)}&text=${encodeURIComponent(t('invite_text'))}`;
  if (inTG) openLink(url);
  else if (navigator.share) navigator.share({ url: s.invite_link, text: t('invite_text') }).catch(() => null);
  else window.open(url, '_blank', 'noopener');
}

// ---------------------------------------------------------------- empty search
export function EmptySearch({ tab }) {
  const d = D();
  const s = d.search;
  const src = STR[LANG]['src_' + s.country] ? t('src_' + s.country) : t('src_any');
  const invite = () => inviteFriends(s);
  return html`<main class="screen empty">
    <div class="scene" style=${sceneStyle(s.country)}></div>
    <p class="kicker" style="text-align:center;margin-top:18px">${s.title}</p>
    <h1 style="margin-top:4px">${t('empty_title')}</h1>
    <p>${t('empty_text', { src })}</p>
    <div class="card steps">
      <div class="step done"><span class="b"><${Icon} n="check" /></span>${t('step_brief')}</div>
      <div class="step now"><span class="b"></span>${t('step_collect')}</div>
      <div class="step"><span class="b"></span>${t('step_first')}</div>
    </div>
    ${s.invite_link && html`<button class="btn accent block big" onClick=${invite}><${Icon} n="userplus" />${t('invite')}</button>`}
    <${Nav} tab=${tab} />
  </main>`;
}
