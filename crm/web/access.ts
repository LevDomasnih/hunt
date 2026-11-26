// Access to conversations (design/mockup-v6): connecting Telegram and WhatsApp, the first message and the answer, what Hunt sees,
// taking it all back, the money limit. Imported by app.js; the names below are used only while rendering (a circular import).
import { html } from 'htm/preact';
import { useState, useEffect } from 'preact/hooks';
import { S, D, LANG, api, emit, toast, hap, go, sp, back, refresh, openLink, inTG, Icon, Av, BigWord, Typed, Sticker, Good, BackRound, copyText, photosOf, listingById, memberById,
  shortLabel, priceText, channelName, channelsOf, channelLink, firstName, contactName, fmtTime, fmtDM, dayKey, skel, msgCard, FloatPhoto, closeSheet, t, pl, authHeaders } from './app.js';
import { demoOn } from './demo.js';

const pn = (n, forms) => pl(n, ...forms);
const L = (ru, en) => (LANG === 'en' ? en : ru);
const AC = { v: null, err: false, at: 0 };
export const acc = () => AC.v;
export async function loadAccess() {
  AC.at = Date.now();
  try { AC.v = await api('/app/api/access'); AC.err = false; } catch { AC.err = true; }
  emit();
}
function useAccess(poll = false) {
  useEffect(() => {
    if (!AC.v || Date.now() - AC.at > 20e3) loadAccess();
    if (!poll) return undefined;
    const f = () => !document.hidden && loadAccess();
    const tm = setInterval(f, 5000);
    addEventListener('visibilitychange', f);
    return () => { clearInterval(tm); removeEventListener('visibilitychange', f); };
  }, [poll]);
  return AC;
}
const post = async (what, b) => { const r = await api('/app/api/access/' + what, b); await loadAccess(); return r; };
const oops = (e) => toast(demoOn ? L('В демо это не работает', 'Not in the demo') : e?.code === 'rate_limited' ? L('Слишком часто, подожди', 'Too often, wait a bit') : t('err_generic'));
const me = () => memberById(D()?.user?.id);
export const canAccess = () => D()?.me?.role === 'owner';
const open = (a?) => go(sp('access', a));

/** A toy on the screen colour, placed in the hero by its centre (percent / px). */
const Toy = ({ n, s, x, y, r = 0, flat = false }) => html`<span class="ax-toy" style=${`left:${x};top:${y}px`}><${Good} slug=${n} size=${s} rot=${r} big shadow=${!flat} /></span>`;
const Ani = ({ x, y, s = 62 }) => (me() ? html`<span class="ax-toy" style=${`left:${x};top:${y}px`}><${Av} m=${me()} size=${s} free /></span>` : null);
const Hero = ({ word, h = 200, small = false, children }) => html`<section class=${'w8-hero ax-hero' + (small ? ' sm' : '')} style=${`height:${h}px`}><${BigWord} text=${word} cls="or-word ax-word" />${children}</section>`;
const Row = ({ ic, title, sub, right, onClick, cls = '' }) => {
  const inner = html`${ic && html`<${Icon} n=${ic} />`}<span class="grow"><b>${title}</b>${sub && html`<i>${sub}</i>`}</span>${right}`;
  return onClick ? html`<button class=${'ax-row ' + cls} onClick=${onClick}>${inner}</button>` : html`<div class=${'ax-row ' + cls}>${inner}</div>`;
};
const St = ({ k, children }) => html`<span class=${'ax-st ' + k}><${Icon} n=${{ done: 'check', wait: 'hourglass', fail: 'triangle-alert', lock: 'lock', off: 'minus' }[k]} cls="sm" />${children}</span>`;
const Go = () => html`<${Icon} n="arrow-up-right" cls="sm" />`;
const Radio = ({ on, title, tag, sub, off = false, onClick }) => html`<button class=${'ax-radio' + (off ? ' off' : '')} role="radio" aria-checked=${on ? 'true' : 'false'} disabled=${off} onClick=${onClick}>
  <span class="ax-dot">${on && html`<${Icon} n="check" cls="sm" />`}</span><span class="grow"><b>${title}${tag && html`<em>${tag}</em>`}</b><i>${sub}</i></span></button>`;
