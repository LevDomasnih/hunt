import { api, authHeaders, refresh, unvote, vote } from '../core/api.js';
import { CRIT, CRIT_ICON, D, animalName, canVoteRole, deckIds, districtName, districtShort, extraCost, fmtScore, interestOf, isNewForMe, listingById, memberById, memberLabel, myRating, myVote, photosOf, priceText, ratingOf, sceneStyle, viewedOf, votesFor } from '../core/data.js';
import { TG, inTG, reduceMotion, tg } from '../core/env.js';
import { agoLabel, availParts, channelName, dayKey, firstName, fmtDayMonthShort, fmtNum, fmtTime, initial, money, shortTitle } from '../core/format.js';
import { INC, LANG, cap, enumLabel, fieldLabel, pick2, pl, t } from '../core/i18n.js';
import { back, depth, go, openLink, sp } from '../core/routing.js';
import { S, hap, toast } from '../core/store.js';
import { W2Head, chevRow, postInstruction, regionPack } from '../home/helpers.js';
import { homeMode } from '../home/homemode.js';
import { ListingW4 } from '../home/house.js';
import { onsiteViewing } from '../home/onsite.js';
import { areaName, areaOf, useAreasGeo } from '../places/districts.js';
import { anchorsOf, locCache, locStale, placesSummary, ringKeys, scoreCls } from '../places/places.js';
import { Av, Icon, Img, InterestChip, ScoreChip, VoteAvs } from '../ui/icons.js';
import { Nav, Skeletons, WaterCard } from '../ui/pieces.js';
import { ThreadCard, threadsForListing } from './chats.js';
import { EmptySearch } from './today.js';
import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';

// ---------------------------------------------------------------- listings
export function ListingCard({ l }) {
  const ph = photosOf(l);
  const mine = myVote(l.id);
  const dec = l.decision ?? (mine ? null : 'new');
  const facts = [districtName(l), l.bedrooms != null ? t('br', { n: l.bedrooms }) : null, availParts(l.available).from ? t('from_d', { d: availParts(l.available).from }) : null].filter(Boolean).join(' · ');
  return html`<button class="card l-card" onClick=${() => go(sp('listing', l.id))}>
    <div class="ph">
      ${ph[0] ? html`<img src=${ph[0]} alt="" loading="lazy" decoding="async" />` : null}
      <${InterestChip} lid=${l.id} size=${28} photo />
      ${ph.length > 1 && html`<span class="count pill-count">${ph.length}</span>`}
    </div>
    <div class="bd">
      <div class="row"><div class="price grow">${priceText(l)} <small>${t('per_month')}${extraCost(l) ? ' ' + extraCost(l) : ''}</small></div>
        <${ScoreChip} lid=${l.id} />${dec && html`<span class=${'dchip d-' + dec}><span class="dot"></span>${t('d_' + dec)}</span>`}</div>
      <div class="title">${l.title}</div>
      ${facts && html`<div class="meta">${facts}</div>`}
    </div>
  </button>`;
}
/** Liked = the group wants to view / take it, or rated it 3.5+. Sorted by score, then interest. */
export function likedList(d) {
  const ls = d.listings.filter((l) => l.decision === 'want_view' || l.decision === 'take' || (ratingOf(l.id)?.score ?? 0) >= 3.5);
  return ls.sort((a, b) => (ratingOf(b.id)?.score ?? -1) - (ratingOf(a.id)?.score ?? -1) || interestOf(b.id).score - interestOf(a.id).score);
}
export let listSeg = null; // remembered while the app is open
export function Listings({ arg }) {
  const d = D();
  const mine = new Set(d.votes.filter((v) => v.user_id === d.user.id).map((v) => v.listing_id));
  const groups = {
    liked: likedList(d),
    new: d.listings.filter((l) => isNewForMe(l, mine)),
    all: d.listings,
    passed: d.listings.filter((l) => l.decision === 'not_interested'),
  };
  const [f, setF0] = useState(() => (listSeg && groups[listSeg] ? listSeg : groups.liked.length ? 'liked' : 'new'));
  const [replies, setReplies] = useState(arg === 'replies');
  const areaId = String(arg ?? '').startsWith('area-') ? String(arg).slice(5) : null;
  const area = areaId ? regionPack()?.areas?.[areaId] : null;
  const geo = useAreasGeo(area ? d.search.country : null);
  const setF = (k) => { listSeg = k; setReplies(false); setF0(k); };
  if (!d.listings.length) return html`<${EmptySearch} tab="listings" />`;
  const repliedIds = new Set((d.feed ?? []).filter((x) => x.type === 'message' && x.listing_id && Date.now() - Date.parse(x.at) < 864e5).map((x) => x.listing_id));
  const list = area ? d.listings.filter((l) => areaOf(l, geo, regionPack()?.areas) === areaId) : replies ? d.listings.filter((l) => repliedIds.has(l.id)) : groups[f];
  const deckN = deckIds(d).length;
  const cmpN = compareList(d).length;
  const segs = ['liked', 'new', 'all', 'passed'];
  return html`<main class="screen">
    <div class="head"><div><h1 class="h1">${t('nav_listings')}</h1></div></div>
    <div class="seg full lseg" role="group">${segs.map((k) => html`<button key=${k} aria-pressed=${!replies && f === k ? 'true' : 'false'} onClick=${() => { hap.sel(); setF(k); }}>
      ${t('seg_' + k)}<b>${groups[k].length}</b></button>`)}</div>
    ${area && html`<div class="filters" style="margin-top:12px"><button class="filter" aria-pressed="true" onClick=${() => go(sp('listings'), true)}>${t('ds_filter', { a: areaName(area) })} <b>${list.length}</b><${Icon} n="x" cls="xs" /></button></div>`}
    ${replies && html`<div class="filters" style="margin-top:12px"><button class="filter" aria-pressed="true" onClick=${() => setReplies(false)}>${t('replied_24h')} <b>${list.length}</b><${Icon} n="x" cls="xs" /></button></div>`}
    ${!replies && f === 'liked' && html`<div class="cta-row" style="grid-template-columns:1fr">
      <button class="btn surface cmp-btn" disabled=${cmpN < 2} onClick=${() => go(sp('compare'))}><${Icon} n="sort" cls="sm" />${t('compare')}<b>${cmpN}</b></button></div>`}
    ${!replies && f === 'new' && deckN > 0 && html`<div class="cta-row" style="grid-template-columns:1fr">
      <button class="cta" onClick=${() => go(sp('deck'))}><${Icon} n="layers" /><div class="grow"><b>${t('deck_cta', { n: deckN })}</b><span>${t('deck_cta_sub')}</span></div></button></div>`}
    ${S.loading && !list.length ? html`<${Skeletons} />` : html`<div class="stack">${list.map((l) => html`<${ListingCard} key=${l.id} l=${l} />`)}</div>`}
    ${!list.length && html`<p class="empty-note">${replies ? '—' : t(f + '_empty') !== f + '_empty' ? t(f + '_empty') : '—'}</p>`}
    <${Nav} tab="listings" />
  </main>`;
}

