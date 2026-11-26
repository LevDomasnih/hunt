// A new project from the app (design/mockup-v7): where, what we do, the areas on the toy map with a short card about each ("Короче"),
// when and how much, done. Invited hunters only (state user.can_create). A wish typed for Hunt goes to the agent as an instruction.
// Imported by app.js; the names below are used only while rendering (a circular import).
import { html, useState, useEffect } from 'https://unpkg.com/htm@3.1.1/preact/standalone.module.js';
import { S, D, LANG, api, emit, hap, toast, go, load, Icon, Typed, Sticker, money, copyText, openLink, inTG, t } from './app.js';
import { useWide } from './desk.js';
import { demoOn } from './demo.js';

const L = (ru, en) => (LANG === 'en' ? en : ru);
const NP = { step: 1, country: null, city: null, mode: 'search', areas: [], open: null, move_in: '', term: '6', beds: '2', cap: '', title: '', wish: '', done: null, busy: false };
export const npTone = () => (NP.country && NP.step > 1 ? 'region' : 'grey');
const nm = (o) => (o ? o[LANG] ?? o.en ?? o.ru ?? Object.values(o)[0] : '');
const reg = () => S.regions?.[NP.country];
const cityAreas = () => Object.entries(reg()?.areas ?? {}).filter(([, a]) => a.city === NP.city);
const TERMS = [['1', ['1 мес', '1 mo']], ['3', ['3', '3']], ['6', ['6', '6']], ['12', ['12', '12']], ['', ['Пока не знаем', 'Not sure yet']]];
const BEDS = [['0', ['Студия', 'Studio']], ['1', ['1', '1']], ['2', ['2', '2']], ['3', ['3+', '3+']]];
const SCORES = [['food', ['Еда', 'Food']], ['quiet', ['Тихо', 'Quiet']], ['nightlife', ['Ночь', 'Nightlife']], ['coworking', ['Коворкинги', 'Coworking']], ['surf', ['Сёрф', 'Surf']]];