const Rule = ({ title, children }) => html`<div class="ax-rule"><b>${title}</b><p>${children}</p></div>`;
const Dock = ({ children }) => html`<div class="or-send or-dock">${children}</div>`;
const Scr = ({ children, cls = '' }) => html`<main class=${'screen no-nav or-scr ax ' + cls}>${children}</main>`;
const Wait = () => html`<${Scr}><${BackRound} />${AC.err ? msgCard(t('err_generic')) : skel(360)}<//>`;
/** Telegram's own settings; the words next to it say where to tap if the app does not jump there. */
const TG_SETTINGS = 'tg://settings/edit';
const openTg = () => { hap.sel(); openLink(TG_SETTINGS); };
const TG_PATH = () => L('Настройки Telegram → Автоматизация чатов', 'Telegram settings → Chat automation');
const RIGHTS = {
  can_delete_sent_messages: ['Удалять отправленное', 'Delete sent messages'], can_delete_all_messages: ['Удалять твои сообщения', 'Delete your messages'], can_edit_name: ['Менять имя', 'Change your name'],
  can_edit_bio: ['Менять описание', 'Change your bio'], can_edit_profile_photo: ['Менять фото', 'Change your photo'], can_edit_username: ['Менять @имя', 'Change your @name'],
  can_change_gift_settings: ['Настройки подарков', 'Gift settings'], can_view_gifts_and_stars: ['Видеть подарки и звёзды', 'See gifts and stars'], can_convert_gifts_to_stars: ['Менять подарки на звёзды', 'Turn gifts into stars'],
  can_transfer_and_upgrade_gifts: ['Передавать подарки', 'Transfer gifts'], can_transfer_stars: ['Тратить звёзды', 'Spend stars'], can_manage_stories: ['Публиковать истории', 'Post stories'],
};
const rightName = (k) => { const r = RIGHTS[k]; return r ? L(r[0], r[1]) : k; };

