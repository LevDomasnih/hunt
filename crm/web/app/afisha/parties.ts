import { api, cssVar } from '../core/api.js';
import { D, canVoteRole, memberById, photoUrl, photosOf, sceneStyle } from '../core/data.js';
import { firstName, fmtNum, initial, money, tzNow } from '../core/format.js';
import { LANG, STR, pl, t, words } from '../core/i18n.js';
import { go, openLink, sp } from '../core/routing.js';
import { closeSheet, hap, openSheet, toast } from '../core/store.js';
import { addDays } from '../home/calendar.js';
import { Toggle } from '../home/docs.js';
import { BackIfWeb, askConfirm, copyText, hm, msgCard, pickFiles, shareTg, skel, uploadImage } from '../home/helpers.js';
import { hmToday, homeListing } from '../home/homemode.js';
import { parseAmount } from '../home/money.js';
import { briefCur } from '../screens/deal.js';
import { loadImg, rrect, wrapLines } from '../screens/recap.js';
import { Av, ICONS, Icon } from '../ui/icons.js';
import { AniStickers, BackRound, BigWord, Sticker, Typed } from '../ui/pieces.js';
import { AF, TicketBig, afBook, afDayLong, afHM, afPlace, afPrice, afReset, afTitle } from './afisha.js';
import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';