/** The toy map of the city (v2 3D or v1 flat island): signs on posts; on a phone only the chosen and the open area are named. */
const islCache = {};
function useIsland(country, city) {
  const key = country && city && (S.regions?.[country]?.islands ?? []).includes(city) ? (demoOn ? `/demo-home/island-${city}` : `/art/${country}/island-${city}`) : null;
  const [v, setV] = useState(islCache[key] ?? null);
  useEffect(() => { if (!key) { setV(null); return; } if (islCache[key]) { setV(islCache[key]); return; } fetch(key + '.json').then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) { islCache[key] = { ...j, src: key + '.webp' }; setV(islCache[key]); } }).catch(() => null); }, [key]);
  return v;
}
function AreaMap({ wide, rerender }) {
  const isl = useIsland(NP.country, NP.city);
  const areas = cityAreas();
  const pick = (id) => { hap.sel(); NP.open = id; rerender(); };
  if (!isl || !isl.areas) {   // no toy land for this city: the areas as a list
    return html`<div class="np-alist">${areas.map(([id, a]) => html`<button key=${id} class=${'np-arow' + (NP.areas.includes(id) ? ' on' : '')} onClick=${() => pick(id)}><b>${nm(a.name)}</b><span>${nm(a.group)}</span>${NP.areas.includes(id) && html`<${Icon} n="check" cls="sm" />`}</button>`)}</div>`;
  }
  return html`<div class="np-map" style=${`aspect-ratio:${isl.width}/${isl.height};--ar:${isl.width / isl.height}`}><img src=${isl.src} alt="" draggable="false" />
    ${Object.entries(isl.areas).map(([id, [x, y]]) => {
      const on = NP.areas.includes(id), open = NP.open === id, named = wide || on || open;
      const name = isl.names?.[id]?.[LANG === 'ru' ? 'ru' : 'en'] ?? nm(reg()?.areas?.[id]?.name) ?? id;
      return html`<button key=${id} class=${'np-sign' + (on ? ' on' : '') + (open ? ' open' : '') + (named ? '' : ' dot')} style=${`left:${(x / isl.width) * 100}%;top:${(y / isl.height) * 100}%`} aria-pressed=${on ? 'true' : 'false'} aria-label=${name} onClick=${() => pick(id)}>
        ${named ? html`${on && html`<${Icon} n="check" cls="xs" />`}<span>${name}</span>` : null}</button>`;
    })}</div>`;
}
/** "Короче": the area in one breath — what it is, the price for your bedrooms, the ride to the airport, scores, tags. */
function ShortCard({ rerender, dark = false }) {
  const id = NP.open, a = reg()?.areas?.[id];
  if (!a) return html`<div class="np-card empty"><p>${L('Нажми на район на карте: расскажу коротко, что там и почём', 'Tap an area on the map: a short word on what it is like and what it costs')}</p></div>`;
  const on = NP.areas.includes(id), cur = reg()?.currency, pr = a.price?.[NP.beds === '0' ? '1' : NP.beds] ?? a.price?.['2'];
  const vibe = String(nm(a.vibe) ?? '').split(/(?<=[.!?])\s/).slice(0, 2).join(' ');
  const toggle = (v) => { hap.sel(); NP.areas = v ? [...new Set([...NP.areas, id])] : NP.areas.filter((x) => x !== id); if (!v) NP.open = null; rerender(); };
  return html`<section class=${'np-card' + (dark ? ' dark' : '')} aria-label=${nm(a.name)}>
    <div class="np-card-h"><h2>${nm(a.name)}</h2><span class="np-tag">${L('Короче', 'In short')}</span></div>
    <p class="np-vibe">${vibe}</p>
    <div class="np-nums">${pr && html`<div><b>${range(pr[0], pr[1], cur)}</b><span>${NP.beds === '0' ? L('студия', 'studio') : L(`${NP.beds === '3' ? '3+' : NP.beds} ${NP.beds === '1' ? 'спальня' : 'спальни'}`, `${NP.beds === '3' ? '3+' : NP.beds} bedroom`)}</span></div>`}
      ${a.airport_min != null && html`<div><b>${a.airport_min} ${L('мин', 'min')}</b><span>${L('до аэропорта', 'to the airport')}</span></div>`}</div>
    <div class="np-scores">${SCORES.filter(([k]) => a.scores?.[k] != null && !(k === 'surf' && a.scores[k] <= 1)).slice(0, 4).map(([k, n]) => html`<div key=${k}><span>${L(...n)}</span><i role="img" aria-label=${`${a.scores[k]} / 5`}>${[1, 2, 3, 4, 5].map((i) => html`<b class=${i <= a.scores[k] ? 'on' : ''}></b>`)}</i></div>`)}</div>
    ${(nm(a.tags) ?? []).length > 0 && html`<div class="np-tags">${nm(a.tags).slice(0, 4).map((x) => html`<span key=${x}>${x}</span>`)}</div>`}
    <div class="np-acts">${on ? html`<button class="btn accent grow" onClick=${() => toggle(false)}><${Icon} n="check" cls="sm" />${L('Выбран', 'Chosen')}</button><button class="btn surface" onClick=${() => toggle(false)}>${L('Убрать', 'Remove')}</button>`
      : html`<button class="btn accent grow" onClick=${() => toggle(true)}><${Icon} n="check" cls="sm" />${L('Хочу тут', 'I want here')}</button><button class="btn surface" onClick=${() => { hap.sel(); NP.open = null; rerender(); }}>${L('Не моё', 'Not mine')}</button>`}</div>
  </section>`;
}
/** 1 000–1 700 € (the unit once). */
const range = (lo, hi, cur) => { const a = money(lo, cur), b = money(hi, cur), unit = b.replace(/^[\d\s.,\u00a0\u202f]+/, ''); return `${unit ? a.replace(unit, '').trim() : a}–${b}`; };
const priceHint = () => {
  const cur = reg()?.currency, ps = NP.areas.map((id) => reg()?.areas?.[id]?.price?.[NP.beds === '0' ? '1' : NP.beds]).filter(Boolean);
  if (!ps.length) return null;
  const lo = Math.min(...ps.map((p) => p[0])), hi = Math.max(...ps.map((p) => p[1]));
  const names = NP.areas.map((id) => nm(reg()?.areas?.[id]?.name)).slice(0, 3).join(', ');
  return L(`${names}: обычно ${range(lo, hi, cur)} в месяц`, `${names}: usually ${range(lo, hi, cur)} a month`);
};
const Chips = ({ list, val, onPick }) => html`<div class="np-chips">${list.map(([v, n]) => html`<button key=${v} aria-pressed=${val === v ? 'true' : 'false'} onClick=${() => { hap.sel(); onPick(v); }}>${L(...n)}</button>`)}</div>`;