// ---------------------------------------------------------------- 01 connect
function Connect({ a }) {
  const tg = a.tg.status, wa = a.wa.status;
  return html`<${Scr}><${BackRound} />
    <${Hero} word=${L('Чаты', 'Chats')} h=${236}><${Toy} n="chat-green" s=${132} x="70%" y=${66} r=${9} /><${Toy} n="chat-sky" s=${156} x="34%" y=${66} r=${-7} /><${Ani} x="86%" y=${164} s=${70} />
      ${tg === 'off' && wa === 'off' && html`<${Sticker} text=${L('без паролей', 'login-free')} cls="ax-sticker" style="right:-4px;top:-6px" />`}<//>
    <${Typed} lines=${[L('Откуда пишем?', 'Where do we write from?')]} as="h1" />
    <p class="w8-sub">${L('Хозяевам пишешь ты, со своих аккаунтов. Hunt готовит текст и ждёт твоё «да»', 'You write to the owners from your own accounts. Hunt prepares the text and waits for your yes')}</p>
    <div class="ax-list">
      <${Row} title="Telegram" sub=${{ off: L('Hunt видит только чаты, которые ты открыл', 'Hunt sees only the chats you open'), on: L('Открыты только те чаты, что ты выбрал', 'Only the chats you picked are open'), rights: L('Прав больше, чем нужно', 'More rights than needed'), revoking: L('Отзываем, осталось отключить бота', 'Taking it back: remove the bot') }[tg]}
        right=${tg === 'off' ? html`<button class="btn sm surface" onClick=${() => open('tg')}>${L('Подключить', 'Connect')}</button>` : tg === 'on' ? html`<${St} k="done">${L('подключён', 'connected')}<//>` : html`<${St} k="wait">${L('ждём тебя', 'your turn')}<//>`}
        onClick=${tg === 'off' ? null : () => open(tg === 'revoking' ? 'receipt' : 'tg-ok')} />
      <${Row} title="WhatsApp" sub=${L('Текст готовит Hunt, отправляешь ты', 'Hunt writes, you send')} right=${wa === 'off' ? html`<button class="btn sm surface" onClick=${() => open('wa')}>${L('Включить', 'Turn on')}</button>` : html`<${St} k="done">${L('кнопкой', 'a button')}<//>`} onClick=${wa === 'off' ? null : () => open('wa')} />
      <${Row} ic="shield-check" title=${L('Что видит Hunt', 'What Hunt sees')} right=${html`<${Go} />`} onClick=${() => open('sees')} />
      ${a.ai && html`<${Row} ic="wallet" title=${L('Деньги на ИИ', 'Money for AI')} right=${html`<${Go} />`} onClick=${() => open('limit')} />`}
    </div>
    ${tg === 'off' && html`<${Dock}><button class="btn accent big grow" onClick=${() => open('tg')}>${L('Подключить Telegram', 'Connect Telegram')}</button><button class="btn surface big" onClick=${back}>${L('Позже', 'Later')}</button><//>`}
  <//>`;
}
// ---------------------------------------------------------------- 02 which chats
function TgPick({ a }) {
  const [m, setM] = useState(a.tg.mode ?? 'new');
  useEffect(() => { if (['on', 'rights'].includes(a.tg.status)) go(sp('access', 'tg-ok'), true); }, [a.tg.status]);
  const start = () => { api('/app/api/access/set', { tg_mode: m }).catch(() => null); openTg(); };
  return html`<${Scr}><${BackRound} />
    <${Hero} word=${L('Кого', 'Who')} h=${158}><${Toy} n="lock" s=${128} x="78%" y=${12} r=${8} /><${Ani} x="55%" y=${100} s=${58} /><//>
    <${Typed} lines=${[L('Какие чаты открыть?', 'Which chats to open?')]} as="h1" />
    <div class="ax-list" role="radiogroup" aria-label=${L('Какие чаты открыть', 'Which chats to open')}>
      <${Radio} on=${m === 'new'} onClick=${() => { hap.sel(); setM('new'); }} title=${L('Только новые люди', 'New people only')} tag=${L('советуем', 'our pick')} sub=${L('«Все, кроме»: закрой существующие чаты и контакты', '“All except”: close existing chats and contacts')} />
      <${Radio} on=${m === 'only'} onClick=${() => { hap.sel(); setM('only'); }} title=${L('Только хозяева', 'Owners only')} sub=${L('«Только выбранные»: добавляешь каждого сам. Чужих Hunt не увидит вообще', '“Only selected”: you add each one. Hunt sees nobody else at all')} />
    </div>
    <${Rule} title=${L('Это проверяет Telegram, а не Hunt', 'Telegram enforces it, not Hunt')}>${m === 'new' ? L('Группы и старая переписка закрыты всегда. Новый курьер не из контактов может дойти, Hunt его выбросит не глядя', 'Groups and old messages are always closed. A new courier outside your contacts may reach us, Hunt throws it away unread') : L('Группы и старая переписка закрыты всегда', 'Groups and old messages are always closed')}<//>
    <p class="ax-path">${TG_PATH()} → ${L('добавить бота, право «Отвечать»', 'add the bot, the right to reply')}</p>
    <div><button class="btn sm surface" onClick=${() => copyText('@' + a.bot)}><${Icon} n="copy" cls="sm" />@${a.bot}</button></div>
    <${Dock}><button class="btn accent big grow" onClick=${start}><${Icon} n="arrow-up-right" cls="sm" />${L('Открыть настройки', 'Open settings')}</button><//>
  <//>`;
}
// ---------------------------------------------------------------- 03 connected / too many rights
function TgOk({ a }) {
  if (a.tg.status === 'off') return html`<${TgPick} a=${a} />`;
  if (a.tg.status === 'rights') return html`<${Scr}><${BackRound} />
    <${Hero} word=${L('Много', 'Too much')} h=${226}><${Toy} n="key" s=${176} x="50%" y=${52} r=${-12} /><${Sticker} text=${L('лишнее', 'too much')} cls="ax-sticker" style="right:0;top:0" /><//>
    <${Typed} lines=${[L('Это нам не нужно', 'We do not need this')]} as="h1" />
    <p class="w8-sub">${L('Ты дал Hunt больше прав, чем надо. Пока они включены, читать и писать не начнём', 'You gave Hunt more rights than needed. While they are on, it neither reads nor writes')}</p>
    <div class="ax-list">${a.tg.extra.map((k) => html`<${Row} key=${k} ic="x" title=${rightName(k)} right=${html`<${St} k="wait">${L('убери', 'remove')}<//>`} />`)}<${Row} ic="check" title=${L('Отвечать на сообщения', 'Reply to messages')} right=${html`<${St} k="done">${L('нужно', 'needed')}<//>`} /></div>
    <p class="ax-path">${TG_PATH()}</p>
    <${Dock}><button class="btn accent big grow" onClick=${openTg}>${L('Открыть настройки', 'Open settings')}</button><button class="btn surface big" onClick=${loadAccess}>${L('Проверить', 'Check')}</button><//>
  <//>`;
  const n = a.contacts.filter((c) => c.channel === 'telegram').length;
  return html`<${Scr}><${BackRound} />
    <${Hero} word=${L('Закрыто', 'Closed')} h=${238} small><${Toy} n="lock" s=${176} x="46%" y=${40} r=${-4} /><${Ani} x="80%" y=${158} s=${74} /><${Sticker} text=${n ? pn(n, LANG === 'ru' ? ['открыт {n} чат', 'открыто {n} чата', 'открыто {n} чатов'] : ['{n} chat open', '{n} chats open']).replace('{n}', n) : L('открыто 0 чатов', '0 chats open')} cls="ax-sticker" style="right:0;top:-4px" /><//>
    <${Typed} lines=${[L('Личное закрыто', 'Private stays private')]} as="h1" />
    <p class="w8-sub">${L('Hunt увидит хозяина, когда он ответит на твоё первое сообщение', 'Hunt sees an owner once they answer your first message')}</p>
    <div class="ax-list">
      <${Row} ic="check" title=${L('Отвечать хозяевам', 'Reply to owners')} sub=${L('24 часа после их сообщения, с твоим «да»', '24 hours after their message, with your yes')} />
      <${Row} ic="archive" title=${L('Старая переписка и группы', 'Old messages and groups')} right=${html`<${St} k="lock">${L('закрыто', 'closed')}<//>`} />
      <${Row} ic="users" title=${L('Остальные чаты', 'Other chats')} sub=${a.tg.mode === 'only' ? L('Только те, кого ты добавил', 'Only those you added') : L('Как ты выбрал в Telegram', 'As you picked in Telegram')} right=${html`<${St} k="lock">${L('Telegram', 'Telegram')}<//>`} />
      <${Row} ic="user-pen" title=${L('Имя, фото и звёзды', 'Name, photo and stars')} right=${html`<${St} k="lock">${L('закрыто', 'closed')}<//>`} />
    </div>
    <${Dock}><button class="btn accent big grow" onClick=${() => go(sp('access'), true)}>${L('Готово', 'Done')}</button><button class="btn surface big" onClick=${openTg}>${L('Изменить', 'Change')}</button><//>
  <//>`;
}
// ---------------------------------------------------------------- 04 WhatsApp
function Wa({ a }) {
  const [busy, setBusy] = useState(false);
  const on = a.wa.status === 'button';
  const set = async (v) => { setBusy(true); try { await post('set', { wa: v }); hap.ok(); back(); } catch (e) { oops(e); } setBusy(false); };
  return html`<${Scr}><${BackRound} />
    <${Hero} word=${L('Как', 'How')} h=${186}><${Toy} n="phone" s=${150} x="80%" y=${18} r=${8} /><${Toy} n="chat-green" s=${78} x="56%" y=${96} r=${-10} /><//>
    <${Typed} lines=${[L('Как с WhatsApp?', 'What about WhatsApp?')]} as="h1" />
    <div class="ax-list" role="radiogroup" aria-label="WhatsApp">
      <${Radio} on=${true} title=${L('Одной кнопкой', 'One button')} tag=${L('сейчас', 'now')} sub=${L('Hunt пишет текст и открывает твой WhatsApp. Отправляешь сам, ответ пересылаешь боту', 'Hunt writes and opens your WhatsApp. You send, and forward the answer to the bot')} />
      <${Radio} off title=${L('Отдельный номер', 'A number of its own')} tag=${L('скоро', 'soon')} sub=${L('Местная SIM только для поиска. Личных чатов на ней нет. Новый номер могут заблокировать', 'A local SIM for the search only. No private chats on it. A new number may get blocked')} />
    </div>
    <${Rule} title=${L('Личный WhatsApp не подключаем', 'We do not connect your own WhatsApp')}>${L('WhatsApp не умеет открыть только часть чатов, а все нам не нужны', 'WhatsApp cannot open only some chats, and we do not need them all')}<//>
    <${Dock}>${on ? html`<button class="btn accent big grow" onClick=${back}>${L('Готово', 'Done')}</button><button class="btn surface big" disabled=${busy} onClick=${() => set('off')}>${L('Выключить', 'Turn off')}</button>`
      : html`<button class="btn accent big grow" disabled=${busy} onClick=${() => set('button')}>${L('Включить кнопку', 'Turn it on')}</button><button class="btn surface big" onClick=${back}>${L('Позже', 'Later')}</button>`}<//>
  <//>`;
}
// ---------------------------------------------------------------- 07 what Hunt sees
async function download() {
  try {
    const r = await fetch('/app/api/access/export', { headers: authHeaders() });
    if (!r.ok) throw new Error('x');
    const u = URL.createObjectURL(await r.blob());
    const el = Object.assign(document.createElement('a'), { href: u, download: 'hunt-chats.json' });
    el.click();
    setTimeout(() => URL.revokeObjectURL(u), 5000);
    if (inTG) toast(L('Если файл не скачался, открой Hunt в браузере: /web', 'If nothing downloads, open Hunt in a browser: /web'));
  } catch (e) { oops(e); }
}
const viaName = (x) => (x.via === 'agent' ? L('агент', 'agent') : null);
function Sees({ a }) {
  const list = [...a.contacts.reduce((m, c) => m.set(c.id, m.has(c.id) ? { ...m.get(c.id), n: m.get(c.id).n + c.n } : c), new Map<any, any>()).values()];
  const n = list.filter((c) => !c.muted).length;
  const mute = async (c) => { hap.sel(); try { await post('mute', { contact_id: c.id, on: !c.muted }); } catch (e) { oops(e); } };
  const who = a.log.map((x) => [x.name && x.actor !== D().user.id ? firstName(x.name) : L('ты', 'you'), viaName(x)].filter(Boolean).join(', ')).filter((v, i, r) => r.indexOf(v) === i);
  const msgs = (k) => pn(k, LANG === 'ru' ? ['{n} сообщение', '{n} сообщения', '{n} сообщений'] : ['{n} message', '{n} messages']).replace('{n}', k);
  const gone = a.purges[0];
  return html`<${Scr}><${BackRound} />
    <${Hero} word=${L('Вижу', 'I see')} h=${128} small><${Toy} n="eye" s=${128} x="80%" y=${-62} r=${-6} /><${Ani} x="78%" y=${112} s=${74} /><//>
    <h1 class="ax-num"><b>${n}</b> ${pn(n, LANG === 'ru' ? ['чат', 'чата', 'чатов'] : ['chat', 'chats'])}</h1>
    <p class="ax-sub2">${n ? L('с хозяевами, больше ничего', 'with owners, nothing else') : L('Пока никто из хозяев не писал', 'No owner has written yet')}</p>
    <div class="ax-list">
      ${list.slice(0, 12).map((c) => html`<${Row} key=${c.id} cls=${c.muted ? 'off' : ''} title=${c.name ?? L('Без имени', 'No name')} sub=${[channelName(c.channel), c.muted ? L('не читаем', 'not read') : msgs(c.n)].join(', ')}
        right=${html`<button class="btn sm surface thin" aria-label=${(c.muted ? L('Читать снова', 'Read again') : L('Не читать', 'Do not read')) + ': ' + (c.name ?? '')} onClick=${() => mute(c)}>${c.muted ? L('Читать', 'Read') : L('Не читать', 'Do not read')}</button>`} />`)}
      ${list.length > 12 && html`<${Row} title=${L(`И ещё ${list.length - 12}`, `And ${list.length - 12} more`)} />`}
      ${a.dropped > 0 && html`<${Row} ic="trash-2" title=${L(`Выброшено чужое: ${a.dropped}`, `Thrown away: ${a.dropped}`)} sub=${a.dropped > 20 && a.tg.mode !== 'only' ? L('Многовато: проверь, какие чаты открыты', 'A lot: check which chats are open') : L('Не записали и никому не показали', 'Not recorded, not shown to anyone')} />`}
      <${Row} ic="user-check" title=${L('Кто открывал переписку', 'Who opened conversations')} sub=${who.length ? L('За месяц: ', 'This month: ') + who.join('; ') : L('За месяц никто', 'Nobody this month')} />
      ${a.connected && html`<${Row} ic="calendar-clock" title=${gone ? L(`Удалим сами ${fmtDM(gone.at)}`, `We delete on ${fmtDM(gone.at)}`) : L('Удалим сами', 'We delete it ourselves')} sub=${L(`Через ${a.retain_days} дней после конца поиска`, `${a.retain_days} days after the search ends`)} />`}
      <${Row} ic="lock" title=${a.sealed ? L('Переписка зашифрована', 'Conversations are encrypted') : L('Переписка не зашифрована', 'Conversations are not encrypted')} sub=${a.sealed ? L('У тебя свой ключ. Владелец сервера технически всё же может прочитать', 'With a key of your own. Whoever runs the server can still read it, technically') : L('Владелец сервера может открыть базу', 'Whoever runs the server can open the database')} />
      ${a.receipts[0] && html`<${Row} ic="receipt-text" title=${L('Чек отзыва', 'Receipt')} sub=${fmtDM(a.receipts[0].at) + ', ' + fmtTime(a.receipts[0].at)} right=${html`<${Go} />`} onClick=${() => open('receipt')} />`}
    </div>
    <${Dock}><button class="btn accent big grow" onClick=${() => open('off')}>${L('Отозвать всё', 'Take it all back')}</button><button class="btn surface big" onClick=${download}>${L('Скачать', 'Download')}</button><//>
  <//>`;
}
// ---------------------------------------------------------------- 08 take it back
function Off({ a }) {
  const [busy, setBusy] = useState(false);
  const run = async (data) => { setBusy(true); try { await post('revoke', { data }); hap.ok(); go(sp('access', 'receipt'), true); refresh(); } catch (e) { oops(e); setBusy(false); } };
  return html`<${Scr}><${BackRound} />
    <${Hero} word=${L('Всё', 'All')} h=${196}><${Toy} n="broom" s=${176} x="72%" y=${4} r=${6} /><//>
    <${Typed} lines=${[L('Отзываем всё?', 'Take it all back?')]} as="h1" />
    <div class="ax-list">
      <${Row} ic="eyeoff" title=${L('Перестанем читать и писать', 'We stop reading and writing')} sub=${L('Сразу, в Telegram и WhatsApp', 'At once, in Telegram and WhatsApp')} />
      <${Row} ic="trash-2" title=${L('Удалим переписку', 'We delete conversations')} sub=${a.sealed ? L('Копии тоже станут нечитаемыми', 'Copies become unreadable too') : L('Копии базы живут ещё до 30 дней', 'Database copies live up to 30 days more')} />
      <${Row} ic="log-out" title=${L('Выйдем на других устройствах', 'Other devices are signed out')} sub=${L('Сайт, ссылки и агент на компьютере', 'The site, links and the agent on a computer')} />
      <${Row} ic="ban" title=${L('Что не вернуть', 'What cannot be undone')} sub=${L('Письма хозяевам, карточки в боте и то, что уже прочитал ИИ', 'Messages to owners, cards in the bot and what AI has read')} />
    </div>
    <p class="ax-path">${L('Дом, деньги, афиша и планы останутся', 'The home, money, events and plans stay')}</p>
    <div><button class="btn sm surface thin" disabled=${busy} onClick=${() => run(false)}>${L('Только отключить, данные оставить', 'Only disconnect, keep the data')}</button></div>
    <${Dock}><button class="btn accent big grow" disabled=${busy} onClick=${() => run(true)}>${L('Отозвать и удалить', 'Take back and delete')}</button><button class="btn surface big" onClick=${back}>${L('Назад', 'Back')}</button><//>
  <//>`;
}
// ---------------------------------------------------------------- 09 the receipt, 10 done
const rcTitle = (r, wait) => (wait ? L('Осталось одно нажатие', 'One tap left') : r.data === 'kept' ? L('Hunt отключён', 'Hunt is disconnected') : L('Hunt ничего не видит', 'Hunt sees nothing'));
const rcSub = (r, wait) => (wait ? L('Мы уже не читаем. Отключить бота в Telegram можешь только ты', 'We no longer read. Only you can remove the bot in Telegram') : r.data === 'kept' ? L('Данные остались, новых сообщений не будет', 'The data stays, nothing new comes in') : L('Переписки больше нет. Вернуться можно в любой момент, с нуля', 'Conversations are gone. You can come back any time, from zero'));
/** The paper of the receipt: one line per thing with its state in words. slot = it comes out of the black slot (phone). */
function RcptPaper({ a, r, wait, slot = false }) {
  const ln = (title, sub, k, label) => html`<div class="ax-rl"><span class="grow"><b>${title}</b>${sub && html`<i>${sub}</i>`}</span><${St} k=${k}>${label}<//></div>`;
  const n = (k, ru, en) => pn(k, LANG === 'ru' ? ru : en).replace('{n}', k);
  const done = L('готово', 'done');
  return html`<div class=${'rcpt print ax-paper' + (slot ? ' with-slot' : '')}>${slot && html`<div class="rcpt-slot" aria-hidden="true"><i></i></div>`}<div class="rcpt-clip"><div class="rcpt-paper"><span class="rcpt-bg" aria-hidden="true"><i></i></span><div class="rcpt-in">
      <p class="ax-rd">${L('Отзыв доступов', 'Access taken back')}, ${fmtDM(r.at)}, ${fmtTime(r.at)}</p>
      ${ln('WhatsApp', r.wa === 'off' ? L('не был включён', 'was off') : L('кнопка выключена', 'the button is off'), r.wa === 'off' ? 'off' : 'done', r.wa === 'off' ? L('не было', 'was off') : done)}
      ${ln('Telegram', wait ? L('не читаем, ждём отключения', 'not reading, waiting') : r.tg === 'off' ? L('не был подключён', 'was not connected') : L('бот отключён', 'the bot is removed'), wait ? 'wait' : r.tg === 'off' ? 'off' : 'done', wait ? L('ждём тебя', 'your turn') : r.tg === 'off' ? L('не было', 'was off') : done)}
      ${r.data === 'kept' ? ln(L('Переписка', 'Conversations'), L('оставили, как ты просил', 'kept, as you asked'), 'off', L('на месте', 'kept')) : ln(L('Переписка', 'Conversations'), n(r.messages ?? 0, ['{n} сообщение', '{n} сообщения', '{n} сообщений'], ['{n} message', '{n} messages']), 'done', L('удалена', 'deleted'))}
      ${r.copies === 'erased' && ln(L('Копии переписки', 'Copies'), L('ключ стёрт', 'the key is erased'), 'done', L('нечитаемы', 'unreadable'))}
      ${r.copies === 'plain' && ln(L('Копии базы', 'Database copies'), L('сотрутся сами, до 30 дней', 'expire by themselves, up to 30 days'), 'wait', L('ждём', 'waiting'))}
      ${ln(L('Сайт и ссылки', 'The site and links'), n(r.sessions ?? 0, ['{n} другое устройство', '{n} других устройства', '{n} других устройств'], ['{n} other device', '{n} other devices']), 'done', L('вышли', 'signed out'))}
      ${r.agents > 0 && ln(L('Агент', 'Agent'), n(r.agents, ['{n} ключ', '{n} ключа', '{n} ключей'], ['{n} key', '{n} keys']), 'done', L('отключён', 'off'))}
    </div></div></div><span class="ax-corner" aria-hidden="true"><${Good} slug=${wait ? 'broom' : 'lock'} size=${96} rot=${10} shadow=${false} /></span></div>`;
}
function Receipt({ a }) {
  const r = a.receipts[0];
  if (!r) return html`<${Sees} a=${a} />`;
  const wait = r.tg === 'wait' && a.tg.status === 'revoking';
  const again = async () => { try { await post('set', { again: true }); go(sp('access'), true); } catch (e) { oops(e); } };
  return html`<${Scr} cls="ax-rc"><${BackRound} />
    <${Typed} lines=${[rcTitle(r, wait)]} as="h1" />
    <p class="w8-sub">${rcSub(r, wait)}</p>
    <${RcptPaper} a=${a} r=${r} wait=${wait} slot />
    ${wait && html`<p class="ax-path">${TG_PATH()} → @${a.bot} → ${L('убрать', 'remove')}</p>`}
    <${Dock}>${wait ? html`<button class="btn accent big grow" onClick=${openTg}><${Icon} n="arrow-up-right" cls="sm" />${L('Отключить в Telegram', 'Remove in Telegram')}</button><button class="btn surface big" onClick=${loadAccess}>${L('Проверить', 'Check')}</button>`
      : html`<button class="btn accent big grow" onClick=${() => go(sp('today'), true)}>${L('Закрыть', 'Close')}</button><button class="btn surface big" onClick=${again}>${L('Вернуться', 'Come back')}</button>`}<//>
  <//>`;
}
// ---------------------------------------------------------------- 11 the money limit (only with the server's assistant)
const AI_KINDS = { chat: ['message-circle', 'Переписка', 'Conversations'], listing: ['house', 'Варианты', 'Homes'], lease: ['file-text', 'Договор', 'Lease'], other: ['sparkles', 'Остальное', 'The rest'] };
const usd = (v) => '$' + (LANG === 'en' ? v.toFixed(2) : v.toFixed(2).replace('.', ','));
function Limit({ a }) {
  const ai = a.ai;
  const [cap, setCap] = useState(ai?.cap ?? 15);
  if (!ai) return html`<${Sees} a=${a} />`;
  const spent = ai.by.reduce((s, x) => s + Number(x.usd || 0), 0);
  const save = async () => { try { await post('set', { cap }); hap.ok(); back(); } catch (e) { oops(e); } };
  return html`<${Scr}><${BackRound} />
    <${Hero} word=${L('Лимит', 'Limit')} h=${112} small><${Toy} n="coin" s=${118} x="84%" y=${6} r=${10} /><//>
    <p class="ax-sub2" style="margin:0">${L('ИИ в твоих поисках', 'AI in your searches')}</p>
    <h1 class="ax-num"><b>${usd(spent)}</b> <span>${L('из', 'of')} $${ai.cap}</span></h1>
    <i class="or-free-bar ax-bar" role="progressbar" aria-valuemin="0" aria-valuemax=${ai.cap} aria-valuenow=${Math.min(spent, ai.cap)} aria-label=${L('Потрачено', 'Spent')}><b style=${`width:${Math.min(100, (spent / ai.cap) * 100)}%`}></b></i>
    <div class="ax-list">${ai.by.map((x) => { const k = AI_KINDS[x.kind] ?? AI_KINDS.other; return html`<${Row} key=${x.kind} ic=${k[0]} title=${L(k[1], k[2])} right=${html`<b class="ax-v">${usd(Number(x.usd))}</b>`} />`; })}</div>
    <p class="ax-h">${L('Больше не тратить', 'Spend no more than')}</p>
    <div class="ax-step"><button class="round" aria-label=${L('Меньше', 'Less')} disabled=${cap <= 5} onClick=${() => { hap.sel(); setCap(cap - 5); }}><${Icon} n="minus" /></button><b aria-live="polite">$${cap}</b><button class="round ink" aria-label=${L('Больше', 'More')} disabled=${cap >= 200} onClick=${() => { hap.sel(); setCap(cap + 5); }}><${Icon} n="plus" /></button></div>
    <p class="ax-path">${L('Дойдём до лимита: ИИ остановится и спросит. Чаты и дом останутся', 'At the limit AI stops and asks. Chats and the home stay')}</p>
    <${Dock}><button class="btn accent big grow" onClick=${save}>${L('Сохранить', 'Save')}</button><//>
  <//>`;
}

