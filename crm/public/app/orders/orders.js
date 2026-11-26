// Split from app.js (wave 11): see the section comment below.
import { settingsRow } from '../../access.js';
import { AgentTokenSheet, agentSettingsRow } from '../../agent.js';
import { Sessions } from '../../desk.js';
import { AfPrefsSheet, EventBookSheet } from '../afisha/afisha.js';
import { EvLateSheet, EvTicketSheet, PartyItemSheet, ShareSheet } from '../afisha/parties.js';
import { api, linkKey, load, setThemePref, themePref } from '../core/api.js';
import { D, agentAwayHours, canVoteRole, listingById, markStyle, memberById, viewingsByDay, votersN } from '../core/data.js';
import { TG, inTG, reduceMotion, tg } from '../core/env.js';
import { LOC, SYM, asDate, channelName, dfmt, firstName, fmtDM, fmtTime, initial, money } from '../core/format.js';
import { LANG, STR, applyLang, cap, pl, t } from '../core/i18n.js';
import { go, openLink, sp } from '../core/routing.js';
import { S, closeSheet, emit, hap, openSheet, toast, useStore } from '../core/store.js';
import { BikeSheet } from '../home/bikes.js';
import { addDays } from '../home/calendar.js';
import { AddDocSheet, DocReqSheet, Toggle } from '../home/docs.js';
import { ItemSheet } from '../home/dossier.js';
import { GuestContactSheet } from '../home/guests.js';
import { askConfirm, copyText, hm, isGuest, msgCard, skel, telLink } from '../home/helpers.js';
import { hmDays, hmToday, homeMode } from '../home/homemode.js';
import { HomeNameSheet, IssueSheet, roleLabelHC } from '../home/house.js';
import { AddExpense, ExpenseSheet, SharesSheet, parseAmount } from '../home/money.js';
import { MoStepSheet } from '../home/moveout.js';
import { OnsiteNoteSheet } from '../home/onsite.js';
import { DirAddSheet, DirEntrySheet, DirGroupSheet, NoteSheet } from '../home/people.js';
import { MoneyModeSheet, RoomSheet } from '../home/rooms.js';
import { setSurfPref } from '../home/surf.js';
import { VisaSheet } from '../home/visa.js';
import { FloodNoteSheet } from '../places/flood.js';
import { AnchorAddSheet, AnchorSheet, SpotAreaSheet, SpotLinkSheet, SpotSheet } from '../places/places.js';
import { channelLink } from '../screens/chats.js';
import { StageSheet } from '../screens/path.js';
import { inviteFriends } from '../screens/today.js';
import { UsefulAddSheet } from '../screens/useful.js';
import { Av, ICONS, Icon } from '../ui/icons.js';
import { BackRound, BigWord, Nav, Sticker, Typed } from '../ui/pieces.js';
import { html, useEffect, useRef, useState } from 'https://unpkg.com/htm@3.1.1/preact/standalone.module.js';

// ---------------------------------------------------------------- wave 10 · Заказы (mockups design/mockup-v5: A shop, B item, C receipt, D check, E status, H services)
Object.assign(STR.ru, {
  or_title: 'Заказы', or_fruit: 'Фрукты', or_fish: 'Рыба', or_services: 'Услуги', or_q_fruit: 'Что привезти?', or_q_fish: 'Что на ужин?', or_q_other: 'Что привезти?', or_w_fruit: 'Рынок', or_w_fish: 'Рыба', or_w_other: 'Рынок',
  or_again: 'Как в прошлый раз', or_again_st: 'как в прошлый раз', or_usual: 'ваше обычное', or_usual_pop: 'ваше обычное и популярное', or_pop: 'популярное', or_search: 'Найти в прайсе', or_search_n: (n) => `${n} ${pl(n, 'позиция', 'позиции', 'позиций')} в прайсе`,
  or_none_found: 'Такого в прайсе нет. Можно спросить в пометке к заказу', or_items: (n) => `${n} ${pl(n, 'товар', 'товара', 'товаров')}`, or_collect: 'Собрать', or_check: 'Проверить', or_ask: 'цену узнаём', or_by_req: 'по запросу', or_unsure: 'уточнить', or_prices_at: 'цены от {d}',
  or_u_kg: 'за кг', or_u_pcs: 'за штуку', or_u_pack: 'за упаковку', or_u_bunch: 'за пучок', or_u_30pcs: 'за 30 шт', or_su_kg: 'за кг', or_su_pcs: '', or_su_pack: 'за уп', or_su_bunch: 'за пучок', or_su_30pcs: 'за 30 шт',
  or_pcs: 'шт', or_q_kg: '{n} кг', or_q_pcs: '{n}', or_q_pack: '{n} уп', or_q_bunch: '{n} пуч', or_q_30pcs: '{n} × 30', or_thou: 'тыс', or_mln: 'млн',
  or_g_water: 'Вода и газ', or_g_fruit: 'Фрукты', or_g_veg: 'Овощи', or_g_greens: 'Зелень и салаты', or_g_spice: 'Специи', or_g_egg: 'Яйца и тофу', or_g_grocery: 'Бакалея', or_g_fish: 'Рыба', or_g_prawn: 'Креветки', or_g_squid: 'Кальмар и осьминог',
  or_g_crab: 'Крабы и лобстеры', or_g_shell: 'Ракушки', or_g_meat: 'Мясо', or_g_cheese: 'Сыр и прочее', or_g_other: 'Другое', or_less: 'Меньше', or_more: 'Больше', or_add: 'Добавить: {t}', or_remove: 'Убрать: {t}', or_removed: 'Убрали: {t}', or_open_item: 'Открыть: {t}',
  or_last_n: 'в прошлый раз {n}', or_in_list: 'в прайсе: {t}', or_ask_t: 'Цену узнаём', or_ask_sub: 'Спросим прямо в заказе. Как ответят, впишете сумму', or_unsure_sub: 'В прайсе опечатка, цену уточняем', or_gone: 'Этого больше нет в прайсе',
  or_receipt: 'Чек', or_delivery: 'доставка', or_free: 'бесплатно', or_free_left: 'ещё {x} до бесплатной доставки', or_free_ok: 'доставка бесплатно', or_ask_n: (n) => `+ ${n} ${pl(n, 'позиция', 'позиции', 'позиций')}: цену узнаём`, or_unsure_n: (n) => `${n} ${pl(n, 'цену', 'цены', 'цен')} уточняем`, or_ask_dl: 'узнаём',
  or_pay_on: '{u}, платим на месте', or_paid: '{u}, заплачено', or_empty_t: 'Пока пусто', or_empty_s: 'Выберите что-нибудь на прилавке', or_to_shop: 'К прилавку', or_clear: 'Очистить', or_clear_q: 'Убрать всё из корзины?', or_changed: 'Заказ изменился, посмотрите ещё раз',
  or_ok_q: 'Всё так?', or_ok_w: 'Да?', or_via: '{s}, {c}', or_today: 'Сегодня', or_tomorrow: 'Завтра', or_any: 'Когда получится', or_by: 'к {t}', or_no_today: 'Сегодня уже поздно', or_addr: 'Добавить адрес дома', or_addr_sub: 'из гайда дома', or_note: 'Пометка', or_note_ph: 'Лучше по-английски: please call first', or_goods: 'товары',
  or_wa: 'Открыть WhatsApp', or_tgo: 'Открыть Telegram', or_copy: 'Скопировать текст', or_agent: 'Пусть агент отправит', or_agent_s: 'Через агента', or_self: 'Отправить нажмёте сами. Деньги отдадим курьеру', or_agent_ok: 'Черновик у владельца на одобрении', or_send_first: 'Выберите товары',
  or_s_opened: 'Отправили?', or_s_draft: 'Ждёт одобрения', or_s_sent: 'Ждём ответа', or_s_confirmed: 'Подтвердили', or_s_delivered: 'Привезли', or_s_cancelled: 'Отменён', or_s_basket: 'Собираем',
  or_w_opened: 'Ждём', or_w_draft: 'Ждём', or_w_sent: 'Ждём', or_w_confirmed: 'Едет', or_w_delivered: 'Чек', or_w_cancelled: 'Нет', or_l_opened: 'Сообщение ушло?', or_l_draft: 'Агент отправит после одобрения', or_l_sent: 'Ждём ответа от {s}', or_l_confirmed: 'Везут из {s}', or_l_delivered: 'Привезли из {s}', or_l_cancelled: 'Заказ отменён',
  or_sent_y: 'Отправил', or_sent_n: 'Не отправил', or_back_basket: 'Вернули в корзину', or_st_sent: 'Отправлен', or_st_open: 'Открыли WhatsApp', or_st_conf: 'Подтвердили', or_st_conf_x: 'Подтвердили, {x}', or_st_dl: 'Привезли', or_by_agent: 'через агента', or_by_who: '{n}', or_wait_ans: 'цена и время, когда ответят',
  or_conf_by: '{n}', or_conf_agent: 'ответ прочитал агент', or_cash: 'платим наличными {x}', or_cash0: 'платим наличными', or_confirm: 'Ответили', or_fix: 'Изменить сумму', or_delivered: 'Привезли, оплатил', or_write: 'Написать', or_cancel: 'Отменить заказ', or_cancel_q: 'Отменить заказ? Если сообщение ушло, напишите и поставщику', or_cancelled: 'Заказ отменён',
  or_conf_t: 'Что ответили?', or_conf_sum: 'Сумма с доставкой', or_conf_time: 'Во сколько будут', or_paid_t: 'Сколько заплатили?', or_paid_hint: 'Запишем одной тратой в Деньги, продукты', or_paid_toast: 'Записали в Деньги', or_already: 'Уже отмечено', or_save: 'Сохранить', or_text: 'Что отправили', or_list: 'Что в заказе',
  or_home: 'Заказать', or_home_n: 'Заказать · {n}', or_tk_opened: 'Отправили заказ?', or_tk_draft: 'Заказ ждёт одобрения', or_tk_sent: 'Ждём ответа', or_tk_confirmed: 'Заказ едет', or_tk_x: '{x} наличными', or_tk_by: 'к {t}', or_line_by: '{s}: будут к {t}', or_more_sub: 'фрукты, рыба, услуги', or_more_active: 'заказ в пути', or_hist: 'История', or_active: 'Сейчас', or_hist_none: 'Здесь будут чеки', or_no_sup: 'Поставщиков пока нет', or_no_sup_s: 'Пришлите агенту прайс магазина, он добавит его сюда',
  or_in_basket: 'в корзине {n}', or_exp_open: 'В Деньгах', or_order_btn: 'Заказать', or_hours: 'работают {h}', or_x_today: 'сегодня', or_x_tomorrow: 'завтра',
  or_sv_w_cleaning: 'Чисто', or_sv_w_pool: 'Вода', or_sv_w: 'Дом', or_sv_next: '{n} будет {d}', or_sv_next_t: '{n} придёт {d}', or_sv_none: 'Пока никого', or_sv_none_s: 'Добавьте уборку, бассейн или массаж в контакты дома', or_sv_contacts: 'Контакты', or_sv_move: 'Перенести', or_sv_days0: 'дни не записаны', or_sv_rent: 'входит в аренду', or_sv_today: 'сегодня', or_sv_tomorrow: 'завтра',
  or_wd_acc: (n) => ['в воскресенье', 'в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу'][n], or_per_month: 'в месяц', or_per_week: 'в неделю', or_per_visit: 'за визит', or_per_once: 'разово', or_view_only: 'Только просмотр',
  or_pos: (n) => `${n} ${pl(n, 'позиция', 'позиции', 'позиций')}`, or_and: '{a} и {b}', or_and_more: '{a} и ещё {n}',
  or_rg_ready: 'приготовить', or_rg_exact: '{u}, от {a} до {b}', or_rg_kg: 'на вес, развес и рынок ±', or_rg_ask: 'без цены: {t}', or_rg_dl: 'доставка', or_rg_dl_free: 'доставка, от {x}', or_rg_learn: 'по прайсу, обычно {p} с доставкой',
  or_rg_miss: (n) => `+ ${n} ${pl(n, 'позиция', 'позиции', 'позиций')} без цены`, or_rg_w_list: 'по прайсу {x}', or_rg_w_kg: 'развес ±', or_rg_w_fee: 'доставка ≈ {x}', or_rg_w_learn: 'обычно {p} с доставкой',
  or_rg_paid_cash: 'заплатили наличными', or_rg_paid_transfer: 'заплатили переводом', or_rg_paid_card: 'заплатили картой', or_rg_paid: 'оплатили', or_rg_final: 'итог с доставкой',
  or_rg_from: 'ждали от {x}', or_rg_to: 'до {x}', or_rg_scale: 'ждали от {a} до {b}, вышло {x}', or_rg_in: 'в пределах ожидания', or_rg_more: 'больше ожидания на {x}', or_rg_less: 'меньше ожидания на {x}',
  or_rg_learnt: 'Hunt запомнил', or_rg_usual: 'у этого поставщика обычно {p} к прайсу', or_rg_usual0: 'у этого поставщика обычно ровно по прайсу', or_rg_this: 'в этот раз прайс был {x}',
});
Object.assign(STR.en, {
  or_title: 'Orders', or_fruit: 'Fruit', or_fish: 'Fish', or_services: 'Services', or_q_fruit: 'What to bring?', or_q_fish: 'What’s for dinner?', or_q_other: 'What to bring?', or_w_fruit: 'Market', or_w_fish: 'Fish', or_w_other: 'Market',
  or_again: 'Same as last time', or_again_st: 'same as last time', or_usual: 'your usual', or_usual_pop: 'your usual and popular', or_pop: 'popular', or_search: 'Search the price list', or_search_n: (n) => `${n} ${pl(n, 'item', 'items')} on the list`,
  or_none_found: 'Not on the list. You can ask in the order note', or_items: (n) => `${n} ${pl(n, 'item', 'items')}`, or_collect: 'Review', or_check: 'Check', or_ask: 'asking the price', or_by_req: 'on request', or_unsure: 'to confirm', or_prices_at: 'prices of {d}',
  or_u_kg: 'per kg', or_u_pcs: 'each', or_u_pack: 'per pack', or_u_bunch: 'per bunch', or_u_30pcs: 'per 30', or_su_kg: 'per kg', or_su_pcs: '', or_su_pack: 'per pack', or_su_bunch: 'a bunch', or_su_30pcs: 'per 30',
  or_pcs: 'pcs', or_q_kg: '{n} kg', or_q_pcs: '{n}', or_q_pack: '{n} pk', or_q_bunch: '{n} bn', or_q_30pcs: '{n} × 30', or_thou: 'k', or_mln: 'M',
  or_g_water: 'Water and gas', or_g_fruit: 'Fruit', or_g_veg: 'Vegetables', or_g_greens: 'Greens and salads', or_g_spice: 'Spices', or_g_egg: 'Eggs and tofu', or_g_grocery: 'Groceries', or_g_fish: 'Fish', or_g_prawn: 'Prawns', or_g_squid: 'Squid and octopus',
  or_g_crab: 'Crab and lobster', or_g_shell: 'Shellfish', or_g_meat: 'Meat', or_g_cheese: 'Cheese and more', or_g_other: 'Other', or_less: 'Less', or_more: 'More', or_add: 'Add {t}', or_remove: 'Remove {t}', or_removed: 'Removed: {t}', or_open_item: 'Open {t}',
  or_last_n: 'last time {n}', or_in_list: 'on the list: {t}', or_ask_t: 'Asking the price', or_ask_sub: 'We ask in the order. Once they answer, type the sum', or_unsure_sub: 'A typo on the list, we confirm the price', or_gone: 'No longer on the list',
  or_receipt: 'Receipt', or_delivery: 'delivery', or_free: 'free', or_free_left: '{x} more for free delivery', or_free_ok: 'free delivery', or_ask_n: (n) => `+ ${n} ${pl(n, 'item', 'items')}: asking the price`, or_unsure_n: (n) => `${n} ${pl(n, 'price', 'prices')} to confirm`, or_ask_dl: 'asking',
  or_pay_on: '{u}, paid on delivery', or_paid: '{u}, paid', or_empty_t: 'Nothing here yet', or_empty_s: 'Pick something at the counter', or_to_shop: 'To the counter', or_clear: 'Clear', or_clear_q: 'Remove everything from the basket?', or_changed: 'The order has changed, take another look',
  or_ok_q: 'All good?', or_ok_w: 'Yes?', or_via: '{s}, {c}', or_today: 'Today', or_tomorrow: 'Tomorrow', or_any: 'Any time', or_by: 'by {t}', or_no_today: 'Too late for today', or_addr: 'Add the home address', or_addr_sub: 'from the house guide', or_note: 'Note', or_note_ph: 'In English: please call first', or_goods: 'goods',
  or_wa: 'Open WhatsApp', or_tgo: 'Open Telegram', or_copy: 'Copy the text', or_agent: 'Let the agent send it', or_agent_s: 'Via agent', or_self: 'You press send yourself. We pay the courier', or_agent_ok: 'The draft is waiting for the owner', or_send_first: 'Pick some items',
  or_s_opened: 'Sent?', or_s_draft: 'Waiting for approval', or_s_sent: 'Waiting for an answer', or_s_confirmed: 'Confirmed', or_s_delivered: 'Delivered', or_s_cancelled: 'Cancelled', or_s_basket: 'Collecting',
  or_w_opened: 'Wait', or_w_draft: 'Wait', or_w_sent: 'Wait', or_w_confirmed: 'Soon', or_w_delivered: 'Done', or_w_cancelled: 'No', or_l_opened: 'Did the message go out?', or_l_draft: 'The agent sends it once approved', or_l_sent: 'Waiting for {s}', or_l_confirmed: 'Coming from {s}', or_l_delivered: 'Delivered from {s}', or_l_cancelled: 'Order cancelled',
  or_sent_y: 'Sent', or_sent_n: 'Not sent', or_back_basket: 'Back in the basket', or_st_sent: 'Sent', or_st_open: 'WhatsApp opened', or_st_conf: 'Confirmed', or_st_conf_x: 'Confirmed, {x}', or_st_dl: 'Delivered', or_by_agent: 'by the agent', or_by_who: '{n}', or_wait_ans: 'price and time once they answer',
  or_conf_by: '{n}', or_conf_agent: 'the agent read the answer', or_cash: 'cash, {x}', or_cash0: 'cash on delivery', or_confirm: 'They answered', or_fix: 'Change the sum', or_delivered: 'Delivered, I paid', or_write: 'Write', or_cancel: 'Cancel the order', or_cancel_q: 'Cancel the order? If the message went out, tell the supplier too', or_cancelled: 'Order cancelled',
  or_conf_t: 'What did they say?', or_conf_sum: 'Total with delivery', or_conf_time: 'When they come', or_paid_t: 'How much did you pay?', or_paid_hint: 'One expense in Money, groceries', or_paid_toast: 'Added to Money', or_already: 'Already marked', or_save: 'Save', or_text: 'The message', or_list: 'In the order',
  or_home: 'Order', or_home_n: 'Order · {n}', or_tk_opened: 'Was the order sent?', or_tk_draft: 'Order waiting for approval', or_tk_sent: 'Waiting for an answer', or_tk_confirmed: 'Order on its way', or_tk_x: '{x} in cash', or_tk_by: 'by {t}', or_line_by: '{s}: here by {t}', or_more_sub: 'fruit, fish, services', or_more_active: 'an order on its way', or_hist: 'History', or_active: 'Now', or_hist_none: 'Receipts will live here', or_no_sup: 'No suppliers yet', or_no_sup_s: 'Send the agent a shop’s price list and it lands here',
  or_in_basket: '{n} in the basket', or_exp_open: 'In Money', or_order_btn: 'Order', or_hours: 'open {h}', or_x_today: 'today', or_x_tomorrow: 'tomorrow',
  or_sv_w_cleaning: 'Clean', or_sv_w_pool: 'Pool', or_sv_w: 'Home', or_sv_next: '{n} comes {d}', or_sv_next_t: '{n} comes {d}', or_sv_none: 'Nobody yet', or_sv_none_s: 'Add cleaning, pool or massage to the house contacts', or_sv_contacts: 'Contacts', or_sv_move: 'Move it', or_sv_days0: 'no days noted', or_sv_rent: 'included in the rent', or_sv_today: 'today', or_sv_tomorrow: 'tomorrow',
  or_wd_acc: (n) => ['on Sunday', 'on Monday', 'on Tuesday', 'on Wednesday', 'on Thursday', 'on Friday', 'on Saturday'][n], or_per_month: 'a month', or_per_week: 'a week', or_per_visit: 'a visit', or_per_once: 'once', or_view_only: 'View only',
  or_pos: (n) => `${n} ${pl(n, 'item', 'items')}`, or_and: '{a} and {b}', or_and_more: '{a} and {n} more',
  or_rg_ready: 'have ready', or_rg_exact: 'from {a} to {b}', or_rg_kg: 'by weight, market prices ±', or_rg_ask: 'no price: {t}', or_rg_dl: 'delivery', or_rg_dl_free: 'delivery, from {x}', or_rg_learn: 'list price, usually {p} with delivery',
  or_rg_miss: (n) => `+ ${n} ${pl(n, 'item', 'items')} without a price`, or_rg_w_list: 'list price {x}', or_rg_w_kg: 'weights ±', or_rg_w_fee: 'delivery ≈ {x}', or_rg_w_learn: 'usually {p} with delivery',
  or_rg_paid_cash: 'paid in cash', or_rg_paid_transfer: 'paid by transfer', or_rg_paid_card: 'paid by card', or_rg_paid: 'paid', or_rg_final: 'total with delivery',
  or_rg_from: 'expected from {x}', or_rg_to: 'to {x}', or_rg_scale: 'expected {a} to {b}, it came to {x}', or_rg_in: 'within what we expected', or_rg_more: '{x} more than expected', or_rg_less: '{x} less than expected',
  or_rg_learnt: 'Hunt remembers', or_rg_usual: 'this supplier usually comes to {p} vs the list', or_rg_usual0: 'this supplier usually matches the list', or_rg_this: 'this time the list said {x}',
});
Object.assign(ICONS, {
  basket: '<path d="m15 11-1 9"/><path d="m19 11-4-7"/><path d="M2 11h20"/><path d="m3.5 11 1.6 7.4a2 2 0 0 0 2 1.6h9.8a2 2 0 0 0 2-1.6l1.7-7.4"/><path d="M4.5 15.5h15"/><path d="m5 11 4-7"/><path d="m9 11 1 9"/>',
  repeat: '<path d="m2 9 3-3 3 3"/><path d="M13 18H7a2 2 0 0 1-2-2V6"/><path d="m22 15-3 3-3-3"/><path d="M11 6h6a2 2 0 0 1 2 2v10"/>',
  'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
});