async function create(rerender) {
  if (NP.busy) return;
  NP.busy = true; rerender();
  const r = reg();
  try {
    const out = await api('/app/api/searches', {
      region: `${NP.country}/${NP.city}`, mode: NP.mode, title: NP.title.trim() || nm(r?.sub?.[NP.city]?.name ?? r?.sub?.[NP.city]) || nm(r?.name), wish: NP.wish.trim() || undefined,
      brief: { districts: NP.areas, bedrooms: NP.mode === 'search' ? [NP.beds === '0' ? 'studio' : NP.beds === '3' ? '3+' : NP.beds] : undefined, move_in: NP.move_in || undefined, term: NP.term ? `${NP.term} ${L('мес', 'months')}` : undefined, budget_cap: NP.cap ? Number(String(NP.cap).replace(/[^\d]/g, '')) : undefined, currency: r?.currency, timezone: r?.tz },
    });
    NP.done = out; NP.step = 5; hap.ok();
  } catch (e) { toast(demoOn ? L('В демо это не работает', 'Not in the demo') : e?.code === 'not_hunter' ? L('Создавать проекты могут приглашённые охотники', 'Only invited hunters start projects') : e?.code === 'sensitive' ? L('Без паспортов и карт, пожалуйста', 'No passport or card numbers, please') : t('err_generic')); }
  NP.busy = false; rerender();
}
const reset = () => Object.assign(NP, { step: 1, country: null, city: null, mode: 'search', areas: [], open: null, move_in: '', term: '6', beds: '2', cap: '', title: '', wish: '', done: null, busy: false });

