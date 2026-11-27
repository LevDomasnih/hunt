// The app's chrome that knows the screens: the screen colour of a route and the top bar. Only the entry (app.ts) imports it,
// so the shared pieces (pieces.ts) never import a screen.
import { npTone } from '../../newproject.js';
import { cssVar, themePref } from '../core/api.js';
import { D, districtShort, homeMode } from '../core/data.js';
import { TG, inTG, tg } from '../core/env.js';
import { shortTitle } from '../core/format.js';
import { t } from '../core/i18n.js';
import { go } from '../core/routing.js';
import { hap, openSheet } from '../core/store.js';
import { homeListing, nightMode } from '../home/homemode.js';
import { ordTone } from '../orders/orders.js';
import { chArchRoute } from '../screens/chats.js';
import { Icon } from './icons.js';
import { localHour } from './pieces.js';
import { html } from 'htm/preact';

/** Screen colour of a route (wave 8.1: every main tab its own): region (Home / Today, path, checklists), afisha (night palette in the
 * evening, afisha-day = hot coral 06:00–17:00), money (mint), more (sky), night (evening Home, dark theme via CSS), grey (secondary
 * screens: docs, lists, details). KZ / TH swaps for a clash with the region colour live in app.css. */
export const ORD_SCREENS = new Set(['shop', 'good', 'basket', 'order-check', 'order', 'orders', 'set-apply']);
export const TONE_REGION = new Set(['today', 'path', 'deal', 'onsite', 'moveout', 'next']);
export function toneFor(screen: string, arg?: string): string {
  const d = D();
  if (screen === 'newproject') return npTone();
  if (!d?.search || screen === 'picker' || screen === 'start') return 'grey';
  if (d.me?.role === 'guest') return screen === 'today' || !screen ? 'region' : 'grey';
  if (screen === 'afisha' || screen === 'event' || screen === 'party') { if (themePref() === 'light') return 'afisha-day'; if (themePref() === 'dark') return 'afisha'; const h = localHour(); return h >= 6 && h < 17 ? 'afisha-day' : 'afisha'; }
  if (screen === 'money') return 'money';
  if (screen === 'more') return 'more';
  if (screen === 'access') return ['sees', 'off', 'receipt'].includes(arg) ? 'grey' : arg === 'limit' ? 'money' : 'access';
  if (screen === 'agent') return 'access'; // "Подключить агента": sky like connecting the chats
  if (screen === 'chats' && arg && d.me?.role === 'owner' && (d.drafts ?? []).some((x) => x.contact_id === arg)) return 'access';
  if (screen === 'chats' && homeMode()) return chArchRoute(arg) ? 'grey' : 'access'; // wave 8.3: the home's chats sky, the archive calm grey
  if (ORD_SCREENS.has(screen)) return ordTone(screen, arg); // wave 10: lilac, the fish shop sky
  if (screen === 'today' && nightMode()) return 'night';
  return TONE_REGION.has(screen) ? 'region' : 'grey';
}
export function applyTone(tone: string) {
  const el = document.documentElement;
  if (el.dataset.tone === tone) return;
  el.dataset.tone = tone;
  tg(() => {
    if (!inTG) return;
    const g = cssVar('--ground');
    TG.setHeaderColor(g);
    TG.setBackgroundColor(g);
    TG.setBottomBarColor?.(g);
  });
}
/** K1 top bar: "hunt" · where we are (opens the project switcher) · menu (settings). Projects list: "+" instead. */
export function TopBar({ screen }: { screen: string }) {
  const d = D();
  const s = d?.search;
  const picker = screen === 'picker' || !s;
  const where = s ? (homeMode() ? districtShort(homeListing()) || shortTitle(s.title) : shortTitle(s.title)) : '';
  return html`<header class="w8-bar">
    <span class="w8-logo">hunt</span>
    ${!picker && where && html`<button class="w8-where" aria-haspopup="dialog" aria-label=${t('my_searches') + ': ' + where} onClick=${() => { hap.sel(); openSheet('switch'); }}><span class="ellipsis">${where}</span></button>`}
    ${picker ? (D()?.user?.can_create ? html`<button class="w8-burger" aria-label=${t('np_new')} onClick=${() => { hap.sel(); go('/new'); }}><${Icon} n="plus" /></button>` : null)
      : d?.user && html`<button class="w8-burger" aria-label=${t('settings_btn')} onClick=${() => { hap.sel(); openSheet('settings'); }}><${Icon} n="menu" /></button>`}
  </header>`;
}