// ---- data: the catalog comes from its own endpoint once per project; baskets and orders refresh on their own (other members add too)
export const OR = { sid: null, v: null, items: null, price_at: {}, pend: new Map(), at: 0, loading: null };
export const ordSid = () => D()?.search?.id;
export const ordReset = () => { if (OR.sid !== ordSid()) { OR.sid = ordSid(); OR.v = null; OR.items = null; OR.pend.clear(); OR.at = 0; } };
export function ordApply(j) {
  OR.v = { suppliers: j.suppliers ?? [], baskets: j.baskets ?? [], active: j.active ?? [], history: j.history ?? [], sets: j.sets ?? [] };
  OR.at = Date.now();
  if (j.items) {
    OR.items = {};
    for (const s of OR.v.suppliers) OR.items[s.id] = (j.items[s.id] ?? []).map((a) => Object.fromEntries(j.keys.map((k, i) => [k, a[i]]))).map((x) => ({ ...x, sup: s.id, unsure: !!(x.flags & 1), req: !!(x.flags & 2) }));
    OR.price_at = j.price_at ?? {};
    OR.usual = j.usual_min ?? 2;
  }
  emit();
}
export async function ordLoad(shop = false) {
  ordReset();
  const sid = OR.sid;
  const j = await api(`/app/api/${shop ? 'shop' : 'orders'}?s=${encodeURIComponent(sid)}`);
  if (OR.sid === sid) ordApply(j);
}
/** Orders (Home, status, history); `shop` also needs the catalog. Refreshes when the app comes back and every 25 s while open. */
export function useOrders(shop = false) {
  useStore();
  ordReset();
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    const get = (full) => ordLoad(full).then(() => live && setErr(false)).catch(() => live && !OR.v && setErr(true));
    if (shop && !OR.items) get(true); else if (!OR.v || Date.now() - OR.at > 4000) get(false);
    const tick = () => { if (!document.hidden && !OR.pend.size) get(shop && !OR.items); };
    const tm = setInterval(tick, 25e3);
    document.addEventListener('visibilitychange', tick);
    if (inTG) tg(() => TG.onEvent('activated', tick));
    return () => { live = false; clearInterval(tm); document.removeEventListener('visibilitychange', tick); if (inTG) tg(() => TG.offEvent('activated', tick)); };
  }, [shop, OR.sid]);
  return { v: OR.v, items: OR.items, err: err && !(shop ? OR.items : OR.v) };
}
export const ordSup = (id) => OR.v?.suppliers.find((s) => s.id === id) ?? null;
export const ordItem = (id) => { for (const l of Object.values(OR.items ?? {})) { const x = l.find((i) => i.id === id); if (x) return x; } return null; };
export const ordLast = (sup) => (OR.v?.history ?? []).filter((o) => o.status === 'delivered' && (!sup || o.supplier_id === sup)).sort((a, b) => String(b.delivered_at).localeCompare(String(a.delivered_at)))[0] ?? null;
export const ordName = (x) => (LANG === 'ru' ? x?.ru ?? x?.name_ru : x?.en ?? x?.name_en) ?? '';
/** "Кальмар целый (чуми манис)" → "Кальмар целый". */
export const ordShort = (x) => ordName(x).replace(/\s*\(.*?\)/g, '');
/** The one word behind the toy: the noun ("Красный снэппер" → "Снэппер", "Red snapper, whole" → "Snapper"). */
export function ordWord(x) {
  const w = ordShort(x).split(/[,\d]/)[0].trim().split(/\s+/);
  return cap(LANG === 'ru' ? (w.length > 1 && /(ый|ий|ой|ая|яя|ое|ее|ые|ие)$/.test(w[0]) ? w[1] : w[0]) : w[w.length - 1]);
}
export const ordCan = () => canVoteRole(D()?.me?.role) && !D()?.path?.closed;
/** The basket of a supplier with the taps that have not reached the server yet. */
export function ordBasket(sup) {
  const b = OR.v?.baskets.find((x) => x.supplier_id === sup);
  let lines = (b?.lines ?? []).map((l) => (OR.pend.has(l.item_id) ? { ...l, qty: OR.pend.get(l.item_id).qty } : l));
  for (const [id, p] of OR.pend) {
    const it = ordItem(id);
    if (it?.sup === sup && !lines.some((l) => l.item_id === id)) lines.push({ item_id: id, qty: p.qty, by: D().user.id, unit: it.unit, step: it.step, toy: it.toy, grp: it.grp, name_id: it.name_id, name_ru: it.ru, name_en: it.en, price: it.price, unsure: it.unsure });
  }
  lines = lines.filter((l) => l.qty > 0);
  return { id: b?.id ?? null, supplier_id: sup, lines, ...ordTotals(lines) };
}
export function ordTotals(lines) {
  let sum = 0, unknown = 0, unsure = 0;
  for (const l of lines) { if (l.price == null) unknown++; else { sum += Math.round(l.qty * l.price); if (l.unsure) unsure++; } }
  return { sum, unknown, unsure, count: lines.length };
}
export const ordQty = (id) => OR.pend.get(id)?.qty ?? OR.v?.baskets.flatMap((b) => b.lines).find((l) => l.item_id === id)?.qty ?? 0;
/** Optimistic: the number changes at once, the server gets the last absolute quantity 350 ms after the last tap. */
export function ordSetQty(item, qty) {
  if (!ordCan()) { toast(t('or_view_only')); return; }
  const id = item.item_id ?? item.id;
  const step = item.step || 1;
  const q = Math.max(0, Math.min(200, Math.round(Math.round(qty / step) * step * 100) / 100));
  const was = ordQty(id);
  if (q === was) return;
  const p = OR.pend.get(id) ?? {};
  clearTimeout(p.tm);
  hap.impact(q > was ? 'light' : 'soft');
  if (q === 0) toast(t('or_removed', { t: ordName(item) }));
  const rec = { qty: q, tm: setTimeout(() => ordFlush(id, rec), 350) };
  OR.pend.set(id, rec);
  emit();
}
export async function ordFlush(id, rec) {
  clearTimeout(rec.tm);
  rec.sent = (async () => {
    try {
      const j = await api('/app/api/order-line', { search_id: OR.sid, item_id: id, qty: rec.qty });
      if (OR.pend.get(id) === rec) OR.pend.delete(id);
      ordApply(j);
    } catch (e) {
      if (OR.pend.get(id) === rec) OR.pend.delete(id);
      toast(e.code === 'item_gone' ? t('or_gone') : t('err_generic'));
      emit();
    }
  })();
  return rec.sent;
}
/** Before checking or sending: every pending tap reaches the server first. */
export const ordFlushAll = () => Promise.all([...OR.pend].map(([id, rec]) => rec.sent ?? ordFlush(id, rec)));
export async function ordPost(act, body) {
  const j = await api('/app/api/order-' + act, { search_id: ordSid(), ...body });
  if (j.suppliers) ordApply(j);
  return j;
}
/** "Как в прошлый раз": the last delivered order (of `sup`), or exactly the order `oid` ("Повторить" on its receipt). */
export async function ordAgain(sup, oid = null) {
  hap.impact('medium');
  try { const j = await ordPost('again', { ...(sup ? { supplier_id: sup } : {}), ...(oid ? { order_id: oid } : {}) }); go(sp('basket', j.supplier_id)); }
  catch (e) { toast(e.code === 'no_last_order' ? t('or_hist_none') : t('err_generic')); }
}

// ---- formatting
/** Prices keep their thousands: 2 500 → "2,5 тыс", 1 160 000 → "1,16 млн". */
export function ordMoney(n, cur = 'IDR', unit = true) {
  if (n == null) return '';
  if (cur !== 'IDR') return money(n, cur, true);
  const f = (x, d) => new Intl.NumberFormat(LOC(), { maximumFractionDigits: d }).format(x);
  const sep = LANG === 'ru' ? ' ' : '';
  if (Math.abs(n) >= 1e6) return f(n / 1e6, 2) + (unit ? sep + t('or_mln') : '');
  return f(n / 1e3, 1) + (unit ? sep + t('or_thou') : '');
}
export const ordNum = (n) => new Intl.NumberFormat(LOC(), { maximumFractionDigits: 2 }).format(n);
export const ordQ = (unit, n) => t('or_q_' + (unit ?? 'pcs'), { n: ordNum(n) });
export const ordBadge = (unit, n) => (unit === 'pcs' || unit === '30pcs' ? `×${ordNum(n)}` : ordQ(unit, n));
export const ordUnit = (unit) => t('or_u_' + (unit ?? 'pcs'));
export const ordPrice = (x, cur, short = false) => (x.price == null ? t(x.req ? 'or_by_req' : 'or_ask') : [ordMoney(x.price, cur), t((short ? 'or_su_' : 'or_u_') + (x.unit ?? 'pcs'))].filter(Boolean).join(' '));
export const ordSum = (b, cur) => (b.sum ? `≈ ${ordMoney(b.sum, cur)}` : b.unknown ? t('or_ask') : '');
export const ordDay = (day) => { if (!day) return ''; const n = hmDays(day); return n === 0 ? t('or_x_today') : n === 1 ? t('or_x_tomorrow') : fmtDM(day); };
export const ordTab = (s) => (s.kind === 'fruit' || s.kind === 'fish' ? t('or_' + s.kind) : s.name);
export const ordTone = (screen, arg) => {
  const sup = screen === 'shop' || screen === 'basket' || screen === 'order-check' ? ordSup(arg) ?? (arg ? null : OR.v?.suppliers[0]) : screen === 'good' ? ordSup(ordItem(arg)?.sup) : screen === 'order' ? ordSup([...(OR.v?.active ?? []), ...(OR.v?.history ?? [])].find((o) => o.id === arg)?.supplier_id) : null;
  return sup?.kind === 'fish' ? 'orders-sky' : 'orders';
};

// ---- "сколько приготовить денег": one range for the basket, the check and the order (mockup design/mockup-v5/range-*)
// Priced lines: by weight ×0.95…1.25, the rest ×1.00…1.15. A line without a price: the 25th…90th percentile of this supplier's known
// prices in the same group and unit × qty; none → it stays out and is named ("+ N без цены"). Delivery: free from min_free_delivery,
// else delivery_fee when known, else nothing. After 2 delivered orders with every price known the supplier's own history wins:
// price list × min(paid / list) × 0.97 … × max × 1.03 (delivery is inside what was paid). No amount is hard-coded: any currency.
export const RG_KG = [0.95, 1.25], RG_PCS = [1, 1.15], RG_ASK = [0.25, 0.9], RG_LEARN = [0.97, 1.03], RG_LEARN_MIN = 2;
export const rgPct = (xs, p) => { const i = (xs.length - 1) * p, a = Math.floor(i), b = Math.min(a + 1, xs.length - 1); return xs[a] + (xs[b] - xs[a]) * (i - a); };
export const rgMed = (xs) => rgPct([...xs].sort((a, b) => a - b), 0.5);
export const RG_BANDS = new WeakMap();
/** Known prices of a supplier's catalog by group and unit → [p25, p90] (unsure prices are typos and stay out); null without the catalog. */
export function ordBands(sup) {
  const list = OR.items?.[sup];
  if (!list) return null;
  let b = RG_BANDS.get(list);
  if (!b) {
    const by = {};
    for (const x of list) if (x.price > 0 && !x.unsure) (by[`${x.grp}|${x.unit}`] ??= []).push(x.price);
    b = {};
    for (const [k, xs] of Object.entries(by)) { xs.sort((p, q) => p - q); b[k] = RG_ASK.map((p) => rgPct(xs, p)); }
    RG_BANDS.set(list, b);
  }
  return b;
}
/** The supplier's paid / price-list ratios; for a delivered order only those delivered before it (its own answer is not the forecast). */
export function ordRatios(s, o = null) {
  const rs = s?.ratios ?? [];
  if (!o || o.status !== 'delivered') return rs.map((r) => r[1]);
  return rs.filter((r) => r[0] !== o.id && String(r[2] ?? '') < String(o.delivered_at ?? '')).map((r) => r[1]);
}
/**
 * The range of lines (a basket or an order's snapshot) at supplier `s`: {lo, hi} rounded outwards, and the parts the receipt explains.
 * `o` = the order when it is not the basket (a delivered one looks only at earlier orders). null when nothing can be estimated.
 */
