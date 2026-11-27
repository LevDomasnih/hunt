// Hunt Mini App and site: the entry esbuild bundles (scripts/build-web.mjs) with Preact + htm from npm.
import type { Regions } from './types/api.js';
import { AccessScreen } from './access.js';
import { AgentScreen } from './agent.js';
import { Afisha, EventDetail } from './app/afisha/afisha.js';
import { PartyEdit, PartyScreen } from './app/afisha/parties.js';
import { applyRegion, applyTheme, linkKey, load, startParam, themePref } from './app/core/api.js';
import { TG, inTG, tg } from './app/core/env.js';
import { applyLang, t } from './app/core/i18n.js';
import { back, go, useRoute } from './app/core/routing.js';
import { S, closeSheet, emit, useStore } from './app/core/store.js';
import { ToastEl } from './app/ui/toast.js';
import { ORD_SCREENS, TopBar, applyTone, toneFor } from './app/ui/shell.js';
import { Bikes } from './app/home/bikes.js';
import { Calendar, HomePlan } from './app/home/calendar.js';
import { DocDetail, Docs } from './app/home/docs.js';
import { Dossier, Items } from './app/home/dossier.js';
import { GuestContacts, GuestHome, GuestPlaces, GuestsScreen, GuideGuest, GuideMember } from './app/home/guests.js';
import { isLiving, regionPack } from './app/home/helpers.js';
import { Archive, HomeMap, HomeToday, MoreScreen, homeMode } from './app/home/homemode.js';
import { Home } from './app/home/house.js';
import { Money } from './app/home/money.js';
import { Moveout, NextScreen, Relet } from './app/home/moveout.js';
import { Onsite } from './app/home/onsite.js';
import { Directory, Person } from './app/home/people.js';
import { Power } from './app/home/power.js';
import { Split } from './app/home/rooms.js';
import { Act } from './app/home/scan3d.js';
import { SurfScreen } from './app/home/surf.js';
import { Important } from './app/home/visa.js';
import { BasketScreen, GoodScreen, OrderCheck, OrderScreen, OrdersScreen, SetApplyScreen, Sheet, ShopScreen } from './app/orders/orders.js';
import { DistrictDetail, DistrictsMap } from './app/places/districts.js';
import { Flood } from './app/places/flood.js';
import { LocationScreen, Places, ScoreScreen, Spots } from './app/places/places.js';
import { Chats } from './app/screens/chats.js';
import { Brief, Deal, NegoScreen } from './app/screens/deal.js';
import { Approve, CheckScreen, Compare, Deck, ListingDetail, Listings, Rate } from './app/screens/listings.js';
import { MapScreen } from './app/screens/map.js';
import { PathScreen, Reveal } from './app/screens/path.js';
import { Plan } from './app/screens/plan.js';
import { RecapScreen } from './app/screens/recap.js';
import { Picker } from './app/screens/searches.js';
import { Today } from './app/screens/today.js';
import { Useful } from './app/screens/useful.js';
import { Skeletons } from './app/ui/pieces.js';
import { demoOn, demoRegions } from './demo.js';
import { Desk, Door, deskTone, useWide } from './desk.js';
import { NewProject } from './newproject.js';
import { html, render } from 'htm/preact';
import { useEffect } from 'preact/hooks';


// ---------------------------------------------------------------- app
const DETAIL = new Set(['deck', 'listing', 'approve', 'compare', 'deal', 'brief', 'chats', 'rate', 'check', 'money', 'onsite', 'docs', 'doc', 'home',
  'moveout', 'contact', 'split', 'power', 'important', 'places', 'district', 'relet', 'directory', 'location', 'score', 'spots', 'flood', 'bikes', 'act', 'dossier', 'items', 'calendar',
  'surf', 'guide', 'next', 'nego', 'recap', 'guests', 'path']);
