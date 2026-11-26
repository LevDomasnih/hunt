// Split from app.js (wave 11): see the section comment below.
import { D } from '../core/data.js';
import { t } from '../core/i18n.js';
import { go } from '../core/routing.js';
import { hap } from '../core/store.js';
import { Icon } from '../ui/icons.js';
import { SearchCard } from './path.js';
import { html } from 'htm/preact';

// ---------------------------------------------------------------- screens: searches
export function Picker() {
  const d = D();
  return html`<main class="screen no-nav pk8">
    <div class="head"><div><h1 class="w8-title">${t('pp_projects')}</h1></div></div>
    ${d.searches.length ? html`<div class="stack pp-cards">${d.searches.map((s) => html`<${SearchCard} key=${s.id} s=${s} />`)}</div>`
      : html`<div class="center-msg"><p class="h2">${d.user?.can_create ? t('np_first') : t('no_searches')}</p><p>${d.user?.can_create ? t('np_first_text') : t('no_searches_text')}</p></div>`}
    ${d.user?.can_create && html`<div class="or-send or-dock"><button class="btn accent big grow" onClick=${() => { hap.sel(); go('/new'); }}><${Icon} n="plus" cls="sm" />${t('np_new')}</button></div>`}
  </main>`;
}
