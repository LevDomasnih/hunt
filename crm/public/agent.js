// "Подключить агента" (design/mockup-v5/agent-sheet.png, png/agent-*): the plugin steps for Claude Code and Codex, the server
// address and a new agent token, the status of the owner's agent; a member sees who connects it. Imported by app.js; the
// names below are used only while rendering (a circular import).
import { html, useState, useEffect } from 'https://unpkg.com/htm@3.1.1/preact/standalone.module.js';
import { D, LANG, api, emit, toast, hap, go, sp, openLink, openSheet, closeSheet, Icon, Av, BigWord, Typed, Sticker, Good, BackRound, copyText, firstName, fmtDM, genRu, isGuest, Nav, homeMode } from './app.js';
import { demoOn } from './demo.js';

const L = (ru, en) => (LANG === 'en' ? en : ru);
const REPO = 'LevDomasnih/hunt'; // the public marketplace of the plugin (README)
const UV = 'https://docs.astral.sh/uv/';
/** A token issued on this page lives here only while the page is open: the server keeps its sha256 and cannot show it again. */
const AG = { tok: null, url: null, tab: null, at: 0 };

const seen = () => D()?.agent_last_seen ?? null;
/** Connected = the agent called the server within a day (the same day as the "agent away" line in the settings). */
export const agentOn = () => { const s = seen(); return !!s && Date.now() - Date.parse(s) < 864e5 && !(AG.at && Date.parse(s) < AG.at); }; // not since a new token
const clientName = (c) => (c === 'codex' ? 'Codex' : c === 'claude-code' ? 'Claude Code' : null);
function ago(iso) {
  if (!iso) return null;
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60e3));
  if (m < 2) return L('был только что', 'here just now');
  if (m < 60) return L(`был ${m} мин назад`, `last seen ${m} min ago`);
  const h = Math.round(m / 60);
  if (h < 24) return L(`был ${h} ч назад`, `last seen ${h} h ago`);
  return L(`был ${fmtDM(iso)}`, `last seen ${fmtDM(iso)}`);
}
/** The row subtitle in Ещё and the settings: "подключён · был 12 мин назад" / "не подключён". */
export const agentSub = () => (agentOn() ? `${L('подключён', 'connected')} · ${ago(seen())}` : L('не подключён', 'not connected'));
const ownerOf = () => (D()?.members ?? []).find((m) => m.role === 'owner') ?? null;
/** "Попросите Льва подключить": the accusative of a male name is its genitive; other names get a safe form without declension. */
function askOwner(name) {
  const n = firstName(name);
  if (!n) return L('Попросите владельца поиска подключить', 'Ask the search owner to connect it');
  if (LANG === 'ru' && /[бвгджзклмнпрстфхцчшщй]$/i.test(n)) return `Попросите ${genRu(n)} подключить`;
  return L(`Попросите владельца поиска (${n}) подключить`, `Ask ${n} to connect it`);
}
const host = (u) => String(u ?? '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
const apiUrl = () => AG.url ?? location.origin;
const oops = (e) => toast(demoOn ? L('В демо это не работает', 'Not in the demo') : e?.code === 'rate_limited' ? L('Слишком часто, попробуйте через час', 'Too often, try again in an hour') : L('Не вышло, попробуйте ещё раз', 'Did not work, try again'));

const CopyBtn = ({ text, label }) => html`<button class="round ag-copy" aria-label=${label} onClick=${() => copyText(text)}><${Icon} n="copy" cls="sm" /></button>`;
const Code = ({ code }) => html`<div class="ag-code"><code>${code}</code><${CopyBtn} text=${code} label=${L('Скопировать', 'Copy') + ': ' + code} /></div>`;
const Step = ({ n, title, sub, code, link }) => html`<li class="ag-step"><span class="ag-num" aria-hidden="true">${n}</span><div class="grow">
  <b>${title}</b>${sub && html`<i>${sub}</i>`}${code && html`<${Code} code=${code} />`}
  ${link && html`<button class="btn sm surface ag-link" onClick=${() => openLink(link)}><${Icon} n="arrow-up-right" cls="sm" />${host(link)}</button>`}</div></li>`;
const STEPS = {
  claude: () => [
    { title: L('Поставьте uv', 'Install uv'), sub: L('Без него плагин не запустит свои инструменты', 'The plugin needs it to start its tools'), link: UV },
    { title: L('Добавьте Hunt в Claude Code', 'Add Hunt to Claude Code'), code: `/plugin marketplace add ${REPO}` },
    { title: L('Установите плагин', 'Install the plugin'), code: '/plugin install hunt@hunt' },
    { title: L('Запустите и вставьте адрес и токен', 'Start it and paste the address and token'), code: '/hunt:new' },
  ],
  codex: () => [
    { title: L('Поставьте uv', 'Install uv'), sub: L('Без него плагин не запустит свои инструменты', 'The plugin needs it to start its tools'), link: UV },
    { title: L('Добавьте Hunt в Codex', 'Add Hunt to Codex'), code: `codex plugin marketplace add ${REPO}` },
    { title: L('Установите плагин', 'Install the plugin'), sub: L('Или в Codex: /plugins → Hunt → Install', 'Or in Codex: /plugins → Hunt → Install'), code: 'codex plugin add hunt@hunt' },
    { title: L('В новой сессии напишите и вставьте адрес и токен', 'In a new session write this and paste the address and token'), code: '$hunt:new' },
  ],
};
/** The status: a dot and the words (never colour alone). */
function Status({ member = false }) {
  const on = agentOn(), c = clientName(D()?.agent_client);
  const sub = on ? [ago(seen()), c].filter(Boolean).join(' · ')
    : member ? L('Голоса и одобрения ждут агента', 'Votes and approvals wait for the agent')
    : AG.tok ? L('Вставьте агенту новый токен, и он появится здесь', 'Give the agent the new token and it shows up here')
    : seen() ? `${ago(seen())}${c ? ' · ' + c : ''}` : L('Четыре шага ниже, и агент появится здесь', 'Four steps below and the agent shows up here');
  return html`<div class=${'ag-status' + (on ? ' on' : '')} role="status"><span class="ag-dot" aria-hidden="true"></span><span class="grow">
    <b>${on ? L('Агент подключён', 'The agent is connected') : L('Не подключён', 'Not connected')}</b><i>${sub}</i></span></div>`;
}
const Note = ({ children }) => html`<p class="ag-note"><${Icon} n="laptop" cls="sm" />${children}</p>`;
function Risk() {
  const [open, setOpen] = useState(false);
  return html`<div class="ag-risk"><button class="ag-risk-h" aria-expanded=${open ? 'true' : 'false'} onClick=${() => { hap.sel(); setOpen(!open); }}>
    <${Icon} n="triangle-alert" cls="sm" /><span class="grow"><b>${L('Мессенджеры могут забанить', 'Messengers may ban you')}</b><i>${L('WhatsApp, Messenger, Instagram. Telegram ограничивает', 'WhatsApp, Messenger, Instagram. Telegram limits')}</i></span><${Icon} n="chevd" cls="sm" /></button>
    ${open && html`<p>${L('WhatsApp, Messenger и Instagram запрещают автоматизировать личные аккаунты и могут их заблокировать. Подключать или нет, решаете вы. Лучше отдельный номер и спокойный темп. Telegram ограничивает за спам',
      'WhatsApp, Messenger and Instagram forbid automating personal accounts and may ban them. Connecting them is your own decision. Use a separate number if you can and keep the pace low. Telegram limits accounts for spam')}</p>`}</div>`;
}
/** The address and the token: the token in full only right after "Выпустить новый", afterwards a placeholder. */
function Conn({ codex }) {
  const [hide, setHide] = useState(false);
  const tok = AG.tok, url = apiUrl(), on = agentOn();
  const both = () => copyText(`${L('Адрес', 'Address')}: ${url}\n${L('Токен', 'Token')}: ${tok}`);
  const renew = () => { hap.sel(); openSheet('agent_token'); };
  return html`<section class="ag-conn" id="ag-conn">
    <h2>${L('Адрес и токен', 'Address and token')}</h2>
    <p class="ag-conn-sub">${codex ? L('$hunt:new спросит их на шаге 4', '$hunt:new asks for them in step 4') : L('/hunt:new спросит их на шаге 4', '/hunt:new asks for them in step 4')}</p>
    <div class="ag-field"><span class="grow"><i>${L('Адрес сервера', 'Server address')}</i><code>${host(url)}</code></span><${CopyBtn} text=${url} label=${L('Скопировать адрес', 'Copy the address')} /></div>
    <div class="ag-field"><span class="grow"><i>${L('Токен · видите только вы', 'Token · only you see it')}</i><code class=${tok && !hide ? 'tok' : ''}>${tok && !hide ? tok : 'hunt_••••••••'}</code></span>
      ${tok && html`<button class="btn sm surface ag-eye" aria-pressed=${hide ? 'false' : 'true'} onClick=${() => setHide(!hide)}><${Icon} n=${hide ? 'eye' : 'eyeoff'} cls="sm" />${hide ? L('Показать', 'Show') : L('Скрыть', 'Hide')}</button>
        <${CopyBtn} text=${tok} label=${L('Скопировать токен', 'Copy the token')} />`}</div>
    ${tok ? html`<p class="ag-warn"><${Icon} n="shield-alert" cls="sm" />${L('Не пересылайте его в чаты: с ним агент действует от вашего имени. После ухода со страницы токен не покажем', 'Do not forward it to chats: with it the agent acts on your behalf. Once you leave this page it is not shown again')}</p>`
      : html`<p class="ag-hint">${L('Сервер хранит только отпечаток токена, старый не показать. Нужен новый: выпустите его здесь', 'The server keeps only a fingerprint of the token, the old one cannot be shown. Need one: issue a new one here')}</p>`}
    ${tok && html`<button class="btn accent big block ag-both" onClick=${both}><${Icon} n="copy" cls="sm" />${L('Скопировать адрес и токен', 'Copy the address and token')}</button>`}
    ${!tok && !on ? html`<button class="btn accent big block ag-both" onClick=${renew}><${Icon} n="refresh-cw" cls="sm" />${L('Выпустить новый токен', 'Issue a new token')}</button><p class="ag-renew-note">${L('Старый перестанет работать', 'The old one stops working')}</p>`
      : html`<div class="ag-renew"><button class="btn sm surface" onClick=${renew}><${Icon} n="refresh-cw" cls="sm" />${L('Выпустить новый', 'Issue a new one')}</button><span>${L('старый перестанет работать', 'the old one stops working')}</span></div>`}
  </section>`;
}
const Hero = ({ children }) => html`<section class="w8-hero ax-hero ag-hero" style="height:208px"><${BigWord} text=${L('Агент', 'Agent')} cls="or-word ax-word" />${children}</section>`;
const Toy = ({ n, s, x, y, r }) => html`<span class="ax-toy" style=${`left:${x};top:${y}px`}><${Good} slug=${n} size=${s} rot=${r} big /></span>`;
const Shell = ({ children }) => html`<main class="screen w2 ax ag">${children}<${Nav} tab="more" /></main>`;

function OwnerPage() {
  const d = D();
  const [tab, setTab] = useState(() => AG.tab ?? (d.agent_client === 'codex' ? 'codex' : 'claude'));
  useEffect(() => () => { AG.tok = null; AG.url = null; }, []); // the token is forgotten when the page closes
  const on = agentOn(), codex = tab === 'codex';
  const pick = (k) => { if (k === tab) return; hap.sel(); AG.tab = k; setTab(k); };
  return html`<${Shell}><${BackRound} />
    <${Hero}><${Toy} n="key" s=${172} x="70%" y=${8} r=${-14} /><${Sticker} text=${L('свой агент', 'your own agent')} cls="ax-sticker ag-sticker" style="left:44px;top:58px;--r:-12deg" /><//>
    <${Typed} lines=${[on ? L('Hunt на связи', 'Hunt is here') : L('Подключим агента?', 'Connect your agent?')]} as="h1" />
    <p class="w8-sub">${L('Hunt думает и пишет через вашего агента в Claude Code или Codex', 'Hunt thinks and writes through your agent in Claude Code or Codex')}</p>
    <div class="ag-state"><${Status} /><${Note}>${L('Агент работает на вашей подписке, логины мессенджеров остаются на вашем компьютере', 'The agent runs on your subscription, messenger logins stay on your computer')}<//></div>
    <div class="seg full ag-seg" role="group" aria-label=${L('Где ваш агент', 'Where your agent runs')}>
      <button aria-pressed=${!codex ? 'true' : 'false'} onClick=${() => pick('claude')}>Claude Code</button>
      <button aria-pressed=${codex ? 'true' : 'false'} onClick=${() => pick('codex')}>Codex</button>
    </div>
    <ol class="ag-steps">${STEPS[codex ? 'codex' : 'claude']().map((s, i) => html`<${Step} key=${tab + i} n=${i + 1} ...${s} />`)}</ol>
    <${Conn} codex=${codex} />
    <${Risk} />
  <//>`;
}
function MemberPage() {
  const o = ownerOf();
  const n = firstName(o?.name) || L('владелец', 'the owner');
  return html`<${Shell}><${BackRound} />
    <${Hero}><${Toy} n="lock" s=${168} x="72%" y=${10} r=${10} /><//>
    <${Typed} lines=${[L(`Агента подключает ${n}`, `${n} connects the agent`)]} as="h1" />
    <p class="w8-sub">${L('Hunt думает и пишет через агента владельца поиска. Вам ничего ставить не нужно', 'Hunt thinks and writes through the search owner’s agent. You need to install nothing')}</p>
    <div class="ag-state"><${Status} member /></div>
    <div class="ag-ask">${o && html`<${Av} m=${o} size=${52} />`}<span class="grow"><b>${askOwner(o?.name)}</b><i>${L('Токен и шаги подключения видит только владелец', 'Only the owner sees the token and the steps')}</i></span></div>
    <${Note}>${L('Агент работает на подписке владельца, логины мессенджеров остаются на его компьютере', 'The agent runs on the owner’s subscription, messenger logins stay on their computer')}<//>
  <//>`;
}
export function AgentScreen() {
  const d = D();
  if (!d?.search || isGuest()) return html`<${Shell}><${BackRound} /><p class="ag-hint">${L('Это для участников поиска', 'This is for the members of the search')}</p><//>`;
  return d.me?.role === 'owner' ? html`<${OwnerPage} />` : html`<${MemberPage} />`;
}

/** "Выпустить новый токен?": the old one dies at once; says what is connected now. */
export function AgentTokenSheet() {
  const [busy, setBusy] = useState(false);
  const on = agentOn(), c = clientName(D()?.agent_client);
  const issue = async () => {
    setBusy(true);
    try {
      const r = await api('/app/api/agent-token', { search_id: D().search.id });
      AG.tok = r.token; AG.at = Date.now(); AG.url = /^https?:\/\//.test(r.api_url ?? '') ? r.api_url : null;
      closeSheet();
      hap.ok();
      toast(L('Новый токен готов, старый больше не работает', 'A new token is ready, the old one no longer works'));
      emit();
      setTimeout(() => document.getElementById('ag-conn')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
    } catch (e) { oops(e); }
    setBusy(false);
  };
  return html`<h2>${L('Выпустить новый токен?', 'Issue a new token?')}</h2>
    <p class="ag-sh-p">${L('Старый перестанет работать сразу. Агент отключится, пока вы не вставите ему новый', 'The old one stops working at once. The agent disconnects until you give it the new one')}</p>
    <p class=${'ag-sh-now' + (on ? ' on' : '')}><span class="ag-dot" aria-hidden="true"></span>${on ? L(`Сейчас подключён ${c ?? 'агент'}, ${ago(seen())}`, `Connected now: ${c ?? 'the agent'}, ${ago(seen())}`) : L('Сейчас агент не подключён', 'No agent is connected now')}</p>
    <div class="ag-sh-col"><button class="btn accent big block" disabled=${busy} onClick=${issue}><${Icon} n="refresh-cw" cls="sm" />${L('Выпустить новый', 'Issue a new one')}</button>
      <button class="btn surface big block" onClick=${closeSheet}>${L('Оставить', 'Keep it')}</button></div>`;
}
/** The way in from the settings sheet while searching (in home mode it is a row in Ещё). */
export const agentSettingsRow = () => (D()?.search && !isGuest() && !homeMode()
  ? html`<button class="btn surface block" style="margin-bottom:10px" onClick=${() => { closeSheet(); go(sp('agent')); }}><${Icon} n="plug" />${L('Подключить агента', 'Connect the agent')}</button>` : null);