DETAIL.add('archive'); // wave 6 · D
DETAIL.add('useful'); // wave 6 · B
DETAIL.add('event'); // wave 7
DETAIL.add('afisha');
DETAIL.add('party'); DETAIL.add('party-edit'); // wave 9
for (const k of ORD_SCREENS) DETAIL.add(k); // wave 10
DETAIL.add('access');
DETAIL.add('agent');
function App() {
  useStore();
  const wide = useWide();
  const route = useRoute();
  useEffect(() => {
    const r = route;
    if (r.screen === 'picker' || r.screen === 'newproject') { if (!S.data) load(null); return; }
    if (r.sid) { if (S.data?.search?.id !== r.sid) load(r.sid); return; }
    (async () => {
      const lid = r.legacy && r.screen === 'listing' ? r.arg : startParam;
      await load(null, { listing: lid });
      const d = S.data;
      if (!d) return;
      if (d.search) {
        const target = r.legacy && r.screen === 'plan' ? 'plan' : lid && d.listings.some((l) => l.id === lid) ? `listing/${encodeURIComponent(lid)}` : 'today';
        go(`/s/${d.search.id}/${target}`, true);
      } else if (d.searches.length > 1) go('/searches', true);
    })();
  }, [route.key]);
  useEffect(() => {
    if (!inTG) return;
    const bb = TG.BackButton;
    const d = S.data;
    const emptySearch = d?.search && !d.listings?.length && (route.screen === 'listings' || !d.viewings?.length);
    const toPicker = route.sid && (d?.searches?.length ?? 0) > 1 && (route.screen === 'today' || (emptySearch && ['today', 'listings'].includes(route.screen)));
    const onBack = toPicker ? () => go('/searches') : () => back();
    if (DETAIL.has(route.screen) || toPicker) { tg(() => { bb.show(); bb.onClick(onBack); }); }
    else tg(() => bb.hide());
    return () => tg(() => bb.offClick(onBack));
  }, [route.screen, route.sid, S.data?.searches?.length, S.data?.search?.id, S.data?.listings?.length]);
  useEffect(() => { window.scrollTo(0, 0); if (S.sheet) closeSheet(); }, [route.key]);

  const d = S.data;
  let view;
  if (S.error?.status === 401 && !inTG && !linkKey) {
    return html`<${Door} onIn=${() => { S.error = null; S.data = null; emit(); load(route.sid ?? null); }} /><${ToastEl} />`;
  }
  if (S.error && (!d || (route.sid && d.search?.id !== route.sid))) {
    const msg = S.error.status === 401 ? t('err_auth') : S.error.code === 'not_member' ? t('err_member') : t('err_generic');
    view = html`<main class="screen no-nav"><div class="center-msg"><p class="h2">Hunt</p><p>${msg}</p><button class="btn accent" onClick=${() => load(route.sid ?? null)}>${t('retry')}</button></div></main>`;
  } else if (!d || (route.sid && d.search?.id !== route.sid) || route.screen === 'start') {
    view = html`<main class="screen no-nav"><div class="head"><div><p class="kicker">&nbsp;</p><div class="skeleton" style="height:30px;width:60%;border-radius:10px"></div></div></div><${Skeletons} /></main>`;
  } else if (route.screen === 'newproject') {
    view = html`<${NewProject} />`;
  } else if (route.screen === 'picker' || !d.search) {
    view = html`<${Picker} />`;
  } else if (d.me?.role === 'guest') {
    // Guests see a reduced app: home, guide, places, contacts. Any other route falls back to the guest home.
    const ga = d.me.guest?.areas ?? {};
    const sc = route.screen;
    view = sc === 'guide' && ga.guide ? html`<${GuideGuest} />` : sc === 'gplaces' && ga.places ? html`<${GuestPlaces} />` : sc === 'gcontacts' && ga.contacts ? html`<${GuestContacts} />`
      : sc === 'surf' && ga.places ? html`<${SurfScreen} />` : sc === 'useful' ? html`<${Useful} />` : html`<${GuestHome} />`;
  } else if (!d.me.reveal_seen && d.me.animal) {
    view = html`<${Reveal} />`;
  } else {
    const a = route.arg;
    const screens: { [screen: string]: () => unknown } = {
      today: () => (homeMode() ? html`<${HomeToday} />` : isLiving() ? html`<${Home} />` : html`<${Today} />`),
      home: () => html`<${Home} />`,
      check: () => html`<${CheckScreen} id=${a} />`,
      money: () => html`<${Money} />`,
      onsite: () => html`<${Onsite} id=${a} />`,
      docs: () => html`<${Docs} />`,
      doc: () => html`<${DocDetail} id=${a} />`,
      listings: () => html`<${Listings} arg=${a} />`,
      deck: () => html`<${Deck} />`,
      listing: () => html`<${ListingDetail} id=${a} />`,
      rate: () => html`<${Rate} id=${a} />`,
      compare: () => html`<${Compare} />`,
      approve: () => html`<${Approve} />`,
      plan: () => (homeMode() ? html`<${HomePlan} />` : html`<${Plan} />`),
      map: () => (String(a ?? '').startsWith('districts') && regionPack()?.areas ? html`<${DistrictsMap} key=${a} sel=${String(a).split(':')[1] ?? null} />` : homeMode() ? html`<${HomeMap} arg=${a} />` : html`<${MapScreen} arg=${a} />`),
      deal: () => html`<${Deal} />`,
      brief: () => html`<${Brief} arg=${a} />`,
      chats: () => html`<${Chats} arg=${a} />`,
      moveout: () => html`<${Moveout} />`,
      contact: () => html`<${Person} cid=${a} />`,
      split: () => html`<${Split} />`,
      power: () => html`<${Power} />`,
      important: () => html`<${Important} />`,
      places: () => html`<${Places} id=${a} />`,
      district: () => html`<${DistrictDetail} id=${a} />`,
      relet: () => html`<${Relet} />`,
      directory: () => html`<${Directory} />`,
      location: () => html`<${LocationScreen} id=${a} />`,
      score: () => html`<${ScoreScreen} id=${a} />`,
      spots: () => html`<${Spots} />`,
      flood: () => html`<${Flood} id=${a} />`,
      bikes: () => html`<${Bikes} />`,
      act: () => html`<${Act} />`,
      dossier: () => html`<${Dossier} id=${a} />`,
      items: () => html`<${Items} />`,
      calendar: () => html`<${Calendar} />`,
      surf: () => html`<${SurfScreen} />`,
      useful: () => html`<${Useful} />`, // wave 6 · B
      afisha: () => html`<${Afisha} key=${a ?? 'all'} arg=${a} />`, // wave 7
      event: () => html`<${EventDetail} id=${a} />`,
      party: () => html`<${PartyScreen} key=${a} id=${a} />`, // wave 9
      'party-edit': () => html`<${PartyEdit} key=${a} id=${a} />`,
      orders: () => html`<${OrdersScreen} />`, // wave 10
      shop: () => html`<${ShopScreen} key=${a ?? ''} arg=${a} />`,
      good: () => html`<${GoodScreen} id=${a} />`,
      basket: () => html`<${BasketScreen} key=${a} id=${a} />`,
      'order-check': () => html`<${OrderCheck} key=${a} id=${a} />`,
      order: () => html`<${OrderScreen} key=${a} id=${a} />`,
      'set-apply': () => html`<${SetApplyScreen} key=${a} id=${a} />`,
      guide: () => html`<${GuideMember} />`,
      next: () => html`<${NextScreen} />`,
      nego: () => html`<${NegoScreen} id=${a} />`,
      recap: () => html`<${RecapScreen} />`,
      guests: () => html`<${GuestsScreen} />`,
      path: () => html`<${PathScreen} />`, // wave 6 · A
      access: () => html`<${AccessScreen} key=${a ?? ''} arg=${a} />`,
      agent: () => html`<${AgentScreen} />`,
      more: () => html`<${MoreScreen} />`,
      archive: () => html`<${Archive} />`,
    };
    view = screens[route.screen]?.() ?? html`<${Today} />`;
  }
  // wave 8: the screen colour follows the route (TG header too); the top bar sits on every screen but the animal reveal
  const tone0 = view && d && !(d.me && !d.me.reveal_seen && d.me.animal && d.me.role !== 'guest') ? toneFor(route.screen, route.arg) : 'grey';
  const onDesk = wide && d?.search && d.me && d.me.role !== 'guest' && (!route.sid || d.search.id === route.sid) && route.sid && !(!d.me.reveal_seen && d.me.animal);
  const tone = onDesk ? deskTone(route.screen, tone0, route.arg) : tone0;
  useEffect(() => applyTone(tone), [tone]);
  if (onDesk) return html`<${Desk} route=${route} view=${view} /><${Sheet} /><${ToastEl} />`;
  if (wide && route.screen === 'newproject') return html`${view}<${Sheet} /><${ToastEl} />`;
  const bar = route.screen !== 'newproject' && !(d?.me && !d.me.reveal_seen && d.me.animal && d.me.role !== 'guest') && html`<${TopBar} screen=${route.screen === 'picker' || !d?.search ? 'picker' : route.screen} />`;
  return html`${bar}${view}<${Sheet} /><${ToastEl} />`;
}

// ---------------------------------------------------------------- boot
tg(() => { TG.ready(); TG.expand(); });
if (inTG) tg(() => TG.onEvent('themeChanged', applyTheme));
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (themePref() === 'auto') applyTheme(); });
if (!inTG && !/^(ru|uk|be|kk)/i.test(navigator.language ?? '')) applyLang('en'); // until the person's own language is known
applyTheme();
(demoOn ? demoRegions() : fetch('/art/regions.json').then((r) => r.json() as Promise<Regions>)).then((j): void => { S.regions = j; if (S.data?.search) applyRegion(S.data.search.country); emit(); }).catch((): null => null);
render(html`<${App} />`, document.getElementById('root'));