// ---------------------------------------------------------------- wave 9 · evenings & parties (DESIGN.md "Block vibe")
// Своя тусовка (party ticket, guests, checklist → Деньги, invite link, local rules, recap), the evening Home hero with the
// leave-by time, "Как было?" on events, the evening map layer and the share card (canvas, ticket style) + public links.
Object.assign(STR.ru, words({
  pt_title: 'Своя тусовка', pt_new: 'Своя тусовка', pt_new_sub: 'Позвать друзей домой', pt_ours: 'Ваши тусовки', pt_at_home: 'у нас дома', pt_home: 'дома',
  pt_going_n: (n) => `${n} ${pl(n, 'идёт', 'идут', 'идут')}`, pt_left_n: (n) => `ещё ${n} ${pl(n, 'место', 'места', 'мест')}`, pt_full: 'мест нет', pt_maybe_n: (n) => `${n} может`, pt_no_n: (n) => `${n} не смогут`,
  pt_invite: 'Приглашение', pt_invite_sub: 'Страница без Telegram: «Иду / Может / Не смогу». Адрес видят только те, кто ответил «Иду»', pt_share: 'Позвать', pt_copy: 'Скопировать', pt_regen: 'Новая ссылка', pt_revoke: 'Закрыть ссылку',
  pt_regen_q: 'Старая ссылка и личные ссылки гостей перестанут работать. Сделать новую?', pt_revoke_q: 'Закрыть приглашение? Страница и личные ссылки гостей перестанут открываться', pt_revoked: 'Ссылка закрыта', pt_no_link: 'Ссылка закрыта', pt_open_link: 'Открыть приглашение',
  pt_guests: 'Гости · {n}', pt_guests_none: 'Пока никто не ответил. Отправь приглашение в чат друзей', pt_a_going: 'идёт', pt_a_maybe: 'может', pt_a_no: 'не сможет', pt_removed: 'убран', pt_remove: 'Убрать',
  pt_remove_q: 'Убрать {g} из гостей? Личная ссылка перестанет показывать адрес', pt_restore: 'Вернуть', pt_came: 'пришёл', pt_not_came: 'не пришёл',
  pt_check: 'Кто что берёт · {k} из {n}', pt_take: 'Возьму', pt_nobody: 'никто', pt_item_add: 'Добавить', pt_item: 'Пункт', pt_item_ph: 'Чипсы, гирлянда, лёд…', pt_who: 'Кто берёт', pt_cost: 'Сколько стоило', pt_cost_hint: 'Сумма с плательщиком попадёт в «Деньги»',
  pt_in_money: 'в «Деньгах»', pt_item_del: 'Удалить пункт', pt_k_drinks: 'Напитки', pt_k_ice: 'Лёд', pt_k_food: 'Еда', pt_k_music: 'Музыка', pt_k_cups: 'Стаканы', pt_k_cleanup: 'Уборка', pt_k_other: 'Другое',
  pt_rules: 'Местные правила', pt_quiet: 'тихо после {t}', pt_notice_owner: 'Предупредить хозяина', pt_notice_nb: 'Предупредить соседей', pt_notice_sent: 'Агент напишет черновик, ты одобришь перед отправкой', pt_notice_already: 'Уже попросили агента',
  pt_edit: 'Изменить', pt_name: 'Название', pt_name_ph: 'Закат у бассейна', pt_date: 'День', pt_time: 'Начало', pt_end: 'Конец', pt_theme: 'Тема', pt_theme_ph: 'Белая вечеринка, плейлист вместе', pt_vibe: 'Вайб',
  pt_v_chill: 'чилл', pt_v_dance: 'танцы', pt_v_dinner: 'ужин', pt_v_pool: 'бассейн', pt_v_games: 'игры', pt_v_sunset: 'закат', pt_cap: 'Сколько человек', pt_cap_none: 'без лимита', pt_plus: 'Можно с +1',
  pt_byob: 'Напитки', pt_byob_y: 'каждый свои', pt_byob_n: 'у нас есть', pt_byob_0: 'не важно', pt_dress: 'Дресс-код', pt_dress_ph: 'всё белое', pt_note: 'Пара слов гостям', pt_note_ph: 'Плавки с собой, полотенца есть',
  pt_secret: 'Только для тех, кто идёт', pt_addr: 'Адрес', pt_addr_ph: 'Если пусто, возьмём адрес из гайда дома', pt_how: 'Как добраться', pt_how_ph: 'Зелёные ворота после магазина', pt_wifi: 'Показать Wi-Fi из гайда',
  pt_cover: 'Обложка', pt_cover_home: 'Фото дома', pt_cover_up: 'Своё фото', pt_save: 'Сохранить', pt_create: 'Создать и позвать', pt_saved: 'Сохранено', pt_cancel_party: 'Отменить тусовку', pt_cancel_q: 'Отменить тусовку? Гости увидят «отменили»',
  pt_after: 'Как прошло', pt_rate_q: 'Как прошла тусовка?', pt_rate_note: 'Пара слов, если хочется', pt_photos: 'Фото', pt_photo_add: 'Добавить фото', pt_recap_came: 'пришли', pt_recap_spent: 'потратили', pt_recap_rate: 'оценка',
  pt_cancelled: 'отменили', pt_byob_s: 'свои напитки', pt_drinks_s: 'напитки есть', pt_new_q: 'Тусовка дома?',
  ev_word: 'Вечер', ev_leave_at: 'Выезжать в {t}', ev_leave_now: 'Пора выезжать', ev_leave_late: 'Выезжать надо было в {t}', ev_party_at: 'Тусовка у вас в {t}', ev_leave_st: 'выезд {t}',
  ev_ride: '{n} мин на байке', ev_ride_rush: '{n} мин, пробки', ev_k_ride: 'дорога', ev_k_start: 'начало', ev_k_who: 'идут', ev_k_left: 'до выезда', ev_go: 'Я выезжаю', ev_gone: 'Едешь', ev_late: 'Опаздываю',
  ev_go_sent: (n) => (n ? `Написали ${n} ${pl(n, 'другу', 'друзьям', 'друзьям')}` : 'Отметили: едешь'), ev_go_quiet: 'Отметили. Остальных не будим: тихие часы', ev_late_title: 'Насколько опаздываешь?', ev_late_sub: 'Агент подготовит сообщение организатору, отправится после одобрения',
  ev_late_sent: 'Черновик организатору ждёт одобрения', ev_late_min: '{n} мин', ev_in_min: 'через {n} мин', ev_in_h: 'через {n} ч',
  fb_q: 'Как было?', fb_sub: 'Оценка сильнее лайка: Афиша учится на ней', fb_note_ph: 'Что запомнилось, что не так', fb_save: 'Сохранить', fb_saved: 'Спасибо, учтём', fb_you: 'Твоя оценка', fb_liked: 'вам понравилось', fb_liked_line: 'вы были и поставили {r}',
  sh_title: 'Поделиться', sh_tg: 'В Telegram', sh_copy: 'Ссылка', sh_img: 'Картинка', sh_party_note: 'По ссылке гости ответят «Иду» и увидят адрес только после этого', sh_ev_note: 'Открытая страница события: без входа, без адресов дома',
  sh_text_ev: '{t} · {w}', sh_text_pt: 'Зову на {t}, {w}',
  hm_layer_evening: 'Вечер', mp_evening: 'Вечер', mp_evening_none: 'Сегодня вечером рядом пусто', w9_party_link: 'Тусовка',
}));
Object.assign(STR.en, words({
  pt_title: 'House party', pt_new: 'House party', pt_new_sub: 'Have friends over', pt_ours: 'Your parties', pt_at_home: 'at ours', pt_home: 'home',
  pt_going_n: (n) => `${n} going`, pt_left_n: (n) => `${n} ${pl(n, 'spot', 'spots')} left`, pt_full: 'full', pt_maybe_n: (n) => `${n} maybe`, pt_no_n: (n) => `${n} can’t`,
  pt_invite: 'Invitation', pt_invite_sub: 'A page without Telegram: “I’m in / Maybe / Can’t”. Only “I’m in” guests see the address', pt_share: 'Invite', pt_copy: 'Copy', pt_regen: 'New link', pt_revoke: 'Close link',
  pt_regen_q: 'The old link and the guests’ personal links stop working. Make a new one?', pt_revoke_q: 'Close the invitation? The page and the guests’ personal links stop opening', pt_revoked: 'Link closed', pt_no_link: 'Link closed', pt_open_link: 'Open invitation',
  pt_guests: 'Guests · {n}', pt_guests_none: 'Nobody answered yet. Send the invitation to your friends’ chat', pt_a_going: 'going', pt_a_maybe: 'maybe', pt_a_no: 'can’t', pt_removed: 'removed', pt_remove: 'Remove',
  pt_remove_q: 'Remove {g} from the guests? Their personal link stops showing the address', pt_restore: 'Restore', pt_came: 'came', pt_not_came: 'didn’t come',
  pt_check: 'Who brings what · {k} of {n}', pt_take: 'I’ll get it', pt_nobody: 'nobody', pt_item_add: 'Add', pt_item: 'Item', pt_item_ph: 'Chips, fairy lights, ice…', pt_who: 'Who brings it', pt_cost: 'What it cost', pt_cost_hint: 'An amount with a payer goes to Money',
  pt_in_money: 'in Money', pt_item_del: 'Delete item', pt_k_drinks: 'Drinks', pt_k_ice: 'Ice', pt_k_food: 'Food', pt_k_music: 'Music', pt_k_cups: 'Cups', pt_k_cleanup: 'Cleanup', pt_k_other: 'Other',
  pt_rules: 'Local rules', pt_quiet: 'quiet after {t}', pt_notice_owner: 'Tell the owner', pt_notice_nb: 'Tell the neighbours', pt_notice_sent: 'The agent drafts it, you approve before it goes', pt_notice_already: 'Already asked the agent',
  pt_edit: 'Edit', pt_name: 'Name', pt_name_ph: 'Sunset by the pool', pt_date: 'Day', pt_time: 'Starts', pt_end: 'Ends', pt_theme: 'Theme', pt_theme_ph: 'White party, shared playlist', pt_vibe: 'Vibe',
  pt_v_chill: 'chill', pt_v_dance: 'dance', pt_v_dinner: 'dinner', pt_v_pool: 'pool', pt_v_games: 'games', pt_v_sunset: 'sunset', pt_cap: 'How many people', pt_cap_none: 'no limit', pt_plus: '+1 welcome',
  pt_byob: 'Drinks', pt_byob_y: 'bring your own', pt_byob_n: 'we have drinks', pt_byob_0: 'doesn’t matter', pt_dress: 'Dress code', pt_dress_ph: 'all white', pt_note: 'A word to the guests', pt_note_ph: 'Bring swimwear, towels are here',
  pt_secret: 'Only for those who come', pt_addr: 'Address', pt_addr_ph: 'Empty = the address from the house guide', pt_how: 'How to get there', pt_how_ph: 'Green gate after the shop', pt_wifi: 'Show the guide’s Wi-Fi',
  pt_cover: 'Cover', pt_cover_home: 'House photo', pt_cover_up: 'My photo', pt_save: 'Save', pt_create: 'Create and invite', pt_saved: 'Saved', pt_cancel_party: 'Cancel the party', pt_cancel_q: 'Cancel the party? Guests will see “cancelled”',
  pt_after: 'How it went', pt_rate_q: 'How was the party?', pt_rate_note: 'A few words, if you like', pt_photos: 'Photos', pt_photo_add: 'Add photos', pt_recap_came: 'came', pt_recap_spent: 'spent', pt_recap_rate: 'rating',
  pt_cancelled: 'cancelled', pt_byob_s: 'BYOB', pt_drinks_s: 'drinks here', pt_new_q: 'Party at home?',
  ev_word: 'Tonight', ev_leave_at: 'Leave at {t}', ev_leave_now: 'Time to leave', ev_leave_late: 'You should have left at {t}', ev_party_at: 'Party at yours at {t}', ev_leave_st: 'leave {t}',
  ev_ride: '{n} min by bike', ev_ride_rush: '{n} min, traffic', ev_k_ride: 'ride', ev_k_start: 'starts', ev_k_who: 'going', ev_k_left: 'until you leave', ev_go: 'I’m leaving', ev_gone: 'On the way', ev_late: 'Running late',
  ev_go_sent: (n) => (n ? `Told ${n} ${pl(n, 'friend', 'friends')}` : 'Noted: on your way'), ev_go_quiet: 'Noted. Not waking the others: quiet hours', ev_late_title: 'How late are you?', ev_late_sub: 'The agent drafts a message to the organizer; it goes after approval',
  ev_late_sent: 'The draft to the organizer waits for approval', ev_late_min: '{n} min', ev_in_min: 'in {n} min', ev_in_h: 'in {n} h',
  fb_q: 'How was it?', fb_sub: 'A rating beats a like: Афиша learns from it', fb_note_ph: 'What stood out, what didn’t', fb_save: 'Save', fb_saved: 'Thanks, noted', fb_you: 'Your rating', fb_liked: 'you liked it', fb_liked_line: 'you went and gave it {r}',
  sh_title: 'Share', sh_tg: 'Telegram', sh_copy: 'Link', sh_img: 'Picture', sh_party_note: 'Guests answer “I’m in” on the page and only then see the address', sh_ev_note: 'A public event page: no login, no home address',
  sh_text_ev: '{t} · {w}', sh_text_pt: 'Come to {t}, {w}',
  hm_layer_evening: 'Tonight', mp_evening: 'Tonight', mp_evening_none: 'Nothing on nearby tonight', w9_party_link: 'Party',
}));
Object.assign(ICONS, {
  share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>',
  'trash-2': '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  snowflake: '<path d="M2 12h20M12 2v20M20 16l-4-4 4-4M4 8l4 4-4 4M16 4l-4 4-4-4M8 20l4-4 4 4"/>',
  'glass-water': '<path d="M5.12 2h13.76a1 1 0 0 1 1 1.11l-1.8 16.2A3 3 0 0 1 15.1 22H8.9a3 3 0 0 1-2.98-2.69L4.12 3.11A1 1 0 0 1 5.12 2Z"/><path d="M6 12a5 5 0 0 1 6 0 5 5 0 0 0 6 0"/>',
  brush: '<path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/>',
  speaker: '<rect width="16" height="20" x="4" y="2" rx="2"/><circle cx="12" cy="14" r="4"/><path d="M12 6h.01"/>',
});
export const PT_ICON = { drinks: 'martini', ice: 'snowflake', food: 'utensils', music: 'speaker', cups: 'glass-water', cleanup: 'brush', other: 'sparkles' };
export const PT = { rev: 0 };
export const ptHM = (iso) => hm(String(iso ?? '').slice(11, 16));
export const ptDay = (iso) => String(iso ?? '').slice(0, 10);
export const ptCover = (p) => (p?.cover ? photoUrl(p.cover) : photosOf(homeListing())[0] ?? null);
export const ptWhen = (p) => `${afDayLong(ptDay(p.starts_at))} · ${ptHM(p.starts_at)}${p.ends_at ? '–' + ptHM(p.ends_at) : ''}`;
export const ptCan = () => canVoteRole(D()?.me?.role) && D()?.search?.status !== 'closed';
/** "+08:00" of the project's time zone on a day (no DST in our regions, computed anyway). */
export function tzOff(day) {
  try {
    const v = new Intl.DateTimeFormat('en-US', { timeZone: tzNow(), timeZoneName: 'longOffset' }).formatToParts(new Date(day + 'T12:00:00Z')).find((x) => x.type === 'timeZoneName')?.value ?? 'GMT';
    const m = v.match(/([+-])(\d{1,2}):?(\d{2})?/);
    return m ? `${m[1]}${String(m[2]).padStart(2, '0')}:${m[3] ?? '00'}` : '+00:00';
  } catch { return '+00:00'; }
}
export function useParties() {
  const d = D();
  const [v, setV] = useState(null);
  useEffect(() => {
    let live = true;
    api('/app/api/parties?s=' + encodeURIComponent(d.search.id)).then((j) => live && setV(j.parties)).catch(() => live && setV([]));
    return () => { live = false; };
  }, [d.search.id, PT.rev]);
  return v;
}
export const ptUpcoming = (list) => (list ?? []).filter((p) => !p.past && p.status === 'active');