// ---------------------------------------------------------------- deck
export function Deck() {
  const d = D();
  const [ids] = useState(() => deckIds(d));
  const [i, setI] = useState(0);
  const [pi, setPi] = useState(0);
  const hist = useRef([]);
  const cardRef = useRef(null);
  const stampRef = useRef(null);
  const g = useRef(null);
  const cur = listingById(ids[i]);
  const nxt = listingById(ids[i + 1]);
  useEffect(() => setPi(0), [i]);
  useEffect(() => {
    tg(() => TG.disableVerticalSwipes?.());
    return () => tg(() => TG.enableVerticalSwipes?.());
  }, []);

  const STAMP = { want_view: 'var(--accent)', not_interested: 'var(--slate)', thinking: 'var(--mango)' };
  function stamp(dec, o?) {
    const el = stampRef.current;
    if (!el) return;
    if (!dec) { el.style.opacity = 0; return; }
    el.textContent = t('stamp_' + dec);
    el.style.color = STAMP[dec];
    el.style.opacity = o;
  }
  function decide(dec) {
    const l = cur;
    const el = cardRef.current;
    if (!l || !el || g.current?.flying) return;
    g.current = { flying: true };
    hap.impact('medium');
    const prev = myVote(l.id);
    const finish = () => {
      hist.current.push({ id: l.id, prev });
      vote(l.id, dec);
      g.current = null;
      setI((x) => x + 1);
    };
    stamp(dec, 1);
    if (reduceMotion()) { el.style.opacity = '0'; setTimeout(finish, 120); return; }
    const w = el.offsetWidth, h = el.offsetHeight;
    const to = dec === 'want_view' ? `translate(${w * 1.4}px, 30px) rotate(16deg)` : dec === 'not_interested' ? `translate(${-w * 1.4}px, 30px) rotate(-16deg)` : `translate(0, ${-h * 1.2}px)`;
    el.style.transition = 'transform .3s cubic-bezier(.4,.1,.7,.5), opacity .3s';
    el.style.transform = to;
    setTimeout(finish, 290);
  }
  function down(e) {
    if (g.current?.flying || e.button > 0) return;
    cardRef.current.setPointerCapture(e.pointerId);
    g.current = { x: e.clientX, y: e.clientY, t: Date.now(), dx: 0, dy: 0 };
    cardRef.current.style.transition = 'none';
  }
  function move(e) {
    const s = g.current;
    if (!s || s.flying || s.x == null) return;
    s.dx = e.clientX - s.x;
    s.dy = e.clientY - s.y;
    cardRef.current.style.transform = `translate(${s.dx}px, ${s.dy}px) rotate(${s.dx / 18}deg)`;
    const ax = Math.abs(s.dx), ay = Math.abs(s.dy);
    const dec = ax > ay ? (s.dx > 0 ? 'want_view' : 'not_interested') : s.dy < 0 ? 'thinking' : null;
    stamp(dec, Math.min(1, Math.max(ax, ay) / 110));
  }
  function up(e) {
    const s = g.current;
    if (!s || s.flying || s.x == null) return;
    const { dx, dy } = s;
    const el = cardRef.current;
    if (Math.hypot(dx, dy) < 8 && Date.now() - s.t < 400) {
      g.current = null;
      el.style.transform = '';
      const r = el.getBoundingClientRect();
      const ry = (e.clientY - r.top) / r.height, rx = (e.clientX - r.left) / r.width;
      const n = photosOf(cur).length;
      if (ry < 0.6 && n > 1) setPi((p) => (rx < 0.35 ? Math.max(0, p - 1) : Math.min(n - 1, p + 1)));
      else go(sp('listing', cur.id));
      return;
    }
    const th = Math.min(110, el.offsetWidth * 0.28);
    if (dx > th && Math.abs(dx) > Math.abs(dy)) return decide('want_view');
    if (dx < -th && Math.abs(dx) > Math.abs(dy)) return decide('not_interested');
    if (dy < -th) return decide('thinking');
    g.current = null;
    el.style.transition = 'transform .25s ease';
    el.style.transform = '';
    stamp(null);
  }
  function undo() {
    const h = hist.current.pop();
    if (!h) return;
    hap.sel();
    setI((x) => Math.max(0, x - 1));
    if (h.prev) vote(h.id, h.prev);
    else unvote(h.id);
  }
  function keys(e) {
    if (e.key === 'ArrowRight') decide('want_view');
    else if (e.key === 'ArrowLeft') decide('not_interested');
    else if (e.key === 'ArrowUp') decide('thinking');
  }
  const total = ids.length;
  const card = (l, isTop) => {
    const ph = photosOf(l);
    const p = isTop ? Math.min(pi, Math.max(0, ph.length - 1)) : 0;
    const av = availParts(l.available).from;
    const lr = l.fields?.living_room;
    return html`<div key=${l.id} class=${'dcard' + (isTop ? '' : ' back')} ref=${isTop ? cardRef : null}
      onPointerDown=${isTop ? down : null} onPointerMove=${isTop ? move : null} onPointerUp=${isTop ? up : null} onPointerCancel=${isTop ? up : null}
      tabIndex=${isTop ? 0 : -1} onKeyDown=${isTop ? keys : null} aria-label=${isTop ? `${priceText(l)} · ${l.title}` : null} aria-hidden=${isTop ? null : 'true'}>
      ${ph[p] && html`<img class="bg" src=${ph[p]} alt="" draggable="false" decoding="async" />`}
      <div class="top">${interestOf(l.id).votes.length ? html`<${InterestChip} lid=${l.id} size=${34} photo />` : html`<span></span>`}${ph.length > 1 ? html`<span class="pill-count">${t('photos_n', { i: p + 1, n: ph.length })}</span>` : html`<span></span>`}</div>
      <div class="info">
        <div class="price">${priceText(l)}<small>${t('per_month_long')}${extraCost(l) ? ' ' + extraCost(l) : ''}</small></div>
        <div class="title">${l.title}</div>
        <div class="facts">
          ${l.location_score != null && html`<span class="loc-fact"><${Icon} n="map-pin" cls="sm" />${t('lc_badge', { n: l.location_score })}</span>`}
          ${districtName(l) && html`<span><${Icon} n="pin" cls="sm" />${districtName(l)}</span>`}
          ${l.bedrooms != null && html`<span><${Icon} n="bed" cls="sm" />${t('br', { n: l.bedrooms })}</span>`}
          ${lr && html`<span><${Icon} n="sofa" cls="sm" />${String(enumLabel(lr)).split(',')[0].toLowerCase()}</span>`}
          ${av && html`<span><${Icon} n="cal" cls="sm" />${t('from_d', { d: av })}</span>`}
        </div>
      </div>
      ${isTop && html`<div class="stamp" ref=${stampRef}></div>`}
    </div>`;
  };
  return html`<main class="deck">
    <div class="deck-top">
      <button class="icon-btn" aria-label=${t('close')} onClick=${back}><${Icon} n="x" /></button>
      <div><div class="ttl">${t('deck_title', { i: Math.min(i + 1, total), n: total })}</div>
        <div class="segs" aria-hidden="true">${ids.slice(0, 12).map((_, k) => html`<i class=${k <= i ? 'on' : ''}></i>`)}</div></div>
      <button class="icon-btn" aria-label=${t('undo')} disabled=${!hist.current.length} style=${hist.current.length ? '' : 'opacity:.4'} onClick=${undo}><${Icon} n="undo" /></button>
    </div>
    ${cur ? html`
      <div class="deck-area">${nxt && card(nxt, false)}${card(cur, true)}</div>
      <div class="deck-btns">
        <button class="round no" aria-label=${t('not_btn')} onClick=${() => decide('not_interested')}><${Icon} n="x" /></button>
        <button class="btn accent big grow" onClick=${() => decide('want_view')}>${t('want_view_btn')}</button>
        <button class="btn surface think" aria-label=${t('think_btn')} onClick=${() => decide('thinking')}>${cap(t('d_thinking'))}</button>
      </div>
      <p class="hints" aria-hidden="true">${t('hints')}</p>`
    : html`<div class="deck-done"><p class="h2">${t('deck_done')}</p><p class="muted">${t('deck_done_text')}</p>
        <button class="btn accent" style="margin-top:12px" onClick=${() => go(sp('listings'), true)}>${t('to_listings')}</button></div>`}
  </main>`;
}