export function ordSpread(lines, s, o = null) {
  const bands = ordBands(s?.id);
  const kg = { lo: 0, hi: 0, n: 0 }, pcs = { lo: 0, hi: 0, n: 0, lines: [] }, ask = { lo: 0, hi: 0, lines: [] }, miss = [];
  let est = 0;
  for (const l of lines) {
    if (!(l.qty > 0)) continue;
    if (l.price != null) {
      const v = l.qty * l.price, g = l.unit === 'kg' ? kg : pcs, [a, b] = l.unit === 'kg' ? RG_KG : RG_PCS;
      est += v; g.lo += v * a; g.hi += v * b; g.n++;
      if (g === pcs) pcs.lines.push(l);
    } else {
      const bd = bands?.[`${l.grp}|${l.unit}`];
      if (bd) { ask.lo += l.qty * bd[0]; ask.hi += l.qty * bd[1]; ask.lines.push(l); } else miss.push(l);
    }
  }
  est = Math.round(est);
  const rs = est > 0 ? ordRatios(s, o) : [];
  const learn = rs.length >= RG_LEARN_MIN ? { n: rs.length, min: Math.min(...rs), max: Math.max(...rs), med: rgMed(rs) } : null;
  let lo, hi, deliv = null;
  if (learn) { lo = est * learn.min * RG_LEARN[0] + ask.lo; hi = est * learn.max * RG_LEARN[1] + ask.hi; }
  else {
    lo = kg.lo + pcs.lo + ask.lo; hi = kg.hi + pcs.hi + ask.hi;
    if (hi > 0 && s?.min_free_delivery && est >= s.min_free_delivery) deliv = { free: true, min: s.min_free_delivery };
    else if (hi > 0 && s?.delivery_fee) { deliv = { fee: s.delivery_fee }; lo += s.delivery_fee; hi += s.delivery_fee; }
  }
  if (!(hi > 0)) return null;
  const step = hi >= 1e5 ? 1000 : hi >= 1e4 ? 100 : 1;
  return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, est, kg, pcs, ask, miss, deliv, learn, cur: s?.currency ?? o?.currency ?? 'IDR' };
}
/** "1,0–1,6" + "млн", "730–950" + "тыс", small amounts as they are; the thresholds of money(). */
export function ordRangeTxt(lo, hi, cur = 'IDR') {
  const f = (x, d) => new Intl.NumberFormat(LOC(), { minimumFractionDigits: d, maximumFractionDigits: d }).format(x);
  const [k, d, u] = hi >= 1e6 ? [1e6, 1, t('or_mln')] : hi >= 1e4 ? [1e3, 0, t('or_thou')] : [1, 0, ''];
  const a = f(lo / k, d), b = f(hi / k, d);
  const sym = cur !== 'IDR' ? SYM[cur] ?? cur : '';
  return { n: a === b ? a : `${a}–${b}`, u: [u, sym].filter(Boolean).join(' '), big: k > 1 };
}
/** One line: "1,0–1,6 млн" (en "1.0–1.6M", as ordMoney writes units). */
export const ordRangeStr = (lo, hi, cur) => { const r = ordRangeTxt(lo, hi, cur); return r.u ? r.n + (LANG === 'ru' || !r.big ? ' ' : '') + r.u : r.n; };
/** Every digit: "836 500" (+ the symbol outside rupiah). */
export const ordFull = (n, cur = 'IDR') => ordNum(Math.round(n)) + (cur !== 'IDR' ? ' ' + (SYM[cur] ?? cur) : '');
/** "+10%", "−4%". */
export const ordPctTxt = (r) => { const p = Math.round((r - 1) * 100); return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)}%`; };
/** "ананас и кокосы", "рис, сыр, соус и ещё 2". */
export function ordNames(lines, max) {
  const ns = lines.map((l) => { const x = ordName(l).split(/[,(]/)[0].trim(); return x.charAt(0).toLocaleLowerCase(LOC()) + x.slice(1); });
  if (ns.length <= max) return ns.length > 1 ? t('or_and', { a: ns.slice(0, -1).join(', '), b: ns[ns.length - 1] }) : ns[0] ?? '';
  return t('or_and_more', { a: ns.slice(0, max).join(', '), n: ns.length - max });
}
/** The breakdown under the range on the receipt: up to 4 rows. */
export function ordSpreadRows(sp) {
  const r = (lo, hi) => ordRangeStr(lo, hi, sp.cur);
  const rows = [];
  if (sp.learn) rows.push([t('or_rg_learn', { p: ordPctTxt(sp.learn.med) }), r(sp.est * sp.learn.min * RG_LEARN[0], sp.est * sp.learn.max * RG_LEARN[1])]);
  else {
    if (sp.kg.n) rows.push([t('or_rg_kg'), r(sp.kg.lo, sp.kg.hi)]);
    if (sp.pcs.n) rows.push([ordNames(sp.pcs.lines, 2), r(sp.pcs.lo, sp.pcs.hi)]);
  }
  if (sp.ask.lines.length) rows.push([t('or_rg_ask', { t: ordNames(sp.ask.lines, 3) }), r(sp.ask.lo, sp.ask.hi)]);
  if (sp.deliv) rows.push(sp.deliv.free ? [t('or_rg_dl_free', { x: ordMoney(sp.deliv.min, sp.cur) }), t('or_free')] : [t('or_rg_dl'), ordMoney(sp.deliv.fee, sp.cur)]);
  return rows.slice(0, 4);
}
/** One line under the range on an order: "по прайсу 737 500, развес ±, доставка ≈ 30 000". */
export function ordSpreadWhy(sp) {
  if (sp.learn) return [sp.est ? t('or_rg_w_list', { x: ordFull(sp.est, sp.cur) }) : null, t('or_rg_w_learn', { p: ordPctTxt(sp.learn.med) }), sp.ask.lines.length ? t('or_rg_ask', { t: ordNames(sp.ask.lines, 2) }) : null].filter(Boolean).join(', ');
  return [sp.est ? t('or_rg_w_list', { x: ordFull(sp.est, sp.cur) }) : null, sp.kg.n ? t('or_rg_w_kg') : null, sp.ask.lines.length ? t('or_rg_ask', { t: ordNames(sp.ask.lines, 2) }) : null,
    sp.deliv ? (sp.deliv.free ? t('or_free_ok') : t('or_rg_w_fee', { x: ordFull(sp.deliv.fee, sp.cur) })) : null].filter(Boolean).join(', ');
}

// ---- pieces
export const TOY_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
export const goodFail = (e) => { const im = e.currentTarget; im.onerror = null; im.removeAttribute('srcset'); if (!im.src.endsWith('/goods/sack-192.webp')) im.src = '/goods/sack-192.webp'; }; // a missing picture = the grocery sack
/** A goods toy (/goods/<slug>-192|384|768.webp, design/art/goods): decorative, the name is always next to it. */
export function Good({ slug, size = 96, rot = 0, cls = '', shadow = true, big = false }) {
  const s = TOY_RE.test(slug ?? '') ? slug : 'sack';
  return html`<span class=${`good ${shadow ? '' : 'flat '}${cls}`} style=${`--gs:${size}px;--gr:${rot}deg`} aria-hidden="true"><img src=${`/goods/${s}-${big || size > 96 ? 384 : 192}.webp`}
    srcset=${`/goods/${s}-192.webp 192w, /goods/${s}-384.webp 384w${big ? `, /goods/${s}-768.webp 768w` : ''}`} sizes=${`${size}px`} alt="" loading=${big ? 'eager' : 'lazy'} decoding="async" draggable="false" onError=${goodFail} /></span>`;
}
export const ordRot = (i) => [-8, 7, -8, 10, 9, -6, 5, 9, -11, 8][i % 10];
export function OrdTabs({ cur }) {
  const list = OR.v?.suppliers ?? [];
  return html`<div class="or-tabs"><${BackRound} /><div class="or-pills" role="group" aria-label=${t('or_title')}>
    ${list.map((s) => html`<button key=${s.id} class="or-pill" aria-pressed=${cur === s.id ? 'true' : 'false'} onClick=${() => { if (cur !== s.id) { hap.sel(); go(sp('shop', s.id), true); } }}>${ordTab(s)}</button>`)}
    <button class="or-pill" aria-pressed=${cur === 'services' ? 'true' : 'false'} onClick=${() => { if (cur !== 'services') { hap.sel(); go(sp('shop', 'services'), true); } }}>${t('or_services')}</button>
  </div></div>`;
}
/** The black bar at the bottom: what is in the basket and the next step. */
export function OrdCart({ sup, cta, onGo }) {
  const b = ordBasket(sup);
  if (!b.count) return null;
  const s = ordSup(sup);
  const sp = ordSpread(b.lines, s);
  return html`<div class="or-cart" role="region" aria-label=${t('or_receipt')}><span class="grow" aria-live="polite">${[t('or_pos', { n: b.count }), sp ? ordRangeStr(sp.lo, sp.hi, sp.cur) : ordSum(b, s?.currency)].filter(Boolean).join(' · ')}</span>
    <button class="or-cart-go" onClick=${onGo}>${cta}<${Icon} n="arrow-right" cls="sm" /></button></div>`;
}
export function Qty({ item, qty, name, small = false }) {
  const st = item.step || 1;
  const last = qty > 0 && qty - st <= 0;
  return html`<span class=${'or-qty' + (small ? ' sm' : '') + (qty ? ' on' : '')}>
    ${qty > 0 && html`<button aria-label=${t(last ? 'or_remove' : 'or_less', { t: name }) + (last ? '' : ': ' + name)} onClick=${(e) => { e.stopPropagation(); ordSetQty(item, qty - st); }}><${Icon} n=${last ? 'trash-2' : 'minus'} cls="sm" /></button><b aria-live="polite">${ordQ(item.unit, qty)}</b>`}
    <button class="plus" aria-label=${t('or_add', { t: name })} onClick=${(e) => { e.stopPropagation(); ordSetQty(item, qty + st); }}><${Icon} n="plus" cls="sm" /></button></span>`;
}
/** "ещё 108 тыс до бесплатной доставки" */
export function FreeBar({ sum, s }) {
  if (!s?.min_free_delivery) return null;
  const left = Math.max(0, s.min_free_delivery - sum);
  return html`<div class="or-free"><span>${left ? t('or_free_left', { x: ordMoney(left, s.currency) }) : t('or_free_ok')}</span>
    <i class="or-free-bar" role="progressbar" aria-valuemin="0" aria-valuemax=${s.min_free_delivery} aria-valuenow=${Math.min(sum, s.min_free_delivery)} aria-label=${t('or_delivery')}><b style=${`width:${Math.min(100, Math.round((sum / s.min_free_delivery) * 100))}%`}></b></i></div>`;
}
/**
 * The printed receipt: the basket (edit) and every order afterwards (the status screen, the expense in Деньги). White paper with a
 * torn edge in both themes; toys hang over its left edge.
 */
export function Receipt({ o, edit = false, s = null, date = null, slot = true, print = false, head = null, children }) {
  const cur = o.currency ?? s?.currency ?? 'IDR';
  const total = edit ? o.sum : o.total ?? o.total_est ?? o.sum;
  const exact = !edit && o.status === 'delivered';
  const free = s?.min_free_delivery && o.sum >= s.min_free_delivery;
  const note = s?.delivery_note?.[LANG];
  const sp = edit ? ordSpread(o.lines, s) : null; // the basket: "приготовить" instead of one sum
  return html`<div class=${'rcpt' + (slot ? ' with-slot' : '') + (edit ? ' edit' : '') + (print && !reduceMotion() ? ' print' : '')}>
    ${slot && html`<div class="rcpt-slot" aria-hidden="true"><i></i></div>`}
    <div class="rcpt-clip"><div class="rcpt-paper"><span class="rcpt-bg" aria-hidden="true"><i></i></span>
      <div class="rcpt-in">
        ${head ?? html`<div class="rcpt-head"><b>${o.supplier ?? s?.name ?? ''}</b><span>${date ?? ''}</span></div>`}
        ${o.lines.map((l, i) => html`<div class="rcpt-ln" key=${l.item_id}><${Good} slug=${l.toy} size=${edit ? 92 : 58} rot=${ordRot(i)} cls="rcpt-toy" />
          <div class="rcpt-t"><b>${ordName(l)}</b><span>${edit ? ordPrice(l, cur) : l.price == null ? `${ordQ(l.unit, l.qty)}${l.unit === 'pcs' ? ' ' + t('or_pcs') : ''}` : `${ordQ(l.unit, l.qty)} × ${ordMoney(l.price, cur)}`}${l.unsure && html` <em>${t('or_unsure')}</em>`}${l.gone && html` <em>${t('or_gone')}</em>`}</span>
            ${edit && html`<${Qty} item=${l} qty=${l.qty} name=${ordName(l)} small />`}</div>
          <div class="rcpt-r"><b>${l.price == null ? '?' : ordMoney(Math.round(l.qty * l.price), cur, false)}</b>${memberById(l.by) && html`<${Av} m=${memberById(l.by)} size=${edit ? 40 : 32} free=${edit} />`}</div></div>`)}
        ${!sp && (note || edit) && !exact && !(!edit && o.total) && html`<div class="rcpt-sub"><span>${t('or_delivery')}</span><span>${free ? t('or_free') : s?.delivery_fee ? `≈ ${ordMoney(s.delivery_fee, cur)}` : t('or_ask_dl')}</span></div>`}
        ${!sp && !exact && !(!edit && o.total) && o.unknown > 0 && html`<div class="rcpt-sub"><span>${t('or_ask_n', { n: o.unknown })}</span></div>`}
        ${!exact && o.unsure > 0 && html`<div class="rcpt-sub"><span>${t('or_unsure_n', { n: o.unsure })}</span></div>`}
        ${sp ? html`<${OrdSpread} sp=${sp} paper caret />` : html`<div class="rcpt-total"><b>${total ? `${exact || (!edit && o.total) ? '' : '≈ '}${ordMoney(total, cur, false)}` : '?'}${edit && html`<span class="caret" aria-hidden="true"></span>`}</b>
          <span>${t(exact ? 'or_paid' : 'or_pay_on', { u: cur === 'IDR' ? (total >= 1e6 ? t('or_mln') : t('or_thou')) : cur })}</span></div>`}
        ${children}
      </div></div></div></div>`;
}
/**
 * "приготовить": the range, sharp over a soft haze of itself (blurred = still open). `paper` = on the basket receipt (the exact
 * bounds and the rows), otherwise on the screen colour with one line of why.
 */
export function OrdSpread({ sp, paper = false, caret = false, bare = false }) {
  const r = ordRangeTxt(sp.lo, sp.hi, sp.cur);
  const why = !paper && !bare && ordSpreadWhy(sp);
  return html`<div class=${'or-rg' + (paper ? ' paper' : '')}>
    <p class="or-rg-l">${t('or_rg_ready')}</p>
    <p class=${'or-rg-n' + (r.n.length > 7 ? ' long' : '')}><span class="or-rg-v"><span class="or-rg-h" aria-hidden="true">${r.n}</span><span class="or-rg-x">${r.n}</span></span>${(!paper || !r.big) && r.u && html`<span class="or-rg-u">${r.u}</span>`}${caret && html`<span class="caret" aria-hidden="true"></span>`}</p>
    ${paper && r.big && html`<p class="or-rg-e">${t('or_rg_exact', { u: r.u, a: ordNum(sp.lo), b: ordNum(sp.hi) })}</p>`}
    ${why && html`<p class="or-rg-e">${why}</p>`}
    ${sp.miss.length > 0 && html`<p class="or-rg-e">${t('or_rg_miss', { n: sp.miss.length })}: ${ordNames(sp.miss, 3)}</p>`}
    ${paper && html`<div class="or-rg-rows">${ordSpreadRows(sp).map(([a, b]) => html`<div key=${a}><span>${a}</span><b>${b}</b></div>`)}</div>`}
  </div>`;
}
/** What was paid (or confirmed), sharp; the expected range as a scale with the fact on it, the verdict in words; what Hunt learnt. */
export function OrdFact({ o, s }) {
  const cur = o.currency;
  const f = o.total;
  const sp = ordSpread(o.lines, s, o);
  const dl = o.status === 'delivered';
  const label = dl ? t(['cash', 'transfer', 'card'].includes(o.method) ? 'or_rg_paid_' + o.method : 'or_rg_paid') : t('or_rg_final');
  let scale = null;
  if (sp && !sp.miss.length) {
    const a = Math.min(sp.lo, f), b = Math.max(sp.hi, f), at = (x) => (b > a ? ((x - a) / (b - a)) * 100 : 50);
    const st = f > sp.hi ? ['more', 'danger', f - sp.hi] : f < sp.lo ? ['less', 'mango', sp.lo - f] : ['in', 'jungle', 0];
    scale = html`<div class="or-scale" role="img" aria-label=${t('or_rg_scale', { a: ordMoney(sp.lo, cur), b: ordMoney(sp.hi, cur), x: ordMoney(f, cur) })}>
        <i class="or-scale-t"></i><i class="or-scale-b" style=${`left:${at(sp.lo)}%;width:${at(sp.hi) - at(sp.lo)}%`}></i><i class="or-scale-m" style=${`left:${at((sp.lo + sp.hi) / 2)}%`}></i><i class="or-scale-f" style=${`left:clamp(11px, ${at(f)}%, calc(100% - 11px))`}></i></div>
      <div class="or-scale-e" aria-hidden="true" style=${at(sp.hi) - at(sp.lo) >= 55 ? `padding:0 ${100 - at(sp.hi)}% 0 ${at(sp.lo)}%` : ''}><span>${t('or_rg_from', { x: ordMoney(sp.lo, cur) })}</span><span>${t('or_rg_to', { x: ordMoney(sp.hi, cur) })}</span></div>
      <p class=${'or-verdict ' + st[1]}><${Icon} n=${st[0] === 'in' ? 'circle-check' : 'circle-alert'} cls="sm" />${t('or_rg_' + st[0], { x: ordMoney(st[2], cur) })}</p>`;
  }
  const all = dl ? (s?.ratios ?? []).map((r) => r[1]) : [];
  const p = all.length ? Math.round((rgMed(all) - 1) * 100) : null;
  return html`<section class="or-fact">
    <p class="or-rg-l">${label}</p>
    <p class=${'or-fact-n' + (ordFull(f, cur).length > 9 ? ' long' : '')}>${ordFull(f, cur)}</p>
    ${scale}
    ${p != null && html`<div class="or-learn"><span class="or-learn-ic" aria-hidden="true"><${Icon} n="history" cls="sm" /></span><div class="grow"><b>${t('or_rg_learnt')}</b>
      <span>${p ? t('or_rg_usual', { p: ordPctTxt(1 + p / 100) }) : t('or_rg_usual0')}</span>${o.total_est && !o.unknown ? html`<span>${t('or_rg_this', { x: ordFull(o.total_est, cur) })}</span>` : null}</div></div>`}
  </section>`;
}

// ---- A · the shop ("Прилавок")
/** The big toys: what you usually take first (from 2 delivered orders), then the supplier's popular ones, up to 8. */
export function ordShelf(sup) {
  const all = OR.items?.[sup] ?? [];
  const usual = all.filter((x) => x.fav >= (OR.usual ?? 2)).sort((a, b) => b.fav - a.fav || (a.top ?? 99) - (b.top ?? 99)).slice(0, 8);
  const pop = all.filter((x) => x.top && !usual.includes(x)).sort((a, b) => a.top - b.top);
  return { list: [...usual, ...pop].slice(0, 8), usual: usual.length };
}
export let ordGrp = {}; // supplier → the group the pills jumped to
export function ShopScreen({ arg }) {
  const { v, items, err } = useOrders(true);
  const [q, setQ] = useState('');
  if (arg === 'services') return html`<${ServicesScreen} />`;
  if (err) return html`<main class="screen no-nav"><${BackRound} />${msgCard(t('err_generic'))}</main>`;
  if (!v || !items) return html`<main class="screen no-nav or-scr"><${BackRound} />${skel(300)}${skel(160)}</main>`;
  const s = ordSup(arg) ?? v.suppliers[0];
  if (!s) return html`<main class="screen w2 or-scr"><${OrdTabs} cur="" /><section class="or-empty"><${Good} slug="bag" size=${180} rot=${-4} big /><${Typed} lines=${[t('or_no_sup')]} /><p class="w8-sub">${t('or_no_sup_s')}</p></section><${Nav} tab="more" /></main>`;
  const all = items[s.id] ?? [];
  const shelf = ordShelf(s.id);
  const basket = ordBasket(s.id);
  const inB = new Map(basket.lines.map((l) => [l.item_id, l]));
  const grps = [...new Set(all.map((x) => x.grp))];
  const needle = q.trim().toLowerCase().replace(/ё/g, 'е');
  const hit = (x) => [x.ru, x.en, x.name_id].some((y) => String(y).toLowerCase().replace(/ё/g, 'е').includes(needle));
  const found = needle ? all.filter(hit) : null;
  const last = ordLast(s.id);
  const row = (x) => {
    const n = ordQty(x.id);
    return html`<div key=${x.id} class="or-row"><button class="or-row-m" aria-label=${t('or_open_item', { t: ordName(x) })} onClick=${() => { hap.sel(); go(sp('good', x.id)); }}><${Good} slug=${x.toy} size=${48} shadow=${false} />
      <span class="grow"><b>${ordName(x)}</b><span>${x.price == null ? html`<em class="or-ask">${t(x.req ? 'or_by_req' : 'or_ask')}</em>` : ordPrice(x, s.currency)}${x.unsure && html` <em class="or-ask">${t('or_unsure')}</em>`}</span></span></button>
      ${ordCan() ? html`<${Qty} item=${x} qty=${n} name=${ordName(x)} small />` : n ? html`<b>${ordQ(x.unit, n)}</b>` : null}</div>`;
  };
  return html`<main class=${'screen or-scr' + (basket.count ? ' has-cart' : '')}>
    <${OrdTabs} cur=${s.id} />
    <section class="w8-hero or-hero">
      <${BigWord} text=${t('or_w_' + (s.kind ?? 'other'))} cls="or-word" />
      <${Typed} key=${s.id} lines=${[t('or_q_' + (s.kind ?? 'other'))]} as="h1" />
      ${last && ordCan() && html`<button class="sticker or-st" style="--r:12deg" onClick=${() => ordAgain(s.id)}><span>${t('or_again_st')}</span></button>`}
      ${(v.sets ?? []).length > 0 && html`<h2 class="st-cap st-cap-shop">${t('st_title')}</h2><div class="st-tiles">${v.sets.map((st) => html`<${SetTile} key=${st.id} st=${st} cur=${s.id} />`)}</div>`}
      <p class="sr">${t(shelf.usual ? 'or_usual_pop' : 'or_pop')}</p>
      <div class=${'or-shelf n' + Math.min(8, shelf.list.length)}>${shelf.list.map((x, i) => {
        const l = inB.get(x.id);
        const by = l && memberById(l.by);
        const big = i < 2;
        return html`<button key=${x.id} class=${'or-toy' + (big ? ' big' : '')} onClick=${() => { hap.sel(); go(sp('good', x.id)); }}>
          <span class="or-toy-art"><${Good} slug=${x.toy} size=${big ? 168 : 104} rot=${ordRot(i)} />
            ${l && html`<span class="or-badge" style=${`--r:${i % 2 ? 8 : -8}deg`}>${ordBadge(x.unit, l.qty)}</span>`}${by && html`<span class="or-by"><${Av} m=${by} size=${big ? 46 : 38} free /></span>`}</span>
          <b>${ordShort(x)}</b><span>${ordPrice(x, s.currency, true)}</span></button>`;
      })}</div>
    </section>
    <label class="or-search"><${Icon} n="search" cls="sm" /><input type="search" enterkeyhint="search" value=${q} placeholder=${t('or_search')} aria-label=${t('or_search')} onInput=${(e) => setQ(e.currentTarget.value)} /></label>
    ${!found && grps.length > 1 && html`<div class="or-gpills" role="group">${grps.map((g) => html`<button key=${g} class="or-pill" aria-pressed=${ordGrp[s.id] === g ? 'true' : 'false'} onClick=${() => { hap.sel(); ordGrp[s.id] = g; emit(); document.getElementById('org-' + g)?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' }); }}>${t('or_g_' + g)}</button>`)}</div>`}
    ${found ? (found.length ? html`<div class="or-list">${found.map(row)}</div>` : html`<p class="or-none">${t('or_none_found')}</p>`)
      : grps.map((g) => html`<section key=${g} class="or-grp" id=${'org-' + g}><h2>${t('or_g_' + g)}</h2><div class="or-list">${all.filter((x) => x.grp === g).map(row)}</div></section>`)}
    <p class="or-foot">${[t('or_search_n', { n: all.length }), OR.price_at[s.id] ? t('or_prices_at', { d: fmtDM(OR.price_at[s.id]) }) : null, s.hours ? t('or_hours', { h: s.hours.replace('-', '–') }) : null].filter(Boolean).join(' · ')}<br />${[s.note?.[LANG], s.delivery_note?.[LANG]].filter(Boolean).join('. ')}</p>
    ${basket.count ? html`<${OrdCart} sup=${s.id} cta=${t('or_collect')} onGo=${() => { hap.sel(); go(sp('basket', s.id)); }} />` : html`<${Nav} tab="more" />`}
  </main>`;
}

// ---- B · one item ("По одному")
export function GoodScreen({ id }) {
  const { v, items, err } = useOrders(true);
  const drag = useRef(null);
  const art = useRef(null);
  if (err) return html`<main class="screen no-nav"><${BackRound} />${msgCard(t('err_generic'))}</main>`;
  if (!v || !items) return html`<main class="screen no-nav or-scr"><${BackRound} />${skel(420)}</main>`;
  const x = ordItem(id);
  if (!x) return html`<main class="screen no-nav or-scr"><${BackRound} />${msgCard(t('or_gone'))}</main>`;
  const s = ordSup(x.sup);
  const shelf = ordShelf(x.sup).list;
  const seq = shelf.includes(x) ? shelf : items[x.sup].filter((y) => y.grp === x.grp);
  const i = seq.indexOf(x);
  const at = (k) => seq[(i + k + seq.length) % seq.length];
  const prev = seq.length > 1 ? at(-1) : null, next = seq.length > 1 ? at(1) : null;
  const qty = ordQty(x.id);
  const step = x.step || 1;
  const last = ordLast(x.sup)?.lines.find((l) => l.item_id === x.id);
  const line = ordBasket(x.sup).lines.find((l) => l.item_id === x.id);
  const by = line && memberById(line.by);
  const name = ordName(x);
  const word = x.price == null ? '?' : ordWord(x);
  const swap = (y, dir) => { if (!y) return; hap.sel(); document.documentElement.dataset.ordDir = dir > 0 ? 'next' : 'prev'; go(sp('good', y.id), true); };
  const down = (e) => { if (e.button) return; drag.current = { x: e.clientX, y: e.clientY, dx: 0 }; };
  const move = (e) => {
    const g = drag.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    if (!g.on && Math.abs(dx) < 10) return;
    if (!g.on && Math.abs(e.clientY - g.y) > Math.abs(dx)) { drag.current = null; return; }
    if (!g.on) { g.on = true; tg(() => e.currentTarget.setPointerCapture(e.pointerId)); }
    g.dx = dx;
    if (art.current && !reduceMotion()) art.current.style.transform = `translateX(${dx}px) rotate(${dx / 24}deg)`;
  };
  const up = () => {
    const g = drag.current;
    drag.current = null;
    if (art.current) art.current.style.transform = '';
    if (!g?.on) return;
    if (Math.abs(g.dx) > 56) swap(g.dx < 0 ? next : prev, g.dx < 0 ? 1 : -1);
  };
  const near = seq.length > 7 ? Array.from({ length: 7 }, (_, k) => at(k - 3)) : seq;
  return html`<main class="screen or-scr or-one has-cart" onKeyDown=${(e) => { if (e.key === 'ArrowRight') swap(next, 1); if (e.key === 'ArrowLeft') swap(prev, -1); }}>
    <${OrdTabs} cur=${x.sup} />
    <section class="or-stage" onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}>
      <div class=${'bigword or-word one' + (word === '?' ? ' q' : '')} style=${`--wn:${Math.max(4, Math.min(11, word.length))}`} aria-hidden="true">${word}</div>
      ${prev && html`<span class="or-peek l"><${Good} slug=${prev.toy} size=${118} rot=${-16} shadow=${false} /></span>`}
      ${next && html`<span class="or-peek r"><${Good} slug=${next.toy} size=${118} rot=${12} shadow=${false} /></span>`}
      <div class="or-art" ref=${art} key=${x.id}><${Good} slug=${x.toy} size=${286} rot=${4} big />${by && html`<span class="or-by"><${Av} m=${by} size=${74} free /></span>`}</div>
      ${last && ordCan() && qty !== last.qty && html`<button class="sticker or-st-last" style="--r:12deg" onClick=${() => ordSetQty(x, last.qty)}><span>${t('or_last_n', { n: ordQ(x.unit, last.qty) })}</span></button>`}
    </section>
    <${Typed} key=${x.id} lines=${[name]} as="h1" />
    <div class="or-pl"><span class="grow">${x.price == null ? html`<em class="or-ask">${t(x.req ? 'or_by_req' : 'or_ask')}</em>` : html`${ordMoney(x.price, s.currency)} ${ordUnit(x.unit)}${x.unsure && html` <em class="or-ask">${t('or_unsure')}</em>`}`}</span>
      <b>${qty && x.price != null ? `${x.unsure ? '≈ ' : ''}${ordMoney(Math.round(qty * x.price), s.currency)}` : ''}</b></div>
    <p class="or-pn">${x.price == null ? t('or_ask_sub') : x.unsure ? t('or_unsure_sub') : t('or_in_list', { t: x.name_id })}</p>
    <div class="or-big" role="group" aria-label=${name}>
      <button class="or-step" disabled=${!qty} aria-label=${t('or_less')} onClick=${() => ordSetQty(x, qty - step)}><${Icon} n="minus" /></button>
      <b class=${'or-n' + (ordQ(x.unit, qty).length > 4 ? ' long' : '')} aria-live="polite">${x.unit === 'kg' ? html`${ordNum(qty)}<small>${LANG === 'ru' ? 'кг' : 'kg'}</small>` : ordNum(qty)}</b>
      <button class="or-step plus" aria-label=${t('or_more')} onClick=${() => ordSetQty(x, qty + step)}><${Icon} n="plus" /></button>
    </div>
    ${seq.length > 1 && html`<div class="or-strip">${near.map((y) => { const n = ordQty(y.id); return html`<button key=${y.id} class=${y === x ? 'cur' : ''} aria-label=${ordName(y)} aria-current=${y === x ? 'true' : null} onClick=${() => y !== x && swap(y, seq.indexOf(y) > i ? 1 : -1)}><${Good} slug=${y.toy} size=${y === x ? 54 : 40} shadow=${false} />${n > 0 && html`<i>${ordBadge(y.unit, n)}</i>`}</button>`; })}</div>`}
    <${OrdCart} sup=${x.sup} cta=${t('or_collect')} onGo=${() => { hap.sel(); go(sp('basket', x.sup)); }} />
  </main>`;
}

// ---- C · the basket ("Чек")
export function BasketScreen({ id }) {
  const { v, items, err } = useOrders(true);
  if (err) return html`<main class="screen no-nav"><${BackRound} />${msgCard(t('err_generic'))}</main>`;
  if (!v || !items) return html`<main class="screen no-nav or-scr"><${BackRound} />${skel(420)}</main>`;
  const s = ordSup(id) ?? v.suppliers[0];
  if (!s) return html`<${ShopScreen} />`;
  const b = ordBasket(s.id);
  const shelf = ordShelf(s.id).list.filter((x) => !ordQty(x.id)).slice(0, 6);
  const last = ordLast(s.id);
  const can = ordCan();
  const clear = () => { hap.sel(); openSheet('ord_clear', s.id); };
  const save = async () => { hap.sel(); await ordFlushAll(); const id = OR.v?.baskets.find((x) => x.supplier_id === s.id)?.id; if (id) openSheet('ord_save', { from: id, sup: s.id }); };
  const date = `${dfmt(new Date().toISOString(), { weekday: 'short' }).replace('.', '')} ${fmtDM(new Date().toISOString())}`;
  // 1 · the receipt's own header: name, date and count, "Очистить" and "Сохранить как набор" (design/mockup-v5/sets-1)
  const head = html`<div class="rcpt-head st-head"><div class="grow"><b>${s.name}</b><span>${date} · ${t('or_pos', { n: b.count })}</span></div>
      ${can && html`<button class="st-tool" onClick=${clear}><${Icon} n="trash-2" cls="sm" />${t('or_clear')}</button>`}</div>
    ${can && html`<button class="st-tool st-save" onClick=${save}><${Icon} n="bookmark-plus" cls="sm" />${t('st_save')}</button>`}`;
  return html`<main class=${'screen or-scr or-bsk' + (b.count ? ' has-cart' : '')}>
    <${OrdTabs} cur=${s.id} />
    <h1 class="sr">${t('or_receipt')}</h1>
    ${can && shelf.length > 0 && html`<div class="or-mini">${shelf.map((x, i) => html`<button key=${x.id} aria-label=${t('or_add', { t: ordName(x) })} onClick=${() => ordSetQty(x, x.step || 1)}><${Good} slug=${x.toy} size=${52} rot=${ordRot(i)} shadow=${false} /><span>${ordWord(x)} ${x.price == null ? '?' : ordMoney(x.price, s.currency, false)}</span></button>`)}</div>`}
    ${b.count ? html`<${Receipt} o=${b} s=${s} edit print date=${date} head=${head}>
        ${!(s.min_free_delivery && b.sum >= s.min_free_delivery) && html`<${FreeBar} sum=${b.sum} s=${s} />`}
        ${last && can && html`<button class="sticker or-st-bsk coral" style="--r:-12deg" onClick=${() => ordAgain(s.id)}><span>${t('or_again_st')}</span></button>`}<//>
        ${s.delivery_note?.[LANG] && html`<p class="or-foot">${s.delivery_note[LANG]}</p>`}
        <${OrdCart} sup=${s.id} cta=${t('or_check')} onGo=${async () => { hap.sel(); await ordFlushAll(); go(sp('order-check', s.id)); }} />`
      : html`<div class="rcpt with-slot is-empty"><div class="rcpt-slot" aria-hidden="true"><i></i></div><div class="rcpt-clip"><div class="rcpt-paper"><span class="rcpt-bg" aria-hidden="true"><i></i></span><div class="rcpt-in"><div class="rcpt-head"><b>${s.name}</b></div><${Typed} lines=${[t('or_empty_t')]} /><p class="muted">${t('or_empty_s')}</p></div></div></div></div>
        <div class="w8-pills or-empty-p"><button class="btn accent" onClick=${() => go(sp('shop', s.id), true)}>${t('or_to_shop')}</button>${last && can && html`<button class="btn surface" onClick=${() => ordAgain(s.id)}><${Icon} n="repeat" cls="sm" />${t('or_again')}</button>`}</div>
        <${SetRows} sup=${s.id} />
        <div class="bigword or-word st-empty-w" aria-hidden="true">${t('st_w_empty')}</div>
        <${Nav} tab="more" />`}
  </main>`;
}

// ---- D · check and send ("Всё так?")
export function OrderCheck({ id }) {
  const d = D();
  const { v, items, err } = useOrders(true);
  const oid = v?.baskets.find((x) => x.supplier_id === id)?.id ?? null;
  const [pv, setPv] = useState(null);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState(false);
  const load0 = () => api(`/app/api/order-preview?s=${encodeURIComponent(d.search.id)}&id=${encodeURIComponent(oid)}`).then((j) => { setPv(j); setNote((n) => n ?? j.order.note ?? ''); }).catch(() => setFail(true));
  const sig = v?.baskets.find((x) => x.supplier_id === id)?.lines.map((l) => l.item_id + l.qty + l.price).join() ?? '';
  useEffect(() => { if (oid) load0(); }, [oid, sig]);
  const set = async (body) => { try { const j = await ordPost('set', { order_id: oid, ...body }); setPv(j); hap.sel(); } catch (e) { toast(e.code === 'order_changed' ? t('or_changed') : e.code === 'bad_time' ? t('or_no_today') : t('err_generic')); } };
  if (err || fail) return html`<main class="screen no-nav"><${BackRound} />${msgCard(t('err_generic'))}</main>`;
  if (v && !oid) return html`<${BasketScreen} id=${id} />`;
  if (!pv || !items) return html`<main class="screen no-nav or-scr"><${BackRound} />${skel(380)}</main>`;
  const s = pv.supplier;
  const o = pv.order;
  const sp = ordSpread(o.lines, ordSup(o.supplier_id) ?? s);
  const day = pv.days.find((x) => x.day === o.day) ?? null;
  const ms = [...new Set(o.lines.map((l) => l.by))].map(memberById).filter(Boolean).slice(0, 2);
  const peek = o.lines.slice(0, 3);
  const leave = async (act) => {
    setBusy(true);
    // A tab opened right in the tap (outside Telegram) survives the request; in Telegram openLink does it.
    const w = act === 'open' && !inTG ? window.open('', '_blank') : null;
    try {
      if (note !== null && (note || '') !== (o.note ?? '')) await ordPost('set', { order_id: oid, note });
      const j = await ordPost(act, { order_id: oid });
      hap.ok();
      if (act === 'open') { if (w) { w.opener = null; w.location.href = j.url; } else openLink(j.url); } else toast(t('or_agent_ok'));
      go(sp('order', oid), true);
    } catch (e) { w?.close(); toast(e.code === 'order_changed' ? t('or_changed') : e.code === 'rate_limited' ? t('err_generic') : t('err_generic')); }
    setBusy(false);
  };
  const copy = async () => { await copyText(pv.text); };
  return html`<main class="screen no-nav or-scr or-chk">
    <${BackRound} />
    <section class="w8-hero or-chk-h">
      <${BigWord} text=${t('or_ok_w')} cls="or-word" />
      <div class="or-bag" aria-hidden="true">${peek.map((l, i) => html`<span key=${l.item_id} class=${'p' + i}><${Good} slug=${l.toy} size=${84} rot=${[-10, 8, 16][i]} shadow=${false} /></span>`)}<span class="b"><${Good} slug="bag" size=${150} rot=${-3} big /></span>
        ${ms.map((m, i) => html`<span key=${m.user_id} class=${'m' + i}><${Av} m=${m} size=${50} free /></span>`)}</div>
      <${Typed} lines=${[t('or_ok_q')]} as="h1" />
      <p class="w8-sub">${t('or_via', { s: s.name, c: s.channel ? channelName(s.channel) : '' }).replace(/, $/, '')}</p>
    </section>
    <div class="or-msg"><p lang="id">${pv.text}</p><p class="tr">${pv.text_tr}</p></div>
    <div class="or-when" role="group" aria-label=${t('or_conf_time')}>
      ${pv.days.map((x, i) => html`<button key=${x.day} class="or-pill" disabled=${!x.slots.length} aria-pressed=${o.day === x.day ? 'true' : 'false'} onClick=${() => set(o.day === x.day ? { day: null } : { day: x.day, time: x.slots.includes(o.time) ? o.time : x.slots[0] ?? null })}>${t(i ? 'or_tomorrow' : 'or_today')}</button>`)}
      <button class="or-pill" aria-pressed=${o.day && day ? 'false' : 'true'} onClick=${() => set({ day: null })}>${t('or_any')}</button>
    </div>
    ${!pv.days[0].slots.length && html`<p class="or-foot l">${t('or_no_today')}${s.hours ? ', ' + t('or_hours', { h: s.hours.replace('-', '–') }) : ''}</p>`}
    ${day && day.slots.length > 0 && html`<div class="or-when" role="group">${day.slots.map((x) => html`<button key=${x} class="or-pill" aria-pressed=${o.time === x ? 'true' : 'false'} onClick=${() => set({ time: o.time === x ? null : x })}>${t('or_by', { t: hm(x) })}</button>`)}</div>`}
    <div class="or-opts">
      ${pv.address && html`<${Toggle} on=${pv.address.on} onChange=${(x) => set({ with_address: x })} label=${t('or_addr')} sub=${t('or_addr_sub')} />`}
      <label class="or-note"><span>${t('or_note')}</span><input class="e-input" maxlength="300" value=${note ?? ''} placeholder=${t('or_note_ph')} onInput=${(e) => setNote(e.currentTarget.value)} onBlur=${() => (note ?? '') !== (o.note ?? '') && set({ note })} /></label>
    </div>
    <div class="or-sumrow"><span>${t('or_goods')}</span><b>${t('or_items', { n: o.lines.length })}</b></div>
    ${!sp && o.unknown > 0 && html`<div class="or-sumrow"><span>${t('or_ask_n', { n: o.unknown })}</span></div>`}
    ${s.min_free_delivery && html`<${FreeBar} sum=${o.sum} s=${s} />`}
    ${sp ? html`<${OrdSpread} sp=${sp} />` : html`<p class="or-total">${o.sum ? `≈ ${ordMoney(o.sum, s.currency)}` : t('or_ask_t')}</p>`}
    <p class="or-foot l">${s.delivery_note?.[LANG] && !(s.min_free_delivery && o.sum >= s.min_free_delivery) ? s.delivery_note[LANG] + '. ' : ''}${t('or_self')}</p>
    ${ordCan() && html`<div class="or-send or-dock">
      ${pv.can_open ? html`<button class="btn accent big grow" disabled=${busy} onClick=${() => leave('open')}><${Icon} n=${s.channel === 'telegram' ? 'send' : 'message-circle'} cls="sm" />${t(s.channel === 'telegram' ? 'or_tgo' : 'or_wa')}</button>` : html`<button class="btn accent big grow" onClick=${copy}><${Icon} n="copy" cls="sm" />${t('or_copy')}</button>`}
      ${pv.can_agent && html`<button class="btn surface big" disabled=${busy} aria-label=${t('or_agent')} onClick=${() => leave('agent')}>${t('or_agent_s')}</button>`}
    </div>`}
  </main>`;
}

// ---- E · the order ("Едет")
export const ACTIVE_OR = ['opened', 'draft', 'sent', 'confirmed'];
export const ordFind = (id) => [...(OR.v?.active ?? []), ...(OR.v?.history ?? [])].find((o) => o.id === id) ?? null;
export function OrderScreen({ id }) {
  const d = D();
  const o0 = ordFind(id);
  const { v, err } = useOrders(!!o0 && o0.status !== 'cancelled' && o0.lines.some((l) => l.price == null)); // lines without a price: the catalog prices the range
  const [one, setOne] = useState(null);
  const [busy, setBusy] = useState(false);
  const o = ordFind(id) ?? one;
  useEffect(() => { if (v && !ordFind(id)) api(`/app/api/order?s=${encodeURIComponent(d.search.id)}&id=${encodeURIComponent(id)}`).then((j) => setOne(j.order)).catch(() => setOne({ failed: true })); }, [id, !!v]);
  if (err || o?.failed) return html`<main class="screen no-nav"><${BackRound} />${msgCard(t('err_generic'))}</main>`;
  if (!o) return html`<main class="screen no-nav or-scr"><${BackRound} />${skel(380)}</main>`;
  if (o.status === 'basket') return html`<${BasketScreen} id=${o.supplier_id} />`;
  const cur = o.currency;
  const s = ordSup(o.supplier_id);
  const can = ordCan();
  const act = async (action, body = {}, done = null) => {
    setBusy(true);
    try { const j = await ordPost('status', { order_id: o.id, action, ...body }); hap.ok(); if (done) toast(t(done)); setOne(null); setBusy(false); return j; }
    catch (e) { setBusy(false); if (e.code === 'need_total') { openSheet('ord_paid', { o }); return null; } toast(e.code === 'order_changed' ? t('or_changed') : t('err_generic')); ordLoad().catch(() => null); return null; }
  };
  const notSent = async () => { if (await act('not_sent', {}, 'or_back_basket')) go(sp('basket', o.supplier_id), true); };
  const deliver = () => (o.total ? act('delivered', {}, 'or_paid_toast').then((j) => j && load(d.search.id, { quiet: true })) : openSheet('ord_paid', { o }));
  const cancel = async () => { if (await askConfirm(t('or_cancel_q'))) act('cancel', {}, 'or_cancelled'); };
  const chat = o.address ? channelLink(o.channel, o.address) : null;
  const write = chat && html`<button class="btn surface big" onClick=${() => openLink(o.status === 'opened' && o.text ? `${chat}?text=${encodeURIComponent(o.text)}` : chat)}>${t('or_write')}</button>`;
  const who = memberById(o.sent_by), conf = memberById(o.confirmed_by);
  const when = [o.day ? ordDay(o.day) : null, o.time ? t('or_by', { t: hm(o.time) }) : null].filter(Boolean);
  const sp = ACTIVE_OR.includes(o.status) && !o.total ? ordSpread(o.lines, s, o) : null;
  const fact = o.total && (o.status === 'confirmed' || o.status === 'delivered') ? html`<${OrdFact} o=${o} s=${s} />` : null;
  const sent = ['sent', 'confirmed', 'delivered'].includes(o.status);
  const okd = ['confirmed', 'delivered'].includes(o.status);
  const step = (on, title, sub, at, extra = null, cur0 = false) => html`<li class=${(on ? 'on' : '') + (cur0 ? ' cur' : '')}><i aria-hidden="true"></i><div class="grow"><b>${title}</b>${sub && html`<span>${sub}</span>`}${extra}</div><time>${at ?? ''}</time></li>`;
  const delivered = o.status === 'delivered';
  return html`<main class="screen no-nav or-scr or-ord">
    <${BackRound} />
    <section class="w8-hero or-go">
      <${BigWord} text=${t('or_w_' + o.status)} cls="or-word" />
      ${delivered ? html`<div class="or-go-art dl"><${Good} slug="bag" size=${190} rot=${-4} big /></div>` : html`<div class=${'or-go-art' + (okd ? '' : ' wait')}><${Good} slug="scooter" size=${250} rot=${-4} big /><span class="bx"><${Good} slug="bag" size=${78} rot=${-9} shadow=${false} /></span></div>`}
      ${when.length > 0 && !delivered && o.status !== 'cancelled' && html`<${Sticker} text=${when.join('\n')} cls="lg br" style="right:0;top:6px;--r:12deg" />`}
      ${delivered && html`<${Sticker} text=${fmtDM(o.delivered_at)} style="right:4%;top:10px;--r:12deg" />`}
    </section>
    <${Typed} key=${o.status} lines=${[t('or_l_' + o.status, { s: o.supplier })]} as="h1" />
    ${o.status === 'opened' && can && html`<div class="or-ask2"><button class="btn accent big" disabled=${busy} onClick=${() => act('sent')}>${t('or_sent_y')}</button><button class="btn surface big" disabled=${busy} onClick=${notSent}>${t('or_sent_n')}</button></div>`}
    ${!delivered && o.status !== 'cancelled' && html`<ol class="or-steps">
      ${step(sent, o.status === 'opened' ? t('or_st_open') : o.status === 'draft' ? t('or_s_draft') : t('or_st_sent'), o.via === 'agent' ? t('or_by_agent') : who ? t('or_by_who', { n: firstName(who.name) }) : '', fmtTime(o.sent_at ?? o.opened_at ?? o.updated_at), who && html`<span class="or-step-av"><${Av} m=${who} size=${34} free /></span>`, !sent)}
      ${step(okd, okd && o.total ? t('or_st_conf_x', { x: ordMoney(o.total, cur) }) : t('or_st_conf'), okd ? (o.reply ? '' : o.confirmed_by === 'agent' ? t('or_conf_agent') : conf ? t('or_conf_by', { n: firstName(conf.name) }) : '') : t('or_wait_ans'), okd ? fmtTime(o.confirmed_at) : '', o.reply && html`<div class="or-reply"><p lang="id">${o.reply}</p>${o.reply_tr && html`<p class="tr">${o.reply_tr}</p>`}</div>`, o.status === 'sent')}
      ${step(false, t('or_st_dl'), o.total ? t('or_cash', { x: ordMoney(o.total, cur) }) : t('or_cash0'), o.time ? `≈ ${hm(o.time)}` : '', null, o.status === 'confirmed')}
    </ol>`}
    ${sp && html`<div class="or-rg-wrap"><${OrdSpread} sp=${sp} /></div>`}
    ${fact}
    ${delivered && can && !ordBasket(o.supplier_id).count && ordLast(o.supplier_id)?.id === o.id && html`<div class="st-again"><span class="st-again-ic" aria-hidden="true"><${Icon} n="basket" cls="sm" /></span><span class="grow"><b>${t('st_empty_again')}</b><span>${t('st_empty_again_s')}</span></span></div>`}
    ${delivered && o.expense_id ? html`<button class="st-rrow" onClick=${() => { go(sp('money')); setTimeout(() => openSheet('expense', o.expense_id), 60); }}><span class="grow">${t('st_rcpt_row', { n: t('or_pos', { n: o.lines.length }) })}</span><${Icon} n="arrow-right" cls="sm" /></button>`
      : html`<div class="or-ord-r"><${Receipt} o=${o} s=${s} slot=${false} date=${fmtDM(o.delivered_at ?? o.sent_at ?? o.opened_at ?? o.updated_at)} /></div>`}
    ${o.text && html`<details class="or-det"><summary>${t('or_text')}</summary><p lang="id">${o.text}</p></details>`}
    ${can && html`${!delivered && o.status !== 'cancelled' && html`<div class="or-send"><div class="or-two">${o.status === 'confirmed' && html`<button class="btn surface" onClick=${() => openSheet('ord_conf', { o })}>${t('or_fix')}</button>`}
        ${o.status !== 'confirmed' && write}
        <button class="btn surface" disabled=${busy} onClick=${cancel}>${t('or_cancel')}</button></div></div>`}
      ${delivered || o.status === 'cancelled' ? html`<div class="or-send or-dock">${delivered && html`<button class="btn accent big grow" onClick=${() => ordAgain(o.supplier_id, o.id)}><${Icon} n="repeat" cls="sm" />${t('st_again')}</button>`}
          ${delivered && s ? html`<button class="btn surface big" onClick=${() => { hap.sel(); openSheet('ord_save', { from: o.id, sup: o.supplier_id, lines: o.lines }); }}>${t('st_save')}</button>` : html`<button class="btn surface big" onClick=${() => go(sp('shop', o.supplier_id))}>${t('or_to_shop')}</button>`}</div>`
        : o.status !== 'draft' && o.status !== 'opened' && html`<div class="or-send or-dock">${o.status === 'sent' && html`<button class="btn accent big grow" onClick=${() => openSheet('ord_conf', { o })}>${t('or_confirm')}</button>`}<button class=${'btn big ' + (o.status === 'sent' ? 'surface' : 'accent grow')} disabled=${busy} onClick=${deliver}>${t('or_delivered')}</button>${o.status === 'confirmed' && write}</div>`}`}
  </main>`;
}
/** Amount typed in thousands or full: "205" → 205 000 for rupiah, "205000" stays. */
export function ordAmount(s, cur) {
  const n = parseAmount(s);
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  return cur === 'IDR' && n < 10000 ? Math.round(n * 1000) : Math.round(n);
}
/** Prefilled in the field's unit (thousands for rupiah). */
export const ordField = (n, cur) => (n ? String(cur === 'IDR' ? n / 1000 : n).replace('.', LANG === 'ru' ? ',' : '.') : '');
export function OrdConfSheet({ o }) {
  const [sum, setSum] = useState(ordField(o.total, o.currency));
  const [time, setTime] = useState(o.time ?? '');
  const [busy, setBusy] = useState(false);
  const n = ordAmount(sum, o.currency);
  const save = async () => {
    setBusy(true);
    try { await ordPost('status', { order_id: o.id, action: 'confirm', ...(n ? { total: n } : {}), ...(time ? { time, ...(o.day ? {} : { day: hmToday() }) } : {}) }); hap.ok(); closeSheet(); } catch { toast(t('err_generic')); }
    setBusy(false);
  };
  return html`<h2>${t('or_conf_t')}</h2>
    <p class="e-lbl">${t('or_conf_sum')}</p><div class="amount-in"><input inputmode="decimal" value=${sum} placeholder="205" aria-label=${t('or_conf_sum')} onInput=${(e) => setSum(e.currentTarget.value)} /><span>${o.currency === 'IDR' ? t('or_thou') : o.currency}</span></div>
    ${n && html`<p class="amount-hint">${ordMoney(n, o.currency)}</p>`}
    <p class="e-lbl">${t('or_conf_time')}</p><input class="e-input" type="time" value=${time} aria-label=${t('or_conf_time')} onInput=${(e) => setTime(e.currentTarget.value)} />
    <button class="btn accent block" style="margin-top:18px" disabled=${busy || (!n && !time)} onClick=${save}>${t('or_save')}</button>
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}
export function OrdPaidSheet({ o }) {
  const [sum, setSum] = useState(ordField(o.total ?? (o.unknown ? null : o.total_est), o.currency));
  const [busy, setBusy] = useState(false);
  const n = ordAmount(sum, o.currency);
  const save = async () => {
    setBusy(true);
    try { await ordPost('status', { order_id: o.id, action: 'delivered', total: n }); hap.ok(); toast(t('or_paid_toast')); closeSheet(); load(D().search.id, { quiet: true }); } catch (e) { toast(e.code === 'order_changed' ? t('or_already') : t('err_generic')); }
    setBusy(false);
  };
  return html`<h2>${t('or_paid_t')}</h2>
    <div class="amount-in"><input inputmode="decimal" value=${sum} placeholder="205" aria-label=${t('or_paid_t')} onInput=${(e) => setSum(e.currentTarget.value)} /><span>${o.currency === 'IDR' ? t('or_thou') : o.currency}</span></div>
    <p class="amount-hint">${n ? ordMoney(n, o.currency) + ' · ' : ''}${t('or_paid_hint')}</p>
    <button class="btn accent block" style="margin-top:14px" disabled=${busy || !n} onClick=${save}>${t('or_delivered')}</button>
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}
/** The order's receipt inside the expense (Деньги): same paper. */
export function OrderReceiptOf({ id }) {
  const d = D();
  const [o, setO] = useState(() => ordFind(id));
  useEffect(() => { if (!o) api(`/app/api/order?s=${encodeURIComponent(d.search.id)}&id=${encodeURIComponent(id)}`).then((j) => setO(j.order)).catch(() => null); }, [id]);
  return o ? html`<div class="or-exp"><${Receipt} o=${o} slot=${false} date=${fmtDM(o.delivered_at ?? o.updated_at)} /></div>` : html`<div class="skeleton" style="height:160px"></div>`;
}

// ---- sets ("Наборы", approved design/mockup-v5/sets-*): a saved basket of one supplier; "В корзину" adds it to the basket,
// an optional reminder in Telegram (the order never goes by itself). Clearing the basket asks first and can be undone.
Object.assign(STR.ru, {
  st_title: 'Наборы', st_save: 'Сохранить как набор', st_name: 'Название набора', st_clear_name: 'Стереть название', st_taken: 'Такой набор уже есть. Придумайте другое название',
  st_long: 'Не длиннее 40 символов', st_need_name: 'Как назовём набор?', st_now: 'сейчас {x}', st_remind: 'Напоминать', st_r_none: 'Нет', st_r_weekly: 'Каждую неделю', st_r_biweekly: 'Раз в 2 недели',
  st_later: 'Можно включить потом. Hunt будет писать в Telegram, а заказ отправите сами', st_at: 'Во сколько', st_days: 'Дни недели',
  st_hint: '{d} в {t} Hunt напишет {who} в Telegram. Сам заказ не уйдёт: соберёте и отправите, как обычно', st_both: 'вам обоим', st_all: 'всем вам', st_you: 'вам',
  st_to_basket: 'В корзину', st_from: 'Из набора', st_delete: 'Удалить набор', st_delete_q: 'Удалить набор «{n}»? Корзину это не тронет', st_deleted: 'Набор удалён', st_rename: 'Переименовать',
  st_rename_ok: 'Готово', st_saved: 'Сохранили набор «{n}»', st_added: 'Набор в корзине', st_gone: 'Этого набора больше нет', st_empty: 'Ничего из набора больше нет в прайсе',
  st_gone_n: (n) => `${n} ${pl(n, 'позиции', 'позиций', 'позиций')} больше нет в прайсе, их не добавим`, st_cleared: (n) => `Убрали ${n} ${pl(n, 'позицию', 'позиции', 'позиций')}`,
  st_restored: 'Вернули в корзину', st_restore_late: 'Вернуть уже нельзя', st_on: '{n} на {x}', st_by_you: 'добавляли вы', st_by_both: 'добавляли вы оба', st_by: 'добавляли {n}',
  st_undo_hint: 'Если передумаете, можно вернуть', st_keep: 'Оставить', st_again: 'Повторить', st_empty_again: 'Корзина снова пустая', st_empty_again_s: 'всё из неё уехало в этот заказ',
  st_rcpt_row: 'Чек, {n} · расход в Деньгах', st_rep_w: 'по {d}', st_rep_b: 'раз в 2 недели, {d}', st_w_empty: 'Пусто',
  st_def_fruit: 'Фрукты на неделю', st_def_fish: 'Рыба на ужин', st_def_other: '{s}: как обычно',
});
Object.assign(STR.en, {
  st_title: 'Sets', st_save: 'Save as a set', st_name: 'Set name', st_clear_name: 'Clear the name', st_taken: 'There is a set with this name. Pick another one',
  st_long: 'Up to 40 characters', st_need_name: 'Name the set', st_now: 'now {x}', st_remind: 'Remind', st_r_none: 'No', st_r_weekly: 'Every week', st_r_biweekly: 'Every 2 weeks',
  st_later: 'You can turn it on later. Hunt writes in Telegram, you send the order yourselves', st_at: 'At', st_days: 'Weekdays',
  st_hint: '{d} at {t} Hunt messages {who} in Telegram. The order never goes by itself: you fill and send it as usual', st_both: 'you both', st_all: 'all of you', st_you: 'you',
  st_to_basket: 'To the basket', st_from: 'From a set', st_delete: 'Delete the set', st_delete_q: 'Delete the set “{n}”? The basket stays as it is', st_deleted: 'Set deleted', st_rename: 'Rename',
  st_rename_ok: 'Done', st_saved: 'Saved “{n}”', st_added: 'The set is in the basket', st_gone: 'This set is gone', st_empty: 'Nothing from this set is on the price list any more',
  st_gone_n: (n) => `${n} ${pl(n, 'item is', 'items are')} no longer on the list and won’t be added`, st_cleared: (n) => `Removed ${n} ${pl(n, 'item', 'items')}`,
  st_restored: 'Back in the basket', st_restore_late: 'Too late to bring it back', st_on: '{n} for {x}', st_by_you: 'you added them', st_by_both: 'you both added them', st_by: 'added by {n}',
  st_undo_hint: 'Changed your mind? You can bring it back', st_keep: 'Keep', st_again: 'Repeat', st_empty_again: 'The basket is empty again', st_empty_again_s: 'everything went into this order',
  st_rcpt_row: 'Receipt, {n} · an expense in Money', st_rep_w: 'every {d}', st_rep_b: 'every 2 weeks, {d}', st_w_empty: 'Empty',
  st_def_fruit: 'Fruit for the week', st_def_fish: 'Fish for dinner', st_def_other: '{s}, the usual',
});
Object.assign(ICONS, {
  'bookmark-plus': '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/><path d="M12 7v6"/><path d="M15 10H9"/>',
  'alarm-clock': '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/><path d="M6.38 18.7 4 21"/><path d="M17.64 18.67 20 21"/>',
});
export const SET_WD = { ru: ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'], en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] };
export const setWd = (i) => (SET_WD[LANG] ?? SET_WD.en)[i];
/** Sets of a supplier (or all of them), in the order they were made. */
export const ordSets = (sup) => (OR.v?.sets ?? []).filter((x) => !sup || x.supplier_id === sup);
/** What goes into the basket: items the supplier still lists. */
export const setLines = (st) => st.lines.filter((l) => !l.gone);
/** "по пн, чт", "раз в 2 недели, пн", "" without a reminder. */
export function setRepeatTxt(st) {
  if (st.repeat === 'none' || !st.days) return '';
  const d = [0, 1, 2, 3, 4, 5, 6].filter((i) => st.days & (1 << i)).map(setWd).join(', ');
  return t(st.repeat === 'biweekly' ? 'st_rep_b' : 'st_rep_w', { d });
}
/** Mirrors src/order-sets.ts nameKey / defaultSetName. */
export const setKey = (s) => String(s ?? '').toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
export function setDefaultName(su) {
  const base = (su?.kind === 'fruit' ? t('st_def_fruit') : su?.kind === 'fish' ? t('st_def_fish') : t('st_def_other', { s: su?.name ?? '' })).slice(0, 40);
  const taken = new Set(ordSets().map((x) => setKey(x.name)));
  let name = base;
  for (let n = 2; taken.has(setKey(name)) && n < 100; n++) name = `${base.slice(0, 40 - String(n).length - 1)} ${n}`;
  return name;
}
/** Live prices for lines of a set or an old order (items no longer listed drop out); as they are without the catalog. */
export const setLive = (lines) => (OR.items ? lines.map((l) => { const it = ordItem(l.item_id); return it ? { ...l, price: it.price, unsure: it.unsure, toy: it.toy ?? l.toy } : null; }).filter(Boolean) : lines.filter((l) => !l.gone));
export async function setApply(st) {
  hap.impact('medium');
  try {
    await ordFlushAll();
    const j = await ordPost('set-apply', { set_id: st.id });
    closeSheet();
    toast(j.gone ? `${t('st_added')}. ${t('st_gone_n', { n: j.gone })}` : t('st_added'));
    go(sp('basket', j.supplier_id));
  } catch (e) { toast(e.code === 'set_empty' ? t('st_empty') : e.code === 'too_many_lines' ? t('err_generic') : e.code === 'no_set' ? t('st_gone') : t('err_generic')); }
}
export async function ordRestore(oid) {
  try { await ordPost('restore', { order_id: oid }); hap.ok(); toast(t('st_restored')); }
  catch (e) { toast(e.code === 'restore_expired' || e.code === 'nothing_to_restore' ? t('st_restore_late') : t('err_generic')); }
}
/** The repeat chips, the weekdays and the time; `onChange({repeat, days, time})` with only what changed. */
export function SetRepeat({ repeat, days, time, can = true, onChange }) {
  return html`<div class="st-rep">
    <h3 class="st-h3">${t('st_remind')}</h3>
    <div class="st-chips" role="group" aria-label=${t('st_remind')}>${['none', 'weekly', 'biweekly'].map((r) => html`<button key=${r} class="or-pill" disabled=${!can} aria-pressed=${repeat === r ? 'true' : 'false'}
      onClick=${() => repeat !== r && onChange(r === 'none' ? { repeat: r } : { repeat: r, days: days || 1 })}>${t('st_r_' + r)}</button>`)}</div>
    ${repeat !== 'none' && html`<div class="st-days" role="group" aria-label=${t('st_days')}>${[0, 1, 2, 3, 4, 5, 6].map((i) => html`<button key=${i} class="st-day" disabled=${!can} aria-pressed=${days & (1 << i) ? 'true' : 'false'}
        onClick=${() => { const m = days ^ (1 << i); if (m) onChange({ days: m }); }}>${setWd(i)}</button>`)}</div>
      <div class="st-at"><span>${t('st_at')}</span><label class="st-time"><${Icon} n="alarm-clock" cls="sm" /><input type="time" value=${time} disabled=${!can} aria-label=${t('st_at')}
        onChange=${(e) => { const v = e.currentTarget.value; if (/^\d\d:\d\d$/.test(v) && v !== time) onChange({ time: v }); }} /></label></div>`}
  </div>`;
}
/** 4 · a tile of the "Наборы" row on the counter: toys, the name, the repeat or the other supplier, the range. */
export function SetTile({ st, cur }) {
  const su = ordSup(st.supplier_id);
  const ls = setLive(setLines(st));
  const r = ordSpread(ls, su);
  const rep = setRepeatTxt(st);
  return html`<button class="st-tile" data-k=${su?.kind === 'fish' ? 'fish' : 'fruit'} onClick=${() => { hap.sel(); openSheet('ord_set', st.id); }}>
    <span class="st-tile-art" aria-hidden="true">${ls.slice(0, 3).map((l, i) => html`<${Good} key=${l.item_id} slug=${l.toy} size=${i ? 58 : 72} rot=${ordRot(i)} shadow=${false} />`)}</span>
    <i class="st-dot" aria-hidden="true"></i>
    <b>${st.name}</b>
    <span class="st-tile-s">${rep && html`<${Icon} n="repeat" cls="xs" />`}${[rep, st.supplier_id !== cur ? su?.name : null, t('or_pos', { n: ls.length })].filter(Boolean).join(' · ')}</span>
    ${r && html`<span class="st-tile-r">${ordRangeStr(r.lo, r.hi, r.cur)}</span>`}
  </button>`;
}
/** 3 · under an empty basket: "Из набора" rows of this supplier. */
export function SetRows({ sup }) {
  const list = ordSets(sup);
  if (!list.length || !ordCan()) return null;
  const su = ordSup(sup);
  return html`<section class="st-from"><h2 class="st-cap">${t('st_from')}</h2>${list.map((st) => {
    const ls = setLive(setLines(st));
    const r = ordSpread(ls, su);
    return html`<div class="st-row" key=${st.id}><button class="st-row-m" onClick=${() => { hap.sel(); openSheet('ord_set', st.id); }}><span class="or-hart" aria-hidden="true">${ls.slice(0, 3).map((l, i) => html`<${Good} key=${l.item_id} slug=${l.toy} size=${40} rot=${ordRot(i)} shadow=${false} />`)}</span>
      <span class="grow"><b>${st.name}</b><span>${[t('or_pos', { n: ls.length }), r ? ordRangeStr(r.lo, r.hi, r.cur).replace(/ /g, '\u00a0') : null].filter(Boolean).join(' · ')}</span></span></button>
      <button class="btn surface sm" onClick=${() => setApply(st)}>${t('st_to_basket')}</button></div>`;
  })}</section>`;
}
/** 2 · "Убрать всё из корзины?" with what goes and who added it; the toast afterwards brings it back. */
export function OrdClearSheet({ sup }) {
  useStore();
  const [busy, setBusy] = useState(false);
  const b = ordBasket(sup);
  const s = ordSup(sup);
  const r = ordSpread(b.lines, s);
  const me = D().user.id;
  const by = [...new Set(b.lines.map((l) => l.by))];
  const ms = by.map(memberById).filter(Boolean);
  const who = by.length === 1 && by[0] === me ? t('st_by_you') : by.length === 2 && by.includes(me) ? t('st_by_both') : t('st_by', { n: ms.map((m) => firstName(m.name)).join(', ') });
  const clear = async () => {
    setBusy(true);
    try {
      await ordFlushAll();
      const id = OR.v.baskets.find((x) => x.supplier_id === sup)?.id ?? '';
      const j = await ordPost('clear', { order_id: id });
      closeSheet();
      hap.ok();
      if (j.cleared) toast(t('st_cleared', { n: j.cleared.n }), { label: t('undo'), icon: 'undo', run: () => ordRestore(j.cleared.order_id) }, 8000);
    } catch { toast(t('err_generic')); }
    setBusy(false);
  };
  return html`<div class="st-clear-h"><h2>${t('or_clear_q')}</h2><span class="st-avs" aria-hidden="true">${ms.slice(0, 3).map((m) => html`<${Av} key=${m.user_id} m=${m} size=${44} free />`)}</span></div>
    <p class="st-p">${[r ? t('st_on', { n: t('or_pos', { n: b.count }), x: ordRangeStr(r.lo, r.hi, r.cur) }) : t('or_pos', { n: b.count }), ms.length ? who : null].filter(Boolean).join(', ')}.<br />${t('st_undo_hint')}</p>
    <div class="st-col"><button class="btn accent big block" disabled=${busy || !b.count} onClick=${clear}><${Icon} n="trash-2" cls="sm" />${t('or_clear')}</button>
      <button class="btn surface big block" onClick=${closeSheet}>${t('st_keep')}</button></div>`;
}
/** 6 · "Сохранить как набор" from the basket (`from` = its id) or from an earlier order (`lines` = its lines). */
export function OrdSaveSheet({ arg }) {
  useOrders(true);
  const su = ordSup(arg.sup);
  const [name, setName] = useState(() => setDefaultName(su));
  const [sc, setSc] = useState({ repeat: 'none', days: 1, time: '09:00' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const ls = setLive(arg.lines ?? ordBasket(arg.sup).lines);
  const r = ordSpread(ls, su);
  const save = async () => {
    const n = name.trim();
    if (!n) { setErr(t('st_need_name')); return; }
    setBusy(true);
    try {
      await ordPost('set-save', { from_order_id: arg.from, name: n, repeat: sc.repeat, ...(sc.repeat !== 'none' ? { days: sc.days, time: sc.time } : {}) });
      hap.ok();
      closeSheet();
      toast(t('st_saved', { n }));
    } catch (e) {
      if (e.code === 'name_taken') setErr(t('st_taken')); else if (e.code === 'too_long') setErr(t('st_long')); else toast(t('err_generic'));
    }
    setBusy(false);
  };
  return html`<h2>${t('st_save')}</h2>
    <label class="st-in"><input class="st-input" maxlength="40" value=${name} aria-label=${t('st_name')} aria-invalid=${err ? 'true' : 'false'} enterkeyhint="done"
      onInput=${(e) => { setName(e.currentTarget.value); setErr(null); }} onKeyDown=${(e) => e.key === 'Enter' && save()} />${name && html`<button class="st-x" aria-label=${t('st_clear_name')} onClick=${() => { setName(''); setErr(null); }}><${Icon} n="x" cls="sm" /></button>`}</label>
    ${err && html`<p class="st-err" role="alert">${err}</p>`}
    <div class="st-sum"><span class="st-sum-art" aria-hidden="true">${ls.slice(0, 4).map((l, i) => html`<${Good} key=${l.item_id} slug=${l.toy} size=${58} rot=${ordRot(i)} shadow=${false} />`)}</span>
      <span class="grow"><b>${[su?.name, t('or_pos', { n: ls.length })].filter(Boolean).join(', ')}</b>${r && html`<span>${t('st_now', { x: ordRangeStr(r.lo, r.hi, r.cur) })}</span>`}</span></div>
    <${SetRepeat} repeat=${sc.repeat} days=${sc.days} time=${sc.time} onChange=${(x) => setSc((o) => ({ ...o, ...x }))} />
    <p class="st-hint0">${t('st_later')}</p>
    <div class="st-btns"><button class="btn accent big grow" disabled=${busy || !ls.length} onClick=${save}><${Icon} n="bookmark-plus" cls="sm" />${t('or_save')}</button>
      <button class="btn surface big" onClick=${closeSheet}>${t('cancel')}</button></div>`;
}
/** 5 · one set: rename, what is in it, the money, the reminder (saved as you tap), "В корзину", delete. */
export function OrdSetSheet({ id }) {
  useStore();
  useOrders(true);
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState('');
  const [err, setErr] = useState(null);
  const st = ordSets().find((x) => x.id === id);
  if (!st) return html`<h2>${t('st_gone')}</h2><button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
  const su = ordSup(st.supplier_id);
  const ls = setLive(setLines(st));
  const gone = st.lines.length - ls.length;
  const r = ordSpread(ls, su);
  const can = ordCan();
  const rep = setRepeatTxt(st);
  const patch = async (body) => {
    try { await ordPost('set-edit', { set_id: st.id, ...body }); hap.sel(); return true; }
    catch (e) { if (e.code === 'name_taken') setErr(t('st_taken')); else if (e.code === 'too_long') setErr(t('st_long')); else toast(t('err_generic')); return false; }
  };
  const saveName = async () => {
    const n = name.trim();
    if (!n || n === st.name) { setEdit(false); setErr(null); return; }
    if (await patch({ name: n })) { setEdit(false); setErr(null); }
  };
  const del = async () => {
    if (!(await askConfirm(t('st_delete_q', { n: st.name })))) return;
    try { await ordPost('set-delete', { set_id: st.id }); closeSheet(); toast(t('st_deleted')); } catch { toast(t('err_generic')); }
  };
  const n = votersN();
  const hint = st.repeat !== 'none' && st.next
    ? t('st_hint', { d: `${dfmt(st.next.day, { weekday: 'short' }).replace('.', '')} ${fmtDM(st.next.day)}`, t: hm(st.next.time), who: t(n === 2 ? 'st_both' : n > 2 ? 'st_all' : 'st_you') }) : null;
  return html`<div class="st-sh-h">
      ${edit ? html`<input class="st-input st-name-in" maxlength="40" value=${name} aria-label=${t('st_name')} enterkeyhint="done" ref=${(el) => el && !el.dataset.f && (el.dataset.f = 1, el.focus())}
          onInput=${(e) => { setName(e.currentTarget.value); setErr(null); }} onKeyDown=${(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { e.stopPropagation(); setEdit(false); setErr(null); } }} />`
        : html`<h2 class="st-name">${st.name}</h2>`}
      ${can && html`<button class="round st-edit" aria-label=${edit ? t('st_rename_ok') : t('st_rename')} onClick=${() => (edit ? saveName() : (setName(st.name), setErr(null), setEdit(true)))}><${Icon} n=${edit ? 'check' : 'pencil'} /></button>`}</div>
    ${err && html`<p class="st-err" role="alert">${err}</p>`}
    <p class="st-sub">${[su?.name, t('or_pos', { n: ls.length })].filter(Boolean).join(' · ')}${rep && html`<span class="st-sub-r"> · <${Icon} n="repeat" cls="sm" />${rep}</span>`}</p>
    <div class="st-strip" aria-hidden="true">${ls.slice(0, 7).map((l, i) => html`<${Good} key=${l.item_id} slug=${l.toy} size=${62} rot=${ordRot(i)} shadow=${false} />`)}${ls.length > 7 && html`<span class="st-more">+${ls.length - 7}</span>`}</div>
    <p class="st-names">${ordNames(ls, 7)}</p>
    ${gone > 0 && html`<p class="st-gone">${t('st_gone_n', { n: gone })}</p>`}
    ${r && html`<${OrdSpread} sp=${r} bare />`}
    <${SetRepeat} repeat=${st.repeat} days=${st.days} time=${st.time} can=${can} onChange=${patch} />
    ${hint && html`<p class="st-hint"><${Icon} n="send" cls="sm" /><span>${hint}</span></p>`}
    ${can && html`<div class="st-btns"><button class="btn accent big grow" disabled=${!ls.length} onClick=${() => setApply(st)}><${Icon} n="basket" cls="sm" />${t('st_to_basket')}</button>
      <button class="round st-del" aria-label=${t('st_delete')} onClick=${del}><${Icon} n="trash-2" /></button></div>`}`;
}
/** The Telegram reminder's "Собрать корзину" lands here: the set goes into the basket, then the basket opens. */
export function SetApplyScreen({ id }) {
  const { v } = useOrders();
  const [fail, setFail] = useState(null);
  useEffect(() => {
    if (!v) return undefined;
    let live = true;
    ordPost('set-apply', { set_id: id }).then((j) => { if (!live) return; toast(j.gone ? `${t('st_added')}. ${t('st_gone_n', { n: j.gone })}` : t('st_added')); go(sp('basket', j.supplier_id), true); })
      .catch((e) => live && setFail(e.code ?? 'x'));
    return () => { live = false; };
  }, [!!v, id]);
  if (fail) return html`<main class="screen no-nav or-scr"><${BackRound} />${msgCard(fail === 'no_set' ? t('st_gone') : fail === 'set_empty' ? t('st_empty') : fail === 'viewer' ? t('or_view_only') : t('err_generic'))}
    <button class="btn accent" onClick=${() => go(sp('shop'), true)}>${t('or_to_shop')}</button></main>`;
  return html`<main class="screen no-nav or-scr"><${BackRound} />${skel(420)}</main>`;
}

// ---- orders hub: what is on its way, the suppliers, the receipts
export function OrdersScreen() {
  const { v, err } = useOrders();
  if (err) return html`<main class="screen w2">${msgCard(t('err_generic'))}<${Nav} tab="more" /></main>`;
  if (!v) return html`<main class="screen w2 or-scr">${skel(200)}</main>`;
  const row = (o) => html`<button key=${o.id} class="or-hrow" onClick=${() => { hap.sel(); go(sp('order', o.id)); }}><span class="or-hart" aria-hidden="true">${o.lines.slice(0, 3).map((l, i) => html`<${Good} key=${l.item_id} slug=${l.toy} size=${40} rot=${ordRot(i)} shadow=${false} />`)}</span>
    <span class="grow"><b>${o.lines.map((l) => ordName(l).split(/[,(]/)[0].trim()).join(', ') || o.supplier}</b><span>${[o.supplier, o.status === 'delivered' ? fmtDM(o.delivered_at) : t('or_s_' + o.status)].join(' · ')}</span></span>
    <span class="or-hsum">${o.status === 'cancelled' ? '' : ordMoney(o.total ?? o.total_est ?? (o.sum || null), o.currency)}</span></button>`;
  return html`<main class="screen w2 or-scr">
    <${BackRound} />
    <section class="w8-hero or-hub"><${BigWord} text=${t('or_w_fruit')} cls="or-word" /><h1 class="w8-title">${t('or_title')}</h1></section>
    <div class="or-sups">${v.suppliers.map((s, i) => { const b = ordBasket(s.id); return html`<button key=${s.id} class="or-sup" onClick=${() => { hap.sel(); go(sp('shop', s.id)); }}><${Good} slug=${s.kind === 'fish' ? 'snapper' : s.kind === 'fruit' ? 'mango' : 'sack'} size=${112} rot=${ordRot(i)} /><b>${s.name}</b><span>${b.count ? t('or_in_basket', { n: b.count }) : ordTab(s)}</span></button>`; })}
      <button class="or-sup" onClick=${() => { hap.sel(); go(sp('shop', 'services')); }}><${Good} slug="spray" size=${112} rot=${-6} /><b>${t('or_services')}</b><span>${(D().house_contacts ?? []).filter(svOk).map((c) => c.name).slice(0, 2).join(', ')}</span></button></div>
    ${!v.suppliers.length && html`<p class="w8-sub">${t('or_no_sup_s')}</p>`}
    ${v.active.length > 0 && html`<section class="or-grp"><h2>${t('or_active')}</h2>${v.active.map(row)}</section>`}
    <section class="or-grp"><h2>${t('or_hist')}</h2>${v.history.length ? v.history.map(row) : html`<p class="or-none">${t('or_hist_none')}</p>`}</section>
    <${Nav} tab="more" />
  </main>`;
}

// ---- H · services: the house contacts, only what is really written there
export const svOk = (c) => ['cleaning', 'pool', 'garden', 'other'].includes(c.role);
export const SV_RE = /massage|массаж|pijat|clean|уборк|pool|бассейн|laundry|прач|стирк|garden|сад/i;
export const SV_WD = [['sun', 'su', 'вс', 'воскр', 'minggu'], ['mon', 'mo', 'пн', 'понед', 'senin'], ['tue', 'tu', 'вт', 'вторн', 'selasa'], ['wed', 'we', 'ср', 'сред', 'rabu'], ['thu', 'th', 'чт', 'четв', 'kamis'], ['fri', 'fr', 'пт', 'пятн', 'jumat'], ['sat', 'sa', 'сб', 'субб', 'sabtu']];
/** "вт, пт" / "Tue, Fri" → [2, 5]; anything that is not a list of weekdays → null (nothing is invented). */
export function svDays(s) {
  const parts = String(s ?? '').toLowerCase().split(/[,;/]| и | and /).map((x) => x.trim().replace(/\.$/, '')).filter(Boolean);
  if (!parts.length) return null;
  const out = parts.map((p) => SV_WD.findIndex((k) => k.some((y) => p === y || (y.length > 2 && p.startsWith(y)))));
  return out.includes(-1) ? null : [...new Set(out)];
}
export function svNext(days) {
  if (!days?.length) return null;
  const wd = asDate(hmToday()).getUTCDay();
  const n = Math.min(...days.map((x) => (x - wd + 7) % 7));
  return { n, wd: (wd + n) % 7, day: addDays(hmToday(), n) };
}
export const svCost = (c, sep = ' ') => (c.cost ? `${ordMoney(c.cost, c.currency ?? 'IDR')}${sep}${t('or_per_' + (c.period ?? 'visit'))}` : c.payer === 'rent' ? t('or_sv_rent') : '');
export const svToy = (c) => (c.role === 'pool' || /pool|бассейн/i.test(c.subtitle ?? '') ? 'ring' : /massage|массаж|pijat/i.test(`${c.name} ${c.subtitle ?? ''} ${c.note ?? ''}`) ? 'flower' : 'spray');
export function ServicesScreen() {
  const d = D();
  useOrders();
  const sup = new Set((OR.v?.suppliers ?? []).map((s) => s.dir_entry_id).filter(Boolean));
  const list = [...(d.house_contacts ?? []).filter(svOk), ...(d.directory ?? []).filter((e) => !sup.has(e.id) && SV_RE.test(`${e.name} ${e.subtitle ?? ''}`)).map((e) => ({ ...e, role: 'dir' }))];
  const ORD = { cleaning: 0, pool: 1, garden: 2 };
  list.sort((a, b) => (ORD[a.role] ?? 5) - (ORD[b.role] ?? 5));
  const [sel, setSel] = useState(null);
  const c = list.find((x) => x.id === sel) ?? list[0];
  if (!c) return html`<main class="screen or-scr"><${OrdTabs} cur="services" /><section class="or-empty"><${Good} slug="spray" size=${200} rot=${-6} big /><${Typed} lines=${[t('or_sv_none')]} as="h1" /><p class="w8-sub">${t('or_sv_none_s')}</p><button class="btn accent" onClick=${() => go(sp('directory'))}>${t('or_sv_contacts')}</button></section><${Nav} tab="more" /></main>`;
  const days = svDays(c.schedule);
  const nx = svNext(days);
  const toyOf = svToy(c);
  const side = ['ring', 'flower', 'spray'].filter((x) => x !== toyOf);
  const link = channelLink(c.channel, c.address);
  const role = c.role === 'dir' ? c.subtitle : c.role === 'other' ? c.note : roleLabelHC(c.role);
  const when = nx ? (nx.n === 0 ? t('or_sv_today') : nx.n === 1 ? t('or_sv_tomorrow') : t('or_wd_acc', { n: nx.wd })) : null;
  const move = link && c.channel === 'whatsapp' ? `${link}?text=${encodeURIComponent(`Halo ${c.name}, apakah jadwal bisa dipindah ke hari lain? Terima kasih`)}` : null;
  const wds = [1, 2, 3, 4, 5, 6, 0];
  return html`<main class="screen or-scr or-sv">
    <${OrdTabs} cur="services" />
    <section class="w8-hero or-sv-h">
      <${BigWord} text=${t(c.role === 'cleaning' ? 'or_sv_w_cleaning' : c.role === 'pool' ? 'or_sv_w_pool' : 'or_sv_w')} cls="or-word ink" />
      <span class="or-peek l"><${Good} slug=${side[0]} size=${104} rot=${-10} shadow=${false} /></span><span class="or-peek r"><${Good} slug=${side[1]} size=${104} rot=${12} shadow=${false} /></span>
      <div class="or-art" key=${c.id}><${Good} slug=${toyOf} size=${250} rot=${-6} big /></div>
      ${svCost(c) && html`<${Sticker} text=${svCost(c, '\n')} cls="lg br" style="right:0;top:0;--r:12deg" />`}
    </section>
    <${Typed} key=${c.id} lines=${[when ? t('or_sv_next_t', { n: c.name, d: when }) : c.name]} as="h1" />
    <p class="w8-sub">${[role, nx ? fmtDM(nx.day) : c.schedule || t('or_sv_days0'), c.role !== 'dir' && c.role !== 'other' ? c.note : null].filter(Boolean).join(' · ')}</p>
    ${days && html`<div class="or-days" role="img" aria-label=${c.schedule}>${wds.map((w) => html`<span key=${w} class=${days.includes(w) ? 'on' : ''}>${dfmt(`2026-11-${String(22 + w).padStart(2, '0')}`, { weekday: 'short' }).replace('.', '').slice(0, LANG === 'ru' ? 2 : 3)}</span>`)}</div>`}
    <div class="or-two big">${link && html`<button class="btn accent big" onClick=${() => openLink(link)}>${t('or_write')}</button>`}${!link && c.phone && html`<button class="btn accent big" onClick=${() => openLink(telLink(c.phone))}>${t('dr_call')}</button>`}${move && days && html`<button class="btn surface big" onClick=${() => openLink(move)}>${t('or_sv_move')}</button>`}</div>
    ${list.length > 1 && html`<div class="or-list">${list.filter((x) => x !== c).map((x) => html`<button key=${x.id} class="or-hrow" onClick=${() => { hap.sel(); setSel(x.id); scrollTo(0, 0); }}><${Good} slug=${svToy(x)} size=${44} shadow=${false} /><span class="grow"><b>${cap([x.role !== 'dir' && x.role !== 'other' ? roleLabelHC(x.role) : null, x.name].filter(Boolean).join(', '))}</b><span>${[x.schedule, svCost(x), x.role === 'dir' ? x.subtitle : null].filter(Boolean).join(' · ')}</span></span><${Icon} n="arrow-up-right" cls="sm" /></button>`)}</div>`}
    <${Nav} tab="more" />
  </main>`;
}

// ---- Home: the order on its way and the quick pills
export function OrderTicket({ o }) {
  const st = { opened: 1, draft: 1, sent: 1, confirmed: 2 }[o.status] ?? 1;
  const sub = [o.total ? (o.time ? ordMoney(o.total, o.currency) : t('or_tk_x', { x: ordMoney(o.total, o.currency) })) : o.supplier, o.time ? `${o.day && hmDays(o.day) !== 0 ? ordDay(o.day) + ' ' : ''}${t('or_tk_by', { t: hm(o.time) })}` : null].filter(Boolean).join(' · ');
  return html`<button class="or-ticket" onClick=${() => { hap.sel(); go(sp('order', o.id)); }}><span class="or-ticket-art"><${Good} slug="scooter" size=${118} rot=${-6} shadow=${false} /></span>
    <span class="grow"><b>${t('or_tk_' + o.status)}</b><span>${sub}</span><i class="or-seg" aria-hidden="true">${[0, 1, 2].map((k) => html`<u class=${k < st ? 'on' : ''}></u>`)}</i></span><span class="or-ticket-go"><${Icon} n="arrow-up-right" cls="sm" /></span></button>`;
}
export function OrderHome() {
  const { v } = useOrders();
  if (!v || !v.suppliers.length) return null;
  const can = ordCan();
  const n = v.suppliers.reduce((a, s) => a + ordBasket(s.id).count, 0);
  const last = ordLast();
  const first = v.baskets[0]?.supplier_id ?? last?.supplier_id ?? v.suppliers[0].id;
  return html`<div class="or-home">
    ${v.active.slice(0, 2).map((o) => html`<${OrderTicket} key=${o.id} o=${o} />`)}
    ${can && html`<div class="or-home-p"><button class="btn surface" onClick=${() => { hap.sel(); go(sp('shop', first)); }}><${Icon} n="basket" cls="sm" />${n ? t('or_home_n', { n }) : t('or_home')}</button>
      ${last && html`<button class="btn surface" onClick=${() => ordAgain()}><${Icon} n="repeat" cls="sm" />${t('or_again')}</button>`}</div>`}
  </div>`;
}
/** Contacts: a supplier's card opens its shop. */
export const ordSupOfDir = (dirId) => (OR.v?.suppliers ?? []).find((s) => s.dir_entry_id && s.dir_entry_id === dirId) ?? null;

export function Sheet() {
  const sh = S.sheet;
  const ref = useRef(null);
  useEffect(() => { ref.current?.querySelector('button')?.focus(); }, [sh?.kind]);
  if (!sh) return null;
  const d = D();
  let body = null;
  if (sh.kind === 'new_search') body = html`<h2>${t('new_search')}</h2><p class="muted" style="margin:0 0 16px">${t('new_search_text')}</p><button class="btn accent block" onClick=${closeSheet}>${t('close')}</button>`;
  if (sh.kind === 'settings') {
    const me = d.members?.find((m) => m.user_id === d.user.id);
    const setLang = async (l) => {
      if (l === LANG) return;
      hap.sel();
      applyLang(l);
      d.user.lang = l;
      emit();
      api('/app/api/lang', { lang: l }).catch(() => toast(t('err_generic')));
    };
    const reroll = async () => {
      hap.sel();
      try {
        const r = await api('/app/api/reroll-animal', { search_id: d.search.id });
        d.me.animal = r.animal;
        if (me) me.animal = r.animal;
        emit();
      } catch { toast(t('err_generic')); }
    };
    body = html`<h2>${t('settings')}</h2>
      <p class="section" style="margin-top:0">${t('language')}</p>
      <div class="seg full" role="group" style="margin-bottom:18px">
        <button aria-pressed=${LANG === 'ru' ? 'true' : 'false'} onClick=${() => setLang('ru')}>Русский</button>
        <button aria-pressed=${LANG === 'en' ? 'true' : 'false'} onClick=${() => setLang('en')}>English</button>
      </div>
      <p class="section" style="margin-top:0">${t('theme')}</p>
      <div class="seg full" role="group" style="margin-bottom:6px">
        ${['light', 'dark', 'auto'].map((v) => html`<button aria-pressed=${themePref() === v ? 'true' : 'false'} onClick=${() => { hap.sel(); setThemePref(v); emit(); }}>${t('th_' + v)}</button>`)}
      </div>
      <p class="sub" style="margin:0 0 18px;font-size:13px;opacity:.7">${themePref() === 'auto' ? t('th_auto_sub') : ''}</p>
      ${!inTG && !linkKey && html`<${Sessions} />`}
      ${d.search && !isGuest() && html`<p class="section" style="margin-top:0">${t('notifications')}</p>
      <div class="card grp">
        <${Toggle} on=${d.me.notify} label=${t('n_bot')} sub=${t('n_bot_sub')} onChange=${(v) => { hap.sel(); d.me.notify = v; emit(); api('/app/api/prefs', { search_id: d.search.id, notify: v }).catch(() => toast(t('err_generic'))); }} />
        <${Toggle} on=${d.me.digest} label=${t('n_digest')} sub=${t('n_digest_sub')} onChange=${(v) => { hap.sel(); d.me.digest = v; emit(); api('/app/api/prefs', { search_id: d.search.id, digest: v }).catch(() => toast(t('err_generic'))); }} />
        ${(d.me.surf || S.regions?.[d.search.country]?.places) && html`<${Toggle} on=${!!d.me.surf} label=${t('sf_pref')} sub=${d.me.surf_auto ? t('sf_pref_auto') : t('sf_pref_sub')} onChange=${(v) => setSurfPref(v)} />`}
      </div>`}
      ${d.search && !isGuest() && html`<p class="section" style="margin-top:0">${t('members')}</p>
      <div class="card grp">${d.members.map((m) => html`<div class="opt"><${Av} m=${m} size=${40} /><div class="grow"><div>${m.name}</div><div class="muted" style="font-size:13px">${m.animal ? m.animal.name[LANG] ?? m.animal.name.en : ''}</div></div>
        ${m.user_id === d.user.id && html`<button class="btn link" onClick=${reroll}><${Icon} n="shuffle" cls="sm" />${t('another')}</button>`}</div>`)}</div>
      ${d.search.invite_link && html`<button class="btn accent block" style="margin-bottom:10px" onClick=${() => inviteFriends(d.search)}><${Icon} n="userplus" />${t('invite')}</button>`}
      ${d.deal && canVoteRole(d.me.role) && html`<button class="btn surface block" style="margin-bottom:10px" onClick=${() => { closeSheet(); go(sp('guests')); }}><${Icon} n="users" />${t('gi_title')}</button>`}`}
      ${d.search && !isGuest() && !homeMode() && html`<button class="btn surface block" style="margin-bottom:10px" onClick=${() => { closeSheet(); go(sp('afisha')); }}><${Icon} n="ticket" />${t('af_title')}</button>`}
      ${agentSettingsRow()}
      ${d.search && settingsRow()}
      ${d.search && html`<button class="btn surface block" style="margin-bottom:10px" onClick=${() => { closeSheet(); go(sp('useful')); }}><${Icon} n="book-open" />${t('uf_title')}</button>`}
      <button class="btn surface block" style="margin-bottom:10px" onClick=${() => { closeSheet(); go('/searches'); }}>${t('all_searches')}</button>
      ${d.search && !isGuest() && agentAwayHours() > 0 && html`<p class="w81-away"><${Icon} n="eyeoff" cls="xs" />${t('w81_offline', { n: agentAwayHours() })}</p>`}
      <button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
  }
  if (sh.kind === 'switch') {
    const cur = d.search?.id;
    body = html`<h2>${t('my_searches')}</h2>
      <div class="card grp">${d.searches.map((x) => html`<button class="opt sw-opt" aria-current=${x.id === cur ? 'true' : null} onClick=${() => { closeSheet(); if (x.id !== cur) { hap.sel(); go(`/s/${x.id}/today`, true); } }}>
        <span class="mark sm" data-region=${x.country} style=${markStyle(x.country)}>${S.regions?.[x.country]?.scene ? html`<i></i>` : html`<b>${initial(x.title)}</b>`}</span>
        <div class="grow"><div class="ellipsis" style="font-weight:600">${x.title}</div><div class="muted" style="font-size:13px">${x.role === 'owner' ? t('role_mine') : x.role === 'guest' ? t('gi_role') : t('invited_by', { name: firstName(x.owner_name) })}</div></div>
        ${x.id === cur && html`<${Icon} n="check" cls="check" />`}</button>`)}</div>
      <div class="card grp">
        <button class="opt" onClick=${() => { closeSheet(); go(sp('brief')); }}><${Icon} n="file" cls="sm" /><span class="grow">${t('about_search')}</span><${Icon} n="chev" cls="sm muted" /></button>
        <button class="opt" onClick=${() => { closeSheet(); go(sp('useful')); }}><${Icon} n="book-open" cls="sm" /><span class="grow">${t('uf_title')}</span><${Icon} n="chev" cls="sm muted" /></button>
        ${!isGuest() && html`<button class="opt" onClick=${() => { closeSheet(); go(sp('afisha')); }}><${Icon} n="ticket" cls="sm" /><span class="grow">${t('af_title')}</span><${Icon} n="chev" cls="sm muted" /></button>`}
        <button class="opt" onClick=${() => { closeSheet(); go('/searches'); }}><${Icon} n="layers" cls="sm" /><span class="grow">${t('all_searches')}</span><${Icon} n="chev" cls="sm muted" /></button>
      </div>
      <button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
  }
  if (sh.kind === 'add_expense') body = html`<${AddExpense} />`;
  if (sh.kind === 'agent_token') body = html`<${AgentTokenSheet} />`;
  if (sh.kind === 'home_name') body = html`<${HomeNameSheet} />`;
  if (sh.kind === 'expense') body = html`<${ExpenseSheet} id=${sh.arg} />`;
  if (sh.kind === 'shares') body = html`<${SharesSheet} />`;
  if (sh.kind === 'onsite_note') body = html`<${OnsiteNoteSheet} arg=${sh.arg} />`;
  if (sh.kind === 'issue') body = html`<${IssueSheet} />`;
  if (sh.kind === 'add_doc') body = html`<${AddDocSheet} />`;
  if (sh.kind === 'doc_req') body = html`<${DocReqSheet} doc=${sh.arg} />`;
  if (sh.kind === 'mo_step') body = html`<${MoStepSheet} k=${sh.arg} />`;
  if (sh.kind === 'note_add') body = html`<${NoteSheet} cid=${sh.arg} />`;
  if (sh.kind === 'room') body = html`<${RoomSheet} id=${sh.arg} />`;
  if (sh.kind === 'money_mode') body = html`<${MoneyModeSheet} />`;
  if (sh.kind === 'visa') body = html`<${VisaSheet} />`;
  if (sh.kind === 'anchor_add') body = html`<${AnchorAddSheet} />`;
  if (sh.kind === 'anchor') body = html`<${AnchorSheet} id=${sh.arg} />`;
  if (sh.kind === 'dir_add') body = html`<${DirAddSheet} grp=${sh.arg} />`;
  if (sh.kind === 'dir_group') body = html`<${DirGroupSheet} />`;
  if (sh.kind === 'dir_entry') body = html`<${DirEntrySheet} id=${sh.arg} />`;
  if (sh.kind === 'spot') body = html`<${SpotSheet} id=${sh.arg} />`;
  if (sh.kind === 'spot_area') body = html`<${SpotAreaSheet} />`;
  if (sh.kind === 'spot_link') body = html`<${SpotLinkSheet} />`;
  if (sh.kind === 'flood_note') body = html`<${FloodNoteSheet} id=${sh.arg} />`;
  if (sh.kind === 'bike') body = html`<${BikeSheet} key=${sh.arg} id=${sh.arg} />`;
  if (sh.kind === 'item') body = html`<${ItemSheet} key=${sh.arg} id=${sh.arg} />`;
  if (sh.kind === 'useful_add') body = html`<${UsefulAddSheet} />`; // wave 6 · B
  if (sh.kind === 'ev_book') body = html`<${EventBookSheet} key=${sh.arg?.key} o=${sh.arg} />`; // wave 7
  if (sh.kind === 'af_prefs') body = html`<${AfPrefsSheet} />`;
  if (sh.kind === 'pt_item') body = html`<${PartyItemSheet} key=${sh.arg?.it?.id ?? 'new'} arg=${sh.arg} />`; // wave 9
  if (sh.kind === 'share') body = html`<${ShareSheet} arg=${sh.arg} />`;
  if (sh.kind === 'ev_late') body = html`<${EvLateSheet} x=${sh.arg} />`;
  if (sh.kind === 'ev_ticket') body = html`<${EvTicketSheet} key=${sh.arg?.key} o=${sh.arg} />`;
  if (sh.kind === 'ord_conf') body = html`<${OrdConfSheet} key=${sh.arg.o.id} o=${sh.arg.o} />`; // wave 10
  if (sh.kind === 'ord_paid') body = html`<${OrdPaidSheet} key=${sh.arg.o.id} o=${sh.arg.o} />`;
  if (sh.kind === 'ord_clear') body = html`<${OrdClearSheet} key=${sh.arg} sup=${sh.arg} />`; // sets (design/mockup-v5/sets-*)
  if (sh.kind === 'ord_save') body = html`<${OrdSaveSheet} key=${sh.arg.from} arg=${sh.arg} />`;
  if (sh.kind === 'ord_set') body = html`<${OrdSetSheet} key=${sh.arg} id=${sh.arg} />`;
  if (sh.kind === 'pp_stage') body = html`<${StageSheet} />`; // wave 6 · A
  if (sh.kind === 'gcontact') body = html`<${GuestContactSheet} key=${sh.arg} id=${sh.arg} />`;
  if (sh.kind === 'late') {
    const list = (viewingsByDay().get(sh.arg?.day) ?? []).filter((v) => Date.parse(v.starts_at) > Date.now() - 30 * 60e3);
    const v = list[0] ?? (viewingsByDay().get(sh.arg?.day) ?? [])[0];
    const send = async (n) => {
      if (!v) return closeSheet();
      const l = listingById(v.listing_id) ?? v;
      try {
        await api('/app/api/instruction', { search_id: d.search.id, kind: 'running_late', minutes: n, ref: v.id, date: sh.arg?.day, text: t('late_text', { n, time: fmtTime(v.starts_at), title: l.title }) });
        hap.ok();
        toast(t('late_sent'));
      } catch { toast(t('err_generic')); }
      closeSheet();
    };
    body = html`<h2>${t('late_title')}</h2>
      <div class="card grp">${[10, 20, 30, 45].map((n) => html`<button class="opt" onClick=${() => send(n)}><${Icon} n="hourglass" />${t('late_min', { n })}</button>`)}</div>
      <button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
  }
  return html`<div class="backdrop" onClick=${(e) => e.target === e.currentTarget && closeSheet()} onKeyDown=${(e) => e.key === 'Escape' && closeSheet()}>
    <div class="sheet" role="dialog" aria-modal="true" ref=${ref}><div class="grip"></div>${body}</div></div>`;
}