/** A party as a ticket: the cover (or the house) in the black frame, perforation, the stub with the date and the counts. */
export function PartyTicket({ p, small = false }) {
  const c = p.counts ?? {};
  const meta = [ptWhen(p), t('pt_going_n', { n: c.heads ?? 0 }), c.left != null ? (c.left ? t('pt_left_n', { n: c.left }) : t('pt_full')) : null].filter(Boolean).join(' · ');
  return html`<button class=${'pt9-tk' + (small ? ' sm' : '')} onClick=${() => { hap.sel(); go(sp('party', p.id)); }}>
    <span class="frame pt9-frame"><span class="in">${ptCover(p) ? html`<img src=${ptCover(p)} alt="" decoding="async" />` : html`<span class="scene solid" style=${sceneStyle(D().search.country)}></span>`}</span></span>
    <span class="pt9-perf" aria-hidden="true"></span>
    <span class="pt9-stub">${p.theme && html`<small>${p.theme}</small>`}<b>${p.title}</b><span>${meta}</span></span>
    <${Sticker} text=${t('pt_at_home')} cls="sm" style="right:-8px;top:-14px;--r:12deg" />
  </button>`;
}
/** Афиша: the members' own parties on top + "Своя тусовка". */
export function AfParties() {
  const list = ptUpcoming(useParties());
  return html`<section class="pt9-af">
    ${list.slice(0, 2).map((p) => html`<${PartyTicket} key=${p.id} p=${p} small />`)}
    ${ptCan() && html`<button class="pt9-new" onClick=${() => { hap.sel(); go(sp('party-edit', 'new')); }}><span class="round ink"><${Icon} n="plus" /></span>
      <span class="grow"><b>${t('pt_new')}</b><span>${t('pt_new_sub')}</span></span><${Icon} n="arrow-up-right" cls="sm" /></button>`}
  </section>`;
}