// ---------------------------------------------------------------- listing detail
export function factsFor(l) {
  const f = l.fields ?? {};
  const out = [];
  const used = new Set(['pool_size_m', 'bedrooms_ensuite', 'available_from']);
  if (f.living_room) { out.push({ ic: 'sofa', v: enumLabel(f.living_room), k: t('living_room') }); used.add('living_room'); }
  if (f.pool) {
    const size = f.pool_size_m ? (LANG === 'ru' ? `, ${f.pool_size_m} ${pl(Number(f.pool_size_m), 'метр', 'метра', 'метров')}` : `, ${f.pool_size_m} m`) : '';
    out.push({ ic: 'waves', v: enumLabel(f.pool) + size, k: t('pool') });
    used.add('pool');
  }
  if (l.bedrooms != null) out.push({ ic: 'bed', v: `${t('bedrooms', { n: l.bedrooms })}${f.bedrooms_ensuite ? ' ' + t('with_baths') : ''}`, k: l.size_m2 ? t('sqm', { n: fmtNum(l.size_m2) }) : t('bedrooms_lbl') });
  if (Array.isArray(l.includes) && l.includes.length) out.push({ ic: 'receipt', v: cap(l.includes.map((x) => pick2(INC[x]) ?? x).join(', ')), k: t('included') });
  if (f.electricity) { out.push({ ic: 'zap', v: enumLabel(f.electricity), k: t('electricity') }); used.add('electricity'); }
  for (const [k, v] of Object.entries(f)) {
    if (used.has(k) || v == null || v === '') continue;
    out.push({ ic: 'info', v: enumLabel(v), k: fieldLabel(k) });
  }
  return out;
}
export function Carousel({ photos }) {
  const [i, setI] = useState(0);
  const ref = useRef(null);
  const onScroll = () => {
    const el = ref.current;
    if (el) setI(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
  };
  return html`<div class="carousel">
    <div class="track" ref=${ref} onScroll=${onScroll}>${photos.map((p, k) => html`<img key=${k} src=${p} alt="" loading=${k ? 'lazy' : 'eager'} decoding="async" />`)}</div>
    ${photos.length > 1 && html`<div class="dots" aria-hidden="true">${photos.slice(0, 10).map((_, k) => html`<i class=${k === i ? 'on' : ''}></i>`)}</div>`}
    ${photos.length > 1 && html`<span class="car-n" aria-hidden="true">${t('w8_n_of', { i: Math.min(i + 1, photos.length), n: photos.length })}</span>`}
  </div>`;
}
export let audioEl = null;
export function playVoice(key) {
  hap.sel();
  tg(() => audioEl?.pause());
  audioEl = new Audio(`/app/kv/${encodeURIComponent(key)}?k=${encodeURIComponent(D()?.photo_token ?? '')}`);
  audioEl.play().catch(() => toast(t('err_generic')));
}
/** "both “view”", "Kingfisher “view”", "view 1, thinking 1". */
export function interestSummary(vs) {
  if (!vs.length) return '';
  const ds = [...new Set(vs.map((v) => v.decision))];
  if (ds.length === 1) {
    const dl = t('d_' + ds[0]);
    if (vs.length === 1) return t('one_dec', { name: cap(animalName(memberById(vs[0].user_id))) || firstName(memberById(vs[0].user_id)?.name), d: dl });
    return t(vs.length === 2 ? 'both_dec' : 'all_dec', { d: dl });
  }
  return ['take', 'want_view', 'thinking', 'not_interested'].filter((k) => ds.includes(k)).map((k) => `${t('d_' + k)} ${vs.filter((v) => v.decision === k).length}`).join(', ');
}
/** Group score block in the listing detail (mockup 15); before ratings only the interest line + "Rate it". */
export function GroupScore({ l }) {
  const d = D();
  const r = ratingOf(l.id);
  const iv = interestOf(l.id);
  const viewed = viewedOf(l.id);
  const canRate = canVoteRole(d.me.role) && (viewed || r);
  const mine = myRating(l.id);
  const intLine = iv.votes.length > 0 && html`<div class="card gs-int"><${Icon} n="heart" cls="sm" /><span>${[t(viewed || r ? 'interest_before' : 'interest_now', { x: Math.max(0, iv.score), max: iv.max }), interestSummary(iv.votes)].filter(Boolean).join(' · ')}</span></div>`;
  const rateBtn = canRate && !mine && html`<button class="btn accent block gs-rate" onClick=${() => go(sp('rate', l.id))}><${Icon} n="star" />${t('rate_btn')}</button>`;
  if (!r) return intLine || rateBtn ? html`<div class="gs">${intLine}${rateBtn}</div>` : null;
  return html`<div class="gs">
    <div class="card gs-top">
      <div class="gs-big"><b>${fmtScore(r.score)}</b><span>${t('of5')}</span></div>
      <div class="grow"><div class="gs-ttl">${t('score_title')}</div>
        ${r.by_member.map((m) => html`<div class="gs-m"><${Av} m=${memberById(m.user_id)} size=${26} /><span class="grow">${memberLabel(memberById(m.user_id))}</span><b>${fmtScore(m.score)}</b></div>`)}</div>
    </div>
    <div class="card gs-bars">${CRIT.map((c) => {
      const v = r.criteria[c];
      return html`<div class="gs-bar"><span class="lb">${t('cb_' + c)}</span><span class="tr"><i class=${v < 3 ? 'low' : ''} style=${`width:${(v / 5) * 100}%`}></i></span><b>${fmtScore(v)}</b></div>`;
    })}</div>
    ${r.notes.length > 0 && html`<div class="card gs-notes"><div class="gs-ttl">${t('notes_title')}</div>
      ${r.notes.map((n) => html`<div class="gs-note"><${Av} m=${memberById(n.user_id)} size=${30} /><div class="grow">${n.note && html`<p>${n.note}</p>`}
        ${n.voice && html`<button class="vchip" onClick=${() => playVoice(n.voice)}><${Icon} n="play" cls="xs" />${t('voice_note')}</button>`}</div></div>`)}</div>`}
    ${intLine}
    ${rateBtn}
    ${canRate && mine && html`<button class="btn link gs-edit" onClick=${() => go(sp('rate', l.id))}><${Icon} n="pencil" cls="sm" />${t('rate_edit')}</button>`}
  </div>`;
}

/** Villa with its own pool (Q2b): the pool as a living-water tile next to the location score (or the bedrooms). */
export function PoolPair({ l }) {
  const f = l.fields ?? {};
  if (f.pool !== 'private') return null;
  const size = Number(f.pool_size_m) || null;
  const pool = html`<${WaterCard} cls="pw-pool">${size ? html`<b class="water-v">${t('sf_m', { x: fmtNum(size) })}</b><span class="water-s">${t('pw_pool_own')}</span>` : html`<b class="water-v pw-pool-t">${cap(t('pw_pool_own'))}</b>`}<//>`;
  const lv = locCache[l.id];
  const loc = locStale(lv) ? null : lv?.location;
  const r0 = loc ? ringKeys(lv)[0] : null;
  const near = loc ? (loc.rings?.[String(r0)]?.places ?? []).filter((p) => p.contribution > 0).slice(0, 3).map((p) => p.name).join(', ') : '';
  const second = l.location_score != null
    ? html`<button class="card pw-stat" onClick=${() => go(sp('location', l.id))}><span>${t('lc_row')}</span><b>${l.location_score}<small>${t('pw_of_100')}</small></b>${near && html`<p>${t('lc_row_sub', { x: near, r: r0 })}</p>`}</button>`
    : l.bedrooms != null ? html`<div class="card pw-stat"><span>${t('bedrooms_lbl')}</span><b>${l.bedrooms}${l.size_m2 ? html`<small>${t('sqm', { n: fmtNum(l.size_m2) })}</small>` : null}</b></div>` : null;
  return second ? html`<div class="pw-pair">${pool}${second}</div>` : html`<div class="pw-pair" style="grid-template-columns:1fr">${pool}</div>`;
}
export function ListingDetail({ id }) {
  const d = D();
  const l = listingById(id);
  const [extra, setExtra] = useState(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    setExtra(null);
    api('/app/api/listing?id=' + encodeURIComponent(id)).then(setExtra).catch(() => setExtra({ messages: [], contacts: [], comments: [] }));
  }, [id]);
  if (!l) return html`<main class="screen no-nav"><div class="center-msg">${t('err_generic')}</div></main>`;
  const mine = myVote(l.id);
  const av = availParts(l.available);
  const meta = [l.price_note, districtName(l), av.from ? t('free', { x: av.to ? `${av.from} – ${av.to}` : t('from_d', { d: av.from }) }) : null].filter(Boolean).join(' · ');
  const msgs = extra?.messages ?? [];
  const shown = all ? msgs : msgs.slice(-3);
  const canVote = d.me.role !== 'viewer' && !homeMode(); // home mode: the old listings are a read-only archive
  const set = (dec) => { hap.sel(); vote(l.id, dec); };
  const vs = votesFor(l.id);
  // V4-4: the photos float tilted on the warm grey, voters' animals as stickers on the corner, the price as the big figure
  return html`<main class="detail ld8">
    ${!inTG && html`<div class="row ld8-top"><button class="round w8-back" aria-label=${t('back')} onClick=${back}><${Icon} n="arrow-left" /></button></div>`}
    <div class="ld8-stage">
      <div class="float-ph ld8-ph"><${Carousel} photos=${photosOf(l)} /></div>
      ${vs.slice(0, 3).map((v, k) => html`<span key=${v.user_id} class="ani" style=${`right:${-2 + k * 9}%;bottom:${-14 + k * 11}%;--r:${k % 2 ? 8 : -8}deg;animation-delay:${-1.4 * k}s`}><${Av} m=${memberById(v.user_id)} size=${50} badge=${v.decision}  free /></span>`)}
    </div>
    <div class="sheet-body">
      <div class="price-row"><span class="p">${priceText(l)}</span><small class="grow">${t('per_month')}${extraCost(l) ? ' ' + extraCost(l) : ''}</small></div>
      <h1>${l.title}</h1>
      ${meta && html`<p class="meta">${meta}</p>`}
      <${PoolPair} l=${l} />
      ${l.checks && html`<div style="margin-top:14px"><${CheckBanner} c=${l.checks} onClick=${() => go(sp('check', l.id))} /></div>`}
      ${canVoteRole(d.me.role) && onsiteViewing(l.id) && (regionPack()?.checklist ?? []).length > 0 && html`<button class="btn surface block os-open" onClick=${() => go(sp('onsite', l.id))}><${Icon} n="circle-check" cls="sm" />${t('os_btn')}</button>`}
      <${GroupScore} l=${l} />
      ${(() => {
        const own = l.fields?.pool === 'private';
        const fs = factsFor(l).filter((f) => !(own && f.ic === 'waves'));
        return fs.length > 0 && html`<div class="card kv-list">${fs.map((f) => (f.ic === 'bed'
          ? html`<div class="kv"><span>${t('bedrooms_lbl')}</span><b>${[f.v, l.size_m2 ? t('sqm', { n: fmtNum(l.size_m2) }) : null].filter(Boolean).join(', ')}</b></div>`
          : html`<div class="kv"><span>${f.k}</span><b>${f.v}</b></div>`))}</div>`;
      })()}
      ${(anchorsOf().length > 0 || canVoteRole(d.me.role)) && html`<button class="card chats-row" onClick=${() => go(sp('places', l.id))}><span class="ic"><${Icon} n="map-pin" /></span><div class="grow"><b>${t('pl_title')}</b><span>${placesSummary(l) ?? t('pl_none').split('.')[0]}</span></div><${Icon} n="chev" cls="sm muted" /></button>`}
      <${ListingW4} l=${l} noLoc=${l.fields?.pool === 'private' && l.location_score != null} />
      ${d.me.role === 'owner' && chevRow(() => go(sp('nego', l.id)), 'scale', t('ng_row'), t('ng_row_sub'))}
      ${l.summary && html`<div class="summary"><${Icon} n="sparkles" /><div>${l.summary}</div></div>`}
      ${(l.source_url || l.map_url) && html`<div class="row" style="margin-top:10px">
        ${l.source_url && html`<button class="btn surface grow" style="min-height:46px;font-size:14px" onClick=${() => openLink(l.source_url)}><${Icon} n="link" cls="sm" />${t('source')}</button>`}
        ${l.map_url && html`<button class="btn surface grow" style="min-height:46px;font-size:14px" onClick=${() => openLink(l.map_url)}><${Icon} n="pin" cls="sm" />${t('on_map')}</button>`}
      </div>`}
      <h2 class="section">${t('messages')}</h2>
      ${threadsForListing(l.id).length > 0 && html`<div class="stack" style="margin-bottom:12px">${threadsForListing(l.id).map((th) => html`<${ThreadCard} key=${th.contact_id} th=${th} />`)}</div>`}
      ${extra == null ? html`<div class="skeleton" style="height:90px"></div>`
        : msgs.length ? html`<div class="bubbles">${shown.map((m) => html`<div key=${m.id} class=${'bubble ' + (m.direction === 'out' ? 'out' : m.direction === 'in' ? 'in' : 'note')}>${m.text ?? '…'}<small>${[m.direction === 'in' ? m.contact_name : null, channelName(m.channel), agoLabel(m.at)].filter(Boolean).join(' · ')}</small></div>`)}</div>
          ${msgs.length > 3 && !all && html`<button class="btn link" onClick=${() => setAll(true)}>${t('all_messages', { n: msgs.length })}</button>`}`
        : threadsForListing(l.id).length ? null : html`<p class="muted" style="margin:0">${t('no_messages')}</p>`}
    </div>
    ${canVote && html`<div class="decision-bar"><div>
      <button class=${'round no' + (mine === 'not_interested' ? ' sel-no' : '')} aria-pressed=${mine === 'not_interested'} aria-label=${t('not_btn')} onClick=${() => set('not_interested')}><${Icon} n="x" /></button>
      <button class="btn surface think" aria-pressed=${mine === 'thinking'} onClick=${() => set('thinking')}>${cap(t('d_thinking'))}</button>
      ${mine === 'want_view' || mine === 'take'
        ? html`<button class="btn jungle big" aria-pressed=${mine === 'take'} onClick=${() => set('take')}><${Icon} n="check" />${t('take_btn')}</button>`
        : html`<button class="btn accent big" onClick=${() => set('want_view')}><${Icon} n="eye" />${t('want_view_btn')}</button>`}
    </div></div>`}
  </main>`;
}