export function AccessScreen({ arg }) {
  const { v } = useAccess(['tg', 'tg-ok', 'receipt'].includes(arg));
  if (!canAccess()) return html`<${Scr}><${BackRound} />${msgCard(L('Это решает хозяин проекта', 'The project owner decides this'))}<//>`;
  if (!v) return html`<${Wait} />`;
  const P = { tg: TgPick, 'tg-ok': TgOk, wa: Wa, sees: Sees, off: Off, receipt: Receipt, limit: Limit }[arg] ?? Connect;
  return html`<${P} a=${v} />`;
}

// ---------------------------------------------------------------- 05 the first message, 06 the answer: one draft, the person decides
const DAY = 864e5;
export function DraftScreen({ draft, th, onMore }) {
  const { v: a } = useAccess();
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(draft.text ?? '');
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conv, setConv] = useState(null);
  useEffect(() => { setText(draft.text ?? ''); setEdit(false); setOpened(false); }, [draft.id]);
  useEffect(() => { let live = true; api(`/app/api/thread?s=${encodeURIComponent(D().search.id)}&c=${encodeURIComponent(draft.contact_id)}`).then((j) => live && setConv(j)).catch(() => null); return () => { live = false; }; }, [draft.id]);
  const l = listingById(draft.listing_id);
  const name = draft.contact_name || (th ? contactName(th) : draft.address);
  const last = (conv?.messages ?? []).filter((m) => m.direction === 'in').at(-1);
  const inAt = last?.at ?? draft.last_in_at;
  const left = inAt ? DAY - (Date.now() - Date.parse(inAt)) : 0;
  const byHand = (draft.channel === 'whatsapp' && a?.wa.status === 'button') || (draft.channel === 'telegram' && ['on'].includes(a?.tg.status) && !(left > 3e5));
  const ch = channelName(draft.channel);
  const ph = photosOf(l)[0];
  const drop = () => { const d = D(); d.drafts = d.drafts.filter((x) => x.id !== draft.id); emit(); refresh(); };
  const run = async (f) => { setBusy(true); try { await f(); } catch (e) { if (e.code === 'already_decided') drop(); else oops(e); } setBusy(false); };
  const send = () => run(async () => { const r = await api('/app/api/draft', { draft_id: draft.id, action: 'send', text: edit || text !== draft.text ? text : undefined }); hap.ok(); toast(r.status === 'sent' ? L('Отправлено', 'Sent') : t('approved_toast')); drop(); });
  const skip = () => run(async () => { await api('/app/api/draft', { draft_id: draft.id, action: 'skip' }); hap.sel(); toast(t('skipped_toast')); drop(); });
  const openApp = () => { const w = !inTG ? window.open('', '_blank') : null; return run(async () => {
    try { const r = await api('/app/api/access/open', { draft_id: draft.id, text }); setOpened(true); if (w) { w.opener = null; w.location.href = r.url; } else openLink(r.url); }
    catch (e) { w?.close(); if (e.code === 'no_link') { const c = channelsOf(draft.contact_id)[0]; toast(L('Нет номера или @имени', 'No number or @name')); if (c) openLink(channelLink(c.channel, c.address)); return; } throw e; }
  }); };
  const done = () => run(async () => { await api('/app/api/access/sent', { draft_id: draft.id }); hap.ok(); toast(L('Записал. Ответ перешли боту', 'Noted. Forward the answer to the bot')); drop(); });
  const answered = !!(last?.text || draft.last_in_text);
  const hours = Math.max(1, Math.floor(left / 36e5));
  return html`<${Scr} cls="ax-draft"><${BackRound} />
    <${Hero} word=${answered ? L('Ответ', 'Answer') : L('Пишем', 'Write')} h=${168} small>${ph && html`<span class="ax-photo"><${FloatPhoto} src=${ph} tilt=${3} cls="ax-ph" /></span>`}<${Ani} x=${ph ? '47%' : '80%'} y=${104} s=${64} />
      ${draft.channel === 'telegram' && a?.tg.status === 'on' && left > 3e5 && html`<${Sticker} text=${L(`${hours} ч на ответ`, `${hours} h to answer`)} cls="sm ax-sticker" style="right:-6px;top:96px" />`}<//>
    <${Typed} lines=${[answered ? L(`${firstName(name)}: ответ`, `${firstName(name)} answered`) : `${firstName(name)}${l ? ', ' + (l.short_name || shortLabel(l)) : ''}`]} as="h1" />
    <p class="w8-sub">${[l ? priceText(l) : null, ch, inAt ? (dayKey(inAt) === dayKey(new Date().toISOString()) ? fmtTime(inAt) : fmtDM(inAt)) : null].filter(Boolean).join(', ')}</p>
    ${answered && html`<div class="ax-in"><p>${last?.tr || last?.text || draft.last_in_text}</p>${last?.tr && html`<p class="tr">${last.text}</p>`}</div>`}
    ${edit ? html`<textarea class="edit-area ax-edit" aria-label=${t('edit_text')} value=${text} onInput=${(e) => setText(e.currentTarget.value)}></textarea>`
      : html`<div class=${'ax-out' + (answered ? ' ink' : '')}><p>${answered && draft.tr ? draft.tr : text}</p>${draft.tr && text === draft.text && html`<p class="tr">${answered ? text : draft.tr}</p>`}</div>`}
    ${draft.reason && !edit && html`<p class="ax-path">${draft.reason}</p>`}
    ${byHand && html`<div class="ax-list"><${Row} ic="smartphone" title=${L(`Откроется твой ${ch}`, `Your ${ch} opens`)} sub=${L('Текст уже вставлен, нажми «Отправить» там', 'The text is there, press Send')} />
      <${Row} ic="forward" title=${L('Когда ответит', 'When they answer')} sub=${draft.channel === 'telegram' ? L('Hunt увидит ответ сам', 'Hunt sees the answer itself') : L('Перешли ответ боту', 'Forward it to the bot')} /></div>`}
    <div class="ax-tools"><button class="btn sm surface thin" onClick=${onMore}>${L('Вся переписка', 'The conversation')}</button><button class="btn sm surface thin" disabled=${busy} onClick=${skip}>${t('dont_send')}</button></div>
    <${Dock}>
      ${byHand ? (opened ? html`<button class="btn accent big grow" disabled=${busy} onClick=${done}><${Icon} n="check" cls="sm" />${L('Я отправил', 'I sent it')}</button><button class="btn surface big" disabled=${busy} onClick=${openApp}>${L('Ещё раз', 'Again')}</button>`
        : html`<button class="btn accent big grow" disabled=${busy || !text.trim()} onClick=${openApp}><${Icon} n="arrow-up-right" cls="sm" />${L('Открыть', 'Open')} ${ch}</button><button class="btn surface big" onClick=${() => setEdit(!edit)}>${edit ? L('Готово', 'Done') : L('Изменить', 'Edit')}</button>`)
        : html`<button class="btn accent big grow" disabled=${busy || !text.trim()} onClick=${send}>${L('Отправить', 'Send')}</button><button class="btn surface big" onClick=${() => setEdit(!edit)}>${edit ? L('Готово', 'Done') : L('Изменить', 'Edit')}</button>`}
    <//>
  <//>`;
}
export const settingsRow = () => (canAccess() ? html`<button class="btn surface block" style="margin-bottom:10px" onClick=${() => { closeSheet(); open(); }}><${Icon} n="shield-check" />${L('Доступ к чатам', 'Access to chats')}</button>` : null);
// The desktop layout (desk.js) builds the same screens in columns from these pieces.
export { useAccess, post, oops, openTg, TG_PATH, download, Toy, Ani, Radio, Row, St, Go, rightName, pn, RcptPaper, rcTitle, rcSub };