/** The party screen: ticket hero, counts, invite link, guests, checklist, local rules; after the party rating, photos, recap. */
export function PartyScreen({ id }) {
  const d = D();
  const [v, setV] = useState(null);
  const [rev, setRev] = useState(0);
  useEffect(() => { api(`/app/api/party?s=${encodeURIComponent(d.search.id)}&id=${encodeURIComponent(id)}`).then(setV).catch((e) => setV({ failed: true, code: e.code })); }, [id, rev, PT.rev]);
  if (!v) return html`<main class="screen no-nav">${skel(360)}${skel(180)}</main>`;
  if (v.failed) return html`<main class="screen no-nav"><${BackIfWeb} />${msgCard(t('err_generic'))}</main>`;
  const p = v.party;
  const c = p.counts;
  const can = ptCan() && p.status !== 'cancelled';
  const set = (j) => { setV(j.party ? j : { ...v, ...j }); PT.rev++; };
  const post = async (path, body, ok = null) => { try { const j = await api(path, { search_id: d.search.id, id: p.id, ...body }); hap.ok(); if (ok) toast(ok); return j; } catch (e) { toast(e.code === 'sensitive' ? e.message : t('err_generic')); return null; } };
  const link = async (action) => {
    if (action !== 'share' && !(await askConfirm(t(action === 'regenerate' ? 'pt_regen_q' : 'pt_revoke_q')))) return;
    const j = await post('/app/api/party-link', { action }, action === 'revoke' ? t('pt_revoked') : null);
    if (j) { setRev((x) => x + 1); if (j.url && action === 'regenerate') copyText(j.url); }
  };
  const guest = async (g, action) => {
    if (action === 'remove' && !(await askConfirm(t('pt_remove_q', { g: g.name })))) return;
    const j = await post('/app/api/party-guest', { guest_id: g.id, action });
    if (j) setV({ ...v, guests: j.guests, party: { ...p, counts: j.counts } });
  };
  const take = async (it) => { const j = await post('/app/api/party-item', { item_id: it.id, who: it.who === d.user.id ? null : d.user.id }); if (j) set(j); };
  const toggleDone = async (it) => { const j = await post('/app/api/party-item', { item_id: it.id, done: !it.done }); if (j) set(j); };
  const notice = async (to) => { const j = await post('/app/api/party-notice', { to }); if (j) toast(j.already ? t('pt_notice_already') : t('pt_notice_sent')); };
  const past = p.past;
  const going = v.guests.filter((g) => !g.removed && g.answer === 'going');
  const order = { going: 0, maybe: 1, no: 2 };
  const guests = [...v.guests].sort((a, b) => Number(a.removed) - Number(b.removed) || order[a.answer] - order[b.answer]);
  const done = v.items.filter((i) => i.done || i.who).length;
  const rules = v.rules;
  const rhint = rules ? (LANG === 'ru' ? rules.hint_ru : rules.hint_en) : null;
  const fines = rules ? (LANG === 'ru' ? rules.fines_ru : rules.fines_en) : null;
  const myRate = v.ratings.find((r) => r.user_id === d.user.id);
  const lines = [past ? t('pt_rate_q') : c.heads ? t('pt_going_n', { n: c.heads }) + (c.left != null ? ' · ' + (c.left ? t('pt_left_n', { n: c.left }) : t('pt_full')) : '') : t('pt_new_q')];
  const stick = [p.byob === true ? t('pt_byob_s') : p.byob === false ? t('pt_drinks_s') : null, p.dress_code].filter(Boolean);
  return html`<main class="screen pt9">
    <${BackRound} />
    <section class="w8-hero pt9-hero">
      <${BigWord} text=${t('pt_home')} />
      <div class="pt9-stage">
        <div class="pt9-ticket">
          <span class="frame pt9-frame big"><span class="in">${ptCover(p) ? html`<img src=${ptCover(p)} alt="" decoding="async" />` : html`<span class="scene solid" style=${sceneStyle(d.search.country)}></span>`}</span></span>
          <span class="pt9-perf" aria-hidden="true"></span>
          <span class="pt9-stub"><small>${ptWhen(p)}</small><b class="pt9-h">${p.title}</b>${p.theme && html`<span>${p.theme}</span>`}</span>
        </div>
        ${stick.map((s, i) => html`<${Sticker} key=${i} text=${s} cls=${i ? 'sky sm' : ''} style=${i ? 'left:-12px;top:-26px;--r:-10deg' : 'right:-8px;top:-22px;--r:12deg'} />`)}
      </div>
      <${Typed} lines=${lines} />
      <p class="w8-sub">${[c.maybe ? t('pt_maybe_n', { n: c.maybe }) : null, c.no ? t('pt_no_n', { n: c.no }) : null, p.status === 'cancelled' ? t('pt_cancelled') : null].filter(Boolean).join(' · ') || ' '}</p>
      <div class="w8-pills">
        ${can && !past && html`<button class="btn accent" onClick=${() => (p.link ? openSheet('share', { kind: 'party', p }) : link('share'))}><${Icon} n="send" cls="sm" />${t('pt_share')}</button>`}
        ${!past && p.link && html`<button class="btn surface" onClick=${() => openSheet('share', { kind: 'party', p })}><${Icon} n="share" cls="sm" />${t('sh_title')}</button>`}
        ${can && html`<button class="round" aria-label=${t('pt_edit')} onClick=${() => go(sp('party-edit', p.id))}><${Icon} n="pencil" /></button>`}
      </div>
    </section>
    ${past && html`<section class="pt9-sec"><p class="section">${t('pt_after')}</p>
      <div class="w8-stats pt9-recap">
        <div><small>${t('pt_recap_came')}</small><b>${v.recap.came ?? v.recap.heads}</b></div>
        ${v.recap.spent && html`<div><small>${t('pt_recap_spent')}</small><b>${money(v.recap.spent, v.recap.currency)}</b></div>`}
        ${v.recap.rating && html`<div><small>${t('pt_recap_rate')}</small><b>${fmtNum(v.recap.rating)} / 5</b></div>`}
      </div>
      ${canVoteRole(d.me.role) && html`<${RateRow} cur=${myRate?.rating ?? null} note=${myRate?.note ?? ''} onSave=${async (r, note) => { const j = await post('/app/api/party-rate', { rating: r, note }, t('fb_saved')); if (j) set(j); }} />`}
      ${v.ratings.length > 0 && html`<div class="pt9-rates">${v.ratings.map((r) => html`<div key=${r.user_id} class="pt9-rate"><${Av} m=${memberById(r.user_id) ?? { name: r.name }} size=${32} ring /><span class="grow"><b>${'★'.repeat(r.rating)}</b>${r.note && html`<span>${r.note}</span>`}</span></div>`)}</div>`}
      <div class="pt9-photos">${p.photos.map((ph, i) => html`<a key=${i} class="pt9-ph" href=${photoUrl(ph)} target="_blank" rel="noopener"><img src=${photoUrl(ph)} alt="" loading="lazy" /></a>`)}
        ${canVoteRole(d.me.role) && html`<button class="pt9-ph add" onClick=${async () => {
          const files = await pickFiles({ multiple: true });
          for (const f of files.slice(0, 10)) { try { await uploadImage(`/app/api/party-photo?search_id=${encodeURIComponent(d.search.id)}&id=${encodeURIComponent(p.id)}`, f); } catch { toast(t('err_generic')); break; } }
          if (files.length) { hap.ok(); setRev((x) => x + 1); }
        }}><${Icon} n="image" /><span>${t('pt_photo_add')}</span></button>`}</div>
    </section>`}
    <section class="pt9-sec">
      <p class="section">${t('pt_guests', { n: c.heads })}</p>
      ${guests.length ? html`<div class="pt9-list">${guests.map((g) => html`<div key=${g.id} class=${'pt9-row' + (g.removed ? ' off' : '')}>
          <span class="pt9-ini">${initial(g.name)}</span>
          <span class="grow"><b>${g.name}${g.plus_one ? ' +1' : ''}</b><span>${g.removed ? t('pt_removed') : past && g.came != null ? t(g.came ? 'pt_came' : 'pt_not_came') : t('pt_a_' + g.answer)}</span></span>
          ${can && !past && (g.removed ? html`<button class="btn sm surface" onClick=${() => guest(g, 'restore')}>${t('pt_restore')}</button>` : html`<button class="round sm soft" aria-label=${t('pt_remove') + ': ' + g.name} onClick=${() => guest(g, 'remove')}><${Icon} n="x" cls="sm" /></button>`)}
          ${can && past && !g.removed && g.answer === 'going' && html`<button class=${'btn sm ' + (g.came ? 'accent' : 'surface')} aria-pressed=${g.came ? 'true' : 'false'} onClick=${() => guest(g, g.came ? 'not_came' : 'came')}>${t('pt_came')}</button>`}
        </div>`)}</div>` : html`<p class="muted pt9-empty">${t('pt_guests_none')}</p>`}
    </section>
    ${!past && html`<section class="pt9-sec">
      <div class="row pt9-sh"><p class="section grow">${t('pt_check', { k: done, n: v.items.length })}</p>${can && html`<button class="btn sm link" onClick=${() => openSheet('pt_item', { p, it: null })}><${Icon} n="plus" cls="sm" />${t('pt_item_add')}</button>`}</div>
      <div class="pt9-list">${v.items.map((it) => html`<div key=${it.id} class=${'pt9-row' + (it.done ? ' done' : '')}>
        <button class="pt9-chk" role="checkbox" aria-checked=${it.done ? 'true' : 'false'} aria-label=${it.title} disabled=${!can} onClick=${() => toggleDone(it)}>${it.done ? html`<${Icon} n="check" cls="sm" />` : html`<${Icon} n=${PT_ICON[it.kind] ?? 'sparkles'} cls="sm" />`}</button>
        <button class="grow pt9-it" disabled=${!can} onClick=${() => openSheet('pt_item', { p, it })}><b>${it.title}</b><span>${[it.who ? (it.who === d.user.id ? t('af_you_cap') : firstName(it.who_name)) : t('pt_nobody'), it.cost ? money(it.cost, it.currency) : null, it.expense_id ? t('pt_in_money') : null].filter(Boolean).join(' · ')}</span></button>
        ${it.who ? html`<${Av} m=${memberById(it.who) ?? { name: it.who_name }} size=${30} ring />` : can && html`<button class="btn sm surface" onClick=${() => take(it)}>${t('pt_take')}</button>`}
      </div>`)}</div>
    </section>`}
    ${!past && html`<section class="pt9-sec">
      <p class="section">${t('pt_invite')}</p>
      <p class="muted pt9-sub">${t('pt_invite_sub')}</p>
      ${p.link ? html`<div class="w8-pills pt9-link">
          <button class="btn sm surface" onClick=${() => copyText(p.link)}><${Icon} n="copy" cls="sm" />${t('pt_copy')}</button>
          <button class="btn sm surface" onClick=${() => openLink(p.link)}><${Icon} n="arrow-up-right" cls="sm" />${t('pt_open_link')}</button>
          ${can && html`<button class="btn sm ghost" onClick=${() => link('regenerate')}><${Icon} n="refresh-cw" cls="sm" />${t('pt_regen')}</button>
            <button class="btn sm ghost" onClick=${() => link('revoke')}><${Icon} n="lock" cls="sm" />${t('pt_revoke')}</button>`}
        </div>` : html`<p class="pt9-sub"><b>${t('pt_no_link')}</b></p>${can && html`<button class="btn sm accent" onClick=${() => link('share')}>${t('pt_share')}</button>`}`}
    </section>`}
    ${!past && (rhint || rules) && html`<section class="pt9-sec pt9-rules">
      <p class="section">${t('pt_rules')}${rules?.quiet_after ? ' · ' + t('pt_quiet', { t: rules.quiet_after }) : ''}</p>
      ${rhint && html`<p class="pt9-hint">${rhint}</p>`}
      ${fines && html`<p class="muted pt9-sub">${fines}</p>`}
      ${can && html`<div class="w8-pills">${rules?.notice_owner !== false && html`<button class="btn sm surface" onClick=${() => notice('owner')}><${Icon} n="message-circle" cls="sm" />${t('pt_notice_owner')}</button>`}
        ${rules?.notice_neighbours !== false && html`<button class="btn sm surface" onClick=${() => notice('neighbours')}><${Icon} n="users" cls="sm" />${t('pt_notice_nb')}</button>`}</div>`}
    </section>`}
  </main>`;
}
/** 1–5 + an optional note (party and event "Как было?"). */
export function RateRow({ cur, note: note0 = '', onSave }) {
  const [r, setR] = useState(cur);
  const [note, setNote] = useState(note0 ?? '');
  const [busy, setBusy] = useState(false);
  return html`<div class="fb9">
    <div class="fb9-stars" role="radiogroup" aria-label=${t('fb_q')}>${[1, 2, 3, 4, 5].map((n) => html`<button key=${n} role="radio" aria-checked=${r === n ? 'true' : 'false'} class=${'fb9-n' + (r != null && n <= r ? ' on' : '')} onClick=${() => { hap.sel(); setR(n); }}>${n}</button>`)}</div>
    <input class="e-input fb9-note" value=${note} maxlength="300" placeholder=${t('fb_note_ph')} onInput=${(e) => setNote(e.currentTarget.value)} />
    <button class="btn accent" disabled=${!r || busy} onClick=${async () => { setBusy(true); await onSave(r, note.trim() || null); setBusy(false); }}>${t('fb_save')}</button>
  </div>`;
}
export function PartyItemSheet({ arg }) {
  const d = D();
  const p = arg.p, it = arg.it;
  const voters = d.members.filter((m) => canVoteRole(m.role));
  const [title, setTitle] = useState(it?.title ?? '');
  const [kind, setKind] = useState(it?.kind ?? 'other');
  const [who, setWho] = useState(it?.who ?? null);
  const [cost, setCost] = useState(it?.cost ? String(it.cost) : '');
  const [busy, setBusy] = useState(false);
  const cur = it?.currency ?? d.money?.currency ?? briefCur(d.search);
  const save = async (del = false) => {
    setBusy(true);
    try {
      const body = del ? { item_id: it.id, delete: true } : { ...(it ? { item_id: it.id } : {}), title: title.trim(), kind, who, cost: parseAmount(cost) || null };
      await api('/app/api/party-item', { search_id: d.search.id, id: p.id, ...body });
      hap.ok(); PT.rev++; closeSheet();
    } catch (e) { toast(e.code === 'sensitive' ? e.message : t('err_generic')); }
    setBusy(false);
  };
  return html`<h2>${it ? it.title : t('pt_item_add')}</h2>
    <p class="section" style="margin-top:0">${t('pt_item')}</p>
    <input class="e-input" value=${title} maxlength="60" placeholder=${t('pt_item_ph')} onInput=${(e) => setTitle(e.currentTarget.value)} />
    <div class="w3-chips pt9-kinds" role="group">${Object.keys(PT_ICON).map((k) => html`<button key=${k} aria-pressed=${kind === k ? 'true' : 'false'} onClick=${() => { hap.sel(); setKind(k); }}><${Icon} n=${PT_ICON[k]} cls="xs" />${t('pt_k_' + k)}</button>`)}</div>
    <p class="section">${t('pt_who')}</p>
    <div class="card grp">${voters.map((m) => html`<button key=${m.user_id} class="opt" role="radio" aria-checked=${who === m.user_id ? 'true' : 'false'} onClick=${() => { hap.sel(); setWho(who === m.user_id ? null : m.user_id); }}>
      <${Av} m=${m} size=${36} /><span class="grow">${m.user_id === d.user.id ? t('af_you_cap') : m.name}</span><span class=${'cbox' + (who === m.user_id ? ' on' : '')}>${who === m.user_id && html`<${Icon} n="check" />`}</span></button>`)}</div>
    <p class="section">${t('pt_cost')}</p>
    <div class="pt9-amt"><input class="e-input" inputmode="numeric" value=${cost} placeholder="0" onInput=${(e) => setCost(e.currentTarget.value)} /><span>${cur ?? ''}</span></div>
    <p class="muted af-sheet-note">${t('pt_cost_hint')}</p>
    <button class="btn accent block" disabled=${busy || !title.trim()} onClick=${() => save(false)}>${t('pt_save')}</button>
    ${it && html`<button class="btn danger block" style="margin-top:10px" disabled=${busy} onClick=${() => save(true)}><${Icon} n="trash-2" cls="sm" />${t('pt_item_del')}</button>`}
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}

/** Create / edit a party: one screen, sections; the address and Wi-Fi are marked "only for those who come". */
export function PartyEdit({ id }) {
  const d = D();
  const isNew = !id || id === 'new';
  const [v, setV] = useState<{ party?: any; failed?: boolean } | null>(isNew ? { party: null } : null);
  useEffect(() => { if (!isNew) api(`/app/api/party?s=${encodeURIComponent(d.search.id)}&id=${encodeURIComponent(id)}`).then(setV).catch(() => setV({ failed: true })); }, [id]);
  if (!v) return html`<main class="screen no-nav">${skel(300)}</main>`;
  if (v.failed) return html`<main class="screen no-nav"><${BackIfWeb} />${msgCard(t('err_generic'))}</main>`;
  return html`<${PartyForm} p=${v.party} />`;
}
export function PartyForm({ p }) {
  const d = D();
  const tmr = addDays(hmToday(), 1);
  const [f, setF] = useState(() => ({
    title: p?.title ?? '', day: p ? ptDay(p.starts_at) : tmr, time: p ? String(p.starts_at).slice(11, 16) : '19:00', end: p?.ends_at ? String(p.ends_at).slice(11, 16) : '23:00',
    theme: p?.theme ?? '', vibe: p?.vibe ?? null, capacity: p?.capacity ?? null, plus_one: p ? p.plus_one : true, byob: p ? p.byob : null, dress_code: p?.dress_code ?? '', note: p?.note ?? '',
    address: p?.address ?? '', how_to: p?.how_to ?? '', wifi: p ? p.wifi : true,
  }));
  const [cover, setCover] = useState(null);
  const [busy, setBusy] = useState(false);
  const up = (k) => (e) => setF({ ...f, [k]: e.currentTarget.value });
  const save = async () => {
    setBusy(true);
    try {
      const off = tzOff(f.day);
      const endDay = f.end && f.end < f.time ? addDays(f.day, 1) : f.day;
      const body = { search_id: d.search.id, ...(p ? { id: p.id } : {}), title: f.title.trim(), starts_at: `${f.day}T${f.time}:00${off}`, ends_at: f.end ? `${endDay}T${f.end}:00${tzOff(endDay)}` : null,
        theme: f.theme.trim() || null, vibe: f.vibe, capacity: f.capacity, plus_one: f.plus_one, byob: f.byob, dress_code: f.dress_code.trim() || null, note: f.note.trim() || null,
        address: f.address.trim() || null, how_to: f.how_to.trim() || null, wifi: f.wifi };
      const j = await api('/app/api/party', body);
      if (cover) await uploadImage(`/app/api/party-cover?search_id=${encodeURIComponent(d.search.id)}&id=${encodeURIComponent(j.party.id)}`, cover).catch(() => toast(t('err_generic')));
      hap.ok(); PT.rev++; toast(t('pt_saved'));
      go(sp('party', j.party.id), true);
      if (!p && j.party.link) openSheet('share', { kind: 'party', p: j.party });
    } catch (e) { toast(e.code === 'sensitive' || e.code === 'bad_time' ? e.message : t('err_generic')); }
    setBusy(false);
  };
  const cancelParty = async () => {
    if (!(await askConfirm(t('pt_cancel_q')))) return;
    try { await api('/app/api/party', { search_id: d.search.id, id: p.id, status: 'cancelled' }); PT.rev++; go(sp('afisha'), true); } catch { toast(t('err_generic')); }
  };
  const pill = (k, val, label) => html`<button key=${String(val)} aria-pressed=${f[k] === val ? 'true' : 'false'} onClick=${() => { hap.sel(); setF({ ...f, [k]: f[k] === val && k === 'vibe' ? null : val }); }}>${label}</button>`;
  const homePh = photosOf(homeListing())[0];
  const coverSrc = cover ? URL.createObjectURL(cover) : p?.cover ? photoUrl(p.cover) : homePh;
  return html`<main class="screen no-nav pt9-form">
    <${BackRound} />
    <div class="head w3-head"><div><p class="kicker">${t('pt_title')}</p><h1 class="h1">${p ? p.title : t('pt_new_q')}</h1></div></div>
    <div class="pt9-cover">
      <span class="frame pt9-frame"><span class="in">${coverSrc ? html`<img src=${coverSrc} alt="" />` : html`<span class="scene solid" style=${sceneStyle(d.search.country)}></span>`}</span></span>
      <div class="w8-pills"><button class="btn sm surface" aria-pressed=${!cover ? 'true' : 'false'} onClick=${() => setCover(null)}>${t('pt_cover_home')}</button>
        <button class="btn sm surface" onClick=${async () => { const [fl] = await pickFiles(); if (fl) setCover(fl); }}><${Icon} n="image" cls="sm" />${t('pt_cover_up')}</button></div>
    </div>
    <label class="pt9-f"><span>${t('pt_name')}</span><input class="e-input" value=${f.title} maxlength="80" placeholder=${t('pt_name_ph')} onInput=${up('title')} /></label>
    <label class="pt9-f"><span>${t('pt_date')}</span><input class="e-input" type="date" value=${f.day} min=${hmToday()} onInput=${up('day')} /></label>
    <div class="pt9-row2">
      <label class="pt9-f"><span>${t('pt_time')}</span><input class="e-input" type="time" value=${f.time} onInput=${up('time')} /></label>
      <label class="pt9-f"><span>${t('pt_end')}</span><input class="e-input" type="time" value=${f.end} onInput=${up('end')} /></label>
    </div>
    <label class="pt9-f"><span>${t('pt_theme')}</span><input class="e-input" value=${f.theme} maxlength="80" placeholder=${t('pt_theme_ph')} onInput=${up('theme')} /></label>
    <p class="section">${t('pt_vibe')}</p>
    <div class="w3-chips" role="group">${['chill', 'dance', 'dinner', 'pool', 'games', 'sunset'].map((k) => pill('vibe', k, t('pt_v_' + k)))}</div>
    <div class="opt pt9-cap"><span class="grow">${t('pt_cap')}<small>${f.capacity ? '' : t('pt_cap_none')}</small></span>
      <span class="stepper"><button aria-label="−" disabled=${!f.capacity} onClick=${() => setF({ ...f, capacity: f.capacity && f.capacity > 2 ? f.capacity - 2 : null })}><${Icon} n="minus" cls="sm" /></button><b>${f.capacity ?? '∞'}</b>
        <button aria-label="+" disabled=${(f.capacity ?? 0) >= 300} onClick=${() => setF({ ...f, capacity: Math.min(300, (f.capacity ?? 8) + 2) })}><${Icon} n="plus" cls="sm" /></button></span></div>
    <div class="card grp"><${Toggle} on=${f.plus_one} label=${t('pt_plus')} onChange=${(x) => setF({ ...f, plus_one: x })} /></div>
    <p class="section">${t('pt_byob')}</p>
    <div class="w3-chips" role="group">${pill('byob', true, t('pt_byob_y'))}${pill('byob', false, t('pt_byob_n'))}${pill('byob', null, t('pt_byob_0'))}</div>
    <label class="pt9-f"><span>${t('pt_dress')}</span><input class="e-input" value=${f.dress_code} maxlength="60" placeholder=${t('pt_dress_ph')} onInput=${up('dress_code')} /></label>
    <label class="pt9-f"><span>${t('pt_note')}</span><textarea class="e-input" rows="2" maxlength="300" placeholder=${t('pt_note_ph')} onInput=${up('note')}>${f.note}</textarea></label>
    <p class="section pt9-secret"><${Icon} n="lock" cls="xs" />${t('pt_secret')}</p>
    <label class="pt9-f"><span>${t('pt_addr')}</span><input class="e-input" value=${f.address} maxlength="200" placeholder=${t('pt_addr_ph')} onInput=${up('address')} /></label>
    <label class="pt9-f"><span>${t('pt_how')}</span><input class="e-input" value=${f.how_to} maxlength="300" placeholder=${t('pt_how_ph')} onInput=${up('how_to')} /></label>
    <div class="card grp"><${Toggle} on=${f.wifi} label=${t('pt_wifi')} onChange=${(x) => setF({ ...f, wifi: x })} /></div>
    <button class="btn accent block big pt9-save" disabled=${busy || !f.title.trim() || !f.day || !f.time} onClick=${save}>${p ? t('pt_save') : t('pt_create')}</button>
    ${p && p.status !== 'cancelled' && html`<button class="btn ghost block" onClick=${cancelParty}>${t('pt_cancel_party')}</button>`}
  </main>`;
}

// ---- evening Home: tonight's event or party as the hero, leave-by, who goes, "Я выезжаю" / "Опаздываю"
export function useEvening() {
  const d = D();
  const [v, setV] = useState(null);
  useEffect(() => {
    let live = true;
    const f = () => api('/app/api/evening?s=' + encodeURIComponent(d.search.id)).then((j) => live && setV(j)).catch(() => live && setV({ failed: true }));
    f();
    const tm = setInterval(f, 5 * 60e3);
    return () => { live = false; clearInterval(tm); };
  }, [d.search.id, AF.rev, PT.rev]);
  return v;
}
/** Show the evening hero: something tonight that starts within 6 h (or is running), from 15:00 local. */
export const eveningOn = (v) => !!v?.tonight && (v.local_min >= 15 * 60 || (v.tonight.minutes_left != null && v.tonight.minutes_left <= 360));
export function EveningHero({ v }) {
  const d = D();
  const x = v.tonight;
  const [went, setWent] = useState(false);
  const party = x.kind === 'party';
  const ms = (x.who ?? []).map(memberById).filter(Boolean);
  const photo = photoUrl(x.photo) ?? (party ? photosOf(homeListing())[0] : null);
  const start = ptHM(x.starts_at);
  const left = x.minutes_left;
  const title = party ? x.title : afTitle({ title: x.title, title_en: x.title_en });
  const line = party ? t('ev_party_at', { t: start }) : x.late ? t('ev_leave_late', { t: hm(x.leave_at) }) : left != null && left <= 5 ? t('ev_leave_now') : x.leave_at ? t('ev_leave_at', { t: hm(x.leave_at) }) : title;
  const go2 = () => go(party ? sp('party', x.party_id) : sp('event', x.key));
  const leaving = async () => {
    hap.impact();
    try { const j = await api('/app/api/evening-leaving', { search_id: d.search.id, key: x.key }); setWent(true); toast(j.already ? t('ev_gone') : t('ev_go_sent', { n: j.notified })); } catch { toast(t('err_generic')); }
  };
  const inTxt = left == null ? null : left < 0 ? null : left < 60 ? t('ev_in_min', { n: left }) : t('ev_in_h', { n: fmtNum(Math.round(left / 6) / 10) });
  return html`<section class="w8-hero hm8 hm8-night ev9">
    <${BigWord} text=${t('ev_word')} />
    <div class="hm8-stage ev9-stage">
      <button class="frame hm8-frame" aria-label=${title} onClick=${go2}><span class="in">${photo ? html`<img src=${photo} alt="" decoding="async" />` : html`<span class="float-none" style=${sceneStyle(d.search.country)}></span>`}</span></button>
      ${!party && x.leave_at && html`<${Sticker} text=${t('ev_leave_st', { t: hm(x.leave_at) })} cls="lime" style="right:2%;top:-10%;--r:-12deg" />`}
      ${party && html`<${Sticker} text=${t('pt_at_home')} style="right:2%;top:-10%;--r:-12deg" />`}
      <${AniStickers} ms=${ms.slice(0, 3)} size=${52} pos=${['left:-3%;bottom:-12%', 'left:13%;bottom:-16%', 'left:29%;bottom:-12%']} />
    </div>
    <p class="kicker hm8-over">${title}${x.place ? ' · ' + afPlace({ place: { name: x.place } }) : ''}</p>
    <${Typed} lines=${[line]} />
    <p class="w8-sub">${party ? [t('pt_going_n', { n: x.counts?.heads ?? 0 }), x.theme].filter(Boolean).join(' · ') : [x.ride != null ? t(x.rush ? 'ev_ride_rush' : 'ev_ride', { n: x.ride }) : null, x.booking_status ? t('af_st_' + x.booking_status) : null].filter(Boolean).join(' · ')}</p>
    <div class="w8-pills">
      ${party ? html`<button class="btn accent" onClick=${go2}>${t('pt_title')}</button>`
        : html`<button class="btn accent" disabled=${went} onClick=${leaving}><${Icon} n="bike" cls="sm" />${went ? t('ev_gone') : t('ev_go')}</button>
          ${x.can_late && html`<button class="btn surface" onClick=${() => openSheet('ev_late', x)}><${Icon} n="hourglass" cls="sm" />${t('ev_late')}</button>`}`}
      <button class="round" aria-label=${t('sh_title')} onClick=${() => (party ? go2() : openSheet('share', { kind: 'event', o: { id: x.event_id, occ: x.occ, title: x.title, title_en: x.title_en, starts_at: x.starts_at, photo: x.photo, place: { name: x.place } } }))}><${Icon} n="share" /></button>
    </div>
    <div class="w8-stats">
      <button onClick=${go2}><small>${t('ev_k_start')}</small><b>${start}</b></button>
      ${!party && inTxt && html`<button onClick=${go2}><small>${t('ev_k_left')}</small><b>${inTxt}</b></button>`}
      ${ms.length > 0 && html`<button onClick=${go2}><small>${t('ev_k_who')}</small><b>${ms.map((m) => (m.user_id === d.user.id ? t('af_you') : firstName(m.name))).join(', ')}</b></button>`}
    </div>
  </section>`;
}
export function EvLateSheet({ x }) {
  const d = D();
  const send = async (n) => {
    try { await api('/app/api/evening-late', { search_id: d.search.id, booking_id: x.booking_id, minutes: n }); hap.ok(); toast(t('ev_late_sent')); } catch { toast(t('err_generic')); }
    closeSheet();
  };
  return html`<h2>${t('ev_late_title')}</h2><p class="muted af-sheet-sub">${t('ev_late_sub')}</p>
    <div class="card grp">${[10, 15, 20, 30, 45].map((n) => html`<button key=${n} class="opt" onClick=${() => send(n)}><${Icon} n="hourglass" />${t('ev_late_min', { n })}</button>`)}</div>
    <button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
}