// ---------------------------------------------------------------- rate after viewing
export const canRecord = () => typeof window.MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
export function whenAt(iso) {
  const k = dayKey(iso);
  const now = Date.now();
  const dw = k === dayKey(new Date(now).toISOString()) ? t('today') : k === dayKey(new Date(now - 864e5).toISOString()) ? t('yesterday') : fmtDayMonthShort(iso);
  return t('at_word', { d: dw, t: fmtTime(iso) });
}
export function Rate({ id }) {
  const d = D();
  const l = listingById(id);
  const prev = myRating(id);
  const prevNote = ratingOf(id)?.notes?.find((n) => n.user_id === d.user.id);
  const [vals, setVals] = useState(() => Object.fromEntries(CRIT.map((c) => [c, prev?.[c] ?? 0])));
  const [note, setNote] = useState(prevNote?.note ?? '');
  const [voice, setVoice] = useState(null);
  const [rec, setRec] = useState(null); // {mr, t0}
  const [secs, setSecs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [up, setUp] = useState(false);
  useEffect(() => {
    if (!rec) return;
    const iv = setInterval(() => setSecs(Math.round((Date.now() - rec.t0) / 1000)), 500);
    return () => clearInterval(iv);
  }, [rec]);
  useEffect(() => () => tg(() => rec?.mr.stream.getTracks().forEach((x) => x.stop())), [rec]);
  if (!l || !canVoteRole(d.me.role)) return html`<main class="screen no-nav"><div class="center-msg">${t('err_generic')}</div></main>`;
  const v = viewedOf(id);
  const sub = [v ? t('viewed_at', { when: whenAt(v.starts_at) }) : districtName(l), priceText(l)].filter(Boolean).join(' · ');
  const ph = photosOf(l)[0];
  async function mic() {
    if (rec) {
      rec.mr.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks = [];
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((x) => x.stop());
        setRec(null);
        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
        if (!blob.size) return;
        setUp(true);
        try {
          const r = await fetch('/app/api/rating-voice?listing_id=' + encodeURIComponent(id), { method: 'POST', headers: { ...authHeaders(), 'content-type': blob.type || 'audio/webm' }, body: blob });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error);
          setVoice(j.key);
          hap.ok();
        } catch { toast(t('voice_fail')); }
        setUp(false);
      };
      mr.start();
      hap.impact('medium');
      setSecs(0);
      setRec({ mr, t0: Date.now() });
    } catch { toast(t('voice_fail')); }
  }
  async function save() {
    if (CRIT.some((c) => !vals[c])) { toast(t('rate_all')); return; }
    setBusy(true);
    try {
      const r = await api('/app/api/rate', { listing_id: id, ...vals, note: note.trim() || null, voice });
      (D().ratings ??= {})[id] = r.rating;
      hap.ok();
      toast(t('rating_saved'));
      if (depth > 0) back(); else go(sp('listing', id), true);
      refresh();
    } catch { toast(t('err_generic')); }
    setBusy(false);
  }
  const set = (c, n) => { hap.sel(); setVals({ ...vals, [c]: n }); };
  return html`<main class="rate">
    <div class="rate-hero">
      ${ph ? html`<img src=${ph} alt="" decoding="async" />` : html`<div class="scene solid" style=${sceneStyle(d.search.country)}></div>`}
      ${!inTG && html`<button class="back-btn" aria-label=${t('back')} onClick=${back}><${Icon} n="left" /></button>`}
      <div class="txt"><h1>${shortTitle(l.title)}</h1><span>${sub}</span></div>
    </div>
    <div class="rate-body">
      <div class="rate-q"><${Av} m=${memberById(d.user.id)} size=${40} /><span>${t('rate_q')}</span></div>
      <div class="card rate-card">${CRIT.map((c) => html`<div class="rate-row" role="radiogroup" aria-label=${t('crit_' + c)}>
        <div class="rl"><${Icon} n=${CRIT_ICON[c]} cls="sm" />${t('crit_' + c)}</div>
        <div class="rn">${[1, 2, 3, 4, 5].map((n) => html`<button role="radio" aria-checked=${vals[c] === n ? 'true' : 'false'} aria-label=${String(n)}
          class=${n <= vals[c] ? (vals[c] < 3 ? 'on low' : 'on') : ''} onClick=${() => set(c, n)}>${n}</button>`)}</div></div>`)}</div>
      <div class="card rate-note">
        <div class="grow">
          <textarea rows="2" placeholder=${t('note_ph')} aria-label=${t('notes_title')} value=${note} onInput=${(e) => setNote(e.currentTarget.value)}></textarea>
          ${rec && html`<div class="rec-line"><span class="dot"></span>${t('recording', { s: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` })}</div>`}
          ${up && html`<div class="rec-line muted">${t('voice_up')}</div>`}
          ${(voice || (prevNote?.voice && !voice)) && !rec && !up && html`<span class="vchip on">${voice ? html`<${Icon} n="mic" cls="xs" />` : html`<button class="vplay" aria-label=${t('play')} onClick=${() => playVoice(prevNote.voice)}><${Icon} n="play" cls="xs" /></button>`}${t('voice_note')}
            ${voice && html`<button class="vx" aria-label=${t('remove')} onClick=${() => setVoice(null)}><${Icon} n="x" cls="xs" /></button>`}</span>`}
        </div>
        ${canRecord() && html`<button class=${'mic' + (rec ? ' rec' : '')} aria-label=${t('mic')} aria-pressed=${rec ? 'true' : 'false'} disabled=${up} onClick=${mic}><${Icon} n=${rec ? 'stop' : 'mic'} /></button>`}
      </div>
      <button class="btn accent block big rate-save" disabled=${busy || !!rec || up} onClick=${save}>${t('save_rating')}</button>
    </div>
  </main>`;
}

// ---------------------------------------------------------------- approve
export function Approve() {
  const d = D();
  const [list] = useState(() => d.drafts.slice());
  const [i, setI] = useState(0);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const dr = list[i];
  useEffect(() => { setEditing(false); setText(dr?.text ?? ''); }, [i]);
  if (d.me.role !== 'owner') return html`<main class="screen no-nav"><div class="center-msg">—</div></main>`;
  async function act(action) {
    setBusy(true);
    try {
      await api('/app/api/draft', { draft_id: dr.id, action, text: action === 'send' && editing ? text : undefined });
      action === 'send' ? hap.ok() : hap.sel();
      toast(t(action === 'send' ? 'approved_toast' : 'skipped_toast'));
      setI((x) => x + 1);
      refresh();
    } catch (e) {
      toast(e.code === 'already_decided' ? t('approve_done') : t('err_generic'));
      if (e.code === 'already_decided') setI((x) => x + 1);
    }
    setBusy(false);
  }
  const top = html`<div class="topbar"><button class="icon-btn" aria-label=${t('close')} onClick=${back}><${Icon} n="x" /></button>
    <div class="ttl">${dr ? t('approve_title', { i: i + 1, n: list.length }) : ''}</div><span></span></div>`;
  if (!dr) return html`<main class="screen no-nav">${top}<div class="center-msg"><p class="h2">${t('approve_done')}</p><p>${t('approve_done_text')}</p>
    <button class="btn accent" onClick=${back}>${t('back')}</button></div></main>`;
  const name = dr.contact_name || dr.address;
  const ctx = [dr.listing_bedrooms != null ? t('br', { n: dr.listing_bedrooms }) : null, dr.listing_district ? districtName({ district: dr.listing_district, area_text: dr.listing_area }) : null].filter(Boolean).join(' ');
  const via = [channelName(dr.channel), [ctx, money(dr.listing_price, dr.listing_currency)].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  return html`<main class="screen no-nav"><div class="approve">
    ${top}
    <div class="contact"><div class="big-letter" aria-hidden="true">${initial(name)}</div><h2>${name}</h2><span class="via"><${Icon} n="msg" cls="sm" />${via}</span></div>
    ${dr.reason && html`<div class="card reason"><${Icon} n="sparkles" /><div>${dr.reason}</div></div>`}
    <div class="bubbles">
      ${dr.last_in_text && html`<div class="bubble in">${dr.last_in_text}</div>`}
      ${editing ? html`<textarea class="edit-area" aria-label=${t('edit_text')} value=${text} onInput=${(e) => setText(e.currentTarget.value)}></textarea>`
        : html`<div class="bubble out">${dr.text}<small>${t('goes_now')}</small></div>`}
    </div>
    ${!editing && html`<div><button class="btn link" style="margin-top:10px;padding:0" onClick=${() => setEditing(true)}><${Icon} n="pencil" cls="sm" />${t('edit_text')}</button></div>`}
    <div class="approve-actions">
      <button class="btn accent block big" disabled=${busy || (editing && !text.trim())} onClick=${() => act('send')}><${Icon} n="send" />${t('send_to', { name: firstName(name) })}</button>
      <button class="btn ghost block" style="margin-top:6px" disabled=${busy} onClick=${() => act('skip')}>${t('dont_send')}</button>
    </div>
  </div></main>`;
}

// ---------------------------------------------------------------- compare
export const CMP_ROWS = { bali: ['living_room', 'pool', 'electricity'], kz: ['rooms_kz', 'renovation', 'utilities_billing'], th: ['furnished', 'utilities_billing', 'deposit_months'] };
export const GOOD = new Set(['closed_ac', 'closed_no_ac', 'included', 'private', 'euro', 'full']);
export function cmpCell(l, k) {
  const f = l.fields ?? {};
  const v = f[k];
  if (v == null || v === '') return html`<span class="unk">${t('clarify')}</span>`;
  if (k === 'electricity' && ['token_tenant', 'postpaid_tenant'].includes(v)) return t('plus_power');
  if (k === 'utilities_billing' && v === 'by_meters') return t('plus_utils');
  let s = String(enumLabel(v)).split(',')[0].toLowerCase();
  if (k === 'pool' && f.pool_size_m) s += ` ${f.pool_size_m} ${LANG === 'ru' ? 'м' : 'm'}`;
  return GOOD.has(v) ? html`<span class="ok">${s}\u00a0<${Icon} n="check" /></span>` : s;
}
/** Compare: want_view, take, and anything the group rated. */
export const compareList = (d) => d.listings.filter((l) => l.decision === 'want_view' || l.decision === 'take' || ratingOf(l.id));
export const CMP_SORTS = ['score', 'price', 'interest'];
export let cmpSort = null;
export function Compare() {
  const d = D();
  const ls0 = compareList(d);
  const anyRated = ls0.some((l) => ratingOf(l.id));
  const [sort, setSort0] = useState(() => cmpSort ?? (anyRated ? 'score' : 'interest'));
  const setSort = (k) => { cmpSort = k; setSort0(k); };
  const sc = (l) => ratingOf(l.id)?.score ?? -1;
  const it = (l) => interestOf(l.id).score;
  const pr = (l) => l.price ?? 1e18;
  const cmpFn = { score: (a, b) => sc(b) - sc(a) || it(b) - it(a) || pr(a) - pr(b), price: (a, b) => pr(a) - pr(b) || sc(b) - sc(a), interest: (a, b) => it(b) - it(a) || sc(b) - sc(a) || pr(a) - pr(b) }[sort];
  const ls = [...ls0].sort(cmpFn);
  // ★ best: highest score; without ratings, the highest interest (only when it stands out).
  const byScore = [...ls0].filter((l) => ratingOf(l.id)).sort((a, b) => sc(b) - sc(a) || it(b) - it(a));
  const byInt = [...ls0].sort((a, b) => it(b) - it(a) || pr(a) - pr(b));
  const best = byScore.length && (byScore.length < 2 || sc(byScore[0]) > sc(byScore[1]) || it(byScore[0]) > it(byScore[1])) ? byScore[0]
    : !byScore.length && byInt.length > 1 && it(byInt[0]) > it(byInt[1]) ? byInt[0] : null;
  const fieldRows = (CMP_ROWS[d.search.country] ?? []).filter((k) => {
    const vals = ls.map((l) => l.fields?.[k]);
    return vals.some((v) => v != null) && (vals.some((v) => v == null) || new Set(vals.map(String)).size > 1);
  });
  const name = (l) => districtShort(l) || shortTitle(l.title);
  const note = [];
  if (best) {
    const r = ratingOf(best.id);
    const iv = interestOf(best.id);
    let line = r ? t('cmp_best_score', { a: name(best) }) + (iv.max && iv.score >= iv.max ? t('cmp_unanimous') : '') : t('cmp_best_interest', { a: name(best) });
    const rival = (r ? byScore : byInt).find((l) => l !== best && l.price);
    if (rival && best.price && rival.price !== best.price) {
      const diff = money(Math.abs(rival.price - best.price), best.currency);
      line += t(best.price < rival.price ? 'cmp_cheaper_than' : 'cmp_pricier_than', { x: diff, b: name(rival) });
    }
    note.push(line);
  } else {
    const cheap = ls.filter((l) => l.price).sort((a, b) => a.price - b.price)[0];
    if (cheap && ls.length > 1) note.push(t('cmp_cheapest', { a: name(cheap) }));
  }
  const weak = ls.map((l) => ({ l, r: ratingOf(l.id) })).filter((x) => x.r?.weak?.length).sort((a, b) => a.r.criteria[a.r.weak[0]] - b.r.criteria[b.r.weak[0]])[0];
  if (weak) {
    const c = [...weak.r.weak].sort((a, b) => weak.r.criteria[a] - weak.r.criteria[b])[0];
    note.push(t('cmp_weak', { b: name(weak.l), crit: t('cb_' + c).toLowerCase(), v: fmtScore(weak.r.criteria[c]) }));
  }
  for (const k of fieldRows) {
    const u = ls.find((l) => l.fields?.[k] == null);
    if (u) { note.push(t('cmp_unknown', { a: name(u), field: fieldLabel(k).toLowerCase() })); break; }
  }
  const crit = (l, c) => {
    const v = ratingOf(l.id)?.criteria?.[c];
    return v == null ? html`<span class="muted">—</span>` : html`<span class=${v < 3 ? 'low' : ''}>${fmtScore(v)}</span>`;
  };
  const nextSort = () => { hap.sel(); setSort(CMP_SORTS[(CMP_SORTS.indexOf(sort) + 1) % CMP_SORTS.length]); };
  const rated = ls0.filter((l) => ratingOf(l.id)).length;
  return html`<main class="screen">
    <div class="head"><div><p class="kicker">${rated ? t('cmp_kicker_viewed', { n: rated }) : t('compare_kicker', { n: ls.length })}</p><h1 class="h1">${t('compare')}</h1></div>
      ${ls.length > 1 && html`<button class="sort-pill" aria-label=${`${t('sort_by')}: ${t('sort_' + sort)}`} onClick=${nextSort}><${Icon} n="sort" cls="sm" />${t('sort_' + sort)}</button>`}</div>
    ${ls.length < 2 ? html`<div class="card" style="padding:18px"><p class="muted" style="margin:0">${t('compare_empty')}</p></div>` : html`
      <div class="cmp-wrap"><table class="cmp" style=${ls.length > 3 ? `min-width:${86 + ls.length * 104}px` : ''}>
        <colgroup><col style="width:86px" />${ls.map(() => html`<col />`)}</colgroup>
        <tr><th class="lbl"></th>${ls.map((l) => html`<td class="head-cell"><a href=${'#' + sp('listing', l.id)} onClick=${(e) => { e.preventDefault(); go(sp('listing', l.id)); }}>
          <div class="ph"><${Img} src=${photosOf(l)[0]} />${best === l && html`<span class="best"><${Icon} n="star" />${t('best')}</span>`}</div>
          <div class="pr">${priceText(l)}</div><div class="ds">${districtShort(l)}</div></a></td>`)}</tr>
        ${anyRated && html`<tr class="hl"><th class="lbl" scope="row">${t('row_score')}</th>${ls.map((l) => html`<td class=${'sc' + (best === l ? ' top' : '')}>${fmtScore(ratingOf(l.id)?.score)}</td>`)}</tr>
          <tr><th class="lbl" scope="row">${t('row_quiet')}</th>${ls.map((l) => html`<td>${crit(l, 'quiet')}</td>`)}</tr>
          <tr><th class="lbl" scope="row">${t('row_inside')}</th>${ls.map((l) => html`<td>${crit(l, 'inside')}</td>`)}</tr>`}
        <tr><th class="lbl" scope="row">${t('row_interest')}</th>${ls.map((l) => {
          const iv = interestOf(l.id);
          return html`<td>${anyRated ? t('x_of', { x: Math.max(0, iv.score), max: iv.max }) : html`<div class="cmp-int"><${VoteAvs} lid=${l.id} size=${26} /><span>${t('x_of', { x: Math.max(0, iv.score), max: iv.max })}</span></div>`}</td>`;
        })}</tr>
        ${ls.some((l) => l.location_score != null) && html`<tr><th class="lbl" scope="row">${t('lc_row')}</th>${ls.map((l) => html`<td>${l.location_score != null ? html`<a class=${'loc-cell ' + scoreCls(l.location_score)} href=${'#' + sp('location', l.id)} onClick=${(e) => { e.preventDefault(); go(sp('location', l.id)); }}>${l.location_score}</a>` : html`<span class="muted">—</span>`}</td>`)}</tr>`}
        ${fieldRows.map((k) => html`<tr><th class="lbl" scope="row">${fieldLabel(k)}</th>${ls.map((l) => html`<td>${cmpCell(l, k)}</td>`)}</tr>`)}
        ${!anyRated && html`<tr><th class="lbl" scope="row">${t('term')}</th>${ls.map((l) => {
          const a = availParts(l.available);
          return html`<td>${a.to ? t('to_d', { d: a.to }) : a.from ? t('from_d', { d: a.from }) : '—'}</td>`;
        })}</tr>`}
      </table></div>
      ${note.length > 0 && html`<div class="cmp-note"><${Icon} n="sparkles" /><div>${note.join('. ')}.</div></div>`}`}
    <${Nav} tab="listings" />
  </main>`;
}

// ---------------------------------------------------------------- scam check (16)
export const SIG_ICON = { ok: 'circle-check', warn: 'circle-help', todo: 'circle-dashed' };
export function checkCount(c) { return (c?.signals ?? []).filter((x) => x.status === 'warn').length; }
export function CheckBanner({ c, onClick }) {
  if (!c) return null;
  const n = checkCount(c);
  const v = c.verdict;
  const title = v === 'ok' ? t('ck_ok') : t(v === 'danger' ? 'ck_danger' : 'ck_caution', { n: Math.max(1, n) });
  const sub = c.advice || t('ck_' + v + '_sub');
  const Tag = onClick ? 'button' : 'div';
  return html`<${Tag} class=${'w2-banner v-' + v} onClick=${onClick}>
    <${Icon} n=${v === 'ok' ? 'circle-check' : 'shield-alert'} /><div class="grow"><b>${title}</b><span>${sub}</span></div>${onClick && html`<${Icon} n="chev" cls="sm muted" />`}</${Tag}>`;
}
export function CheckScreen({ id }) {
  const d = D();
  const l = listingById(id);
  const [busy, setBusy] = useState(false);
  if (!l) return html`<main class="screen no-nav"><div class="center-msg">${t('err_generic')}</div></main>`;
  const c = l.checks;
  const sub = [districtShort(l), l.bedrooms != null ? t('br', { n: l.bedrooms }) : null, priceText(l)].filter(Boolean).join(' · ');
  const docs = pick2(regionPack()?.owner_docs ? [regionPack().owner_docs.ru, regionPack().owner_docs.en] : null) ?? t('ck_ask_default');
  async function ask() {
    setBusy(true);
    try { await postInstruction(`${t('ck_ask_text', { docs })} (${l.title})`, 'ask_owner_docs', l.id); hap.ok(); toast(t('ck_asked')); }
    catch { toast(t('err_generic')); }
    setBusy(false);
  }
  return html`<main class="screen no-nav w2">
    <${W2Head} l=${l} title=${shortTitle(l.title)} sub=${sub} />
    ${c ? html`<${CheckBanner} c=${c} />
      <div class="card w2-list">${c.signals.map((x, k) => html`<div key=${k} class="w2-row sig">
        <${Icon} n=${SIG_ICON[x.status] ?? 'circle-dashed'} cls=${'s-' + x.status} /><div class="grow"><b>${x.title}</b>${x.detail && html`<span>${x.detail}</span>`}</div></div>`)}</div>`
      : html`<div class="card" style="padding:16px"><p class="muted" style="margin:0">—</p></div>`}
    ${canVoteRole(d.me.role) && html`<button class="btn surface block big w2-ask" disabled=${busy} onClick=${ask}><${Icon} n="sparkles" />${t('ck_ask')}</button>`}
    <p class="w2-foot">${t('ck_foot')}</p>
  </main>`;
}