export function NewProject() {
  const rerender = emit;   // the whole app re-renders: the screen colour follows the step (npTone)
  const wide = useWide();
  useEffect(() => { if (D()?.user && !D().user.can_create) go('/searches', true); }, []);
  useEffect(() => { if (NP.country) document.documentElement.dataset.region = NP.country; });
  const r = reg(), cities = Object.entries(r?.sub ?? {}).filter(([c]) => Object.values(r.areas ?? {}).some((a) => a.city === c));
  const hasAreas = NP.mode === 'search' && cityAreas().length > 0;
  const next = () => { hap.sel(); NP.step = NP.step === 2 && !hasAreas ? 4 : NP.step + 1; window.scrollTo(0, 0); rerender(); };
  const prev = () => { hap.sel(); if (NP.step <= 1) { reset(); go('/searches', true); return; } NP.step = NP.step === 4 && !hasAreas ? 2 : NP.step - 1; rerender(); };
  const city = nm(r?.sub?.[NP.city]?.name ?? r?.sub?.[NP.city]);
  const wishBar = html`<label class="np-wish"><input value=${NP.wish} maxlength="1000" placeholder=${L('Или напиши Hunt, что важно', 'Or tell Hunt what matters')} onInput=${(e) => { NP.wish = e.currentTarget.value; }} /><${Icon} n="msg" cls="sm" /></label>`;
  let body, dock;
  if (NP.step === 1) {
    body = html`<${Typed} key=${'np' + NP.step + NP.mode} lines=${[L('Куда едете?', 'Where are you going?')]} as="h1" />
      <div class="np-countries">${Object.entries(S.regions ?? {}).filter(([, v]) => v.areas && Object.keys(v.sub ?? {}).length).map(([k, v]) => html`<button key=${k} data-region=${k} aria-pressed=${NP.country === k ? 'true' : 'false'} onClick=${() => { hap.sel(); if (NP.country !== k) { NP.country = k; NP.city = null; NP.areas = []; NP.open = null; } rerender(); }}><i></i>${nm(v.name)}</button>`)}</div>
      ${NP.country && html`<p class="np-h">${L('Город', 'City')}</p><${Chips} list=${cities.map(([c, n]) => [c, [nm(n.name ?? n), nm(n.name ?? n)]])} val=${NP.city} onPick=${(c) => { if (NP.city !== c) { NP.areas = []; NP.open = null; } NP.city = c; rerender(); }} />`}`;
    dock = html`<button class="btn accent big grow" disabled=${!NP.country || !NP.city} onClick=${next}>${L('Дальше', 'Next')}</button>`;
  } else if (NP.step === 2) {
    body = html`<${Typed} key=${'np' + NP.step + NP.mode} lines=${[L(`${city}. Что делаем?`, `${city}. What are we doing?`)]} as="h1" />
      <div class="ax-list" role="radiogroup">
        ${[['search', L('Ищем жильё', 'Looking for a home'), L('Hunt собирает варианты, пишет хозяевам, ведёт просмотры', 'Hunt collects homes, writes to owners, plans viewings')], ['living', L('Уже живём', 'Already living there'), L('Деньги, заказы, афиша и документы дома', 'Money, orders, events and papers of the house')]].map(([v, ti, sub]) => html`<button key=${v} class="ax-radio" role="radio" aria-checked=${NP.mode === v ? 'true' : 'false'} onClick=${() => { hap.sel(); NP.mode = v; rerender(); }}>
          <span class="ax-dot">${NP.mode === v && html`<${Icon} n="check" cls="sm" />`}</span><span class="grow"><b>${ti}</b><i>${sub}</i></span></button>`)}
      </div>`;
    dock = html`<button class="btn accent big grow" onClick=${next}>${L('Дальше', 'Next')}</button>`;
  } else if (NP.step === 3) {
    body = html`<${Typed} key=${'np' + NP.step + NP.mode} lines=${[L('Где хочется жить?', 'Where would you like to live?')]} as="h1" />
      <p class="np-sub">${NP.areas.length ? L(`Выбрано: ${NP.areas.map((id) => nm(r.areas[id]?.name)).join(', ')}`, `Chosen: ${NP.areas.map((id) => nm(r.areas[id]?.name)).join(', ')}`) : L('Нажми на район: расскажу коротко', 'Tap an area for a short word on it')}</p>
      <${AreaMap} wide=${wide} rerender=${rerender} />${!wide && NP.open && html`<${ShortCard} rerender=${rerender} />`}`;
    dock = html`<button class="btn accent big grow" onClick=${next}>${NP.areas.length ? L('Дальше', 'Next') : L('Без районов, дальше', 'No areas, next')}</button>`;
  } else if (NP.step === 4) {
    const hint = priceHint();
    body = html`<${Typed} key=${'np' + NP.step + NP.mode} lines=${[NP.mode === 'living' ? L('С какого числа живёте?', 'Since when do you live there?') : L('Когда и на сколько?', 'When and for how long?')]} as="h1" />
      <label class="np-field"><span>${NP.mode === 'living' ? L('Заехали', 'Moved in') : L('Заезд', 'Move in')}</span><input type="date" value=${NP.move_in} onInput=${(e) => { NP.move_in = e.currentTarget.value; rerender(); }} /></label>
      <p class="np-h">${L('Срок', 'Term')}</p><${Chips} list=${TERMS} val=${NP.term} onPick=${(v) => { NP.term = v; rerender(); }} />
      ${NP.mode === 'search' && html`<p class="np-h">${L('Спален', 'Bedrooms')}</p><${Chips} list=${BEDS} val=${NP.beds} onPick=${(v) => { NP.beds = v; rerender(); }} />
        <label class="np-field"><span>${L('Потолок в месяц', 'Monthly cap')}</span><input inputmode="numeric" placeholder=${r?.currency ?? ''} value=${NP.cap} onInput=${(e) => { NP.cap = e.currentTarget.value; }} /><em class="np-only">${L('видишь только ты', 'only you see it')}</em></label>`}
      <label class="np-field"><span>${L('Название', 'Name')}</span><input maxlength="80" placeholder=${city} value=${NP.title} onInput=${(e) => { NP.title = e.currentTarget.value; }} /></label>
      <p class="np-sub">${hint ? hint + '. ' : ''}${L('Это можно поменять потом. Остальное Hunt спросит сам', 'You can change it later. Hunt asks the rest itself')}</p>${!wide && wishBar}`;
    dock = html`<button class="btn accent big grow" disabled=${NP.busy} onClick=${() => create(rerender)}>${L('Создать проект', 'Create the project')}</button>`;
  } else {
    const id = NP.done?.id, link = NP.done?.invite_link;
    const invite = () => { if (!link) return; const u = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(L('Ищем жильё вместе в Hunt', 'Let us find a home together in Hunt'))}`; if (inTG) openLink(u); else if (navigator.share) navigator.share({ url: link }).catch(() => null); else window.open(u, '_blank', 'noopener'); };
    const open = async () => { reset(); await load(id); go(`/s/${id}/today`, true); };
    body = html`<div class="np-done"><${Sticker} text=${L('твой проект', 'your project')} cls="np-sticker" /></div>
      <${Typed} key=${'np' + NP.step + NP.mode} lines=${[L(`${NP.title.trim() || city} готов`, `${NP.title.trim() || city} is ready`)]} as="h1" />
      <div class="ax-list">
        <button class="ax-row" onClick=${invite}><${Icon} n="userplus" /><span class="grow"><b>${L('Позвать друзей', 'Invite friends')}</b><i>${L('Ссылка в Telegram: они выберут себе зверя', 'A Telegram link: they pick an animal')}</i></span><${Icon} n="arrow-up-right" cls="sm" /></button>
        ${link && html`<button class="ax-row" onClick=${() => copyText(link)}><${Icon} n="copy" /><span class="grow"><b>${L('Скопировать ссылку', 'Copy the link')}</b><i>${link.replace('https://', '')}</i></span></button>`}
        <div class="ax-row"><${Icon} n="sparkles" /><span class="grow"><b>${L('Чтобы Hunt искал', 'For Hunt to search')}</b><i>${L('Подключи агента на компьютере: /hunt connect. На сервере скоро', 'Connect the agent on a computer: /hunt connect. On the server soon')}</i></span></div>
      </div>`;
    dock = html`<button class="btn accent big grow" onClick=${open}>${L('Открыть проект', 'Open the project')}</button><button class="btn surface big" disabled=${!link} onClick=${invite}>${L('Позвать', 'Invite')}</button>`;
  }
  const dots = NP.step < 5 && html`<div class="np-steps" aria-label=${L(`Шаг ${NP.step}`, `Step ${NP.step}`)}>${[1, 2, 3, 4].filter((i) => hasAreas || i !== 3).map((i) => html`<i key=${i} class=${i === NP.step ? 'on' : i < NP.step ? 'past' : ''}></i>`)}</div>`;
  const back = NP.step < 5 && html`<button class="round np-back" aria-label=${L('Назад', 'Back')} onClick=${prev}><${Icon} n="arrow-left" /></button>`;
  if (wide) {   // the desk: the steps on the left, the work in the middle, Hunt with the short card on the right
    const names = [[1, L('Где', 'Where'), city ? `${nm(r?.name)}, ${city}` : ''], [2, L('Что делаем', 'What we do'), NP.step > 2 ? (NP.mode === 'living' ? L('Уже живём', 'Living') : L('Ищем жильё', 'Searching')) : ''], ...(hasAreas || NP.step < 3 ? [[3, L('Районы', 'Areas'), NP.areas.map((id) => nm(r?.areas?.[id]?.name)).join(', ')]] : []), [4, L('Когда и сколько', 'When and how much'), '']];
    return html`<div class="np-desk">
      <nav class="np-rail"><span class="dk-logo">hunt</span>${names.map(([i, a, b]) => html`<div key=${i} class=${'np-st' + (i === NP.step ? ' on' : i < NP.step ? ' past' : '')}><i></i><span><b>${a}</b>${b && html`<small>${b}</small>`}</span></div>`)}</nav>
      <main class=${'np-main' + (NP.step === 3 ? ' map' : '')}>${back}${body}<div class="np-dock">${dock}</div></main>
      <aside class="dk-dev np-dev" aria-label="Hunt"><header class="dk-dev-h"><span class="dk-h" aria-hidden="true">h</span><div class="grow"><b>Hunt</b><span>${NP.step === 3 ? L('помогаю выбрать район', 'helping you pick an area') : L('новый проект', 'a new project')}</span></div></header>
        <div class="dk-dev-b">${NP.step === 3 ? html`<${ShortCard} rerender=${rerender} dark />
          ${NP.areas.length > 0 && html`<div class="dk-log"><h3>${L('Выбрано', 'Chosen')}</h3>${NP.areas.map((id) => html`<div key=${id}><span class="grow">${nm(r?.areas?.[id]?.name)}</span><button class="np-x" aria-label=${L('Убрать', 'Remove')} onClick=${() => { NP.areas = NP.areas.filter((x) => x !== id); rerender(); }}><${Icon} n="x" cls="sm" /></button></div>`)}</div>`}`
          : html`<p class="dk-dev-s">${L('Можно кнопками, а можно просто написать: «Белград, двушка на Врачаре с декабря до 1000 евро»', 'Use the buttons or just write: “Belgrade, a two-bedroom in Vračar from December, up to 1000 euro”')}</p>`}</div>
        ${NP.step < 5 && html`<div class="dk-ask np-ask">${wishBar}</div>`}</aside>
    </div>`;
  }
  return html`<main class=${'screen no-nav or-scr np np-s' + NP.step}>${back}${dots}${body}<div class="or-send or-dock">${dock}</div></main>`;
}