// ---- "Как было?" on the event page
export function EventFeedback({ o, onDone }) {
  const d = D();
  if (!canVoteRole(d.me.role)) return null;
  const startMs = Date.parse(o.starts_at);
  const went = o.mine.attended || ['booked', 'asked', 'attended'].includes(o.booking_status);
  if (!(went && startMs < Date.now()) && !o.mine.rating) return null;
  return html`<section class="fb9-box">
    <p class="section" style="margin-top:0">${o.mine.rating ? t('fb_you') : t('fb_q')}</p>
    ${!o.mine.rating && html`<p class="muted fb9-sub">${t('fb_sub')}</p>`}
    <${RateRow} cur=${o.mine.rating} note=${o.mine.note ?? ''} onSave=${async (r, note) => {
      try { await api('/app/api/event-rate', { search_id: d.search.id, event_id: o.id, occ: o.occ, rating: r, note }); hap.ok(); toast(t('fb_saved')); afReset(); onDone?.(); } catch { toast(t('err_generic')); }
    }} />
  </section>`;
}

// ---- share: canvas card in the ticket style + the public link (event page / party invite) + Telegram
export async function shareCardPng(x) {
  await document.fonts?.ready;
  await Promise.all(['800 64px "Inter Tight"', '500 30px "Inter Tight"'].map((f) => document.fonts?.load(f).catch(() => null)));
  const photo = await loadImg(x.photo);
  const W = 1080, H = 1350;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const font = (w, s) => `${w} ${s}px "Inter Tight", Inter, -apple-system, Helvetica, Arial, sans-serif`;
  ctx.fillStyle = x.ground; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = x.dots;
  for (let yy = 27; yy < H; yy += 54) for (let xx = 27; xx < W; xx += 54) { ctx.beginPath(); ctx.arc(xx, yy, 3, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = x.ink; ctx.font = font(800, 64); ctx.fillText('hunt', 72, 128);
  // the ticket: paper, black frame with the photo, perforation, stub
  ctx.save();
  ctx.translate(W / 2, 700); ctx.rotate(-0.03);
  const TW = 860, TH = 1000, tx = -TW / 2, ty = -TH / 2 + 30;
  ctx.shadowColor = 'rgba(20,16,10,.32)'; ctx.shadowBlur = 70; ctx.shadowOffsetY = 40;
  ctx.fillStyle = '#F5F4F0'; rrect(ctx, tx, ty, TW, TH, 72); ctx.fill();
  ctx.shadowColor = 'transparent';
  const fx = tx + 30, fy = ty + 30, fw = TW - 60, fh = 600;
  ctx.fillStyle = '#151413'; rrect(ctx, fx, fy, fw, fh, 56); ctx.fill();
  ctx.save(); rrect(ctx, fx + 24, fy + 24, fw - 48, fh - 48, 38); ctx.clip();
  if (photo) { const sc = Math.max((fw - 48) / photo.naturalWidth, (fh - 48) / photo.naturalHeight); const w = photo.naturalWidth * sc, h = photo.naturalHeight * sc; ctx.drawImage(photo, fx + 24 + (fw - 48 - w) / 2, fy + 24 + (fh - 48 - h) / 2, w, h); }
  else { ctx.fillStyle = '#2A2826'; ctx.fillRect(fx, fy, fw, fh); }
  ctx.restore();
  const py = fy + fh + 34;
  ctx.strokeStyle = 'rgba(21,20,19,.25)'; ctx.lineWidth = 4; ctx.setLineDash([16, 14]); ctx.beginPath(); ctx.moveTo(tx + 50, py); ctx.lineTo(tx + TW - 50, py); ctx.stroke(); ctx.setLineDash([]);
  ctx.save(); rrect(ctx, tx, ty, TW, TH, 72); ctx.clip(); ctx.fillStyle = x.ground; for (const sx of [tx, tx + TW]) { ctx.beginPath(); ctx.arc(sx, py, 26, 0, Math.PI * 2); ctx.fill(); } ctx.restore();
  ctx.fillStyle = '#5F5C56'; ctx.font = font(500, 30); ctx.fillText(x.kicker, tx + 56, py + 70);
  ctx.fillStyle = '#151413'; ctx.font = font(800, 76);
  const tl = wrapLines(ctx, x.title, TW - 112).slice(0, 2);
  tl.forEach((s, i) => ctx.fillText(s, tx + 52, py + 154 + i * 76));
  ctx.font = font(600, 32); ctx.fillText(x.meta, tx + 56, py + 170 + tl.length * 76);
  ctx.restore();
  if (x.sticker) {
    ctx.save(); ctx.translate(W - 190, 300); ctx.rotate(0.21);
    ctx.fillStyle = '#F2E33A'; ctx.beginPath(); ctx.arc(0, 0, 112, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#151413'; ctx.font = font(800, 38); ctx.textAlign = 'center';
    wrapLines(ctx, x.sticker, 180).slice(0, 2).forEach((s, i, a) => ctx.fillText(s, 0, 14 - (a.length - 1) * 22 + i * 44));
    ctx.restore();
  }
  return new Promise<any>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('png'))), 'image/png'));
}
export function ShareSheet({ arg }) {
  const d = D();
  const party = arg.kind === 'party';
  const [url, setUrl] = useState(party ? arg.p.link : null);
  const [img, setImg] = useState(null);
  const blob = useRef(null);
  const o = arg.o, p = arg.p;
  const title = party ? p.title : afTitle(o);
  const when = party ? ptWhen(p) : `${afDayLong(o.occ ?? String(o.starts_at).slice(0, 10))} · ${afHM(o)}`;
  useEffect(() => {
    let live = true;
    if (!party) api('/app/api/event-share', { search_id: d.search.id, event_id: o.id, occ: o.occ ?? null }).then((j) => live && setUrl(j.url)).catch(() => toast(t('err_generic')));
    const ground = cssVar('--ground') || '#FF8A5B';
    shareCardPng({ ground, dots: 'rgba(21,20,19,.10)', ink: cssVar('--ink') || '#151413', photo: party ? ptCover(p) : photoUrl(o.photo), title, meta: party ? `${ptHM(p.starts_at)} · ${t('pt_going_n', { n: p.counts?.heads ?? 0 })}` : [afHM(o), afPlace(o)].filter(Boolean).join(' · '),
      kicker: party ? `${t('pt_at_home')} · ${afDayLong(ptDay(p.starts_at))}` : [afDayLong(o.occ ?? String(o.starts_at).slice(0, 10)), afPrice(o)].filter(Boolean).join(' · '), sticker: party ? t('pt_at_home') : o.recurring ? (LANG === 'en' ? o.recurring.en : o.recurring.ru) : t('w8_going') })
      .then((b) => { if (!live) return; blob.current = b; setImg(URL.createObjectURL(b)); }).catch(() => null);
    return () => { live = false; };
  }, []);
  const text = t(party ? 'sh_text_pt' : 'sh_text_ev', { t: title, w: when });
  const saveImg = async () => {
    const b = blob.current;
    if (!b) return;
    const file = new File([b], 'hunt.png', { type: 'image/png' });
    try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text: url ? `${text} ${url}` : text }); return; } } catch { return; }
    const a = document.createElement('a'); a.href = img; a.download = 'hunt.png'; a.click();
  };
  return html`<h2>${t('sh_title')}</h2>
    <div class="sh9-prev">${img ? html`<img src=${img} alt=${title} />` : html`<div class="skeleton" style="height:100%"></div>`}</div>
    <p class="muted af-sheet-note">${t(party ? 'sh_party_note' : 'sh_ev_note')}</p>
    <div class="w8-pills sh9-btns">
      <button class="btn accent" disabled=${!url} onClick=${() => shareTg(url, text)}><${Icon} n="send" cls="sm" />${t('sh_tg')}</button>
      <button class="btn surface" disabled=${!url} onClick=${() => copyText(url)}><${Icon} n="copy" cls="sm" />${t('sh_copy')}</button>
      <button class="btn surface" disabled=${!img} onClick=${saveImg}><${Icon} n="download" cls="sm" />${t('sh_img')}</button>
    </div>
    <button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
}
/** Map "Вечер": tapping a pin opens the ticket in a sheet. */
export function EvTicketSheet({ o }) {
  return html`<div class="ev9-sheet"><${TicketBig} o=${o} onBook=${(x) => { closeSheet(); afBook(x); }} /></div>
    <button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
}
