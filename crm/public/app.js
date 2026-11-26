// Hunt Mini App. Preact + htm from a pinned CDN build, no bundler.
import { html, render, useState, useEffect, useRef, useMemo } from 'https://unpkg.com/htm@3.1.1/preact/standalone.module.js';
import { Desk, Door, Sessions, useWide, deskTone } from './desk.js'; // the big screen (≥ 1024 px) and the site's door
import { demoOn, demoApi, demoRegions } from './demo.js';
import { AccessScreen, DraftScreen, settingsRow, canAccess } from './access.js'; // access to conversations (design/mockup-v6)
import { AgentScreen, AgentTokenSheet, agentSettingsRow, agentOn, agentSub } from './agent.js'; // "Подключить агента" (design/mockup-v5/agent-*)
import { NewProject, npTone } from './newproject.js'; // a new project from the app (design/mockup-v7)
import { fxMount } from './fx.js'; // wave 7: one category effect per event photo

const TG = window.Telegram && window.Telegram.WebApp;
const inTG = !!(TG && TG.initData);
const MAPLIBRE = 'https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl';
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const tg = (fn) => { try { return fn(); } catch { return undefined; } };
const pref = {
  get: (k) => tg(() => localStorage.getItem('hunt.' + k)),
  set: (k, v) => tg(() => localStorage.setItem('hunt.' + k, v)),
};

// ---------------------------------------------------------------- i18n
let LANG = 'ru';
const PR = { ru: new Intl.PluralRules('ru'), en: new Intl.PluralRules('en') };
/** pl(n, one, few, many) for ru; pl(n, one, other) for en */
const pl = (n, ...f) => {
  const c = PR[LANG].select(n);
  if (LANG === 'ru') return c === 'one' ? f[0] : c === 'few' ? f[1] : f[2];
  return c === 'one' ? f[0] : f[1] ?? f[0];
};

const STR = {
  ru: {
    stage_n_of: 'Этап {i} из {n}',
    // wave 7 · Афиша (E2, E3, E5)
    af_title: 'Афиша', af_social: 'Тусовки', af_more: 'Ещё', af_prefs: 'Настройки афиши', af_of_day: 'Событие дня', af_book: 'Записаться', af_nope: 'Не моё', af_unnope: 'Вернуть в подборку',
    af_hint_l: 'не моё', af_hint_r: 'записаться', af_f_all: 'Все', af_f_ru: 'RU', af_f_en: 'EN', af_f_free: 'Бесплатно', af_f_evening: 'Вечер', af_f_morning: 'Утро', af_f_night: 'Ночь',
    af_f_r20: 'До 20 мин', af_f_book: 'С записью', af_f_beginner: 'Новичкам', af_f_today: 'Сегодня', af_f_bars: 'Бары', af_f_clubs: 'Клубы', af_f_sport: 'Спорт',
    af_free: 'бесплатно', af_entry_free: 'вход free', af_on_site: 'на месте', af_l_none: 'Без слов', af_live: 'идёт сейчас', af_in_h: 'через {n} ч', af_in_min: 'через {n} мин', af_from: 'с {t}',
    af_min_bike: '{n} мин на байке', af_today_at: 'сегодня в {t}', af_all: 'Все', af_n_week: (n) => `${n} ${pl(n, 'событие', 'события', 'событий')} на неделе`,
    af_empty: 'Событий рядом пока нет', af_empty_sub: 'Агент собирает афишу каждый день из чатов и площадок рядом с домом', af_empty_f: 'Под эти фильтры ничего', af_empty_f_sub: 'Снимите пару фильтров или выберите другой день',
    af_by_wd: 'По дням недели', af_wd1: 'Пн', af_wd2: 'Вт', af_wd3: 'Ср', af_wd4: 'Чт', af_wd5: 'Пт', af_wd6: 'Сб', af_wd7: 'Вс',
    af_st_requested: 'Агент запишет', af_st_drafted: 'Текст на одобрении', af_st_asked: 'Ждём организатора', af_st_booked: 'Записаны', af_st_attended: 'Были', af_st_declined: 'Мест нет',
    af_c_culture: 'Культура', af_c_nature: 'Природа', af_c_sport: 'Спорт', af_c_dance: 'Танцы', af_c_music: 'Музыка', af_c_food: 'Еда', af_c_workshop: 'Мастер-класс', af_c_party: 'Вечеринка',
    af_c_wellness: 'Практики', af_c_kids: 'Детям', af_c_other: 'Событие', af_c_bar: 'Бар', af_c_club: 'Клуб', af_c_beach_club: 'Бич-клуб', af_c_social_sport: 'Спорт', af_c_meetup: 'Знакомства', af_c_quiz: 'Квиз',
    af_t_sea: 'Море', af_t_snorkel: 'Море', af_t_diving: 'Море', af_t_boat: 'Море', af_t_padel: 'Падел', af_t_surf_meetup: 'Сёрф', af_t_surf: 'Сёрф', af_t_cinema: 'Кино', af_t_yoga: 'Йога',
    af_t_market: 'Рынок', af_t_karaoke: 'Караоке', af_t_stargazing: 'Звёзды', af_t_sunrise_hike: 'Рассвет', af_t_volcano: 'Вулкан', af_t_waterfall: 'Водопад', af_t_sunset_session: 'Закат',
    af_sea_calm: 'Море {w} спокойное', af_sea_rough: 'Море {w} неспокойное', af_band_morning: 'утром', af_band_day: 'днём', af_band_evening: 'вечером', af_wave: 'волна {x} м',
    af_wind_low: 'ветер слабый', af_wind_mid: 'ветер умеренный', af_wind_high: 'ветер сильный',
    af_agent: 'Агент запишет', af_how: 'Как попасть', af_ag_msg: 'Напишет организатору в {c}', af_ag_msg0: 'Напишет организатору', af_ag_msg_s: 'текст покажу перед отправкой',
    af_ag_ticket: 'Билеты у организатора', af_ag_ticket_s: 'покупаете сами, агент деньги не трогает', af_ag_none: 'Запись не нужна', af_ag_none_s: 'просто приходите, отметьте, кто идёт',
    af_ag_seats: (n, v) => `Места на ${n === 2 ? 'двоих' : n === 3 ? 'троих' : n}, вы и ${v.names}`, af_ag_seat1: 'Место для вас', af_ag_seats_s: 'можно позвать гостя',
    af_ag_pay: 'Оплата на месте, сами', af_ag_pay_s: 'агент деньги не трогает', af_beginner: 'Новичкам', af_v_chill: 'Спокойно', af_v_party: 'Тусовка', af_v_sport: 'Спорт', af_v_meet: 'Знакомства',
    af_cr_expats: 'Экспаты', af_cr_locals: 'Местные', af_cr_mixed: 'Все вместе', af_e_fee: 'Вход платный', af_e_min_spend: 'Депозит', af_e_guest_list: 'Гест-лист',
    af_who_none: 'Пока никто не отметился', af_want: 'Хочу пойти', af_want_on: 'Иду', af_want_sent: 'Остальным придёт одно сообщение', af_going: 'Идут: {names}', af_you: 'вы', af_you_cap: 'Вы',
    af_you_want: 'Вы хотите пойти', af_wants1: '{name} хочет пойти', af_wantsN: '{names} хотят пойти', af_source: 'Источник', af_save: 'Сохранить', af_saved: 'Сохранили', af_unsaved: 'Убрали из сохранённых',
    af_noped: 'Поняли, такое будет реже', af_unnoped: 'Вернули в подборку', af_cancel: 'Отменить', af_cancelled: 'Отменили запись', af_tickets: 'Купить билет',
    af_book_two: 'Записать нас двоих', af_book_three: 'Записать нас троих', af_past: 'Это событие уже прошло', af_viewer: 'Записаться могут участники поиска',
    af_who_title: 'Кто идёт', af_guests: 'Гости', af_k_join: 'Просто прийти', af_k_guest_list: 'Гест-лист', af_k_table: 'Стол', af_k_slot: 'Место в игре', af_note_ph: 'Пожелание организатору, необязательно',
    af_book_note: 'Агент напишет организатору на его языке и покажет текст перед отправкой. Оплата на месте, сами', af_book_note_ticket: 'Билеты продаёт организатор, покупаете сами. Отметим, кто идёт',
    af_book_note_none: 'Запись не нужна. Отметим, кто идёт, остальным будет видно', af_book_btn: (n) => `Попросить агента · ${n} ${pl(n, 'человек', 'человека', 'человек')}`,
    af_book_ticket_btn: 'Отметить и открыть билеты', af_book_none_btn: 'Отметить, что идём', af_booked_req: 'Агент напишет организатору, текст покажет перед отправкой', af_booked_self: 'Отметили',
    af_p_night: 'Бары и вечеринки', af_p_night_sub: 'Выключите, и мы не будем советовать бары, клубы и алкогольные акции', af_p_line: 'Событие дня в утренней сводке', af_p_line_sub: 'одна строка в сообщении бота',
    af_p_like: 'Что нравится', af_p_age: 'Возраст', af_p_note: 'Подборка учится на ваших «нравится», «не моё» и оценках после событий',
    af_i_nightlife: 'Тусовки', af_i_sport: 'Спорт', af_i_surf: 'Сёрф', af_i_culture: 'Культура', af_i_nature: 'Природа', af_i_food: 'Еда', af_i_wellness: 'Йога', af_i_music: 'Музыка', af_i_creative: 'Творчество', af_i_social: 'Знакомства',
    hm_m_afisha: 'Афиша', hm_m_afisha_sub: 'события рядом и тусовки',
    // wave 6 · A: project path (45), projects list (00c)
    pp_title: 'Путь проекта', pp_projects: 'Проекты', pp_k_start: 'Старт', pp_k_search: 'Поиск', pp_k_viewings: 'Просмотры', pp_k_choice: 'Выбор', pp_k_deal: 'Сделка',
    pp_k_movein: 'Заезд', pp_k_living: 'Живём', pp_k_extension: 'Продление', pp_k_next: 'Что дальше', pp_k_relet: 'Пересдача', pp_k_moveout: 'Выезд', pp_k_closed: 'Закрыт',
    pp_d_start: 'Бриф, кто едет, бюджет', pp_d_search: 'Варианты и переписка', pp_d_viewings: 'Смотрим дома вживую', pp_d_choice: 'Решаем вместе, что берём',
    pp_d_deal: 'Договор и оплата до заезда', pp_d_movein: 'Скан виллы, счётчики, контакты', pp_d_living: 'Платежи, поломки, байки, гости', pp_d_extension: 'Новый договор, тот же дом',
    pp_d_next: 'Остаёмся, ищем новое или уезжаем', pp_d_relet: 'Ищем, кто доживёт остаток', pp_d_moveout: 'Осмотр, 3D-скан, залог',
    pp_ext_title: 'Продление · до {d}', pp_until: 'до {d}',
    pp_f_contacted: '{n} написали', pp_f_replied: '{n} ответили', pp_f_listings: (n) => `${n} ${pl(n, 'вариант', 'варианта', 'вариантов')}`,
    pp_f_villas: (n) => `${n} ${pl(n, 'вилла', 'виллы', 'вилл')}`, pp_f_views: (n) => `${n} ${pl(n, 'просмотр', 'просмотра', 'просмотров')}`, pp_f_days: (n) => `за ${n} ${pl(n, 'день', 'дня', 'дней')}`,
    pp_how_majority: 'большинство «берём»', pp_how_deal: 'сделка', pp_how_taken: 'берём', pp_how_manual: 'выбрали сами', pp_f_takes: (n) => `«Берём»: ${n}`,
    pp_f_signed_stamp: 'Договор с маркой', pp_f_signed: 'Договор подписан', pp_f_unsigned: 'Договор ещё не подписан', pp_f_paid: '{x} отдали', pp_f_pending: 'ещё {x} до заезда',
    pp_f_movein: 'Скан виллы, счётчики, контакты {who}', pp_f_movein_home: 'Скан виллы, счётчики, контакты дома', pp_f_day: 'День {d} из {n}',
    pp_dep_returned: 'залог вернули', pp_dep_carried: 'залог перенесли', pp_dep_pending: 'старый залог ждём', pp_dep_kept: 'залог оставили', pp_f_ext_wait: 'Ждём новый договор',
    pp_f_votes: 'Голосуем: {v} из {n}', pp_f_next_stay: 'Решили остаться', pp_f_next_new: 'Решили искать новое', pp_f_next_leave: 'Решили уезжать',
    pp_relet_draft: 'Готовим объявление', pp_relet_posted: 'Объявление висит', pp_relet_found: 'Нашли, кто доживёт', pp_relet_closed: 'Пересдали',
    pp_f_steps: '{d} из {n} шагов', pp_f_dep_done: 'залог вернули', pp_f_dep_wait: 'ждём залог', pp_f_moveout: 'Осмотр с {who}, 3D-скан, залог',
    pp_h_start: 'заполняем бриф', pp_h_search: 'ищем варианты', pp_h_viewings: 'смотрим дома', pp_h_choice: 'решаем', pp_h_deal: 'договор и оплата', pp_h_extension: 'продление',
    pp_h_next: 'решаем, что дальше', pp_h_closed: 'проект закрыт', pp_h_manual: 'вручную',
    pp_in_days: (n) => `через ${n} ${pl(n, 'день', 'дня', 'дней')}`, pp_tomorrow: 'завтра', pp_today: 'сегодня',
    pp_h_movein: 'заезд {w}', pp_h_movein_past: 'заехали {d}', pp_h_moveout: 'выезд {w}', pp_h_moveout_past: 'выехали {d}',
    pp_l_start: 'Старт · бриф', pp_l_search: 'Поиск · {x}', pp_l_search0: 'Поиск', pp_l_viewings: 'Просмотры', pp_l_viewings_at: 'Просмотр {w}', pp_l_choice: 'Выбор',
    pp_l_deal: 'Сделка', pp_l_deal_d: 'Сделка · заезд {d}', pp_l_movein: 'Заезд {w}', pp_l_living: 'Живём · до {d}', pp_l_living0: 'Живём', pp_l_next: 'Что дальше', pp_l_moveout: 'Выезд {w}',
    pp_l_closed: 'Закрыт · досье', pp_l_guest: 'Гость · до {d}',
    pp_change: 'Изменить этап', pp_auto: 'Автоматически', pp_auto_sub: 'По данным: {k}', pp_set_ok: 'Этап обновлён', pp_close: 'Закрыть проект', pp_reopen: 'Открыть снова',
    pp_close_q: 'Закрыть проект?', pp_close_text: 'Проект станет архивом: досье, документы и итоги можно смотреть, менять нельзя. Гости потеряют доступ. Участникам придёт сообщение.',
    pp_close_yes: 'Закрыть', pp_closed_t: 'Проект закрыт', pp_closed_s: 'Только чтение: досье, документы и итоги остаются', pp_closed_owner: 'Открыть снова можно в «Пути проекта»',
    pp_closed_toast: 'Проект закрыт, менять нельзя', pp_stage_feed: 'Этап: {k}', pp_stage_feed_m: '{name}: этап «{k}»',
    // wave 6 · C: pastel pass (water cards, amount field)
    pw_pool_own: 'свой бассейн', pw_of_100: 'из 100', pw_surf_until: '{s} до {t}', pw_approx: '≈ {x}', pw_optional: 'необязательно', pw_amount: 'Сумма', pw_category: 'Категория',
    pw_per_week: 'Неделя', pw_per_month: 'Месяц', pw_per_all: 'Всё время', pw_spent_in: 'Потратили в {m}', pw_spent_week: 'Потратили за неделю', pw_spent_all: 'Потратили за всё время',
    pw_less: 'на {x} меньше {m}', pw_more: 'на {x} больше {m}', pw_less_week: 'на {x} меньше прошлой недели', pw_more_week: 'на {x} больше прошлой недели',
    // wave 6 · B: Полезное
    uf_title: 'Полезное', uf_kicker: '{r} · проверено {d}', uf_f_all: 'Все', uf_f_chats: 'Чаты', uf_f_apps: 'Приложения', uf_f_guides: 'Гайды', uf_f_maps: 'Карты',
    uf_g_telegram: 'Telegram', uf_g_apps: 'Приложения', uf_g_guides: 'Гайды и карты', uf_add: 'Предложить ссылку', uf_add_btn: 'Отправить на проверку', uf_add_btn_owner: 'Добавить для всех',
    uf_pending: 'на проверке', uf_review: 'Ждут проверки', uf_mine: 'Ваши предложения', uf_approve: 'Добавить', uf_reject: 'Отклонить', uf_by: 'предложил(а) {name}',
    uf_approved: 'Добавили для всех', uf_rejected: 'Отклонили', uf_sent: 'Отправили на проверку', uf_exists: 'Такая ссылка уже есть', uf_bad_url: 'Нужна ссылка https:// или @чат в Telegram',
    uf_rate: 'Слишком много предложений, попробуйте позже', uf_more: 'Ещё {n}', uf_none: 'Здесь пока пусто', uf_source: 'источник: {s}',
    uf_name: 'Название', uf_name_ph: 'Например, Бали барахолка', uf_link: 'Ссылка', uf_link_ph: '@chat или https://…', uf_about: 'Зачем', uf_about_ph: 'что там полезного', uf_cat: 'Раздел',
    uf_note: 'Ссылку проверит владелец поиска или агент, потом она появится у всех поисков: {r}', uf_note_owner: 'Ссылка сразу появится у всех поисков: {r}',
    uf_c_chats_rent: 'Аренда', uf_c_flea: 'Барахолка', uf_c_bikes: 'Байки', uf_c_news: 'Новости и правила', uf_c_visas: 'Визы', uf_c_medicine: 'Медицина', uf_c_food: 'Еда',
    uf_c_apps: 'Приложение', uf_c_guides: 'Гайд', uf_c_maps: 'Карта', uf_c_other: 'Другое',
    hello: 'Привет, {name}', searches: 'Твои поиски', nav_today: 'Сегодня', nav_listings: 'Варианты', nav_map: 'Карта', nav_plan: 'План',
    n_new: (n) => `${n} ${pl(n, 'новый', 'новых', 'новых')}`, wait_you: (n) => `${n} ${pl(n, 'ждёт', 'ждут', 'ждут')} тебя`,
    viewing_at: 'просмотр {when}', no_viewings: 'просмотров нет', found_movein: 'нашли · заезд {d}', found: 'нашли', searching: 'ищем варианты',
    up_to: 'до {x}', today: 'сегодня', tomorrow: 'завтра', yesterday: 'вчера', since: 'с {d}',
    new_search: 'Новый поиск', new_search_text: 'Поиски создаёт твой агент: в Claude Code запусти /hunt:new, и поиск появится здесь.',
    waiting: 'Ждут вас', whats_new: 'Что нового', nothing_new: 'Пока тихо. Здесь появятся ответы хозяев, голоса и находки агента.',
    tile_new: (n) => `${pl(n, 'новый', 'новых', 'новых')}\nрешить`, tile_drafts: (n) => `${pl(n, 'сообщение', 'сообщения', 'сообщений')}\nодобрить`,
    tile_replies: (n) => `${pl(n, 'ответ', 'ответа', 'ответов')}\nхозяев`, tile_want: () => 'хотим\nпосмотреть',
    feed_want_view: '{name} хочет посмотреть {title}', feed_thinking: '{name} думает про {title}', feed_not_interested: '{name} не хочет {title}', feed_take: '{name} хочет взять {title}',
    feed_comment: '{name}: «{text}»', feed_chat: '{name}: «{text}»', feed_instruction: '{name} → агенту: «{text}»',
    feed_draft_approved: 'Сообщение одобрено', feed_draft_edited: 'Сообщение исправлено и одобрено', feed_draft_rejected: 'Сообщение не отправляем',
    feed_found_one: 'Агент нашёл: {title}', feed_found_n: (n) => `Агент нашёл ${n} ${pl(n, 'новый вариант', 'новых варианта', 'новых вариантов')}`,
    feed_confirmed: '{title} подтвердили {time}', feed_proposed: 'Предложили просмотр: {title}, {time}', feed_done: 'Просмотр прошёл: {title}', feed_cancelled: 'Просмотр отменён: {title}',
    chat: 'чат', agent: 'агент',
    no_viewing: 'Просмотров пока нет', no_viewing_sub: 'Отметьте варианты, агент договорится о времени', deal: 'Сделка', deal_strip_sub: 'платежи и что сделать до заезда',
    offline: (h) => h >= 48 ? `Агент не заходил ${Math.floor(h / 24)} ${pl(Math.floor(h / 24), 'день', 'дня', 'дней')}` : `Агент не заходил ${h} ${pl(h, 'час', 'часа', 'часов')}`,
    offline_text: 'Голоса и одобрения сохраняются, он увидит их при следующем запуске. Проверь, что компьютер с Claude Code включён.',
    f_all: 'Все', f_new: 'Новые', f_replies: 'Ответили', f_want_view: 'Смотреть', f_thinking: 'Думаем', f_not_interested: 'Нет', f_take: 'Берём',
    d_want_view: 'смотреть', d_thinking: 'думаем', d_not_interested: 'нет', d_take: 'берём', d_new: 'новый',
    deck_cta: (n) => `${n} ${pl(n, 'новый', 'новых', 'новых')} — разобрать`, deck_cta_sub: 'свайпами, по одному', compare: 'Сравнить',
    per_month: '/мес', per_month_long: 'в месяц', plus_power: '+ свет', plus_utils: '+ коммуналка',
    br: (n) => `${n} сп`, bedrooms: (n) => `${n} ${pl(n, 'спальня', 'спальни', 'спален')}`, with_baths: 'с ванными', sqm: '{n} м²',
    deck_title: 'Новые · {i} из {n}', hints: '← нет  ·  ↑ подумать  ·  смотреть →', deck_done: 'Всё разобрано', deck_done_text: 'Новые карточки появятся, когда агент найдёт ещё.',
    to_listings: 'К вариантам', undo: 'Вернуть', close: 'Закрыть', back: 'Назад', stamp_want_view: 'Смотреть', stamp_not_interested: 'Нет', stamp_thinking: 'Подумать',
    want_view_btn: 'Хотим посмотреть', take_btn: 'Берём', not_btn: 'Не интересно', think_btn: 'Подумать',
    free: 'свободна {x}', from_d: 'с {d}', to_d: 'до {d}', photos_n: '{i}/{n}',
    living_room: 'Гостиная', pool: 'Бассейн', included: 'Входит в цену', electricity: 'Свет', bedrooms_lbl: 'Спальни', yes: 'Да', no: 'Нет',
    messages: 'Переписка', all_messages: (n) => `Все сообщения · ${n}`, no_messages: 'Агент ещё не писал хозяину.', source: 'Объявление', on_map: 'На карте',
    approve_title: 'Сообщение {i} из {n}', send_to: 'Отправить {name}', send: 'Отправить', dont_send: 'Не отправлять', edit_text: 'Изменить текст', goes_now: 'уйдёт сейчас',
    approve_done: 'Все сообщения разобраны', approve_done_text: 'Агент отправит одобренные при следующем запуске.', approved_toast: 'Одобрено, агент отправит', skipped_toast: 'Не отправляем',
    compare_kicker: (n) => `Хотим посмотреть · ${n}`, best: 'лучшая', votes: 'Голоса', term: 'Срок', clarify: 'уточнить', compare_empty: 'Отметьте «Хотим посмотреть» хотя бы у двух вариантов — здесь они встанут рядом.',
    cmp_best: '{a} — больше всего голосов', cmp_cheaper: '{a} дешевле на {x}', cmp_unknown: '{a}: {field} не уточнён',
    plan: 'План', s_confirmed: 'Подтверждено', s_proposed: 'Ждём ответ', s_done: 'Прошёл', route_day: 'Маршрут дня', late: 'Опаздываем', late_title: 'На сколько опаздываем?',
    late_min: '~{n} мин', late_text: 'Опаздываем примерно на {n} мин на просмотр {time} ({title}). Предупреди хозяина, пожалуйста.', late_sent: 'Передали агенту, он предупредит',
    plan_empty: 'В этот день просмотров нет.', no_plan: 'Просмотров пока нет. Отметьте «Хотим посмотреть» — агент договорится о времени.',
    map_all: 'Все варианты', map_day: 'День', map_day_d: 'День · {d}', legend_want_view: 'смотреть {n}', legend_thinking: 'думаем {n}', legend_not_interested: 'нет {n}', legend_take: 'берём {n}', legend_new: 'новые {n}',
    ring: '{n} мин {mode}', mode_scooter: 'на байке', mode_car: 'на машине', mode_car_taxi_metro: 'на такси', mode_walk: 'пешком', mode_any: 'в пути',
    min_to: '{n} мин до {label}', day_n: (n) => `${n} ${pl(n, 'просмотр', 'просмотра', 'просмотров')}`, in_transit: '~{min} мин в пути · {km} км · {mode}',
    start: 'старт', min: '{n} мин', open_gmaps: 'Открыть маршрут в Google Maps', map_none: 'У вариантов пока нет координат.', map_fail: 'Карта не загрузилась. Проверь интернет.',
    taking: 'Берём', sublease: 'субаренда', lease: 'аренда', before_move: 'Перед заездом', privacy: 'Паспортные данные и договор не хранятся в Hunt. Здесь только условия.',
    empty_title: 'Ищем варианты', empty_text: 'Агент читает {src}. Первые карточки появятся здесь и в группе поиска, обычно в течение часа.',
    step_brief: 'Бриф и бюджет', step_collect: 'Сбор объявлений за 3 дня', step_first: 'Первые сообщения хозяевам', invite: 'Позвать друзей', invite_text: 'Ищем жильё вместе, голосуй за варианты в Hunt',
    src_bali: 'Facebook-группы, Telegram-чаты и порталы', src_kz: 'krisha.kz, OLX и чаты аренды', src_th: 'DDproperty, Facebook и чаты аренды', src_any: 'порталы и чаты аренды',
    reveal_kicker: '{title} · поиск: {owner}', reveal_mine: '{title} · твой поиск', reveal_h1: 'В этом поиске', reveal_h2: 'ты — {name}',
    reveal_p: 'Так тебя будут видеть друзья в голосах и комментариях. У каждого в поиске свой зверь.', reveal_go: 'Смотреть варианты', reveal_again: 'Другой зверь',
    settings: 'Настройки', language: 'Язык', theme: 'Тема', th_light: 'Светлая', th_dark: 'Тёмная', th_auto: 'Авто', th_auto_sub: 'как в Telegram: днём светлая, ночью тёмная', your_animal: 'Твой зверь', another: 'Другой', all_searches: 'Все поиски', members: 'Участники',
    err_auth: 'Открой Hunt из бота в Telegram.', err_member: 'Сначала открой бота и нажми Start.', err_generic: 'Не получилось. Попробуй ещё раз.', retry: 'Повторить',
    no_searches: 'Поисков пока нет', no_searches_text: 'Попроси владельца поиска прислать приглашение.', np_new: 'Новый проект', np_first: 'Начнём первый проект', np_first_text: 'Новый поиск или дом, где вы уже живёте. Друзей позовёшь ссылкой', settings_btn: 'Участники и настройки',
    brief: 'Бриф', change: 'Изменить', cancel: 'Отмена', done: 'Готово', brief_btn: 'Бриф поиска',
    k_bedrooms: 'спальни', k_move_in: 'заезд', k_month: '/мес', studio: 'студия', and: 'и', created_on: 'создан {d}',
    sec_housing: 'Жильё', sec_districts: 'Районы', sec_term: 'Срок и оплата', sec_important: 'Важно', sec_no: 'Точно нет', sec_near: 'Ближе к',
    more_n: 'ещё {n}', near_min: 'до {n} минут {mode}', said_title: 'Владельцам говорим ~{x}', said_text: 'Видишь только ты. Агент торгуется от этой цифры и не называет потолок.',
    e_bedrooms: 'Спальни', e_budget: 'Бюджет в месяц, {unit}', e_said: 'Владельцам говорим: {x}', e_said_none: 'Владельцам говорим: не задано', e_districts: 'Районы',
    e_note: 'Районы — из пака региона. Агент получит изменения при следующем запуске.', e_move_in: 'Заезд', e_term: 'Срок', e_types: 'Жильё', e_must: 'Важно', e_no: 'Точно нет',
    e_must_ph: 'Закрытая гостиная с кондиционером…', e_no_ph: 'Стройка рядом, только на год…', brief_saved: 'Сохранили. Агент увидит при следующем запуске', unchanged: 'Ничего не изменилось',
    pt_villa: 'вилла', pt_house: 'дом', pt_apartment: 'квартира', pt_condo: 'кондо', pt_townhouse: 'таунхаус', pt_room: 'комната',
    pay_monthly: 'помесячно', pay_3: 'можно 3 месяца вперёд', pay_6: 'можно 6 месяцев вперёд', pay_12: 'можно год вперёд',
    pref_lr_req: 'Закрытая гостиная с кондиционером: обязательно', pref_lr_pref: 'Закрытая гостиная с кондиционером: желательно', pref_pool_private: 'Свой бассейн',
    pref_pool_shared: 'Бассейн: общий тоже ок', pref_construction: 'стройка рядом',
    chats: 'Переписка', n_convs: (n) => `${n} ${pl(n, 'разговор', 'разговора', 'разговоров')}`, f_waiting_us: 'Ждут ответа', f_waiting_them: 'Ждём их', f_all_chats: 'Все',
    st_waiting_us: 'Ждёт ответа', st_waiting_them: 'Ждём их', st_closed: 'Закрыт', stl_waiting_us: 'Ждёт нашего ответа', stl_waiting_them: 'Ждём их ответа', stl_closed: 'Разговор закрыт',
    updated_by_agent: 'обновлено агентом {when}', at_time: 'в {t}', known: 'Известно', open_q: 'Открыто', last_msg: 'Последнее', agent_draft: 'Черновик агента',
    open_in: 'Открыть в {ch}', more_contacts: 'Ещё:', chats_row_sub: (n) => n ? `${n} ${pl(n, 'ждёт', 'ждут', 'ждут')} ответа` : 'все ответили', no_threads: 'Агент ещё не вёл переписку в этом поиске.',
    role_owner: 'хозяин', role_agent: 'агент', role_agency: 'агентство', role_manager: 'менеджер', role_relative: 'семья хозяина', role_tenant_subletting: 'сдаёт в субаренду',
    feed_brief: 'Обновлён бриф: {what}', feed_check_on: '{name}: «{text}» — готово', feed_check_off: '{name}: «{text}» — снова не готово', feed_thread_sub: 'переписка · {state}',
    bk_budget: 'бюджет', bk_districts: 'районы', bk_bedrooms: 'спальни', bk_move_in: 'заезд', bk_term: 'срок', bk_property_type: 'жильё', bk_must_have: 'важное', bk_deal_breakers: 'точно нет', bk_payment_terms: 'оплата', bk_nice_to_have: 'желательно',
    interest: 'интерес {x} из {max}', x_of: '{x} из {max}', rate_q: 'Как тебе? Оценки увидит вся группа', viewed_at: 'смотрели {when}', at_word: '{d} в {t}',
    crit_overall: 'Общее впечатление', crit_area: 'Район и дорога', crit_inside: 'Дом внутри', crit_quiet: 'Тишина и соседи',
    cb_overall: 'Общее', cb_area: 'Район и дорога', cb_inside: 'Дом внутри', cb_quiet: 'Тишина',
    note_ph: 'Что запомнилось? Шум, свет, хозяин…', save_rating: 'Сохранить оценку', rating_saved: 'Оценка сохранена, группа её видит', rate_all: 'Поставь все четыре оценки',
    voice_note: 'голосовая заметка', recording: 'Запись {s} · нажми, чтобы остановить', mic: 'Записать голосом', voice_fail: 'Не получилось записать голос', voice_up: 'Загружаю запись…', remove: 'Убрать',
    score_title: 'Оценка после просмотра', of5: 'из 5', notes_title: 'Заметки с просмотра', interest_before: 'Интерес до просмотра: {x} из {max}', interest_now: 'Интерес: {x} из {max}',
    rate_btn: 'Оценить', rate_edit: 'Изменить мою оценку', both_dec: 'оба «{d}»', all_dec: 'все «{d}»', one_dec: '{name} «{d}»', play: 'Послушать',
    cmp_kicker_viewed: 'Посмотрели {n}', sort_score: 'по оценке', sort_price: 'по цене', sort_interest: 'по интересу', sort_by: 'Сортировка',
    row_score: 'Оценка', row_quiet: 'Тишина', row_inside: 'Дом', row_interest: 'Интерес',
    cmp_best_score: '{a}: лучшая оценка', cmp_unanimous: ' и единогласный интерес', cmp_cheaper_than: ', на {x} дешевле {b}', cmp_pricier_than: ', но на {x} дороже {b}',
    cmp_weak: '{b}: слабое место — {crit} ({v})', cmp_best_interest: '{a} — самый высокий интерес', cmp_cheapest: '{a} — самый дешёвый вариант',
    feed_rating: '{name} оценивает {title}: {score}',
    seg_liked: 'Понравились', seg_new: 'Новые', seg_all: 'Все', seg_passed: 'Отказ', replied_24h: 'Ответили за сутки',
    liked_empty: 'Здесь будут варианты, которые группа хочет посмотреть или оценила от 3,5.', passed_empty: 'Отказов пока нет.', new_empty: 'Новых нет — всё разобрано.',
    my_searches: 'Твои поиски', role_mine: 'мой', role_invited: 'позвали', invited_by: 'позвали: {name}', about_search: 'О поиске',
    // wave 2
    ck_caution: (n) => `Осторожно: ${n} ${pl(n, 'сигнал', 'сигнала', 'сигналов')}`, ck_danger: (n) => `Похоже на обман: ${n} ${pl(n, 'сигнал', 'сигнала', 'сигналов')}`, ck_ok: 'Проверка пройдена',
    ck_caution_sub: 'Не плати ничего до просмотра и сверки собственника', ck_danger_sub: 'Денег не переводим. Агент не будет назначать просмотр без документов', ck_ok_sub: 'Явных признаков обмана нет',
    ck_ask: 'Попросить документы у хозяина', ck_foot: 'Агент проверяет: дубли у разных агентов, поиск по фото, цену против рынка района, предоплату, документы. Правила — из пака региона.',
    ck_ask_text: 'Попроси у хозяина {docs} до просмотра и сверь имя собственника.', ck_ask_default: 'документы на жильё и удостоверение личности', ck_asked: 'Передали агенту, он попросит документы',
    ck_line: 'Проверка: {x}', ck_checked: 'проверено {when}',
    money: 'Деньги', money_today: 'Итог на сегодня', owes_you: '{name} должен тебе', you_owe: 'Ты должен {name}', owes: '{a} должен {b}', all_square: 'Все в расчёте', settle: 'Отметить, что рассчитались',
    settled_toast: 'Отметили, баланс обнулён', m_total: 'всего', m_each: 'на каждого', m_mine: 'твоя доля', m_power: 'свет/мес', m_count: (n) => pl(n, 'расход', 'расхода', 'расходов'), expenses: 'Расходы',
    no_expenses: 'Расходов пока нет. Нажми «+», чтобы добавить первый: аренду, депозит, токены на свет.', live_n: (n) => (n <= 1 ? 'живём' : n === 2 ? 'живём вдвоём' : n === 3 ? 'живём втроём' : n === 4 ? 'живём вчетвером' : `живём: ${n}`),
    members_n: (n) => `${n} ${pl(n, 'участник', 'участника', 'участников')}`,
    split_half: 'пополам', split_equal: 'поровну', split_shares: 'по долям', split_self: 'за свой счёт', split_custom: 'на часть', receipt: 'чек',
    pm_cash: 'наличными', pm_transfer: 'переводом', pm_card: 'картой',
    xk_rent: 'Аренда', xk_deposit: 'Депозит', xk_power: 'Свет', xk_water: 'Вода', xk_internet: 'Интернет', xk_cleaning: 'Уборка', xk_pool: 'Бассейн', xk_repair: 'Ремонт', xk_food: 'Еда', xk_transport: 'Транспорт', xk_other: 'Другое',
    x_add: 'Новый расход', x_title: 'Что оплатили', x_title_ph: 'Токены на свет', x_amount: 'Сумма, {cur}', x_paid_by: 'Кто платил', x_split: 'Делим на', x_kind: 'Тип', x_method: 'Как платили', x_date: 'Дата',
    x_note: 'Заметка', x_receipt: 'Фото чека', x_receipt_add: 'Добавить фото чека', x_save: 'Сохранить', x_saved: 'Расход добавлен', x_need: 'Нужны название и сумма', x_everyone: 'всех', x_delete: 'Удалить расход', x_deleted: 'Удалили',
    x_paid: '{name} заплатил', shares: 'Как делим', shares_text: 'Доли участников: по ним делятся все общие расходы. Например, кто живёт в большой спальне, платит больше.', shares_saved: 'Доли сохранены',
    os_title: 'На месте', os_of: '{x} из {n}', os_photos: 'Фото · {n}', os_photo: 'Фото', os_rate: 'К оценке', os_note: 'Заметка', os_note_ph: 'Коротко: что не так или цифры', os_none: 'В паке региона пока нет чеклиста.', os_uploaded: 'Фото добавлено', os_btn: 'Чеклист на месте',
    home_living: 'Живём · день {d} из {n}', home_living_short: 'Живём', issues: 'Поломки', report: 'Сообщить', contacts: 'Контакты', no_issues: 'Поломок нет', no_hcontacts: 'Агент добавит контакты хозяина, уборки и бассейна.',
    is_open: 'Открыто', is_scheduled: 'Мастер {when}', is_scheduled_plain: 'Назначено', is_fixed: 'Починили', is_report_title: 'Что сломалось?', is_report_ph: 'Кондиционер в спальне 2 гудит', is_note_ph: 'Подробности, если есть', is_sent: 'Передали агенту, он напишет хозяину',
    hc_owner: 'хозяин', hc_manager: 'управляющий', hc_cleaning: 'уборка', hc_pool: 'бассейн', hc_garden: 'сад', hc_repair: 'ремонт', hc_security: 'охрана', hc_internet: 'интернет', hc_other: 'контакт',
    per_month_s: '/мес', per_week_s: '/нед', per_visit_s: '/раз', payer_rent: 'в аренде', payer_us: 'платим сами', home_in: 'Наш дом',
    docs: 'Документы', docs_kicker: 'Сделка · документы', doc_kicker: '{home} · документ', add: 'Добавить', dates_title: 'Сроки из договора', docs_foot: 'Оригиналы — в Telegram, в CRM только выжимка',
    dk_lease: 'Договор', dk_receipt: 'Расписка', dk_owner_consent: 'Согласие владельца', dk_movein_video: 'Видео заезда', dk_other: 'Документ',
    ds_have: 'Есть', ds_request: 'Запросить', ds_due: 'К {d}', version_n: 'версия {n}', signed_on: 'подписан {d}', signed_cap: 'Подписан {d}', pages_n: '{n} стр', version_from: 'Версия {n} от {d}',
    f_pdf: 'PDF', f_photo: 'фото', f_video: 'видео', f_file: 'файл', open_pdf: 'Открыть PDF', open_photo: 'Открыть фото', open_video: 'Открыть видео', open_file: 'Открыть файл', to_tg: 'В Telegram', sent_tg: 'Отправил в чат с ботом',
    main_points: 'Главное', changes_from: 'Что изменилось с версии {n}', changes: 'Что изменилось', no_summary: 'Агент ещё не сделал выжимку этого документа.', no_file: 'Файла пока нет',
    add_doc_title: 'Добавить документ', add_doc_bot: 'Пришли файл боту в личку: он сам прикрепит его к сделке, а агент разберёт.', open_bot: 'Открыть чат с ботом', add_doc_req: 'Или попроси агента запросить у хозяина:', doc_requested: 'Агент запросит документ',
    req_this: 'Попросить агента запросить', cad_payment: 'За неделю, за 2 дня и утром в день', cad_notice: 'За 2 недели и за 3 дня', cad_deposit_return: 'Не вернули — напомню и напишу им', until_d: 'до {d}', mark_returned: 'Вернули', returned: 'вернули',
    deal_links_docs: 'Документы и сроки', deal_links_money: 'Деньги', money_row_sub: (n) => n ? `${n} ${pl(n, 'расход', 'расхода', 'расходов')}` : 'общие расходы и кто кому должен',
    notifications: 'Уведомления', n_bot: 'Сообщения от бота', n_bot_sub: 'ответы хозяев, просмотры, платежи', n_digest: 'Утренняя сводка в 8:00', n_digest_sub: 'что нового за ночь и что сегодня',
    feed_expense: '{name}: расход «{title}», {x}', feed_settled: '{name}: рассчитались, {x}', feed_issue_open: 'Поломка: {title}', feed_issue_scheduled: 'Ремонт назначен: {title}', feed_issue_fixed: 'Починили: {title}',
    feed_document: 'Документ: {title}', feed_document_request: 'Нужен документ: {title}', feed_checks: 'Проверка «{title}»: {x}', v_ok: 'всё чисто', v_caution: 'осторожно', v_danger: 'похоже на обман',
    // wave 3
    w3_important: 'Важное', w3_power: 'Свет', w3_directory: 'Контакты рядом', w3_split: 'Кто сколько платит', w3_moveout: 'Выезд', w3_relet: 'Пересдаём остаток',
    w3_important_sub: 'виза, больницы, экстренные номера', w3_power_sub_none: 'сфоткай счётчик — посчитаю, на сколько хватит', w3_power_sub: (n) => `осталось ~${n} ${pl(n, 'день', 'дня', 'дней')}`,
    w3_dir_sub: (n) => n ? `${n} ${pl(n, 'контакт', 'контакта', 'контактов')}` : 'байки, вода, прачечная, рынки', w3_split_sub: 'аренда по комнатам', w3_split_sub_none: 'разбить аренду по комнатам',
    mo_title_villa: 'Сдаём виллу', mo_title: 'Сдаём жильё', mo_date: 'Выезд {d}', mo_date_none: 'Дата выезда пока не назначена',
    mo_notice: 'Хозяина предупредили', mo_notice_todo: 'Предупредить хозяина', mo_keys: 'Ключи и пульт', mo_video: 'Видео и счётчики при выезде', mo_cleaning: 'Уборка перед выездом', mo_deposit: 'Залог',
    mo_notice_sub: 'Причина и дата выезда', mo_keys_sub: 'Время передачи согласуем с хозяином', mo_video_sub: 'Каждая комната, дата в кадре', mo_cleaning_sub: 'Вещи, мусор, холодильник', mo_deposit_sub: 'Вернуть до {d}',
    mo_in: '{d} в {ch}', mo_draft: 'Черновик ответа', mo_draft_to: 'Черновик ответа {to}', mo_draft_text: 'Подготовь черновик ответа {who} по выезду, с аргументами из карточки', mo_draft_sent: 'Агент подготовит черновик, пришлёт на одобрение',
    mo_relet: 'Пересдать остаток', mo_mark_done: 'Отметить сделанным', mo_mark_todo: 'Вернуть в работу', mo_video_bot: 'Отправь видео боту в личку — оно прикрепится к выезду, агент проверит.', mo_saved: 'Отметил, агент увидит',
    pn_searches: (n) => pl(n, 'поиск', 'поиска', 'поисков'), pn_notes: (n) => pl(n, 'заметка', 'заметки', 'заметок'), pn_reply: 'отвечает', pn_notes_title: 'Заметки', pn_none: 'Заметок пока нет. Добавь, чем запомнился человек: плюсы, минусы, цены.',
    pn_foot: 'Заметки видят все на этом Hunt. Агент предупредит, если этот человек появится в новом поиске.', pn_add: 'Новая заметка', pn_ph: 'Отвечает быстро, ремонт делает за свой счёт…', pn_good: 'Плюс', pn_bad: 'Минус', pn_saved: 'Заметка сохранена', pn_min: '~{n} мин', pn_h: '~{n} ч', pn_d: '~{n} дн', pn_person: 'Карточка человека',
    sp_split_title: 'Кто сколько платит', sp_rooms: 'Комнаты', sp_rent: 'Аренда в месяц', sp_shared: 'Общая', sp_you: 'Ты', sp_others_two: 'Свет, уборку и бассейн — пополам', sp_others_n: 'Свет, уборку и бассейн — поровну',
    sp_others_sub: 'Выключи, чтобы делить остальное по долям', sp_empty: 'Разбейте аренду по комнатам: у кого мастер-спальня с ванной, тот платит больше.', sp_start: 'Разбить по комнатам', sp_room: 'Комната', sp_room_ph: 'Мастер, своя ванная', sp_who: 'Кто живёт',
    sp_share: 'Доля аренды', sp_split_saved: 'Сохранил, аренда делится по комнатам', sp_delete: 'Убрать комнату', sp_bedroom: 'Спальня {n}', sp_shares_link: 'Доли для остальных расходов', sp_no_rent: 'аренда не указана',
    mm_shared: 'Общий бюджет', mm_settings: 'Как ведём деньги', mm_split_t: 'Делим и считаем долги', mm_split_s: 'Кто сколько заплатил, кто кому должен, «рассчитались»', mm_shared_t: 'Общий кошелёк', mm_shared_s: 'Только сколько потратили: по месяцам и категориям',
    mm_this_month: 'В этом месяце', mm_all: 'всего', mm_avg: 'в среднем/мес', mm_by_kind: 'По категориям', mm_by_month: 'По месяцам', mm_saved: 'Режим сохранён',
    pw_left: 'Осталось примерно', pw_days: (n) => `${n} ${pl(n, 'день', 'дня', 'дней')}`, pw_topup_by: 'Пополнить до {d}.', pw_daily: 'Тратите ~{n} кВт·ч в день', pw_weeks: 'Расход по неделям, кВт·ч',
    pw_month: '~{x} в месяц', pw_month_money: 'по расходам в «Деньгах»', pw_month_tariff: 'по тарифу ~{x} за кВт·ч', pw_photo_at: 'Счётчик сфоткан {d}', pw_photo_wait: 'Агент прочитает остаток по фото', pw_photo_read: 'Остаток посчитан по фото',
    pw_where: 'Где купить токены', pw_where_post: 'Как платить за свет', pw_shoot: 'Сфоткать счётчик', pw_sent: 'Фото у агента, он посчитает остаток', pw_none: 'Сфоткай счётчик — агент прочитает остаток и посчитает, на сколько хватит.', pw_none_t: 'Сколько осталось света?',
    pw_split_half: 'делим пополам', pw_split_eq: 'делим поровну', pw_split_shared: 'из общего кошелька', pw_in_money: 'уже в «Деньгах»',
    vi_title_bad: 'Виза кончается раньше договора', vi_title_ok: 'С визой всё в порядке', vi_title_none: 'До какого числа виза?', vi_none: 'Укажи дату — напомню о продлении заранее. Только дата, номера не нужны.',
    vi_mine: 'Твоя виза до {v}, договор до {l}.', vi_mine_nolease: 'Твоя виза до {v}.', vi_extend: 'Продление — подать до {d}, напомню за {w}.', vi_other_ok: 'У {name} виза до {v} — всё ок.', vi_other_bad: 'У {name} виза до {v} — раньше договора.',
    vi_week: 'неделю', vi_weeks: (n) => `${n} ${pl(n, 'неделю', 'недели', 'недель')}`, vi_days: (n) => `${n} ${pl(n, 'день', 'дня', 'дней')}`, vi_sheet: 'Моя виза до', vi_sheet_text: 'Только дату: её видишь ты и владелец поиска. Номер паспорта и визы не нужен.', vi_clear: 'Убрать дату', vi_saved: 'Сохранил',
    em_title: 'Если что-то случилось', em_hospital: 'Больница', em_clinic: 'Клиника', em_pharmacy: 'Аптека', em_247: '24/7', em_min: '{n} мин', em_ambulance: 'Скорая {a} · полиция {p}', em_tourist: 'Туристическая полиция: {x}',
    em_power_tokens: 'или токены кончились', em_broken: 'Сломалось в доме', em_foot: 'Номера и правила — из пака региона, адреса — рядом с вашим домом.', em_none: 'В паке региона пока нет экстренных номеров.',
    pl_title: 'Ваши места', pl_none: 'Добавь места, куда ездите каждый день: серф, коворкинг, зал, школу. Агент посчитает время от каждого варианта.', pl_by: 'на байке', pl_car: 'на машине', pl_taxi: 'на такси', pl_walk: 'пешком',
    pl_limit: 'лимит {n}', pl_cmp: 'Сравнение с шорт-листом', pl_closest: 'Ближе всех: {a}.', pl_farther: '{a} — дальше, чем {list}.', pl_same: 'По местам примерно как остальные из шорт-листа.', pl_foot: 'Время — по маршрутам OSM в час пик. Места задаются в брифе.',
    pl_est: '~ — по прямой, пока агент не посчитал маршрут.', pl_add: 'Новое место', pl_name: 'Название', pl_name_ph: 'Серф: Melasti', pl_type: 'Что это', pl_where: 'Ссылка Google Maps или координаты', pl_where_ph: 'https://maps.app.goo.gl/… или -8.84, 115.17',
    pl_max: 'Не дольше, мин', pl_mode: 'Как ездим', pl_saved: 'Место добавлено, агент посчитает время', pl_removed: 'Место убрано', pl_remove: 'Убрать место', pl_row: (n, v) => `${n} из ${v.m} в лимите`, pl_open_map: 'Открыть на карте', pl_bad_point: 'Нужна ссылка с координатами или «широта, долгота»',
    at_surf: 'серф', at_beach: 'пляж', at_cowork: 'коворкинг', at_gym: 'зал', at_yoga: 'йога', at_shop: 'магазин', at_school: 'школа', at_airport: 'аэропорт', at_work: 'работа', at_friends: 'друзья', at_cafe: 'кафе', at_other: 'другое',
    ds_map: 'Районы {r}', ds_map_plain: 'Районы', ds_hint: 'нажми на район', ds_fit: '{n}% под бриф', ds_fit_short: 'под бриф', ds_here: 'Варианты здесь', ds_to_brief: 'В бриф', ds_in_brief: 'В брифе', ds_listings: (n) => `${pl(n, 'вариант', 'варианта', 'вариантов')}`,
    ds_br: '{n} сп', ds_airport: 'до аэропорта', ds_ocean: 'до океана', ds_h: '{n} ч', ds_scores: 'Оценки', ds_pros: 'Плюсы', ds_cons: 'Минусы', ds_foot_crm: 'Цены — по {n} объявлениям из ваших поисков. Оценки — пак региона.',
    ds_foot_pack: 'Цены — из пака региона, пока объявлений мало. Оценки — пак региона.', ds_added: 'Район добавлен в бриф', ds_asked: 'Попросил агента добавить район в бриф', ds_filter: 'Район: {a}', ds_mode: 'Районы',
    sc_surf: 'Серф', sc_quiet: 'Тишина', sc_no_traffic: 'Без пробок', sc_food: 'Кафе и еда', sc_coworking: 'Коворкинги', sc_nightlife: 'Тусовки',
    rl_kicker: 'пересдаём остаток', rl_title: 'Ищем, кому передать', rl_months: (n) => `${n} ${pl(n, 'месяц', 'месяца', 'месяцев')}`, rl_ad: 'Объявление', rl_leads: 'Отклики · {n}', rl_no_leads: 'Откликов пока нет',
    rl_c_yes: 'Хозяин согласен', rl_c_asked: 'Спросили хозяина, ждём ответ', rl_c_no: 'Хозяин против', rl_c_unknown: 'Согласие хозяина не спрашивали', rl_none: 'Агент ещё не готовил объявление о пересдаче.', rl_ask: 'Попросить агента',
    rl_ask_text: 'Подготовь объявление о пересдаче остатка срока: спроси согласие хозяина, текст и фото дай на одобрение', rl_asked: 'Агент подготовит объявление и пришлёт на одобрение',
    rl_friends: 'Только знакомым. Объявления «ищу соседа» и «пересдаю виллу» в чатах здесь отслеживают, за ними приходят хозяин, банджар или иммиграция', ch_friends: 'знакомым',
    rl_plain_ok: 'Хозяин согласен, можно выложить в чаты, но как обычную сдачу виллы: без слов «пересдача», «переуступка» и «субаренда». Соседа или комнату здесь ищут только среди знакомых',
    rl_plain_wait: 'Пока хозяин не согласился, только знакомым. После его «да» можно выложить в чаты как обычную сдачу виллы, без слова «пересдача»',
    rl_ask_text_plain: 'Подготовь сдачу виллы на остаток срока: сначала спроси согласие хозяина; после «да» объявление как обычная сдача виллы (без слов пересдача, переуступка, субаренда), текст и фото на одобрение', rl_asked_plain: 'Агент спросит хозяина и подготовит объявление',
    rl_ask_text_friends: 'Подготовь текст о пересдаче остатка срока, чтобы мы сами разослали знакомым (никаких постов в чатах и группах): сначала спроси согласие хозяина', rl_asked_friends: 'Агент спросит хозяина и пришлёт текст для знакомых',
    ls_new: 'Новый', ls_reply: 'Ответить', ls_viewing: 'Просмотр', ls_agreed: 'Договорились', ls_not_suitable: 'Не подходит',
    ch_telegram: (n) => `${n} ${pl(n, 'чат', 'чата', 'чатов')} Telegram`, ch_facebook: (n) => `${n} ${pl(n, 'группа', 'группы', 'групп')} FB`, ch_marketplace: 'Marketplace', ch_whatsapp: (n) => `${n} WhatsApp`, ch_portal: 'портал',
    dr_title: 'Контакты', dr_kicker: 'рядом с домом', dr_all: 'Все', dg_home: 'Дом', dg_bikes: 'Байки', dg_food: 'Еда', dg_services: 'Сервисы', dg_health: 'Здоровье', dgl_food: 'Еда и рынки', dgl_health: 'Здоровье и аптеки',
    dr_none: 'Пока пусто. Добавь байки, воду, прачечную, рынок — или попроси агента найти.', dr_add: 'Новый контакт', dr_group: 'Группа', dr_name_ph: 'Вода Aqua 19 л', dr_sub: 'Цена, часы, что важно', dr_sub_ph: 'Доставка галлонов · 25 тыс',
    dr_channel: 'Как связаться', dr_addr_wa: 'Номер WhatsApp', dr_addr_tg: '@username в Telegram', dr_addr_phone: 'Телефон', dr_addr_map: 'Ссылка на карту', dr_saved: 'Контакт добавлен', dr_new_group: 'Новая группа', dr_group_ph: 'Дети', dr_group_saved: 'Группа добавлена',
    dr_write: 'Написать', dr_call: 'Позвонить', dr_map: 'Карта', dr_agent: 'Попросить агента написать', dr_agent_ph: 'Закажи 2 галлона воды на завтра утром', dr_agent_sent: 'Агент напишет и пришлёт сообщение на одобрение', dr_delete: 'Удалить контакт', dr_deleted: 'Удалено', ch_map: 'Карта',

    // wave 4
    ds_rooms: '{n}-комн.', ds_flood: 'Вода после ливня: {x}',
    fl_low: 'низкий риск', fl_medium: 'средний риск', fl_high: 'высокий риск', fl_l_low: 'низкий', fl_l_medium: 'средний', fl_l_high: 'высокий', fl_title: 'Вода после ливня: {x}',
    fl_sources: 'Откуда знаем', fl_terrain: 'Рельеф', fl_chats: 'Чаты аренды', fl_notes: 'Ваши заметки', fl_area: 'Район', fl_none: 'Агент ещё не проверил рельеф и чаты по этому дому.',
    fl_area_line: '{a} — {x}: {n}', fl_add: 'Добавить заметку', fl_note_t: 'Что с водой у этого дома?', fl_note_ph: 'После ливня в переулке по щиколотку', fl_saved: 'Заметка сохранена, агент учтёт',
    lc_badge: 'Локация {n}', lc_word: 'локация', lc_min: '{n} мин', lc_points: (n) => `${n} ${pl(n, 'балл', 'балла', 'баллов')}`, lc_how: 'Как считается {n}', lc_none: 'Агент ещё не посчитал кольца {r} минут для этого дома.',
    lc_ask: 'Попросить агента посчитать', lc_asked: 'Агент посчитает кольца и оценку', lc_ask_text: 'Посчитай кольца {r} минут и оценку локации (location_refresh)', lc_more: '+{n}',
    lc_title: 'Локация {n}', lc_by_type: 'По типам мест · вес под ваш бриф', lc_how_t: 'Как считаем',
    lc_how_text: 'Каждое место = уровень (★ топ 1, хорошее 0,6, обычное 0,3) × кольцо ({rings}) × вес типа; ваши места из Google Maps весят в полтора раза больше. По типу места складываем с насыщением — десятая кофейня почти ничего не добавляет. Типы взвешиваем по брифу. Нет магазина в {r} минутах — минус.',
    lc_quiet_ok: 'Рядом нет клубов и стройки — шум не снижает оценку', lc_no_shop: 'Нет супермаркета в {r} минутах: −10', lc_club_near: 'Рядом шумное место «{p}»: −8', lc_construction_near: 'Рядом стройка «{p}»: −8', lc_shop_ok: 'Супермаркет ближе {r} минут',
    lc_row: 'Локация', lc_row_sub: '{r} мин: {x}',
    lg_anchors: 'Ваши места', lg_surf: 'Серф и пляжи', lg_shops: 'Магазины', lg_cafes: 'Кафе', lg_work: 'Работа', lg_sport: 'Спорт', lg_medical: 'Медицина', lg_nightlife: 'Тусовки',
    pt_beach: 'Пляж', pt_surf: 'Серф', pt_coworking: 'Коворкинг', pt_gym: 'Спортзал', pt_yoga: 'Йога', pt_supermarket: 'Супермаркет', pt_market: 'Рынок', pt_hospital: 'Больница', pt_pharmacy: 'Аптека',
    pt_coffee: 'Кофейня', pt_food: 'Еда', pt_daytrip: 'Поездка', pt_nightlife: 'Бары и клубы', pt_construction: 'Стройка', pt_other: 'Другое',
    sp_all: 'Все', sp_title: 'Подборка мест', sp_n: (n) => `${n} ${pl(n, 'место', 'места', 'мест')}`, sp_trip: 'За городом', sp_add: 'Добавить из Google Maps — вставь ссылку на место или на список',
    sp_none: 'В этом районе пока нет мест.', sp_link_t: 'Места из Google Maps', sp_link_text: 'Вставь ссылку на место или на список (Поделиться → Копировать ссылку). Агент заберёт места, определит тип и район.',
    sp_link_ph: 'https://maps.app.goo.gl/…', sp_link_sent: 'Агент заберёт места из ссылки', sp_bad_link: 'Нужна ссылка Google Maps', sp_areas: 'Район', sp_own: 'из ваших карт', sp_pack: 'из пака региона',
    sp_tier: 'Уровень', sp_type: 'Тип', sp_hide: 'Скрыть место', sp_saved: 'Сохранено', sp_layer: 'Места', sp_list: 'Подборка',
    bk_title: 'Байки', bk_n: (n) => `${n} ${pl(n, 'байк', 'байка', 'байков')}`, bk_per: '{x}/мес', bk_price: 'цена', bk_paid: 'оплачено', bk_until: 'до {d}', bk_in: (n) => `Через ${n} ${pl(n, 'день', 'дня', 'дней')}`, bk_today: 'Сегодня', bk_late: 'Просрочено', bk_ok: 'Ок',
    bk_returned: 'Вернули', bk_pickup: 'При получении байка', bk_video: 'Видео всех царапин с датой', bk_helmets: 'Шлемы', bk_stnk: 'Техпаспорт (STNK) в бардачке', bk_fuel: 'Сколько бензина',
    bk_foot: 'Оригинал паспорта не оставляй — только копию. Напомню об оплате за 2 дня и в день.', bk_passport: 'В залоге оригинал паспорта? Забери его и оставь копию или деньги.',
    bk_none: 'Добавь байк: модель, номер, цена и до какого числа оплачено. Напомню об оплате и возврате.', bk_add: 'Новый байк', bk_model: 'Модель', bk_model_ph: 'Honda Scoopy 110', bk_plate: 'Номер', bk_plate_ph: 'DK 1234 AB',
    bk_rider: 'Кто ездит', bk_shared: 'Общий', bk_price_l: 'Цена', bk_period_month: 'в месяц', bk_period_week: 'в неделю', bk_period_day: 'в день', bk_paid_l: 'Оплачено до', bk_deposit: 'Что оставили в залог', bk_deposit_ph: 'Копия паспорта, 1 млн',
    bk_rental: 'Прокат', bk_rental_ph: 'Ungasan Bike Rental', bk_wa: 'WhatsApp проката', bk_saved: 'Байк сохранён', bk_pay: 'Оплатили', bk_pay_t: 'Оплата байка', bk_pay_until: 'Теперь оплачено до', bk_pay_sum: 'Сумма', bk_paid_ok: 'Записал в расходы',
    bk_return: 'Вернули байк', bk_return_date: 'Вернуть', bk_edit: 'Изменить', bk_wa_btn: 'WA', bk_scan: '3D-скан байка',
    ac_title: '3D-акт', ac_kicker: '{home} · заезд {d}', ac_spin: '3D · крути пальцем', ac_rooms: 'Комнаты · {x} из {n}', ac_send: 'Отправить хозяевам', ac_sent: 'Агент подготовит сообщение хозяевам на одобрение',
    ac_foot: 'При выезде {d} снимешь ещё раз — покажу оба скана рядом.', ac_foot_nodate: 'При выезде снимешь ещё раз — покажу оба скана рядом.', ac_scan: 'Скан {d}', ac_none_t: 'Сними дом на телефон',
    ac_none: 'В Scaniverse или Polycam (LiDAR) пройди по комнатам, экспортируй GLB и пришли файл боту в личку. Подпись к файлу — название комнаты.', ac_open_bot: 'Открыть чат с ботом',
    ac_redo: 'доснять', ac_todo: 'ещё не сняли', ac_in: 'Заезд', ac_out: 'Выезд', ac_loading: 'Загружаю 3D…', ac_fail: 'Не получилось открыть скан',
    do_title: 'Досье дома', do_months: 'жили мы', do_issues: (n) => pl(n, 'поломка', 'поломки', 'поломок'), do_price_all: 'всё включено', do_price: 'в месяц', do_what: 'Что было', do_verdict: 'Итог: {x}',
    do_foot: 'Досье видят все на этом Hunt. Если вилла попадётся в новом поиске, агент покажет его.', do_none: 'Досье пока нет: агент соберёт историю дома при выезде.', do_banner: 'Есть досье: вы или друзья уже жили здесь', do_mo: (n) => `${n} мес`,
    it_title: 'Вещи · {x}', it_title0: 'Вещи', it_kicker: 'Купили у {s} · {n}', it_kicker0: (n) => `${n} ${pl(n, 'вещь', 'вещи', 'вещей')}`, it_ours: 'Наше', it_add: 'Вещь', it_at: 'у {s} {d}', it_sold: 'продано', it_offered: 'предложили',
    it_resale_t: 'При выезде продадим дальше', it_resale: 'За 2 недели до {d} агент предложит вещи следующим жильцам и в чаты. Ориентир — вернуть около {x}.', it_resale_nodate: 'Перед выездом агент предложит вещи следующим жильцам и в чаты. Ориентир — вернуть около {x}.',
    it_none: 'Записывайте, что купили в дом: при выезде агент продаст это дальше.', it_new: 'Новая вещь', it_name_ph: 'Блендер', it_price: 'Цена', it_seller: 'У кого купили', it_seller_ph: 'Наталья', it_date: 'Когда',
    it_photo: 'Фото', it_saved: 'Сохранено', it_mark_sold: 'Продали', it_sold_price: 'За сколько продали', it_delete: 'Удалить', it_unsold: 'Ещё не продали',
    cl_title: 'Календарь', cl_kicker_home: '{r} · пока вы в {a}', cl_movein: 'Заезд', cl_movein_sub: 'Скан виллы, счётчики, контакты {o}', cl_movein_sub0: 'Скан виллы, счётчики, контакты', cl_moveout: 'Выезд и возврат залога', cl_moveout_sub: 'Осмотр с {o}, повторный 3D-скан', cl_moveout_sub0: 'Осмотр, повторный 3D-скан',
    cl_pay_bike: 'Оплата байка {m}', cl_visa: 'Подать на продление визы', cl_visa_sub: 'виза до {d}', cl_by: 'до {d}', cl_none: 'Здесь будут даты договора, оплаты и местные праздники.', cl_viewings: 'Просмотры', cl_open: 'Календарь', cl_now_season: 'Сейчас: {x}',
    w4_bikes: 'Байки', w4_bikes_sub0: 'аренда, оплата, чек-лист', w4_act: '3D-акт', w4_act_sub: '{x} из {n} комнат', w4_act_sub0: 'сними дом на телефон', w4_items: 'Вещи', w4_items_sub0: 'что купили в дом', w4_dossier: 'Досье дома', w4_dossier_sub: 'история и итог при выезде',
    // wave 5
    sf_title: 'Серф', sf_best: 'Лучшее сегодня', sf_near: 'Споты рядом', sf_m: '{x} м', sf_s: '{n} с', sf_period: 'период {n} с',
    sf_off_until: 'ветер с берега до {h}', sf_off_from: 'ветер с берега с {h}', sf_later_onshore: ', потом сдувает', sf_later_cross: ', потом боковой', sf_onshore: 'ветер с моря',
    sf_reef: 'риф', sf_beach: 'пляж', sf_lv_beginner: 'для новичков', sf_lv_intermediate: 'средний', sf_lv_advanced: 'для опытных',
    sf_flat_t: 'Сегодня тихо', sf_flat: 'На спотах рядом нет нормальной волны.', sf_err_short: 'Прогноз волн сейчас недоступен.',
    sf_note_on: 'Строка с лучшим спотом приходит в утренней сводке бота', sf_note_off: 'Серф в утренней сводке выключен — нажми, чтобы включить',
    sf_on: 'Серф будет в утренней сводке', sf_off: 'Убрал серф из утренней сводки',
    sf_none: 'В 30 минутах от дома нет серф-спотов.', sf_no_home: 'Не знаю, откуда считать: нужен дом, якорь или районы в брифе.', sf_err: 'Прогноз волн сейчас недоступен. Попробуй позже.',
    sf_pref: 'Серф в утренней сводке', sf_pref_sub: 'лучший спот и окно на день', sf_pref_auto: 'лучший спот и окно · сейчас по брифу',
    sf_row: 'Серф', sf_row_sub: 'волны на спотах рядом', sf_row_today: 'Серф сегодня', sf_line: 'Сегодня {s} {h}, лучше до {t}', sf_line0: 'Сегодня {s} {h}',
    gd_title: 'Гайд для гостей', gd_kicker: 'Гайд для гостей · от {h}', gd_map: 'Карта', gd_wifi: 'Wi-Fi: {x}', gd_pass: 'пароль: {x}', gd_show: 'Показать', gd_hide: 'Скрыть', gd_copy: 'Скопировать', gd_copied: 'Скопировано',
    gd_rules: 'Правила дома', gd_emergency: 'Если что-то случилось', gd_host: 'хозяин гайда, пиши, если что', gd_write: 'Написать', gd_empty: 'Хозяева ещё не заполнили гайд.',
    gd_empty_member: 'Гайд пуст. Заполни адрес, Wi-Fi и правила — гости увидят только это, без денег и переписок.', gd_view: 'Гайд', gd_edit: 'Править',
    gd_address: 'Адрес и как найти', gd_address_ph: 'Jl. Toya Ning 1, Gang Bambu · ворота с бамбуком', gd_map_url: 'Ссылка на карту', gd_wifi_name: 'Сеть Wi-Fi', gd_wifi_pass: 'Пароль Wi-Fi',
    gd_rule_ph: 'Не курим внутри, на улице можно', gd_rule_add: 'Добавить правило', gd_rule_icon: 'Значок правила', gd_rule_del: 'Удалить правило', gd_note: 'Заметка гостям', gd_note_ph: 'Ключ в сейфе у двери, код пришлём в день заезда',
    gd_save: 'Сохранить гайд', gd_saved: 'Гайд сохранён', gd_sensitive: 'Убери номера документов и карт — гайд видят гости',
    gd_link: 'Ссылка для гостей', gd_link_none: 'Ссылки ещё нет — появится при первой отправке. По ней гайд открывается без входа.', gd_link_on: 'По ссылке гайд открывается без входа. Деньги и переписки не видны.',
    gd_share: 'Поделиться в Telegram', gd_copy_link: 'Скопировать ссылку', gd_regen: 'Новая ссылка', gd_regen_q: 'Сделать новую ссылку? Старая перестанет работать.', gd_regen_ok: 'Новая ссылка готова, старая не работает',
    gd_revoke: 'Закрыть доступ', gd_revoke_q: 'Закрыть доступ к гайду по ссылке?', gd_revoked: 'Доступ по ссылке закрыт', gd_share_text: 'Гайд по нашему дому: адрес, Wi-Fi и правила',
    gd_row_sub: 'адрес, Wi-Fi, правила', gd_row_ready: 'ссылка для гостей готова',
    gd_ic_smoke: 'курение', gd_ic_water: 'вода', gd_ic_zap: 'свет', gd_ic_trash: 'мусор', gd_ic_moon: 'тишина', gd_ic_key: 'ключи', gd_ic_car: 'парковка', gd_ic_dog: 'животные', gd_ic_pool: 'бассейн', gd_ic_shoe: 'обувь', gd_ic_info: 'другое',
    nx_title: 'Что дальше?', nx_lease_to: 'договор до {d}', nx_weeks: (n) => `До конца договора ${n} ${pl(n, 'неделя', 'недели', 'недель')}`, nx_soon: 'Договор заканчивается на этой неделе',
    nx_by: 'Решите до {d}, чтобы спокойно успеть.', nx_late: 'Решите как можно скорее.', nx_owner: 'хозяина',
    nx_stay: 'Остаёмся', nx_stay_sub: 'Агент спросит у {o} цену и условия нового договора', nx_new: 'Ищем новое', nx_new_sub: 'Запущу поиск по старому брифу, с учётом досье и заметок',
    nx_leave: 'Уезжаем', nx_leave_sub: 'Выезд, 3D-скан, залог, вещи на продажу',
    nx_foot: 'Голосуют все участники, решает большинство — как с виллами.', nx_voted: (n, v) => `Проголосовали ${n} из ${v.m}.`,
    nx_decided: 'Решили', nx_by_owner: 'Голоса разделились — решил голос владельца.', nx_do_stay: 'Агент спросит у {o} цену и условия нового договора и пришлёт сообщение на одобрение.',
    nx_do_new: 'Новый поиск по старому брифу уже создан: те же участники, места и заметки.', nx_do_new_wait: 'Агент создаст новый поиск по старому брифу.', nx_do_leave: 'Готовим выезд: уведомление хозяину, 3D-скан, залог и вещи на продажу.',
    nx_open_new: 'Открыть новый поиск', nx_to_moveout: 'К выезду', nx_none: 'До конца договора далеко. За 6 недель агент спросит, что дальше.', nx_card: 'Что дальше?',
    ng_row: 'Что предложить хозяину', ng_row_sub: 'цена, аргументы, история дома', ng_asked: 'просят {x}', ng_offer: 'Что предложить',
    ng_upfront: (n) => `за ${n} ${pl(n, 'месяц', 'месяца', 'месяцев')} сразу`, ng_args: 'Аргументы: {x}.', ng_capped: 'Не выше бюджета, который вы назвали.',
    ng_a_median: 'медиана района {x}', ng_a_noinc: '{x} не включён', ng_a_noinc_f: '{x} не включена', ng_a_noinc_n: '{x} не включены', ng_a_empty: 'свободна с {d}', ng_a_empty_m: 'свободен с {d}',
    ng_a_season_wet: 'сезон дождей, спрос ниже', ng_a_season_low: 'низкий сезон, спрос ниже', ng_a_season_high: 'высокий сезон', ng_a_term: (n) => `платим за ${n} мес. сразу`,
    ng_a_long: (n) => `висит ${n} ${pl(n, 'день', 'дня', 'дней')}`, ng_a_cheaper: 'раньше сдавали за {x} ({d})',
    ng_none_t: 'Пока не с чем сравнить', ng_none: 'Агент соберёт цены похожих домов и историю этого — тогда подскажу цену.',
    ng_beds: (n) => `${n} ${pl(n, 'спальня', 'спальни', 'спален')}`, ng_in: '{b} в {d}', ng_similar: 'Похожие дома', ng_median: 'медиана {x}', ng_count: (n) => `${n} ${pl(n, 'объявление', 'объявления', 'объявлений')}`,
    ng_pack: 'по данным пака', ng_market_none: 'Похожих объявлений пока мало — сравнить не с чем.',
    ng_hist_villa: 'Эта вилла раньше', ng_hist_flat: 'Эта квартира раньше', ng_hist_house: 'Этот дом раньше', ng_hist_none: 'Раньше этот дом нам не попадался.',
    ng_m_contact: 'тот же контакт', ng_m_photos: 'по фото', ng_m_point: 'та же точка на карте', ng_m_dossier: 'из досье',
    ng_foot: 'Видно только тебе — потолок бюджета никому не показываем', ng_owner_only: 'Подсказку по торгу видит только владелец поиска.',
    rc_title: 'Итоги поиска', rc_row_sub: 'сколько написали, смотрели и сторговали', rc_found1: '{a} нашёл дом {p}', rc_found: '{a} нашли дом {p}', rc_in_days: (n) => `за ${n} ${pl(n, 'день', 'дня', 'дней')}`,
    rc_contacted: 'написали', rc_replied: 'ответили', rc_viewings: (n) => pl(n, 'просмотр', 'просмотра', 'просмотров'), rc_deals: (n) => pl(n, 'сделка', 'сделки', 'сделок'),
    rc_saved: 'Сторговали {m} в месяц — {t} за срок', rc_saved1: 'Сторговали {m} в месяц', rc_share: 'Поделиться', rc_sent: 'Отправил картинку в чат с ботом — перешли её друзьям',
    rc_incomplete: 'Итоги станут полными после сделки.', rc_share_text: 'Мы нашли дом с Hunt',
    gs_kicker: 'Гость {h}', gs_kicker0: 'Гость', gs_banner: 'Ты гость: видишь {x}. Доступ до {d}', gs_banner0: 'Ты гость. Доступ до {d}', gs_a_guide: 'дом', gs_a_places: 'места рядом', gs_a_contacts: 'контакты',
    gs_guide: 'Гайд', gs_guide_sub: 'адрес, Wi-Fi, правила', gs_places: 'Места рядом', gs_places_sub: 'пляжи, кафе, серф', gs_contacts: 'Контакты', gs_contacts_sub: 'байки, вода, прачечная',
    gs_issue: 'Что-то сломалось', gs_issue_sub: 'сообщить хозяевам', gs_lock: 'Деньги, договор, переписки и голосования гостям не видны',
    gs_nav_home: 'Дом', gs_nav_places: 'Места', gs_nav_contacts: 'Контакты', gs_my_issues: 'Ты сообщил', gs_places_none: 'Мест рядом пока нет', gs_contacts_none: 'Хозяева ещё не добавили контакты.',
    gs_ask: 'Попросить агента написать', gs_ask_ph: 'Нужен байк на 3 дня с завтрашнего утра', gs_ask_sent: 'Отправили на одобрение хозяевам', gs_ask_text: 'Агент напишет, когда хозяева одобрят текст.',
    gi_title: 'Позвать гостя', gi_kicker: '{h} · настройки', gi_from: 'С', gi_to: 'По', gi_sees: 'Гость увидит',
    gi_guide: 'Гайд: адрес, Wi-Fi, правила', gi_places: 'Места рядом и серф', gi_contacts: 'Контакты: байки, вода, прачечная', gi_issues: 'Сообщить о поломке',
    gi_money: 'Деньги и траты', gi_docs: 'Договор и документы', gi_chats: 'Переписки и голосования', gi_a_guide: 'гайд', gi_a_places: 'места', gi_a_contacts: 'контакты', gi_a_issues: 'поломки',
    gi_send: 'Ссылка-приглашение в Telegram', gi_copy: 'Скопировать приглашение', gi_foot: '{d} доступ закроется сам. Продлить или закрыть раньше — здесь же.',
    gi_share_text: 'Приглашаю в гости: адрес, Wi-Fi и всё рядом с домом', gi_bad_dates: 'Дата «по» раньше даты «с»', gi_no_areas: 'Включи хотя бы один раздел',
    gi_now: 'Гости сейчас', gi_extend: '+7 дней', gi_extended: 'Продлили до {d}', gi_revoke: 'Закрыть доступ', gi_revoke_q: 'Закрыть доступ гостю {x}?', gi_revoked: 'Доступ закрыт',
    gi_row: 'Гости', gi_row_sub0: 'гайд и места рядом для друзей в гостях', gi_row_sub: (n) => `${n} ${pl(n, 'гость', 'гостя', 'гостей')} сейчас`, gi_role: 'гость',
    // wave 6 · D: home mode
    hm_nav_today: 'Дом', hm_nav_map: 'Карта', hm_nav_plan: 'План', hm_nav_more: 'Ещё', hm_our_home: 'Наш дом', hm_our_home_day: 'Наш дом · день {d} из {n}',
    hm_movein_today: 'Заезд сегодня', hm_movein_tomorrow: 'Заезд завтра', hm_movein_wd: 'Заезд {wd}', hm_movein_date: 'Заезд {d}', hm_moved_in: 'Заехали {d}', hm_movein_none: 'Скоро заезд',
    hm_wd_acc: (n) => ['в воскресенье', 'в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу'][n],
    hm_month_in: (n) => ['в январе', 'в феврале', 'в марте', 'в апреле', 'в мае', 'в июне', 'в июле', 'в августе', 'в сентябре', 'в октябре', 'в ноябре', 'в декабре'][n],
    hm_in_days: (n) => (n === 0 ? 'сегодня' : n === 1 ? 'завтра' : `через ${n} ${pl(n, 'день', 'дня', 'дней')}`),
    hm_left_lease: (n) => `до конца договора ${n} ${pl(n, 'день', 'дня', 'дней')}`, hm_closed: 'Проект закрыт, всё только для чтения',
    hm_stage_k: 'Этап {i} из {n} · {k}', hm_st_start: 'старт', hm_st_search: 'поиск', hm_st_viewings: 'просмотры', hm_st_choice: 'выбор', hm_st_deal: 'сделка', hm_st_movein: 'заезд',
    hm_st_living: 'живём', hm_st_extension: 'продление', hm_st_next: 'что дальше', hm_st_relet: 'переуступка', hm_st_moveout: 'выезд', hm_st_closed: 'закрыт',
    hm_b_lease: 'Договор', hm_b_paid: 'Оплачено', hm_checklist: 'До заезда · {k} из {n}', hm_term_checklist: 'К новому договору · {k} из {n}', hm_today: 'Сегодня',
    hm_surf_k: 'Серф сегодня', hm_surf_t: '{s} до {t}', hm_pay: 'Платёж {x} {w}', hm_power: (n) => `Свет: осталось ~${n} ${pl(n, 'день', 'дня', 'дней')}`, hm_power_sub: 'пополнить до {d}',
    hm_bike: 'Байк: оплата {w}', hm_bike_late: 'Байк: оплата просрочена', hm_guest_in: '{g} приезжает {w}', hm_guest_here: '{g} гостит до {d}',
    hm_q_lease: 'Договор', hm_q_money: 'Деньги', hm_q_contacts: 'Контакты', hm_q_bikes: 'Байки', hm_q_guests: 'Гости', hm_q_docs: 'Документы',
    hm_more: 'Ещё', hm_more_home: 'Дом', hm_more_life: 'Жизнь', hm_more_search: 'Поиск', hm_m_docs: 'Договор и документы', hm_files: (n) => `${n} ${pl(n, 'файл', 'файла', 'файлов')}`, hm_dates_word: 'сроки',
    hm_m_money: 'Деньги', hm_m_money_sub: 'общий бюджет · {x} {m}', hm_m_money_sub0: 'общий бюджет', hm_m_contacts: 'Контакты рядом', hm_m_contacts0: 'дом, байки, еда, сервисы',
    hm_m_bikes: 'Байки', hm_m_bikes_sub: '{n} · оплата {d}', hm_m_bikes0: 'аренда, оплата, возврат', hm_m_house: 'Поломки и всё о доме', hm_m_house_sub: 'свет, визы, гайд, выезд',
    hm_m_guests: 'Гости', hm_m_guests_sub: 'гайд и доступ на даты', hm_m_items: 'Вещи с виллы', hm_m_items0: 'что купили в дом', hm_m_act: '3D-акт', hm_m_act_sub: 'заезд {d}', hm_m_act0: 'сканы комнат при заезде',
    hm_m_useful: 'Полезное', hm_m_useful_sub: 'чаты, приложения, гайды', hm_m_next: 'Что дальше', hm_m_next_sub: 'продлеваем, ищем новый или уезжаем',
    hm_m_archive: 'Варианты, что смотрели', hm_m_archive_sub: (n) => `${n} ${pl(n, 'вариант', 'варианта', 'вариантов')} · архив`, hm_m_path: 'Путь проекта', hm_m_path_sub: 'этап {i} из {n}',
    hm_arch_note: 'Архив поиска: голосовать уже не нужно, всё сохранили для истории', hm_layer_places: 'Места', hm_layer_contacts: 'Контакты', hm_map_none: 'Нет точки дома на карте',
    hm_cl_guest_in: '{g} приезжает', hm_cl_guest_out: '{g} уезжает', hm_cl_bike_return: 'Вернуть {m}', hm_cl_visa: 'Виза: {g}', hm_cl_visa_sub: 'до {d}, продлить заранее',
    hm_cl_term: 'Новый договор', hm_cl_term_end: 'Конец договора',
    gq_req: '{g} просит написать {c}:', gq_send: 'Отправить', gq_skip: 'Не отправлять', gq_edit: 'Изменить текст', gq_sent: 'Агент отправит сообщение', gq_skipped: 'Не отправляем',
    lc_stale: 'Агент пересчитает кольца', lc_rush: 'Кольца — время{m} без пробок; в час пик примерно +{p}%', lc_rush_m: ' в пути',
  },
  en: {
    stage_n_of: 'Stage {i} of {n}',
    // wave 7 · Afisha (E2, E3, E5)
    af_title: 'Events', af_social: 'Nightlife', af_more: 'Shuffle', af_prefs: 'Events settings', af_of_day: 'Event of the day', af_book: 'Sign up', af_nope: 'Not for me', af_unnope: 'Back to the picks',
    af_hint_l: 'not for me', af_hint_r: 'sign up', af_f_all: 'All', af_f_ru: 'RU', af_f_en: 'EN', af_f_free: 'Free', af_f_evening: 'Evening', af_f_morning: 'Morning', af_f_night: 'Night',
    af_f_r20: 'Under 20 min', af_f_book: 'Booking', af_f_beginner: 'Beginners', af_f_today: 'Today', af_f_bars: 'Bars', af_f_clubs: 'Clubs', af_f_sport: 'Sport',
    af_free: 'free', af_entry_free: 'free entry', af_on_site: 'on site', af_l_none: 'No words', af_live: 'on now', af_in_h: 'in {n} h', af_in_min: 'in {n} min', af_from: 'from {t}',
    af_min_bike: '{n} min by bike', af_today_at: 'today at {t}', af_all: 'All', af_n_week: (n) => `${n} ${pl(n, 'event', 'events')} this week`,
    af_empty: 'No events nearby yet', af_empty_sub: 'The agent collects events every day from chats and venues near your home', af_empty_f: 'Nothing for these filters', af_empty_f_sub: 'Drop a filter or pick another day',
    af_by_wd: 'By weekday', af_wd1: 'Mon', af_wd2: 'Tue', af_wd3: 'Wed', af_wd4: 'Thu', af_wd5: 'Fri', af_wd6: 'Sat', af_wd7: 'Sun',
    af_st_requested: 'Agent will book', af_st_drafted: 'Text waits for approval', af_st_asked: 'Waiting for the organizer', af_st_booked: 'Booked', af_st_attended: 'Went', af_st_declined: 'No places',
    af_c_culture: 'Culture', af_c_nature: 'Nature', af_c_sport: 'Sport', af_c_dance: 'Dance', af_c_music: 'Music', af_c_food: 'Food', af_c_workshop: 'Workshop', af_c_party: 'Party',
    af_c_wellness: 'Wellness', af_c_kids: 'Kids', af_c_other: 'Event', af_c_bar: 'Bar', af_c_club: 'Club', af_c_beach_club: 'Beach club', af_c_social_sport: 'Sport', af_c_meetup: 'Meetup', af_c_quiz: 'Quiz',
    af_t_sea: 'Sea', af_t_snorkel: 'Sea', af_t_diving: 'Sea', af_t_boat: 'Sea', af_t_padel: 'Padel', af_t_surf_meetup: 'Surf', af_t_surf: 'Surf', af_t_cinema: 'Cinema', af_t_yoga: 'Yoga',
    af_t_market: 'Market', af_t_karaoke: 'Karaoke', af_t_stargazing: 'Stars', af_t_sunrise_hike: 'Sunrise', af_t_volcano: 'Volcano', af_t_waterfall: 'Waterfall', af_t_sunset_session: 'Sunset',
    af_sea_calm: 'Calm sea {w}', af_sea_rough: 'Rough sea {w}', af_band_morning: 'in the morning', af_band_day: 'in the afternoon', af_band_evening: 'in the evening', af_wave: 'waves {x} m',
    af_wind_low: 'light wind', af_wind_mid: 'moderate wind', af_wind_high: 'strong wind',
    af_agent: 'The agent will book', af_how: 'How to go', af_ag_msg: 'Messages the organizer on {c}', af_ag_msg0: 'Messages the organizer', af_ag_msg_s: 'you see the text before it goes',
    af_ag_ticket: 'Tickets from the organizer', af_ag_ticket_s: 'you buy them, the agent never touches money', af_ag_none: 'No booking needed', af_ag_none_s: 'just come, mark who goes',
    af_ag_seats: (n, v) => `Places for ${n}, you and ${v.names}`, af_ag_seat1: 'A place for you', af_ag_seats_s: 'you can bring a guest',
    af_ag_pay: 'Pay on site, yourselves', af_ag_pay_s: 'the agent never touches money', af_beginner: 'Beginners', af_v_chill: 'Chill', af_v_party: 'Party', af_v_sport: 'Sport', af_v_meet: 'Meet people',
    af_cr_expats: 'Expats', af_cr_locals: 'Locals', af_cr_mixed: 'Mixed crowd', af_e_fee: 'Paid entry', af_e_min_spend: 'Min spend', af_e_guest_list: 'Guest list',
    af_who_none: 'Nobody yet', af_want: 'I want to go', af_want_on: "I'm going", af_want_sent: 'The others get one message', af_going: 'Going: {names}', af_you: 'you', af_you_cap: 'You',
    af_you_want: 'You want to go', af_wants1: '{name} wants to go', af_wantsN: '{names} want to go', af_source: 'Source', af_save: 'Save', af_saved: 'Saved', af_unsaved: 'Removed from saved',
    af_noped: 'Got it, less of this', af_unnoped: 'Back in the picks', af_cancel: 'Cancel', af_cancelled: 'Cancelled', af_tickets: 'Buy a ticket',
    af_book_two: 'Sign the two of us up', af_book_three: 'Sign the three of us up', af_past: 'This event is over', af_viewer: 'Search members can sign up',
    af_who_title: "Who's going", af_guests: 'Guests', af_k_join: 'Just come', af_k_guest_list: 'Guest list', af_k_table: 'Table', af_k_slot: 'A spot in the game', af_note_ph: 'A note for the organizer, optional',
    af_book_note: 'The agent writes to the organizer in their language and shows you the text first. You pay on site', af_book_note_ticket: 'The organizer sells the tickets, you buy them. We mark who goes',
    af_book_note_none: 'No booking needed. We mark who goes so the others see it', af_book_btn: (n) => `Ask the agent · ${n} ${pl(n, 'person', 'people')}`,
    af_book_ticket_btn: 'Mark and open tickets', af_book_none_btn: "Mark we're going", af_booked_req: 'The agent will write to the organizer and show you the text first', af_booked_self: 'Marked',
    af_p_night: 'Bars and parties', af_p_night_sub: "Turn off and we won't suggest bars, clubs or alcohol promos", af_p_line: 'Event of the day in the morning digest', af_p_line_sub: 'one line in the bot message',
    af_p_like: 'What you like', af_p_age: 'Age', af_p_note: 'The picks learn from your likes, "not for me" and ratings after events',
    af_i_nightlife: 'Nightlife', af_i_sport: 'Sport', af_i_surf: 'Surf', af_i_culture: 'Culture', af_i_nature: 'Nature', af_i_food: 'Food', af_i_wellness: 'Yoga', af_i_music: 'Music', af_i_creative: 'Creative', af_i_social: 'Meeting people',
    hm_m_afisha: 'Events', hm_m_afisha_sub: 'what is on nearby, nightlife',
    // wave 6 · A: project path (45), projects list (00c)
    pp_title: 'Project path', pp_projects: 'Projects', pp_k_start: 'Start', pp_k_search: 'Search', pp_k_viewings: 'Viewings', pp_k_choice: 'Choice', pp_k_deal: 'Deal',
    pp_k_movein: 'Move-in', pp_k_living: 'Living', pp_k_extension: 'Extension', pp_k_next: 'What next', pp_k_relet: 'Re-let', pp_k_moveout: 'Move-out', pp_k_closed: 'Closed',
    pp_d_start: 'Brief, who is coming, budget', pp_d_search: 'Listings and conversations', pp_d_viewings: 'Seeing homes in person', pp_d_choice: 'Deciding together what to take',
    pp_d_deal: 'Lease and payments before move-in', pp_d_movein: 'Villa scan, meters, contacts', pp_d_living: 'Payments, repairs, bikes, guests', pp_d_extension: 'New contract, same home',
    pp_d_next: 'Stay, look for a new place or leave', pp_d_relet: 'Finding someone for the rest of the term', pp_d_moveout: 'Inspection, 3D scan, deposit',
    pp_ext_title: 'Extension · until {d}', pp_until: 'until {d}',
    pp_f_contacted: '{n} contacted', pp_f_replied: '{n} replied', pp_f_listings: (n) => `${n} ${pl(n, 'listing', 'listings')}`,
    pp_f_villas: (n) => `${n} ${pl(n, 'villa', 'villas')}`, pp_f_views: (n) => `${n} ${pl(n, 'viewing', 'viewings')}`, pp_f_days: (n) => `in ${n} ${pl(n, 'day', 'days')}`,
    pp_how_majority: 'most said “take”', pp_how_deal: 'deal', pp_how_taken: 'taking it', pp_how_manual: 'chosen by hand', pp_f_takes: (n) => `“Take”: ${n}`,
    pp_f_signed_stamp: 'Lease with the stamp', pp_f_signed: 'Lease signed', pp_f_unsigned: 'Lease not signed yet', pp_f_paid: '{x} paid', pp_f_pending: '{x} more before move-in',
    pp_f_movein: 'Villa scan, meters, {who}’s contacts', pp_f_movein_home: 'Villa scan, meters, house contacts', pp_f_day: 'Day {d} of {n}',
    pp_dep_returned: 'deposit returned', pp_dep_carried: 'deposit carried over', pp_dep_pending: 'old deposit pending', pp_dep_kept: 'deposit kept', pp_f_ext_wait: 'Waiting for the new contract',
    pp_f_votes: 'Voting: {v} of {n}', pp_f_next_stay: 'We stay', pp_f_next_new: 'Looking for a new place', pp_f_next_leave: 'We leave',
    pp_relet_draft: 'Preparing the ad', pp_relet_posted: 'The ad is up', pp_relet_found: 'Found someone', pp_relet_closed: 'Re-let done',
    pp_f_steps: '{d} of {n} steps', pp_f_dep_done: 'deposit back', pp_f_dep_wait: 'waiting for the deposit', pp_f_moveout: 'Inspection with {who}, 3D scan, deposit',
    pp_h_start: 'filling in the brief', pp_h_search: 'collecting listings', pp_h_viewings: 'seeing homes', pp_h_choice: 'deciding', pp_h_deal: 'lease and payments', pp_h_extension: 'extension',
    pp_h_next: 'deciding what next', pp_h_closed: 'project closed', pp_h_manual: 'set by hand',
    pp_in_days: (n) => `in ${n} ${pl(n, 'day', 'days')}`, pp_tomorrow: 'tomorrow', pp_today: 'today',
    pp_h_movein: 'move-in {w}', pp_h_movein_past: 'moved in {d}', pp_h_moveout: 'move-out {w}', pp_h_moveout_past: 'moved out {d}',
    pp_l_start: 'Start · brief', pp_l_search: 'Search · {x}', pp_l_search0: 'Search', pp_l_viewings: 'Viewings', pp_l_viewings_at: 'Viewing {w}', pp_l_choice: 'Choice',
    pp_l_deal: 'Deal', pp_l_deal_d: 'Deal · move-in {d}', pp_l_movein: 'Move-in {w}', pp_l_living: 'Living · until {d}', pp_l_living0: 'Living', pp_l_next: 'What next', pp_l_moveout: 'Move-out {w}',
    pp_l_closed: 'Closed · dossier', pp_l_guest: 'Guest · until {d}',
    pp_change: 'Change the stage', pp_auto: 'Automatic', pp_auto_sub: 'From the data: {k}', pp_set_ok: 'Stage updated', pp_close: 'Close the project', pp_reopen: 'Reopen',
    pp_close_q: 'Close the project?', pp_close_text: 'The project becomes an archive: the dossier, documents and totals stay readable, nothing can be changed. Guests lose access. Members get a message.',
    pp_close_yes: 'Close', pp_closed_t: 'Project closed', pp_closed_s: 'Read-only: the dossier, documents and totals stay', pp_closed_owner: 'You can reopen it in the project path',
    pp_closed_toast: 'The project is closed, nothing can be changed', pp_stage_feed: 'Stage: {k}', pp_stage_feed_m: '{name}: stage “{k}”',
    // wave 6 · C: pastel pass (water cards, amount field)
    pw_pool_own: 'own pool', pw_of_100: 'of 100', pw_surf_until: '{s} until {t}', pw_approx: '≈ {x}', pw_optional: 'optional', pw_amount: 'Amount', pw_category: 'Category',
    pw_per_week: 'Week', pw_per_month: 'Month', pw_per_all: 'All time', pw_spent_in: 'Spent in {m}', pw_spent_week: 'Spent this week', pw_spent_all: 'Spent all time',
    pw_less: '{x} less than {m}', pw_more: '{x} more than {m}', pw_less_week: '{x} less than last week', pw_more_week: '{x} more than last week',
    // wave 6 · B: Useful
    uf_title: 'Useful', uf_kicker: '{r} · checked {d}', uf_f_all: 'All', uf_f_chats: 'Chats', uf_f_apps: 'Apps', uf_f_guides: 'Guides', uf_f_maps: 'Maps',
    uf_g_telegram: 'Telegram', uf_g_apps: 'Apps', uf_g_guides: 'Guides and maps', uf_add: 'Suggest a link', uf_add_btn: 'Send for review', uf_add_btn_owner: 'Add for everyone',
    uf_pending: 'in review', uf_review: 'Waiting for review', uf_mine: 'Your suggestions', uf_approve: 'Add', uf_reject: 'Reject', uf_by: 'suggested by {name}',
    uf_approved: 'Added for everyone', uf_rejected: 'Rejected', uf_sent: 'Sent for review', uf_exists: 'This link is already there', uf_bad_url: 'Use an https:// link or a Telegram @chat',
    uf_rate: 'Too many suggestions, try later', uf_more: '{n} more', uf_none: 'Nothing here yet', uf_source: 'source: {s}',
    uf_name: 'Name', uf_name_ph: 'E.g. Bali flea market', uf_link: 'Link', uf_link_ph: '@chat or https://…', uf_about: 'What for', uf_about_ph: 'what is useful there', uf_cat: 'Section',
    uf_note: 'The search owner or the agent reviews it, then it shows in every search in {r}', uf_note_owner: 'It shows right away in every search in {r}',
    uf_c_chats_rent: 'Rentals', uf_c_flea: 'Flea market', uf_c_bikes: 'Bikes', uf_c_news: 'News and rules', uf_c_visas: 'Visas', uf_c_medicine: 'Medicine', uf_c_food: 'Food',
    uf_c_apps: 'App', uf_c_guides: 'Guide', uf_c_maps: 'Map', uf_c_other: 'Other',
    hello: 'Hi, {name}', searches: 'Your searches', nav_today: 'Today', nav_listings: 'Listings', nav_map: 'Map', nav_plan: 'Plan',
    n_new: (n) => `${n} new`, wait_you: (n) => `${n} waiting for you`,
    viewing_at: 'viewing {when}', no_viewings: 'no viewings yet', found_movein: 'found · move-in {d}', found: 'found', searching: 'searching',
    up_to: 'up to {x}', today: 'today', tomorrow: 'tomorrow', yesterday: 'yesterday', since: 'from {d}',
    new_search: 'New search', new_search_text: 'Your agent creates searches: run /hunt:new in Claude Code and the search shows up here.',
    waiting: 'Waiting for you', whats_new: "What's new", nothing_new: 'Quiet so far. Owner replies, votes and finds will show up here.',
    tile_new: () => 'new\nto decide', tile_drafts: (n) => `${pl(n, 'message', 'messages')}\nto approve`, tile_replies: () => 'owner\nreplies', tile_want: () => 'want\nto view',
    feed_want_view: '{name} wants to see {title}', feed_thinking: '{name} is thinking about {title}', feed_not_interested: '{name} passed on {title}', feed_take: '{name} wants to take {title}',
    feed_comment: '{name}: «{text}»', feed_chat: '{name}: «{text}»', feed_instruction: '{name} → agent: «{text}»',
    feed_draft_approved: 'Message approved', feed_draft_edited: 'Message edited and approved', feed_draft_rejected: 'Message skipped',
    feed_found_one: 'Agent found: {title}', feed_found_n: (n) => `Agent found ${n} new ${pl(n, 'listing', 'listings')}`,
    feed_confirmed: '{title} confirmed {time}', feed_proposed: 'Viewing proposed: {title}, {time}', feed_done: 'Viewed: {title}', feed_cancelled: 'Viewing cancelled: {title}',
    chat: 'chat', agent: 'agent',
    no_viewing: 'No viewings yet', no_viewing_sub: 'Mark listings and the agent will book times', deal: 'Deal', deal_strip_sub: 'payments and move-in checklist',
    offline: (h) => h >= 48 ? `Agent away for ${Math.floor(h / 24)} days` : `Agent away for ${h} ${pl(h, 'hour', 'hours')}`,
    offline_text: "Votes and approvals are saved; it will see them on its next run. Check that the computer with Claude Code is on.",
    f_all: 'All', f_new: 'New', f_replies: 'Replied', f_want_view: 'To view', f_thinking: 'Thinking', f_not_interested: 'No', f_take: 'Taking',
    d_want_view: 'view', d_thinking: 'thinking', d_not_interested: 'no', d_take: 'taking', d_new: 'new',
    deck_cta: (n) => `${n} new to decide`, deck_cta_sub: 'swipe through, one by one', compare: 'Compare',
    per_month: '/mo', per_month_long: 'a month', plus_power: '+ power', plus_utils: '+ utilities',
    br: (n) => `${n} BR`, bedrooms: (n) => `${n} ${pl(n, 'bedroom', 'bedrooms')}`, with_baths: 'en-suite', sqm: '{n} m²',
    deck_title: 'New · {i} of {n}', hints: '← no  ·  ↑ think  ·  view →', deck_done: 'All done', deck_done_text: 'New cards show up when the agent finds more.',
    to_listings: 'To listings', undo: 'Undo', close: 'Close', back: 'Back', stamp_want_view: 'View', stamp_not_interested: 'No', stamp_thinking: 'Think',
    want_view_btn: 'Want to view', take_btn: 'Take it', not_btn: 'Not interested', think_btn: 'Think',
    free: 'free {x}', from_d: 'from {d}', to_d: 'until {d}', photos_n: '{i}/{n}',
    living_room: 'Living room', pool: 'Pool', included: 'Included', electricity: 'Power', bedrooms_lbl: 'Bedrooms', yes: 'Yes', no: 'No',
    messages: 'Messages', all_messages: (n) => `All messages · ${n}`, no_messages: 'The agent has not written to the owner yet.', source: 'Listing', on_map: 'Map',
    approve_title: 'Message {i} of {n}', send_to: 'Send to {name}', send: 'Send', dont_send: "Don't send", edit_text: 'Edit text', goes_now: 'goes now',
    approve_done: 'All messages handled', approve_done_text: 'The agent sends approved ones on its next run.', approved_toast: 'Approved, the agent will send it', skipped_toast: 'Skipped',
    compare_kicker: (n) => `Want to view · ${n}`, best: 'best', votes: 'Votes', term: 'Dates', clarify: 'ask', compare_empty: 'Mark at least two listings “Want to view” to see them side by side.',
    cmp_best: '{a} has the most votes', cmp_cheaper: '{a} is {x} cheaper', cmp_unknown: '{a}: {field} unknown',
    plan: 'Plan', s_confirmed: 'Confirmed', s_proposed: 'Waiting', s_done: 'Viewed', route_day: 'Day route', late: 'Running late', late_title: 'How late are we?',
    late_min: '~{n} min', late_text: 'We are running about {n} min late for the {time} viewing ({title}). Please let the owner know.', late_sent: 'Sent to the agent, it will warn the owner',
    plan_empty: 'No viewings on this day.', no_plan: 'No viewings yet. Mark listings “Want to view” and the agent will book times.',
    map_all: 'All listings', map_day: 'Day', map_day_d: 'Day · {d}', legend_want_view: 'view {n}', legend_thinking: 'thinking {n}', legend_not_interested: 'no {n}', legend_take: 'taking {n}', legend_new: 'new {n}',
    ring: '{n} min {mode}', mode_scooter: 'by scooter', mode_car: 'by car', mode_car_taxi_metro: 'by taxi', mode_walk: 'on foot', mode_any: 'away',
    min_to: '{n} min to {label}', day_n: (n) => `${n} ${pl(n, 'viewing', 'viewings')}`, in_transit: '~{min} min on the road · {km} km · {mode}',
    start: 'start', min: '{n} min', open_gmaps: 'Open route in Google Maps', map_none: 'No coordinates for these listings yet.', map_fail: 'The map did not load. Check the connection.',
    taking: 'Taking it', sublease: 'sublease', lease: 'lease', before_move: 'Before move-in', privacy: 'Passport details and the contract are not stored in Hunt. Only the terms are here.',
    empty_title: 'Searching', empty_text: 'The agent reads {src}. First cards show up here and in the search group, usually within an hour.',
    step_brief: 'Brief and budget', step_collect: 'Collecting listings for 3 days', step_first: 'First messages to owners', invite: 'Invite friends', invite_text: "We're looking for a place together, vote in Hunt",
    src_bali: 'Facebook groups, Telegram chats and portals', src_kz: 'krisha.kz, OLX and rental chats', src_th: 'DDproperty, Facebook and rental chats', src_any: 'portals and rental chats',
    reveal_kicker: "{title} · {owner}'s search", reveal_mine: '{title} · your search', reveal_h1: 'In this search', reveal_h2: "you're a {name}",
    reveal_p: 'This is how friends see you in votes and comments. Everyone in a search has their own animal.', reveal_go: 'See listings', reveal_again: 'Another animal',
    settings: 'Settings', language: 'Language', theme: 'Theme', th_light: 'Light', th_dark: 'Dark', th_auto: 'Auto', th_auto_sub: 'follows Telegram: light by day, dark at night', your_animal: 'Your animal', another: 'Another', all_searches: 'All searches', members: 'Members',
    err_auth: 'Open Hunt from the Telegram bot.', err_member: 'Open the bot and press Start first.', err_generic: 'Something went wrong. Try again.', retry: 'Retry',
    no_searches: 'No searches yet', no_searches_text: 'Ask the search owner to send you an invite.', np_new: 'New project', np_first: 'Let us start your first project', np_first_text: 'A new search or the home you already live in. Invite friends with a link', settings_btn: 'Members and settings',
    brief: 'Brief', change: 'Edit', cancel: 'Cancel', done: 'Done', brief_btn: 'Search brief',
    k_bedrooms: 'bedrooms', k_move_in: 'move-in', k_month: '/mo', studio: 'studio', and: 'and', created_on: 'created {d}',
    sec_housing: 'Place', sec_districts: 'Areas', sec_term: 'Term and payment', sec_important: 'Important', sec_no: 'Definitely not', sec_near: 'Close to',
    more_n: '+{n} more', near_min: 'up to {n} min {mode}', said_title: 'We tell owners ~{x}', said_text: 'Only you see this. The agent negotiates from this number and never says the ceiling.',
    e_bedrooms: 'Bedrooms', e_budget: 'Budget a month, {unit}', e_said: 'We tell owners: {x}', e_said_none: 'We tell owners: not set', e_districts: 'Areas',
    e_note: 'Areas come from the region pack. The agent picks up changes on its next run.', e_move_in: 'Move-in', e_term: 'Term', e_types: 'Place', e_must: 'Important', e_no: 'Definitely not',
    e_must_ph: 'Enclosed living room with AC…', e_no_ph: 'Construction nearby, yearly only…', brief_saved: 'Saved. The agent sees it on its next run', unchanged: 'Nothing changed',
    pt_villa: 'villa', pt_house: 'house', pt_apartment: 'apartment', pt_condo: 'condo', pt_townhouse: 'townhouse', pt_room: 'room',
    pay_monthly: 'monthly', pay_3: '3 months upfront OK', pay_6: '6 months upfront OK', pay_12: 'a year upfront OK',
    pref_lr_req: 'Enclosed living room with AC: required', pref_lr_pref: 'Enclosed living room with AC: preferred', pref_pool_private: 'Private pool',
    pref_pool_shared: 'Pool: shared is fine', pref_construction: 'construction nearby',
    chats: 'Messages', n_convs: (n) => `${n} ${pl(n, 'conversation', 'conversations')}`, f_waiting_us: 'Need a reply', f_waiting_them: 'Waiting for them', f_all_chats: 'All',
    st_waiting_us: 'Needs a reply', st_waiting_them: 'Waiting', st_closed: 'Closed', stl_waiting_us: 'Waiting for our reply', stl_waiting_them: 'Waiting for their reply', stl_closed: 'Conversation closed',
    updated_by_agent: 'updated by the agent {when}', at_time: 'at {t}', known: 'Agreed', open_q: 'Open', last_msg: 'Last', agent_draft: "Agent's draft",
    open_in: 'Open in {ch}', more_contacts: 'Also:', chats_row_sub: (n) => n ? `${n} ${pl(n, 'needs', 'need')} a reply` : 'all answered', no_threads: 'The agent has not talked to anyone in this search yet.',
    role_owner: 'owner', role_agent: 'agent', role_agency: 'agency', role_manager: 'manager', role_relative: "owner's family", role_tenant_subletting: 'subletting tenant',
    feed_brief: 'Brief updated: {what}', feed_check_on: '{name}: “{text}” done', feed_check_off: '{name}: “{text}” not done', feed_thread_sub: 'messages · {state}',
    bk_budget: 'budget', bk_districts: 'areas', bk_bedrooms: 'bedrooms', bk_move_in: 'move-in', bk_term: 'term', bk_property_type: 'place', bk_must_have: 'must-haves', bk_deal_breakers: 'deal breakers', bk_payment_terms: 'payment', bk_nice_to_have: 'nice to have',
    interest: 'interest {x} of {max}', x_of: '{x} of {max}', rate_q: 'How was it? The whole group sees ratings', viewed_at: 'viewed {when}', at_word: '{d} at {t}',
    crit_overall: 'Overall impression', crit_area: 'Area and road', crit_inside: 'The house inside', crit_quiet: 'Quiet and neighbours',
    cb_overall: 'Overall', cb_area: 'Area and road', cb_inside: 'Inside', cb_quiet: 'Quiet',
    note_ph: 'What stood out? Noise, light, the owner…', save_rating: 'Save rating', rating_saved: 'Saved, the group sees your rating', rate_all: 'Set all four ratings',
    voice_note: 'voice note', recording: 'Recording {s} · tap to stop', mic: 'Record a voice note', voice_fail: 'Could not record the voice note', voice_up: 'Uploading the recording…', remove: 'Remove',
    score_title: 'Rating after viewing', of5: 'of 5', notes_title: 'Notes from the viewing', interest_before: 'Interest before viewing: {x} of {max}', interest_now: 'Interest: {x} of {max}',
    rate_btn: 'Rate it', rate_edit: 'Edit my rating', both_dec: 'both “{d}”', all_dec: 'all “{d}”', one_dec: '{name} “{d}”', play: 'Play',
    cmp_kicker_viewed: 'Viewed {n}', sort_score: 'by score', sort_price: 'by price', sort_interest: 'by interest', sort_by: 'Sort',
    row_score: 'Score', row_quiet: 'Quiet', row_inside: 'House', row_interest: 'Interest',
    cmp_best_score: '{a}: best score', cmp_unanimous: ' and everyone wants it', cmp_cheaper_than: ', {x} cheaper than {b}', cmp_pricier_than: ', but {x} pricier than {b}',
    cmp_weak: '{b}: weak spot is {crit} ({v})', cmp_best_interest: '{a} has the highest interest', cmp_cheapest: '{a} is the cheapest',
    feed_rating: '{name} rated {title}: {score}',
    seg_liked: 'Liked', seg_new: 'New', seg_all: 'All', seg_passed: 'Passed', replied_24h: 'Replied today',
    liked_empty: 'Places the group wants to view or rated 3.5+ show up here.', passed_empty: 'Nothing passed yet.', new_empty: 'Nothing new, all sorted.',
    my_searches: 'Your searches', role_mine: 'mine', role_invited: 'invited', invited_by: 'invited by {name}', about_search: 'About this search',
    // wave 2
    ck_caution: (n) => `Careful: ${n} warning ${pl(n, 'sign', 'signs')}`, ck_danger: (n) => `Looks like a scam: ${n} ${pl(n, 'sign', 'signs')}`, ck_ok: 'Check passed',
    ck_caution_sub: "Don't pay anything before the viewing and the owner check", ck_danger_sub: 'No money transfers. The agent will not book a viewing without documents', ck_ok_sub: 'No obvious scam signs',
    ck_ask: 'Ask the owner for documents', ck_foot: 'The agent checks duplicates across agents, reverse image search, price against the district, prepayment and documents. The rules come from the region pack.',
    ck_ask_text: 'Ask the owner for {docs} before the viewing and match the owner name.', ck_ask_default: 'the property documents and an ID', ck_asked: 'Sent to the agent, it will ask for the documents',
    ck_line: 'Check: {x}', ck_checked: 'checked {when}',
    money: 'Money', money_today: 'Balance today', owes_you: '{name} owes you', you_owe: 'You owe {name}', owes: '{a} owes {b}', all_square: 'All square', settle: 'Mark as settled',
    settled_toast: 'Marked, the balance is zero', m_total: 'total', m_each: 'each', m_mine: 'your share', m_power: 'power/mo', m_count: (n) => pl(n, 'expense', 'expenses'), expenses: 'Expenses',
    no_expenses: 'No expenses yet. Tap “+” to add the first one: rent, deposit, power tokens.', live_n: (n) => (n <= 1 ? 'living here' : n === 2 ? 'the two of us' : `${n} of us`),
    members_n: (n) => `${n} ${pl(n, 'member', 'members')}`,
    split_half: 'split in half', split_equal: 'split equally', split_shares: 'by shares', split_self: 'own cost', split_custom: 'some of us', receipt: 'receipt',
    pm_cash: 'cash', pm_transfer: 'transfer', pm_card: 'card',
    xk_rent: 'Rent', xk_deposit: 'Deposit', xk_power: 'Power', xk_water: 'Water', xk_internet: 'Internet', xk_cleaning: 'Cleaning', xk_pool: 'Pool', xk_repair: 'Repair', xk_food: 'Food', xk_transport: 'Transport', xk_other: 'Other',
    x_add: 'New expense', x_title: 'What was paid', x_title_ph: 'Power tokens', x_amount: 'Amount, {cur}', x_paid_by: 'Who paid', x_split: 'Split between', x_kind: 'Type', x_method: 'How it was paid', x_date: 'Date',
    x_note: 'Note', x_receipt: 'Receipt photo', x_receipt_add: 'Add a receipt photo', x_save: 'Save', x_saved: 'Expense added', x_need: 'Add a title and an amount', x_everyone: 'everyone', x_delete: 'Delete expense', x_deleted: 'Deleted',
    x_paid: '{name} paid', shares: 'How we split', shares_text: 'Member shares: every shared expense is split by them. For example, whoever has the big bedroom pays more.', shares_saved: 'Shares saved',
    os_title: 'On site', os_of: '{x} of {n}', os_photos: 'Photos · {n}', os_photo: 'Photos', os_rate: 'Rate it', os_note: 'Note', os_note_ph: 'Short: what is wrong, or numbers', os_none: 'The region pack has no checklist yet.', os_uploaded: 'Photo added', os_btn: 'On-site checklist',
    home_living: 'Living here · day {d} of {n}', home_living_short: 'Living here', issues: 'Problems', report: 'Report', contacts: 'Contacts', no_issues: 'Nothing broken', no_hcontacts: 'The agent will add the owner, cleaning and pool contacts.',
    is_open: 'Open', is_scheduled: 'Repair {when}', is_scheduled_plain: 'Scheduled', is_fixed: 'Fixed', is_report_title: 'What broke?', is_report_ph: 'The AC in bedroom 2 hums', is_note_ph: 'Details, if any', is_sent: 'Sent to the agent, it will tell the owner',
    hc_owner: 'owner', hc_manager: 'manager', hc_cleaning: 'cleaning', hc_pool: 'pool', hc_garden: 'garden', hc_repair: 'repairs', hc_security: 'security', hc_internet: 'internet', hc_other: 'contact',
    per_month_s: '/mo', per_week_s: '/wk', per_visit_s: '/visit', payer_rent: 'in the rent', payer_us: 'we pay', home_in: 'Our home',
    docs: 'Documents', docs_kicker: 'Deal · documents', doc_kicker: '{home} · document', add: 'Add', dates_title: 'Dates from the lease', docs_foot: 'Originals stay in Telegram; the CRM keeps only the summary',
    dk_lease: 'Lease', dk_receipt: 'Receipt', dk_owner_consent: "Owner's consent", dk_movein_video: 'Move-in video', dk_other: 'Document',
    ds_have: 'Have it', ds_request: 'Request', ds_due: 'By {d}', version_n: 'version {n}', signed_on: 'signed {d}', signed_cap: 'Signed {d}', pages_n: '{n} pages', version_from: 'Version {n} of {d}',
    f_pdf: 'PDF', f_photo: 'photo', f_video: 'video', f_file: 'file', open_pdf: 'Open PDF', open_photo: 'Open photo', open_video: 'Open video', open_file: 'Open file', to_tg: 'To Telegram', sent_tg: 'Sent to your chat with the bot',
    main_points: 'Key points', changes_from: 'What changed since version {n}', changes: 'What changed', no_summary: 'The agent has not summarized this document yet.', no_file: 'No file yet',
    add_doc_title: 'Add a document', add_doc_bot: 'Send the file to the bot in a private chat: it attaches it to the deal and the agent reads it.', open_bot: 'Open the bot chat', add_doc_req: 'Or ask the agent to request it from the owner:', doc_requested: 'The agent will request it',
    req_this: 'Ask the agent to request it', cad_payment: 'A week before, 2 days before and that morning', cad_notice: '2 weeks and 3 days before', cad_deposit_return: "If it doesn't come back, I remind you and write to them", until_d: 'by {d}', mark_returned: 'Returned', returned: 'returned',
    deal_links_docs: 'Documents and dates', deal_links_money: 'Money', money_row_sub: (n) => n ? `${n} ${pl(n, 'expense', 'expenses')}` : 'shared expenses and who owes whom',
    notifications: 'Notifications', n_bot: 'Messages from the bot', n_bot_sub: 'owner replies, viewings, payments', n_digest: 'Morning digest at 8:00', n_digest_sub: 'what came in overnight and what is on today',
    feed_expense: '{name}: expense “{title}”, {x}', feed_settled: '{name}: settled up, {x}', feed_issue_open: 'Problem: {title}', feed_issue_scheduled: 'Repair booked: {title}', feed_issue_fixed: 'Fixed: {title}',
    feed_document: 'Document: {title}', feed_document_request: 'Document needed: {title}', feed_checks: 'Check of “{title}”: {x}', v_ok: 'all clear', v_caution: 'careful', v_danger: 'looks like a scam',
    // wave 3
    w3_important: 'Important', w3_power: 'Power', w3_directory: 'Contacts nearby', w3_split: 'Who pays what', w3_moveout: 'Move-out', w3_relet: 'Re-letting the rest',
    w3_important_sub: 'visa, hospitals, emergency numbers', w3_power_sub_none: 'snap the meter, I will count how long it lasts', w3_power_sub: (n) => `~${n} ${pl(n, 'day', 'days')} left`,
    w3_dir_sub: (n) => n ? `${n} ${pl(n, 'contact', 'contacts')}` : 'bikes, water, laundry, markets', w3_split_sub: 'rent by rooms', w3_split_sub_none: 'split the rent by rooms',
    mo_title_villa: 'Handing back the villa', mo_title: 'Moving out', mo_date: 'Move-out {d}', mo_date_none: 'No move-out date yet',
    mo_notice: 'Owner notified', mo_notice_todo: 'Notify the owner', mo_keys: 'Keys and remote', mo_video: 'Move-out video and meters', mo_cleaning: 'Cleaning before leaving', mo_deposit: 'Deposit',
    mo_notice_sub: 'Reason and move-out date', mo_keys_sub: 'Handover time to agree with the owner', mo_video_sub: 'Every room, date in the frame', mo_cleaning_sub: 'Things, rubbish, the fridge', mo_deposit_sub: 'Back by {d}',
    mo_in: '{d} on {ch}', mo_draft: 'Draft a reply', mo_draft_to: 'Draft a reply to {to}', mo_draft_text: 'Draft a reply to {who} about the move-out, using the talking points in the card', mo_draft_sent: 'The agent will draft it and send it for approval',
    mo_relet: 'Re-let the rest', mo_mark_done: 'Mark as done', mo_mark_todo: 'Back to to-do', mo_video_bot: 'Send the video to the bot in a private chat: it attaches to the move-out and the agent checks it.', mo_saved: 'Marked, the agent will see it',
    pn_searches: (n) => pl(n, 'search', 'searches'), pn_notes: (n) => pl(n, 'note', 'notes'), pn_reply: 'replies', pn_notes_title: 'Notes', pn_none: 'No notes yet. Add what stood out: good, bad, prices.',
    pn_foot: 'Everyone on this Hunt sees notes. The agent warns you if this person shows up in a new search.', pn_add: 'New note', pn_ph: 'Replies fast, pays for repairs…', pn_good: 'Good', pn_bad: 'Bad', pn_saved: 'Note saved', pn_min: '~{n} min', pn_h: '~{n} h', pn_d: '~{n} d', pn_person: 'Person card',
    sp_split_title: 'Who pays what', sp_rooms: 'Rooms', sp_rent: 'Rent a month', sp_shared: 'Shared', sp_you: 'You', sp_others_two: 'Power, cleaning and pool: half each', sp_others_n: 'Power, cleaning and pool: equally',
    sp_others_sub: 'Turn off to split the rest by shares', sp_empty: 'Split the rent by rooms: whoever has the master with a bathroom pays more.', sp_start: 'Split by rooms', sp_room: 'Room', sp_room_ph: 'Master, en-suite', sp_who: 'Who lives here',
    sp_share: 'Share of the rent', sp_split_saved: 'Saved, the rent is split by rooms', sp_delete: 'Remove the room', sp_bedroom: 'Bedroom {n}', sp_shares_link: 'Shares for other expenses', sp_no_rent: 'rent not set',
    mm_shared: 'Shared budget', mm_settings: 'How we handle money', mm_split_t: 'Split and track debts', mm_split_s: 'Who paid what, who owes whom, “settled up”', mm_shared_t: 'One common wallet', mm_shared_s: 'Only what we spent: by month and category',
    mm_this_month: 'This month', mm_all: 'all time', mm_avg: 'avg a month', mm_by_kind: 'By category', mm_by_month: 'By month', mm_saved: 'Saved',
    pw_left: 'About this much left', pw_days: (n) => `${n} ${pl(n, 'day', 'days')}`, pw_topup_by: 'Top up by {d}.', pw_daily: 'You use ~{n} kWh a day', pw_weeks: 'Use by week, kWh',
    pw_month: '~{x} a month', pw_month_money: 'from expenses in Money', pw_month_tariff: 'at ~{x} per kWh', pw_photo_at: 'Meter photo {d}', pw_photo_wait: 'The agent will read the balance from the photo', pw_photo_read: 'Balance read from the photo',
    pw_where: 'Where to buy tokens', pw_where_post: 'How to pay for power', pw_shoot: 'Snap the meter', pw_sent: 'The agent has the photo and will read the balance', pw_none: 'Snap the meter: the agent reads the balance and works out how long it lasts.', pw_none_t: 'How much power is left?',
    pw_split_half: 'split in half', pw_split_eq: 'split equally', pw_split_shared: 'from the common wallet', pw_in_money: 'already in Money',
    vi_title_bad: 'Your visa ends before the lease', vi_title_ok: 'Visa is fine', vi_title_none: 'When does your visa end?', vi_none: 'Add the date and I will remind you to extend in time. A date only, no numbers.',
    vi_mine: 'Your visa runs to {v}, the lease to {l}.', vi_mine_nolease: 'Your visa runs to {v}.', vi_extend: 'Apply for the extension by {d}; I will remind you {w} before.', vi_other_ok: '{name}: visa to {v}, all good.', vi_other_bad: '{name}: visa to {v}, before the lease.',
    vi_week: 'a week', vi_weeks: (n) => `${n} ${pl(n, 'week', 'weeks')}`, vi_days: (n) => `${n} ${pl(n, 'day', 'days')}`, vi_sheet: 'My visa ends', vi_sheet_text: 'A date only: you and the search owner see it. No passport or visa numbers.', vi_clear: 'Remove the date', vi_saved: 'Saved',
    em_title: 'If something happens', em_hospital: 'Hospital', em_clinic: 'Clinic', em_pharmacy: 'Pharmacy', em_247: '24/7', em_min: '{n} min', em_ambulance: 'Ambulance {a} · police {p}', em_tourist: 'Tourist police: {x}',
    em_power_tokens: 'or the tokens ran out', em_broken: 'Something broke', em_foot: 'Numbers and rules come from the region pack, addresses are near your home.', em_none: 'The region pack has no emergency numbers yet.',
    pl_title: 'Your places', pl_none: 'Add places you go every day: surf, coworking, gym, school. The agent works out the time from each listing.', pl_by: 'by scooter', pl_car: 'by car', pl_taxi: 'by taxi', pl_walk: 'on foot',
    pl_limit: 'limit {n}', pl_cmp: 'Against the shortlist', pl_closest: 'Closest of all: {a}.', pl_farther: '{a} is farther than from {list}.', pl_same: 'About the same as the rest of the shortlist.', pl_foot: 'Times: OSM routes at rush hour. Places are set in the brief.',
    pl_est: '~ is a straight line until the agent routes it.', pl_add: 'New place', pl_name: 'Name', pl_name_ph: 'Surf: Melasti', pl_type: 'What is it', pl_where: 'Google Maps link or coordinates', pl_where_ph: 'https://maps.app.goo.gl/… or -8.84, 115.17',
    pl_max: 'At most, min', pl_mode: 'How we go', pl_saved: 'Place added, the agent will work out the times', pl_removed: 'Place removed', pl_remove: 'Remove the place', pl_row: (n, v) => `${n} of ${v.m} within the limit`, pl_open_map: 'Open on the map', pl_bad_point: 'Needs a link with coordinates or “lat, lng”',
    at_surf: 'surf', at_beach: 'beach', at_cowork: 'coworking', at_gym: 'gym', at_yoga: 'yoga', at_shop: 'shop', at_school: 'school', at_airport: 'airport', at_work: 'work', at_friends: 'friends', at_cafe: 'cafe', at_other: 'other',
    ds_map: '{r} areas', ds_map_plain: 'Areas', ds_hint: 'tap an area', ds_fit: '{n}% for the brief', ds_fit_short: 'for the brief', ds_here: 'Listings here', ds_to_brief: 'To the brief', ds_in_brief: 'In the brief', ds_listings: (n) => `${pl(n, 'listing', 'listings')}`,
    ds_br: '{n} BR', ds_airport: 'to the airport', ds_ocean: 'to the ocean', ds_h: '{n} h', ds_scores: 'Scores', ds_pros: 'Pros', ds_cons: 'Cons', ds_foot_crm: 'Prices: {n} listings from your searches. Scores: the region pack.',
    ds_foot_pack: 'Prices: the region pack until there are more listings. Scores: the region pack.', ds_added: 'Area added to the brief', ds_asked: 'Asked the agent to add the area to the brief', ds_filter: 'Area: {a}', ds_mode: 'Areas',
    sc_surf: 'Surf', sc_quiet: 'Quiet', sc_no_traffic: 'No traffic', sc_food: 'Cafes and food', sc_coworking: 'Coworkings', sc_nightlife: 'Nightlife',
    rl_kicker: 're-letting the rest', rl_title: 'Finding someone to take over', rl_months: (n) => `${n} ${pl(n, 'month', 'months')}`, rl_ad: 'The ad', rl_leads: 'Replies · {n}', rl_no_leads: 'No replies yet',
    rl_c_yes: 'The owner agrees', rl_c_asked: 'Asked the owner, waiting', rl_c_no: 'The owner says no', rl_c_unknown: 'The owner has not been asked', rl_none: 'The agent has not drafted a re-let ad yet.', rl_ask: 'Ask the agent',
    rl_ask_text: 'Draft an ad to re-let the rest of our lease: ask the owner for consent, send the text and photos for approval', rl_asked: 'The agent will draft the ad and send it for approval',
    rl_friends: 'Friends only. Posts like "looking for a roommate" or "re-letting our villa" are watched here and bring the owner, the banjar or immigration', ch_friends: 'friends',
    rl_plain_ok: 'The owner agrees: you can post it in the chats, but as a normal villa for rent, without the words re-let, sublet or takeover. A roommate or a room only among people you know',
    rl_plain_wait: 'Until the owner agrees, friends only. After a yes it can go to the chats as a normal villa for rent, never as a re-let',
    rl_ask_text_plain: 'Prepare handing over the villa for the rest of the lease: ask the owner first; after a yes, an ad worded as a normal villa for rent (no re-let / sublet words), text and photos for approval', rl_asked_plain: 'The agent will ask the owner and prepare the ad',
    rl_ask_text_friends: 'Draft a re-let message for us to send to people we know (no posts in chats or groups); ask the owner for consent first', rl_asked_friends: 'The agent will ask the owner and send a text for your friends',
    ls_new: 'New', ls_reply: 'Reply', ls_viewing: 'Viewing', ls_agreed: 'Agreed', ls_not_suitable: 'Not a fit',
    ch_telegram: (n) => `${n} Telegram ${pl(n, 'chat', 'chats')}`, ch_facebook: (n) => `${n} FB ${pl(n, 'group', 'groups')}`, ch_marketplace: 'Marketplace', ch_whatsapp: (n) => `${n} WhatsApp`, ch_portal: 'portal',
    dr_title: 'Contacts', dr_kicker: 'near home', dr_all: 'All', dg_home: 'Home', dg_bikes: 'Bikes', dg_food: 'Food', dg_services: 'Services', dg_health: 'Health', dgl_food: 'Food and markets', dgl_health: 'Health and pharmacies',
    dr_none: 'Nothing yet. Add bikes, water, laundry, a market, or ask the agent to find them.', dr_add: 'New contact', dr_group: 'Group', dr_name_ph: 'Aqua water 19 L', dr_sub: 'Price, hours, what matters', dr_sub_ph: 'Gallon delivery · 25k',
    dr_channel: 'How to reach', dr_addr_wa: 'WhatsApp number', dr_addr_tg: 'Telegram @username', dr_addr_phone: 'Phone', dr_addr_map: 'Map link', dr_saved: 'Contact added', dr_new_group: 'New group', dr_group_ph: 'Kids', dr_group_saved: 'Group added',
    dr_write: 'Write', dr_call: 'Call', dr_map: 'Map', dr_agent: 'Ask the agent to write', dr_agent_ph: 'Order 2 water gallons for tomorrow morning', dr_agent_sent: 'The agent will write and send the message for approval', dr_delete: 'Delete contact', dr_deleted: 'Deleted', ch_map: 'Map',

    // wave 4
    ds_rooms: '{n}-room', ds_flood: 'Water after rain: {x}',
    fl_low: 'low risk', fl_medium: 'medium risk', fl_high: 'high risk', fl_l_low: 'low', fl_l_medium: 'medium', fl_l_high: 'high', fl_title: 'Water after rain: {x}',
    fl_sources: 'How we know', fl_terrain: 'Terrain', fl_chats: 'Rental chats', fl_notes: 'Your notes', fl_area: 'Area', fl_none: 'The agent has not checked the terrain and the chats for this house yet.',
    fl_area_line: '{a}: {x}. {n}', fl_add: 'Add a note', fl_note_t: 'What about water at this house?', fl_note_ph: 'After a downpour the lane is ankle-deep', fl_saved: 'Note saved, the agent will take it into account',
    lc_badge: 'Location {n}', lc_word: 'location', lc_min: '{n} min', lc_points: (n) => `${n} ${pl(n, 'point', 'points')}`, lc_how: 'How {n} is counted', lc_none: 'The agent has not computed the {r}-minute rings for this house yet.',
    lc_ask: 'Ask the agent to compute', lc_asked: 'The agent will compute the rings and the score', lc_ask_text: 'Compute the {r}-minute rings and the location score (location_refresh)', lc_more: '+{n}',
    lc_title: 'Location {n}', lc_by_type: 'By place type · weighted by your brief', lc_how_t: 'How we count',
    lc_how_text: 'Each place = its level (★ top 1, good 0.6, ordinary 0.3) × its ring ({rings}) × the type weight; your own Google Maps places weigh 1.5×. Per type we add up with saturation: the tenth coffee shop adds almost nothing. Types are weighted by the brief. No shop within {r} minutes is a minus.',
    lc_quiet_ok: 'No clubs or construction nearby: noise does not lower the score', lc_no_shop: 'No supermarket within {r} minutes: −10', lc_club_near: 'A noisy place nearby, “{p}”: −8', lc_construction_near: 'Construction nearby, “{p}”: −8', lc_shop_ok: 'A supermarket within {r} minutes',
    lc_row: 'Location', lc_row_sub: '{r} min: {x}',
    lg_anchors: 'Your places', lg_surf: 'Surf and beaches', lg_shops: 'Shops', lg_cafes: 'Cafes', lg_work: 'Work', lg_sport: 'Sport', lg_medical: 'Medical', lg_nightlife: 'Nightlife',
    pt_beach: 'Beach', pt_surf: 'Surf', pt_coworking: 'Coworking', pt_gym: 'Gym', pt_yoga: 'Yoga', pt_supermarket: 'Supermarket', pt_market: 'Market', pt_hospital: 'Hospital', pt_pharmacy: 'Pharmacy',
    pt_coffee: 'Coffee', pt_food: 'Food', pt_daytrip: 'Day trip', pt_nightlife: 'Bars and clubs', pt_construction: 'Construction', pt_other: 'Other',
    sp_all: 'All', sp_title: 'Places', sp_n: (n) => `${n} ${pl(n, 'place', 'places')}`, sp_trip: 'Out of town', sp_add: 'Add from Google Maps: paste a link to a place or a list',
    sp_none: 'No places in this area yet.', sp_link_t: 'Places from Google Maps', sp_link_text: 'Paste a link to a place or a list (Share → Copy link). The agent picks up the places, their type and area.',
    sp_link_ph: 'https://maps.app.goo.gl/…', sp_link_sent: 'The agent will pick up the places', sp_bad_link: 'Needs a Google Maps link', sp_areas: 'Area', sp_own: 'from your maps', sp_pack: 'from the region pack',
    sp_tier: 'Level', sp_type: 'Type', sp_hide: 'Hide the place', sp_saved: 'Saved', sp_layer: 'Places', sp_list: 'List',
    bk_title: 'Bikes', bk_n: (n) => `${n} ${pl(n, 'bike', 'bikes')}`, bk_per: '{x}/mo', bk_price: 'price', bk_paid: 'paid', bk_until: 'to {d}', bk_in: (n) => `In ${n} ${pl(n, 'day', 'days')}`, bk_today: 'Today', bk_late: 'Overdue', bk_ok: 'OK',
    bk_returned: 'Returned', bk_pickup: 'When you pick up a bike', bk_video: 'Video of every scratch, with the date', bk_helmets: 'Helmets', bk_stnk: 'Registration (STNK) in the box', bk_fuel: 'How much fuel',
    bk_foot: 'Never leave the original passport, only a copy. I remind you 2 days before the payment and on the day.', bk_passport: 'The original passport as a deposit? Take it back and leave a copy or cash.',
    bk_none: 'Add a bike: model, plate, price and paid-until date. I remind you about payments and the return.', bk_add: 'New bike', bk_model: 'Model', bk_model_ph: 'Honda Scoopy 110', bk_plate: 'Plate', bk_plate_ph: 'DK 1234 AB',
    bk_rider: 'Who rides it', bk_shared: 'Shared', bk_price_l: 'Price', bk_period_month: 'a month', bk_period_week: 'a week', bk_period_day: 'a day', bk_paid_l: 'Paid until', bk_deposit: 'Deposit left', bk_deposit_ph: 'Passport copy, 1M',
    bk_rental: 'Rental', bk_rental_ph: 'Ungasan Bike Rental', bk_wa: 'Rental WhatsApp', bk_saved: 'Bike saved', bk_pay: 'Paid', bk_pay_t: 'Bike payment', bk_pay_until: 'Now paid until', bk_pay_sum: 'Amount', bk_paid_ok: 'Added to expenses',
    bk_return: 'Bike returned', bk_return_date: 'Return by', bk_edit: 'Edit', bk_wa_btn: 'WA', bk_scan: 'Bike 3D scan',
    ac_title: '3D act', ac_kicker: '{home} · move-in {d}', ac_spin: '3D · drag to turn', ac_rooms: 'Rooms · {x} of {n}', ac_send: 'Send to the owners', ac_sent: 'The agent will draft a message to the owners for approval',
    ac_foot: 'At move-out on {d} you scan again: I show both scans side by side.', ac_foot_nodate: 'At move-out you scan again: I show both scans side by side.', ac_scan: 'Scan {d}', ac_none_t: 'Scan the house with your phone',
    ac_none: 'In Scaniverse or Polycam (LiDAR) walk through the rooms, export GLB and send the file to the bot in a private chat. The caption is the room name.', ac_open_bot: 'Open the bot chat',
    ac_redo: 'rescan', ac_todo: 'not scanned yet', ac_in: 'Move-in', ac_out: 'Move-out', ac_loading: 'Loading 3D…', ac_fail: 'Could not open the scan',
    do_title: 'House dossier', do_months: 'we lived', do_issues: (n) => pl(n, 'problem', 'problems'), do_price_all: 'all included', do_price: 'a month', do_what: 'What happened', do_verdict: 'Verdict: {x}',
    do_foot: 'Everyone on this Hunt sees dossiers. If the villa shows up in a new search, the agent shows it.', do_none: 'No dossier yet: the agent writes the house history at move-out.', do_banner: 'There is a dossier: you or friends lived here', do_mo: (n) => `${n} mo`,
    it_title: 'Things · {x}', it_title0: 'Things', it_kicker: 'Bought from {s} · {n}', it_kicker0: (n) => `${n} ${pl(n, 'thing', 'things')}`, it_ours: 'Ours', it_add: 'Thing', it_at: 'from {s} {d}', it_sold: 'sold', it_offered: 'offered',
    it_resale_t: 'We resell at move-out', it_resale: '2 weeks before {d} the agent offers the things to the next tenants and in the chats. Target: get back about {x}.', it_resale_nodate: 'Before move-out the agent offers the things to the next tenants and in the chats. Target: get back about {x}.',
    it_none: 'Note what you buy for the house: at move-out the agent resells it.', it_new: 'New thing', it_name_ph: 'Blender', it_price: 'Price', it_seller: 'Bought from', it_seller_ph: 'Natalia', it_date: 'When',
    it_photo: 'Photo', it_saved: 'Saved', it_mark_sold: 'Sold', it_sold_price: 'Sold for', it_delete: 'Delete', it_unsold: 'Not sold yet',
    cl_title: 'Calendar', cl_kicker_home: '{r} · while you live in {a}', cl_movein: 'Move-in', cl_movein_sub: 'Scan the villa, meters, {o}’s contacts', cl_movein_sub0: 'Scan the villa, meters, contacts', cl_moveout: 'Move-out and deposit back', cl_moveout_sub: 'Walk-through with {o}, second 3D scan', cl_moveout_sub0: 'Walk-through, second 3D scan',
    cl_pay_bike: 'Bike payment: {m}', cl_visa: 'Apply for the visa extension', cl_visa_sub: 'visa to {d}', cl_by: 'by {d}', cl_none: 'Lease dates, payments and local holidays show up here.', cl_viewings: 'Viewings', cl_open: 'Calendar', cl_now_season: 'Now: {x}',
    w4_bikes: 'Bikes', w4_bikes_sub0: 'rental, payments, checklist', w4_act: '3D act', w4_act_sub: '{x} of {n} rooms', w4_act_sub0: 'scan the house with your phone', w4_items: 'Things', w4_items_sub0: 'what we bought for the house', w4_dossier: 'House dossier', w4_dossier_sub: 'history and the verdict at move-out',
    // wave 5
    sf_title: 'Surf', sf_best: 'Best today', sf_near: 'Spots nearby', sf_m: '{x} m', sf_s: '{n} s', sf_period: 'period {n} s',
    sf_off_until: 'offshore until {h}', sf_off_from: 'offshore from {h}', sf_later_onshore: ', then blown out', sf_later_cross: ', then cross-shore', sf_onshore: 'onshore wind',
    sf_reef: 'reef', sf_beach: 'beach break', sf_lv_beginner: 'for beginners', sf_lv_intermediate: 'intermediate', sf_lv_advanced: 'for experienced surfers',
    sf_flat_t: 'Flat today', sf_flat: 'No proper waves at the spots nearby.', sf_err_short: 'The wave forecast is not available right now.',
    sf_note_on: 'A line with the best spot comes in the bot’s morning digest', sf_note_off: 'Surf is off in the morning digest: tap to turn it on',
    sf_on: 'Surf will be in the morning digest', sf_off: 'Surf removed from the morning digest',
    sf_none: 'No surf spots within 30 minutes of home.', sf_no_home: 'I do not know where to count from: needs a home, an anchor or districts in the brief.', sf_err: 'The wave forecast is not available right now. Try again later.',
    sf_pref: 'Surf in the morning digest', sf_pref_sub: 'the best spot and window for the day', sf_pref_auto: 'best spot and window · now set by the brief',
    sf_row: 'Surf', sf_row_sub: 'waves at the spots nearby', sf_row_today: 'Surf today', sf_line: 'Today {s} {h}, best before {t}', sf_line0: 'Today {s} {h}',
    gd_title: 'Guest guide', gd_kicker: 'Guest guide · from {h}', gd_map: 'Map', gd_wifi: 'Wi-Fi: {x}', gd_pass: 'password: {x}', gd_show: 'Show', gd_hide: 'Hide', gd_copy: 'Copy', gd_copied: 'Copied',
    gd_rules: 'House rules', gd_emergency: 'If something happens', gd_host: 'the guide’s host, write if anything', gd_write: 'Write', gd_empty: 'The hosts have not filled in the guide yet.',
    gd_empty_member: 'The guide is empty. Add the address, Wi-Fi and rules: guests see only this, no money or chats.', gd_view: 'Guide', gd_edit: 'Edit',
    gd_address: 'Address and how to find it', gd_address_ph: 'Jl. Toya Ning 1, Gang Bambu · the bamboo gate', gd_map_url: 'Map link', gd_wifi_name: 'Wi-Fi network', gd_wifi_pass: 'Wi-Fi password',
    gd_rule_ph: 'No smoking inside, outside is fine', gd_rule_add: 'Add a rule', gd_rule_icon: 'Rule icon', gd_rule_del: 'Delete the rule', gd_note: 'A note for guests', gd_note_ph: 'The key is in the safe by the door, we send the code on arrival day',
    gd_save: 'Save the guide', gd_saved: 'Guide saved', gd_sensitive: 'Remove document and card numbers: guests see the guide',
    gd_link: 'Link for guests', gd_link_none: 'No link yet: it appears when you first share. It opens the guide without signing in.', gd_link_on: 'The link opens the guide without signing in. Money and chats stay hidden.',
    gd_share: 'Share in Telegram', gd_copy_link: 'Copy the link', gd_regen: 'New link', gd_regen_q: 'Make a new link? The old one stops working.', gd_regen_ok: 'New link ready, the old one no longer works',
    gd_revoke: 'Close access', gd_revoke_q: 'Close access to the guide by link?', gd_revoked: 'Link access closed', gd_share_text: 'A guide to our home: address, Wi-Fi and rules',
    gd_row_sub: 'address, Wi-Fi, rules', gd_row_ready: 'the guest link is ready',
    gd_ic_smoke: 'smoking', gd_ic_water: 'water', gd_ic_zap: 'power', gd_ic_trash: 'trash', gd_ic_moon: 'quiet hours', gd_ic_key: 'keys', gd_ic_car: 'parking', gd_ic_dog: 'pets', gd_ic_pool: 'pool', gd_ic_shoe: 'shoes', gd_ic_info: 'other',
    nx_title: 'What next?', nx_lease_to: 'lease to {d}', nx_weeks: (n) => `${n} ${pl(n, 'week', 'weeks')} left on the lease`, nx_soon: 'The lease ends this week',
    nx_by: 'Decide by {d} to have time.', nx_late: 'Decide as soon as you can.', nx_owner: 'the owner',
    nx_stay: 'We stay', nx_stay_sub: 'The agent asks {o} about the price and terms of a new lease', nx_new: 'Find a new place', nx_new_sub: 'I start a search with the old brief, using the dossier and notes',
    nx_leave: 'We leave', nx_leave_sub: 'Move-out, 3D scan, deposit, selling things',
    nx_foot: 'All members vote, the majority decides, just like with villas.', nx_voted: (n, v) => `${n} of ${v.m} voted.`,
    nx_decided: 'Decided', nx_by_owner: 'The votes split, so the owner’s vote decided.', nx_do_stay: 'The agent asks {o} about the price and terms of a new lease and sends the message for approval.',
    nx_do_new: 'A new search with the old brief is ready: the same members, places and notes.', nx_do_new_wait: 'The agent creates a new search with the old brief.', nx_do_leave: 'Getting ready to move out: notice to the owner, 3D scan, deposit and selling things.',
    nx_open_new: 'Open the new search', nx_to_moveout: 'To move-out', nx_none: 'The lease end is far away. 6 weeks before it the agent asks what next.', nx_card: 'What next?',
    ng_row: 'What to offer the owner', ng_row_sub: 'price, arguments, house history', ng_asked: 'asking {x}', ng_offer: 'What to offer',
    ng_upfront: (n) => `${n} ${pl(n, 'month', 'months')} upfront`, ng_args: 'Arguments: {x}.', ng_capped: 'Not above the budget you named.',
    ng_a_median: 'area median {x}', ng_a_noinc: '{x} not included', ng_a_noinc_f: '{x} not included', ng_a_noinc_n: '{x} not included', ng_a_empty: 'empty since {d}', ng_a_empty_m: 'empty since {d}',
    ng_a_season_wet: 'rainy season, lower demand', ng_a_season_low: 'low season, lower demand', ng_a_season_high: 'high season', ng_a_term: (n) => `we pay ${n} months upfront`,
    ng_a_long: (n) => `listed for ${n} ${pl(n, 'day', 'days')}`, ng_a_cheaper: 'it used to go for {x} ({d})',
    ng_none_t: 'Nothing to compare with yet', ng_none: 'The agent collects prices of similar homes and this one’s history, then I suggest a price.',
    ng_beds: (n) => `${n} ${pl(n, 'bedroom', 'bedrooms')}`, ng_in: '{b} in {d}', ng_similar: 'Similar homes', ng_median: 'median {x}', ng_count: (n) => `${n} ${pl(n, 'listing', 'listings')}`,
    ng_pack: 'from the region pack', ng_market_none: 'Too few similar listings to compare with yet.',
    ng_hist_villa: 'This villa before', ng_hist_flat: 'This apartment before', ng_hist_house: 'This house before', ng_hist_none: 'We have not come across this home before.',
    ng_m_contact: 'same contact', ng_m_photos: 'by photos', ng_m_point: 'same map point', ng_m_dossier: 'from the dossier',
    ng_foot: 'Only you see this: we never show the budget cap to anyone', ng_owner_only: 'Only the search owner sees the bargaining hints.',
    rc_title: 'Search recap', rc_row_sub: 'how many we messaged, viewed and bargained', rc_found1: '{a} found a home {p}', rc_found: '{a} found a home {p}', rc_in_days: (n) => `in ${n} ${pl(n, 'day', 'days')}`,
    rc_contacted: 'messaged', rc_replied: 'replied', rc_viewings: (n) => pl(n, 'viewing', 'viewings'), rc_deals: (n) => pl(n, 'deal', 'deals'),
    rc_saved: 'Bargained {m} off a month: {t} over the lease', rc_saved1: 'Bargained {m} off a month', rc_share: 'Share', rc_sent: 'Sent the picture to your bot chat: forward it to friends',
    rc_incomplete: 'The recap is complete after the deal.', rc_share_text: 'We found a home with Hunt',
    gs_kicker: 'Guest of {h}', gs_kicker0: 'Guest', gs_banner: 'You are a guest: you see {x}. Access until {d}', gs_banner0: 'You are a guest. Access until {d}', gs_a_guide: 'the house', gs_a_places: 'places nearby', gs_a_contacts: 'contacts',
    gs_guide: 'Guide', gs_guide_sub: 'address, Wi-Fi, rules', gs_places: 'Places nearby', gs_places_sub: 'beaches, cafes, surf', gs_contacts: 'Contacts', gs_contacts_sub: 'bikes, water, laundry',
    gs_issue: 'Something broke', gs_issue_sub: 'tell the hosts', gs_lock: 'Money, the lease, chats and votes are hidden from guests',
    gs_nav_home: 'Home', gs_nav_places: 'Places', gs_nav_contacts: 'Contacts', gs_my_issues: 'You reported', gs_places_none: 'No places nearby yet', gs_contacts_none: 'The hosts have not added contacts yet.',
    gs_ask: 'Ask the agent to write', gs_ask_ph: 'Need a bike for 3 days from tomorrow morning', gs_ask_sent: 'Sent to the hosts for approval', gs_ask_text: 'The agent writes once the hosts approve the text.',
    gi_title: 'Invite a guest', gi_kicker: '{h} · settings', gi_from: 'From', gi_to: 'To', gi_sees: 'The guest sees',
    gi_guide: 'Guide: address, Wi-Fi, rules', gi_places: 'Places nearby and surf', gi_contacts: 'Contacts: bikes, water, laundry', gi_issues: 'Report a problem',
    gi_money: 'Money and expenses', gi_docs: 'Lease and documents', gi_chats: 'Chats and votes', gi_a_guide: 'guide', gi_a_places: 'places', gi_a_contacts: 'contacts', gi_a_issues: 'problems',
    gi_send: 'Invite link in Telegram', gi_copy: 'Copy the invite', gi_foot: 'Access ends by itself on {d}. Extend it or end it earlier right here.',
    gi_share_text: 'Come stay with us: the address, Wi-Fi and everything near the house', gi_bad_dates: 'The end date is before the start date', gi_no_areas: 'Turn on at least one section',
    gi_now: 'Guests now', gi_extend: '+7 days', gi_extended: 'Extended to {d}', gi_revoke: 'Close access', gi_revoke_q: 'Close access for {x}?', gi_revoked: 'Access closed',
    gi_row: 'Guests', gi_row_sub0: 'a guide and places nearby for visiting friends', gi_row_sub: (n) => `${n} ${pl(n, 'guest', 'guests')} now`, gi_role: 'guest',
    // wave 6 · D: home mode
    hm_nav_today: 'Home', hm_nav_map: 'Map', hm_nav_plan: 'Plan', hm_nav_more: 'More', hm_our_home: 'Our home', hm_our_home_day: 'Our home · day {d} of {n}',
    hm_movein_today: 'Move-in today', hm_movein_tomorrow: 'Move-in tomorrow', hm_movein_wd: 'Move-in on {wd}', hm_movein_date: 'Move-in on {d}', hm_moved_in: 'Moved in on {d}', hm_movein_none: 'Moving in soon',
    hm_wd_acc: (n) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][n],
    hm_month_in: (n) => `in ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][n]}`,
    hm_in_days: (n) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} ${pl(n, 'day', 'days')}`),
    hm_left_lease: (n) => `${n} ${pl(n, 'day', 'days')} left on the lease`, hm_closed: 'The project is closed, everything is read-only',
    hm_stage_k: 'Stage {i} of {n} · {k}', hm_st_start: 'start', hm_st_search: 'search', hm_st_viewings: 'viewings', hm_st_choice: 'choice', hm_st_deal: 'deal', hm_st_movein: 'move-in',
    hm_st_living: 'living', hm_st_extension: 'extension', hm_st_next: 'what next', hm_st_relet: 're-let', hm_st_moveout: 'move-out', hm_st_closed: 'closed',
    hm_b_lease: 'Lease', hm_b_paid: 'Paid', hm_checklist: 'Before move-in · {k} of {n}', hm_term_checklist: 'For the new lease · {k} of {n}', hm_today: 'Today',
    hm_surf_k: 'Surf today', hm_surf_t: '{s} until {t}', hm_pay: 'Payment {x} {w}', hm_power: (n) => `Power: ~${n} ${pl(n, 'day', 'days')} left`, hm_power_sub: 'top up by {d}',
    hm_bike: 'Bike: payment {w}', hm_bike_late: 'Bike: payment overdue', hm_guest_in: '{g} arrives {w}', hm_guest_here: '{g} is staying until {d}',
    hm_q_lease: 'Lease', hm_q_money: 'Money', hm_q_contacts: 'Contacts', hm_q_bikes: 'Bikes', hm_q_guests: 'Guests', hm_q_docs: 'Documents',
    hm_more: 'More', hm_more_home: 'Home', hm_more_life: 'Life', hm_more_search: 'Search', hm_m_docs: 'Lease and documents', hm_files: (n) => `${n} ${pl(n, 'file', 'files')}`, hm_dates_word: 'dates',
    hm_m_money: 'Money', hm_m_money_sub: 'shared budget · {x} {m}', hm_m_money_sub0: 'shared budget', hm_m_contacts: 'Contacts nearby', hm_m_contacts0: 'house, bikes, food, services',
    hm_m_bikes: 'Bikes', hm_m_bikes_sub: '{n} · payment {d}', hm_m_bikes0: 'rental, payments, return', hm_m_house: 'Repairs and the house', hm_m_house_sub: 'power, visas, guide, move-out',
    hm_m_guests: 'Guests', hm_m_guests_sub: 'a guide and access for dates', hm_m_items: 'Things for the villa', hm_m_items0: 'what we bought for the house', hm_m_act: '3D move-in record', hm_m_act_sub: 'move-in {d}', hm_m_act0: 'room scans at move-in',
    hm_m_useful: 'Useful', hm_m_useful_sub: 'chats, apps, guides', hm_m_next: 'What next', hm_m_next_sub: 'stay, search again or leave',
    hm_m_archive: 'Places we looked at', hm_m_archive_sub: (n) => `${n} ${pl(n, 'listing', 'listings')} · archive`, hm_m_path: 'Project path', hm_m_path_sub: 'stage {i} of {n}',
    hm_arch_note: 'The search archive: no more voting, everything is kept for the record', hm_layer_places: 'Places', hm_layer_contacts: 'Contacts', hm_map_none: 'The home has no point on the map',
    hm_cl_guest_in: '{g} arrives', hm_cl_guest_out: '{g} leaves', hm_cl_bike_return: 'Return the {m}', hm_cl_visa: 'Visa: {g}', hm_cl_visa_sub: 'until {d}, extend in advance',
    hm_cl_term: 'New lease', hm_cl_term_end: 'Lease ends',
    gq_req: '{g} asks to write to {c}:', gq_send: 'Send', gq_skip: 'Do not send', gq_edit: 'Edit the text', gq_sent: 'The agent will send the message', gq_skipped: 'Not sending',
    lc_stale: 'The agent will recompute the rings', lc_rush: 'Rings are travel time{m} without traffic; in rush hour add roughly {p}%', lc_rush_m: '',
  },
};
function t(k, vars = {}) {
  let v = STR[LANG][k] ?? STR.en[k] ?? k;
  if (typeof v === 'function') v = v(vars.n ?? 0, vars);
  return v.replace(/\{(\w+)\}/g, (_, x) => vars[x] ?? '');
}

const FL = {
  living_room: ['Гостиная', 'Living room'], kitchen: ['Кухня', 'Kitchen'], pool: ['Бассейн', 'Pool'], bedrooms_ensuite: ['Ванные при спальнях', 'En-suite'],
  electricity: ['Свет', 'Power'], power_capacity_va: ['Мощность, VA', 'Power, VA'], water: ['Вода', 'Water'], internet: ['Интернет', 'Internet'], cleaning: ['Уборка', 'Cleaning'],
  pool_garden_service: ['Бассейн и сад', 'Pool & garden'], banjar_security_garbage: ['Банджар, охрана, мусор', 'Banjar, security, garbage'], payment_terms: ['Оплата', 'Payment'],
  min_term: ['Мин. срок', 'Min term'], deposit: ['Депозит', 'Deposit'], sublease: ['Субаренда', 'Sublease'], furnished: ['Мебель', 'Furnished'], style: ['Стиль', 'Style'],
  construction_nearby: ['Стройка рядом', 'Construction nearby'], road_access: ['Дорога', 'Road'], parking: ['Парковка', 'Parking'], gated_complex: ['Закрытый комплекс', 'Gated complex'],
  view: ['Вид', 'View'], rooms_kz: ['Комнат', 'Rooms'], renovation: ['Ремонт', 'Renovation'], building: ['Дом', 'Building'], build_year: ['Год постройки', 'Built'],
  floor_of_total: ['Этаж', 'Floor'], utilities_billing: ['Коммуналка', 'Utilities'], heating: ['Отопление', 'Heating'], ac: ['Кондиционер', 'AC'],
  owner_or_agent: ['Хозяин или агент', 'Owner or agent'], agent_fee: ['Комиссия', 'Agent fee'], registration_ok: ['Прописка', 'Registration'], contract_written: ['Договор', 'Written lease'],
  pets: ['Животные', 'Pets'], kids: ['Дети', 'Kids'], electricity_rate_thb_kwh: ['Свет, ฿/кВт·ч', 'Power, ฿/kWh'], water_rate: ['Вода', 'Water'], min_term_months: ['Мин. срок, мес', 'Min term, mo'],
  deposit_months: ['Депозит, мес', 'Deposit, mo'], advance_months: ['Предоплата, мес', 'Advance, mo'], landlord_type: ['Кто сдаёт', 'Landlord'], foreigner_ok: ['Иностранцам', 'Foreigners OK'],
  pets_allowed: ['Животные', 'Pets'], common_fee_payer: ['Общий сбор платит', 'Common fee paid by'], tm30_by_landlord: ['TM30 от хозяина', 'TM30 by landlord'],
  bts_mrt_walk_min: ['До метро, мин', 'To BTS/MRT, min'], beach_distance_km: ['До пляжа, км', 'To beach, km'], property_type: ['Тип', 'Type'], available_from: ['Свободна с', 'Available from'],
};
const EV = {
  closed_ac: ['Закрытая, с кондиционером', 'Closed, with AC'], closed_no_ac: ['Закрытая, без кондиционера', 'Closed, no AC'], semi_open: ['Полуоткрытая', 'Semi-open'], open: ['Открытая', 'Open'],
  private: ['Свой', 'Private'], shared: ['Общий', 'Shared'], none: ['Нет', 'None'], included: ['Входит в цену', 'Included'], included_capped: ['Входит, с лимитом', 'Included, capped'],
  token_tenant: ['Токены, платим сами', 'Prepaid token, we pay'], postpaid_tenant: ['По счёту, платим сами', 'Postpaid, we pay'], closed: ['Закрытая', 'Closed'], open_air: ['Открытая', 'Open-air'],
  kitchenette: ['Мини-кухня', 'Kitchenette'], pdam: ['Городская (PDAM)', 'Mains (PDAM)'], well: ['Скважина', 'Well'], tanker: ['Привозная', 'Tanker'], mixed: ['Смешанная', 'Mixed'],
  extra: ['Отдельно', 'Extra'], n_a: ['Нет', 'n/a'], unknown: ['Неизвестно', 'Unknown'], monthly: ['Помесячно', 'Monthly'], '2m_upfront': ['2 месяца вперёд', '2 months upfront'],
  '3m_upfront': ['3 месяца вперёд', '3 months upfront'], '6m_upfront': ['6 месяцев вперёд', '6 months upfront'], yearly_upfront: ['Год вперёд', 'Year upfront'], full: ['Полностью', 'Full'],
  partial: ['Частично', 'Partial'], modern_light: ['Современный, светлый', 'Modern, light'], boho: ['Бохо', 'Boho'], balinese_dark_wood: ['Балийский, тёмное дерево', 'Balinese dark wood'],
  joglo: ['Джогло', 'Joglo'], yes: ['Да', 'Yes'], no: ['Нет', 'No'], car: ['Машина', 'Car'], bike_only_gang: ['Только байк', 'Bike-only lane'], steep_hill: ['Крутой подъём', 'Steep hill'],
  bikes_only: ['Только байки', 'Bikes only'], street: ['На улице', 'Street'], euro: ['Евроремонт', 'Euro renovation'], good: ['Хороший', 'Good'], cosmetic: ['Косметический', 'Cosmetic'],
  needs_repair: ['Нужен ремонт', 'Needs repair'], rough: ['Черновая', 'Rough'], monolith: ['Монолит', 'Monolith'], brick: ['Кирпич', 'Brick'], panel: ['Панель', 'Panel'], other: ['Другое', 'Other'],
  by_meters: ['По счётчикам', 'By meters'], fixed: ['Фиксированная', 'Fixed'], central: ['Центральное', 'Central'], autonomous: ['Автономное', 'Autonomous'], gas: ['Газ', 'Gas'],
  electric: ['Электрическое', 'Electric'], yard: ['Во дворе', 'Yard'], underground_included: ['Паркинг включён', 'Garage included'], underground_extra: ['Паркинг отдельно', 'Garage extra'],
  owner: ['Хозяин', 'Owner'], agent: ['Агент', 'Agent'], agent_says_owner: ['Агент, говорит хозяин', 'Agent, says owner'], allowed: ['Можно', 'Allowed'], ask: ['Спросить', 'Ask'],
  gov_rate: ['По госу тарифу', 'Government rate'], building_rate: ['Тариф дома', 'Building rate'], owner_rate: ['Тариф хозяина', 'Owner rate'], tenant: ['Арендатор', 'Tenant'],
  individual_owner: ['Частный хозяин', 'Private owner'], ocean: ['На океан', 'Ocean'], villa: ['Вилла', 'Villa'], house: ['Дом', 'House'], apartment: ['Квартира', 'Apartment'], condo: ['Кондо', 'Condo'],
};
const INC = { wifi: ['Wi-Fi', 'Wi-Fi'], internet: ['интернет', 'internet'], water: ['вода', 'water'], banjar: ['банджар', 'banjar'], cleaning: ['уборка', 'cleaning'], electricity: ['свет', 'power'],
  pool: ['бассейн', 'pool'], pool_service: ['бассейн', 'pool service'], garden: ['сад', 'garden'], security: ['охрана', 'security'], garbage: ['мусор', 'garbage'], laundry: ['стирка', 'laundry'], gas: ['газ', 'gas'] };
const TERMS = { '1 month': ['1 месяц', '1 month'], '2-3 months': ['2–3 месяца', '2–3 months'], '3-6 months': ['3–6 месяцев', '3–6 months'], '6-12 months': ['6–12 месяцев', '6–12 months'], '12+ months': ['от года', '12+ months'] };
const pick2 = (pair) => (pair ? pair[LANG === 'ru' ? 0 : 1] : null);
const human = (s) => String(s ?? '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const fieldLabel = (k) => pick2(FL[k]) ?? human(k);
const enumLabel = (v) => (typeof v === 'boolean' ? t(v ? 'yes' : 'no') : pick2(EV[v]) ?? (typeof v === 'string' && /^[a-z0-9_]+$/.test(v) ? human(v) : String(v)));

// ---------------------------------------------------------------- formatting
const LOC = () => (LANG === 'ru' ? 'ru-RU' : 'en-GB');
const tzNow = () => S.data?.search?.brief?.timezone || 'UTC';
const fmtNum = (x) => new Intl.NumberFormat(LOC(), { maximumFractionDigits: 1 }).format(x);
const SYM = { KZT: '₸', THB: '฿', USD: '$', EUR: '€', RUB: '₽', IDR: 'IDR' };
function money(n, cur, sym) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '';
  n = Number(n);
  const ru = LANG === 'ru';
  const a = Math.abs(n);
  const s = a >= 1e6 ? fmtNum(n / 1e6) + (ru ? ' млн' : 'M') : a >= 1e4 ? fmtNum(n / 1e3) + (ru ? ' тыс' : 'k') : fmtNum(n);
  const show = sym ?? (cur && cur !== 'IDR');
  return show && cur ? `${s} ${SYM[cur] ?? cur}` : s;
}
const isDateOnly = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s));
const asDate = (s) => new Date(isDateOnly(s) ? `${s}T12:00:00Z` : s);
const dfmt = (s, opts, tz) => new Intl.DateTimeFormat(LOC(), { timeZone: isDateOnly(s) ? 'UTC' : tz || tzNow(), ...opts }).format(asDate(s));
const fmtTime = (s, tz) => dfmt(s, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, tz);
const dayKey = (s, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: isDateOnly(s) ? 'UTC' : tz || tzNow(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(asDate(s));
const fmtDM = (s, tz) => dfmt(s, { day: '2-digit', month: '2-digit' }, tz).replace('/', '.');
const fmtDMY = (s) => dfmt(s, { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.');
const fmtDayMonth = (s, tz) => dfmt(s, { day: 'numeric', month: 'long' }, tz);
const fmtDayMonthShort = (s, tz) => dfmt(s, { day: 'numeric', month: 'short' }, tz).replace('.', '');
const wdShort = (s, tz) => cap(dfmt(s, { weekday: 'short' }, tz).replace('.', ''));
const ordinal = (n) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
function todayTitle(tz) {
  const d = new Date().toISOString();
  const wd = cap(dfmt(d, { weekday: 'long' }, tz));
  const day = Number(dfmt(d, { day: 'numeric' }, tz));
  return LANG === 'ru' ? `${wd}, ${day}\u2011е` : `${wd}, ${ordinal(day)}`;
}
function relIn(ms) {
  const rtf = new Intl.RelativeTimeFormat(LANG, { numeric: 'auto' });
  const m = Math.round(ms / 60000);
  if (Math.abs(m) < 60) return rtf.format(m, 'minute');
  const h = Math.round(m / 60);
  if (Math.abs(h) < 24) return rtf.format(h, 'hour');
  return rtf.format(Math.round(h / 24), 'day');
}
function whenLabel(iso, tz) {
  const k = dayKey(iso, tz);
  const now = Date.now();
  if (k === dayKey(new Date(now).toISOString(), tz)) return `${t('today')} ${fmtTime(iso, tz)}`;
  if (k === dayKey(new Date(now + 864e5).toISOString(), tz)) return `${t('tomorrow')} ${fmtTime(iso, tz)}`;
  return `${fmtDayMonthShort(iso, tz)} ${fmtTime(iso, tz)}`;
}
function agoLabel(iso) {
  const k = dayKey(iso);
  const now = Date.now();
  if (k === dayKey(new Date(now).toISOString())) return fmtTime(iso);
  if (k === dayKey(new Date(now - 864e5).toISOString())) return `${t('yesterday')} ${fmtTime(iso)}`;
  return fmtDayMonthShort(iso);
}
/** "from 2026-11-23" / "23.11–31.03" → {from:'23.11', to:'31.03'} */
function availParts(av) {
  if (!av) return {};
  const out = [];
  for (const m of String(av).matchAll(/(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/g)) {
    out.push(m[1] ? `${m[3]}.${m[2]}` : `${m[4].padStart(2, '0')}.${m[5].padStart(2, '0')}`);
  }
  return { from: out[0], to: out[1] };
}
const termLabel = (x) => (x ? pick2(TERMS[x]) ?? x : null);
const firstName = (n) => String(n ?? '').split(/\s+/)[0];
const initial = (n) => (String(n ?? '?').trim()[0] ?? '?').toUpperCase();
const shortTitle = (s) => String(s ?? '').split(/[,·]/)[0].trim();
const CHANNEL = { whatsapp: 'WhatsApp', telegram: 'Telegram', messenger: 'Messenger', instagram: 'Instagram', email: 'Email', line: 'LINE', viber: 'Viber', phone: 'Phone' };
const channelName = (c) => CHANNEL[c] ?? (String(c ?? '').startsWith('portal:') ? String(c).slice(7) : human(c));

function budgetLabel(b, cur) {
  if (b == null || b === '') return null;
  if (typeof b === 'object') return money(b.amount ?? b.value, b.currency ?? cur, true);
  if (typeof b === 'number') return money(b, cur, true);
  return String(b);
}
/** 20000000, 30000000 → "20–30 млн IDR" */
function rangeLabel(lo, hi, cur) {
  const sc = Math.abs(hi) >= 1e6 ? 1e6 : Math.abs(hi) >= 1e4 ? 1e3 : 1;
  return `${fmtNum(lo / sc)}–${money(hi, cur, true)}`;
}
// distance (km) between [lat,lng] points
function km(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const ROAD = 1.35; // straight line → road distance

// ---------------------------------------------------------------- store
const S = { data: null, regions: null, error: null, loading: true, toast: null, sheet: null, planDay: null };
const subs = new Set();
const emit = () => subs.forEach((f) => f());
function useStore() {
  const [, set] = useState(0);
  useEffect(() => {
    const f = () => set((x) => x + 1);
    subs.add(f);
    return () => subs.delete(f);
  }, []);
  return S;
}
let toastTimer;
/** A short line at the bottom; `act` = {label, icon?, run} adds one button (an undo) and keeps it longer. */
function toast(msg, act = null, ms = 2400) {
  if (S.closedHint > Date.now() && msg === t('err_generic')) msg = t('pp_closed_toast');
  if (S.demoHint > Date.now() && msg === t('err_generic')) msg = LANG === 'en' ? 'This is a demo: nothing is sent' : 'Это демо: тут ничего не отправляется';
  S.toast = msg;
  S.toastAct = act;
  emit();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { S.toast = null; S.toastAct = null; emit(); }, act ? Math.max(ms, 6000) : ms);
}
function ToastEl() {
  if (!S.toast) return null;
  const a = S.toastAct;
  if (!a) return html`<div class="toast" role="status">${S.toast}</div>`;
  return html`<div class="toast act" role="status"><span class="grow">${S.toast}</span><button class="toast-act" onClick=${() => { clearTimeout(toastTimer); S.toast = null; S.toastAct = null; emit(); a.run(); }}>${a.icon && html`<${Icon} n=${a.icon} cls="sm" />`}${a.label}</button></div>`;
}
const openSheet = (kind, arg) => { S.sheet = { kind, arg }; emit(); };
const closeSheet = () => { S.sheet = null; emit(); };

const hap = {
  impact: (s = 'light') => tg(() => TG?.HapticFeedback?.impactOccurred(s)),
  sel: () => tg(() => TG?.HapticFeedback?.selectionChanged()),
  ok: () => tg(() => TG?.HapticFeedback?.notificationOccurred('success')),
};

// ---------------------------------------------------------------- api
const urlKey = new URLSearchParams(location.search).get('k');
if (urlKey) tg(() => sessionStorage.setItem('hunt.k', urlKey));
const linkKey = urlKey || tg(() => sessionStorage.getItem('hunt.k'));
const authHeaders = () => (inTG ? { 'x-tg-init-data': TG.initData } : linkKey ? { 'x-hunt-link': linkKey } : {});
async function api(path, body, method) {
  if (demoOn) { try { return await demoApi(path, body); } catch (e) { if (body) { S.demoHint = Date.now() + 1500; } throw e; } }
  const r = await fetch(path, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { ...authHeaders(), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(d.message || d.error || String(r.status));
    e.code = d.error;
    e.status = r.status;
    if (d.error === 'closed') S.closedHint = Date.now() + 1500; // wave 6 · A: the generic error toast says "closed" instead
    throw e;
  }
  return d;
}

function applyLang(l) {
  LANG = l === 'en' ? 'en' : 'ru';
  document.documentElement.lang = LANG;
}
function applyRegion(country) {
  const has = !!S.regions?.[country];
  if (has) document.documentElement.dataset.region = country;
  else delete document.documentElement.dataset.region;
}
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
/** Theme preference: 'light' (default), 'dark' or 'auto' (follows Telegram / the system). Stored per device. */
function themePref() { try { const v = localStorage.getItem('hunt.theme'); return v === 'dark' || v === 'auto' ? v : 'light'; } catch { return 'light'; } }
function setThemePref(v) { try { localStorage.setItem('hunt.theme', v); } catch {} applyTheme(); }
function applyTheme() {
  const pref = themePref();
  const sys = inTG && TG.colorScheme ? TG.colorScheme : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = pref === 'auto' ? sys : pref;
  tg(() => {
    if (!inTG) return;
    TG.setHeaderColor(cssVar('--ground'));
    TG.setBackgroundColor(cssVar('--ground'));
    TG.setBottomBarColor?.(cssVar('--ground'));
  });
  emit();
}
const isDark = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);

const startParam = tg(() => TG?.initDataUnsafe?.start_param) || null;
let loadSeq = 0;
async function load(sid, { quiet = false, listing = null } = {}) {
  const seq = ++loadSeq;
  if (!quiet) { S.loading = true; emit(); }
  try {
    const q = sid ? `?s=${encodeURIComponent(sid)}` : listing ? `?l=${encodeURIComponent(listing)}` : '';
    // Money, the house, documents and wave 4 blocks come from a second call (keeps each Worker call small); merged before render.
    const more = (s) => api('/app/api/state-more?s=' + encodeURIComponent(s)).catch(() => null);
    const [d, m0] = await Promise.all([api('/app/api/state' + q), sid ? more(sid) : null]);
    const canMore = d.search && d.me?.role && d.me.role !== 'guest';
    const m = canMore ? (m0 && m0.search_id === d.search.id ? m0 : await more(d.search.id)) : null;
    if (m) { const { search_id, ...rest } = m; Object.assign(d, rest); }
    if (seq !== loadSeq) return;
    S.data = d;
    S.error = null;
    applyLang(d.user?.lang);
    if (d.search) {
      pref.set('sid', d.search.id);
      applyRegion(d.search.country);
      document.documentElement.toggleAttribute('data-closed', !!d.path?.closed); // wave 6 · A: closed = read-only
    }
  } catch (e) {
    if (seq !== loadSeq) return;
    S.error = e;
  }
  S.loading = false;
  emit();
}
let refreshTimer;
const refresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => S.data?.search && load(S.data.search.id, { quiet: true }), 600); };

async function vote(lid, decision) {
  const d = S.data;
  const uid = d.user.id;
  d.votes = d.votes.filter((v) => !(v.listing_id === lid && v.user_id === uid)).concat([{ listing_id: lid, user_id: uid, decision, at: new Date().toISOString() }]);
  const l = d.listings.find((x) => x.id === lid);
  if (l) l.decision = groupDecision(votesFor(lid)) ?? l.decision;
  emit();
  try {
    const r = await api('/app/api/vote', { listing_id: lid, decision });
    if (l && 'decision' in r) { l.decision = r.decision; emit(); }
  } catch { toast(t('err_generic')); }
  refresh();
}
async function unvote(lid) {
  const d = S.data;
  d.votes = d.votes.filter((v) => !(v.listing_id === lid && v.user_id === d.user.id));
  const l = d.listings.find((x) => x.id === lid);
  if (l && votesFor(lid).length) l.decision = groupDecision(votesFor(lid));
  emit();
  try { await api('/app/api/unvote', { listing_id: lid }); } catch { toast(t('err_generic')); }
  refresh();
}

// ---------------------------------------------------------------- routing
function parseHash() {
  let h = location.hash.slice(1);
  h = h.split(/[&?]?tgWebApp/)[0];
  try { h = decodeURIComponent(h); } catch { /* keep */ }
  if (!h || h === '/') return { screen: 'start', key: 'start' };
  if (!h.startsWith('/')) return h === 'plan' ? { screen: 'plan', legacy: true, key: h } : { screen: 'listing', arg: h, legacy: true, key: h };
  const p = h.split('/').filter(Boolean);
  if (p[0] === 'searches') return { screen: 'picker', key: 'picker' };
  if (p[0] === 'new') return { screen: 'newproject', key: 'new' };
  if (p[0] === 's' && p[1]) return { sid: p[1], screen: p[2] || 'today', arg: p[3], key: h };
  return { screen: 'start', key: 'start' };
}
let depth = 0;
function go(path, replace = false) {
  if (replace) {
    history.replaceState(null, '', '#' + path);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    depth++;
    location.hash = path;
  }
}
const sp = (screen, arg) => `/s/${S.data?.search?.id}/${screen}${arg ? '/' + encodeURIComponent(arg) : ''}`;
function back() {
  if (depth > 0) { depth--; history.back(); } else go(sp('today'), true);
}
function useRoute() {
  const [r, set] = useState(parseHash);
  useEffect(() => {
    const f = () => set(parseHash());
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return r;
}
function openLink(url) {
  if (!url) return;
  if (inTG && /^https:\/\/t\.me\//.test(url)) tg(() => TG.openTelegramLink(url));
  else if (/^(tg|mailto|tel):/.test(url)) location.href = url;
  else if (inTG) tg(() => TG.openLink(url));
  else window.open(url, '_blank', 'noopener');
}

// ---------------------------------------------------------------- data helpers
const D = () => S.data;
const listingById = (id) => D()?.listings.find((l) => l.id === id);
const memberById = (id) => D()?.members.find((m) => m.user_id === id);
const votesFor = (lid) => (D()?.votes ?? []).filter((v) => v.listing_id === lid);
const myVote = (lid) => votesFor(lid).find((v) => v.user_id === D()?.user.id)?.decision ?? null;
// Group interest and decision: mirrors src/scores.ts.
const WEIGHT = { take: 3, want_view: 2, thinking: 1, not_interested: -2 };
const canVoteRole = (r) => r === 'owner' || r === 'member';
const votersN = () => (D()?.members ?? []).filter((m) => canVoteRole(m.role)).length;
const ownerId = () => D()?.members.find((m) => m.role === 'owner')?.user_id ?? null;
function interestOf(lid) {
  const vs = votesFor(lid).filter((v) => { const m = memberById(v.user_id); return !m || canVoteRole(m.role); });
  return { score: vs.reduce((n, v) => n + (WEIGHT[v.decision] ?? 0), 0), max: 3 * votersN(), votes: vs };
}
function groupDecision(vs) {
  if (!vs.length) return null;
  if (vs.some((v) => v.user_id === ownerId() && v.decision === 'take')) return 'take';
  const n = {};
  for (const v of vs) n[v.decision] = (n[v.decision] ?? 0) + 1;
  const top = Math.max(...Object.values(n));
  const tied = Object.keys(n).filter((k) => n[k] === top);
  if (tied.length === 1) return tied[0];
  const pos = ['take', 'want_view', 'thinking'].filter((k) => tied.includes(k));
  if (tied.includes('not_interested') && pos.length) return 'thinking';
  return pos[0] ?? tied[0];
}
const ratingOf = (lid) => D()?.ratings?.[lid] ?? null;
const myRating = (lid) => ratingOf(lid)?.by_member?.find((m) => m.user_id === D()?.user.id) ?? null;
const fmtScore = (x) => (x == null ? '—' : new Intl.NumberFormat(LOC(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(x));
const interestText = (it) => t('interest', { x: Math.max(0, it.score), max: it.max });
/** The last viewing of a listing that has happened (done, or confirmed and already started). */
function viewedOf(lid) {
  const now = Date.now();
  const vs = (D()?.viewings ?? []).filter((v) => v.listing_id === lid && (v.status === 'done' || (v.status === 'confirmed' && Date.parse(v.starts_at) < now)));
  return vs[vs.length - 1] ?? null;
}
const CRIT = ['overall', 'area', 'inside', 'quiet'];
const CRIT_ICON = { overall: 'sparkles', area: 'pin', inside: 'sofa', quiet: 'volume' };
const animalName = (m) => (m?.animal ? m.animal.name[LANG] ?? m.animal.name.en : '');
const memberLabel = (m) => (m ? (animalName(m) ? `${cap(animalName(m))} (${firstName(m.name)})` : firstName(m.name)) : '?');
function photoUrl(p) {
  if (!p) return null;
  const k = encodeURIComponent(D()?.photo_token ?? '');
  // our own media paths (/app/kv/…, /app/photo/…) need the photo token: <img> cannot send the auth header
  if (typeof p === 'string') return /^\/app\/(kv|photo)\//.test(p) && !/[?&]k=/.test(p) ? `${p}${p.includes('?') ? '&' : '?'}k=${k}` : p;
  if (p.url) return p.url;
  if (p.src) return `${p.src}${p.src.includes('?') ? '&' : '?'}k=${k}`;
  if (p.kv) return `/app/kv/${encodeURIComponent(p.kv)}${p.i != null ? `?i=${p.i}&` : '?'}k=${k}`;
  return null;
}
const photosOf = (l) => (Array.isArray(l?.photos) ? l.photos : []).map(photoUrl).filter(Boolean);
function districtName(l) {
  if (!l) return '';
  const s = D()?.search;
  const reg = S.regions?.[s?.country];
  if (reg && l.district) {
    const sub = String(s.region).split('/')[1];
    const nm = reg.sub?.[sub]?.districts?.[l.district] ?? Object.values(reg.sub ?? {}).map((x) => x.districts?.[l.district]).find(Boolean);
    if (nm) return nm[LANG] ?? nm.en;
  }
  return l.area_text || human(l.district);
}
const districtShort = (l) => String(districtName(l)).split(/\s+\/\s+/)[0];
const shortLabel = (l) => [l?.bedrooms != null ? t('br', { n: l.bedrooms }) : null, districtName(l)].filter(Boolean).join(', ');
const priceText = (l) => money(l?.price, l?.currency);
function extraCost(l) {
  const f = l?.fields ?? {};
  if (['token_tenant', 'postpaid_tenant'].includes(f.electricity)) return t('plus_power');
  if (f.utilities_billing === 'by_meters') return t('plus_utils');
  return '';
}
const subRegion = () => {
  const s = D()?.search;
  return S.regions?.[s?.country]?.sub?.[String(s?.region).split('/')[1]] ?? null;
};
const travelKmh = () => D()?.search?.brief?.travel_kmh || subRegion()?.travel?.kmh || 25;
const travelMode = () => {
  const m = D()?.search?.brief?.travel_mode || subRegion()?.travel?.mode;
  return STR[LANG]['mode_' + m] ? t('mode_' + m) : t('mode_any');
};
const minutesFor = (dist) => Math.max(1, Math.round(((dist * ROAD) / travelKmh()) * 60));
/** New for me: I have not voted, and either nobody decided yet or friends voted (not agent-set, not taken). */
function isNewForMe(l, mine) {
  if (mine.has(l.id) || ['rejected', 'taken', 'closed'].includes(l.status) || l.decision === 'take') return false;
  return !l.decision || votesFor(l.id).length > 0;
}
function deckIds(d) {
  const mine = new Set(d.votes.filter((v) => v.user_id === d.user.id).map((v) => v.listing_id));
  return d.listings
    .filter((l) => isNewForMe(l, mine))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map((l) => l.id);
}
function agentAwayHours() {
  const s = D()?.agent_last_seen;
  if (!s) return 0;
  const h = Math.floor((Date.now() - Date.parse(s)) / 3600e3);
  return h >= 24 ? h : 0; // wave 8.1: a small line in the settings sheet only, after a day
}
function viewingsByDay() {
  const out = new Map();
  for (const v of D()?.viewings ?? []) {
    const k = dayKey(v.starts_at);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(v);
  }
  return out;
}
function defaultDay(days) {
  const today = dayKey(new Date().toISOString());
  if (days.includes(today)) return today;
  return days.find((d) => d > today) ?? days[days.length - 1] ?? null;
}
const sceneStyle = (c) => (S.regions?.[c]?.scene ? `--scene:url(/art/${c}/motif-scene.svg)` : '');
const markStyle = (c) => (S.regions?.[c]?.scene ? `--mark:url(/art/${c}/motif-mark.svg)` : '');

// ---------------------------------------------------------------- icons (lucide-style)
const ICONS = {
  'shield-check': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  'user-pen': '<path d="M11.5 15H7a4 4 0 0 0-4 4v2"/><path d="M21.378 16.626a1 1 0 0 0-3.004-3.004l-4.01 4.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/><circle cx="10" cy="7" r="4"/>',
  'user-check': '<path d="m16 11 2 2 4-4"/><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',
  forward: '<path d="m15 17 5-5-5-5"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/>',
  'log-out': '<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>',
  'arrow-up-right': '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  martini: '<path d="M8 22h8"/><path d="M12 11v11"/><path d="m19 3-7 8-7-8Z"/>',
  'party-popper': '<path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01M22 8h.01M15 2h.01M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11-.11.7-.72 1.22-1.43 1.22H17"/><path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"/>',
  ticket: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2M13 17v2M13 11v2"/>',
  film: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18M3 7.5h4M3 12h18M3 16.5h4M17 3v18M17 7.5h4M17 16.5h4"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.55-2.5 5.55-5.55C21.97 6.01 17.46 2 12 2z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2m-7.07-17.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  map: '<path d="M14.1 5.55a2 2 0 0 0 1.8 0l3.65-1.83A1 1 0 0 1 21 4.62v12.76a1 1 0 0 1-.55.9l-4.56 2.27a2 2 0 0 1-1.78 0l-4.22-2.1a2 2 0 0 0-1.78 0l-3.66 1.83A1 1 0 0 1 3 19.38V6.62a1 1 0 0 1 .55-.9L8.1 3.45a2 2 0 0 1 1.8 0z"/><path d="M15 5.76v15M9 3.24v15"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  eye: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M10.73 5.08a10.74 10.74 0 0 1 11.2 6.57 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-1.44 2.49M14.08 14.16a3 3 0 0 1-4.24-4.24M17.48 17.5a10.75 10.75 0 0 1-15.42-5.15 1 1 0 0 1 0-.7 10.75 10.75 0 0 1 4.45-5.14M2 2l20 20"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  pin: '<path d="M20 10c0 5-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 15 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  bed: '<path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9"/>',
  sofa: '<path d="M20 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v3"/><path d="M2 16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0zM4 18v2M20 18v2M12 4v9"/>',
  waves: '<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>',
  nav: '<path d="M3 11 22 2l-9 19-2-8z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  sparkles: '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0zM20 3v4M22 5h-4M4 17v2M5 18H3"/>',
  pencil: '<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5zM15 5l4 4"/>',
  send: '<path d="M14.54 21.69a.5.5 0 0 0 .94-.03l6.5-19a.5.5 0 0 0-.64-.63l-19 6.5a.5.5 0 0 0-.02.93l7.93 3.18a2 2 0 0 1 1.11 1.11zM21.85 2.15 10.91 13.09"/>',
  hourglass: '<path d="M5 22h14M5 2h14M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  userplus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  msg: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  star: '<path d="M11.53 2.3a.53.53 0 0 1 .95 0l2.31 4.68a2.12 2.12 0 0 0 1.6 1.16l5.16.76a.53.53 0 0 1 .3.9l-3.74 3.64a2.12 2.12 0 0 0-.61 1.88l.88 5.14a.53.53 0 0 1-.77.56l-4.62-2.43a2.12 2.12 0 0 0-1.97 0L6.4 21.01a.53.53 0 0 1-.77-.56l.88-5.14a2.12 2.12 0 0 0-.61-1.88L2.16 9.8a.53.53 0 0 1 .3-.91l5.16-.75a2.12 2.12 0 0 0 1.6-1.16z"/>',
  receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 17.5v-11"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/>',
  shuffle: '<path d="m18 14 4 4-4 4M18 2l4 4-4 4M2 18h1.97a4 4 0 0 0 3.3-1.7l5.45-8.6a4 4 0 0 1 3.3-1.7H22M2 6h1.97a4 4 0 0 1 3.05 1.41l.43.5M22 18h-6.04a4 4 0 0 1-3.3-1.8l-.36-.45"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .71-1.53l7-6a2 2 0 0 1 2.58 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  link: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  briefcase: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
  msgs: '<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>',
  insta: '<rect width="20" height="20" x="2" y="2" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37zM17.5 6.5h.01"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  ext: '<path d="M7 7h10v10M7 17 17 7"/>',
  circlecheck: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  chev: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>', // wave 8: list rows end with an arrow-up-right (K1)
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  play: '<path d="M6 3 20 12 6 21Z"/>',
  volume: '<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5ZM16 9a5 5 0 0 1 0 6"/>',
  sort: '<path d="m3 16 4 4 4-4M7 20V4M11 4h10M11 8h7M11 12h4"/>',
  chevd: '<path d="m6 9 6 6 6-6"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8"/>',
};
// Lucide icons by their own names (region checklists, wave 2 screens): lucide-static 0.460.0, ISC.
Object.assign(ICONS, {
  'air-vent': '<path d="M6 12H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 8h12"/><path d="M18.3 17.7a2.5 2.5 0 0 1-3.16 3.83 2.53 2.53 0 0 1-1.14-2V12"/><path d="M6.6 15.6A2 2 0 1 0 10 17v-5"/>',
  'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  'banknote': '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  'bed': '<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/>',
  'bell': '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  'bug': '<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
  'building': '<rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/>',
  'calendar-clock': '<path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h5"/><path d="M17.5 17.5 16 16.3V14"/><circle cx="16" cy="16" r="6"/>',
  'camera': '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  'car': '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  'circle-check': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  'circle-dashed': '<path d="M10.1 2.182a10 10 0 0 1 3.8 0"/><path d="M13.9 21.818a10 10 0 0 1-3.8 0"/><path d="M17.609 3.721a10 10 0 0 1 2.69 2.7"/><path d="M2.182 13.9a10 10 0 0 1 0-3.8"/><path d="M20.279 17.609a10 10 0 0 1-2.7 2.69"/><path d="M21.818 10.1a10 10 0 0 1 0 3.8"/><path d="M3.721 6.391a10 10 0 0 1 2.7-2.69"/><path d="M6.391 20.279a10 10 0 0 1-2.69-2.7"/>',
  'circle-help': '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  'circle-x': '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  'cloud-rain': '<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M16 14v6"/><path d="M8 14v6"/><path d="M12 16v6"/>',
  'dog': '<path d="M11.25 16.25h1.5L12 17z"/><path d="M16 14v.5"/><path d="M4.42 11.247A13.152 13.152 0 0 0 4 14.556C4 18.728 7.582 21 12 21s8-2.272 8-6.444a11.702 11.702 0 0 0-.493-3.309"/><path d="M8 14v.5"/><path d="M8.5 8.5c-.384 1.05-1.083 2.028-2.344 2.5-1.931.722-3.576-.297-3.656-1-.113-.994 1.177-6.53 4-7 1.923-.321 3.651.845 3.651 2.235A7.497 7.497 0 0 1 14 5.277c0-1.39 1.844-2.598 3.767-2.277 2.823.47 4.113 6.006 4 7-.08.703-1.725 1.722-3.656 1-1.261-.472-1.855-1.45-2.239-2.5"/>',
  'droplets': '<path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z"/><path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97"/>',
  'fan': '<path d="M10.827 16.379a6.082 6.082 0 0 1-8.618-7.002l5.412 1.45a6.082 6.082 0 0 1 7.002-8.618l-1.45 5.412a6.082 6.082 0 0 1 8.618 7.002l-5.412-1.45a6.082 6.082 0 0 1-7.002 8.618l1.45-5.412Z"/><path d="M12 12v.01"/>',
  'file-down': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/>',
  'file-pen': '<path d="M12.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v9.5"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M13.378 15.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/>',
  'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  'flame': '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  'hard-hat': '<path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5"/><path d="M14 6a6 6 0 0 1 6 6v3"/><path d="M4 15v-3a6 6 0 0 1 6-6"/><rect x="2" y="15" width="20" height="4" rx="1"/>',
  'heater': '<path d="M11 8c2-3-2-3 0-6"/><path d="M15.5 8c2-3-2-3 0-6"/><path d="M6 10h.01"/><path d="M6 14h.01"/><path d="M10 16v-4"/><path d="M14 16v-4"/><path d="M18 16v-4"/><path d="M20 6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3"/><path d="M5 20v2"/><path d="M19 20v2"/>',
  'house': '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  'key': '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
  'key-round': '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
  'lock': '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'message-circle': '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  'minus': '<path d="M5 12h14"/>',
  'plug': '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  'receipt-text': '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M14 8H8"/><path d="M16 12H8"/><path d="M13 16H8"/>',
  'refrigerator': '<path d="M5 6a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6Z"/><path d="M5 10h14"/><path d="M15 7v6"/>',
  'scale': '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  'settings-2': '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  'shield': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  'shield-alert': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  'shower-head': '<path d="m4 4 2.5 2.5"/><path d="M13.5 6.5a4.95 4.95 0 0 0-7 7"/><path d="M15 5 5 15"/><path d="M14 17v.01"/><path d="M10 16v.01"/><path d="M13 13v.01"/><path d="M16 10v.01"/><path d="M11 20v.01"/><path d="M17 14v.01"/><path d="M20 11v.01"/>',
  'signal': '<path d="M2 20h.01"/><path d="M7 20v-4"/><path d="M12 20v-8"/><path d="M17 20V8"/><path d="M22 4v16"/>',
  'sparkles': '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
  'sun': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  'thermometer': '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
  'trash-2': '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  'trees': '<path d="M10 10v.2A3 3 0 0 1 8.9 16H5a3 3 0 0 1-1-5.8V10a3 3 0 0 1 6 0Z"/><path d="M7 16v6"/><path d="M13 19v3"/><path d="M12 19h8.3a1 1 0 0 0 .7-1.7L18 14h.3a1 1 0 0 0 .7-1.7L16 9h.2a1 1 0 0 0 .8-1.7L13 3l-1.4 1.5"/>',
  'triangle-alert': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  'users': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  'utensils': '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  'video': '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  'volume-2': '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
  'wallet': '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  'washing-machine': '<path d="M3 6h3"/><path d="M17 6h.01"/><rect width="18" height="20" x="3" y="2" rx="2"/><circle cx="12" cy="13" r="5"/><path d="M12 18a2.5 2.5 0 0 0 0-5 2.5 2.5 0 0 1 0-5"/>',
  'waves': '<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>',
  'wifi': '<path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.859a10 10 0 0 1 14 0"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/>',
  'wind': '<path d="M12.8 19.6A2 2 0 1 0 14 16H2"/><path d="M17.5 8a2.5 2.5 0 1 1 2 4H2"/><path d="M9.8 4.4A2 2 0 1 1 11 8H2"/>',
  'wrench': '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  'zap': '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
});
// Wave 3 screens: lucide-static 0.460.0, ISC.
Object.assign(ICONS, {
  'thumbs-up': '<path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>',
  'thumbs-down': '<path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/>',
  'circle-alert': '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  'message-circle-warning': '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  'store': '<path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/><path d="M22 7v3a2 2 0 0 1-2 2a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7"/>',
  'hospital': '<path d="M12 6v4"/><path d="M14 14h-4"/><path d="M14 18h-4"/><path d="M14 8h-4"/><path d="M18 12h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h2"/><path d="M18 22V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v18"/>',
  'pill': '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
  'siren': '<path d="M7 18v-6a5 5 0 1 1 10 0v6"/><path d="M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z"/><path d="M21 12h1"/><path d="M18.5 4.5 18 5"/><path d="M2 12h1"/><path d="M12 2v1"/><path d="m4.929 4.929.707.707"/><path d="M12 12v6"/>',
  'zap-off': '<path d="M10.513 4.856 13.12 2.17a.5.5 0 0 1 .86.46l-1.377 4.317"/><path d="M15.656 10H20a1 1 0 0 1 .78 1.63l-1.72 1.773"/><path d="M16.273 16.273 10.88 21.83a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14H4a1 1 0 0 1-.78-1.63l4.507-4.643"/><path d="m2 2 20 20"/>',
  'droplet': '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  'stamp': '<path d="M5 22h14"/><path d="M19.27 13.73A2.5 2.5 0 0 0 17.5 13h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1.5c0-.66-.26-1.3-.73-1.77Z"/><path d="M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-3-3c-1.66 0-3 1-3 3s1 2 1 3.5V13"/>',
  'laptop': '<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/>',
  'dumbbell': '<path d="M14.4 14.4 9.6 9.6"/><path d="M18.657 21.485a2 2 0 1 1-2.829-2.828l-1.767 1.768a2 2 0 1 1-2.829-2.829l6.364-6.364a2 2 0 1 1 2.829 2.829l-1.768 1.767a2 2 0 1 1 2.828 2.829z"/><path d="m21.5 21.5-1.4-1.4"/><path d="M3.9 3.9 2.5 2.5"/><path d="M6.404 12.768a2 2 0 1 1-2.829-2.829l1.768-1.767a2 2 0 1 1-2.828-2.829l2.828-2.828a2 2 0 1 1 2.829 2.828l1.767-1.768a2 2 0 1 1 2.829 2.829z"/>',
  'shopping-cart': '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  'plane': '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  'bike': '<circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/>',
  'fish': '<path d="M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.47-3.44 6-7 6s-7.56-2.53-8.5-6Z"/><path d="M18 12v.5"/><path d="M16 17.93a9.77 9.77 0 0 1 0-11.86"/><path d="M7 10.67C7 8 5.58 5.97 2.73 5.5c-1 1.5-1 5 .23 6.5-1.24 1.5-1.24 5-.23 6.5C5.58 18.03 7 16 7 13.33"/><path d="M10.46 7.26C10.2 5.88 9.17 4.24 8 3h5.8a2 2 0 0 1 1.98 1.67l.23 1.4"/><path d="m16.01 17.93-.23 1.4A2 2 0 0 1 13.8 21H9.5a5.96 5.96 0 0 0 1.49-3.98"/>',
  'shirt': '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>',
  'school': '<path d="M14 22v-4a2 2 0 1 0-4 0v4"/><path d="m18 10 3.447 1.724a1 1 0 0 1 .553.894V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-7.382a1 1 0 0 1 .553-.894L6 10"/><path d="M18 5v17"/><path d="m4 6 7.106-3.553a2 2 0 0 1 1.788 0L20 6"/><path d="M6 5v17"/><circle cx="12" cy="9" r="2"/>',
  'coffee': '<path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/><path d="M6 2v2"/>',
  'map-pin': '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  'door-open': '<path d="M13 4h3a2 2 0 0 1 2 2v14"/><path d="M2 20h3"/><path d="M13 20h9"/><path d="M10 12v.01"/><path d="M13 4.562v16.157a1 1 0 0 1-1.242.97L5 20V5.562a2 2 0 0 1 1.515-1.94l4-1A2 2 0 0 1 13 4.561Z"/>',
  'megaphone': '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  'heart-pulse': '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/>',
  'graduation-cap': '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
  'users-round': '<path d="M18 21a8 8 0 0 0-16 0"/><circle cx="10" cy="8" r="5"/><path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"/>',
  'tree-palm': '<path d="M13 8c0-2.76-2.46-5-5.5-5S2 5.24 2 8h2l1-1 1 1h4"/><path d="M13 7.14A5.82 5.82 0 0 1 16.5 6c3.04 0 5.5 2.24 5.5 5h-3l-1-1-1 1h-3"/><path d="M5.89 9.71c-2.15 2.15-2.3 5.47-.35 7.43l4.24-4.25.7-.7.71-.71 2.12-2.12c-1.95-1.96-5.27-1.8-7.42.35"/><path d="M11 15.5c.5 2.5-.17 4.5-1 6.5h4c2-5.5-.5-12-1-14"/>',
  'mountain': '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
  'box': '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  'rotate-3d': '<path d="M16.466 7.5C15.643 4.237 13.952 2 12 2 9.239 2 7 6.477 7 12s2.239 10 5 10c.342 0 .677-.069 1-.2"/><path d="m15.194 13.707 3.814 1.86-1.86 3.814"/><path d="M19 15.57c-1.804.885-4.274 1.43-7 1.43-5.523 0-10-2.239-10-5s4.477-5 10-5c4.838 0 8.873 1.718 9.8 4"/>',
  'scan': '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>',
  'recycle': '<path d="M7 19H4.815a1.83 1.83 0 0 1-1.57-.881 1.785 1.785 0 0 1-.004-1.784L7.196 9.5"/><path d="M11 19h8.203a1.83 1.83 0 0 0 1.556-.89 1.784 1.784 0 0 0 0-1.775l-1.226-2.12"/><path d="m14 16-3 3 3 3"/><path d="M8.293 13.596 7.196 9.5 3.1 10.598"/><path d="m9.344 5.811 1.093-1.892A1.83 1.83 0 0 1 11.985 3a1.784 1.784 0 0 1 1.546.888l3.943 6.843"/><path d="m13.378 9.633 4.096 1.098 1.097-4.096"/>',
  'fuel': '<path d="M3 22h12"/><path d="M4 9h10"/><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2a2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5"/>',
  'volume-x': '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>',
  'cooking-pot': '<path d="M2 12h20"/><path d="M20 12v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8"/><path d="m4 8 16-4"/><path d="m8.86 6.78-.45-1.81a2 2 0 0 1 1.45-2.43l1.94-.48a2 2 0 0 1 2.43 1.46l.45 1.8"/>',
  'archive': '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  'blend': '<circle cx="9" cy="9" r="7"/><circle cx="15" cy="15" r="7"/>',
  'helmet': '<path d="M2 18a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v2z"/><path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5"/><path d="M4 15v-3a6 6 0 0 1 6-6"/><path d="M14 6a6 6 0 0 1 6 6v3"/>',
  'info-circle': '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  'building-2': '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>',
  // wave 5: lucide-static 0.460.0, ISC.
  'search': '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  'history': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  'share-2': '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98"/>',
  'trending-down': '<path d="M22 17 13.5 8.5l-5 5L2 7"/><path d="M16 17h6v-6"/>',
  'user': '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  'cigarette-off': '<path d="M12 12H3a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h13"/><path d="M18 8c0-2.5-2-2.5-2-5"/><path d="m2 2 20 20"/><path d="M21 12a1 1 0 0 1 1 1v2a1 1 0 0 1-.5.866"/><path d="M22 8c0-2.5-2-2.5-2-5"/><path d="M7 12v4"/>',
  'moon': '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  'footprints': '<path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z"/><path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z"/><path d="M16 17h4M4 13h4"/>',
  'smartphone': '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
  'book-open': '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  'copy': '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  'sunrise': '<path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/>',
});
const Icon = ({ n, cls = '' }) => html`<svg class=${'icon ' + cls} viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: ICONS[n] ?? '' }}></svg>`;
const DEC_ICON = { want_view: 'eye', thinking: 'help', not_interested: 'x', take: 'check' };

/** Vinyl-toy avatars (the pack's art/toys, made with skills/hunt-art → /toys/<pack>/<slug>-192|384.webp): from TOY_MIN px up the animal is a
 * glossy toy popping out of its disc; smaller sizes keep the flat SVG, and so does any toy that fails to load. */
const TOY_MIN = 32;
const TOY_K = 1.32; // toy frame vs disc (app.css .av.toy)
const toyBad = new Set();
/** free: the whole toy standing on a soft shadow, no disc (Home stickers, who's going, the reveal); rows keep the disc. */
function Av({ m, size = 40, badge = null, ring = false, title, flat = false, free = false }) {
  const a = m?.animal;
  const tkey = a ? `${a.pack}/${a.slug}` : '';
  const [bad, setBad] = useState(false);
  const toy = !!a && !flat && size >= TOY_MIN && !bad && !toyBad.has(tkey);
  const style = `--s:${size}px;${a ? `--av-l:${a.bg_light};--av-d:${a.bg_dark};` : ''}`;
  const label = title ?? (m?.name ? `${m.name}${a ? ' · ' + (a.name[LANG] ?? a.name.en) : ''}` : '');
  const fail = () => { toyBad.add(tkey); setBad(true); };
  const tsrc = free ? `${tkey}-full` : tkey;
  return html`<span class=${`av${toy ? ' toy' : ''}${toy && free ? ' free' : ''}${ring ? ' ring' : ''}${badge ? ' d-' + badge : ''}`} style=${style} title=${label} role=${label ? 'img' : null} aria-label=${label || null}>
    ${toy ? html`<span class="toy-pop"><img src=${`/toys/${tsrc}-192.webp`} srcset=${`/toys/${tsrc}-192.webp 192w, /toys/${tsrc}-384.webp 384w`} sizes=${`${Math.round(size * TOY_K)}px`} alt="" loading="lazy" decoding="async" draggable="false" onError=${fail} /></span>`
      : a ? html`<img src=${`/art/${a.pack}/avatars/${a.slug}.svg`} alt="" loading="lazy" decoding="async" />` : html`<span class="letter">${initial(m?.name)}</span>`}
    ${badge && html`<span class="badge"><${Icon} n=${DEC_ICON[badge]} /></span>`}
  </span>`;
}
function VoteAvs({ lid, size = 30, gap = false }) {
  const vs = votesFor(lid);
  if (!vs.length) return null;
  return html`<span class=${'avs' + (gap ? ' gap' : '')}>${vs.map((v) => html`<${Av} key=${v.user_id} m=${memberById(v.user_id)} size=${size} badge=${v.decision} ring />`)}</span>`;
}
/** Voters' animals with their decisions + "interest X of MAX" (cards, deck, compare). */
function InterestChip({ lid, size = 26, photo = false }) {
  const it = interestOf(lid);
  if (!it.votes.length) return null;
  return html`<span class=${'ichip' + (photo ? ' on-photo' : '')}>
    <span class="avs">${it.votes.map((v) => html`<${Av} key=${v.user_id} m=${memberById(v.user_id)} size=${size} badge=${v.decision} ring />`)}</span>
    <span class="ix">${interestText(it)}</span></span>`;
}
const ScoreChip = ({ lid }) => {
  const r = ratingOf(lid);
  return r ? html`<span class="schip" title=${t('score_title')}><${Icon} n="star" />${fmtScore(r.score)}</span>` : null;
};
const Img = ({ src, cls, alt = '' }) => (src ? html`<img class=${cls} src=${src} alt=${alt} loading="lazy" decoding="async" />` : html`<span class=${'noimg ' + (cls ?? '')}></span>`);

// ---------------------------------------------------------------- wave 8 · Block vibe pieces (DESIGN.md)
Object.assign(STR.ru, {
  // wave 8.3: the home's chats and the search archive (design/mockup-v8)
  ch_home: 'Дом', ch_wait: 'Ждут тебя', ch_arch: 'Архив поиска', ch_arch_sub: (n) => `${n} ${pl(n, 'переписка', 'переписки', 'переписок')}, только почитать`,
  ch_arch_note: 'Дома, с которыми переписывались до заезда. Только почитать', ch_arch_new: '{n} новое', ch_arch_wrote: 'Написали после заезда',
  ch_arch_no: 'Отказались', ch_arch_quiet: 'Не ответили', ch_arch_empty: 'Архив пуст', ch_locked: 'Архив поиска: писать отсюда нельзя. Ответить может Hunt, с твоим «да»',
  ch_arch_tag: 'архив',
});
Object.assign(STR.en, {
  ch_home: 'Home', ch_wait: 'Waiting for you', ch_arch: 'Search archive', ch_arch_sub: (n) => `${n} ${pl(n, 'chat', 'chats')}, read only`,
  ch_arch_note: 'Homes you wrote to before moving in. Read only', ch_arch_new: '{n} new', ch_arch_wrote: 'Wrote after the move',
  ch_arch_no: 'Turned down', ch_arch_quiet: 'No answer', ch_arch_empty: 'The archive is empty', ch_locked: 'Search archive: no writing from here. Hunt can answer, with your yes',
  ch_arch_tag: 'archive',
});
// Presentational only: the top bar, the giant blurred word, the typing statement, stickers, the floating hero photo with
// parallax, the black frame, a number count-up. Reduced motion → static text, no bobbing, no parallax, final numbers.
Object.assign(STR.ru, {
  w8_home: 'Дом', w8_night: 'Ночь', w8_todo: 'Что сделать · {n}', w8_k_pay: 'платёж', w8_k_power: 'свет', w8_k_stage: 'этап', w8_k_tomorrow: 'завтра', w8_k_home: 'дома',
  w8_stage_v: '{i} из {n}', w8_power_v: (n) => `на ${n} ${pl(n, 'день', 'дня', 'дней')}`, w8_day_n: 'день {n}', w8_surf_line: 'Серф {h} до {t}', w8_surf_dot: 'серф до {t}',
  w8_tonight_btn: 'Афиша на вечер', w8_go_too: 'Иду тоже', w8_other: 'Другое', w8_quiet_night: 'Тихий вечер дома', w8_tonight_q: 'Что сегодня вечером?', w8_day_q: 'Планы на {d}',
  w8_going: 'иду', w8_here: 'ты здесь', w8_signed: 'подписан {d}', w8_who_wrote: 'Кто что написал', w8_n_of: '{i} / {n}', w8_new: 'новая трата', w8_paid_by: 'платил',
  w8_photo_hint: 'фото чека, если есть', w8_open: 'Открыть', w8_first: 'первым!', w8_villa: 'Вилла',
});
Object.assign(STR.en, {
  w8_home: 'Home', w8_night: 'Night', w8_todo: 'To do · {n}', w8_k_pay: 'payment', w8_k_power: 'power', w8_k_stage: 'stage', w8_k_tomorrow: 'tomorrow', w8_k_home: 'at home',
  w8_stage_v: '{i} of {n}', w8_power_v: (n) => `${n} ${pl(n, 'day', 'days')} left`, w8_day_n: 'day {n}', w8_surf_line: 'Surf {h} until {t}', w8_surf_dot: 'surf till {t}',
  w8_tonight_btn: 'Tonight’s events', w8_go_too: 'Count me in', w8_other: 'Something else', w8_quiet_night: 'A quiet night in', w8_tonight_q: 'What’s on tonight?', w8_day_q: 'Plans for {d}',
  w8_going: 'going', w8_here: 'you are here', w8_signed: 'signed {d}', w8_who_wrote: 'Who wrote what', w8_n_of: '{i} / {n}', w8_new: 'new expense', w8_paid_by: 'paid by',
  w8_photo_hint: 'receipt photo, if any', w8_open: 'Open', w8_first: 'first!', w8_villa: 'Villa',
});
Object.assign(ICONS, {
  menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
  'arrow-up-right': '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
});
// wave 8.1: main tabs get their own colours, Home/Афиша/Деньги/Ещё in the home nav, designed empty states
Object.assign(STR.ru, {
  hm_nav_afisha: 'Афиша', hm_nav_money: 'Деньги', w81_near: 'Рядом', w81_districts: 'Районы', w81_far_bike: '{x} на байке', w81_day: 'день {d} из {n}', w81_map: 'Карта', w81_plan: 'План', w81_map_sub: 'дом, места и контакты рядом', w81_plan_sub: 'платежи, праздники, события',
  w81_home_dn: 'Дом {p}', w81_home: 'Дом', w81_rename: 'Название дома', w81_rename_hint: 'Коротко, как вы его зовёте: «Дом в Унгасане», «Вилла с бассейном»',
  w81_rename_ph: 'Дом в Унгасане', w81_save: 'Сохранить', w81_saved: 'Название сохранено', w81_tonight: 'Сегодня вечером', w81_tonight_n: (n) => `ещё ${n} ${pl(n, 'событие', 'события', 'событий')}`,
  w81_ev_line: 'Вечером: {t}', w81_offline: (h) => `Агент не заходил ${h >= 48 ? `${Math.floor(h / 24)} ${pl(Math.floor(h / 24), 'день', 'дня', 'дней')}` : `${h} ${pl(h, 'час', 'часа', 'часов')}`}: голоса и одобрения ждут его`,
  w81_af_big: 'Афиша собирается', w81_af_sub: 'Агент проверяет чаты и площадки рядом с домом каждое утро. Пока вот что идёт всегда:', w81_af_sweep: 'сбор в {t}',
  w81_af_daily: 'каждый день', w81_af_prefs: 'Что мне интересно', w81_af_rec: 'постоянное', w81_af_none_sub: 'Агент проверяет чаты и площадки рядом с домом каждое утро. Первые события появятся после сбора',
  w81_m_paid: 'Оплачено по договору', w81_m_rent: 'Аренда', w81_m_rent_for: 'аренда {p}', w81_m_deposit: 'Залог у хозяина', w81_m_dep_back: 'вернут {d}', w81_m_dep_note: 'не трата: вернётся при выезде',
  w81_m_first: 'первый месяц в доме', w81_m_rent_of: 'из них аренда {x}', w81_m_dep_line: 'и {x} залога у хозяина',
  w81_m_empty_k: 'общие траты', w81_m_empty: 'Тут будут общие траты', w81_m_empty_sub: 'Аренда, свет, байки, уборка: кто платил и кто кому должен. Агент добавит платежи по договору сам',
  w81_m_soon: 'скоро', w81_m_none_month: 'в {m} пока без трат', w81_m_all_line: 'всего {x} с заезда', w81_m_add: 'Добавить трату',
});
Object.assign(STR.en, {
  hm_nav_afisha: 'Events', hm_nav_money: 'Money', w81_near: 'Nearby', w81_districts: 'Districts', w81_far_bike: '{x} by bike', w81_day: 'day {d} of {n}', w81_map: 'Map', w81_plan: 'Plan', w81_map_sub: 'home, places and contacts nearby', w81_plan_sub: 'payments, holidays, events',
  w81_home_dn: 'Home {p}', w81_home: 'Home', w81_rename: 'Home name', w81_rename_hint: 'Short, the way you call it: “Ungasan house”, “Villa with a pool”',
  w81_rename_ph: 'Ungasan house', w81_save: 'Save', w81_saved: 'Name saved', w81_tonight: 'Tonight', w81_tonight_n: (n) => `${n} more ${pl(n, 'event', 'events')}`,
  w81_ev_line: 'Tonight: {t}', w81_offline: (h) => `The agent has been away for ${h >= 48 ? `${Math.floor(h / 24)} ${pl(Math.floor(h / 24), 'day', 'days')}` : `${h} ${pl(h, 'hour', 'hours')}`}: votes and approvals are waiting for it`,
  w81_af_big: 'Events are on their way', w81_af_sub: 'The agent checks chats and venues near your home every morning. Meanwhile, this is always on:', w81_af_sweep: 'sweep at {t}',
  w81_af_daily: 'every day', w81_af_prefs: 'My interests', w81_af_rec: 'regular', w81_af_none_sub: 'The agent checks chats and venues near your home every morning. The first events show up after the sweep',
  w81_m_paid: 'Paid under the lease', w81_m_rent: 'Rent', w81_m_rent_for: 'rent {p}', w81_m_deposit: 'Deposit with the landlord', w81_m_dep_back: 'back on {d}', w81_m_dep_note: 'not spending: it comes back at move-out',
  w81_m_first: 'your first month here', w81_m_rent_of: 'rent {x} of it', w81_m_dep_line: 'plus {x} deposit with the landlord',
  w81_m_empty_k: 'shared spending', w81_m_empty: 'Shared spending lives here', w81_m_empty_sub: 'Rent, power, bikes, cleaning: who paid and who owes whom. The agent adds the lease payments itself',
  w81_m_soon: 'soon', w81_m_none_month: 'nothing spent in {m} yet', w81_m_all_line: '{x} since move-in', w81_m_add: 'Add expense',
});
Object.assign(ICONS, {
  'arrow-up': '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  'shopping-basket': '<path d="m15 11-1 9"/><path d="m19 11-4-7"/><path d="M2 11h20"/><path d="m3.5 11 1.6 7.4a2 2 0 0 0 2 1.6h9.8a2 2 0 0 0 2-1.6l1.7-7.4"/><path d="M4.5 15.5h15"/><path d="m5 11 4-7"/><path d="m9 11 1 9"/>',
  languages: '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
});
Object.assign(ICONS, { navigation: '<polygon points="3 11 22 2 13 21 11 13 3 11"/>' });
/** Local hour (0–23) in the project's time zone. */
const localHour = () => Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tzNow() }).format(new Date()));
/** Screen colour of a route (wave 8.1: every main tab its own): region (Home / Today, path, checklists), afisha (night palette in the
 * evening, afisha-day = hot coral 06:00–17:00), money (mint), more (sky), night (evening Home, dark theme via CSS), grey (secondary
 * screens: docs, lists, details). KZ / TH swaps for a clash with the region colour live in app.css. */
const ORD_SCREENS = new Set(['shop', 'good', 'basket', 'order-check', 'order', 'orders', 'set-apply']);
const TONE_REGION = new Set(['today', 'path', 'deal', 'onsite', 'moveout', 'next']);
function toneFor(screen, arg) {
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
/** Evening Home (V4-6): living in the home, 18:00–04:00 local. */
function nightMode() {
  if (themePref() === 'light') return false;
  if (!homeMode() || homePhase() !== 'living') return false;
  const h = localHour();
  return h >= 18 || h < 4;
}
function applyTone(tone) {
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
function TopBar({ screen }) {
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
/** Giant blurred word behind the hero (Дом, Ночь, Деньги…): a legible shape, never read out. */
const BigWord = ({ text, cls = '' }) => html`<div class=${'bigword ' + cls} aria-hidden="true">${text}</div>`;
/** The one key statement of a screen, typed with a caret; cycles 2–3 lines when given. Screen readers get the lines as text. */
function Typed({ lines, cls = '', as = 'p' }) {
  const list = (Array.isArray(lines) ? lines : [lines]).filter(Boolean).map(String);
  const key = list.join('|');
  const [txt, setTxt] = useState(reduceMotion() ? list[0] ?? '' : '');
  useEffect(() => {
    if (!list.length) return undefined;
    if (reduceMotion()) { setTxt(list[0]); return undefined; }
    let li = 0, i = 0, del = false, alive = true, tm = 0;
    const step = () => {
      if (!alive) return;
      const s0 = list[li];
      if (!del) { i++; setTxt(s0.slice(0, i)); if (i >= s0.length) { if (list.length < 2) return; del = true; tm = setTimeout(step, 2600); return; } }
      else { i--; setTxt(s0.slice(0, i)); if (i <= 0) { del = false; li = (li + 1) % list.length; } }
      tm = setTimeout(step, del ? 22 : 45 + Math.random() * 40);
    };
    tm = setTimeout(step, 180);
    return () => { alive = false; clearTimeout(tm); };
  }, [key]);
  const El = as;
  return html`<${El} class=${'typed ' + cls}><span class="sr">${list.join('. ')}</span><span aria-hidden="true">${txt}<span class="caret"></span></span><//>`;
}
/** Round sticker with 1–2 words, rotated (K1). */
const Sticker = ({ text, cls = '', style = '' }) => html`<span class=${'sticker ' + cls} style=${style}><span>${text}</span></span>`;
/** Members' animals as white-ringed stickers that gently bob (decorative; names stay in the title attribute). */
function AniStickers({ ms, size = 64, pos = [] }) {
  return html`${ms.slice(0, pos.length).map((m, k) => html`<span key=${m.user_id ?? k} class="ani" style=${`${pos[k]};--r:${k % 2 ? 8 : -10}deg;animation-delay:${-1.6 * k}s`}><${Av} m=${m} size=${size} free /></span>`)}`;
}
/** Hero photo floating with a long soft shadow and a small tilt; parallax ≤ 10 px on pointer move / scroll. */
function FloatPhoto({ src, alt = '', cls = '', onClick = null, label = null, tilt = -3, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduceMotion()) return undefined;
    let raf = 0, x = 0, y = 0;
    const paint = () => { raf = 0; el.style.transform = `rotate(${tilt + x * 3}deg) translate(${x * 10}px, ${y * 8}px)`; };
    const pm = (e) => { if (e.pointerType === 'touch') return; x = e.clientX / innerWidth - 0.5; y = e.clientY / innerHeight - 0.5; raf ||= requestAnimationFrame(paint); };
    const sc = () => { y = Math.max(-0.5, Math.min(0.5, scrollY / 800)); raf ||= requestAnimationFrame(paint); };
    addEventListener('pointermove', pm, { passive: true });
    addEventListener('scroll', sc, { passive: true });
    return () => { removeEventListener('pointermove', pm); removeEventListener('scroll', sc); cancelAnimationFrame(raf); };
  }, [tilt]);
  const inner = html`${src ? html`<img src=${src} alt=${alt} decoding="async" draggable="false" />` : html`<span class="float-none"></span>`}${children}`;
  const st = `transform:rotate(${tilt}deg)`;
  return onClick ? html`<button ref=${ref} class=${'float-ph ' + cls} style=${st} aria-label=${label} onClick=${onClick}>${inner}</button>`
    : html`<div ref=${ref} class=${'float-ph ' + cls} style=${st}>${inner}</div>`;
}
/** A number that counts up from 0 on mount (money); reduced motion → the final value at once. */
function CountUp({ value, fmt = (n) => String(Math.round(n)), ms = 1100 }) {
  const [v, setV] = useState(reduceMotion() ? value : 0);
  useEffect(() => {
    if (reduceMotion() || !Number.isFinite(value)) { setV(value); return undefined; }
    const t0 = performance.now();
    let raf = 0;
    const f = (now) => { const p = Math.min(1, (now - t0) / ms); setV(value * (1 - Math.pow(1 - p, 3))); if (p < 1) raf = requestAnimationFrame(f); };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return fmt(v);
}
/** Big number + unit split of a money amount for the giant figure (26,4 · млн рупий). */
function bigMoney(n, cur) {
  const a = Math.abs(n);
  const unit = a >= 1e6 ? (LANG === 'ru' ? 'млн' : 'million') : a >= 1e4 ? (LANG === 'ru' ? 'тыс' : 'thousand') : '';
  const div = a >= 1e6 ? 1e6 : a >= 1e4 ? 1e3 : 1;
  const curWord = LANG === 'ru' ? { IDR: 'рупий', KZT: 'тенге', THB: 'бат', RUB: 'рублей', USD: 'долларов', EUR: 'евро' }[cur] : cur;
  return { v: n / div, dec: div > 1 && a / div < 100 ? 1 : 0, unit: [unit, curWord].filter(Boolean).join(' ') };
}
/** Round back button under the top bar (outside Telegram, where Telegram has its own). */
const BackRound = () => (!inTG ? html`<button class="round w8-back" aria-label=${t('back')} onClick=${back}><${Icon} n="arrow-left" /></button>` : null);

// ---------------------------------------------------------------- shared pieces
function Nav({ tab }) {
  if (homeMode()) return html`<${HomeNav} tab=${tab} />`;
  const items = [['today', 'sun'], ['listings', 'layers'], ['map', 'map'], ['plan', 'calendar']];
  return html`<nav class="nav" aria-label="Hunt">
    ${items.map(([k, ic]) => html`<a href=${'#' + sp(k)} aria-current=${tab === k ? 'page' : null} aria-label=${t('nav_' + k)}
      onClick=${(e) => { e.preventDefault(); if (tab !== k) { hap.sel(); go(sp(k), true); } }}>
      <${Icon} n=${ic} /><span>${t('nav_' + k)}</span></a>`)}
  </nav>`;
}
/** Wave 6: the project stage bar (00c, 45, 46): n segments, the first idx-1 done, idx current (mango), closed = all done. */
function StageBar({ idx, n = 9, closed = false, cls = '' }) {
  return html`<span class=${'stagebar ' + cls} role="img" aria-label=${t('stage_n_of', { i: Math.min(idx, n), n })}>
    ${Array.from({ length: n }, (_, k) => html`<i class=${closed ? (k === n - 1 ? 'end' : 'done') : k + 1 < idx ? 'done' : k + 1 === idx ? 'cur' : ''}></i>`)}</span>`;
}
/** Wave 6: a "living water" shape (surf on Home, own pool on a villa, sea on an event): a circle or a pill since wave 8. Static
 * gradient underneath; fx.js (the one WebGL effect system, shader "water") paints a canvas into .water-bg, at most 2 animated
 * effects at a time, paused off-screen, a still frame under reduced motion, nothing without WebGL. Children are the text. */
function WaterCard({ children, cls = '', onClick = null, label = null }) {
  const bg = useRef(null);
  useEffect(() => fxMount(bg.current, { shader: 'water', cell: 72 }), []);
  const inner = html`<span class="water-bg" aria-hidden="true" ref=${bg}></span><span class="water-txt">${children}</span>`;
  return onClick ? html`<button class=${'water-card ' + cls} aria-label=${label} onClick=${onClick}>${inner}</button>` : html`<div class=${'water-card ' + cls}>${inner}</div>`;
}
function Skeletons({ n = 2 }) {
  return html`<div class="stack" aria-hidden="true">${Array.from({ length: n }, () => html`<div class="skeleton"><div class="ph"></div><div class="ln"></div><div class="ln"></div></div>`)}</div>`;
}

// ---------------------------------------------------------------- screens: searches
function Picker() {
  const d = D();
  return html`<main class="screen no-nav pk8">
    <div class="head"><div><h1 class="w8-title">${t('pp_projects')}</h1></div></div>
    ${d.searches.length ? html`<div class="stack pp-cards">${d.searches.map((s) => html`<${SearchCard} key=${s.id} s=${s} />`)}</div>`
      : html`<div class="center-msg"><p class="h2">${d.user?.can_create ? t('np_first') : t('no_searches')}</p><p>${d.user?.can_create ? t('np_first_text') : t('no_searches_text')}</p></div>`}
    ${d.user?.can_create && html`<div class="or-send or-dock"><button class="btn accent big grow" onClick=${() => { hap.sel(); go('/new'); }}><${Icon} n="plus" cls="sm" />${t('np_new')}</button></div>`}
  </main>`;
}

// ---------------------------------------------------------------- wave 6 · A: project pipeline (00c cards, 45 path, Today strip)
Object.assign(ICONS, {
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  'calendar-plus': '<path d="M8 2v4"/><path d="M16 2v4"/><path d="M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8"/><path d="M3 10h18"/><path d="M16 19h6"/><path d="M19 16v6"/>',
});
const PP_ICON = { start: 'flag', search: 'search', viewings: 'eye', choice: 'heart', deal: 'file-text', movein: 'key-round', living: 'home', extension: 'calendar-plus',
  next: 'calendar-clock', relet: 'refresh-cw', moveout: 'log-out', closed: 'archive' };
const ppToday = (tz) => dayKey(new Date().toISOString(), tz || tzNow());
const ppDays = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 864e5);
/** "завтра" / "сегодня" / "через 3 дня" for a future day (null for a past one). */
function ppWhen(day, tz) {
  if (!day) return null;
  const n = ppDays(ppToday(tz), day);
  return n < 0 ? null : n === 0 ? t('pp_today') : n === 1 ? t('pp_tomorrow') : t('pp_in_days', { n });
}
const ppRange = (a, b) => (!a ? '' : !b || a === b ? fmtDM(a) : a.slice(5, 7) === b.slice(5, 7) ? `${a.slice(8, 10)}–${fmtDM(b)}` : `${fmtDM(a)}–${fmtDM(b)}`);
const ppFirst = (who) => String(who ?? '').split(/[\s,(]/)[0];
/** The one status line of a project card (00c): "Заезд через 3 дня", "Поиск · 14 вариантов", "Закрыт · досье". */
function ppLine(s) {
  const st = s.stage ?? { key: 'start' };
  const tz = s.brief?.timezone;
  if (s.role === 'guest') return s.guest?.to ? t('pp_l_guest', { d: fmtDM(s.guest.to) }) : t('gi_role');
  const nw = s.counts?.new ? ` · ${t('n_new', { n: s.counts.new })}` : '';
  switch (st.key) {
    case 'start': return t('pp_l_start');
    case 'search': return (st.listings ?? s.counts?.listings ? t('pp_l_search', { x: t('pp_f_listings', { n: st.listings ?? s.counts.listings }) }) : t('pp_l_search0')) + nw;
    case 'viewings': {
      const next = (s.upcoming ?? []).find((x) => Date.parse(x) > Date.now() - 30 * 60e3);
      return next ? t('pp_l_viewings_at', { w: whenLabel(next, tz) }) : t('pp_l_viewings') + nw;
    }
    case 'choice': return t('pp_l_choice');
    case 'deal': return st.date ? t('pp_l_deal_d', { d: fmtDM(st.date) }) : t('pp_l_deal');
    case 'movein': return st.date ? cap(t('pp_l_movein', { w: ppWhen(st.date, tz) ?? fmtDM(st.date) })) : t('pp_k_movein');
    case 'living': case 'extension': return st.date ? t('pp_l_living', { d: fmtDM(st.date) }) : t('pp_l_living0');
    case 'next': return t('pp_l_next');
    case 'moveout': return st.date ? cap(t('pp_l_moveout', { w: ppWhen(st.date, tz) ?? fmtDM(st.date) })) : t('pp_k_moveout');
    case 'closed': return t('pp_l_closed');
    default: return '';
  }
}
function SearchCard({ s }) {
  const st = s.stage ?? { key: 'start', idx: 1, n: 9 };
  const photo = s.role === 'guest' ? null : photoUrl(st.home?.photo ?? st.photo ?? null);
  const own = s.role !== 'owner' && s.role !== 'guest' ? t('invited_by', { name: firstName(s.owner_name) }) : null;
  // V4-13: a block of the region colour (closed projects stay warm grey), name, one status line, stage dashes, a framed photo
  return html`<button class=${'pp-card pk8-card' + (st.closed ? ' closed' : '')} data-region=${s.country} onClick=${() => { hap.sel(); go(`/s/${s.id}/today`); }}>
    <span class="pk8-t"><b>${s.title}</b><span>${ppLine(s)}</span>${own && html`<span class="pp-own">${own}</span>`}
      ${s.role !== 'guest' && html`<${StageBar} idx=${st.idx ?? 1} n=${st.n ?? 9} closed=${!!st.closed} cls="pp-bar" />`}</span>
    <span class="frame sm pk8-ph"><span class="in">${photo ? html`<img src=${photo} alt="" loading="lazy" decoding="async" />` : html`<span class="float-none" style=${sceneStyle(s.country)}></span>`}</span></span>
    ${(s.members ?? []).length > 1 && html`<span class="avs pk8-avs">${(s.members ?? []).slice(0, 3).map((m) => html`<${Av} key=${m.user_id} m=${m} size=${30} ring />`)}</span>`}
  </button>`;
}
/** Read-only banner of a closed project (45, Today; D can reuse it in home mode). */
function ClosedBanner() {
  const p = D()?.path;
  if (!p?.closed) return null;
  return html`<div class="banner pp-closed" role="status"><${Icon} n="archive" /><div><b>${t('pp_closed_t')}</b><span>${t('pp_closed_s')}${p.can_edit ? `. ${t('pp_closed_owner')}` : ''}</span></div></div>`;
}
/** "заезд через 3 дня" after "Этап 6 из 9" (45 header, Today strip). */
function ppHint(p) {
  const r = (k) => p.rows?.find((x) => x.key === k)?.facts ?? {};
  const tz = tzNow();
  switch (p.key) {
    case 'search': { const f = r('search'); return f.listings ? t('pp_f_listings', { n: f.listings }) : t('pp_h_search'); }
    case 'movein': { const f = r('movein'); const w = ppWhen(f.date, tz); return f.date ? (w ? t('pp_h_movein', { w }) : t('pp_h_movein_past', { d: fmtDM(f.date) })) : t('pp_k_movein').toLowerCase(); }
    case 'living': { const f = r('living'); return f.day && f.days ? t('pp_f_day', { d: f.day, n: f.days }).toLowerCase() : t('pp_k_living').toLowerCase(); }
    case 'moveout': { const f = r('moveout'); const w = ppWhen(f.date, tz); return f.date ? (w ? t('pp_h_moveout', { w }) : t('pp_h_moveout_past', { d: fmtDM(f.date) })) : t('pp_k_moveout').toLowerCase(); }
    default: return STR[LANG]['pp_h_' + p.key] ? t('pp_h_' + p.key) : '';
  }
}
/** The one-line status of a path row, from its facts (numbers only come from the server). */
function ppRowLine(row) {
  const f = row.facts ?? {};
  const todo = row.status === 'todo';
  const cur = D()?.search?.brief?.currency ?? f.currency;
  switch (row.key) {
    case 'search':
      if (f.contacted) return [t('pp_f_contacted', { n: f.contacted }), t('pp_f_replied', { n: f.replied ?? 0 })].join(' · ');
      return f.listings ? t('pp_f_listings', { n: f.listings }) : t('pp_d_search');
    case 'viewings':
      if (!f.count) return t('pp_d_viewings');
      return `${S.regions?.[D()?.search?.country]?.homes === 'villas' ? t('pp_f_villas', { n: f.count }) : t('pp_f_views', { n: f.count })}${f.days ? ' ' + t('pp_f_days', { n: f.days }) : ''}`;
    case 'choice':
      if (f.title) return `${shortTitle(f.title)} — ${t('pp_how_' + (f.how ?? 'deal'))}`;
      return f.takes ? t('pp_f_takes', { n: f.takes }) : t('pp_d_choice');
    case 'deal': {
      if (todo && !f.signed && !f.paid) return t('pp_d_deal');
      const parts = [f.signed ? t(f.stamp ? 'pp_f_signed_stamp' : 'pp_f_signed') : t('pp_f_unsigned')];
      if (f.paid) parts.push(t('pp_f_paid', { x: money(f.paid, f.currency ?? cur) }));
      if (f.pending) parts.push(t('pp_f_pending', { x: money(f.pending, f.currency ?? cur) }));
      return parts.join(', ');
    }
    case 'movein': return f.landlord ? t('pp_f_movein', { who: ppFirst(f.landlord) }) : t('pp_f_movein_home');
    case 'living': return row.status === 'current' && f.day && f.days ? t('pp_f_day', { d: f.day, n: f.days }) : t('pp_d_living');
    case 'extension': {
      if (f.status === 'pending' || !f.seq) return t('pp_f_ext_wait');
      return [f.landlord, f.deposit_prev ? t('pp_dep_' + f.deposit_prev) : null].filter(Boolean).join(' · ') || t('pp_d_extension');
    }
    case 'next':
      if (f.status === 'open') return t('pp_f_votes', { v: f.votes ?? 0, n: f.voters ?? 0 });
      if (f.status === 'decided' && f.choice) return t('pp_f_next_' + f.choice);
      return t('pp_d_next');
    case 'relet': return STR[LANG]['pp_relet_' + f.status] ? t('pp_relet_' + f.status) : t('pp_d_relet');
    case 'moveout':
      if (f.total) return [t('pp_f_steps', { d: f.done ?? 0, n: f.total }), f.deposit_status === 'done' ? t('pp_f_dep_done') : f.deposit_status === 'wait' ? t('pp_f_dep_wait') : null].filter(Boolean).join(' · ');
      return f.landlord ? t('pp_f_moveout', { who: ppFirst(f.landlord) }) : t('pp_d_moveout');
    default: return STR[LANG]['pp_d_' + row.key] ? t('pp_d_' + row.key) : '';
  }
}
function ppRowDate(row) {
  if (row.key === 'search') return ppRange(row.date, row.date_to);
  if (row.key === 'living' || row.key === 'next') return row.key === 'living' ? (row.date_to ? t('pp_until', { d: fmtDM(row.date_to) }) : '') : row.date ? t('pp_until', { d: fmtDM(row.date) }) : '';
  if (row.key === 'extension' || row.key === 'relet') return row.date ? fmtDM(row.date) : '';
  return row.date ? fmtDM(row.date) : '';
}
function ppGo(row) {
  if (!row.go) return;
  const [scr, ...rest] = row.go.split('/');
  hap.sel();
  go(sp(scr, rest.length ? decodeURIComponent(rest.join('/')) : undefined));
}
/** Screen 45: the project path. */
function PathScreen() {
  const d = D();
  const p = d.path;
  if (!p) return html`<main class="screen w2"><${W3Head} kicker=${d.search.title} title=${t('pp_title')} /><${Skeletons} n=${1} /><${Nav} tab="today" /></main>`;
  const sub = [t('stage_n_of', { i: Math.min(p.idx, p.n), n: p.n }), ppHint(p), p.manual ? t('pp_h_manual') : null].filter(Boolean).join(' · ');
  // V4-9: a giant title, then the stages as a hairline list with circles; "ты здесь" sticker on the current one
  return html`<main class="screen w2 pp-screen pp8">
    <div class="row pp8-top"><${BackRound} /><span class="grow"></span>
      ${p.can_edit && html`<button class="round" aria-label=${t('pp_change')} onClick=${() => { hap.sel(); openSheet('pp_stage'); }}><${Icon} n="pencil" /></button>`}</div>
    <h1 class="w8-title">${t('pp_title')}</h1>
    <p class="w8-cap">${[shortTitle(d.search.title), sub].filter(Boolean).join(' · ')}</p>
    <${ClosedBanner} />
    <div class="pp-list pp8-list">${p.rows.map((r, i) => {
      const title = r.key === 'extension' && r.date_to ? t('pp_ext_title', { d: fmtDM(r.date_to) }) : t('pp_k_' + r.key);
      return html`<button key=${r.key + i} class=${'pp-row ' + r.status} aria-current=${r.status === 'current' ? 'step' : null} onClick=${() => ppGo(r)}>
        <span class="pp-ic">${r.status === 'done' && html`<${Icon} n="check" />`}</span>
        <span class="grow"><b>${title}</b>${(r.status === 'current' || r.status === 'done') && ppRowLine(r) && html`<span>${ppRowLine(r)}</span>`}</span>
        <span class="pp-d">${ppRowDate(r)}</span>
        ${r.status === 'current' && !p.closed && html`<${Sticker} text=${t('w8_here')} cls="sm" style="right:17%;top:50%;margin-top:-32px;--r:10deg" />`}
      </button>`;
    })}</div>
    <${Nav} tab="today" />
  </main>`;
}
/** Search mode Today: a compact stage bar at the top, opens the path. */
function PathStrip() {
  const p = D()?.path;
  if (!p) return null;
  const hint = ppHint(p);
  return html`${p.closed && html`<${ClosedBanner} />`}<button class="card pp-strip" onClick=${() => { hap.sel(); go(sp('path')); }}>
    <span class="pp-strip-h"><span class="grow">${t('stage_n_of', { i: Math.min(p.idx, p.n), n: p.n })} · ${t('pp_k_' + p.key)}${hint ? html`<span class="muted"> · ${hint}</span>` : null}</span><${Icon} n="chev" cls="sm muted" /></span>
    <${StageBar} idx=${p.idx} n=${p.n} closed=${p.closed} />
  </button>`;
}
/** Owner sheet: set the stage by hand, back to automatic, close / reopen. */
function StageSheet() {
  const d = D();
  const p = d.path;
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!p) return null;
  async function set(stage) {
    setBusy(true);
    try {
      const r = await api('/app/api/stage', { search_id: d.search.id, stage });
      d.path = r.path;
      if (r.path) document.documentElement.toggleAttribute('data-closed', !!r.path.closed);
      hap.ok();
      toast(t('pp_set_ok'));
      closeSheet();
      refresh();
    } catch { toast(t('err_generic')); setBusy(false); }
  }
  if (confirm) {
    return html`<h2>${t('pp_close_q')}</h2><p class="muted" style="margin:0 0 16px">${t('pp_close_text')}</p>
      <button class="btn danger block pp-ok" disabled=${busy} onClick=${() => set('closed')}><${Icon} n="archive" />${t('pp_close_yes')}</button>
      <button class="btn ghost block" style="margin-top:8px" onClick=${() => setConfirm(false)}>${t('cancel')}</button>`;
  }
  const keys = ['start', 'search', 'viewings', 'choice', 'deal', 'movein', 'living', 'extension', 'next', 'moveout'];
  return html`<h2>${t('pp_change')}</h2>
    ${p.closed ? html`<button class="btn accent block pp-ok" disabled=${busy} onClick=${() => set('auto')}><${Icon} n="refresh-cw" />${t('pp_reopen')}</button>` : html`
    <div class="card grp">
      <button class="opt" disabled=${busy} onClick=${() => set('auto')}><${Icon} n="sparkles" cls="sm" /><span class="grow"><span style="display:block">${t('pp_auto')}</span><span class="muted" style="font-size:13px">${t('pp_auto_sub', { k: t('pp_k_' + p.derived_key) })}</span></span>${!p.manual && html`<${Icon} n="check" cls="check" />`}</button>
      ${keys.map((k) => html`<button key=${k} class="opt" disabled=${busy} onClick=${() => set(k)}><${Icon} n=${PP_ICON[k]} cls="sm" /><span class="grow">${t('pp_k_' + k)}</span>${p.manual && p.key === k && html`<${Icon} n="check" cls="check" />`}</button>`)}
    </div>
    <button class="btn danger block" disabled=${busy} onClick=${() => setConfirm(true)}><${Icon} n="archive" />${t('pp_close')}</button>`}
    <button class="btn ghost block" style="margin-top:8px" onClick=${closeSheet}>${t('close')}</button>`;
}

function Reveal() {
  const d = D();
  const s = d.search;
  const [busy, setBusy] = useState(false);
  const a = d.me.animal;
  const others = d.members.filter((m) => m.user_id !== d.user.id);
  const name = a ? a.name[LANG] ?? a.name.en : '';
  async function done() {
    setBusy(true);
    d.me.reveal_seen = true;
    emit();
    hap.ok();
    api('/app/api/seen-reveal', { search_id: s.id }).catch(() => null);
  }
  async function again() {
    hap.sel();
    setBusy(true);
    try {
      const r = await api('/app/api/reroll-animal', { search_id: s.id });
      d.me.animal = r.animal;
      const m = d.members.find((x) => x.user_id === d.user.id);
      if (m) m.animal = r.animal;
    } catch { toast(t('err_generic')); }
    setBusy(false);
  }
  return html`<main class="screen no-nav"><div class="reveal">
    <div class="scene" style=${sceneStyle(s.country)}></div>
    <div class="hero-av"><${Av} m=${{ animal: a, name: d.user.display_name }} size=${150} free /></div>
    <p class="kicker" style="margin-top:16px">${s.role === 'owner' ? t('reveal_mine', { title: s.title }) : t('reveal_kicker', { title: s.title, owner: firstName(s.owner_name) })}</p>
    <h1>${t('reveal_h1')}<br />${t('reveal_h2', { name })}</h1>
    <p>${t('reveal_p')}</p>
    ${others.length > 0 && html`<div class="others">${others.map((m) => html`<div key=${m.user_id}><${Av} m=${m} size=${48} free /><span>${firstName(m.name)} · ${m.animal ? m.animal.name[LANG] ?? m.animal.name.en : ''}</span></div>`)}</div>`}
    <div class="actions">
      <button class="btn accent block big" disabled=${busy && !d.me.reveal_seen ? false : null} onClick=${done}>${t('reveal_go')}</button>
      <button class="btn link block" style="margin-top:8px" disabled=${busy} onClick=${again}>${t('reveal_again')}</button>
    </div>
  </div></main>`;
}

// ---------------------------------------------------------------- today
function feedView(item, all) {
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
function groupFeed(feed) {
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
function Feed({ limit = 6 }) {
  const items = groupFeed(D().feed ?? []).slice(0, limit);
  if (!items.length) return html`<div class="card" style="padding:16px"><p class="muted" style="margin:0">${t('nothing_new')}</p></div>`;
  return html`<div class="card feed">${items.map((it) => {
    const v = feedView(it);
    const inner = html`${v.av}<div class="grow"><div class="t1">${v.t1}</div><div class="t2">${v.t2}</div></div>`;
    return v.go ? html`<button key=${it.id} class="feed-item" onClick=${() => go(v.go)}>${inner}</button>` : html`<div key=${it.id} class="feed-item">${inner}</div>`;
  })}</div>`;
}
function nextViewing() {
  const now = Date.now();
  return (D().viewings ?? []).find((v) => v.status !== 'done' && Date.parse(v.starts_at) > now - 20 * 60e3) ?? null;
}
function Hero() {
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
function Today() {
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
function inviteFriends(s) {
  if (!s?.invite_link) return toast(t('err_generic'));
  const url = `https://t.me/share/url?url=${encodeURIComponent(s.invite_link)}&text=${encodeURIComponent(t('invite_text'))}`;
  if (inTG) openLink(url);
  else if (navigator.share) navigator.share({ url: s.invite_link, text: t('invite_text') }).catch(() => null);
  else window.open(url, '_blank', 'noopener');
}

// ---------------------------------------------------------------- empty search
function EmptySearch({ tab }) {
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

// ---------------------------------------------------------------- listings
function ListingCard({ l }) {
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
function likedList(d) {
  const ls = d.listings.filter((l) => l.decision === 'want_view' || l.decision === 'take' || (ratingOf(l.id)?.score ?? 0) >= 3.5);
  return ls.sort((a, b) => (ratingOf(b.id)?.score ?? -1) - (ratingOf(a.id)?.score ?? -1) || interestOf(b.id).score - interestOf(a.id).score);
}
let listSeg = null; // remembered while the app is open
function Listings({ arg }) {
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
function Deck() {
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
  function stamp(dec, o) {
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
function factsFor(l) {
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
function Carousel({ photos }) {
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
let audioEl = null;
function playVoice(key) {
  hap.sel();
  tg(() => audioEl?.pause());
  audioEl = new Audio(`/app/kv/${encodeURIComponent(key)}?k=${encodeURIComponent(D()?.photo_token ?? '')}`);
  audioEl.play().catch(() => toast(t('err_generic')));
}
/** "both “view”", "Kingfisher “view”", "view 1, thinking 1". */
function interestSummary(vs) {
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
function GroupScore({ l }) {
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
function PoolPair({ l }) {
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
function ListingDetail({ id }) {
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
const canRecord = () => typeof window.MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
function whenAt(iso) {
  const k = dayKey(iso);
  const now = Date.now();
  const dw = k === dayKey(new Date(now).toISOString()) ? t('today') : k === dayKey(new Date(now - 864e5).toISOString()) ? t('yesterday') : fmtDayMonthShort(iso);
  return t('at_word', { d: dw, t: fmtTime(iso) });
}
function Rate({ id }) {
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
      (d.ratings ??= {})[id] = r.rating;
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
function Approve() {
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
const CMP_ROWS = { bali: ['living_room', 'pool', 'electricity'], kz: ['rooms_kz', 'renovation', 'utilities_billing'], th: ['furnished', 'utilities_billing', 'deposit_months'] };
const GOOD = new Set(['closed_ac', 'closed_no_ac', 'included', 'private', 'euro', 'full']);
function cmpCell(l, k) {
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
const compareList = (d) => d.listings.filter((l) => l.decision === 'want_view' || l.decision === 'take' || ratingOf(l.id));
const CMP_SORTS = ['score', 'price', 'interest'];
let cmpSort = null;
function Compare() {
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

// ---------------------------------------------------------------- plan
function usePlanDay() {
  const byDay = viewingsByDay();
  const days = [...byDay.keys()].sort();
  const [day, setDay] = useState(() => (S.planDay && days.includes(S.planDay) ? S.planDay : defaultDay(days)));
  const choose = (k) => { S.planDay = k; setDay(k); };
  return { byDay, days, day: days.includes(day) ? day : defaultDay(days), choose };
}
const vStatus = (v) => (v.status === 'confirmed' && Date.parse(v.starts_at) < Date.now() - 3 * 3600e3 ? 'done' : v.status);
function Plan() {
  const d = D();
  const { byDay, days, day, choose } = usePlanDay();
  const [mode, setMode0] = useState(planMode ?? (!days.length || d.deal || ['found', 'living'].includes(d.search.status) ? 'calendar' : 'viewings'));
  const setMode = (m) => { planMode = m; hap.sel(); setMode0(m); };
  if (mode === 'calendar') return html`<${Calendar} toViewings=${days.length ? () => setMode('viewings') : null} />`;
  const list = day ? byDay.get(day) ?? [] : [];
  const route = list.length ? d.routes?.[String(list[0].starts_at).slice(0, 10)] : null;
  const firstMap = list.find((v) => v.map_url)?.map_url;
  return html`<main class="screen">
    <div class="head"><div><h1 class="h1">${t('plan')}</h1></div><button class="sort-pill" onClick=${() => setMode('calendar')}><${Icon} n="cal" cls="sm" />${t('cl_open')}</button></div>
    ${!days.length ? html`<div class="card" style="padding:18px"><p class="muted" style="margin:0">${t('no_plan')}</p></div>` : html`
      <div class="days" role="toolbar">${days.map((k) => html`<button key=${k} class="day" aria-pressed=${k === day ? 'true' : 'false'} onClick=${() => { hap.sel(); choose(k); }}>
        <span>${wdShort(k)}</span><b>${Number(k.slice(8, 10))}</b></button>`)}</div>
      <div class="stack">${list.map((v) => {
        const l = listingById(v.listing_id) ?? v;
        const st = vStatus(v);
        const sub = [districtName(l), l.bedrooms != null ? t('br', { n: l.bedrooms }) : null, priceText(l), v.meet_note].filter(Boolean).join(' · ');
        return html`<button key=${v.id} class="card v-card" onClick=${() => go(sp('listing', v.listing_id))}>
          <${Img} src=${photosOf(l)[0] ?? photosOf(v)[0]} />
          <div class="grow"><div class="tm"><b>${fmtTime(v.starts_at)}</b><span class=${'st s-' + st}><span class="dot"></span>${t('s_' + st)}</span></div>
          <div class="nm">${shortTitle(l.title)}</div><div class="sub">${sub}</div></div></button>`;
      })}</div>
      ${!list.length && html`<p class="empty-note">${t('plan_empty')}</p>`}
      <div class="plan-actions">
        <button class="btn accent" disabled=${!route && !firstMap} onClick=${() => openLink(route ?? firstMap)}><${Icon} n="nav" />${t('route_day')}</button>
        <button class="btn surface" onClick=${() => openSheet('late', { day })}><${Icon} n="hourglass" />${t('late')}</button>
      </div>`}
    <${Nav} tab="plan" />
  </main>`;
}

// ---------------------------------------------------------------- map
let mlPromise = null;
function loadML() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  return (mlPromise ??= new Promise((res, rej) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = MAPLIBRE + '.css';
    document.head.append(css);
    const s = document.createElement('script');
    s.src = MAPLIBRE + '.js';
    s.onload = () => res(window.maplibregl);
    s.onerror = () => { mlPromise = null; rej(new Error('maplibre')); };
    document.head.append(s);
  }));
}
let baseStyle = null;
/** OpenFreeMap Positron, repainted with the app tokens (both themes). */
async function mapStyle() {
  baseStyle ??= await fetch(MAP_STYLE).then((r) => r.json());
  const st = JSON.parse(JSON.stringify(baseStyle));
  const v = (n) => cssVar(n);
  const ground = v('--ground'), surface = v('--map-road'), s2 = v('--map-fill'), line = v('--map-line'), ink2 = v('--ink-2'), water = v('--map-water'); // wave 8: opaque map tokens
  const road = isDark() ? s2 : surface;
  for (const l of st.layers) {
    const p = (l.paint ??= {});
    const id = l.id;
    if (l.type === 'background') p['background-color'] = ground;
    else if (id === 'water') p['fill-color'] = water;
    else if (id.startsWith('waterway')) { if (l.type === 'line') p['line-color'] = water; }
    else if (id === 'park' || id.startsWith('landcover')) { p['fill-color'] = s2; p['fill-opacity'] = 0.6; }
    else if (id.startsWith('landuse')) { p['fill-color'] = ground; p['fill-opacity'] = 0; }
    else if (id === 'building') { p['fill-color'] = line; p['fill-outline-color'] = line; }
    else if (l.type === 'fill') p['fill-color'] = s2;
    else if (l.type === 'line') p['line-color'] = /casing|boundary|rail/.test(id) ? line : road;
    if (l.type === 'symbol') {
      p['text-color'] = ink2;
      p['text-halo-color'] = ground;
      p['text-halo-width'] = 1.2;
      if (/shield/.test(id)) (l.layout ??= {}).visibility = 'none';
    }
    if (l.type === 'raster') (l.layout ??= {}).visibility = 'none';
  }
  return st;
}
function circle(lng, lat, kmR, n = 72) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    pts.push([lng + (kmR * Math.cos(a)) / (111.32 * Math.cos((lat * Math.PI) / 180)), lat + (kmR * Math.sin(a)) / 110.574]);
  }
  return pts;
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function useThemeKey() {
  const [k, setK] = useState(isDark() ? 'd' : 'l');
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const f = () => setK(isDark() ? 'd' : 'l');
    mq.addEventListener?.('change', f);
    subs.add(f);
    return () => { mq.removeEventListener?.('change', f); subs.delete(f); };
  }, []);
  return k;
}
function MapScreen({ arg }) {
  const d = D();
  const s = d.search;
  const [mode, setMode] = useState(arg === 'day' ? 'day' : 'all');
  const { byDay, days, day } = usePlanDay();
  const pts = d.listings.filter((l) => l.lat != null && l.lng != null);
  const firstSel = pts.find((l) => l.decision === 'take') ?? pts.find((l) => l.decision === 'want_view') ?? pts[0];
  const [sel, setSel] = useState(firstSel?.id ?? null);
  const [ready, setReady] = useState(false);
  const [fail, setFail] = useState(false);
  const box = useRef(null);
  const mapR = useRef(null);
  const marks = useRef([]);
  const fitted = useRef('');
  const theme = useThemeKey();
  const anchor = s.brief?.anchor;
  const kmh = travelKmh();
  const stops = (day ? byDay.get(day) ?? [] : []).map((v) => ({ v, l: listingById(v.listing_id) ?? v })).filter((x) => x.l.lat != null && x.l.lng != null);
  const [showPlaces, setShowPlaces0] = useState(pref.get('map_places') === '1');
  const setShowPlaces = (v) => { pref.set('map_places', v ? '1' : '0'); setShowPlaces0(v); };
  const basePl = useBasePlaces(s.country);
  const hasPlaces = !!S.regions?.[s.country]?.places || (d.places ?? []).length > 0;

  useEffect(() => {
    let dead = false;
    setReady(false);
    fitted.current = '';
    loadML().then(async (ml) => {
      const style = await mapStyle();
      if (dead || !box.current) return;
      const c = subRegion()?.center ?? (firstSel ? [firstSel.lat, firstSel.lng] : [0, 0]);
      const map = new ml.Map({ container: box.current, style, center: [c[1], c[0]], zoom: 11, attributionControl: false, dragRotate: false, pitchWithRotate: false, fadeDuration: 0 });
      map.touchZoomRotate.disableRotation();
      mapR.current = map;
      map.on('load', () => !dead && setReady(true));
      map.on('click', (e) => { if (e.originalEvent?.target === map.getCanvas()) setSel(null); });
    }).catch(() => !dead && setFail(true));
    return () => { dead = true; marks.current.forEach((m) => m.remove()); marks.current = []; mapR.current?.remove(); mapR.current = null; };
  }, [theme]);

  useEffect(() => {
    const map = mapR.current;
    const ml = window.maplibregl;
    if (!ready || !map || !ml) return;
    marks.current.forEach((m) => m.remove());
    marks.current = [];
    for (const id of ['ring', 'route']) { if (map.getLayer(id)) map.removeLayer(id); if (map.getSource(id)) map.removeSource(id); }
    const add = (el, lng, lat, z = 0) => { el.style.zIndex = String(z); marks.current.push(new ml.Marker({ element: el, anchor: 'center' }).setLngLat([lng, lat]).addTo(map)); };
    const bounds = new ml.LngLatBounds();
    const accent = cssVar('--map-accent');
    if (mode === 'all') {
      if (anchor) {
        const r = (kmh * 10) / 60;
        map.addSource('ring', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: circle(anchor.lng, anchor.lat, r) } } });
        map.addLayer({ id: 'ring', type: 'line', source: 'ring', paint: { 'line-color': accent, 'line-width': 1.5, 'line-opacity': 0.9 } });
        const lab = document.createElement('div');
        lab.className = 'ring-label';
        lab.textContent = t('ring', { n: 10, mode: travelMode() });
        const a = Math.PI / 3;
        add(lab, anchor.lng + (r * 0.62 * Math.cos(a)) / (111.32 * Math.cos((anchor.lat * Math.PI) / 180)), anchor.lat + (r * 0.92 * Math.sin(a)) / 110.574, 1);
        const an = document.createElement('div');
        an.className = 'anchor';
        an.innerHTML = `<span class="sq"><svg class="icon" viewBox="0 0 24 24">${ICONS[anchor.icon] ?? ICONS.target}</svg></span>${anchor.label ? `<span class="lb">${esc(anchor.label)}</span>` : ''}`;
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;transform:translateX(calc(50% - 15px))';
        wrap.append(an);
        add(wrap, anchor.lng, anchor.lat, 4);
        bounds.extend([anchor.lng, anchor.lat]);
      }
      if (showPlaces) for (const p of allPlaces(basePl)) {
        if (p.type === 'daytrip' && !p.own) continue;
        const el = document.createElement('button');
        el.className = `lpin sm g-${groupOfType(p.type)}`;
        el.textContent = placeEmoji(p, basePl?.types);
        el.setAttribute('aria-label', p.name);
        el.addEventListener('click', (e) => { e.stopPropagation(); openSheet('spot', p.id); });
        add(el, p.lng, p.lat, 0);
      }
      for (const l of pts) {
        const dec = l.decision ?? 'new';
        const isSel = l.id === sel;
        const el = document.createElement('button');
        el.className = 'pin-wrap';
        el.setAttribute('aria-label', `${priceText(l)} · ${l.title}`);
        el.innerHTML = `${isSel ? `<span class="pin-label">${esc(priceText(l))}</span>` : ''}<span class="pin d-${dec}${isSel ? ' sel' : ''}"></span>`;
        el.addEventListener('click', (e) => { e.stopPropagation(); hap.sel(); setSel(l.id); });
        add(el, l.lng, l.lat, isSel ? 5 : dec === 'not_interested' ? 1 : 3);
        bounds.extend([l.lng, l.lat]);
      }
    } else {
      if (stops.length > 1) {
        map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: stops.map((x) => [x.l.lng, x.l.lat]) } } });
        map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': accent, 'line-width': 4 } });
      }
      stops.forEach((x, k) => {
        const el = document.createElement('button');
        el.className = `stop st-${vStatus(x.v)}`;
        el.textContent = String(k + 1);
        el.setAttribute('aria-label', `${k + 1}. ${fmtTime(x.v.starts_at)} ${x.l.title}`);
        el.addEventListener('click', () => go(sp('listing', x.v.listing_id)));
        add(el, x.l.lng, x.l.lat, 3);
        bounds.extend([x.l.lng, x.l.lat]);
      });
    }
    const fitKey = mode + (mode === 'day' ? day : '');
    if (fitted.current !== fitKey && !bounds.isEmpty()) {
      fitted.current = fitKey;
      const mb = document.querySelector('.map-bottom')?.getBoundingClientRect();
      const mt = document.querySelector('.map-top')?.getBoundingClientRect();
      const H = box.current.clientHeight;
      const bottom = Math.min(H * 0.6, mb && mb.height ? H - mb.top + 28 : 180);
      const top = Math.min(H * 0.3, (mt ? mt.bottom : 100) + 28);
      map.fitBounds(bounds, { padding: { top, bottom, left: 36, right: 36 }, maxZoom: 14, duration: 0 });
    }
  }, [ready, mode, sel, day, d, showPlaces, basePl]);

  const counts = {};
  for (const l of d.listings) counts[l.decision ?? 'new'] = (counts[l.decision ?? 'new'] ?? 0) + 1;
  const selL = mode === 'all' ? listingById(sel) : null;
  const toAnchor = selL && anchor && selL.lat != null ? minutesFor(km([selL.lat, selL.lng], [anchor.lat, anchor.lng])) : null;
  let dayCard = null;
  if (mode === 'day') {
    const legs = stops.map((x, k) => (k ? km([stops[k - 1].l.lat, stops[k - 1].l.lng], [x.l.lat, x.l.lng]) : 0));
    const total = legs.reduce((a, b) => a + b, 0);
    const list = day ? byDay.get(day) ?? [] : [];
    const route = list.length ? d.routes?.[String(list[0].starts_at).slice(0, 10)] : null;
    const endMs = list.length ? Date.parse(list[list.length - 1].starts_at) + 45 * 60e3 : 0;
    dayCard = html`<div class="card day-card">
      <div class="hd"><div><div class="h2">${t('day_n', { n: list.length })}</div>
        ${stops.length > 1 && html`<div class="sub">${t('in_transit', { min: minutesFor(total), km: Math.round(total * ROAD), mode: travelMode() })}</div>`}</div>
        ${list.length > 0 && html`<span class="rng">${fmtTime(list[0].starts_at)} – ${fmtTime(new Date(endMs).toISOString())}</span>`}</div>
      <ol>${list.map((v, k) => {
        const l = listingById(v.listing_id) ?? v;
        const si = stops.findIndex((x) => x.v.id === v.id);
        return html`<li class=${'st-' + vStatus(v)}><span class="n">${k + 1}</span><b>${fmtTime(v.starts_at)}</b><span class="grow ellipsis">${[shortTitle(l.title), districtName(l)].filter(Boolean).join(' · ')}</span>
          <span class="leg">${si === 0 ? t('start') : si > 0 ? t('min', { n: minutesFor(legs[si]) }) : ''}</span></li>`;
      })}</ol>
      <button class="btn accent block" disabled=${!route} onClick=${() => openLink(route)}><${Icon} n="nav" />${t('open_gmaps')}</button>
    </div>`;
  }
  const order = ['take', 'want_view', 'thinking', 'not_interested', 'new'];
  return html`<main class="map-screen">
    <div class="map" ref=${box} role="application" aria-label=${t('nav_map')}></div>
    <div class="map-top">
      <div class="seg" role="group">
        <button aria-pressed=${mode === 'all' ? 'true' : 'false'} onClick=${() => { hap.sel(); setMode('all'); }}>${t('map_all')}</button>
        <button class="day-on" disabled=${!days.length} aria-pressed=${mode === 'day' ? 'true' : 'false'} onClick=${() => { hap.sel(); setMode('day'); }}>${day ? t('map_day_d', { d: wdShort(day) + ' ' + Number(day.slice(8, 10)) }) : t('map_day')}</button>
        ${regionPack()?.areas && html`<button aria-pressed="false" onClick=${() => { hap.sel(); go(sp('map', 'districts'), true); }}>${t('ds_mode')}</button>`}
      </div>
      ${mode === 'all' && html`<div class="legend">${order.filter((k) => counts[k]).map((k) => html`<span class=${'d-' + k}><span class="dot"></span>${t('legend_' + k, { n: counts[k] })}</span>`)}</div>`}
      ${mode === 'all' && hasPlaces && html`<div class="map-pl"><button class=${'ds-hint pl-tg' + (showPlaces ? ' on' : '')} aria-pressed=${showPlaces ? 'true' : 'false'} onClick=${() => { hap.sel(); setShowPlaces(!showPlaces); }}><${Icon} n="map-pin" cls="sm" />${t('sp_layer')}</button>
        <button class="ds-hint pl-tg" onClick=${() => go(sp('spots'))}><${Icon} n="layers" cls="sm" />${t('sp_list')}</button></div>`}
    </div>
    ${fail && html`<div class="center-msg" style="position:absolute;inset:40% 0 auto">${t('map_fail')}</div>`}
    ${ready && mode === 'all' && !pts.length && html`<div class="center-msg" style="position:absolute;inset:40% 0 auto">${t('map_none')}</div>`}
    <div class="map-bottom">
      ${selL && html`<button class="card map-card" onClick=${() => go(sp('listing', selL.id))}>
        <${Img} src=${photosOf(selL)[0]} />
        <div class="grow"><div class="p">${priceText(selL)} <small>${t('per_month')}</small></div><div class="t">${selL.title}</div>
          ${toAnchor && html`<div class="tr"><${Icon} n=${anchor.icon && ICONS[anchor.icon] ? anchor.icon : 'target'} cls="sm" />${anchor.to_label ? `${t('min', { n: toAnchor })} ${anchor.to_label}` : t('min_to', { n: toAnchor, label: anchor.label ?? '' })}</div>`}
          <div style="margin-top:8px"><${VoteAvs} lid=${selL.id} size=${24} /></div></div></button>`}
      ${dayCard}
    </div>
    <span class="attrib">© OpenFreeMap © OpenStreetMap</span>
    <${Nav} tab="map" />
  </main>`;
}

// ---------------------------------------------------------------- deal
async function toggleCheck(deal, i) {
  const c = deal.data?.checklist?.[i];
  if (!c) return;
  const done = !c.done;
  if (typeof c === 'object') c.done = done;
  hap.sel();
  emit();
  try { await api('/app/api/deal-check', { listing_id: deal.listing_id, index: i, done }); }
  catch { if (typeof c === 'object') c.done = !done; emit(); toast(t('err_generic')); }
}
function Deal() {
  const d = D();
  const deal = d.deal;
  if (!deal) return html`<main class="screen"><div class="center-msg">—</div><${Nav} tab="today" /></main>`;
  const data = deal.data ?? {};
  const l = listingById(deal.listing_id);
  const terms = data.terms ?? {};
  const pays = (data.payments ?? []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const nextIdx = pays.findIndex((p) => !p.paid && p.kind !== 'refund' && dayKey(p.date) >= dayKey(new Date().toISOString()));
  const checklist = data.checklist ?? [];
  const kind = terms.type === 'sublease' ? t('sublease') : terms.type ? t('lease') : null;
  const kDone = checklist.filter((c) => c.done).length;
  // V4-2: the checklist leads (giant title, big circles); the home and the payments follow as hairline rows
  return html`<main class="screen dl8">
    ${!inTG && html`<div class="row w8-head-top"><${BackIfWeb} /></div>`}
    ${checklist.length > 0 && html`<h1 class="w8-title">${t('before_move')}</h1>
      <p class="w8-cap">${[t('w8_stage_v', { i: kDone, n: checklist.length }), terms.from ? `${wdShort(terms.from)} ${fmtDM(terms.from)}` : null].filter(Boolean).join(' · ')}</p>
      <div class="card checklist dl8-check">${checklist.map((c, i) => html`<button class=${'check' + (c.done ? ' done' : '')} role="checkbox" aria-checked=${c.done ? 'true' : 'false'} disabled=${d.me.role === 'viewer'} onClick=${() => toggleCheck(deal, i)}><span class="box">${c.done && html`<${Icon} n="check" />`}</span><span>${c.text ?? c.label}</span></button>`)}</div>`}
    <div class="deal-head"><${Img} src=${photosOf(l)[0]} />
      <div class="grow"><div class="k">${[t('taking'), kind].filter(Boolean).join(' · ')}</div><h1>${l ? shortLabel(l) : ''}</h1>
        ${terms.from && html`<div class="dates">${fmtDMY(terms.from)}${terms.to ? ' → ' + fmtDMY(terms.to) : ''}</div>`}</div></div>
    ${pays.length > 0 && html`<div class="card pay">${pays.map((p, k) => html`<div class=${'pay-row' + (p.paid ? ' paid' : '')}>
      <span class=${'dt' + (k === nextIdx ? ' next' : '')}>${k === nextIdx ? `${wdShort(p.date)} ${fmtDM(p.date)}` : fmtDM(p.date)}</span>
      <span class="lb">${p.label ?? ''}</span>
      <span class=${'am' + (p.kind === 'refund' ? ' refund' : '')}>${p.kind === 'refund' ? '+' : ''}${money(p.amount, p.currency ?? l?.currency)}</span></div>`)}</div>`}
    <${W2Links} />
    <div class="privacy"><${Icon} n="lock" cls="sm" /><span>${t('privacy')}</span></div>
    <${Nav} tab="today" />
  </main>`;
}

// ---------------------------------------------------------------- brief
const PT_ALL = ['villa', 'house', 'apartment', 'condo', 'townhouse', 'room'];
const PT_BASE = { bali: ['villa', 'house', 'apartment'], th: ['condo', 'house', 'villa'], kz: ['apartment', 'house'] };
const BEDS = ['studio', '1', '2', '3', '4+'];
const BUDGET_SCALE = {
  IDR: { div: 1e6, min: 5, max: 45, step: 1, ru: 'млн IDR', en: 'M IDR' },
  KZT: { div: 1e3, min: 100, max: 1500, step: 10, ru: 'тыс ₸', en: 'k ₸' },
  THB: { div: 1e3, min: 10, max: 200, step: 1, ru: 'тыс ฿', en: 'k ฿' },
  RUB: { div: 1e3, min: 20, max: 500, step: 5, ru: 'тыс ₽', en: 'k ₽' },
  USD: { div: 1, min: 300, max: 10000, step: 50, ru: '$', en: '$' },
  EUR: { div: 1, min: 300, max: 10000, step: 50, ru: '€', en: '€' },
};
function budgetScale(cur, vals = []) {
  const base = BUDGET_SCALE[cur] ?? { div: 1, min: 0, max: 5000, step: 50, ru: cur ?? '', en: cur ?? '' };
  const need = vals.filter((v) => v != null).map((v) => Math.ceil((v / base.div) * 1.15 / base.step) * base.step);
  return { ...base, max: Math.max(base.max, ...need), unit: base[LANG] };
}
const unitNum = (v, sc) => fmtNum(v / sc.div);
const briefCur = (s) => s?.brief?.currency ?? S.regions?.[s?.country]?.currency ?? null;
function packDistricts(s) {
  const reg = S.regions?.[s?.country];
  const sub = reg?.sub?.[String(s?.region).split('/')[1]];
  return Object.entries(sub?.districts ?? {});
}
/** Brief slug → pack slug ('melasti' → 'melasti_pandawa'), else itself. */
function packSlug(slug, s) {
  const ds = packDistricts(s);
  if (ds.some(([k]) => k === slug)) return slug;
  return ds.find(([k]) => k.startsWith(slug + '_') || k.startsWith(slug))?.[0] ?? slug;
}
function districtLabel(slug, s) {
  const k = packSlug(slug, s);
  const nm = packDistricts(s).find(([x]) => x === k)?.[1] ?? S.regions?.[s?.country]?.areas?.[slug]?.name;
  return nm ? nm[LANG] ?? nm.en : human(slug);
}
function bedroomsText(arr) {
  const xs = (arr ?? []).map(String);
  if (!xs.length) return '—';
  const nums = xs.filter((x) => /^\d+$/.test(x)).map(Number).sort((a, b) => a - b);
  const rest = xs.filter((x) => !/^\d+$/.test(x)).map((x) => (x === 'studio' ? t('studio') : x));
  const contiguous = nums.length > 1 && nums.every((n, i) => !i || n === nums[i - 1] + 1);
  const numTxt = contiguous ? `${nums[0]}–${nums[nums.length - 1]}` : nums.join(', ');
  return [rest.includes(t('studio')) ? t('studio') : null, numTxt || null, ...rest.filter((x) => x !== t('studio'))].filter(Boolean).join(', ');
}
function joinNames(names) {
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} ${t('and')} ${names[names.length - 1]}`;
}
function payLabel(x) {
  const m = String(x).match(/^(\d+)\s*months?\s*upfront/i);
  if (x === 'monthly') return t('pay_monthly');
  if (m) return STR[LANG]['pay_' + m[1]] ? t('pay_' + m[1]) : x;
  if (/^12|year/i.test(x)) return t('pay_12');
  return x;
}
function importantLines(b) {
  const out = [b.must_have, b.nice_to_have].filter(Boolean).map((x) => cap(String(x).trim()));
  if (b.living_room === 'closed_ac_required') out.push(t('pref_lr_req'));
  if (b.living_room === 'closed_ac_preferred') out.push(t('pref_lr_pref'));
  if (b.pool === 'private') out.push(t('pref_pool_private'));
  if (b.pool === 'shared_ok') out.push(t('pref_pool_shared'));
  return out.map((x) => x.replace(/[.\s]+$/, '')).join('. ');
}
function noLines(b) {
  const out = [b.deal_breakers ? String(b.deal_breakers).trim().replace(/[.\s]+$/, '') : null];
  if (b.construction_tolerance === 'dealbreaker' && !/стро|constr/i.test(b.deal_breakers ?? '')) out.push(t('pref_construction'));
  return cap(out.filter(Boolean).join(', '));
}
function budgetFact(b, isOwner, sc) {
  if (b.budget_min != null && b.budget_max != null) return `${unitNum(b.budget_min, sc)}–${unitNum(b.budget_max, sc)}`;
  if (b.budget_max != null) return t('up_to', { x: unitNum(b.budget_max, sc) });
  if (isOwner && b.budget_said != null) return t('up_to', { x: unitNum(b.budget_said, sc) });
  return '—';
}
function Brief({ arg }) {
  const d = D();
  const s = d.search;
  const isOwner = d.me.role === 'owner';
  const [allD, setAllD] = useState(false);
  if (arg === 'edit') return isOwner ? html`<${BriefEdit} />` : html`<main class="screen no-nav"><div class="center-msg">—</div></main>`;
  const b = s.brief ?? {};
  const sc = budgetScale(briefCur(s));
  const types = b.property_type ?? [];
  const typeChips = [...types, ...(PT_BASE[s.country] ?? ['apartment', 'house', 'villa']).filter((x) => !types.includes(x))];
  const ds = b.districts ?? [];
  const shownD = allD ? ds : ds.slice(0, 7);
  const term = [termLabel(b.term), ...(b.payment_terms ?? []).map(payLabel)].filter(Boolean).join(' · ');
  const imp = importantLines(b);
  const no = noLines(b);
  const anchor = b.anchor;
  const people = [joinNames(d.members.map((m) => firstName(m.name))), s.created_at ? t('created_on', { d: fmtDayMonth(s.created_at) }) : null].filter(Boolean).join(' · ');
  const sec = (ic, title, body) => html`<div class="b-sec"><div class="b-lbl"><${Icon} n=${ic} cls="sm" />${title}</div>${body}</div>`;
  return html`<main class="brief">
    <div class="brief-hero scene" style=${sceneStyle(s.country)}>
      <button class="hero-btn round sm" aria-label=${t('back')} onClick=${back}><${Icon} n="left" /></button>
      ${isOwner && html`<button class="hero-btn pill" onClick=${() => go(sp('brief', 'edit'))}><${Icon} n="pencil" cls="sm" />${t('change')}</button>`}
    </div>
    <div class="brief-body">
      <h1 class="h1">${s.title}</h1>
      <p class="kicker" style="margin-top:6px">${people}</p>
      <div class="facts3">
        <div class="card"><b>${bedroomsText(b.bedrooms)}</b><span>${t('k_bedrooms')}</span></div>
        <div class="card"><b>${budgetFact(b, isOwner, sc)}</b><span>${sc.unit}${t('k_month')}</span></div>
        <div class="card"><b>${b.move_in ? fmtDM(b.move_in) : '—'}</b><span>${t('k_move_in')}</span></div>
      </div>
      <div class="card b-card">
        ${types.length > 0 && sec('home', t('sec_housing'), html`<div class="chips">${typeChips.map((x) => html`<span class=${'bchip' + (types.includes(x) ? ' on' : '')}>${STR[LANG]['pt_' + x] ? t('pt_' + x) : x}</span>`)}</div>`)}
        ${ds.length > 0 && sec('pin', `${t('sec_districts')} · ${ds.length}`, html`<div class="chips">${shownD.map((x) => html`<span class="bchip on">${districtLabel(x, s)}</span>`)}
          ${!allD && ds.length > 7 && html`<button class="bchip" onClick=${() => setAllD(true)}>${t('more_n', { n: ds.length - 7 })}</button>`}</div>`)}
        ${term && sec('cal', t('sec_term'), html`<p>${cap(term)}</p>`)}
        ${imp && sec('sofa', t('sec_important'), html`<p>${imp}</p>`)}
        ${no && sec('ban', t('sec_no'), html`<p>${no}</p>`)}
        ${(anchor || b.anchor_text) && sec(anchor?.icon && ICONS[anchor.icon] ? anchor.icon : 'waves', t('sec_near'), html`<p><b>${anchor?.label ?? b.anchor_text}</b>${anchor?.max_minutes ? html`<span class="muted"> · ${t('near_min', { n: anchor.max_minutes, mode: travelMode() })}</span>` : null}</p>`)}
      </div>
      ${isOwner && b.budget_said != null && html`<div class="said"><${Icon} n="lock" cls="sm" /><div><b>${t('said_title', { x: money(b.budget_said, briefCur(s)) })}</b><span>${t('said_text')}</span></div></div>`}
    </div>
  </main>`;
}

function DualRange({ lo, hi, min, max, step, onLo, onHi }) {
  const pct = (v) => ((v - min) / Math.max(1, max - min)) * 100;
  return html`<div class="dual">
    <div class="track"></div><div class="fill" style=${`left:${pct(lo)}%;right:${100 - pct(hi)}%`}></div>
    <input type="range" min=${min} max=${max} step=${step} value=${lo} aria-label="min" onInput=${(e) => onLo(Math.min(Number(e.currentTarget.value), hi))} />
    <input type="range" min=${min} max=${max} step=${step} value=${hi} aria-label="max" onInput=${(e) => onHi(Math.max(Number(e.currentTarget.value), lo))} />
  </div>`;
}
function BriefEdit() {
  const d = D();
  const s = d.search;
  const b0 = s.brief ?? {};
  const cur = briefCur(s);
  const sc = budgetScale(cur, [b0.budget_min, b0.budget_max, b0.budget_said]);
  const toU = (v) => Math.round(v / sc.div / sc.step) * sc.step;
  const said0 = b0.budget_said != null ? b0.budget_said / sc.div : null;
  const [beds, setBeds] = useState(() => new Set((b0.bedrooms ?? []).map(String)));
  const [lo, setLo] = useState(() => (b0.budget_min != null ? toU(b0.budget_min) : said0 != null ? Math.max(sc.min, toU(b0.budget_said * 0.87)) : sc.min));
  const [hi, setHi] = useState(() => (b0.budget_max != null ? toU(b0.budget_max) : said0 != null ? Math.min(sc.max, toU(b0.budget_said * 1.3)) : Math.round((sc.min + sc.max) / 2)));
  const [touched, setTouched] = useState(false);
  const [said, setSaid] = useState(said0 != null ? String(+said0.toFixed(2)) : '');
  const [editSaid, setEditSaid] = useState(false);
  const [ds, setDs] = useState(() => new Set((b0.districts ?? []).map((x) => packSlug(x, s))));
  const [moveIn, setMoveIn] = useState(b0.move_in ?? '');
  const [term, setTerm] = useState(b0.term ?? '');
  const [types, setTypes] = useState(() => new Set(b0.property_type ?? []));
  const [must, setMust] = useState(b0.must_have ?? '');
  const [no, setNo] = useState(b0.deal_breakers ?? '');
  const [busy, setBusy] = useState(false);
  const flip = (set, setter, k) => { hap.sel(); const n = new Set(set); n.has(k) ? n.delete(k) : n.add(k); setter(n); };
  const allDistricts = packDistricts(s);
  const extraD = [...ds].filter((k) => !allDistricts.some(([x]) => x === k)).map((k) => [k, { [LANG]: human(k) }]);
  const ptList = [...new Set([...(PT_BASE[s.country] ?? []), ...PT_ALL])];
  async function save() {
    const patch = {};
    const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    const arr = (set, order) => { const xs = [...set]; return order ? xs.sort((a, b) => order.indexOf(a) - order.indexOf(b)) : xs; };
    const nb = arr(beds, BEDS);
    if (!same(nb.length ? nb : null, b0.bedrooms?.length ? b0.bedrooms.map(String) : null)) patch.bedrooms = nb;
    if (touched || b0.budget_min != null) { const v = Math.round(lo * sc.div); if (v !== b0.budget_min) patch.budget_min = v; }
    if (touched || b0.budget_max != null) { const v = Math.round(hi * sc.div); if (v !== b0.budget_max) patch.budget_max = v; }
    const sv = said.trim() === '' ? null : Math.round(Number(said.replace(',', '.')) * sc.div);
    if (sv != null && !Number.isFinite(sv)) return toast(t('err_generic'));
    if (sv !== (b0.budget_said ?? null)) patch.budget_said = sv;
    const nd = [...ds];
    const od = (b0.districts ?? []);
    if (nd.length !== od.length || nd.some((x) => !od.includes(x))) patch.districts = nd;
    if ((moveIn || null) !== (b0.move_in ?? null)) patch.move_in = moveIn || null;
    if ((term || null) !== (b0.term ?? null)) patch.term = term || null;
    const nt = arr(types, PT_ALL);
    if (!same(nt.length ? nt : null, b0.property_type?.length ? b0.property_type : null)) patch.property_type = nt;
    if ((must.trim() || null) !== (b0.must_have ?? null)) patch.must_have = must.trim() || null;
    if ((no.trim() || null) !== (b0.deal_breakers ?? null)) patch.deal_breakers = no.trim() || null;
    if (!Object.keys(patch).length) { toast(t('unchanged')); back(); return; }
    setBusy(true);
    try {
      const r = await api('/app/api/brief', { search_id: s.id, brief: patch }, 'PATCH');
      if (r.brief) {
        s.brief = r.brief;
        const sum = d.searches.find((x) => x.id === s.id);
        if (sum) sum.brief = r.brief;
      }
      hap.ok();
      toast(t('brief_saved'));
      back();
      refresh();
    } catch { toast(t('err_generic')); }
    setBusy(false);
  }
  const lbl = (k, vars) => html`<p class="e-lbl">${t(k, vars)}</p>`;
  return html`<main class="screen no-nav brief-edit">
    <div class="e-top"><button class="btn ghost" onClick=${back}>${t('cancel')}</button><b>${t('brief')}</b><button class="btn link" disabled=${busy} onClick=${save}>${t('done')}</button></div>
    ${lbl('e_bedrooms')}
    <div class="beds" role="group">${BEDS.map((k) => html`<button aria-pressed=${beds.has(k) ? 'true' : 'false'} onClick=${() => flip(beds, setBeds, k)}>${k === 'studio' ? t('studio') : k}</button>`)}</div>
    ${lbl('e_budget', { unit: sc.unit })}
    <div class="card budget">
      <div class="nums"><b>${fmtNum(lo)}</b><b>${fmtNum(hi)}</b></div>
      <${DualRange} lo=${lo} hi=${hi} min=${sc.min} max=${sc.max} step=${sc.step} onLo=${(v) => { setTouched(true); setLo(v); }} onHi=${(v) => { setTouched(true); setHi(v); }} />
      <div class="said-row"><${Icon} n="lock" cls="sm" />
        ${editSaid ? html`<input class="said-in" inputmode="decimal" value=${said} aria-label=${t('e_said', { x: '' })} onInput=${(e) => setSaid(e.currentTarget.value)} onBlur=${() => setEditSaid(false)} ref=${(el) => el && !el.dataset.f && (el.dataset.f = 1, el.focus())} />`
          : html`<span class="grow">${said.trim() ? t('e_said', { x: said }) : t('e_said_none')}</span>`}
        <button class="icon-btn sm" aria-label=${t('edit_text')} onClick=${() => setEditSaid(!editSaid)}><${Icon} n="pencil" cls="sm" /></button></div>
    </div>
    ${(allDistricts.length > 0 || extraD.length > 0) && html`${lbl('e_districts')}
      <div class="chips">${[...allDistricts, ...extraD].map(([k, nm]) => html`<button class=${'bchip' + (ds.has(k) ? ' on' : ' off')} aria-pressed=${ds.has(k) ? 'true' : 'false'} onClick=${() => flip(ds, setDs, k)}>${nm[LANG] ?? nm.en}</button>`)}</div>
      <p class="e-note">${t('e_note')}</p>`}
    ${lbl('e_move_in')}
    <input class="e-input" type="date" value=${moveIn} onInput=${(e) => setMoveIn(e.currentTarget.value)} />
    ${lbl('e_term')}
    <div class="chips">${Object.keys(TERMS).map((k) => html`<button class=${'bchip' + (term === k ? ' on' : ' off')} aria-pressed=${term === k ? 'true' : 'false'} onClick=${() => { hap.sel(); setTerm(term === k ? '' : k); }}>${termLabel(k)}</button>`)}</div>
    ${lbl('e_types')}
    <div class="chips">${ptList.map((k) => html`<button class=${'bchip' + (types.has(k) ? ' on' : ' off')} aria-pressed=${types.has(k) ? 'true' : 'false'} onClick=${() => flip(types, setTypes, k)}>${t('pt_' + k)}</button>`)}</div>
    ${lbl('e_must')}
    <textarea class="e-input" rows="3" placeholder=${t('e_must_ph')} value=${must} onInput=${(e) => setMust(e.currentTarget.value)}></textarea>
    ${lbl('e_no')}
    <textarea class="e-input" rows="2" placeholder=${t('e_no_ph')} value=${no} onInput=${(e) => setNo(e.currentTarget.value)}></textarea>
  </main>`;
}

// ---------------------------------------------------------------- chats
const CH_ORDER = ['telegram', 'whatsapp', 'viber', 'line', 'messenger', 'instagram', 'email', 'phone'];
const CH_ICON = { telegram: 'send', whatsapp: 'msg', messenger: 'msgs', instagram: 'insta', email: 'mail', phone: 'phone', viber: 'phone', line: 'msg' };
const ST_ORDER = { waiting_us: 0, waiting_them: 1, closed: 2 };
function channelsOf(cid) {
  return (D()?.channels ?? []).filter((c) => c.contact_id === cid).sort((a, b) => (CH_ORDER.indexOf(a.channel) + 99) % 99 - (CH_ORDER.indexOf(b.channel) + 99) % 99);
}
function channelLink(ch, addr) {
  const a = String(addr ?? '').trim();
  if (!a) return null;
  if (ch === 'whatsapp') { const n = a.replace(/\D/g, ''); return n ? `https://wa.me/${n}` : null; }
  if (ch === 'telegram') { const u = a.replace(/^@/, ''); return /^\d+$/.test(u) ? `tg://user?id=${u}` : `https://t.me/${u}`; }
  if (ch === 'messenger') return `https://www.facebook.com/messages/t/${encodeURIComponent(a)}`;
  if (ch === 'instagram') return `https://ig.me/m/${a.replace(/^@/, '')}`;
  if (ch === 'viber') { const n = a.replace(/\D/g, ''); return n ? `viber://chat?number=%2B${n}` : null; }
  if (ch === 'line') return a.startsWith('@') ? `https://line.me/R/ti/p/${encodeURIComponent(a)}` : /line\.me\//i.test(a) ? a : `https://line.me/R/ti/p/~${encodeURIComponent(a)}`;
  if (ch === 'email') return `mailto:${a}`;
  if (ch === 'phone') return `tel:${a.replace(/[^\d+]/g, '')}`;
  return null;
}
function fmtAddr(ch, a) {
  if (!['whatsapp', 'viber', 'phone'].includes(ch)) return a;
  const n = String(a).replace(/\D/g, '');
  if (n.startsWith('62') && n.length >= 10) return `+62 ${n.slice(2, 5)}-${n.slice(5, 9)}-${n.slice(9)}`;
  if (n.startsWith('7') && n.length === 11) return `+7 ${n.slice(1, 4)} ${n.slice(4, 7)}-${n.slice(7, 9)}-${n.slice(9)}`;
  if (n.startsWith('66') && n.length >= 10) return `+66 ${n.slice(2, 4)} ${n.slice(4, 7)} ${n.slice(7)}`;
  return a;
}
const roleLabel = (r) => (!r ? null : STR[LANG]['role_' + r] ? t('role_' + r) : r);
function contactName(th) {
  const ch = channelsOf(th.contact_id)[0];
  return th.contact_name || ch?.display || (ch ? fmtAddr(ch.channel, ch.address) : '?');
}
function sortedThreads() {
  return [...(D()?.threads ?? [])].sort((a, b) => (ST_ORDER[a.state] ?? 3) - (ST_ORDER[b.state] ?? 3) || String(b.last_at ?? '').localeCompare(String(a.last_at ?? '')));
}
/** Wave 8.3 (design/mockup-v8): once the home is chosen, chats about other homes are the search archive, read only. The home's
 * chats stay: the chosen home, house contacts, and everyone not tied to a listing (suppliers, bikes, couriers). */
function thArchived(th) {
  if (!th?.listing_id || !homeMode()) return false;
  const hl = homeListing();
  return !!hl && th.listing_id !== hl.id && !(D().house_contacts ?? []).some((c) => c.contact_id === th.contact_id);
}
/** The archive list or an archived chat is open (route arg). */
const chArchRoute = (arg) => arg === 'archive' || thArchived((D()?.threads ?? []).find((x) => x.contact_id === arg));
const homeThreads = () => sortedThreads().filter((x) => !thArchived(x));
const archThreads = () => sortedThreads().filter(thArchived);
/** An archived home that wrote after the move: the agent marks it waiting_us; it never counts as "waiting for you". */
const archNew = () => archThreads().filter((x) => x.state === 'waiting_us').length;
const HC_ROLE_IC = { owner: 'key-round', manager: 'key-round', cleaning: 'sparkles', pool: 'waves', repair: 'wrench', security: 'lock', internet: 'wifi', garden: 'house', other: 'house' };
/** A home chat row: {title, sub, icon, photo}. House contacts read as their role ("Бассейн"), the home's own chat as the owner. */
function homeRow(th) {
  const hc = (D().house_contacts ?? []).find((c) => c.contact_id === th.contact_id);
  const ch = channelName(channelsOf(th.contact_id)[0]?.channel);
  const l = listingById(th.listing_id);
  if (hc) return { title: cap(t('hc_' + hc.role)), sub: [firstName(hc.name || contactName(th)), ch].filter(Boolean).join(', '), icon: HC_ROLE_IC[hc.role] ?? 'house' };
  if (l) return { title: cap(roleLabel(th.contact_role) ?? t('role_owner')), sub: [firstName(contactName(th)), ch].filter(Boolean).join(', '), photo: photosOf(l)[0] };
  return { title: contactName(th), sub: [roleLabel(th.contact_role), ch].filter(Boolean).join(', '), icon: 'msg' };
}
const waitingUs = () => homeThreads().filter((x) => x.state === 'waiting_us').length;
const threadsForListing = (lid) => sortedThreads().filter((x) => x.listing_id === lid);
function threadSub(th) {
  const l = listingById(th.listing_id);
  if (!l) return '';
  return [shortLabel(l), l.decision === 'take' ? t('d_take') : priceText(l)].filter(Boolean).join(' · ');
}
function ThreadThumb({ th }) {
  const l = listingById(th.listing_id);
  const ch = channelsOf(th.contact_id)[0]?.channel;
  const ph = photosOf(l)[0];
  return html`<span class="th-thumb">${ph ? html`<img src=${ph} alt="" loading="lazy" decoding="async" />` : html`<span class="letter">${initial(contactName(th))}</span>`}
    ${ch && html`<span class=${'ch-badge ch-' + ch}><${Icon} n=${CH_ICON[ch] ?? 'msg'} /></span>`}</span>`;
}
function ThreadCard({ th }) {
  // V4-11: a hairline row — name + channel, a status pill on the right, the last message under it
  const ch = channelsOf(th.contact_id)[0]?.channel;
  return html`<button class="th-card th8" onClick=${() => { hap.sel(); go(sp('chats', th.contact_id)); }}>
    <div class="row th-hd"><b class="ellipsis">${contactName(th)}</b>${ch && html`<span class="th8-ch">${CHANNEL[ch] ?? ch}</span>`}<span class="grow"></span><span class=${'st-chip s-' + th.state}>${t('st_' + th.state)}</span></div>
    ${threadSub(th) && html`<div class="th-sub ellipsis">${[threadSub(th), th.last_at ? agoLabel(th.last_at) : null].filter(Boolean).join(' · ')}</div>`}
    ${th.last && html`<div class="th-last">${th.last}</div>`}
  </button>`;
}
function Chats({ arg }) {
  const d = D();
  const all = sortedThreads();
  const nUs = all.filter((x) => x.state === 'waiting_us').length;
  const nThem = all.filter((x) => x.state === 'waiting_them').length;
  const [f, setF] = useState(nUs ? 'waiting_us' : 'all');
  if (arg && arg !== 'archive') return html`<${ChatDetail} cid=${arg} />`;
  if (homeMode()) return html`<${HomeChats} arch=${arg === 'archive'} />`;
  const list = f === 'all' ? all : all.filter((x) => x.state === f);
  return html`<main class="screen ch8">
    <div class="head"><div><p class="kicker">${[shortTitle(d.search.title), t('n_convs', { n: all.length })].join(' · ')}</p><h1 class="sr">${t('chats')}</h1><${Typed} lines=${[t('w8_who_wrote')]} /></div></div>
    ${all.length ? html`<div class="filters" role="toolbar">
        <button class="filter" aria-pressed=${f === 'waiting_us' ? 'true' : 'false'} onClick=${() => { hap.sel(); setF('waiting_us'); }}>${t('f_waiting_us')} <b>${nUs}</b></button>
        <button class="filter" aria-pressed=${f === 'waiting_them' ? 'true' : 'false'} onClick=${() => { hap.sel(); setF('waiting_them'); }}>${t('f_waiting_them')} <b>${nThem}</b></button>
        <button class="filter" aria-pressed=${f === 'all' ? 'true' : 'false'} onClick=${() => { hap.sel(); setF('all'); }}>${t('f_all_chats')}</button>
      </div>
      <div class="th8-list">${list.map((th) => html`<${ThreadCard} key=${th.contact_id} th=${th} />`)}</div>
      ${!list.length && html`<p class="empty-note">—</p>`}`
    : html`<div class="card" style="padding:18px"><p class="muted" style="margin:0">${t('no_threads')}</p></div>`}
    <${Nav} tab="today" />
  </main>`;
}
/** Wave 8.3 (design/mockup-v8): once the home is chosen, the list is the home (waiting first) + one row into the search archive. */
function HomeRow({ th, arch }) {
  const r = arch ? null : homeRow(th), l = listingById(th.listing_id), ph = r ? r.photo : photosOf(l)[0];
  const sub = r ? r.sub : [firstName(contactName(th)), channelName(channelsOf(th.contact_id)[0]?.channel)].filter(Boolean).join(', ');
  return html`<button class="hc8-row" onClick=${() => { hap.sel(); go(sp('chats', th.contact_id)); }}>
    ${ph ? html`<img class="hc8-ph" src=${ph} alt="" loading="lazy" decoding="async" />` : html`<span class="hc8-ic"><${Icon} n=${r?.icon ?? 'msg'} /></span>`}
    <span class="grow"><b class="ellipsis">${r ? r.title : shortTitle(l?.title) || contactName(th)}</b><span class="ellipsis">${th.state === 'waiting_us' && th.last ? th.last : sub}</span></span>
    <span class="hc8-end">${th.last_at && html`<time>${agoLabel(th.last_at)}</time>`}${arch && l?.price ? html`<b>${priceText(l)}</b>` : null}</span></button>`;
}
function HomeChats({ arch }) {
  const d = D(), dr = new Set((d.drafts ?? []).map((x) => x.contact_id));
  const wait = (th) => th.state === 'waiting_us' || dr.has(th.contact_id);
  const groups = arch
    ? [[t('ch_arch_wrote'), archThreads().filter(wait)], [t('ch_arch_no'), archThreads().filter((x) => !wait(x) && x.state !== 'waiting_them')], [t('ch_arch_quiet'), archThreads().filter((x) => !wait(x) && x.state === 'waiting_them')]]
    : [[t('ch_wait'), homeThreads().filter(wait)], [t('ch_home'), homeThreads().filter((x) => !wait(x))]];
  const nArch = arch ? 0 : archThreads().length, nNew = nArch ? archNew() : 0;
  return html`<main class="screen no-nav ch8 hc8">
    <div class="head"><button class="round sm" aria-label=${t('back')} onClick=${() => (arch ? go(sp('chats'), true) : back())}><${Icon} n="left" /></button>
      <div class="grow"><h1 class="sr">${arch ? t('ch_arch') : t('chats')}</h1><${Typed} key=${arch ? 'a' : 'h'} lines=${[arch ? t('ch_arch') : t('w8_who_wrote')]} /></div></div>
    ${arch && html`<p class="hc8-note">${t('ch_arch_note')}</p>`}
    ${groups.filter(([, x]) => x.length).map(([g, list]) => html`<section key=${g}><h3 class="hc8-cap">${g} <i>${list.length}</i></h3>${list.map((th) => html`<${HomeRow} key=${th.contact_id} th=${th} arch=${arch} />`)}</section>`)}
    ${groups.every(([, x]) => !x.length) && html`<p class="empty-note">${arch ? t('ch_arch_empty') : t('no_threads')}</p>`}
    ${nArch > 0 && html`<button class="hc8-row hc8-arch" onClick=${() => { hap.sel(); go(sp('chats', 'archive')); }}><span class="hc8-ic"><${Icon} n="archive" /></span>
      <span class="grow"><b>${t('ch_arch')}</b><span>${t('ch_arch_sub', { n: nArch })}</span></span>${nNew > 0 && html`<span class="hc8-new">${t('ch_arch_new', { n: nNew })}</span>`}</button>`}
  </main>`;
}
function ChatDetail({ cid }) {
  const d = D();
  const th = (d.threads ?? []).find((x) => x.contact_id === cid);
  const draft = (d.drafts ?? []).find((x) => x.contact_id === cid);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  useEffect(() => { setEditing(false); setText(draft?.text ?? ''); setMore(false); }, [draft?.id]);
  if (draft && d.me.role === 'owner' && !more) return html`<${DraftScreen} draft=${draft} th=${th} onMore=${() => { if (th) setMore(true); else back(); }} />`;
  if (!th) return html`<main class="screen no-nav"><div class="center-msg">—</div></main>`;
  const chs = channelsOf(cid);
  const main = chs[0];
  const l = listingById(th.listing_id);
  const sub = [main ? channelName(main.channel) : null, roleLabel(th.contact_role), l ? shortLabel(l) : null].filter(Boolean).join(' · ');
  const upd = th.updated_at ? (dayKey(th.updated_at) === dayKey(new Date().toISOString()) ? t('at_time', { t: fmtTime(th.updated_at) }) : agoLabel(th.updated_at)) : null;
  const others = [
    ...chs.slice(1).map((c) => ({ c, who: null })),
    ...(d.listing_contacts ?? []).filter((x) => x.listing_id === th.listing_id && x.contact_id !== cid)
      .flatMap((x) => channelsOf(x.contact_id).map((c) => ({ c, who: firstName(x.name ?? '') }))),
  ];
  async function act(action) {
    setBusy(true);
    try {
      await api('/app/api/draft', { draft_id: draft.id, action, text: action === 'send' && editing ? text : undefined });
      action === 'send' ? hap.ok() : hap.sel();
      toast(t(action === 'send' ? 'approved_toast' : 'skipped_toast'));
      d.drafts = d.drafts.filter((x) => x.id !== draft.id);
      emit();
      refresh();
    } catch (e) { toast(e.code === 'already_decided' ? t('approve_done') : t('err_generic')); }
    setBusy(false);
  }
  const blk = (ic, cls, title, body) => body && html`<div class="b-sec"><div class=${'b-lbl ' + cls}><${Icon} n=${ic} cls="sm" />${title}</div><p>${body}</p></div>`;
  const arch = thArchived(th), link = main && !arch ? channelLink(main.channel, main.address) : null;
  return html`<main class="screen no-nav chat">
    <div class="chat-head"><button class="round sm" aria-label=${t('back')} onClick=${back}><${Icon} n="left" /></button>
      <button class="grow chat-who" onClick=${() => go(sp('contact', cid))}><h1 class="h1 ellipsis">${contactName(th)}</h1>${sub && html`<p class="kicker ellipsis">${sub}</p>`}</button>
      <button class="round sm" aria-label=${t('pn_person')} onClick=${() => go(sp('contact', cid))}><${Icon} n="users" /></button></div>
    <div class="row" style="margin:4px 0 14px;flex-wrap:wrap;gap:8px">${arch && html`<span class="hc8-tag"><${Icon} n="archive" cls="xs" />${t('ch_arch_tag')}</span>`}<span class=${'st-chip big s-' + th.state}>${t('stl_' + th.state)}</span>${upd && html`<span class="muted" style="font-size:13px">${t('updated_by_agent', { when: upd })}</span>`}</div>
    <div class="card b-card">
      ${blk('circlecheck', 'ok', t('known'), th.known)}
      ${blk('help', 'q', t('open_q'), th.open)}
      ${blk('msg', '', t('last_msg'), th.last ? `${th.last}${th.last_at ? ' · ' + agoLabel(th.last_at) : ''}` : null)}
      ${!th.known && !th.open && !th.last && html`<div class="b-sec"><p class="muted">—</p></div>`}
    </div>
    ${draft && d.me.role === 'owner' && html`<div class="card draft-card">
      <div class="b-lbl acc"><${Icon} n="sparkles" cls="sm" />${t('agent_draft')}</div>
      ${editing ? html`<textarea class="edit-area" aria-label=${t('edit_text')} value=${text} onInput=${(e) => setText(e.currentTarget.value)}></textarea>`
        : html`<div class="bubble out">${draft.text}</div>`}
      <div class="row" style="margin-top:12px">
        <button class="btn accent grow" disabled=${busy || (editing && !text.trim())} onClick=${() => act('send')}><${Icon} n="send" cls="sm" />${t('send')}</button>
        <button class="round sm soft" aria-label=${t('edit_text')} aria-pressed=${editing} onClick=${() => setEditing(!editing)}><${Icon} n="pencil" cls="sm" /></button>
        <button class="round sm soft" aria-label=${t('dont_send')} disabled=${busy} onClick=${() => act('skip')}><${Icon} n="x" cls="sm" /></button>
      </div></div>`}
    <div class="chat-foot">
      ${arch && html`<p class="hc8-lock"><${Icon} n="lock" cls="sm" />${t('ch_locked')}</p>`}
      ${link && html`<button class="btn surface block big" onClick=${() => openLink(link)}><${Icon} n=${CH_ICON[main.channel] ?? 'msg'} cls="sm" />${t('open_in', { ch: channelName(main.channel) })}<${Icon} n="ext" cls="sm muted" /></button>`}
      ${others.length > 0 && html`<p class="also">${t('more_contacts')} ${others.map(({ c, who }, i) => html`${i ? ', ' : ''}<button class="lnk" onClick=${() => openLink(channelLink(c.channel, c.address))}>${[channelName(c.channel), who].filter(Boolean).join(' ')} · ${fmtAddr(c.channel, c.address)}</button>`)}</p>`}
    </div>
  </main>`;
}

// ---------------------------------------------------------------- wave 2: shared helpers
const dealListing = () => (D()?.deal ? listingById(D().deal.listing_id) : null);
/** Wave 8.1: the home's short name: listings.short_name (agent / owner), the deal's name, else "Дом в Унгасане" / "Дом" (never the
 * long listing title, which reads like an ad: "3 спальни, …"). */
function homeName() {
  const d = D();
  const l = homeListing();
  const sn = String(l?.short_name ?? '').trim();
  if (sn) return sn;
  if (d?.deal?.data?.name) return d.deal.data.name;
  const dn = l ? districtShort(l) : '';
  return dn ? t('w81_home_dn', { p: inPlace(dn) }) : t('w81_home');
}
const isLiving = () => D()?.search?.status === 'living';
const regionPack = () => S.regions?.[D()?.search?.country] ?? null;
/** Amount in the scale of `ref` without a unit: 34 800 000 next to 69,6 млн → "34,8". */
function scaled(n, ref) {
  const r = Math.abs(ref ?? n);
  return fmtNum(r >= 1e6 ? n / 1e6 : r >= 1e4 ? n / 1e3 : n);
}
function BackIfWeb() {
  return !inTG ? html`<button class="round w2-back" aria-label=${t('back')} onClick=${back}><${Icon} n="arrow-left" /></button>` : null;
}
function W2Head({ l, kicker, kickerCls = '', title, sub, right = null }) {
  const ph = photosOf(l)[0];
  return html`<div class="w2-head w8-head">
    ${(!inTG || l !== undefined) && html`<div class="row w8-head-top"><${BackIfWeb} /><span class="grow"></span>${right}${l !== undefined && html`<span class="frame sm w8-thumb"><span class="in">${ph ? html`<img src=${ph} alt="" loading="lazy" />` : null}</span></span>`}</div>`}
    <div>${kicker && html`<p class=${'kicker ' + kickerCls}>${kicker}</p>`}<h1 class="h1">${title}</h1>${sub && html`<p class="w2-sub">${sub}</p>`}</div>
  </div>`;
}
async function postInstruction(text, kind, ref) {
  await api('/app/api/instruction', { search_id: D().search.id, text, kind, ref });
}
/** Upload an image file to an endpoint that takes a raw image/* body. */
async function uploadImage(url, file) {
  const r = await fetch(url, { method: 'POST', headers: { ...authHeaders(), 'content-type': file.type || 'image/jpeg' }, body: file });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || String(r.status));
  return j;
}
function pickFiles({ multiple = false, capture = false } = {}) {
  return new Promise((res) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = 'image/*';
    if (multiple) i.multiple = true;
    if (capture) i.setAttribute('capture', 'environment');
    i.onchange = () => res([...(i.files ?? [])]);
    i.click();
  });
}

// ---------------------------------------------------------------- scam check (16)
const SIG_ICON = { ok: 'circle-check', warn: 'circle-help', todo: 'circle-dashed' };
function checkCount(c) { return (c?.signals ?? []).filter((x) => x.status === 'warn').length; }
function CheckBanner({ c, onClick }) {
  if (!c) return null;
  const n = checkCount(c);
  const v = c.verdict;
  const title = v === 'ok' ? t('ck_ok') : t(v === 'danger' ? 'ck_danger' : 'ck_caution', { n: Math.max(1, n) });
  const sub = c.advice || t('ck_' + v + '_sub');
  const Tag = onClick ? 'button' : 'div';
  return html`<${Tag} class=${'w2-banner v-' + v} onClick=${onClick}>
    <${Icon} n=${v === 'ok' ? 'circle-check' : 'shield-alert'} /><div class="grow"><b>${title}</b><span>${sub}</span></div>${onClick && html`<${Icon} n="chev" cls="sm muted" />`}</${Tag}>`;
}
function CheckScreen({ id }) {
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

// ---------------------------------------------------------------- money (17)
const XK_ICON = { rent: 'key-round', deposit: 'key-round', power: 'zap', water: 'droplets', internet: 'wifi', cleaning: 'sparkles', pool: 'waves', repair: 'wrench', food: 'utensils', transport: 'car', other: 'receipt-text' };
const XKINDS = ['rent', 'deposit', 'power', 'cleaning', 'pool', 'water', 'internet', 'repair', 'food', 'transport', 'other'];
function splitLabel(e, m) {
  const voters = d2voters();
  const w = e.split;
  if (!w && m.rent_weights) return e.kind === 'rent' ? t('w3_split_sub') : m.rooms?.others_equal === false ? t('split_shares') : voters.length === 2 ? t('split_half') : t('split_equal');
  if (!w) {
    const vals = Object.values(m.shares ?? {});
    const equal = vals.every((x) => x === vals[0]);
    return equal ? (vals.length === 2 ? t('split_half') : t('split_equal')) : t('split_shares');
  }
  const keys = Object.keys(w);
  if (keys.length === 1 && keys[0] === e.paid_by) return t('split_self');
  if (keys.length < voters.length) return t('split_custom');
  const vals = Object.values(w);
  return vals.every((x) => x === vals[0]) ? (vals.length === 2 ? t('split_half') : t('split_equal')) : t('split_shares');
}
const d2voters = () => (D()?.members ?? []).filter((m) => canVoteRole(m.role)).map((m) => m.user_id);
/**
 * Wave 8.1: payments already made under the deal (deal dates of kind payment, done, with an amount). The deposit part (deal terms
 * deposit; a payment that says "залог / депозит" or covers rent + deposit) is held by the landlord: not spending, it comes back
 * on the deposit_return date. The rest is rent, spent for its period (the k-th rent payment covers month k from the move-in).
 * Skipped when an expense of the same kind and amount within a week already records it.
 */
function dealPaid(expenses, cur) {
  const d = D();
  const terms = d.deal?.data?.terms ?? {};
  const dep0 = Number(terms.deposit) || 0, rent0 = Number(terms.rent) || 0;
  const back = (d.dates ?? []).filter((x) => x.kind === 'deposit_return' && !x.done).sort((a, b) => a.date.localeCompare(b.date))[0]?.date ?? terms.to ?? null;
  const near = (kind, amt, day) => expenses.some((e) => e.kind === kind && Math.abs(Number(e.amount) - amt) <= Math.max(1, amt * 0.02) && Math.abs(Date.parse(String(e.date).slice(0, 10)) - Date.parse(day)) <= 7 * 864e5);
  const addMonths = (day, n) => { const x = new Date(day + 'T12:00:00Z'); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
  const out = { rent: [], deposit: null };
  let depLeft = dep0, k = 0;
  const pays = (d.dates ?? []).filter((x) => x.kind === 'payment' && x.done && Number(x.amount) > 0 && (!x.currency || !cur || x.currency === cur)).sort((a, b) => a.date.localeCompare(b.date));
  for (const x of pays) {
    const amt = Number(x.amount);
    if (near('rent', amt, x.date) || near('deposit', amt, x.date) || near('other', amt, x.date)) { k++; continue; } // already an expense as a whole
    const says = /залог|депозит|deposit/i.test(`${x.title ?? ''} ${x.note ?? ''}`);
    const dep = depLeft > 0 && (says || (rent0 && amt >= rent0 + depLeft)) ? Math.min(depLeft, amt) : 0;
    depLeft -= dep;
    const rent = amt - dep;
    if (dep > 0 && !near('deposit', dep, x.date)) out.deposit = { amount: (out.deposit?.amount ?? 0) + dep, currency: x.currency ?? cur, date: x.date, back };
    if (rent > 0) {
      const from = terms.from ? addMonths(terms.from, k) : null;
      const to = terms.from ? addMonths(terms.from, k + 1) : null;
      k++;
      if (!near('rent', rent, x.date)) out.rent.push({ id: `deal-${x.date}-${k}`, kind: 'rent', amount: rent, currency: x.currency ?? cur, date: x.date, title: x.title, deal: true, from, to });
    }
  }
  return out;
}
/** The deal payments as hairline rows: rent for its period, the deposit with the landlord (back on …). */
function DealPaidList({ paid, cur }) {
  if (!paid.rent.length && !paid.deposit) return null;
  return html`<div class="card w2-list ms81-paid">
    <div class="w2-lh"><span>${t('w81_m_paid')}</span></div>
    ${paid.rent.map((r) => html`<button key=${r.id} class="w2-row x-row" onClick=${() => go(sp('deal'))}><span class="sq"><${Icon} n="home" /></span>
      <div class="grow"><b>${t('w81_m_rent')}${r.from ? ` · ${fmtDM(r.from)}–${fmtDM(r.to)}` : ''}</b><span>${[fmtDM(r.date), r.title].filter(Boolean).join(' · ')}</span></div>
      <div class="x-r"><b>${money(r.amount, r.currency ?? cur)}</b></div></button>`)}
    ${paid.deposit && html`<button class="w2-row x-row ms81-dep" onClick=${() => go(sp('deal'))}><span class="sq"><${Icon} n="key-round" /></span>
      <div class="grow"><b>${t('w81_m_deposit')}${paid.deposit.back ? ` · ${t('w81_m_dep_back', { d: fmtDM(paid.deposit.back) })}` : ''}</b><span>${t('w81_m_dep_note')}</span></div>
      <div class="x-r"><b>${money(paid.deposit.amount, paid.deposit.currency ?? cur)}</b></div></button>`}
  </div>`;
}
/** Wave 8.1: a brand-new project's money screen: what will appear here (ghost rows), a sticker, the "Добавить трату" pill. */
function MoneyEmpty({ canEdit }) {
  const d = D();
  const me = memberById(d.user.id);
  const ghost = [['rent', 92], ['power', 34], ['transport', 22], ['cleaning', 14]];
  return html`<section class="w8-hero ms81-empty">
    <${BigWord} text=${t('money')} />
    <p class="ms-k">${t('w81_m_empty_k')}</p>
    <div class="ms81-e-stage">
      <${Sticker} text=${t('w81_m_soon')} cls="lg" style="right:6%;top:4px;--r:-12deg" />
      ${me && html`<span class="ani" style="left:2%;top:18px;--r:-8deg"><${Av} m=${me} size=${58} free /></span>`}
    </div>
    <${Typed} lines=${[t('w81_m_empty')]} />
    <p class="w8-sub">${t('w81_m_empty_sub')}</p>
    <div class="ms8-rows ms81-ghost" aria-hidden="true">${ghost.map(([k, w]) => html`<div key=${k} class="ms8-row"><span class="n">${t('xk_' + k)}</span><span class="bar"><i style=${`width:${w}%`}></i></span><b>${t('w81_m_soon')}</b></div>`)}</div>
    ${canEdit && html`<button class="btn accent block big ms8-add" onClick=${() => { hap.sel(); openSheet('add_expense'); }}><${Icon} n="plus" />${t('w81_m_add')}</button>`}
  </section>`;
}
function Money() {
  const d = D();
  const m = d.money ?? { expenses: [], balances: {}, totals: {}, shares: {} };
  const me = d.user.id;
  const terms = d.deal?.data?.terms ?? {};
  const cur = m.currency || terms.currency || briefCur(d.search);
  const bal = m.balances?.[cur] ?? { transfers: [] };
  const mine = bal.transfers.filter((x) => x.from === me || x.to === me);
  const top = mine[0] ?? bal.transfers[0] ?? null;
  const [busy, setBusy] = useState(false);
  const n = d2voters().length;
  const shared = m.mode === 'shared';
  const kicker = [isLiving() || d.deal ? districtShort(dealListing()) || shortTitle(d.search.title) : shortTitle(d.search.title), shared ? t('mm_shared') : isLiving() ? t('live_n', { n }) : t('members_n', { n: d.members.length })].filter(Boolean).join(' · ');
  const other = (x) => memberById(x.from === me ? x.to : x.from);
  const line = (x) => (x.to === me ? t('owes_you', { name: firstName(memberById(x.from)?.name) }) : x.from === me ? t('you_owe', { name: firstName(memberById(x.to)?.name) }) : t('owes', { a: firstName(memberById(x.from)?.name), b: firstName(memberById(x.to)?.name) }));
  async function settle() {
    if (!top) return;
    setBusy(true);
    try {
      const r = await api('/app/api/settle', { search_id: d.search.id, from: top.from, to: top.to, amount: top.amount, currency: cur });
      d.money = r.money;
      hap.ok();
      toast(t('settled_toast'));
      emit();
    } catch { toast(t('err_generic')); }
    setBusy(false);
  }
  const tot = m.totals ?? {};
  // Newest first (Q3); the payer's animal leads the row.
  const list = [...(m.expenses ?? [])].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.created_at).localeCompare(String(a.created_at)));
  const paid = dealPaid(m.expenses ?? [], cur);
  const canEdit = canVoteRole(d.me.role);
  const myShare = tot.per_member?.[me];
  const equalShares = new Set(Object.values(m.shares ?? {})).size <= 1 && !m.rent_weights;
  const gear = d.me.role === 'owner' && html`<button class="round sm w2-back" aria-label=${t('mm_settings')} onClick=${() => openSheet('money_mode')}><${Icon} n="settings-2" /></button>`;
  const head = html`<div class="head w8-head"><div class="row w8-head-top"><${BackIfWeb} /><span class="grow"></span>${gear}</div><p class="kicker">${kicker}</p><h1 class="sr">${t('money')}</h1></div>`;
  const nav = html`<${Nav} tab=${homeMode() ? 'money' : 'today'} />`;
  if (!list.length && !paid.rent.length && !paid.deposit) return html`<main class="screen w2 ms81">${head}<${MoneyEmpty} canEdit=${canEdit} />${nav}</main>`;
  const addBtn = canEdit && html`<button class="btn accent block big ms8-add" onClick=${() => { hap.sel(); openSheet('add_expense'); }}><${Icon} n="plus" />${t('w81_m_add')}</button>`;
  const expensesCard = html`<div class="card w2-list">
      <div class="w2-lh"><span>${t('expenses')}</span>${canEdit && html`<button class="w2-add" onClick=${() => { hap.sel(); openSheet('add_expense'); }}><${Icon} n="plus" cls="sm" />${t('add')}</button>`}</div>
      ${list.length ? list.map((e) => html`<button key=${e.id} class="w2-row x-row" onClick=${() => openSheet('expense', e.id)}>
        ${e.order_id ? html`<span class="or-xrow"><${Good} slug="bag" size=${52} rot=${-8} shadow=${false} /><${Av} m=${memberById(e.paid_by) ?? { name: '?' }} size=${28} /></span>` : html`<${Av} m=${memberById(e.paid_by) ?? { name: '?' }} size=${36} />`}
        <div class="grow"><b>${e.title}</b><span>${[memberById(e.paid_by) ? (e.paid_by === me ? t('sp_you') : firstName(memberById(e.paid_by).name)) : null, fmtDM(e.date), e.method ? t('pm_' + e.method) : null, shared ? null : splitLabel(e, m), e.receipt ? t('receipt') : null].filter(Boolean).join(' · ')}</span></div>
        <div class="x-r"><b>${money(e.amount, e.currency)}</b></div></button>`)
      : html`<div class="w2-row"><span class="muted">${t('no_expenses')}</span></div>`}</div>`;
  if (shared) {
    const months = Object.entries(tot.by_month ?? {}).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6);
    return html`<main class="screen w2 ms81">
      ${head}
      <${MoneyStat} list=${list} cur=${cur} paid=${paid} />
      ${addBtn}
      <${DealPaidList} paid=${paid} cur=${cur} />
      ${months.length > 1 && html`<div class="card w2-list"><div class="w2-lh"><span>${t('mm_by_month')}</span></div>
        ${months.map(([mth, v]) => html`<div class="w2-row mm-row"><div class="grow"><b>${cap(dfmt(mth + '-15', { month: 'long', year: 'numeric' }))}</b></div><b>${money(v, cur)}</b></div>`)}</div>`}
      ${expensesCard}
      ${nav}
    </main>`;
  }
  return html`<main class="screen w2 ms81">
    ${head}
    <${MoneyStat} list=${list} cur=${cur} paid=${paid} />
    ${addBtn}
    ${list.length > 0 && html`<div class="m-hero">
      <p class="m-k">${t('money_today')}</p>
      ${top ? html`<div class="m-row">${mine.length ? html`<${Av} m=${other(top)} size=${44} />` : null}<span class="grow">${line(top)}</span><b>${money(top.amount, cur)}</b></div>`
        : html`<div class="m-row"><span class="grow">${t('all_square')}</span></div>`}
      ${bal.transfers.slice(1).map((x) => html`<div class="m-more">${line(x)} · ${money(x.amount, cur)}</div>`)}
      ${top && canEdit && (top.from === me || top.to === me || d.me.role === 'owner') && html`<button class="btn block m-settle" disabled=${busy} onClick=${settle}>${t('settle')}</button>`}
    </div>`}
    ${list.length > 0 && html`<div class="m-tiles">
      <div class="card"><b>${money(tot.total, cur)}</b><span>${t('m_total')}</span></div>
      <button class="card" onClick=${() => canEdit && go(sp('split'))}><b>${scaled(equalShares ? tot.equal_share : myShare ?? 0, tot.total)}</b><span>${equalShares ? t('m_each') : t('m_mine')}</span></button>
      <div class="card">${tot.power_per_month ? html`<b>~${scaled(tot.power_per_month, tot.power_per_month)}</b><span>${t('m_power')}</span>` : html`<b>${list.length}</b><span>${t('m_count', { n: list.length })}</span>`}</div>
    </div>`}
    <div style="height:14px"></div>
    <${DealPaidList} paid=${paid} cur=${cur} />
    ${expensesCard}
    ${nav}
  </main>`;
}
/** Q3 stat card: what the group spent this week / month / all time, compared with the previous period, with period bars. */
const PW_MONTH_IN = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
const pwMonthIn = (ym) => (LANG === 'ru' ? PW_MONTH_IN[Number(ym.slice(5, 7)) - 1] : dfmt(ym + '-15', { month: 'long' }));
const pwMonthOf = (ym) => (LANG === 'ru' ? dfmt(ym + '-15', { day: 'numeric', month: 'long' }).replace(/^\d+\s*/, '') : dfmt(ym + '-15', { month: 'long' }));
const pwShift = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
function MoneyStat({ list, cur, paid = { rent: [], deposit: null } }) {
  // wave 8.1: rent paid under the deal counts as spending; the deposit is not spending (a typed side line)
  const xs = [...list.filter((e) => e.currency === cur && e.date && e.kind !== 'deposit'), ...paid.rent];
  const today = dayKey(new Date().toISOString());
  const sum = (f) => xs.filter((e) => f(String(e.date).slice(0, 10))).reduce((a, e) => a + Number(e.amount || 0), 0);
  // never a dead "0": a month without spending yet opens on "all time" when there is history
  const [per, setPer] = useState(() => (sum((dd) => dd.startsWith(today.slice(0, 7))) > 0 || !xs.length ? 'month' : 'all'));
  if (!xs.length && !paid.deposit) return null;
  let label, total, prev = null, cmp = null, bars;
  if (per === 'week') {
    const from = pwShift(today, -6), pfrom = pwShift(today, -13);
    total = sum((d) => d >= from && d <= today);
    prev = sum((d) => d >= pfrom && d < from);
    label = t('pw_spent_week');
    if (prev > 0 && total !== prev) cmp = t(total < prev ? 'pw_less_week' : 'pw_more_week', { x: money(Math.abs(total - prev), cur) });
    bars = Array.from({ length: 7 }, (_, k) => { const d = pwShift(from, k); return { lb: wdShort(d), v: sum((x) => x === d), on: d === today }; });
  } else if (per === 'month') {
    const ym = today.slice(0, 7);
    const pym = pwShift(ym + '-01', -1).slice(0, 7);
    total = sum((d) => d.startsWith(ym));
    prev = sum((d) => d.startsWith(pym));
    label = t('pw_spent_in', { m: pwMonthIn(ym) });
    if (prev > 0 && total !== prev) cmp = t(total < prev ? 'pw_less' : 'pw_more', { x: money(Math.abs(total - prev), cur), m: pwMonthOf(pym) });
    const end = Number(new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate());
    const day = Number(today.slice(8, 10));
    bars = [[1, 7], [8, 14], [15, 21], [22, end]].map(([a, b]) => ({ lb: `${a}–${b}`, v: sum((d) => d.startsWith(ym) && Number(d.slice(8, 10)) >= a && Number(d.slice(8, 10)) <= b), on: day >= a && day <= b }));
  } else {
    total = sum(() => true);
    label = t('pw_spent_all');
    const ms = [...new Set(xs.map((e) => String(e.date).slice(0, 7)))].sort().slice(-6);
    bars = ms.map((m) => ({ lb: cap(dfmt(m + '-15', { month: 'short' })).replace('.', ''), v: sum((d) => d.startsWith(m)), on: m === today.slice(0, 7) }));
  }
  // wave 8 (V4-5): the giant counted-up figure, its unit, the typed comparison, then the period's categories as bar rows
  const inPer = per === 'week' ? ((dd) => dd >= pwShift(today, -6) && dd <= today) : per === 'month' ? ((dd) => dd.startsWith(today.slice(0, 7))) : () => true;
  const byKind = {};
  for (const e of xs) if (inPer(String(e.date).slice(0, 10))) byKind[e.kind || 'other'] = (byKind[e.kind || 'other'] ?? 0) + Number(e.amount || 0);
  const kinds = Object.entries(byKind).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const kmax = Math.max(1, ...kinds.map((x) => x[1]));
  const bm = bigMoney(total, cur);
  const f = (n) => new Intl.NumberFormat(LOC(), { minimumFractionDigits: bm.dec, maximumFractionDigits: bm.dec }).format(n);
  // the typed line (V4-5): the comparison, else what the figure is made of (rent from the lease, the deposit aside)
  const rentIn = paid.rent.filter((r) => inPer(String(r.date).slice(0, 10))).reduce((a, r) => a + r.amount, 0);
  const lines = [
    cmp,
    !cmp && total === 0 && per === 'month' ? t('w81_m_none_month', { m: pwMonthIn(today.slice(0, 7)) }) : null,
    !cmp && total === 0 && per === 'month' && sum(() => true) > 0 ? t('w81_m_all_line', { x: money(sum(() => true), cur) }) : null,
    !cmp && rentIn > 0 && rentIn < total ? t('w81_m_rent_of', { x: money(rentIn, cur) }) : null,
    !cmp && rentIn > 0 && rentIn === total && per !== 'all' && !paid.rent.some((r) => String(r.date).slice(0, 7) < today.slice(0, 7)) ? t('w81_m_first') : null,
    paid.deposit ? t('w81_m_dep_line', { x: money(paid.deposit.amount, paid.deposit.currency ?? cur) }) : null,
  ].filter(Boolean).slice(0, 3);
  return html`<div class="ms8">
    <p class="ms-k">${label}</p>
    <p class="ms8-big" aria-label=${money(total, cur)}><span aria-hidden="true"><${CountUp} key=${per} value=${bm.v} fmt=${f} /></span></p>
    ${bm.unit && html`<p class="ms8-unit">${bm.unit}</p>`}
    ${lines.length > 0 && html`<${Typed} key=${per + lines.join('|')} cls="xs ms8-cmp" lines=${lines} />`}
    <div class="seg ms-seg" role="group">${['week', 'month', 'all'].map((k) => html`<button key=${k} aria-pressed=${per === k ? 'true' : 'false'} onClick=${() => { hap.sel(); setPer(k); }}>${t('pw_per_' + k)}</button>`)}</div>
    ${kinds.length > 0 && html`<div class="ms8-rows">${kinds.map(([k, v]) => html`<div key=${k} class="ms8-row"><span class="n">${t('xk_' + k)}</span><span class="bar"><i style=${`width:${Math.max(3, Math.round((v / kmax) * 100))}%`}></i></span><b>${scaled(v, kmax)}</b></div>`)}</div>`}
    <span class="sr">${bars.map((b) => `${b.lb}: ${money(b.v, cur)}`).join(', ')}</span>
  </div>`;
}
/** "1,5 млн" / "800k" / "1500000" → number in main units. */
function parseAmount(s) {
  const x = String(s ?? '').trim().toLowerCase().replace(/\s/g, '').replace(',', '.');
  const m = x.match(/^(\d+(?:\.\d+)?)(млн|m|mio|jt|тыс|k|rb)?$/);
  if (!m) return NaN;
  const mul = { 'млн': 1e6, m: 1e6, mio: 1e6, jt: 1e6, 'тыс': 1e3, k: 1e3, rb: 1e3 }[m[2]] ?? 1;
  return Math.round(Number(m[1]) * mul);
}
function AddExpense() {
  const d = D();
  const cur = d.money?.currency ?? briefCur(d.search) ?? 'IDR';
  const voters = d2voters();
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState('other');
  const [paid, setPaid] = useState(d.user.id);
  const [who, setWho] = useState(() => new Set(voters));
  const [method, setMethod] = useState(null);
  const [date, setDate] = useState(dayKey(new Date().toISOString()));
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [busy, setBusy] = useState(false);
  async function addReceipt() {
    const [f] = await pickFiles({ capture: true });
    if (!f) return;
    setBusy(true);
    try { const r = await uploadImage('/app/api/expense-receipt?search_id=' + encodeURIComponent(d.search.id), f); setReceipt(r.key); hap.ok(); }
    catch { toast(t('err_generic')); }
    setBusy(false);
  }
  async function save() {
    const a = parseAmount(amount);
    if (!title.trim() || !(a > 0)) return toast(t('x_need'));
    const everyone = voters.every((u) => who.has(u)) && who.size === voters.length;
    setBusy(true);
    try {
      await api('/app/api/expense', {
        search_id: d.search.id, title: title.trim(), amount: a, currency: cur, kind, paid_by: paid, method, date, note: note.trim() || null, receipt,
        split: everyone ? null : Object.fromEntries([...who].map((u) => [u, d.money?.shares?.[u] ?? 1])),
      });
      hap.ok();
      toast(t('x_saved'));
      closeSheet();
      load(d.search.id, { quiet: true });
    } catch { toast(t('err_generic')); }
    setBusy(false);
  }
  const chip = (on, label, f, extra = null) => html`<button class=${'bchip' + (on ? ' on' : ' off')} aria-pressed=${on ? 'true' : 'false'} onClick=${() => { hap.sel(); f(); }}>${extra}${label}</button>`;
  return html`<p class="kicker">${t('w8_new')}</p><h2 class="sr">${t('x_add')}</h2>
    <div class="x-form">
      <label class="amount-in"><input inputmode="decimal" value=${amount} placeholder="1 500 000" aria-label=${t('x_amount', { cur: SYM[cur] ?? cur })} onInput=${(e) => setAmount(e.currentTarget.value)} /><span>${SYM[cur] ?? cur}</span></label>
      <p class="amount-hint">${parseAmount(amount) > 0 ? t('pw_approx', { x: money(parseAmount(amount), cur) }) : ''}</p>
      <p class="e-lbl">${t('pw_category')}</p><div class="chips">${XKINDS.map((k) => chip(kind === k, t('xk_' + k), () => setKind(k), html`<${Icon} n=${XK_ICON[k]} cls="xs" />`))}</div>
      <p class="e-lbl">${t('x_title')}</p><input class="e-input" value=${title} placeholder=${t('x_title_ph')} onInput=${(e) => setTitle(e.currentTarget.value)} />
      <p class="e-lbl">${t('x_paid_by')}</p><div class="chips">${voters.map((u) => chip(paid === u, firstName(memberById(u)?.name), () => setPaid(u)))}</div>
      <p class="e-lbl">${t('x_split')}</p><div class="chips">${voters.map((u) => chip(who.has(u), firstName(memberById(u)?.name), () => { const n = new Set(who); n.has(u) ? n.size > 1 && n.delete(u) : n.add(u); setWho(n); }))}</div>
      <p class="e-lbl">${t('x_method')}</p><div class="chips">${['cash', 'transfer', 'card'].map((k) => chip(method === k, t('pm_' + k), () => setMethod(method === k ? null : k)))}</div>
      <p class="e-lbl">${t('x_date')}</p><input class="e-input" type="date" value=${date} onInput=${(e) => setDate(e.currentTarget.value)} />
      <p class="e-lbl">${t('x_note')}</p><input class="e-input" value=${note} onInput=${(e) => setNote(e.currentTarget.value)} />
      <button class="e-row" disabled=${busy} onClick=${addReceipt}><${Icon} n=${receipt ? 'circle-check' : 'camera'} /><span>${receipt ? t('x_receipt') : t('x_receipt_add')}</span>${!receipt && html`<small>${t('pw_optional')}</small>`}</button>
    </div>
    <button class="btn accent block big" style="margin-top:14px" disabled=${busy} onClick=${save}>${t('x_save')}</button>
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}
function ExpenseSheet({ id }) {
  const d = D();
  const e = (d.money?.expenses ?? []).find((x) => x.id === id);
  if (!e) return html`<p class="muted">—</p><button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
  const canDel = e.created_by === d.user.id || e.paid_by === d.user.id || d.me.role === 'owner';
  async function del() {
    try { await api('/app/api/expense-delete', { id }); hap.ok(); toast(t('x_deleted')); closeSheet(); load(d.search.id, { quiet: true }); }
    catch { toast(t('err_generic')); }
  }
  const rcpt = e.receipt ? `/app/kv/${encodeURIComponent(e.receipt)}?k=${encodeURIComponent(d.photo_token ?? '')}` : null;
  return html`<h2>${e.title}</h2>
    <div class="card grp">
      <div class="opt"><span class="grow muted">${t('x_amount', { cur: SYM[e.currency] ?? e.currency })}</span><b>${money(e.amount, e.currency, true)}</b></div>
      <div class="opt"><${Av} m=${memberById(e.paid_by)} size=${28} /><span class="grow">${t('x_paid', { name: firstName(memberById(e.paid_by)?.name) })}</span><span class="muted">${fmtDMY(e.date)}</span></div>
      <div class="opt"><span class="grow muted">${t('x_split')}</span><span>${splitLabel(e, d.money)}</span></div>
      ${e.note && html`<div class="opt"><span class="grow">${e.note}</span></div>`}
    </div>
    ${e.order_id && html`<${OrderReceiptOf} id=${e.order_id} />`}
    ${rcpt && html`<img class="x-receipt" src=${rcpt} alt=${t('x_receipt')} />`}
    ${canDel && html`<button class="btn danger block" onClick=${del}><${Icon} n="trash-2" cls="sm" />${t('x_delete')}</button>`}
    <button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
}
function SharesSheet() {
  const d = D();
  const voters = d2voters();
  const [w, setW] = useState(() => Object.fromEntries(voters.map((u) => [u, d.money?.shares?.[u] ?? 1])));
  const sum = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  const step = (u, x) => { hap.sel(); setW({ ...w, [u]: Math.max(0, Math.min(10, Math.round(((w[u] ?? 0) + x) * 2) / 2)) }); };
  async function save() {
    try { const r = await api('/app/api/shares', { search_id: d.search.id, shares: w }); d.money = r.money; hap.ok(); toast(t('shares_saved')); closeSheet(); emit(); }
    catch { toast(t('err_generic')); }
  }
  return html`<h2>${t('shares')}</h2><p class="muted" style="margin:0 0 14px">${t('shares_text')}</p>
    <div class="card grp">${voters.map((u) => html`<div class="opt"><${Av} m=${memberById(u)} size=${36} /><span class="grow">${firstName(memberById(u)?.name)} <span class="muted">· ${Math.round(((w[u] ?? 0) / sum) * 100)}%</span></span>
      <button class="round sm soft" aria-label="−" onClick=${() => step(u, -0.5)}><${Icon} n="minus" cls="sm" /></button><b class="sh-n">${fmtNum(w[u] ?? 0)}</b>
      <button class="round sm soft" aria-label="+" onClick=${() => step(u, 0.5)}><${Icon} n="plus" cls="sm" /></button></div>`)}</div>
    <button class="btn accent block" disabled=${!Object.values(w).some((x) => x > 0)} onClick=${save}>${t('x_save')}</button>
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}

// ---------------------------------------------------------------- on-site checklist (18)
/** The viewing the checklist belongs to: one that started (latest), else today's next, else none. */
function onsiteViewing(lid) {
  const vs = (D()?.viewings ?? []).filter((v) => v.listing_id === lid);
  const now = Date.now();
  const started = vs.filter((v) => Date.parse(v.starts_at) <= now + 60 * 60e3);
  return started[started.length - 1] ?? vs.find((v) => dayKey(v.starts_at) === dayKey(new Date().toISOString())) ?? null;
}
function Onsite({ id }) {
  const d = D();
  const l = listingById(id);
  const v = onsiteViewing(id);
  const vid = v?.id ?? '';
  const items = regionPack()?.checklist ?? [];
  const mineRows = () => (d.onsite ?? []).filter((r) => r.listing_id === id && r.viewing_id === vid && r.user_id === d.user.id);
  const [, force] = useState(0);
  const [up, setUp] = useState(false);
  if (!l || !canVoteRole(d.me.role)) return html`<main class="screen no-nav"><div class="center-msg">${t('err_generic')}</div></main>`;
  const rowOf = (item) => mineRows().find((r) => r.item === item);
  const photos = (d.onsite_photos ?? []).filter((p) => p.listing_id === id).reduce((a, p) => a + Number(p.n), 0);
  async function set(item, ok, note) {
    let r = rowOf(item);
    if (!r) { r = { listing_id: id, viewing_id: vid, user_id: d.user.id, item, ok: null, note: null }; (d.onsite ??= []).push(r); }
    const body = { listing_id: id, viewing_id: vid, item, ok: ok === undefined ? (r.ok == null ? null : r.ok === 1) : ok };
    if (ok !== undefined) r.ok = ok == null ? null : ok ? 1 : 0;
    if (note !== undefined) { r.note = note; body.note = note; }
    hap.sel();
    force((x) => x + 1);
    try { await api('/app/api/onsite', body); } catch { toast(t('err_generic')); }
  }
  const tap = (it, ok) => {
    const r = rowOf(it.id);
    const cur = r?.ok == null ? null : r.ok === 1;
    const next = cur === ok ? null : ok;
    set(it.id, next);
    if (next === false && !r?.note) openSheet('onsite_note', { item: it, set });
  };
  async function addPhotos() {
    const files = await pickFiles({ multiple: true, capture: true });
    if (!files.length) return;
    setUp(true);
    try {
      let count = photos;
      for (const f of files) count = (await uploadImage(`/app/api/onsite-photo?listing_id=${encodeURIComponent(id)}&viewing_id=${encodeURIComponent(vid)}`, f)).count;
      const row = (d.onsite_photos ??= []).find((p) => p.listing_id === id);
      if (row) row.n = count; else d.onsite_photos.push({ listing_id: id, viewing_id: vid, n: count });
      hap.ok();
      toast(t('os_uploaded'));
    } catch { toast(t('err_generic')); }
    setUp(false);
  }
  const answered = items.filter((it) => rowOf(it.id)?.ok != null).length;
  const kicker = [v ? fmtTime(v.starts_at) : null, shortTitle(l.title)].filter(Boolean).join(' · ');
  return html`<main class="screen no-nav w2">
    <div class="head"><div class="row" style="align-items:flex-start"><${BackIfWeb} /><div><p class="kicker">${kicker}</p><h1 class="h1">${t('os_title')}</h1></div></div>
      ${items.length > 0 && html`<span class="os-count">${t('os_of', { x: answered, n: items.length })}</span>`}</div>
    ${items.length ? html`<div class="card w2-list">${items.map((it) => {
      const r = rowOf(it.id);
      const ok = r?.ok == null ? null : r.ok === 1;
      const label = pick2([it.label?.ru, it.label?.en]) ?? it.id;
      return html`<div key=${it.id} class="w2-row os-row">
        <${Icon} n=${ICONS[it.icon] ? it.icon : 'circle-dashed'} cls="os-ic" />
        <button class="grow os-txt" onClick=${() => openSheet('onsite_note', { item: it, set })}><span class="lb">${label}</span>${r?.note && html`<span class=${'nt' + (ok === false ? ' bad' : '')}>${r.note}</span>`}</button>
        <button class=${'os-b ok' + (ok === true ? ' on' : '')} aria-pressed=${ok === true ? 'true' : 'false'} aria-label=${t('yes')} onClick=${() => tap(it, true)}><${Icon} n="check" /></button>
        <button class=${'os-b no' + (ok === false ? ' on' : '')} aria-pressed=${ok === false ? 'true' : 'false'} aria-label=${t('no')} onClick=${() => tap(it, false)}><${Icon} n="x" /></button>
      </div>`;
    })}</div>` : html`<div class="card" style="padding:16px"><p class="muted" style="margin:0">${t('os_none')}</p></div>`}
    <div class="os-actions">
      <button class="btn surface" disabled=${up} onClick=${addPhotos}><${Icon} n="camera" />${photos ? t('os_photos', { n: photos }) : t('os_photo')}</button>
      <button class="btn accent" onClick=${() => go(sp('rate', id))}>${t('os_rate')}<${Icon} n="arrow-right" /></button>
    </div>
  </main>`;
}
function OnsiteNoteSheet({ arg }) {
  const d = D();
  const it = arg.item;
  const cur = (d.onsite ?? []).find((r) => r.item === it.id && r.user_id === d.user.id);
  const [txt, setTxt] = useState(cur?.note ?? '');
  const save = () => { arg.set(it.id, undefined, txt.trim() || null); closeSheet(); };
  return html`<h2>${pick2([it.label?.ru, it.label?.en])}</h2>
    ${it.hint && html`<p class="muted" style="margin:0 0 12px">${pick2([it.hint.ru, it.hint.en])}</p>`}
    <input class="e-input" value=${txt} placeholder=${t('os_note_ph')} aria-label=${t('os_note')} onInput=${(e) => setTxt(e.currentTarget.value)} onKeyDown=${(e) => e.key === 'Enter' && save()} />
    <button class="btn accent block" style="margin-top:12px" onClick=${save}>${t('done')}</button>
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}

// ---------------------------------------------------------------- life in the villa (19)
const HC_ICON = (c) => (c.channel === 'phone' ? 'phone' : c.channel === 'telegram' ? 'send' : 'message-circle');
function issueChip(i) {
  if (i.status === 'fixed') return html`<span class="st2 ok">${t('is_fixed')}</span>`;
  if (i.status === 'scheduled') return html`<span class="st2 wait">${i.scheduled_at ? t('is_scheduled', { when: whenLabel(i.scheduled_at) }) : t('is_scheduled_plain')}</span>`;
  return html`<span class="st2">${t('is_open')}</span>`;
}
function hcSub(c) {
  const per = c.period ? t('per_' + c.period + '_s') : '';
  return [[roleLabelHC(c.role), c.schedule].filter(Boolean).join(' '), c.cost != null ? `${money(c.cost, c.currency)}${per}` : null, c.payer ? t('payer_' + c.payer) : null, c.note].filter(Boolean).join(' · ');
}
const roleLabelHC = (r) => (STR[LANG]['hc_' + r] ? t('hc_' + r) : r);
function datesBanner() {
  const today = dayKey(new Date().toISOString());
  const ds = (D()?.dates ?? []).filter((x) => !x.done && x.date >= today).slice(0, 2);
  if (!ds.length) return null;
  return ds.map((x) => `${fmtDM(x.date)} — ${x.title.replace(/^./, (c) => c.toLowerCase())}${x.amount != null ? ' ' + money(x.amount, x.currency) : ''}${x.note ? ` (${x.note.replace(/^./, (c) => c.toLowerCase())})` : ''}`).join('. ') + '.';
}
/** Wave 8.1: the owner names the home (listings.short_name) — the titles use it instead of the long listing title. */
function HomeNameSheet() {
  const d = D();
  const l = homeListing();
  const [v, setV] = useState(l?.short_name ?? '');
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!l) return;
    setBusy(true);
    try {
      const r = await api('/app/api/home-name', { search_id: d.search.id, listing_id: l.id, short_name: v.trim() || null });
      l.short_name = r.short_name;
      hap.ok(); toast(t('w81_saved')); closeSheet(); emit();
    } catch { toast(t('err_generic')); }
    setBusy(false);
  }
  return html`<h2>${t('w81_rename')}</h2><p class="muted" style="margin:0 0 14px">${t('w81_rename_hint')}</p>
    <input class="e-input" maxlength="40" value=${v} placeholder=${t('w81_rename_ph')} onInput=${(e) => setV(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && save()} />
    <button class="btn accent block" style="margin-top:14px" disabled=${busy} onClick=${save}>${t('w81_save')}</button>
    <button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
}
function Home() {
  const d = D();
  const l = dealListing();
  const terms = d.deal?.data?.terms ?? {};
  let kicker = t('home_living_short');
  if (terms.from && hmDays(terms.from) > 0) kicker = `${t('pp_k_movein')} ${t('hm_in_days', { n: hmDays(terms.from) })}`;
  else if (terms.from && terms.to) {
    const day0 = Date.parse(terms.from + 'T00:00:00Z'), day1 = Date.parse(terms.to + 'T00:00:00Z');
    const nowD = Date.parse(dayKey(new Date().toISOString()) + 'T00:00:00Z');
    kicker = t('home_living', { d: Math.max(1, Math.min(Math.round((day1 - day0) / 864e5), Math.round((nowD - day0) / 864e5) + 1)), n: Math.round((day1 - day0) / 864e5) });
  }
  const issues = d.issues ?? [];
  const hcs = d.house_contacts ?? [];
  const banner = datesBanner();
  const canAct = canVoteRole(d.me.role);
  return html`<main class="screen w2">
    <${W2Head} l=${l} kicker=${kicker} kickerCls="jungle" title=${homeName()}
      right=${d.me.role === 'owner' && homeListing() && html`<button class="round sm w81-rename" aria-label=${t('w81_rename')} onClick=${() => { hap.sel(); openSheet('home_name'); }}><${Icon} n="pencil" /></button>`} />
    <${NextCard} />
    <${GuestDrafts} />
    <div class="card w2-list">
      <div class="w2-lh"><span>${t('issues')}</span>${canAct && html`<button class="w2-add" onClick=${() => openSheet('issue')}><${Icon} n="plus" cls="sm" />${t('report')}</button>`}</div>
      ${issues.length ? issues.map((i) => html`<div key=${i.id} class="w2-row is-row"><div class="grow"><div class="is-hd"><b>${i.title}</b>${issueChip(i)}</div>
        <span>${(i.status === 'fixed' ? [i.fixed_at ? fmtDM(i.fixed_at) : null, i.note] : [i.note, agoRel(i.updated_at)]).filter(Boolean).join(' · ')}</span></div></div>`)
        : html`<div class="w2-row"><span class="muted">${t('no_issues')}</span></div>`}
    </div>
    <div class="card w2-list">
      <div class="w2-lh"><span>${t('contacts')}</span></div>
      ${hcs.length ? hcs.map((c) => {
        const link = channelLink(c.channel, c.address);
        return html`<div key=${c.id} class="w2-row hc-row" onClick=${c.contact_id ? () => go(sp('contact', c.contact_id)) : null}><span class="letter-av">${initial(c.name)}</span><div class="grow"><b>${c.name}</b><span>${hcSub(c)}</span></div>
          ${link && html`<button class="hc-go" aria-label=${t('open_in', { ch: channelName(c.channel) })} onClick=${() => openLink(link)}><${Icon} n=${HC_ICON(c)} /></button>`}</div>`;
      }) : html`<div class="w2-row"><span class="muted">${t('no_hcontacts')}</span></div>`}
    </div>
    ${banner && html`<button class="w2-note" onClick=${() => go(sp('docs'))}><${Icon} n="calendar-clock" /><span>${banner}</span></button>`}
    <${W3Links} />
    <${W4Links} />
    <${W5Links} />
    <${W2Links} />
    <${Nav} tab="today" />
  </main>`;
}
/** "2 ч назад" for recent, else a date. */
function agoRel(iso) {
  if (!iso) return null;
  const ms = Date.now() - Date.parse(iso);
  return ms < 864e5 ? relIn(-ms) : fmtDM(iso);
}
function W2Links() {
  const d = D();
  const n = (d.money?.expenses ?? []).length;
  const docs = (d.documents ?? []).length;
  return html`<div class="w2-links">
    ${d.deal && html`<button class="card chats-row" onClick=${() => go(sp('docs'))}><span class="ic"><${Icon} n="file-text" /></span><div class="grow"><b>${t('deal_links_docs')}</b><span>${[docs ? `${t('docs')}: ${docs}` : null, (d.dates ?? []).length ? `${t('dates_title').toLowerCase()}: ${d.dates.length}` : null].filter(Boolean).join(' · ') || '—'}</span></div><${Icon} n="chev" cls="sm muted" /></button>`}
    <button class="card chats-row" onClick=${() => go(sp('money'))}><span class="ic"><${Icon} n="wallet" /></span><div class="grow"><b>${t('deal_links_money')}</b><span>${t('money_row_sub', { n })}</span></div><${Icon} n="chev" cls="sm muted" /></button>
  </div>`;
}
function IssueSheet() {
  const d = D();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const r = await api('/app/api/issue', { search_id: d.search.id, title: title.trim(), note: note.trim() || null });
      (d.issues ??= []).unshift(r.issue);
      hap.ok();
      toast(t('is_sent'));
      closeSheet();
      refresh();
    } catch { toast(t('err_generic')); }
    setBusy(false);
  }
  return html`<h2>${t('is_report_title')}</h2>
    <input class="e-input" value=${title} placeholder=${t('is_report_ph')} onInput=${(e) => setTitle(e.currentTarget.value)} />
    <textarea class="e-input" style="margin-top:10px" rows="3" placeholder=${t('is_note_ph')} value=${note} onInput=${(e) => setNote(e.currentTarget.value)}></textarea>
    <button class="btn accent block" style="margin-top:12px" disabled=${busy || !title.trim()} onClick=${send}><${Icon} n="send" cls="sm" />${t('report')}</button>
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}

// ---------------------------------------------------------------- documents and dates (21, 21b)
const DOC_ICON = { lease: 'file-text', receipt: 'receipt-text', owner_consent: 'file-pen', movein_video: 'video', other: 'file' };
const SUM_ICON = { users: 'users', calendar: 'cal', wallet: 'wallet', shield: 'shield', zap: 'zap', home: 'home', key: 'key-round', file: 'file', alert: 'triangle-alert', receipt: 'receipt-text', info: 'info' };
function fileLabel(doc) {
  if (!doc.has_file) return null;
  if (doc.file_kind === 'photo' || /^image\//.test(doc.mime ?? '')) return t('f_photo');
  if (doc.file_kind === 'video' || /^video\//.test(doc.mime ?? '')) return t('f_video');
  if (/pdf/.test(doc.mime ?? '') || /\.pdf$/i.test(doc.file_name ?? '')) return t('f_pdf');
  return t('f_file');
}
const docTitle = (doc) => (doc.version ? `${doc.title}, ${t('version_n', { n: doc.version })}` : doc.title);
function docSub(doc) {
  if (doc.status !== 'have') return doc.note ?? '';
  const date = doc.signed_at ? t('signed_cap', { d: fmtDM(doc.signed_at) }) : doc.doc_date ? fmtDM(doc.doc_date) : null;
  return [date, fileLabel(doc), doc.pages ? t('pages_n', { n: doc.pages }) : null, doc.note].filter(Boolean).join(' · ');
}
function docChip(doc) {
  if (doc.status === 'have') return html`<span class="st2 ok">${t('ds_have')}</span>`;
  if (doc.status === 'request') return html`<span class="st2 wait">${t('ds_request')}</span>`;
  const dd = doc.due_date;
  const soon = dd && Date.parse(dd) - Date.now() < 6 * 864e5 && Date.parse(dd) > Date.now() - 864e5;
  return html`<span class="st2">${dd ? (soon ? (LANG === 'ru' ? `В ${wdShort(dd).toLowerCase()}` : `On ${wdShort(dd)}`) : t('ds_due', { d: fmtDM(dd) })) : '—'}</span>`;
}
const CAD = { payment: 'cad_payment', notice: 'cad_notice', deposit_return: 'cad_deposit_return' };
function Docs() {
  const d = D();
  const l = dealListing();
  if (!d.deal) return html`<main class="screen"><div class="center-msg">—</div><${Nav} tab="today" /></main>`;
  const docs = d.documents ?? [];
  const dates = d.dates ?? [];
  const canAct = canVoteRole(d.me.role);
  const markDone = async (i, done) => {
    // wave 6 · A: dates of an extension term carry term_seq + their index inside that term
    try { const x = dates[i]; await api('/app/api/deal-date', { listing_id: d.deal.listing_id, index: x?.term_seq >= 2 ? x.index : i, ...(x?.term_seq >= 2 ? { term_seq: x.term_seq } : {}), done }); dates[i].done = done; hap.ok(); emit(); } catch { toast(t('err_generic')); }
  };
  return html`<main class="screen w2">
    <${W2Head} l=${l} kicker=${t('docs_kicker')} title=${homeName()} />
    <div class="card w2-list">
      <div class="w2-lh"><span>${t('docs')}</span>${canAct && html`<button class="w2-add" onClick=${() => openSheet('add_doc')}><${Icon} n="plus" cls="sm" />${t('add')}</button>`}</div>
      ${docs.length ? docs.map((doc) => html`<button key=${doc.id} class="w2-row doc-row" onClick=${() => (doc.has_file || doc.summary ? go(sp('doc', doc.id)) : openSheet('doc_req', doc))}>
        <span class="sq big"><${Icon} n=${DOC_ICON[doc.kind] ?? 'file'} /></span><div class="grow"><b>${docTitle(doc)}</b>${docSub(doc) && html`<span>${docSub(doc)}</span>`}</div>${docChip(doc)}</button>`)
        : html`<div class="w2-row"><span class="muted">—</span></div>`}
    </div>
    ${dates.length > 0 && html`<div class="card w2-list">
      <div class="w2-lh"><span>${t('dates_title')}</span></div>
      ${dates.map((x, i) => {
        if (x.done && x.kind === 'payment') return null;
        const dep = x.kind === 'deposit_return';
        const sub = [CAD[x.kind] && !x.done ? t(CAD[x.kind]) : null, x.note, x.done && dep ? t('returned') : null].filter(Boolean).join('. ');
        const due = dep && !x.done && x.date <= dayKey(new Date().toISOString());
        return html`<div key=${i} class=${'w2-row dt-row' + (x.done ? ' done' : '')}><b class=${'dt' + (dep ? ' acc' : '')}>${dep ? t('until_d', { d: fmtDM(x.date) }) : fmtDM(x.date)}</b>
          <div class="grow"><b>${x.title}${x.amount != null ? ' ' + money(x.amount, x.currency) : ''}</b>${sub && html`<span>${sub}</span>`}</div>
          ${due && canAct && html`<button class="st2 ok btn-chip" onClick=${() => markDone(i, true)}>${t('mark_returned')}</button>`}</div>`;
      })}
    </div>`}
    <p class="w2-foot">${t('docs_foot')}</p>
    <${Nav} tab="today" />
  </main>`;
}
function DocDetail({ id }) {
  const d = D();
  const doc = (d.documents ?? []).find((x) => x.id === id);
  const [busy, setBusy] = useState(false);
  if (!doc) return html`<main class="screen no-nav"><div class="center-msg">—</div></main>`;
  const sm = doc.summary;
  const sub = [doc.version ? (doc.doc_date ? t('version_from', { n: doc.version, d: fmtDM(doc.doc_date) }) : cap(t('version_n', { n: doc.version }))) : doc.doc_date ? fmtDM(doc.doc_date) : null,
    doc.signed_at ? t('signed_on', { d: fmtDM(doc.signed_at) }) : null, doc.pages ? t('pages_n', { n: doc.pages }) : null].filter(Boolean).join(' · ');
  const fl = fileLabel(doc);
  const openLabel = fl === t('f_pdf') ? t('open_pdf') : fl === t('f_photo') ? t('open_photo') : fl === t('f_video') ? t('open_video') : t('open_file');
  async function open() {
    setBusy(true);
    try { const r = await api('/app/api/doc-link', { id }); openLink(r.url); } catch { toast(t('err_generic')); }
    setBusy(false);
  }
  async function send() {
    setBusy(true);
    try { await api('/app/api/doc-send', { id }); hap.ok(); toast(t('sent_tg')); } catch (e) { toast(e.code === 'no_tg_user' ? t('err_member') : t('err_generic')); }
    setBusy(false);
  }
  // V4-12: the paper itself as the hero (tilted, a "signed" sticker), the giant title, the points, the two pills
  const actions = doc.has_file ? html`<div class="doc-actions">
        <button class="btn accent" disabled=${busy} onClick=${open}><${Icon} n="file-down" />${openLabel}</button>
        <button class="btn surface outline" disabled=${busy} onClick=${send}><${Icon} n="send" />${t('to_tg')}</button></div>`
      : html`<p class="muted">${t('no_file')}</p>`;
  return html`<main class="screen no-nav w2 doc8-screen">
    ${!inTG && html`<div class="row w8-head-top"><${BackIfWeb} /></div>`}
    <div class="doc8" aria-hidden="true"><div class="doc8-paper"><b>${doc.title}</b>${Array.from({ length: 9 }, (_, k) => html`<i key=${k} style=${k % 4 === 3 ? 'width:62%' : ''}></i>`)}</div>
      ${doc.signed_at && html`<${Sticker} text=${t('w8_signed', { d: fmtDM(doc.signed_at) })} style="right:4%;top:-4%;--r:-12deg" />`}</div>
    <div class="head"><div><p class="kicker">${t('doc_kicker', { home: homeName() })}</p><h1 class="h1 doc8-h">${doc.title}</h1>${sub && html`<p class="w2-sub">${sub}</p>`}</div></div>
    ${sm?.sections?.length ? html`<div class="card w2-list"><div class="w2-lh"><span>${t('main_points')}</span></div>
      ${sm.sections.map((x, k) => html`<div key=${k} class="w2-row sig"><${Icon} n=${SUM_ICON[x.icon] ?? 'info'} cls="muted" /><div class="grow"><b>${x.title}</b><span>${x.text}</span></div></div>`)}</div>`
      : html`<div class="card" style="padding:16px"><p class="muted" style="margin:0">${t('no_summary')}</p></div>`}
    ${sm?.changes && html`<div class="w2-note col"><b>${sm.changes_from ? t('changes_from', { n: sm.changes_from }) : t('changes')}</b><span>${sm.changes}</span></div>`}
    ${actions}
  </main>`;
}
function AddDocSheet() {
  const d = D();
  const req = async (kind) => {
    try { await api('/app/api/doc-request', { search_id: d.search.id, listing_id: d.deal?.listing_id, kind, title: t('dk_' + kind) }); hap.ok(); toast(t('doc_requested')); closeSheet(); load(d.search.id, { quiet: true }); }
    catch { toast(t('err_generic')); }
  };
  return html`<h2>${t('add_doc_title')}</h2><p class="muted" style="margin:0 0 12px">${t('add_doc_bot')}</p>
    ${d.bot_username && html`<button class="btn accent block" style="margin-bottom:14px" onClick=${() => openLink(`https://t.me/${d.bot_username}`)}><${Icon} n="send" cls="sm" />${t('open_bot')}</button>`}
    <p class="section" style="margin-top:0">${t('add_doc_req')}</p>
    <div class="card grp">${['lease', 'receipt', 'owner_consent', 'movein_video'].map((k) => html`<button class="opt" onClick=${() => req(k)}><${Icon} n=${DOC_ICON[k]} cls="sm" /><span class="grow">${t('dk_' + k)}</span><${Icon} n="chev" cls="sm muted" /></button>`)}</div>
    <button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
}
function DocReqSheet({ doc }) {
  const d = D();
  const req = async () => {
    try { await api('/app/api/doc-request', { search_id: d.search.id, id: doc.id }); hap.ok(); toast(t('doc_requested')); closeSheet(); load(d.search.id, { quiet: true }); }
    catch { toast(t('err_generic')); }
  };
  return html`<h2>${docTitle(doc)}</h2>${doc.note && html`<p class="muted" style="margin:0 0 12px">${doc.note}</p>`}
    ${canVoteRole(d.me.role) && html`<button class="btn accent block" style="margin-bottom:8px" onClick=${req}><${Icon} n="sparkles" cls="sm" />${t('req_this')}</button>`}
    ${d.bot_username && html`<button class="btn surface block" style="margin-bottom:8px" onClick=${() => openLink(`https://t.me/${d.bot_username}`)}><${Icon} n="send" cls="sm" />${t('open_bot')}</button>`}
    <button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
}
function Toggle({ on, onChange, label, sub }) {
  return html`<button class="opt tgl" role="switch" aria-checked=${on ? 'true' : 'false'} onClick=${() => onChange(!on)}>
    <div class="grow"><div>${label}</div>${sub && html`<div class="muted" style="font-size:13px">${sub}</div>`}</div><span class=${'sw' + (on ? ' on' : '')}><i></i></span></button>`;
}

// ---------------------------------------------------------------- wave 3: shared helpers
const meOrName = (u) => (u === D()?.user.id ? t('sp_you') : firstName(memberById(u)?.name));
function homePoint() {
  const l = dealListing();
  return l?.lat != null && l?.lng != null ? [l.lat, l.lng] : null;
}
/** "18 мин" / "1 ч" / "1,5 ч". */
const minLabel = (m) => (m >= 60 ? t('ds_h', { n: fmtNum(Math.round(m / 6) / 10) }) : t('em_min', { n: m }));
function W3Head({ kicker, title, right }) {
  // wave 8: back circle and actions on their own row under the top bar, then the kicker and the giant title
  return html`<div class="head w3-head w8-head">${(!inTG || right) && html`<div class="row w8-head-top"><${BackIfWeb} /><span class="grow"></span>${right}</div>`}
    <div>${kicker && html`<p class="kicker">${kicker}</p>`}<h1 class="h1 w3-h1">${title}</h1></div></div>`;
}
const telLink = (p) => (p ? `tel:${String(p).replace(/[^\d+]/g, '')}` : null);
const mapLink = (lat, lng, url) => url || (lat != null && lng != null ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : null);
function RoundBtn({ ic, label, onClick, cls = '' }) {
  return html`<button class=${'w3-rb ' + cls} aria-label=${label} onClick=${(e) => { e.stopPropagation(); onClick(); }}><${Icon} n=${ic} /></button>`;
}

// ---------------------------------------------------------------- move-out (22)
const MO_STEPS = ['notice', 'keys', 'video', 'cleaning', 'deposit'];
const MO_ICON = { done: 'circle-check', wait: 'circle-help', todo: 'circle-dashed', info: 'info' };
function moTitle(k, st) {
  if (k === 'notice') return st?.status === 'done' ? t('mo_notice') : t('mo_notice_todo');
  return t('mo_' + k);
}
function moSub(k, st) {
  if (st?.note) return st.note;
  if (k === 'notice' && st?.status === 'done' && st.date) return t('mo_in', { d: fmtDM(st.date), ch: st.channel ? channelName(st.channel) : '' }).replace(/ (в|on) $/, '');
  if (k === 'deposit' && st?.date) return [t('mo_deposit_sub', { d: fmtDM(st.date) }), st.amount != null ? money(st.amount, st.currency) : null].filter(Boolean).join(' · ');
  return t('mo_' + k + '_sub');
}
function Moveout() {
  const d = D();
  const mo = d.moveout;
  const l = dealListing();
  const [busy, setBusy] = useState(false);
  if (!mo) return html`<main class="screen w2"><${W3Head} title=${t('w3_moveout')} /><div class="card" style="padding:16px"><p class="muted" style="margin:0">${t('mo_date_none')}</p></div><${Nav} tab="today" /></main>`;
  const villa = (l?.property_type ?? '') === 'villa';
  const pb = mo.pushback;
  const canAct = canVoteRole(d.me.role);
  const wd = mo.date ? (LANG === 'ru' ? dfmt(mo.date, { weekday: 'long' }).replace(/^(\S+)$/, (w) => (/^(среда|пятница|суббота)$/.test(w) ? w.slice(0, -1) + 'у' : w)) : dfmt(mo.date, { weekday: 'long' })) : null;
  const head = mo.date ? t('mo_date', { d: `${LANG === 'ru' ? (/^вт/.test(wd) ? 'во ' : 'в ') : 'on '}${wd}, ${fmtDM(mo.date)}` }) : t('mo_date_none');
  async function draft() {
    setBusy(true);
    try { await postInstruction(t('mo_draft_text', { who: pb?.who ?? '' }), 'moveout_reply', 'moveout'); hap.ok(); toast(t('mo_draft_sent')); }
    catch { toast(t('err_generic')); }
    setBusy(false);
  }
  const showRelet = !!d.relet || (d.deal?.data?.terms?.to && mo.date && d.deal.data.terms.to > mo.date);
  return html`<main class="screen w2">
    <${W3Head} kicker=${[homeName(), homeName().includes(districtShort(l)) ? null : districtShort(l)].filter(Boolean).join(' · ')} title=${villa ? t('mo_title_villa') : t('mo_title')} />
    <div class="card w2-list">
      <div class="w2-lh"><span>${head}</span></div>
      ${MO_STEPS.map((k) => {
        const st = mo.steps?.[k] ?? { status: 'todo' };
        return html`<button key=${k} class="w2-row sig mo-row" disabled=${!canAct} onClick=${() => openSheet('mo_step', k)}>
          <${Icon} n=${MO_ICON[st.status] ?? 'circle-dashed'} cls=${'mo-' + st.status} /><div class="grow"><b>${moTitle(k, st)}</b><span>${moSub(k, st)}</span></div></button>`;
      })}
    </div>
    ${pb && html`<div class="w3-warn"><div class="w3-warn-h"><${Icon} n="message-circle-warning" /><b>${pb.who ? `${pb.who}: «${pb.quote ?? ''}»` : `«${pb.quote ?? ''}»`}</b></div>${pb.points && html`<p>${pb.points}</p>`}</div>`}
    ${canAct && pb && html`<button class="btn accent block big" disabled=${busy} onClick=${draft}><${Icon} n="sparkles" />${pb.to ? t('mo_draft_to', { to: pb.to }) : t('mo_draft')}</button>`}
    ${showRelet && html`<button class="btn surface block big w3-second" onClick=${() => go(sp('relet'))}><${Icon} n="megaphone" />${t('mo_relet')}</button>`}
    <${Nav} tab="today" />
  </main>`;
}
function MoStepSheet({ k }) {
  const d = D();
  const st = d.moveout?.steps?.[k] ?? { status: 'todo' };
  const done = st.status === 'done';
  async function mark(status) {
    try { const r = await api('/app/api/moveout-step', { search_id: d.search.id, key: k, status }); d.moveout = r.moveout; hap.ok(); toast(t('mo_saved')); closeSheet(); emit(); }
    catch { toast(t('err_generic')); }
  }
  return html`<h2>${moTitle(k, st)}</h2><p class="muted" style="margin:0 0 14px">${moSub(k, st)}</p>
    ${k === 'video' && !done && html`<p style="margin:0 0 12px">${t('mo_video_bot')}</p>${d.bot_username && html`<button class="btn surface block" style="margin-bottom:10px" onClick=${() => openLink(`https://t.me/${d.bot_username}`)}><${Icon} n="send" cls="sm" />${t('open_bot')}</button>`}`}
    <button class="btn accent block" onClick=${() => mark(done ? 'todo' : 'done')}><${Icon} n=${done ? 'undo' : 'circle-check'} cls="sm" />${done ? t('mo_mark_todo') : t('mo_mark_done')}</button>
    <button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
}

// ---------------------------------------------------------------- people notes (23)
const contactCache = {};
function replyLabel(m) {
  if (m == null) return '—';
  if (m < 60) return t('pn_min', { n: Math.max(1, m) });
  if (m < 1440) return t('pn_h', { n: Math.round(m / 60) });
  return t('pn_d', { n: Math.round(m / 1440) });
}
function noteWhen(iso) {
  const days = (Date.now() - Date.parse(iso)) / 864e5;
  return days < 30 ? fmtDM(iso) : dfmt(iso, { month: 'short' }).replace('.', '');
}
function Person({ cid }) {
  const d = D();
  const [data, setData] = useState(contactCache[cid] ?? null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    api(`/app/api/contact?id=${encodeURIComponent(cid)}&s=${encodeURIComponent(d.search.id)}`).then((r) => { contactCache[cid] = r; setData(r); }).catch(() => setErr(true));
  }, [cid, S.sheet == null]);
  if (err && !data) return html`<main class="screen"><${W3Head} title="—" /><div class="center-msg">${t('err_generic')}</div><${Nav} tab="listings" /></main>`;
  if (!data) return html`<main class="screen"><div class="skeleton" style="height:90px;border-radius:24px"></div><${Nav} tab="listings" /></main>`;
  const c = data.contact ?? {};
  const th = (d.threads ?? []).find((x) => x.contact_id === cid);
  const lc = (d.listing_contacts ?? []).find((x) => x.contact_id === cid);
  const hc = (d.house_contacts ?? []).find((x) => x.contact_id === cid);
  const l = listingById(th?.listing_id ?? lc?.listing_id) ?? (hc ? dealListing() : null);
  const sub = [roleLabel(c.role), l ? [shortTitle(l.title), districtShort(l)].filter(Boolean).join(', ') : null].filter(Boolean).join(' · ');
  const st = data.stats ?? {};
  const words = String(c.name ?? '?').trim().split(/\s+/);
  const ini = (words[0]?.[0] ?? '?') + (words[1]?.[0] ?? '');
  const canAct = canVoteRole(d.me.role);
  return html`<main class="screen w2">
    <div class="w3-person"><${BackIfWeb} /><span class="w3-ini">${ini.toUpperCase()}</span><div class="grow"><h1 class="h1 w3-h1">${c.name ?? '—'}</h1>${sub && html`<p class="w2-sub">${sub}</p>`}</div></div>
    <div class="w3-tiles">
      <div class="card"><b>${st.searches ?? 0}</b><span>${t('pn_searches', { n: st.searches ?? 0 })}</span></div>
      <div class="card"><b>${st.notes ?? 0}</b><span>${t('pn_notes', { n: st.notes ?? 0 })}</span></div>
      <div class="card"><b>${replyLabel(st.reply_minutes)}</b><span>${t('pn_reply')}</span></div>
    </div>
    <div class="card w2-list">
      <div class="w2-lh"><span>${t('pn_notes_title')}</span>${canAct && html`<button class="w2-add" onClick=${() => openSheet('note_add', cid)}><${Icon} n="plus" cls="sm" />${t('add')}</button>`}</div>
      ${(data.notes ?? []).length ? data.notes.map((n) => {
        const m = memberById(n.author);
        return html`<div key=${n.id} class="w2-row sig pn-row"><${Icon} n=${n.sentiment > 0 ? 'thumbs-up' : n.sentiment < 0 ? 'thumbs-down' : 'info'} cls=${n.sentiment > 0 ? 'pn-good' : n.sentiment < 0 ? 'pn-bad' : 'muted'} />
          <div class="grow"><b>${n.text}</b><span class="pn-by">${n.author === 'agent' ? html`<span class="feed-ic xs"><${Icon} n="sparkles" cls="xs" /></span>` : html`<${Av} m=${m ?? { name: n.author_name }} size=${22} />`}
            ${[n.author === 'agent' ? t('agent') : firstName(n.author_name), noteWhen(n.at), n.search_id && n.search_id !== d.search.id ? shortTitle(n.search_title) : null].filter(Boolean).join(' · ')}</span></div></div>`;
      }) : html`<div class="w2-row"><span class="muted">${t('pn_none')}</span></div>`}
    </div>
    <p class="w2-foot">${t('pn_foot')}</p>
    <${Nav} tab="listings" />
  </main>`;
}
function NoteSheet({ cid }) {
  const d = D();
  const [text, setText] = useState('');
  const [sent, setSent] = useState(1);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const r = await api('/app/api/note', { search_id: d.search.id, contact_id: cid, text: text.trim(), sentiment: sent });
      const c = contactCache[cid];
      if (c) { c.notes = [r.note, ...(c.notes ?? [])]; c.stats = { ...(c.stats ?? {}), notes: (c.stats?.notes ?? 0) + 1 }; }
      hap.ok(); toast(t('pn_saved')); closeSheet();
    } catch (e) { toast(e.code === 'sensitive' ? e.message : t('err_generic')); }
    setBusy(false);
  }
  return html`<h2>${t('pn_add')}</h2>
    <div class="seg full" role="group" style="margin-bottom:12px">
      <button aria-pressed=${sent > 0 ? 'true' : 'false'} onClick=${() => setSent(1)}><${Icon} n="thumbs-up" cls="sm" /> ${t('pn_good')}</button>
      <button aria-pressed=${sent < 0 ? 'true' : 'false'} onClick=${() => setSent(-1)}><${Icon} n="thumbs-down" cls="sm" /> ${t('pn_bad')}</button>
    </div>
    <textarea class="e-input" rows="3" placeholder=${t('pn_ph')} value=${text} onInput=${(e) => setText(e.currentTarget.value)}></textarea>
    <p class="muted" style="font-size:13px;margin:8px 2px 0">${t('pn_foot')}</p>
    <button class="btn accent block" style="margin-top:12px" disabled=${busy || !text.trim()} onClick=${save}>${t('x_save')}</button>
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}

// ---------------------------------------------------------------- rent split by rooms (24)
function rentOf() {
  const tm = D()?.deal?.data?.terms ?? {};
  const rent = Number(tm.rent) || Number(dealListing()?.price) || null;
  return { rent, cur: tm.currency ?? dealListing()?.currency ?? D()?.money?.currency ?? null };
}
function rebalance(rooms, id) {
  const fixed = rooms.find((r) => r.id === id);
  const others = rooms.filter((r) => r.id !== id && r.share > 0);
  const rest = Math.max(0, 100 - (fixed?.share ?? 0));
  const sum = others.reduce((a, r) => a + r.share, 0);
  if (!others.length) { if (fixed) fixed.share = 100; return rooms; }
  let left = rest;
  others.forEach((r, i) => { r.share = i === others.length - 1 ? Math.round(left * 10) / 10 : Math.round(((sum ? r.share / sum : 1 / others.length) * rest) * 10) / 10; left -= r.share; });
  return rooms;
}
async function saveRooms(rooms, othersEqual) {
  const d = D();
  const r = await api('/app/api/rooms', { search_id: d.search.id, rooms: rooms ? { rooms, others_equal: othersEqual } : null });
  d.search.rooms = r.rooms;
  d.money = r.money;
  emit();
}
function Split() {
  const d = D();
  const rr = d.search.rooms;
  const rooms = rr?.rooms ?? [];
  const { rent, cur } = rentOf();
  const voters = d2voters();
  const canEdit = canVoteRole(d.me.role);
  const w = d.money?.rent_weights ?? null;
  const wsum = w ? Object.values(w).reduce((a, b) => a + b, 0) || 1 : 1;
  async function start() {
    const n = Math.max(voters.length, Number(dealListing()?.bedrooms) || voters.length);
    const list = Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}`, name: t('sp_bedroom', { n: i + 1 }), user_id: voters[i] ?? null, share: 0 }));
    const assigned = list.filter((x) => x.user_id);
    assigned.forEach((x, i) => { x.share = i === assigned.length - 1 ? Math.round((100 - (Math.round((100 / assigned.length) * 10) / 10) * (assigned.length - 1)) * 10) / 10 : Math.round((100 / assigned.length) * 10) / 10; });
    try { await saveRooms(list, true); hap.ok(); } catch { toast(t('err_generic')); }
  }
  async function toggle(v) {
    hap.sel();
    try { await saveRooms(rooms, v); } catch { toast(t('err_generic')); }
  }
  return html`<main class="screen w2">
    <${W3Head} kicker=${[homeName(), rent ? `${money(rent, cur)}${t('per_month')}` : t('sp_no_rent')].join(' · ')} title=${t('sp_split_title')} />
    ${rooms.length ? html`<div class="card w2-list">
      <div class="w2-lh"><span>${t('sp_rooms')}</span>${canEdit && html`<button class="w2-add" onClick=${() => openSheet('room', 'new')}><${Icon} n="plus" cls="sm" />${t('add')}</button>`}</div>
      ${rooms.map((r) => html`<button key=${r.id} class="w2-row sp-row" disabled=${!canEdit} onClick=${() => openSheet('room', r.id)}>
        ${r.user_id ? html`<${Av} m=${memberById(r.user_id)} size=${36} />` : html`<span class="w3-shared"><${Icon} n="users" cls="sm" /></span>`}
        <div class="grow"><div class="sp-hd"><div class="grow"><b>${r.name}</b><span>${r.user_id ? meOrName(r.user_id) : t('sp_shared')}</span></div><b class="sp-pc">${r.share > 0 ? `${fmtNum(r.share)}%` : '—'}</b></div>
          ${r.share > 0 && r.user_id && html`<div class="sp-bar"><i style=${`width:${Math.min(100, r.share)}%`}></i></div>`}</div></button>`)}
    </div>
    <div class="m-hero sp-hero"><p class="m-k">${t('sp_rent')}</p>
      ${voters.map((u) => html`<div class="m-row sp-mr"><${Av} m=${memberById(u)} size=${36} ring /><span class="grow">${meOrName(u)}</span><b>${rent && w ? money(Math.round((rent * (w[u] ?? 0)) / wsum), cur) : '—'}</b></div>`)}
    </div>
    <div class="card grp sp-tgl"><${Toggle} on=${rr.others_equal !== false} label=${voters.length === 2 ? t('sp_others_two') : t('sp_others_n')} onChange=${(v) => canEdit && toggle(v)} /></div>
    ${rr.others_equal === false && html`<button class="btn link" onClick=${() => openSheet('shares')}>${t('sp_shares_link')}</button>`}`
    : html`<div class="card" style="padding:18px"><p style="margin:0 0 14px">${t('sp_empty')}</p>${canEdit && html`<button class="btn accent block" onClick=${start}>${t('sp_start')}</button>`}</div>`}
    <${Nav} tab="today" />
  </main>`;
}
function RoomSheet({ id }) {
  const d = D();
  const rr = d.search.rooms ?? { rooms: [], others_equal: true };
  const cur = rr.rooms.find((r) => r.id === id);
  const [name, setName] = useState(cur?.name ?? '');
  const [who, setWho] = useState(cur ? cur.user_id : null);
  const [share, setShare] = useState(cur?.share ?? 0);
  const [busy, setBusy] = useState(false);
  const voters = d2voters();
  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    const rooms = rr.rooms.map((r) => ({ ...r }));
    const rid = cur?.id ?? `r${Date.now().toString(36)}`;
    const row = { id: rid, name: name.trim(), user_id: who, share: Math.max(0, Math.min(100, share)) };
    if (cur) rooms[rooms.findIndex((r) => r.id === id)] = row; else rooms.push(row);
    try { await saveRooms(rebalance(rooms, rid), rr.others_equal !== false); hap.ok(); toast(t('sp_split_saved')); closeSheet(); }
    catch (e) { toast(e.message && e.code === 'bad_rooms' ? e.message : t('err_generic')); }
    setBusy(false);
  }
  async function del() {
    const rooms = rr.rooms.filter((r) => r.id !== id).map((r) => ({ ...r }));
    try { await saveRooms(rooms.length ? rebalance(rooms, rooms.find((r) => r.share > 0)?.id ?? rooms[0].id) : null, rr.others_equal !== false); hap.ok(); closeSheet(); }
    catch { toast(t('err_generic')); }
  }
  const chip = (on, label, f) => html`<button class=${'bchip' + (on ? ' on' : ' off')} aria-pressed=${on ? 'true' : 'false'} onClick=${() => { hap.sel(); f(); }}>${label}</button>`;
  return html`<h2>${cur ? cur.name : t('sp_room')}</h2>
    <div class="x-form">
      <p class="e-lbl">${t('sp_room')}</p><input class="e-input" value=${name} placeholder=${t('sp_room_ph')} onInput=${(e) => setName(e.currentTarget.value)} />
      <p class="e-lbl">${t('sp_who')}</p><div class="chips">${voters.map((u) => chip(who === u, meOrName(u), () => setWho(u)))}${chip(who == null, t('sp_shared'), () => setWho(null))}</div>
      <p class="e-lbl">${t('sp_share')}</p>
      <div class="row"><button class="round sm soft" aria-label="−" onClick=${() => setShare(Math.max(0, share - 5))}><${Icon} n="minus" cls="sm" /></button>
        <b class="sh-n grow" style="font-size:22px">${share > 0 ? `${fmtNum(share)}%` : '—'}</b>
        <button class="round sm soft" aria-label="+" onClick=${() => setShare(Math.min(100, share + 5))}><${Icon} n="plus" cls="sm" /></button></div>
    </div>
    <button class="btn accent block" style="margin-top:14px" disabled=${busy || !name.trim()} onClick=${save}>${t('x_save')}</button>
    ${cur && html`<button class="btn ghost block" onClick=${del}><${Icon} n="trash-2" cls="sm" />${t('sp_delete')}</button>`}
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}
function MoneyModeSheet() {
  const d = D();
  const mode = d.money?.mode ?? 'split';
  async function set(m) {
    if (m === mode) return closeSheet();
    try { const r = await api('/app/api/money-mode', { search_id: d.search.id, mode: m }); d.money = r.money; d.search.money_mode = m; hap.ok(); toast(t('mm_saved')); closeSheet(); emit(); }
    catch { toast(t('err_generic')); }
  }
  return html`<h2>${t('mm_settings')}</h2>
    <div class="card grp">${[['split', 'scale'], ['shared', 'wallet']].map(([m, ic]) => html`<button class="opt sw-opt" aria-current=${mode === m ? 'true' : null} onClick=${() => set(m)}>
      <${Icon} n=${ic} cls="sm" /><div class="grow"><div style="font-weight:600">${t('mm_' + m + '_t')}</div><div class="muted" style="font-size:13px">${t('mm_' + m + '_s')}</div></div>${mode === m && html`<${Icon} n="check" cls="check" />`}</button>`)}</div>
    <button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
}

// ---------------------------------------------------------------- power tokens (25)
function Power() {
  const d = D();
  const pw = d.power ?? {};
  const pk = regionPack()?.power ?? null;
  const [busy, setBusy] = useState(false);
  const canAct = canVoteRole(d.me.role);
  async function shoot() {
    const [f] = await pickFiles({ capture: true });
    if (!f) return;
    setBusy(true);
    try { const r = await uploadImage('/app/api/meter-photo?search_id=' + encodeURIComponent(d.search.id), f); d.power = r.power; hap.ok(); toast(t('pw_sent')); emit(); }
    catch { toast(t('err_generic')); }
    setBusy(false);
  }
  const days = pw.days_left != null ? Math.max(0, Math.floor(pw.days_left)) : null;
  const low = days != null && days <= 5;
  const weeks = pw.weeks ?? [];
  const max = Math.max(1, ...weeks.map((w) => w.kwh));
  const tot = d.money?.totals ?? {};
  const cur = d.money?.currency ?? briefCur(d.search);
  const monthMoney = tot.power_per_month ?? (pw.month_kwh && pk?.tariff_kwh ? Math.round(pw.month_kwh * pk.tariff_kwh) : null);
  const voters = d2voters();
  const splitWord = d.money?.mode === 'shared' ? t('pw_split_shared') : voters.length === 2 ? t('pw_split_half') : t('pw_split_eq');
  const lastNote = [...(pw.readings ?? [])].reverse().find((r) => r.kind === 'reading' && r.note)?.note;
  const howTo = pk?.tokens ? pk.tokens[LANG] ?? pk.tokens.en : null;
  return html`<main class="screen w2">
    <${W3Head} kicker=${homeName()} title=${t('w3_power')} />
    ${pw.balance != null ? html`<div class=${'w3-big ' + (low ? 'mango' : 'acc')}>
        <p class="w3-big-k"><${Icon} n="zap" />${t('pw_left')}</p>
        <p class="w3-big-v">${days != null ? `${t('pw_days', { n: days })} · ` : ''}${fmtNum(Math.round(pw.balance))} ${LANG === 'ru' ? 'кВт·ч' : 'kWh'}</p>
        <p class="w3-big-s">${[pw.runout ? t('pw_topup_by', { d: LANG === 'ru' ? dfmt(new Date(Date.parse(pw.runout) - 864e5).toISOString(), { weekday: 'long' }).replace(/а$/, 'ы').replace(/^(понедельник|вторник|четверг)$/, '$1а').replace(/^воскресенье$/, 'воскресенья').replace(/^(среды|пятницы|субботы)$/, '$1') : dfmt(new Date(Date.parse(pw.runout) - 864e5).toISOString(), { weekday: 'long' }) }) : null,
          pw.daily != null ? t('pw_daily', { n: fmtNum(Math.round(pw.daily)) }) + (lastNote ? `, ${lastNote.replace(/^./, (c) => c.toLowerCase())}` : '') : null].filter(Boolean).join(' ')}</p></div>`
      : html`<div class="w3-big acc"><p class="w3-big-k"><${Icon} n="zap" />${t('pw_none_t')}</p><p class="w3-big-s">${pw.waiting_photo ? t('pw_photo_wait') : t('pw_none')}</p></div>`}
    ${weeks.length > 0 && html`<div class="card pw-chart"><p class="w3-ct">${t('pw_weeks')}</p>
      <div class="pw-bars">${weeks.map((w, i) => html`<div class="pw-col"><b>${w.kwh}</b><i class=${i === weeks.length - 1 ? 'on' : ''} style=${`height:${Math.max(8, Math.round((w.kwh / max) * 100))}%`}></i><span>${Number(w.from.slice(8))}–${Number(w.to.slice(8))}</span></div>`)}</div></div>`}
    <div class="card w2-list">
      ${monthMoney != null && html`<button class="w2-row w3-irow" onClick=${() => go(sp('money'))}><span class="sq big"><${Icon} n="wallet" /></span><div class="grow"><b>${t('pw_month', { x: money(monthMoney, cur) })}</b>
        <span>${[cap(splitWord), tot.power_per_month ? t('pw_in_money') : t('pw_month_tariff', { x: money(pk?.tariff_kwh, cur, true) })].join(' · ')}</span></div></button>`}
      ${pw.last_photo_at && html`<div class="w2-row w3-irow"><span class="sq big"><${Icon} n="camera" /></span><div class="grow"><b>${t('pw_photo_at', { d: fmtDM(pw.last_photo_at) })}</b><span>${pw.waiting_photo ? t('pw_photo_wait') : t('pw_photo_read')}</span></div></div>`}
      ${howTo && html`<div class="w2-row w3-irow"><span class="sq big"><${Icon} n="store" /></span><div class="grow"><b>${pk.prepaid ? t('pw_where') : t('pw_where_post')}</b><span>${howTo}</span></div></div>`}
    </div>
    ${canAct && html`<button class="btn accent block big" disabled=${busy} onClick=${shoot}><${Icon} n="camera" />${t('pw_shoot')}</button>`}
    <${Nav} tab="today" />
  </main>`;
}

// ---------------------------------------------------------------- visa & emergency (26)
function visaText() {
  const d = D();
  const me = d.user.id;
  const lead = Number(regionPack()?.visa?.extend_lead_days) || 7;
  const before = Number(regionPack()?.visa?.remind_days_before) || 14;
  const leaseTo = d.deal?.data?.terms?.to ?? null;
  const vis = Object.fromEntries((d.visas ?? []).map((v) => [v.user_id, v.visa_until]));
  const mine = vis[me];
  const others = Object.entries(vis).filter(([u]) => u !== me && memberById(u));
  const w = before % 7 === 0 ? (before === 7 ? t('vi_week') : t('vi_weeks', { n: before / 7 })) : t('vi_days', { n: before });
  if (!mine) return { cls: 'acc', title: t('vi_title_none'), text: t('vi_none') };
  const bad = !leaseTo || mine < leaseTo;
  const applyBy = new Date(Date.parse(mine + 'T00:00:00Z') - lead * 864e5).toISOString().slice(0, 10);
  const parts = [leaseTo ? t('vi_mine', { v: fmtDM(mine), l: fmtDM(leaseTo) }) : t('vi_mine_nolease', { v: fmtDM(mine) })];
  if (bad) parts.push(t('vi_extend', { d: fmtDM(applyBy), w }));
  for (const [u, v] of others) parts.push(t(!leaseTo || v >= leaseTo ? 'vi_other_ok' : 'vi_other_bad', { name: LANG === 'ru' ? firstName(memberById(u).name).replace(/а$/, 'и').replace(/я$/, 'и').replace(/([бвгджзклмнпрстфхцчшщ])$/, '$1а').replace(/й$/, 'я') : firstName(memberById(u).name), v: fmtDM(v) }));
  return { cls: bad && leaseTo ? 'acc' : 'ok', title: bad && leaseTo ? t('vi_title_bad') : t('vi_title_ok'), text: parts.join(' ') };
}
function nearest(places, kind, home) {
  const xs = places.filter((p) => p.kind === kind && p.lat != null);
  if (!home) return xs.find((p) => p.city === String(D().search.region).split('/')[1]) ?? xs[0] ?? null;
  return xs.map((p) => ({ p, k: km(home, [p.lat, p.lng]) })).sort((a, b) => a.k - b.k)[0]?.p ?? null;
}
function Important() {
  const d = D();
  const em = regionPack()?.emergency ?? null;
  const home = homePoint();
  const vt = visaText();
  const places = em?.places ?? [];
  const hosp = nearest(places, 'hospital', home) ?? nearest(places, 'clinic', home);
  const pharm = nearest(places, 'pharmacy', home);
  const num = (id) => em?.numbers?.find((x) => x.id === id)?.phone ?? null;
  const owner = (d.house_contacts ?? []).find((c) => c.role === 'owner') ?? (d.house_contacts ?? []).find((c) => ['manager', 'repair'].includes(c.role));
  const mins = (p) => (home && p ? minutesFor(km(home, [p.lat, p.lng])) : null);
  const row = (key, ic, title, sub, btn) => html`<div key=${key} class="w2-row w3-irow"><span class="sq big mango"><${Icon} n=${ic} /></span><div class="grow"><b>${title}</b>${sub && html`<span>${sub}</span>`}</div>${btn}</div>`;
  const callBtn = (p) => p && html`<${RoundBtn} ic="phone" label=${t('dr_call')} onClick=${() => openLink(telLink(p))} />`;
  const mapBtn = (p) => html`<${RoundBtn} ic="map-pin" label=${t('dr_map')} onClick=${() => openLink(mapLink(p.lat, p.lng))} />`;
  return html`<main class="screen w2">
    <${W3Head} kicker=${homeName()} title=${t('w3_important')} />
    <button class=${'w3-visa ' + vt.cls} onClick=${() => openSheet('visa')}><div class="w3-warn-h"><${Icon} n="stamp" /><b>${vt.title}</b></div><p>${vt.text}</p></button>
    ${em ? html`<div class="card w2-list">
      <div class="w2-lh"><span>${t('em_title')}</span></div>
      ${hosp && row('h', 'hospital', hosp.name, [t('em_' + hosp.kind) + (hosp.hours === '24/7' ? ' ' + t('em_247') : ''), mins(hosp) ? t('em_min', { n: mins(hosp) }) : null].filter(Boolean).join(' · '), hosp.phone ? callBtn(hosp.phone) : mapBtn(hosp))}
      ${pharm && row('p', 'pill', pharm.name, [t('em_pharmacy'), mins(pharm) ? t('em_min', { n: mins(pharm) }) : null].filter(Boolean).join(' · '), mapBtn(pharm))}
      ${row('n', 'siren', t('em_ambulance', { a: num('ambulance') ?? num('emergency') ?? '112', p: num('police') ?? '—' }), num('tourist_police') ? t('em_tourist', { x: num('tourist_police') }) : num('emergency') ? `112 · ${num('emergency')}` : null, callBtn(num('ambulance') ?? num('emergency')))}
      ${em.power && row('w', 'zap-off', em.power.label?.[LANG] ?? em.power.label?.en ?? em.power.name, [`${em.power.name} ${em.power.phone ?? ''}`.trim(), regionPack()?.power?.prepaid ? t('em_power_tokens') : null].filter(Boolean).join(' · '), callBtn(em.power.phone))}
      ${owner && row('o', 'droplet', t('em_broken'), [`${owner.name}, ${roleLabelHC(owner.role)}`, owner.note].filter(Boolean).join(' · '), owner.channel === 'phone' || owner.channel === 'whatsapp' ? callBtn(owner.address) : channelLink(owner.channel, owner.address) && html`<${RoundBtn} ic="message-circle" label=${t('dr_write')} onClick=${() => openLink(channelLink(owner.channel, owner.address))} />`)}
    </div>` : html`<div class="card" style="padding:16px"><p class="muted" style="margin:0">${t('em_none')}</p></div>`}
    <p class="w2-foot">${t('em_foot')}</p>
    <${Nav} tab="today" />
  </main>`;
}
function VisaSheet() {
  const d = D();
  const mine = (d.visas ?? []).find((v) => v.user_id === d.user.id)?.visa_until ?? '';
  const [v, setV] = useState(mine);
  async function save(val) {
    try {
      await api('/app/api/visa', { search_id: d.search.id, until: val || null });
      d.visas = [...(d.visas ?? []).filter((x) => x.user_id !== d.user.id), ...(val ? [{ user_id: d.user.id, visa_until: val }] : [])];
      hap.ok(); toast(t('vi_saved')); closeSheet(); emit();
    } catch { toast(t('err_generic')); }
  }
  return html`<h2>${t('vi_sheet')}</h2><p class="muted" style="margin:0 0 12px">${t('vi_sheet_text')}</p>
    <input class="e-input" type="date" value=${v} onInput=${(e) => setV(e.currentTarget.value)} />
    <button class="btn accent block" style="margin-top:12px" disabled=${!v} onClick=${() => save(v)}>${t('x_save')}</button>
    ${mine && html`<button class="btn ghost block" onClick=${() => save(null)}>${t('vi_clear')}</button>`}
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}

// ---------------------------------------------------------------- places near (27)
const AT_ICON = { surf: 'waves', beach: 'tree-palm', cowork: 'laptop', gym: 'dumbbell', yoga: 'heart-pulse', shop: 'shopping-cart', school: 'school', airport: 'plane', work: 'briefcase', friends: 'users', cafe: 'coffee', other: 'map-pin' };
const AT_TYPES = Object.keys(AT_ICON);
function anchorsOf() {
  const b = D()?.search?.brief ?? {};
  const out = [...(b.anchors ?? [])];
  if (b.anchor && !out.some((a) => a.id === 'anchor')) {
    const type = b.anchor.icon === 'waves' ? 'surf' : b.anchor.icon === 'plane' ? 'airport' : 'other';
    out.unshift({ id: 'anchor', name: b.anchor.label ?? '—', type, lat: b.anchor.lat, lng: b.anchor.lng, max_minutes: b.anchor.max_minutes ?? null, legacy: true });
  }
  return out;
}
/** Minutes from a listing to an anchor: the agent's route time, else a straight-line estimate (est: true). */
function travelTo(l, a) {
  const tr = l?.travel?.[a.id];
  if (tr?.min != null) return { min: tr.min, mode: tr.mode ?? a.mode, est: false };
  if (l?.lat == null || a.lat == null) return null;
  return { min: minutesFor(km([l.lat, l.lng], [a.lat, a.lng])), mode: a.mode, est: true };
}
function modeWord(m) {
  if (m === 'walk' || m === 'pedestrian') return t('pl_walk');
  if (m === 'car' || m === 'auto') return t('pl_car');
  if (m === 'taxi') return t('pl_taxi');
  if (m === 'scooter' || m === 'motor_scooter') return t('pl_by');
  const r = D()?.search?.brief?.travel_mode || subRegion()?.travel?.mode || '';
  return /scooter/.test(r) ? t('pl_by') : /taxi|car/.test(r) ? t('pl_taxi') : '';
}
function placesSummary(l) {
  const as = anchorsOf();
  if (!as.length) return null;
  const tr = as.map((a) => ({ a, x: travelTo(l, a) })).filter((y) => y.x);
  if (!tr.length) return null;
  const lim = tr.filter((y) => y.a.max_minutes);
  const ok = lim.filter((y) => y.x.min <= y.a.max_minutes);
  const over = lim.filter((y) => y.x.min > y.a.max_minutes);
  return [lim.length ? t('pl_row', { n: ok.length, m: lim.length }) : null, ...over.slice(0, 2).map((y) => `${y.a.name} ${y.x.est ? '~' : ''}${y.x.min}`)].filter(Boolean).join(' · ');
}
function shortlistCompare(l) {
  const others = likedList(D()).filter((x) => x.id !== l.id);
  const as = anchorsOf();
  const close = [], far = [];
  for (const a of as) {
    const me = travelTo(l, a);
    if (!me) continue;
    const os = others.map((o) => ({ o, x: travelTo(o, a) })).filter((y) => y.x);
    if (!os.length) continue;
    const name = a.type && a.type !== 'other' && as.filter((y) => y.type === a.type).length === 1 ? t('at_' + a.type) : a.name;
    if (os.every((y) => me.min < y.x.min)) close.push(name);
    else {
      const better = os.filter((y) => y.x.min + 4 < me.min).sort((p, q) => p.x.min - q.x.min).slice(0, 2);
      if (better.length && (a.max_minutes ? me.min > a.max_minutes : true)) far.push({ name, list: better.map((y) => `${districtShort(y.o) || shortTitle(y.o.title)} (${t('em_min', { n: y.x.min })})`) });
    }
  }
  const andW = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} ${t('and')} ${xs[xs.length - 1]}` : xs[0]);
  const parts = [];
  if (close.length) parts.push(t('pl_closest', { a: andW(close.slice(0, 2)) }));
  for (const f of far.slice(0, 1)) parts.push(t('pl_farther', { a: cap(f.name), list: andW(f.list) }));
  return parts.length ? parts.join(' ') : others.length ? t('pl_same') : null;
}
function Places({ id }) {
  const d = D();
  const l = listingById(id);
  if (!l) return html`<main class="screen no-nav"><div class="center-msg">—</div></main>`;
  const as = anchorsOf();
  const canEdit = canVoteRole(d.me.role);
  const sub = [districtShort(l), l.bedrooms != null ? t('br', { n: l.bedrooms }) : null, priceText(l)].filter(Boolean).join(' · ');
  const cmp = shortlistCompare(l);
  let anyEst = false;
  return html`<main class="screen w2">
    <${W2Head} l=${l} title=${shortTitle(l.title)} sub=${sub} />
    <div class="card w2-list">
      <div class="w2-lh"><span>${t('pl_title')}</span>${canEdit && html`<button class="w2-add" onClick=${() => openSheet('anchor_add')}><${Icon} n="plus" cls="sm" />${t('add')}</button>`}</div>
      ${as.length ? as.map((a) => {
        const x = travelTo(l, a);
        if (x?.est) anyEst = true;
        const over = x && a.max_minutes && x.min > a.max_minutes;
        const mw = x ? modeWord(x.mode) : '';
        const txt = x ? `${x.est ? '~' : ''}${t('em_min', { n: x.min })}${mw ? ' ' + mw : ''}${over ? ' · ' + t('pl_limit', { n: a.max_minutes }) : ''}` : '—';
        return html`<button key=${a.id} class="w2-row w3-irow" onClick=${() => openSheet('anchor', a.id)}><span class=${'sq big' + (over ? ' mango' : '')}><${Icon} n=${AT_ICON[a.type] ?? 'map-pin'} /></span>
          <div class="grow"><b>${a.name}</b><span class=${over ? 'pl-over' : ''}>${txt}</span></div>
          ${x && a.max_minutes ? html`<${Icon} n=${over ? 'circle-alert' : 'circle-check'} cls=${over ? 'pl-ic-over' : 'pl-ic-ok'} />` : null}</button>`;
      }) : html`<div class="w2-row"><span class="muted">${t('pl_none')}</span></div>`}
    </div>
    ${cmp && html`<div class="card w3-text"><p class="w3-ct">${t('pl_cmp')}</p><p>${cmp}</p></div>`}
    <p class="w2-foot">${t('pl_foot')}${anyEst ? ' ' + t('pl_est') : ''}</p>
    <${Nav} tab="listings" />
  </main>`;
}
function AnchorAddSheet() {
  const d = D();
  const [name, setName] = useState('');
  const [type, setType] = useState('surf');
  const [where, setWhere] = useState('');
  const [max, setMax] = useState(20);
  const [mode, setMode] = useState(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    const m = where.trim().match(/^(-?\d{1,2}\.\d+)\s*[,; ]\s*(-?\d{1,3}\.\d+)$/);
    const anchor = { name: name.trim(), type, max_minutes: max, mode, ...(m ? { lat: Number(m[1]), lng: Number(m[2]) } : { map_url: where.trim() }) };
    if (!anchor.name || !where.trim()) return;
    setBusy(true);
    try {
      const r = await api('/app/api/anchor', { search_id: d.search.id, anchor });
      d.search.brief.anchors = r.anchors;
      hap.ok(); toast(t('pl_saved')); closeSheet(); emit();
    } catch (e) { toast(e.code === 'no_point' ? t('pl_bad_point') : t('err_generic')); }
    setBusy(false);
  }
  const chip = (on, label, f, ic) => html`<button class=${'bchip' + (on ? ' on' : ' off')} aria-pressed=${on ? 'true' : 'false'} onClick=${() => { hap.sel(); f(); }}>${ic && html`<${Icon} n=${ic} cls="xs" />`}${label}</button>`;
  return html`<h2>${t('pl_add')}</h2>
    <div class="x-form">
      <p class="e-lbl">${t('pl_name')}</p><input class="e-input" value=${name} placeholder=${t('pl_name_ph')} onInput=${(e) => setName(e.currentTarget.value)} />
      <p class="e-lbl">${t('pl_type')}</p><div class="chips">${AT_TYPES.map((k) => chip(type === k, t('at_' + k), () => setType(k), AT_ICON[k]))}</div>
      <p class="e-lbl">${t('pl_where')}</p><input class="e-input" value=${where} placeholder=${t('pl_where_ph')} onInput=${(e) => setWhere(e.currentTarget.value)} />
      <p class="e-lbl">${t('pl_max')}</p><div class="chips">${[10, 15, 20, 30, 45, 60].map((n) => chip(max === n, String(n), () => setMax(n)))}</div>
      <p class="e-lbl">${t('pl_mode')}</p><div class="chips">${[['scooter', 'pl_by'], ['car', 'pl_car'], ['walk', 'pl_walk']].map(([k, s]) => chip(mode === k, t(s), () => setMode(mode === k ? null : k)))}</div>
    </div>
    <button class="btn accent block" style="margin-top:14px" disabled=${busy || !name.trim() || !where.trim()} onClick=${save}>${t('x_save')}</button>
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}
function AnchorSheet({ id }) {
  const d = D();
  const a = anchorsOf().find((x) => x.id === id);
  if (!a) return html`<p class="muted">—</p><button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
  async function del() {
    try { const r = await api('/app/api/anchor', { search_id: d.search.id, remove: a.id }); d.search.brief.anchors = r.anchors; hap.ok(); toast(t('pl_removed')); closeSheet(); emit(); }
    catch { toast(t('err_generic')); }
  }
  const link = mapLink(a.lat, a.lng, a.map_url);
  return html`<h2>${a.name}</h2><p class="muted" style="margin:0 0 12px">${[t('at_' + a.type), a.max_minutes ? t('pl_limit', { n: a.max_minutes }) : null].filter(Boolean).join(' · ')}</p>
    ${link && html`<button class="btn surface block" style="margin-bottom:8px" onClick=${() => openLink(link)}><${Icon} n="map-pin" cls="sm" />${t('pl_open_map')}</button>`}
    ${!a.legacy && canVoteRole(d.me.role) && html`<button class="btn ghost block" onClick=${del}><${Icon} n="trash-2" cls="sm" />${t('pl_remove')}</button>`}
    <button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
}

// ---------------------------------------------------------------- districts (28, 28b, 28c)
const SCORE_KEYS = ['surf', 'quiet', 'no_traffic', 'food', 'coworking', 'nightlife'];
const geoCache = {};
function useAreasGeo(country) {
  const [g, setG] = useState(geoCache[country] ?? null);
  useEffect(() => {
    if (!country || geoCache[country]) { setG(geoCache[country] ?? null); return; }
    fetch(`/art/${country}/districts.geojson`).then((r) => (r.ok ? r.json() : null)).then((j) => { geoCache[country] = j; setG(j); }).catch(() => null);
  }, [country]);
  return g;
}
function inRing(pt, ring) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
function inGeom(pt, g) {
  const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
  return polys.some((p) => inRing(pt, p[0]) && !p.slice(1).some((h) => inRing(pt, h)));
}
function areaOf(l, geo, areas) {
  if (l.lat != null && l.lng != null && geo) {
    const f = geo.features.find((x) => inGeom([l.lng, l.lat], x.geometry));
    if (f) return f.properties.id;
  }
  if (l.district && areas) for (const [id, a] of Object.entries(areas)) if (id === l.district || (a.districts ?? []).includes(l.district)) return id;
  return null;
}
/** "2 сп" — or "2-комн." in Kazakhstan, where the pack prices are per number of rooms. */
const dsBr = (n) => (S.regions?.[D()?.search?.country]?.rooms === 'total' ? t('ds_rooms', { n }) : t('ds_br', { n }));
const briefBeds = () => {
  const b = (D()?.search?.brief?.bedrooms ?? []).map((x) => parseInt(x, 10)).filter((x) => x > 0);
  return b[0] ?? 2;
};
function briefWeights(b) {
  const w = { surf: 0.5, quiet: 1, no_traffic: 1, food: 1, coworking: 0.5, nightlife: 0.5 };
  if (b.priorities && typeof b.priorities === 'object') { for (const k of SCORE_KEYS) if (Number.isFinite(Number(b.priorities[k]))) w[k] = Number(b.priorities[k]); return w; }
  const txt = [b.must_have, b.nice_to_have, b.deal_breakers, b.style, b.transport, (b.anchors ?? []).map((a) => a.type).join(' '), b.anchor?.icon === 'waves' ? 'surf' : ''].filter(Boolean).join(' ').toLowerCase();
  if (/серф|surf|волн/.test(txt)) w.surf = 2;
  if (/тих|quiet|calm|спокой|стройк|construction/.test(txt) || b.construction_tolerance === 'dealbreaker') w.quiet = 2;
  if (/пробк|traffic/.test(txt)) w.no_traffic = 2;
  if (/кафе|еда|food|cafe|рестора/.test(txt)) w.food = 1.5;
  if (/коворк|cowork|удалён|remote/.test(txt)) w.coworking = 2;
  if (/тусов|party|nightlife|клуб/.test(txt)) w.nightlife = 2;
  return w;
}
function fitPct(id, a) {
  const b = D()?.search?.brief ?? {};
  const w = briefWeights(b);
  let s = 0, m = 0;
  for (const [k, x] of Object.entries(w)) { const v = Number(a.scores?.[k]); if (!v || !(x > 0)) continue; s += x * v; m += x * 5; }
  let p = m ? (s / m) * 100 : 50;
  const bd = b.districts ?? [];
  if (bd.includes(id) || (a.districts ?? []).some((x) => bd.includes(x))) p += 8;
  const lo = a.price?.[String(briefBeds())]?.[0];
  if (b.budget_max && lo && lo > b.budget_max) p -= 15;
  // Wave 4: the average location score of the search's listings in the area pulls the fit towards it.
  const geo = geoCache[D()?.search?.country];
  const sc = geo ? (D()?.listings ?? []).filter((l) => l.location_score != null && areaOf(l, geo, regionPack()?.areas) === id).map((l) => l.location_score) : [];
  if (sc.length) p = 0.6 * p + 0.4 * (sc.reduce((x, y) => x + y, 0) / sc.length);
  return Math.max(5, Math.min(99, Math.round(p)));
}
/** Listings of this search inside the area + a price range for `beds` bedrooms (quartiles of ≥3 listings, else the pack). */
function areaStats(id, a, geo, beds = briefBeds()) {
  const d = D();
  const ls = d.listings.filter((l) => areaOf(l, geo, regionPack()?.areas) === id);
  const prices = ls.filter((l) => Number(l.bedrooms) === beds && l.price > 0).map((l) => Number(l.price)).sort((x, y) => x - y);
  const q = (p) => prices[Math.min(prices.length - 1, Math.max(0, Math.round(p * (prices.length - 1))))];
  const range = prices.length >= 3 ? [q(0.25), q(0.75)] : a.price?.[String(beds)] ?? null;
  return { listings: ls, range, fromCrm: prices.length >= 3, n: prices.length };
}
const rangeText = (r, cur) => (r ? (r[0] === r[1] ? money(r[0], cur) : `${scaled(r[0], r[1])}–${money(r[1], cur)}`) : '—');
const areaName = (a) => a?.name?.[LANG] ?? a?.name?.en ?? '';
function inBrief(id, a) {
  const bd = D()?.search?.brief?.districts ?? [];
  return bd.includes(id);
}
async function addAreaToBrief(id, a) {
  const d = D();
  try {
    if (d.me.role === 'owner') {
      const r = await api('/app/api/brief', { search_id: d.search.id, brief: { districts: [...new Set([...(d.search.brief.districts ?? []), id])] } }, 'PATCH');
      if (r.brief) d.search.brief = { ...d.search.brief, districts: r.brief.districts };
      toast(t('ds_added'));
    } else {
      await postInstruction(`${t('ds_to_brief')}: ${areaName(a)} (${id})`, 'brief_area', id);
      toast(t('ds_asked'));
    }
    hap.ok();
    emit();
  } catch { toast(t('err_generic')); }
}
function labelPoint(geom, center) {
  const polys = geom?.type === 'Polygon' ? [geom.coordinates] : geom?.coordinates ?? [];
  let best = null, bestA = 0;
  for (const p of polys) {
    const r = p[0];
    let A = 0, cx = 0, cy = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const f = r[j][0] * r[i][1] - r[i][0] * r[j][1]; A += f; cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f; }
    if (Math.abs(A) > bestA) { bestA = Math.abs(A); best = [cx / (3 * A), cy / (3 * A)]; }
  }
  if (center && geom && inGeom([center[1], center[0]], geom)) return [center[1], center[0]];
  return best;
}
function geomBounds(ml, geom) {
  const b = new ml.LngLatBounds();
  const polys = geom?.type === 'Polygon' ? [geom.coordinates] : geom?.coordinates ?? [];
  for (const p of polys) for (const pt of p[0]) b.extend(pt);
  return b;
}
async function districtStyle() {
  const st = await mapStyle();
  for (const l of st.layers) if (l.type === 'symbol') (l.layout ??= {}).visibility = 'none';
  return st;
}
function DistrictsMap({ sel: sel0 }) {
  const d = D();
  const s = d.search;
  const areas = regionPack()?.areas ?? {};
  const geo = useAreasGeo(s.country);
  const [sel, setSel] = useState(sel0 && areas[sel0] ? sel0 : null);
  const [ready, setReady] = useState(false);
  const [fail, setFail] = useState(false);
  const box = useRef(null);
  const mapR = useRef(null);
  const marks = useRef([]);
  const theme = useThemeKey();
  useEffect(() => {
    let dead = false;
    setReady(false);
    loadML().then(async (ml) => {
      const style = await districtStyle();
      if (dead || !box.current) return;
      const c = subRegion()?.center ?? Object.values(areas)[0]?.center ?? [0, 0];
      const map = new ml.Map({ container: box.current, style, center: [c[1], c[0]], zoom: 10, attributionControl: false, dragRotate: false, pitchWithRotate: false, fadeDuration: 0 });
      map.touchZoomRotate.disableRotation();
      mapR.current = map;
      map.on('load', () => !dead && setReady(true));
    }).catch(() => !dead && setFail(true));
    return () => { dead = true; marks.current.forEach((m) => m.remove()); marks.current = []; mapR.current?.remove(); mapR.current = null; };
  }, [theme]);
  // Outlines + fills; the first time also fits the city's areas.
  useEffect(() => {
    const map = mapR.current;
    const ml = window.maplibregl;
    if (!ready || !map || !ml || !geo) return;
    const accent = cssVar('--map-accent'), ink2 = cssVar('--ink-2'), s2 = cssVar('--map-fill');
    if (!map.getSource('areas')) {
      map.addSource('areas', { type: 'geojson', data: geo, promoteId: 'id' });
      map.addLayer({ id: 'areas-fill', type: 'fill', source: 'areas', paint: { 'fill-color': ['case', ['boolean', ['feature-state', 'sel'], false], accent, s2], 'fill-opacity': ['case', ['boolean', ['feature-state', 'sel'], false], 0.2, 0.45] } });
      map.addLayer({ id: 'areas-line', type: 'line', source: 'areas', layout: { 'line-join': 'round' }, paint: { 'line-color': ['case', ['boolean', ['feature-state', 'sel'], false], accent, ink2], 'line-width': ['case', ['boolean', ['feature-state', 'sel'], false], 3, 1.4], 'line-opacity': ['case', ['boolean', ['feature-state', 'sel'], false], 1, 0.75] } });
      map.on('click', 'areas-fill', (e) => { const id = e.features?.[0]?.properties?.id; if (id) { hap.sel(); setSel(id); } });
      map.on('mouseenter', 'areas-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'areas-fill', () => { map.getCanvas().style.cursor = ''; });
      const city = String(s.region).split('/')[1];
      const cc = subRegion()?.center;
      const near = geo.features.filter((f) => { const a = areas[f.properties.id]; return a && (a.city === city || (cc && a.center && km(cc, a.center) < 30)); });
      const b = new ml.LngLatBounds();
      for (const f of near.length ? near : geo.features) b.extend(geomBounds(ml, f.geometry));
      const sheetH = document.querySelector('.ds-sheet')?.getBoundingClientRect().height ?? 0;
      if (!b.isEmpty()) map.fitBounds(b, { padding: { top: 90, bottom: sheetH ? sheetH + 10 : 40, left: 24, right: 24 }, duration: 0, maxZoom: 13 });
    }
  }, [ready, geo]);
  // Selection: highlight, labels, bring the area into view above the sheet.
  useEffect(() => {
    const map = mapR.current;
    const ml = window.maplibregl;
    if (!ready || !map || !ml || !geo || !map.getSource('areas')) return;
    for (const f of geo.features) map.setFeatureState({ source: 'areas', id: f.properties.id }, { sel: f.properties.id === sel });
    marks.current.forEach((m) => m.remove());
    marks.current = [];
    for (const f of geo.features) {
      const a = areas[f.properties.id];
      const pt = labelPoint(f.geometry, a?.center);
      if (!pt) continue;
      const el = document.createElement('button');
      el.className = 'ds-label' + (f.properties.id === sel ? ' sel' : '');
      el.textContent = areaName(a) || f.properties.name_en;
      el.addEventListener('click', (e) => { e.stopPropagation(); hap.sel(); setSel(f.properties.id); });
      el.style.zIndex = f.properties.id === sel ? '5' : '1';
      marks.current.push(new ml.Marker({ element: el, anchor: 'center' }).setLngLat(pt).addTo(map));
    }
    if (sel) {
      const f = geo.features.find((x) => x.properties.id === sel);
      if (f) {
        const b = geomBounds(ml, f.geometry);
        const view = map.getBounds();
        const H = box.current.clientHeight;
        const sheetH = document.querySelector('.ds-sheet')?.getBoundingClientRect().height ?? H * 0.45;
        const nw = map.unproject([30, 80]), se = map.unproject([box.current.clientWidth - 30, H - sheetH - 20]);
        const visible = b.getWest() > nw.lng && b.getEast() < se.lng && b.getNorth() < nw.lat && b.getSouth() > se.lat;
        if (!visible || !view.contains(b.getCenter())) map.fitBounds(b, { padding: { top: 110, bottom: sheetH + 40, left: 60, right: 60 }, maxZoom: 12, duration: reduceMotion() ? 0 : 450 });
      }
    }
  }, [ready, geo, sel, LANG]);
  const a = sel ? areas[sel] : null;
  const st = a ? areaStats(sel, a, geo) : null;
  const pct = a ? fitPct(sel, a) : 0;
  const cur = briefCur(s);
  const tile2 = a ? (a.ocean_min != null && a.ocean_min > 30 ? [minLabel(a.ocean_min), t('ds_ocean')] : a.airport_min != null ? [minLabel(a.airport_min), t('ds_airport')] : a.ocean_min != null ? [minLabel(a.ocean_min), t('ds_ocean')] : null) : null;
  const rname = regionPack()?.name;
  const regionWord = rname ? (LANG === 'ru' ? rname.ru : rname.en) : '';
  return html`<main class="map-screen ds-screen">
    <div class="map" ref=${box} role="application" aria-label=${t('ds_mode')}></div>
    <div class="map-top ds-top">
      <button class="ds-pill" onClick=${() => go(sp('map'), true)}><${Icon} n="map" />${regionWord ? t('ds_map', { r: regionWord }) : t('ds_map_plain')}</button>
      ${!sel && html`<span class="ds-hint">${t('ds_hint')}</span>`}
      ${sel && html`<span class="ds-hint">${t('ds_hint')}</span>`}
    </div>
    ${fail && html`<div class="center-msg" style="position:absolute;inset:40% 0 auto">${t('map_fail')}</div>`}
    ${a ? html`<div class="ds-sheet" role="dialog" aria-label=${areaName(a)}><div class="grip"></div>
      <button class="ds-hd" onClick=${() => go(sp('district', sel))}><h2 class="ds-name">${areaName(a)}</h2><span class=${'ds-fit ' + (pct >= 75 ? 'hi' : pct >= 50 ? 'mid' : 'lo')}>${t('ds_fit', { n: pct })}</span></button>
      <div class="chips ds-tags">${(a.tags?.[LANG] ?? a.tags?.en ?? []).map((x) => html`<span class="ds-tag">${x}</span>`)}</div>
      <p class="ds-vibe">${a.vibe?.[LANG] ?? a.vibe?.en}</p>
      ${a.flood && html`<p class=${'ds-flood ' + a.flood.level}><${Icon} n="cloud-rain" cls="sm" />${t('ds_flood', { x: t('fl_' + a.flood.level) })}</p>`}
      <div class="w3-tiles ds-tiles">
        <div class="card"><b>${rangeText(st.range, cur)}</b><span>${dsBr(briefBeds())}</span></div>
        <div class="card"><b>${tile2 ? tile2[0] : '—'}</b><span>${tile2 ? tile2[1] : ''}</span></div>
        <div class="card"><b>${st.listings.length}</b><span>${t('ds_listings', { n: st.listings.length })}</span></div>
      </div>
      <div class="ds-btns">
        <button class="btn accent big" onClick=${() => go(sp('listings', 'area-' + sel))}>${t('ds_here')}</button>
        ${inBrief(sel, a) ? html`<button class="btn outline big" disabled><${Icon} n="check" />${t('ds_in_brief')}</button>`
          : html`<button class="btn outline big" disabled=${!canVoteRole(d.me.role)} onClick=${() => addAreaToBrief(sel, a)}><${Icon} n="plus" />${t('ds_to_brief')}</button>`}
      </div></div>` : html`<${Nav} tab="map" />`}
    <span class="attrib" style=${a ? 'display:none' : ''}>© OpenFreeMap © OpenStreetMap</span>
  </main>`;
}
function DistrictDetail({ id }) {
  const d = D();
  const a = regionPack()?.areas?.[id];
  const geo = useAreasGeo(d.search.country);
  if (!a) return html`<main class="screen no-nav"><div class="center-msg">—</div></main>`;
  const pct = fitPct(id, a);
  const cur = briefCur(d.search);
  const beds = briefBeds();
  const b2 = [beds, beds + 1];
  const stats = b2.map((n) => areaStats(id, a, geo, n));
  const crmN = stats.reduce((x, s0) => x + (s0.fromCrm ? s0.n : 0), 0);
  const L = (o) => o?.[LANG] ?? o?.en ?? [];
  return html`<main class="screen w2 no-nav">
    <div class="head w3-head"><div class="row" style="align-items:flex-start"><${BackIfWeb} /><div><p class="kicker">${L(a.group)}</p><h1 class="h1 w3-h1">${areaName(a)}</h1></div></div>
      <div class=${'ds-badge ' + (pct >= 75 ? 'hi' : pct >= 50 ? 'mid' : 'lo')}><b>${pct}</b><span>${t('ds_fit_short')}</span></div></div>
    <p class="ds-vibe big">${L(a.vibe)}</p>
    ${a.flood && html`<div class="card w2-list"><div class="w2-row w3-irow"><${Icon} n="cloud-rain" cls=${a.flood.level === 'low' ? 'pl-ic-ok' : 'pl-ic-over'} /><div class="grow"><b>${t('ds_flood', { x: t('fl_' + a.flood.level) })}</b><span>${L(a.flood.note)}</span></div></div></div>`}
    <div class="card ds-scores"><p class="w3-ct">${t('ds_scores')}</p>
      ${SCORE_KEYS.filter((k) => a.scores?.[k] != null).map((k) => html`<div class="ds-sc"><span>${t('sc_' + k)}</span><div class="ds-seg" role="img" aria-label=${`${a.scores[k]} / 5`}>${[1, 2, 3, 4, 5].map((i) => html`<i class=${i <= a.scores[k] ? 'on' : ''}></i>`)}</div></div>`)}
    </div>
    <div class="w3-tiles">
      ${b2.map((n, i) => html`<div class="card"><b>${rangeText(stats[i].range, cur)}</b><span>${dsBr(n)}</span></div>`)}
      <div class="card"><b>${a.airport_min != null ? minLabel(a.airport_min) : a.ocean_min != null ? minLabel(a.ocean_min) : '—'}</b><span>${a.airport_min != null ? t('ds_airport') : t('ds_ocean')}</span></div>
    </div>
    <div class="ds-pc">
      <div class="card"><p class="pros">${t('ds_pros')}</p>${L(a.pros).map((x) => html`<p>· ${x}</p>`)}</div>
      <div class="card"><p class="cons">${t('ds_cons')}</p>${L(a.cons).map((x) => html`<p>· ${x}</p>`)}</div>
    </div>
    <div class="ds-btns" style="margin-top:14px">
      <button class="btn accent big" onClick=${() => go(sp('listings', 'area-' + id))}>${t('ds_here')}</button>
      ${inBrief(id, a) ? html`<button class="btn outline big" disabled><${Icon} n="check" />${t('ds_in_brief')}</button>`
        : html`<button class="btn outline big" disabled=${!canVoteRole(d.me.role)} onClick=${() => addAreaToBrief(id, a)}><${Icon} n="plus" />${t('ds_to_brief')}</button>`}
    </div>
    <p class="w2-foot">${crmN ? t('ds_foot_crm', { n: crmN }) : t('ds_foot_pack')}</p>
  </main>`;
}

// ---------------------------------------------------------------- re-let (29)
const LS_CLS = { viewing: 'ok', agreed: 'ok', reply: 'wait', new: 'acc', not_suitable: '' };
function chLabel(c) {
  if (c.label) return c.label;
  const k = c.kind;
  if (STR[LANG]['ch_' + k]) return typeof STR[LANG]['ch_' + k] === 'function' ? t('ch_' + k, { n: c.count ?? 1 }) : t('ch_' + k);
  return human(k);
}
function monthsBetween(a, b) {
  return Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / (30.44 * 864e5)));
}
function Relet() {
  const d = D();
  const r = d.relet;
  const l = dealListing();
  const [busy, setBusy] = useState(false);
  // Pack rule (housing_ads): relet 'plain_with_consent' = post only after the owner agrees and only as a normal rental;
  // 'friends_only' = privately to people the members know. Roommate ads are never posted (agent rule).
  const ha = regionPack()?.housing_ads;
  const rmode = ha?.relet ?? (ha?.mode === 'friends_only' ? 'friends_only' : null);
  const noteKey = rmode === 'friends_only' ? 'rl_friends' : rmode === 'plain_with_consent' ? (r?.consent === 'yes' ? 'rl_plain_ok' : 'rl_plain_wait') : null;
  const note = noteKey && html`<p class="rl-note"><${Icon} n="shield-alert" cls="sm" /><span>${t(noteKey)}</span></p>`;
  const askKey = rmode === 'friends_only' ? 'friends' : rmode === 'plain_with_consent' ? 'plain' : '';
  async function ask() {
    setBusy(true);
    try { await postInstruction(t(askKey ? 'rl_ask_text_' + askKey : 'rl_ask_text'), 'relet', 'relet'); hap.ok(); toast(t(askKey ? 'rl_asked_' + askKey : 'rl_asked')); } catch { toast(t('err_generic')); }
    setBusy(false);
  }
  const kicker = `${homeName()} · ${t('rl_kicker')}`;
  if (!r) return html`<main class="screen w2"><${W3Head} kicker=${kicker} title=${t('rl_title')} />
    ${note}<div class="card" style="padding:18px"><p style="margin:0 0 14px">${t('rl_none')}</p>${canVoteRole(d.me.role) && html`<button class="btn accent block" disabled=${busy} onClick=${ask}><${Icon} n="sparkles" />${t('rl_ask')}</button>`}</div><${Nav} tab="today" /></main>`;
  const photos = (r.photos?.length ? r.photos : l?.photos ?? []).map(photoUrl).filter(Boolean).slice(0, 3);
  const head = [r.date_from && r.date_to ? t('rl_months', { n: monthsBetween(r.date_from, r.date_to) }) : null, r.date_from && r.date_to ? `${fmtDM(r.date_from)} – ${fmtDM(r.date_to)}` : null, r.price ? `${money(r.price, r.currency)}${t('per_month')}` : null].filter(Boolean).join(' · ');
  const leads = r.leads ?? [];
  return html`<main class="screen w2">
    <${W3Head} kicker=${kicker} title=${t('rl_title')} />
    <div class="m-hero rl-hero"><p class="rl-h">${head || '—'}</p>
      <p class="rl-c"><${Icon} n=${r.consent === 'yes' ? 'circle-check' : r.consent === 'no' ? 'circle-x' : 'circle-help'} cls=${'c-' + r.consent} />${r.consent_note || t('rl_c_' + r.consent)}</p></div>
    ${note}
    <div class="card rl-ad"><p class="w3-ct">${t('rl_ad')}</p>
      ${photos.length > 0 && html`<div class="rl-ph">${photos.map((p) => html`<img src=${p} alt="" loading="lazy" decoding="async" />`)}</div>`}
      ${r.ad_text && html`<p class="rl-txt">${r.ad_text}</p>`}
      ${(r.channels ?? []).length > 0 && html`<div class="chips">${r.channels.map((c) => html`<span class="ds-tag">${chLabel(c)}</span>`)}</div>`}
    </div>
    <div class="card w2-list">
      <div class="w2-lh"><span>${t('rl_leads', { n: leads.length })}</span></div>
      ${leads.length ? leads.map((x) => {
        const link = x.channel && x.address ? channelLink(x.channel, x.address) : null;
        const Tag = link ? 'button' : 'div';
        return html`<${Tag} key=${x.id} class="w2-row rl-row" onClick=${link ? () => openLink(link) : null}><div class="grow"><b>${x.name}</b>${x.note && html`<span>${x.note}</span>`}</div><span class=${'st2 ' + (LS_CLS[x.status] ?? '')}>${t('ls_' + x.status)}</span></${Tag}>`;
      }) : html`<div class="w2-row"><span class="muted">${t('rl_no_leads')}</span></div>`}
    </div>
    <${Nav} tab="today" />
  </main>`;
}

// ---------------------------------------------------------------- contacts directory (30)
const DG_BUILTIN = ['home', 'bikes', 'food', 'services', 'health'];
const DG_ICON = { home: 'house', bikes: 'bike', food: 'shopping-cart', services: 'shirt', health: 'pill' };
const dgName = (k, long = false) => {
  if (DG_BUILTIN.includes(k)) return long && STR[LANG]['dgl_' + k] ? t('dgl_' + k) : t('dg_' + k);
  return (D()?.search?.dir_groups ?? D()?.dir_groups ?? []).find((g) => g.key === k)?.name ?? k;
};
function dirEntries() {
  const d = D();
  const hc = (d.house_contacts ?? []).map((c) => ({ id: 'hc:' + c.id, grp: 'home', name: c.name, subtitle: hcSub(c), channel: c.channel === 'whatsapp' || c.channel === 'telegram' ? c.channel : c.channel === 'phone' ? 'phone' : null, address: c.address, phone: c.channel === 'whatsapp' || c.channel === 'phone' ? c.address : null, icon: c.role === 'owner' ? 'key-round' : c.role === 'cleaning' ? 'sparkles' : c.role === 'pool' ? 'waves' : 'house', house: true, contact_id: c.contact_id }));
  return [...hc, ...(d.directory ?? [])];
}
let dirSeg = 'all';
function Directory() {
  const d = D();
  const [seg, setSeg0] = useState(dirSeg);
  const setSeg = (k) => { dirSeg = k; setSeg0(k); };
  const all = dirEntries();
  const custom = (d.search.dir_groups ?? []).map((g) => g.key);
  const groups = [...DG_BUILTIN.filter((k) => k !== 'health' || all.some((e) => e.grp === 'health')), ...custom];
  const shown = (seg === 'all' ? groups : [seg]).map((k) => ({ k, items: all.filter((e) => e.grp === k) })).filter((g) => g.items.length || seg !== 'all');
  const canEdit = canVoteRole(d.me.role);
  useOrders(); // wave 10: suppliers get "Заказать"
  const write = (e) => (e.channel === 'whatsapp' ? channelLink('whatsapp', e.address) : e.channel === 'telegram' ? channelLink('telegram', e.address) : null);
  return html`<main class="screen w2">
    <${W3Head} kicker=${[districtShort(dealListing()) || homeName(), t('dr_kicker')].join(' · ')} title=${t('dr_title')}
      right=${canEdit && html`<button class="w3-plus" aria-label=${t('dr_add')} onClick=${() => openSheet('dir_add', seg === 'all' ? null : seg)}><${Icon} n="plus" cls="lg" /></button>`} />
    <div class="w3-chips" role="group">
      <button aria-pressed=${seg === 'all' ? 'true' : 'false'} onClick=${() => setSeg('all')}>${t('dr_all')}</button>
      ${groups.map((k) => html`<button key=${k} aria-pressed=${seg === k ? 'true' : 'false'} onClick=${() => { hap.sel(); setSeg(k); }}>${dgName(k)}</button>`)}
      ${canEdit && html`<button class="add" aria-label=${t('dr_new_group')} onClick=${() => openSheet('dir_group')}><${Icon} n="plus" cls="sm" /></button>`}
    </div>
    ${shown.length ? shown.map((g) => html`<div key=${g.k} class="card w2-list">
      <div class="w2-lh"><span>${dgName(g.k, true)}</span></div>
      ${g.items.length ? g.items.map((e) => {
        const wl = write(e);
        const ph = e.phone || (e.channel === 'phone' ? e.address : null);
        const ml = e.channel === 'map' || (!wl && !ph) ? mapLink(e.lat, e.lng, e.map_url) : null;
        return html`<div key=${e.id} class="w2-row w3-irow dr-row" role="button" tabindex="0" onClick=${() => openSheet('dir_entry', e.id)} onKeyDown=${(ev) => ev.key === 'Enter' && openSheet('dir_entry', e.id)}><span class="sq big"><${Icon} n=${e.icon && ICONS[e.icon] ? e.icon : DG_ICON[e.grp] ?? 'store'} /></span>
          <div class="grow"><b>${e.name}</b>${e.subtitle && html`<span>${e.subtitle}</span>`}</div>
          <div class="dr-btns">${ordSupOfDir(e.id) && html`<span class="dr-w" role="button" tabindex="0" aria-label=${t('or_order_btn') + ': ' + e.name} onClick=${(ev) => { ev.stopPropagation(); go(sp('shop', ordSupOfDir(e.id).id)); }} onKeyDown=${(ev) => { if (ev.key === 'Enter') { ev.stopPropagation(); go(sp('shop', ordSupOfDir(e.id).id)); } }}><${Icon} n="basket" />${t('or_order_btn')}</span>`}${wl && !ordSupOfDir(e.id) && html`<span class="dr-w" role="button" tabindex="0" aria-label=${t('dr_write')} onClick=${(ev) => { ev.stopPropagation(); openLink(wl); }}><${Icon} n="message-circle" />${e.channel === 'whatsapp' ? 'WA' : 'TG'}</span>`}
            ${ph && html`<${RoundBtn} ic="phone" label=${t('dr_call')} onClick=${() => openLink(telLink(ph))} />`}
            ${ml && html`<${RoundBtn} ic="map-pin" cls="gray" label=${t('dr_map')} onClick=${() => openLink(ml)} />`}</div></div>`;
      }) : html`<div class="w2-row"><span class="muted">—</span></div>`}
    </div>`) : html`<div class="card" style="padding:16px"><p class="muted" style="margin:0">${t('dr_none')}</p></div>`}
    <${Nav} tab="today" />
  </main>`;
}
function DirAddSheet({ grp }) {
  const d = D();
  const custom = (d.search.dir_groups ?? []).map((g) => g.key);
  const [g, setG] = useState(grp && grp !== 'home' ? grp : 'services');
  const [name, setName] = useState('');
  const [sub, setSub] = useState('');
  const [ch, setCh] = useState('whatsapp');
  const [addr, setAddr] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    const body = { search_id: d.search.id, grp: g, name: name.trim(), subtitle: sub.trim() || null, channel: ch };
    if (ch === 'map') body.map_url = addr.trim() || null; else body.address = addr.trim() || null;
    try { const r = await api('/app/api/dir-entry', body); (d.directory ??= []).push(r.entry); hap.ok(); toast(t('dr_saved')); closeSheet(); emit(); }
    catch (e) { toast(e.code === 'bad_map_url' ? e.message : t('err_generic')); }
    setBusy(false);
  }
  const chip = (on, label, f) => html`<button class=${'bchip' + (on ? ' on' : ' off')} aria-pressed=${on ? 'true' : 'false'} onClick=${() => { hap.sel(); f(); }}>${label}</button>`;
  return html`<h2>${t('dr_add')}</h2>
    <div class="x-form">
      <p class="e-lbl">${t('dr_group')}</p><div class="chips">${[...DG_BUILTIN.filter((k) => k !== 'home'), ...custom].map((k) => chip(g === k, dgName(k), () => setG(k)))}</div>
      <p class="e-lbl">${t('pl_name')}</p><input class="e-input" value=${name} placeholder=${t('dr_name_ph')} onInput=${(e) => setName(e.currentTarget.value)} />
      <p class="e-lbl">${t('dr_sub')}</p><input class="e-input" value=${sub} placeholder=${t('dr_sub_ph')} onInput=${(e) => setSub(e.currentTarget.value)} />
      <p class="e-lbl">${t('dr_channel')}</p><div class="chips">${[['whatsapp', 'WhatsApp'], ['telegram', 'Telegram'], ['phone', t('dr_addr_phone')], ['map', t('ch_map')]].map(([k, lb]) => chip(ch === k, lb, () => setCh(k)))}</div>
      <input class="e-input" style="margin-top:10px" value=${addr} placeholder=${t(ch === 'whatsapp' ? 'dr_addr_wa' : ch === 'telegram' ? 'dr_addr_tg' : ch === 'map' ? 'dr_addr_map' : 'dr_addr_phone')} onInput=${(e) => setAddr(e.currentTarget.value)} />
    </div>
    <button class="btn accent block" style="margin-top:14px" disabled=${busy || !name.trim()} onClick=${save}>${t('x_save')}</button>
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}
function DirGroupSheet() {
  const d = D();
  const [name, setName] = useState('');
  async function save() {
    if (!name.trim()) return;
    try { const r = await api('/app/api/dir-group', { search_id: d.search.id, name: name.trim() }); d.search.dir_groups = r.groups; hap.ok(); toast(t('dr_group_saved')); closeSheet(); emit(); }
    catch { toast(t('err_generic')); }
  }
  return html`<h2>${t('dr_new_group')}</h2><input class="e-input" value=${name} placeholder=${t('dr_group_ph')} onInput=${(e) => setName(e.currentTarget.value)} />
    <button class="btn accent block" style="margin-top:12px" disabled=${!name.trim()} onClick=${save}>${t('x_save')}</button>
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}
function DirEntrySheet({ id }) {
  const d = D();
  const e = dirEntries().find((x) => x.id === id);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  if (!e) return html`<p class="muted">—</p><button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
  const wl = e.channel === 'whatsapp' || e.channel === 'telegram' ? channelLink(e.channel, e.address) : null;
  const ph = e.phone || (e.channel === 'phone' ? e.address : null);
  const ml = mapLink(e.lat, e.lng, e.map_url);
  async function ask() {
    if (!text.trim()) return;
    setBusy(true);
    try { await postInstruction(`${e.name}${e.address ? ` (${channelName(e.channel)} ${e.address})` : ''}: ${text.trim()}`, 'dir_message', e.house ? e.id.slice(3) : e.id); hap.ok(); toast(t('dr_agent_sent')); closeSheet(); }
    catch { toast(t('err_generic')); }
    setBusy(false);
  }
  async function del() {
    try { await api('/app/api/dir-delete', { id: e.id }); d.directory = (d.directory ?? []).filter((x) => x.id !== e.id); hap.ok(); toast(t('dr_deleted')); closeSheet(); emit(); }
    catch { toast(t('err_generic')); }
  }
  const canAct = canVoteRole(d.me.role);
  return html`<h2>${e.name}</h2>${e.subtitle && html`<p class="muted" style="margin:0 0 12px">${e.subtitle}</p>`}
    <div class="doc-actions">
      ${ordSupOfDir(e.id) && html`<button class="btn accent" onClick=${() => { closeSheet(); go(sp('shop', ordSupOfDir(e.id).id)); }}><${Icon} n="basket" />${t('or_order_btn')}</button>`}
      ${wl && html`<button class=${'btn ' + (ordSupOfDir(e.id) ? 'surface outline' : 'accent')} onClick=${() => openLink(wl)}><${Icon} n="message-circle" />${t('dr_write')}</button>`}
      ${ph && html`<button class="btn surface outline" onClick=${() => openLink(telLink(ph))}><${Icon} n="phone" />${t('dr_call')}</button>`}
      ${ml && html`<button class="btn surface outline" onClick=${() => openLink(ml)}><${Icon} n="map-pin" />${t('dr_map')}</button>`}
    </div>
    ${e.contact_id && html`<button class="btn surface block" style="margin-bottom:10px" onClick=${() => { closeSheet(); go(sp('contact', e.contact_id)); }}><${Icon} n="users" cls="sm" />${t('pn_person')}</button>`}
    ${canAct && (e.address || e.phone) && html`<p class="section" style="margin-top:4px">${t('dr_agent')}</p>
      <textarea class="e-input" rows="2" placeholder=${t('dr_agent_ph')} value=${text} onInput=${(ev) => setText(ev.currentTarget.value)}></textarea>
      <button class="btn surface block" style="margin-top:8px" disabled=${busy || !text.trim()} onClick=${ask}><${Icon} n="sparkles" cls="sm" />${t('dr_agent')}</button>`}
    ${canAct && !e.house && html`<button class="btn ghost block" onClick=${del}><${Icon} n="trash-2" cls="sm" />${t('dr_delete')}</button>`}
    <button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
}
function W3Links() {
  const d = D();
  const pw = d.power;
  const nDir = (d.directory ?? []).length + (d.house_contacts ?? []).length;
  const row = (screen, ic, title, sub, cls = '') => html`<button class=${'card chats-row ' + cls} onClick=${() => go(sp(screen))}><span class="ic"><${Icon} n=${ic} /></span><div class="grow"><b>${title}</b><span>${sub}</span></div><${Icon} n="chev" cls="sm muted" /></button>`;
  const days = pw?.days_left != null ? Math.max(0, Math.floor(pw.days_left)) : null;
  return html`<div class="w2-links w3-links">
    ${d.moveout && row('moveout', 'door-open', t('w3_moveout'), d.moveout.date ? fmtDM(d.moveout.date) + ' · ' + `${MO_STEPS.filter((k) => d.moveout.steps?.[k]?.status === 'done').length}/${MO_STEPS.length}` : t('mo_date_none'))}
    ${d.relet && row('relet', 'megaphone', t('w3_relet'), t('rl_leads', { n: (d.relet.leads ?? []).length }))}
    ${row('important', 'stamp', t('w3_important'), t('w3_important_sub'))}
    ${row('power', 'zap', t('w3_power'), days != null ? t('w3_power_sub', { n: days }) : t('w3_power_sub_none'), days != null && days <= 3 ? 'warn' : '')}
    ${row('directory', 'store', t('w3_directory'), t('w3_dir_sub', { n: nDir }))}
    ${d.money?.mode !== 'shared' && row('split', 'bed', t('w3_split'), d.search.rooms?.rooms?.length ? t('w3_split_sub') : t('w3_split_sub_none'))}
  </div>`;
}

// ---------------------------------------------------------------- wave 4: places, location score (31, 31b, 32)
const TYPE_ICON = { beach: 'tree-palm', surf: 'waves', coworking: 'laptop', gym: 'dumbbell', yoga: 'heart-pulse', supermarket: 'shopping-cart', market: 'store', hospital: 'hospital', pharmacy: 'pill',
  coffee: 'coffee', food: 'utensils', daytrip: 'mountain', nightlife: 'volume-2', construction: 'hard-hat', other: 'map-pin' };
const TYPE_EMOJI = { nightlife: '🎶', construction: '🚧', other: '📍' };
const LGROUPS = { anchors: [], surf: ['surf', 'beach'], shops: ['supermarket', 'market'], cafes: ['coffee', 'food'], work: ['coworking'], sport: ['gym', 'yoga'], medical: ['hospital', 'pharmacy'], nightlife: ['nightlife'] };
const LG_ICON = { anchors: 'target', surf: 'waves', shops: 'shopping-cart', cafes: 'coffee', work: 'laptop', sport: 'dumbbell', medical: 'hospital', nightlife: 'volume-2' };
const PT_ORDER = ['surf', 'beach', 'coffee', 'food', 'coworking', 'supermarket', 'market', 'gym', 'yoga', 'hospital', 'pharmacy', 'nightlife', 'daytrip', 'construction', 'other'];
const groupOfType = (ty) => Object.keys(LGROUPS).find((g) => LGROUPS[g].includes(ty)) ?? 'other';
const ptName = (ty) => (STR[LANG]['pt_' + ty] ? t('pt_' + ty) : human(ty));
const fmtW = (w) => '×' + fmtNum(Math.round(w * 10) / 10);
const basePlacesCache = {};
function useBasePlaces(country) {
  const [p, setP] = useState(basePlacesCache[country] ?? null);
  useEffect(() => {
    if (!country || basePlacesCache[country]) { setP(basePlacesCache[country] ?? null); return; }
    if (!S.regions?.[country]?.places) { basePlacesCache[country] = { types: {}, places: [] }; setP(basePlacesCache[country]); return; }
    fetch(`/art/${country}/places.json`).then((r) => (r.ok ? r.json() : null)).then((j) => { basePlacesCache[country] = j ?? { types: {}, places: [] }; setP(basePlacesCache[country]); }).catch(() => null);
  }, [country, !!S.regions]);
  return p;
}
/** Base (pack) + own (Google Maps) places of the search, one shape. */
function allPlaces(base) {
  const own = (D()?.places ?? []).filter((p) => !p.hidden).map((p) => ({ ...p, own: true }));
  const nm = (x) => String(x).toLowerCase().replace(/[^a-zа-я0-9]+/gi, ' ').trim();
  const dup = (p) => own.some((o) => km([o.lat, o.lng], [p.lat, p.lng]) < 0.15 && (nm(o.name).includes(nm(p.name)) || nm(p.name).includes(nm(o.name))));
  const bp = (base?.places ?? []).map((p) => ({ ...p, id: 'b:' + p.id, own: false, note: p.note?.[LANG] ?? p.note?.en ?? null })).filter((p) => !dup(p));
  return [...own, ...bp];
}
const placeEmoji = (p, types) => types?.[p.type]?.emoji ?? TYPE_EMOJI[p.type] ?? '📍';
const stars = (tier) => '★'.repeat(tier === 1 ? 3 : tier === 2 ? 2 : 1);
const scoreCls = (n) => (n >= 75 ? 'hi' : n >= 50 ? 'mid' : 'lo');
const LocBadge = ({ n }) => (n == null ? null : html`<span class=${'loc-badge ' + scoreCls(n)}>${t('lc_badge', { n })}</span>`);

let spotArea = null, spotType = 'all';
function Spots() {
  const d = D();
  const base = useBasePlaces(d.search.country);
  const geo = useAreasGeo(d.search.country);
  const areas = regionPack()?.areas ?? {};
  const all = allPlaces(base);
  const areaKey = (p) => p.area ?? (geo ? areaOf(p, geo, areas) : null) ?? 'trip';
  const counts = {};
  for (const p of all) counts[areaKey(p)] = (counts[areaKey(p)] ?? 0) + 1;
  const homeA = dealListing() && geo ? areaOf(dealListing(), geo, areas) : null;
  const def = homeA ?? (d.search.brief.districts ?? []).find((x) => counts[x]) ?? Object.entries(counts).filter(([k]) => k !== 'trip').sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'trip';
  const [area, setArea0] = useState(spotArea && counts[spotArea] ? spotArea : def);
  const [type, setType0] = useState(spotType);
  const setType = (k) => { spotType = k; setType0(k); };
  useEffect(() => { if (!spotArea && def && def !== area) setArea0(def); }, [def]);
  S.spotSetArea = (k) => { spotArea = k; setArea0(k); setType('all'); };
  const inArea = all.filter((p) => areaKey(p) === area);
  const typesHere = PT_ORDER.filter((ty) => inArea.some((p) => p.type === ty));
  const shown = inArea.filter((p) => type === 'all' || p.type === type || (type === 'surf' && p.type === 'beach'))
    .sort((a, b) => a.tier - b.tier || Number(b.own) - Number(a.own) || a.name.localeCompare(b.name));
  const aName = area === 'trip' ? t('sp_trip') : areaName(areas[area]) || area;
  const chipTypes = typesHere.filter((ty) => !(ty === 'beach' && typesHere.includes('surf')));
  return html`<main class="screen w2">
    <div class="head w3-head"><div class="row" style="align-items:flex-start"><${BackIfWeb} /><div>
      <button class="kicker sp-kick" onClick=${() => openSheet('spot_area')}>${aName} · ${t('sp_n', { n: inArea.length })} <${Icon} n="chevd" cls="xs" /></button>
      <h1 class="h1 w3-h1">${t('sp_title')}</h1></div></div></div>
    <div class="w3-chips" role="group">
      <button aria-pressed=${type === 'all' ? 'true' : 'false'} onClick=${() => setType('all')}>${t('sp_all')}</button>
      ${chipTypes.map((ty) => html`<button key=${ty} class="ic-chip" aria-pressed=${type === ty ? 'true' : 'false'} onClick=${() => { hap.sel(); setType(ty); }}><${Icon} n=${TYPE_ICON[ty]} cls="sm" />${ptName(ty)}</button>`)}
    </div>
    ${shown.length ? html`<div class="card w2-list">${shown.map((p) => html`<button key=${p.id} class="w2-row w3-irow" onClick=${() => openSheet('spot', p.id)}>
        <span class="sq big"><${Icon} n=${TYPE_ICON[p.type] ?? 'map-pin'} /></span>
        <div class="grow"><b>${p.name}</b><span>${[ptName(p.type), p.note ? p.note.replace(/^./, (c) => c.toLowerCase()) : null].filter(Boolean).join(' · ')}</span></div>
        <span class="sp-stars" aria-label=${t('sp_tier') + ' ' + p.tier}>${stars(p.tier)}</span></button>`)}</div>`
      : html`<div class="card" style="padding:16px;margin-bottom:14px"><p class="muted" style="margin:0">${base ? t('sp_none') : '…'}</p></div>`}
    ${canVoteRole(d.me.role) && html`<button class="card w4-add" onClick=${() => openSheet('spot_link')}><${Icon} n="link" /><span>${t('sp_add')}</span></button>`}
    <${Nav} tab="map" />
  </main>`;
}
function SpotAreaSheet() {
  const d = D();
  const base = useBasePlaces(d.search.country);
  const geo = useAreasGeo(d.search.country);
  const areas = regionPack()?.areas ?? {};
  const counts = {};
  for (const p of allPlaces(base)) { const k = p.area ?? (geo ? areaOf(p, geo, areas) : null) ?? 'trip'; counts[k] = (counts[k] ?? 0) + 1; }
  const keys = Object.keys(counts).sort((a, b) => (a === 'trip') - (b === 'trip') || counts[b] - counts[a]);
  return html`<h2>${t('sp_areas')}</h2><div class="card grp">${keys.map((k) => html`<button class="opt" onClick=${() => { S.spotSetArea?.(k); closeSheet(); }}>
      <span class="grow">${k === 'trip' ? t('sp_trip') : areaName(areas[k]) || k}</span><span class="muted">${counts[k]}</span></button>`)}</div>
    <button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
}
function SpotSheet({ id }) {
  const d = D();
  const base = useBasePlaces(d.search.country);
  const p = allPlaces(base).find((x) => x.id === id) ?? (d.places ?? []).find((x) => x.id === id);
  const [busy, setBusy] = useState(false);
  if (!p) return html`<p class="muted">—</p><button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
  const types = PT_ORDER.filter((x) => x !== 'daytrip' || p.type === 'daytrip');
  async function save(patch) {
    setBusy(true);
    try {
      const r = await api('/app/api/place', { id: p.id, ...patch });
      d.places = (d.places ?? []).map((x) => (x.id === p.id ? { ...x, ...r.place } : x));
      hap.ok(); toast(t('sp_saved')); if (patch.hidden) closeSheet(); emit(); refresh();
    } catch { toast(t('err_generic')); }
    setBusy(false);
  }
  const link = mapLink(p.lat, p.lng, p.url && /\/maps\//.test(p.url) && !/entitylist|\/d\//.test(p.url) ? p.url : null);
  const edit = p.own && canVoteRole(d.me.role);
  const chip = (on, label, f) => html`<button class=${'bchip' + (on ? ' on' : ' off')} aria-pressed=${on ? 'true' : 'false'} disabled=${busy} onClick=${() => { hap.sel(); f(); }}>${label}</button>`;
  return html`<h2>${p.name}</h2><p class="muted" style="margin:0 0 12px">${[ptName(p.type), stars(p.tier), p.own ? t('sp_own') : t('sp_pack')].join(' · ')}</p>
    ${p.note && html`<p style="margin:0 0 12px">${p.note}</p>`}
    ${p.address && html`<p class="muted" style="margin:0 0 12px;font-size:14px">${p.address}</p>`}
    ${edit && html`<div class="x-form"><p class="e-lbl">${t('sp_type')}</p><div class="chips">${types.map((ty) => chip(p.type === ty, ptName(ty), () => save({ type: ty })))}</div>
      <p class="e-lbl">${t('sp_tier')}</p><div class="chips">${[1, 2, 3].map((n) => chip(p.tier === n, stars(n), () => save({ tier: n })))}</div></div>`}
    ${link && html`<button class="btn surface block" style="margin:14px 0 8px" onClick=${() => openLink(link)}><${Icon} n="map-pin" cls="sm" />${t('pl_open_map')}</button>`}
    ${edit && html`<button class="btn ghost block" disabled=${busy} onClick=${() => save({ hidden: true })}><${Icon} n="eyeoff" cls="sm" />${t('sp_hide')}</button>`}
    <button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
}
function SpotLinkSheet() {
  const d = D();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try { await api('/app/api/places-link', { search_id: d.search.id, url: url.trim() }); hap.ok(); toast(t('sp_link_sent')); closeSheet(); }
    catch (e) { toast(e.code === 'bad_url' ? t('sp_bad_link') : t('err_generic')); }
    setBusy(false);
  }
  return html`<h2>${t('sp_link_t')}</h2><p class="muted" style="margin:0 0 12px">${t('sp_link_text')}</p>
    <input class="e-input" value=${url} placeholder=${t('sp_link_ph')} inputmode="url" onInput=${(e) => setUrl(e.currentTarget.value)} />
    <button class="btn accent block" style="margin-top:12px" disabled=${busy || !/^https?:\/\//.test(url.trim())} onClick=${send}><${Icon} n="send" cls="sm" />${t('x_save')}</button>
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}

const locCache = {};
function useLocation(id) {
  const [v, setV] = useState(locCache[id] ?? null);
  useEffect(() => {
    api('/app/api/location?id=' + encodeURIComponent(id)).then((j) => { locCache[id] = j; setV(j); }).catch(() => setV({ location: null, failed: true }));
  }, [id]);
  return v;
}
/** Ring minutes of a location view: the keys of location.rings (legacy 5/10/30 still read), else the ring set, else the pack's. */
const DEF_RINGS = [10, 20, 40], DEF_RW = [1, 0.7, 0.3];
const packRings = () => subRegion()?.location?.rings ?? regionPack()?.location?.rings ?? DEF_RINGS;
function ringKeys(v) {
  const ks = Object.keys(v?.location?.rings ?? {}).map(Number).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  return ks.length ? ks : v?.ring_set ?? v?.location?.ring_set ?? packRings();
}
const ringSet = (v) => v?.ring_set ?? v?.location?.ring_set ?? packRings();
const ringWeights = (v) => v?.ring_weights ?? v?.location?.ring_weights ?? subRegion()?.location?.weights ?? regionPack()?.location?.weights ?? DEF_RW;
const locStale = (v) => !!(v?.stale || v?.location?.stale);
function lcHowText(v) {
  const rs = ringSet(v), w = ringWeights(v);
  const rush = Number(v?.rush_factor ?? v?.location?.rush_factor ?? 1.3);
  const mw = modeWord();
  return `${t('lc_how_text', { rings: rs.map((r, i) => `${t('lc_min', { n: r })} ${fmtNum(w[i] ?? 0)}`).join(', '), r: rs[1] ?? rs[0] })} ${t('lc_rush', { m: mw ? ' ' + mw : t('lc_rush_m'), p: Math.max(0, Math.round((rush - 1) * 100)) })}.`;
}
/** The north-most point of a ring: where its "N мин" label sits. */
function topPoint(geom) {
  const polys = geom?.type === 'Polygon' ? [geom.coordinates] : geom?.coordinates ?? [];
  let best = null;
  for (const p of polys) for (const pt of p[0] ?? []) if (!best || pt[1] > best[1]) best = pt;
  return best;
}
function LocationScreen({ id }) {
  const d = D();
  const l = listingById(id);
  const v = useLocation(id);
  const [ready, setReady] = useState(false);
  const [fail, setFail] = useState(false);
  const box = useRef(null);
  const mapR = useRef(null);
  const marks = useRef([]);
  const theme = useThemeKey();
  useEffect(() => {
    let dead = false;
    setReady(false);
    loadML().then(async (ml) => {
      const style = await districtStyle();
      if (dead || !box.current) return;
      const c = l?.lat != null ? [l.lat, l.lng] : subRegion()?.center ?? [0, 0];
      const map = new ml.Map({ container: box.current, style, center: [c[1], c[0]], zoom: 12, attributionControl: false, dragRotate: false, pitchWithRotate: false, fadeDuration: 0 });
      map.touchZoomRotate.disableRotation();
      mapR.current = map;
      map.on('load', () => !dead && setReady(true));
    }).catch(() => !dead && setFail(true));
    return () => { dead = true; marks.current.forEach((m) => m.remove()); marks.current = []; mapR.current?.remove(); mapR.current = null; };
  }, [theme]);
  useEffect(() => {
    const map = mapR.current;
    const ml = window.maplibregl;
    if (!ready || !map || !ml || !v || !l) return;
    marks.current.forEach((m) => m.remove());
    marks.current = [];
    const accent = cssVar('--map-accent');
    const geo = v.geo;
    const grs = [...new Set((geo?.features ?? []).map((f) => Number(f.properties?.ring)).filter((x) => !Number.isNaN(x)))].sort((a, c) => a - c);
    const rs = grs.length ? grs : ringKeys(v);
    const r0 = rs[0], r1 = rs[1] ?? rs[0], rl = rs[rs.length - 1];
    const add = (el, ll, z) => { el.style.zIndex = String(z); marks.current.push(new ml.Marker({ element: el, anchor: 'center' }).setLngLat(ll).addTo(map)); };
    if (geo && !map.getSource('iso')) {
      map.addSource('iso', { type: 'geojson', data: geo });
      const fillOp = rs.length >= 3 ? ['match', ['get', 'ring'], r0, 0.26, r1, 0.16, 0.08] : rs.length === 2 ? ['match', ['get', 'ring'], r0, 0.26, 0.12] : 0.2;
      map.addLayer({ id: 'iso-fill', type: 'fill', source: 'iso', paint: { 'fill-color': accent, 'fill-opacity': fillOp } });
      map.addLayer({ id: 'iso-line', type: 'line', source: 'iso', layout: { 'line-join': 'round' }, paint: { 'line-color': accent, 'line-width': 2, 'line-dasharray': [2, 1.6], 'line-opacity': rs.length > 1 ? ['match', ['get', 'ring'], rl, 0.55, 0.9] : 0.9 } });
    }
    const b = new ml.LngLatBounds();
    b.extend([l.lng, l.lat]);
    for (const f of geo?.features ?? []) {
      if (f.properties.ring === r1) { const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates; for (const p of polys) for (const pt of p[0]) b.extend(pt); }
      if (rs.length > 1 && f.properties.ring === rl) continue;
      const tp = topPoint(f.geometry);
      if (!tp) continue;
      const el = document.createElement('div');
      el.className = 'ring-tag';
      el.textContent = t('lc_min', { n: f.properties.ring });
      add(el, tp, 8);
    }
    // Pins: own places and tier-1 first, at most 36.
    const pins = [...(v.places ?? [])].filter((p) => p.ring !== rl || p.tier === 1 || p.own).sort((a, c) => a.ring - c.ring || a.tier - c.tier || Number(c.own) - Number(a.own)).slice(0, 24);
    for (const p of pins) {
      const el = document.createElement('button');
      el.className = `lpin g-${groupOfType(p.type)}${p.ring === rl ? ' far' : ''}`;
      el.textContent = p.emoji ?? TYPE_EMOJI[p.type] ?? '📍';
      el.setAttribute('aria-label', p.name);
      el.addEventListener('click', (e) => { e.stopPropagation(); openSheet('spot', p.id); });
      add(el, [p.lng, p.lat], p.ring === r0 ? 4 : 3);
    }
    const home = document.createElement('div');
    home.className = 'lhome';
    add(home, [l.lng, l.lat], 6);
    const sheetH = document.querySelector('.lc-sheet')?.getBoundingClientRect().height ?? 0;
    const H = box.current.clientHeight;
    map.fitBounds(b, { padding: { top: 120, bottom: Math.min(H * 0.62, sheetH + 16), left: 28, right: 28 }, maxZoom: 14, duration: 0 });
  }, [ready, v]);
  if (!l) return html`<main class="screen no-nav"><div class="center-msg">—</div></main>`;
  const stale = locStale(v);
  const loc = stale ? null : v?.location;
  const rj = ringSet(v).join('/');
  const sub = [districtShort(l), l.bedrooms != null ? t('br', { n: l.bedrooms }) : null, priceText(l)].filter(Boolean).join(' · ');
  const ask = async () => { try { await postInstruction(t('lc_ask_text', { r: rj }) + `: ${l.title}`, 'location_refresh', l.id); hap.ok(); toast(t('lc_asked')); } catch { toast(t('err_generic')); } };
  return html`<main class="map-screen lc-screen">
    <div class="map" ref=${box} role="application" aria-label=${t('lc_row')}></div>
    <div class="map-top lc-top"><button class="card lc-card" onClick=${() => go(sp('listing', l.id))}>
      <${Img} src=${photosOf(l)[0]} cls="lc-thumb" /><div class="grow"><b>${shortTitle(l.title)}</b><span>${sub}</span></div>
      ${loc && html`<span class=${'lc-score ' + scoreCls(loc.score)}><b>${loc.score}</b><small>${t('lc_word')}</small></span>`}</button></div>
    ${fail && html`<div class="center-msg" style="position:absolute;inset:40% 0 auto">${t('map_fail')}</div>`}
    <div class="lc-sheet"><div class="grip"></div>
      ${v == null ? html`<div class="skeleton" style="height:120px"></div>` : !loc ? html`<p class=${stale ? 'lc-stale' : 'muted'} style="margin:4px 0 14px">${stale ? t('lc_stale') : t('lc_none', { r: rj })}</p>
          ${canVoteRole(d.me.role) && html`<button class="btn accent block" onClick=${ask}><${Icon} n="sparkles" cls="sm" />${t('lc_ask')}</button>`}`
        : html`${ringKeys(v).map((r, ri) => {
          const ring = loc.rings[String(r)] ?? { points: 0, places: [] };
          const list = ring.places.filter((p) => p.contribution > 0 || p.own);
          const extra = Math.max(0, list.length - 5);
          return html`<div key=${r} class="lc-ring"><div class="lc-rh"><i class=${'lc-dot i' + ri}></i><b>${t('lc_min', { n: r })}</b><span class="grow"></span><span class="muted">${t('lc_points', { n: ring.points })}</span></div>
            <div class="lc-chips">${list.slice(0, 5).map((p) => html`<button class=${'lc-chip' + (p.tier === 1 ? ' top' : '')} onClick=${() => openSheet('spot', p.id)}><${Icon} n=${TYPE_ICON[p.type] ?? 'map-pin'} cls="sm" />${p.name}${p.tier === 1 ? ' ★' : ''}</button>`)}
              ${extra > 0 && html`<span class="lc-chip more">${t('lc_more', { n: extra })}</span>`}${!list.length && html`<span class="muted" style="font-size:14px">—</span>`}</div></div>`;
        })}
        <p class="lc-rush">${t('lc_rush', { m: modeWord() ? ' ' + modeWord() : t('lc_rush_m'), p: Math.max(0, Math.round((Number(v.rush_factor ?? loc.rush_factor ?? 1.3) - 1) * 100)) })}</p>
        <button class="btn outline block big lc-how" onClick=${() => go(sp('score', l.id))}><${Icon} n="info-circle" />${t('lc_how', { n: loc.score })}</button>`}
    </div>
    <span class="attrib" style="display:none">© OpenFreeMap © OpenStreetMap</span>
  </main>`;
}
function ScoreScreen({ id }) {
  const l = listingById(id);
  const v = useLocation(id);
  if (!l) return html`<main class="screen no-nav"><div class="center-msg">—</div></main>`;
  const stale = locStale(v);
  const loc = stale ? null : v?.location;
  const r2 = ringSet(v)[1] ?? ringSet(v)[0];
  const groups = (loc?.groups ?? []).filter((g) => g.key !== 'nightlife' || g.weight > 0 || loc.quiet || g.n).sort((a, b) => (b.key === 'anchors') - (a.key === 'anchors') || b.weight - a.weight);
  const bar = (g) => (g.weight <= 0 ? '' : g.s >= 75 ? 'hi' : g.s >= 55 ? 'mid' : 'lo');
  const pen = loc?.penalties ?? [];
  return html`<main class="screen w2 no-nav">
    <${W3Head} kicker=${[shortTitle(l.title), districtShort(l)].filter(Boolean).join(' · ')} title=${loc ? t('lc_title', { n: loc.score }) : t('lc_row')} />
    ${v == null ? html`<div class="skeleton" style="height:240px"></div>` : !loc ? html`<div class="card" style="padding:16px"><p class="muted" style="margin:0">${stale ? t('lc_stale') : t('lc_none', { r: ringSet(v).join('/') })}</p></div>` : html`
      <div class="card lc-types"><p class="w3-ct">${t('lc_by_type')}</p>
        ${groups.map((g) => html`<div class="lc-tr"><${Icon} n=${LG_ICON[g.key]} /><span class="nm">${t('lg_' + g.key)}</span><span class="w">${fmtW(g.weight)}</span>
          <div class="lc-bar"><i class=${bar(g)} style=${`width:${g.weight > 0 ? Math.max(3, g.s) : 0}%`}></i></div><b>${g.weight > 0 ? g.s : '—'}</b></div>`)}
      </div>
      <div class="w2-note col"><b>${t('lc_how_t')}</b><span>${lcHowText(v)}</span></div>
      ${pen.length ? html`<div class="card w2-list">${pen.map((p) => html`<div class="w2-row w3-irow"><${Icon} n=${p.key === 'no_shop' ? 'shopping-cart' : 'volume-2'} cls="pl-ic-over" /><div class="grow"><b style="font-weight:500">${t('lc_' + p.key, { p: p.place ?? '', r: r2 })}</b></div></div>`)}</div>`
        : loc.quiet ? html`<div class="card w2-list"><div class="w2-row w3-irow"><${Icon} n="volume-x" cls="pl-ic-over" /><div class="grow"><b style="font-weight:500">${t('lc_quiet_ok')}</b></div></div></div>` : null}`}
  </main>`;
}

// ---------------------------------------------------------------- flood risk (38)
const FL_CLS = { low: 'ok', medium: 'mango', high: 'danger' };
const FL_SRC_ICON = { terrain: 'map', chats: 'message-circle', notes: 'users', area: 'map-pin' };
function areaFlood(l) {
  const areas = regionPack()?.areas ?? {};
  const id = areaOf(l, geoCache[D().search.country], areas);
  const a = id ? areas[id] : null;
  return a?.flood ? { id, a, level: a.flood.level, note: a.flood.note?.[LANG] ?? a.flood.note?.en ?? '' } : null;
}
function Flood({ id }) {
  const d = D();
  useAreasGeo(d.search.country);
  const l = listingById(id);
  if (!l) return html`<main class="screen no-nav"><div class="center-msg">—</div></main>`;
  const f = l.flood ?? null;
  const af = areaFlood(l);
  const level = f?.level ?? af?.level ?? null;
  const sub = [districtShort(l), l.bedrooms != null ? t('br', { n: l.bedrooms }) : null, priceText(l)].filter(Boolean).join(' · ');
  const notes = f?.notes ?? [];
  const lv = ['low', 'medium', 'high'];
  const src = (f?.sources ?? []).filter((x) => x.kind !== 'area');
  return html`<main class="screen w2">
    <${W2Head} l=${l} title=${shortTitle(l.title)} sub=${sub} />
    ${level && html`<div class=${'fl-card ' + FL_CLS[level]}><div class="w3-warn-h"><${Icon} n="cloud-rain" /><b>${t('fl_title', { x: t('fl_' + level) })}</b></div>
      <div class="fl-bar">${lv.map((x, i) => html`<div class=${i <= lv.indexOf(level) ? 'on' : ''}><i></i><span class=${x === level ? 'cur' : ''}>${t('fl_l_' + x)}</span></div>`)}</div>
      ${(f?.summary || (!f && af)) && html`<p>${f?.summary ?? af.note}</p>`}</div>`}
    ${src.length || notes.length ? html`<div class="card w2-list"><div class="w2-lh"><span>${t('fl_sources')}</span></div>
      ${src.map((x) => html`<div class="w2-row w3-irow"><span class="sq big"><${Icon} n=${FL_SRC_ICON[x.kind] ?? 'info'} /></span><div class="grow"><b>${x.title || t('fl_' + x.kind)}</b>${x.text && html`<span>${x.text}</span>`}</div></div>`)}
      ${notes.length > 0 && html`<div class="w2-row w3-irow"><span class="sq big"><${Icon} n="users" /></span><div class="grow"><b>${t('fl_notes')}</b><span>${notes.slice(-3).map((n) => `${firstName(n.name)}: «${n.text}»`).join(' · ')}</span></div></div>`}
    </div>` : !f && html`<div class="card" style="padding:16px;margin-bottom:14px"><p class="muted" style="margin:0">${t('fl_none')}</p></div>`}
    ${af && html`<div class="card w2-list"><div class="w2-row w3-irow"><${Icon} n=${af.level === 'low' ? 'circle-check' : 'circle-alert'} cls=${af.level === 'low' ? 'pl-ic-ok' : 'pl-ic-over'} /><div class="grow"><b style="font-weight:500">${t('fl_area_line', { a: areaName(af.a), x: t('fl_' + af.level), n: LANG === 'ru' ? af.note.replace(/^./, (c) => c.toLowerCase()) : af.note })}</b></div></div></div>`}
    ${canVoteRole(d.me.role) && html`<button class="btn surface block" onClick=${() => openSheet('flood_note', l.id)}><${Icon} n="plus" cls="sm" />${t('fl_add')}</button>`}
    <${Nav} tab="listings" />
  </main>`;
}
function FloodNoteSheet({ id }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try { const r = await api('/app/api/flood-note', { listing_id: id, text: text.trim() }); const l = listingById(id); if (l) l.flood = r.flood; hap.ok(); toast(t('fl_saved')); closeSheet(); emit(); }
    catch { toast(t('err_generic')); }
    setBusy(false);
  }
  return html`<h2>${t('fl_note_t')}</h2>
    <textarea class="e-input" rows="3" placeholder=${t('fl_note_ph')} value=${text} onInput=${(e) => setText(e.currentTarget.value)}></textarea>
    <button class="btn accent block" style="margin-top:12px" disabled=${busy || !text.trim()} onClick=${send}>${t('x_save')}</button>
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}

// ---------------------------------------------------------------- bikes (33)
const BK_CHECK = [['video', 'camera'], ['helmets', 'helmet'], ['stnk', 'file-text'], ['fuel', 'fuel']];
const origPassport = (s) => !!s && /паспорт|passport|paspor/i.test(s) && !/коп|copy|scan|скан|salinan|fotokop/i.test(s);
function bikeStatus(b) {
  if (b.status === 'returned') return html`<span class="st2">${t('bk_returned')}</span>`;
  if (!b.paid_until) return null;
  const left = Math.round((Date.parse(b.paid_until + 'T00:00:00Z') - Date.parse(dayKey(new Date().toISOString()) + 'T00:00:00Z')) / 864e5);
  if (left < 0) return html`<span class="st2 bad">${t('bk_late')}</span>`;
  if (left === 0) return html`<span class="st2 wait">${t('bk_today')}</span>`;
  if (left <= 3) return html`<span class="st2 wait">${t('bk_in', { n: left })}</span>`;
  return html`<span class="st2 ok">${t('bk_ok')}</span>`;
}
const perMonth = (b) => (b.price == null ? 0 : b.period === 'week' ? Math.round(b.price * 4.35) : b.period === 'day' ? b.price * 30 : b.price);
function Bikes() {
  const d = D();
  const bikes = d.bikes ?? [];
  const active = bikes.filter((b) => b.status !== 'returned');
  const cur = active[0]?.currency ?? briefCur(d.search);
  const sum = active.reduce((a, b) => a + perMonth(b), 0);
  const canEdit = canVoteRole(d.me.role);
  const ckBike = active.find((b) => BK_CHECK.some(([k]) => !b.checklist?.[k]?.done)) ?? active[0];
  const kick = [districtShort(dealListing()) || homeName(), active.length ? t('bk_n', { n: active.length }) : null, sum ? t('bk_per', { x: money(sum, cur) }) : null].filter(Boolean).join(' · ');
  const tick = async (b, k) => {
    const done = !b.checklist?.[k]?.done;
    b.checklist = { ...(b.checklist ?? {}), [k]: { ...(b.checklist?.[k] ?? {}), done } };
    emit(); hap.sel();
    try { await api('/app/api/bike-check', { id: b.id, key: k, done }); } catch { toast(t('err_generic')); }
  };
  return html`<main class="screen w2">
    <${W3Head} kicker=${kick} title=${t('bk_title')} right=${canEdit && html`<button class="w3-plus" aria-label=${t('bk_add')} onClick=${() => openSheet('bike', 'new')}><${Icon} n="plus" cls="lg" /></button>`} />
    ${bikes.some((b) => b.status !== 'returned' && origPassport(b.deposit)) && html`<div class="w3-warn"><div class="w3-warn-h"><${Icon} n="shield-alert" /><b>${t('bk_passport')}</b></div></div>`}
    ${bikes.length ? bikes.map((b) => {
      const rider = b.rider_id ? memberById(b.rider_id) : null;
      const wl = b.channel === 'whatsapp' || b.channel === 'telegram' ? channelLink(b.channel, b.address) : null;
      const ph = b.phone || (b.channel === 'phone' ? b.address : null);
      return html`<div key=${b.id} class=${'card bk-card' + (b.status === 'returned' ? ' off' : '')} role="button" tabindex="0" onClick=${() => openSheet('bike', b.id)}>
        <div class="bk-hd"><span class="sq big"><${Icon} n="bike" /></span><div class="grow"><b class="bk-model">${b.model}</b>
          <div class="bk-meta">${b.plate && html`<span class="bk-plate">${b.plate}</span>`}${rider ? html`<${Av} m=${rider} size=${24} /><span>${meOrName(rider.user_id)}</span>` : html`<span>${t('bk_shared')}</span>`}</div></div>${bikeStatus(b)}</div>
        <div class="bk-tiles"><div><b>${b.price != null ? money(b.price, b.currency) + (b.period === 'month' ? (LANG === 'ru' ? '/мес' : '/mo') : b.period === 'week' ? (LANG === 'ru' ? '/нед' : '/wk') : (LANG === 'ru' ? '/день' : '/day')) : '—'}</b><span>${t('bk_price')}</span></div>
          <div><b>${b.paid_until ? t('bk_until', { d: fmtDM(b.paid_until) }) : '—'}</b><span>${t('bk_paid')}</span></div></div>
        ${(b.rental_name || b.deposit || wl || ph) && html`<div class="bk-rent"><div class="grow"><b>${b.rental_name ?? ''}</b>${b.deposit && html`<span class=${origPassport(b.deposit) ? 'pl-over' : ''}>${b.deposit}</span>`}</div>
          <div class="dr-btns">${wl && html`<span class="dr-w" role="button" tabindex="0" onClick=${(e) => { e.stopPropagation(); openLink(wl); }}><${Icon} n="message-circle" />${b.channel === 'whatsapp' ? 'WA' : 'TG'}</span>`}
            ${ph && html`<${RoundBtn} ic="phone" label=${t('dr_call')} onClick=${() => openLink(telLink(ph))} />`}</div></div>`}
      </div>`;
    }) : html`<div class="card" style="padding:16px;margin-bottom:14px"><p class="muted" style="margin:0">${t('bk_none')}</p></div>`}
    ${ckBike && html`<div class="card w2-list"><div class="w2-lh"><span>${t('bk_pickup')}${active.length > 1 ? ' · ' + ckBike.model : ''}</span></div>
      ${BK_CHECK.map(([k, ic]) => html`<button class="w2-row w3-irow bk-ck" disabled=${!canEdit} onClick=${() => tick(ckBike, k)}><${Icon} n=${ic} cls="os-ic" /><div class="grow"><b style="font-weight:500">${t('bk_' + k)}${k === 'helmets' && ckBike.checklist?.helmets?.note ? ` — ${ckBike.checklist.helmets.note}` : ''}</b></div>
        <${Icon} n=${ckBike.checklist?.[k]?.done ? 'circle-check' : 'circle-dashed'} cls=${ckBike.checklist?.[k]?.done ? 'pl-ic-ok' : 'muted'} /></button>`)}</div>`}
    <p class="w2-foot">${t('bk_foot')}</p>
    <${Nav} tab="today" />
  </main>`;
}
function BikeSheet({ id }) {
  const d = D();
  const b0 = (d.bikes ?? []).find((x) => x.id === id) ?? null;
  const [f, setF] = useState(() => ({ model: b0?.model ?? '', plate: b0?.plate ?? '', rider_id: b0 ? b0.rider_id : d.user.id, price: b0?.price != null ? String(b0.price) : '', period: b0?.period ?? 'month',
    paid_until: b0?.paid_until ?? '', deposit: b0?.deposit ?? '', rental_name: b0?.rental_name ?? '', address: b0?.address ?? '', return_date: b0?.return_date ?? '' }));
  const [pay, setPay] = useState(false);
  const [amount, setAmount] = useState(b0?.price != null ? String(b0.price) : '');
  const [until, setUntil] = useState(() => (b0?.paid_until ? new Date(Date.parse(b0.paid_until + 'T00:00:00Z') + (b0.period === 'week' ? 7 : b0.period === 'day' ? 1 : 30) * 864e5).toISOString().slice(0, 10) : ''));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.currentTarget.value });
  const cur = b0?.currency ?? briefCur(d.search);
  async function save(extra = {}) {
    setBusy(true);
    try {
      const r = await api('/app/api/bike', { search_id: d.search.id, id: b0?.id ?? 'new', ...f, price: parseAmount(f.price), currency: cur, channel: f.address ? (f.address.trim().startsWith('@') ? 'telegram' : 'whatsapp') : null, ...extra });
      d.bikes = [...(d.bikes ?? []).filter((x) => x.id !== r.bike.id), r.bike];
      hap.ok(); toast(r.warning === 'original_passport' ? t('bk_passport') : t('bk_saved')); closeSheet(); emit();
    } catch { toast(t('err_generic')); }
    setBusy(false);
  }
  async function doPay() {
    setBusy(true);
    try {
      const r = await api('/app/api/bike-pay', { id: b0.id, amount: parseAmount(amount), until });
      d.bikes = (d.bikes ?? []).map((x) => (x.id === b0.id ? r.bike : x));
      if (r.money) d.money = r.money;
      hap.ok(); toast(t('bk_paid_ok')); closeSheet(); emit();
    } catch { toast(t('err_generic')); }
    setBusy(false);
  }
  const chip = (on, label, fn) => html`<button class=${'bchip' + (on ? ' on' : ' off')} aria-pressed=${on ? 'true' : 'false'} onClick=${() => { hap.sel(); fn(); }}>${label}</button>`;
  if (pay && b0) return html`<h2>${t('bk_pay_t')}</h2><p class="muted" style="margin:0 0 12px">${b0.model}${b0.plate ? ' · ' + b0.plate : ''}</p>
    <div class="x-form"><p class="e-lbl">${t('bk_pay_sum')}</p><input class="e-input" inputmode="decimal" value=${amount} onInput=${(e) => setAmount(e.currentTarget.value)} />
      <p class="e-lbl">${t('bk_pay_until')}</p><input class="e-input" type="date" value=${until} onInput=${(e) => setUntil(e.currentTarget.value)} /></div>
    <button class="btn accent block" style="margin-top:14px" disabled=${busy || !parseAmount(amount) || !until} onClick=${doPay}><${Icon} n="check" cls="sm" />${t('bk_pay')}</button>
    <button class="btn ghost block" onClick=${() => setPay(false)}>${t('cancel')}</button>`;
  return html`<h2>${b0 ? b0.model : t('bk_add')}</h2>
    <div class="x-form">
      <p class="e-lbl">${t('bk_model')}</p><input class="e-input" value=${f.model} placeholder=${t('bk_model_ph')} onInput=${set('model')} />
      <p class="e-lbl">${t('bk_plate')}</p><input class="e-input" value=${f.plate} placeholder=${t('bk_plate_ph')} onInput=${set('plate')} />
      <p class="e-lbl">${t('bk_rider')}</p><div class="chips">${d.members.filter((m) => canVoteRole(m.role)).map((m) => chip(f.rider_id === m.user_id, meOrName(m.user_id), () => setF({ ...f, rider_id: m.user_id })))}${chip(!f.rider_id, t('bk_shared'), () => setF({ ...f, rider_id: null }))}</div>
      <p class="e-lbl">${t('bk_price_l')}</p><div class="row" style="gap:8px"><input class="e-input grow" inputmode="decimal" value=${f.price} placeholder="1 400 000" onInput=${set('price')} /></div>
      <div class="chips" style="margin-top:8px">${['month', 'week', 'day'].map((k) => chip(f.period === k, t('bk_period_' + k), () => setF({ ...f, period: k })))}</div>
      <p class="e-lbl">${t('bk_paid_l')}</p><input class="e-input" type="date" value=${f.paid_until} onInput=${set('paid_until')} />
      <p class="e-lbl">${t('bk_deposit')}</p><input class="e-input" value=${f.deposit} placeholder=${t('bk_deposit_ph')} onInput=${set('deposit')} />
      ${origPassport(f.deposit) && html`<p class="pl-over" style="margin:6px 0 0;font-size:14px">${t('bk_passport')}</p>`}
      <p class="e-lbl">${t('bk_rental')}</p><input class="e-input" value=${f.rental_name} placeholder=${t('bk_rental_ph')} onInput=${set('rental_name')} />
      <p class="e-lbl">${t('bk_wa')}</p><input class="e-input" value=${f.address} placeholder="+62 812…" inputmode="tel" onInput=${set('address')} />
      <p class="e-lbl">${t('bk_return_date')}</p><input class="e-input" type="date" value=${f.return_date} onInput=${set('return_date')} />
    </div>
    <button class="btn accent block" style="margin-top:14px" disabled=${busy || !f.model.trim()} onClick=${() => save()}>${t('x_save')}</button>
    ${b0 && b0.status !== 'returned' && html`<button class="btn surface block" style="margin-top:8px" onClick=${() => setPay(true)}><${Icon} n="wallet" cls="sm" />${t('bk_pay')}</button>
      <button class="btn ghost block" disabled=${busy} onClick=${() => save({ status: 'returned' })}><${Icon} n="check" cls="sm" />${t('bk_return')}</button>`}
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}

// ---------------------------------------------------------------- 3D act (34)
const MODEL_VIEWER = 'https://unpkg.com/@google/model-viewer@4.0.0/dist/model-viewer.min.js';
let mvPromise = null;
function loadModelViewer() {
  if (customElements.get('model-viewer')) return Promise.resolve();
  return (mvPromise ??= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.type = 'module';
    s.src = MODEL_VIEWER;
    s.onload = () => customElements.whenDefined('model-viewer').then(res);
    s.onerror = () => { mvPromise = null; rej(new Error('model-viewer')); };
    document.head.append(s);
  }));
}
function roomIcon(r) {
  const s = String(r).toLowerCase();
  return /гост|living|lounge/.test(s) ? 'sofa' : /спал|bed/.test(s) ? 'bed' : /кух|kitchen/.test(s) ? 'cooking-pot' : /терр|басс|pool|terrace/.test(s) ? 'waves' : /ван|душ|bath|shower/.test(s) ? 'shower-head' : /байк|bike/.test(s) ? 'bike' : 'box';
}
const docUrlCache = {};
async function docUrl(id) {
  const c = docUrlCache[id];
  if (c && Date.now() - c.at < 12 * 60e3) return c.url;
  const r = await api('/app/api/doc-link', { id });
  const u = new URL(r.url, location.href);
  const url = u.pathname + u.search; // same origin: model-viewer fetches it with XHR
  docUrlCache[id] = { url, at: Date.now() };
  return url;
}
function Model({ scan, poster, label }) {
  const [src, setSrc] = useState(null);
  const [err, setErr] = useState(false);
  const mv = useRef(null);
  useEffect(() => {
    const el = mv.current;
    if (!el) return;
    const f = () => { setErr(true); setSrc(null); };
    el.addEventListener('error', f);
    return () => el.removeEventListener('error', f);
  }, [src]);
  useEffect(() => {
    let dead = false;
    setSrc(null); setErr(false);
    if (!scan?.doc_id || !scan.has_file) return;
    Promise.all([loadModelViewer(), docUrl(scan.doc_id)]).then(([, u]) => !dead && setSrc(u)).catch(() => !dead && setErr(true));
    return () => { dead = true; };
  }, [scan?.doc_id]);
  const cap = scan ? [t('ac_scan', { d: fmtDM(scan.doc_at ?? scan.created_at) }) + ' · ' + fmtTime(scan.doc_at ?? scan.created_at), scan.app, scan.doc_size ? `${fmtNum(Math.round(scan.doc_size / 1e5) / 10)} ${LANG === 'ru' ? 'МБ' : 'MB'}` : null].filter(Boolean).join(' · ') : '';
  return html`<div class="ac-view" style=${poster ? `--poster:url(${poster})` : ''}>
    ${src ? html`<model-viewer ref=${mv} src=${src} camera-controls touch-action="pan-y" ar ar-modes="webxr scene-viewer quick-look" shadow-intensity="0.6" exposure="1" interaction-prompt="none" style="width:100%;height:100%">
        <button slot="ar-button" class="ac-ar"><${Icon} n="scan" cls="sm" />AR</button></model-viewer>`
      : html`<div class="ac-ph">${err ? t('ac_fail') : scan?.has_file ? t('ac_loading') : ''}</div>`}
    <span class="ac-pill"><${Icon} n="box" cls="sm" />${label ?? t('ac_spin')}</span>
    ${!src && html`<span class="ac-ar ghost"><${Icon} n="scan" cls="sm" />AR</span>`}${!src && !err && html`<span class="ac-rot"><${Icon} n="rotate-3d" /></span>`}
    ${cap && html`<span class="ac-cap">${cap}</span>`}
  </div>`;
}
function Act() {
  const d = D();
  const l = dealListing();
  const scans = (d.scans ?? []).filter((s) => s.phase !== 'bike');
  const ins = scans.filter((s) => s.phase === 'movein');
  const outs = scans.filter((s) => s.phase === 'moveout' && s.has_file);
  const withFile = ins.filter((s) => s.has_file);
  const [sel, setSel] = useState(withFile[0]?.id ?? null);
  const cur = ins.find((s) => s.id === sel) ?? withFile[0] ?? null;
  const pair = cur ? outs.find((o) => o.room.toLowerCase() === cur.room.toLowerCase()) ?? (outs.length && ins.length === 1 ? outs[0] : null) : null;
  const terms = d.deal?.data?.terms ?? {};
  const moveOut = d.moveout?.date ?? terms.to ?? null;
  const done = ins.filter((s) => s.has_file && s.status === 'ok').length;
  const send = async () => { try { await api('/app/api/scan-send', { search_id: d.search.id }); hap.ok(); toast(t('ac_sent')); } catch { toast(t('err_generic')); } };
  const ph = photosOf(l)[0];
  return html`<main class="screen w2">
    <${W3Head} kicker=${terms.from ? t('ac_kicker', { home: homeName(), d: fmtDM(terms.from) }) : homeName()} title=${t('ac_title')} />
    ${cur ? (pair ? html`<div class="ac-pair"><${Model} scan=${cur} poster=${ph} label=${t('ac_in')} /><${Model} scan=${pair} poster=${ph} label=${t('ac_out')} /></div>` : html`<${Model} scan=${cur} poster=${ph} />`)
      : html`<div class="w3-big acc"><p class="w3-big-k"><${Icon} n="box" />${t('ac_none_t')}</p><p class="w3-big-s">${t('ac_none')}</p></div>
        ${d.bot_username && html`<button class="btn surface block" style="margin-bottom:14px" onClick=${() => openLink(`https://t.me/${d.bot_username}`)}><${Icon} n="send" cls="sm" />${t('ac_open_bot')}</button>`}`}
    ${ins.length > 0 && html`<div class="card w2-list"><div class="w2-lh"><span>${t('ac_rooms', { x: done, n: ins.length })}</span></div>
      ${ins.map((s) => html`<button key=${s.id} class=${'w2-row w3-irow' + (cur?.id === s.id ? ' ac-sel' : '')} disabled=${!s.has_file} onClick=${() => { hap.sel(); setSel(s.id); }}>
        <span class="sq big"><${Icon} n=${roomIcon(s.room)} /></span><div class="grow"><b>${s.room}</b>
        <span>${s.status === 'redo' ? [t('ac_redo'), s.note].filter(Boolean).join(' — ') : s.status === 'todo' || !s.has_file ? [t('ac_todo'), s.note].filter(Boolean).join(' — ') : s.status === 'redo' ? [t('ac_redo'), s.note].filter(Boolean).join(' — ') : [fmtDM(s.doc_at ?? s.created_at), s.note].filter(Boolean).join(' · ')}</span></div>
        <${Icon} n=${s.status === 'ok' && s.has_file ? 'circle-check' : s.status === 'redo' ? 'circle-alert' : 'circle-dashed'} cls=${s.status === 'ok' && s.has_file ? 'pl-ic-ok' : s.status === 'redo' ? 'pl-ic-over' : 'muted'} /></button>`)}</div>`}
    <div class="ac-btns">
      <button class="btn accent big" disabled=${!withFile.length || !canVoteRole(d.me.role)} onClick=${send}><${Icon} n="send" />${t('ac_send')}</button>
      <button class="btn outline big" onClick=${() => go(sp('bikes'))}><${Icon} n="bike" />${t('bk_title')}</button>
    </div>
    <p class="w2-foot">${moveOut ? t('ac_foot', { d: fmtDM(moveOut) }) : t('ac_foot_nodate')}</p>
    <${Nav} tab="today" />
  </main>`;
}

// ---------------------------------------------------------------- house dossier (35)
const DO_ICON = { issue: ['wrench', 'mango'], power: ['zap-off', 'mango'], cleaning: ['sparkles', 'jungle'], conflict: ['receipt-text', 'mango'], good: ['thumbs-up', 'jungle'], money: ['banknote', 'mango'], other: ['info', ''] };
const dossierCache = {};
function useDossier(lid) {
  const [v, setV] = useState(dossierCache[lid] ?? null);
  useEffect(() => {
    if (!lid) return;
    api('/app/api/dossier?listing_id=' + encodeURIComponent(lid)).then((j) => { dossierCache[lid] = j; setV(j); }).catch(() => setV({ dossiers: [] }));
  }, [lid]);
  return v;
}
function Dossier({ id }) {
  const lid = id || dealListing()?.id;
  const l = listingById(lid);
  const v = useDossier(lid);
  const ds = v?.dossiers?.[0] ?? null;
  const st = ds?.stats ?? {};
  const items = ds ? (ds.items?.length ? ds.items : (ds.issues ?? []).map((i) => ({ id: i.id, kind: 'issue', title: i.title, text: [i.note, i.fixed_at ? fmtDM(i.fixed_at) : null].filter(Boolean).join(' · ') }))) : [];
  const issues = st.issues ?? ds?.issues?.length ?? null;
  return html`<main class="screen w2">
    <${W3Head} kicker=${[ds?.title ?? shortTitle(l?.title), ds?.area_text ?? districtShort(l)].filter(Boolean).join(' · ')} title=${t('do_title')} />
    ${v == null ? html`<div class="skeleton" style="height:200px"></div>` : !ds ? html`<div class="card" style="padding:16px"><p class="muted" style="margin:0">${t('do_none')}</p></div>` : html`
      <div class="w3-tiles do-tiles">
        <div class="card"><b>${st.months != null ? t('do_mo', { n: st.months }) : '—'}</b><span>${t('do_months')}</span></div>
        <div class="card"><b>${st.price != null ? money(st.price, st.currency) : '—'}</b><span>${st.price_note ?? t('do_price')}</span></div>
        <div class="card"><b>${issues ?? '—'}</b><span>${t('do_issues', { n: issues ?? 0 })}</span></div>
      </div>
      ${items.length > 0 && html`<div class="card w2-list"><div class="w2-lh"><span>${t('do_what')}</span></div>
        ${items.map((x) => { const [ic, cls] = DO_ICON[x.kind] ?? DO_ICON.other; return html`<div key=${x.id} class="w2-row"><${Icon} n=${ic} cls=${'do-ic ' + cls} /><div class="grow"><b>${x.title}</b>${x.text && html`<span>${x.text}</span>`}</div></div>`; })}</div>`}
      ${(ds.verdict_title || ds.verdict) && html`<div class="w2-note col"><b>${ds.verdict_title ? t('do_verdict', { x: ds.verdict_title }) : t('do_verdict', { x: '' })}</b>${ds.verdict && html`<span>${ds.verdict}</span>`}</div>`}`}
    <p class="w2-foot">${t('do_foot')}</p>
    <${Nav} tab="today" />
  </main>`;
}

// ---------------------------------------------------------------- things bought with the villa (36)
function itemIcon(it) {
  if (it.icon && ICONS[it.icon]) return it.icon;
  const s = String(it.name).toLowerCase();
  return /доск|board|surf/.test(s) ? 'waves' : /блендер|blender|миксер/.test(s) ? 'blend' : /суш|бель|dryer|laundry/.test(s) ? 'shirt' : /комод|шкаф|полк|drawer|shelf|wardrobe/.test(s) ? 'archive'
    : /сетк|net|mosquito/.test(s) ? 'shield' : /вентил|fan/.test(s) ? 'fan' : /холод|fridge/.test(s) ? 'refrigerator' : /байк|bike/.test(s) ? 'bike' : /посуд|кастр|pan|pot|kitchen/.test(s) ? 'cooking-pot' : 'box';
}
function Items() {
  const d = D();
  const iv = d.items ?? { items: [] };
  const items = iv.items ?? [];
  const cur = iv.currency ?? briefCur(d.search);
  const sellers = {};
  for (const i of items) if (i.seller) sellers[i.seller] = (sellers[i.seller] ?? 0) + 1;
  const top = Object.entries(sellers).sort((a, b) => b[1] - a[1])[0]?.[0];
  const terms = d.deal?.data?.terms ?? {};
  const moveOut = d.moveout?.date ?? terms.to ?? null;
  const canEdit = canVoteRole(d.me.role);
  const gen = (s) => (LANG === 'ru' ? String(s).replace(/ья$/, 'ьи').replace(/ия$/, 'ии').replace(/а$/, 'ы').replace(/я$/, 'и') : s);
  return html`<main class="screen w2">
    <${W3Head} kicker=${top ? t('it_kicker', { s: gen(top), n: t('it_kicker0', { n: items.length }) }) : t('it_kicker0', { n: items.length })} title=${items.length ? t('it_title', { x: money(iv.total, cur) }) : t('it_title0')} />
    <div class="card w2-list"><div class="w2-lh"><span>${t('it_ours')}</span>${canEdit && html`<button class="w2-add" onClick=${() => openSheet('item', 'new')}><${Icon} n="plus" cls="sm" />${t('it_add')}</button>`}</div>
      ${items.length ? items.map((it) => html`<button key=${it.id} class=${'w2-row w3-irow' + (it.status === 'sold' ? ' it-sold' : '')} onClick=${() => openSheet('item', it.id)}><span class="sq big"><${Icon} n=${itemIcon(it)} /></span>
        <div class="grow"><b>${it.name}</b><span>${[it.price != null ? money(it.price, it.currency ?? cur) : null, it.seller || it.bought_at ? t('it_at', { s: it.seller ? gen(it.seller) : '', d: it.bought_at ? fmtDM(it.bought_at) : '' }).replace(/\s+/g, ' ').trim() : null].filter(Boolean).join(' · ')}</span></div>
        ${it.status !== 'have' && html`<span class=${'st2 ' + (it.status === 'sold' ? 'ok' : 'wait')}>${t('it_' + it.status)}</span>`}</button>`)
      : html`<div class="w2-row"><span class="muted">${t('it_none')}</span></div>`}
    </div>
    ${items.some((i) => i.status !== 'sold') && html`<div class="card w3-text"><div class="w3-warn-h it-resale"><${Icon} n="recycle" /><b>${t('it_resale_t')}</b></div>
      <p>${moveOut ? t('it_resale', { d: fmtDM(moveOut), x: money(iv.resale_target, cur) }) : t('it_resale_nodate', { x: money(iv.resale_target, cur) })}</p></div>`}
    <${Nav} tab="today" />
  </main>`;
}
function ItemSheet({ id }) {
  const d = D();
  const it = (d.items?.items ?? []).find((x) => x.id === id) ?? null;
  const [f, setF] = useState(() => ({ name: it?.name ?? '', price: it?.price != null ? String(it.price) : '', seller: it?.seller ?? '', bought_at: it?.bought_at ?? dayKey(new Date().toISOString()) }));
  const [sold, setSold] = useState(it?.sold_price != null ? String(it.sold_price) : '');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.currentTarget.value });
  const cur = d.items?.currency ?? briefCur(d.search);
  async function save(extra = {}) {
    setBusy(true);
    try { const r = await api('/app/api/item', { search_id: d.search.id, id: it?.id ?? 'new', ...f, price: parseAmount(f.price), currency: cur, ...extra }); d.items = r.items; hap.ok(); toast(t('it_saved')); closeSheet(); emit(); }
    catch { toast(t('err_generic')); }
    setBusy(false);
  }
  async function del() {
    setBusy(true);
    try { const r = await api('/app/api/item-delete', { id: it.id }); d.items = r.items; hap.ok(); closeSheet(); emit(); } catch { toast(t('err_generic')); }
    setBusy(false);
  }
  return html`<h2>${it ? it.name : t('it_new')}</h2>
    <div class="x-form">
      <p class="e-lbl">${t('pl_name')}</p><input class="e-input" value=${f.name} placeholder=${t('it_name_ph')} onInput=${set('name')} />
      <p class="e-lbl">${t('it_price')}</p><input class="e-input" inputmode="decimal" value=${f.price} placeholder="300 000" onInput=${set('price')} />
      <p class="e-lbl">${t('it_seller')}</p><input class="e-input" value=${f.seller} placeholder=${t('it_seller_ph')} onInput=${set('seller')} />
      <p class="e-lbl">${t('it_date')}</p><input class="e-input" type="date" value=${f.bought_at} onInput=${set('bought_at')} />
      ${it && html`<p class="e-lbl">${t('it_sold_price')}</p><input class="e-input" inputmode="decimal" value=${sold} onInput=${(e) => setSold(e.currentTarget.value)} />`}
    </div>
    <button class="btn accent block" style="margin-top:14px" disabled=${busy || !f.name.trim()} onClick=${() => save()}>${t('x_save')}</button>
    ${it && it.status !== 'sold' && html`<button class="btn surface block" style="margin-top:8px" disabled=${busy} onClick=${() => save({ status: 'sold', sold_price: parseAmount(sold) })}><${Icon} n="check" cls="sm" />${t('it_mark_sold')}</button>`}
    ${it && it.status === 'sold' && html`<button class="btn surface block" style="margin-top:8px" disabled=${busy} onClick=${() => save({ status: 'have' })}>${t('it_unsold')}</button>`}
    ${it && html`<button class="btn ghost block" disabled=${busy} onClick=${del}><${Icon} n="trash-2" cls="sm" />${t('it_delete')}</button>`}
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}

// ---------------------------------------------------------------- local calendar (37)
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
function calendarRows() {
  const d = D();
  const L = (o) => o?.[LANG] ?? o?.en ?? '';
  const today = dayKey(new Date().toISOString());
  const terms = d.deal?.data?.terms ?? {};
  const until = terms.to && terms.to > today ? addDays(terms.to, 14) : addDays(today, 200);
  const owner = (d.house_contacts ?? []).find((c) => c.role === 'owner' || c.role === 'manager');
  const on = owner ? firstName(owner.name) : null;
  const rows = [];
  const moveOut = d.moveout?.date ?? (d.dates ?? []).find((x) => x.kind === 'moveout')?.date ?? terms.to ?? null;
  if (terms.from) rows.push({ go: 'deal', date: terms.from, cls: 'acc', title: t('cl_movein'), sub: on ? t('cl_movein_sub', { o: on }) : t('cl_movein_sub0') });
  for (const x of d.dates ?? []) {
    if (x.done || x.kind === 'moveout' || (x.kind === 'deposit_return' && x.date === moveOut)) continue;
    rows.push({ go: x.kind === 'payment' ? 'deal' : 'docs', date: x.date, cls: x.kind === 'deposit_return' ? 'acc' : '', title: x.kind === 'payment' && x.amount != null ? `${cap(x.title.split(/[,(]/)[0].trim())} ${money(x.amount, x.currency)}` : x.title, sub: CAD[x.kind] ? t(CAD[x.kind]) : x.note });
  }
  if (moveOut) rows.push({ go: d.moveout ? 'moveout' : 'docs', k: 'moveout', date: moveOut, cls: 'acc', title: t('cl_moveout'), sub: on ? t('cl_moveout_sub', { o: on }) : t('cl_moveout_sub0') });
  for (const b of d.bikes ?? []) if (b.status !== 'returned' && b.paid_until && (!b.rider_id || b.rider_id === d.user.id)) rows.push({ go: 'bikes', date: b.paid_until, cls: '', title: t('cl_pay_bike', { m: b.model }), sub: b.rental_name });
  const myVisa = (d.visas ?? []).find((v) => v.user_id === d.user.id)?.visa_until;
  if (myVisa && (!terms.to || myVisa < terms.to)) {
    const lead = Number(regionPack()?.visa?.extend_lead_days) || 7;
    rows.push({ go: 'important', date: addDays(myVisa, -lead), cls: 'mango', title: t('cl_visa'), sub: t('cl_visa_sub', { d: fmtDM(myVisa) }) });
  }
  const cal = regionPack()?.calendar;
  const alts = [];
  for (const ev of cal?.events ?? []) {
    if (!ev.date || (ev.to ?? ev.date) < today || ev.date > until) continue;
    for (const r of ev.remind ?? []) { const dd = addDays(ev.date, -Number(r.days)); if (dd >= today) rows.push({ date: dd, by: true, cls: 'mango', title: L(r.title), sub: L(r.note) }); }
    rows.push({ date: ev.date, to: ev.to, cls: ev.impact === 'high' ? 'mango' : '', title: L(ev.title), sub: L(ev.note) });
    if (ev.alt) alts.push(L(ev.alt));
  }
  let season = null;
  for (const s0 of cal?.seasons ?? []) {
    const y = Number(today.slice(0, 4));
    const inSeason = (md) => (s0.from <= s0.to ? md >= s0.from && md <= s0.to : md >= s0.from || md <= s0.to);
    if (inSeason(today.slice(5))) season = `${L(s0.title)}. ${L(s0.note)}`;
    else for (const yy of [y, y + 1]) { const dd = `${yy}-${s0.from}`; if (dd > today && dd <= until) { rows.push({ date: dd, cls: '', title: L(s0.title), sub: L(s0.note) }); break; } }
  }
  return { rows: rows.filter((r) => r.date >= today || (r.to && r.to >= today)).sort((a, b) => a.date.localeCompare(b.date) || Number(!!b.by) - Number(!!a.by)), alts, season };
}
let planMode = null;
function Calendar({ toViewings }) {
  const d = D();
  const { rows, alts, season } = calendarRows();
  const geo = useAreasGeo(d.search.country);
  const areas = regionPack()?.areas ?? {};
  const homeA = dealListing() && geo ? areaOf(dealListing(), geo, areas) : null;
  const rn = regionPack()?.name;
  const region = rn ? (LANG === 'ru' ? rn.ru : rn.en) : '';
  const aname = homeA ? areaName(areas[homeA]) : districtShort(dealListing());
  const loc = (s) => (LANG === 'ru' ? String(s).replace(/ан$/, 'ане').replace(/ну$/, 'ну').replace(/ак$/, 'аке').replace(/ур$/, 'уре').replace(/ад$/, 'аде') : s);
  return html`<main class="screen w2">
    <div class="head w3-head"><div><p class="kicker">${aname && d.deal ? t('cl_kicker_home', { r: region, a: loc(aname) }) : region}</p><h1 class="h1 w3-h1">${t('cl_title')}</h1></div>
      ${toViewings && html`<button class="sort-pill" onClick=${toViewings}><${Icon} n="eye" cls="sm" />${t('cl_viewings')}</button>`}</div>
    ${rows.length ? html`<div class="card w2-list">${rows.map((r, i) => html`<div key=${i} class="w2-row cl-row"><span class=${'cl-d ' + r.cls}>${r.by ? t('cl_by', { d: fmtDMshort(r.date) }) : fmtDMshort(r.date) + (r.to && r.to !== r.date ? '–' + fmtDMshort(r.to) : '')}</span>
        <div class="grow"><b>${r.title}</b>${r.sub && html`<span>${r.sub}</span>`}</div></div>`)}</div>`
      : html`<div class="card" style="padding:16px"><p class="muted" style="margin:0">${t('cl_none')}</p></div>`}
    ${season && html`<p class="w2-foot">${t('cl_now_season', { x: season })}</p>`}
    ${alts.map((a) => html`<p class="w2-foot">${a}. ${LANG === 'ru' ? 'Агент уточнит ближе к дате.' : 'The agent re-checks closer to the date.'}</p>`)}
    <${Nav} tab="plan" />
  </main>`;
}
/** "6.03" (no leading zero on the day). */
const fmtDMshort = (dd) => `${Number(dd.slice(8, 10))}.${dd.slice(5, 7)}`;

// ---------------------------------------------------------------- wave 4 links on the house screen
function W4Links() {
  const d = D();
  const row = (screen, ic, title, sub) => html`<button class="card chats-row" onClick=${() => go(sp(screen))}><span class="ic"><${Icon} n=${ic} /></span><div class="grow"><b>${title}</b><span>${sub}</span></div><${Icon} n="chev" cls="sm muted" /></button>`;
  const bikes = (d.bikes ?? []).filter((b) => b.status !== 'returned');
  const ins = (d.scans ?? []).filter((s) => s.phase === 'movein');
  const iv = d.items ?? { items: [] };
  const cur = bikes[0]?.currency ?? briefCur(d.search);
  return html`<div class="w2-links w3-links">
    ${row('act', 'box', t('w4_act'), ins.length ? t('w4_act_sub', { x: ins.filter((s) => s.has_file).length, n: ins.length }) : t('w4_act_sub0'))}
    ${row('bikes', 'bike', t('w4_bikes'), bikes.length ? [t('bk_n', { n: bikes.length }), t('bk_per', { x: money(bikes.reduce((a, b) => a + perMonth(b), 0), cur) })].join(' · ') : t('w4_bikes_sub0'))}
    ${row('items', 'archive', t('w4_items'), iv.items?.length ? `${t('it_kicker0', { n: iv.items.length })} · ${money(iv.total, iv.currency ?? cur)}` : t('w4_items_sub0'))}
    ${d.deal && row('dossier', 'file-text', t('w4_dossier'), t('w4_dossier_sub'))}
  </div>`;
}

/** Listing detail rows: location score, flood risk, a house dossier from earlier searches. */
function ListingW4({ l, noLoc = false }) {
  const d = D();
  useAreasGeo(d.search.country);
  const dos = useDossier(l.id);
  const lv = locCache[l.id];
  const stale = locStale(lv);
  const loc = stale ? null : lv?.location;
  const r0 = loc ? ringKeys(lv)[0] : null;
  const near = loc ? (loc.rings?.[String(r0)]?.places ?? []).filter((p) => p.contribution > 0).slice(0, 3).map((p) => p.name).join(', ') : '';
  const fl = l.flood?.level ?? areaFlood(l)?.level ?? null;
  return html`${dos?.dossiers?.length > 0 && html`<button class="w2-note dos-banner" onClick=${() => go(sp('dossier', l.id))}><${Icon} n="file-text" /><span>${t('do_banner')}</span></button>`}
    ${!noLoc && (l.location_score != null || l.lat != null) && html`<button class="card chats-row" onClick=${() => go(sp('location', l.id))}><span class="ic"><${Icon} n="map-pin" /></span>
      <div class="grow"><b>${l.location_score != null ? t('lc_badge', { n: l.location_score }) : t('lc_row')}</b><span>${near ? t('lc_row_sub', { x: near, r: r0 }) : stale ? t('lc_stale') : l.location_score != null ? t('lc_how', { n: l.location_score }) : t('lc_none', { r: (lv ? ringSet(lv) : packRings()).join('/') })}</span></div><${Icon} n="chev" cls="sm muted" /></button>`}
    ${fl && html`<button class="card chats-row" onClick=${() => go(sp('flood', l.id))}><span class=${'ic' + (fl === 'low' ? '' : ' fl-ic')}><${Icon} n="cloud-rain" /></span>
      <div class="grow"><b>${t('fl_title', { x: t('fl_' + fl) })}</b><span>${l.flood?.summary ?? areaFlood(l)?.note ?? ''}</span></div><${Icon} n="chev" cls="sm muted" /></button>`}`;
}

// ---------------------------------------------------------------- wave 5: shared helpers
const isGuest = () => D()?.me?.role === 'guest';
const fmt1 = (x) => new Intl.NumberFormat(LOC(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(x);
/** "06:30" → "6:30"; hOnly("10:00") → "10". */
const hm = (s) => String(s ?? '').replace(/^0(\d):/, '$1:');
const hOnly = (s) => hm(String(s ?? '').replace(/:00$/, ''));
const msgCard = (s) => html`<div class="card" style="padding:16px;margin-bottom:14px"><p class="muted" style="margin:0">${s}</p></div>`;
const skel = (h = 140) => html`<div class="skeleton" style=${`height:${h}px;margin-bottom:14px`}></div>`;
/** Russian genitive of a first name: Лев → Льва, Игорь → Игоря, Маша → Маши. Latin names stay. */
function genRu(n) {
  const s = String(n ?? '');
  if (LANG !== 'ru' || !/[а-яё]$/i.test(s)) return s;
  const irr = { Лев: 'Льва', Павел: 'Павла', Пётр: 'Петра', Петр: 'Петра' };
  if (irr[s]) return irr[s];
  if (/[гкхжчшщ]а$/i.test(s) || /я$/i.test(s)) return s.slice(0, -1) + 'и';
  if (/а$/i.test(s)) return s.slice(0, -1) + 'ы';
  if (/[йь]$/i.test(s)) return s.slice(0, -1) + 'я';
  if (/[бвгджзклмнпрстфхцчшщ]$/i.test(s)) return s + 'а';
  return s;
}
/** Russian prepositional of a one-word place name: Букит → Буките, Астана → Астане; Меласти, Алматы stay. */
function prepRu(n) {
  const s = String(n ?? '');
  if (LANG !== 'ru' || /\s/.test(s) || !/[а-яё]$/i.test(s)) return s;
  if (/ия$/i.test(s) || /ь$/i.test(s)) return s.slice(0, -1) + 'и';
  if (/[аяй]$/i.test(s)) return s.slice(0, -1) + 'е';
  if (/[бвгджзклмнпрстфхцчшщ]$/i.test(s)) return s + 'е';
  return s;
}
const NA_PLACES = /^(Бали|Букит|Пхукет|Самуи|Панган|Ко Панган|Ланта|Ломбок|Гили)/i;
/** "на Буките", "в Чангу"; en "in Bukit". */
const inPlace = (name) => (!name ? '' : LANG !== 'ru' ? `in ${name}` : `${NA_PLACES.test(name) ? 'на' : 'в'} ${prepRu(name)}`);
const hostNames = () => (isGuest() ? D().me.guest?.hosts ?? [] : (D()?.members ?? []).filter((m) => canVoteRole(m.role)).map((m) => firstName(m.name)));
const hostsGen = () => joinNames(hostNames().map(genRu));
/** "1–8 декабря" / "28 ноября – 5 декабря". */
function rangeDM(a, b) {
  if (!a || !b) return a ? fmtDayMonth(a) : b ? fmtDayMonth(b) : '';
  if (a.slice(0, 7) === b.slice(0, 7)) return `${Number(a.slice(8, 10))}–${fmtDayMonth(b)}`;
  return `${fmtDayMonth(a)} – ${fmtDayMonth(b)}`;
}
/** "2026-03" → "Март 2026". */
function monthYear(ym) {
  const s = String(ym ?? '');
  if (!/^\d{4}-\d{2}/.test(s)) return s;
  return cap(dfmt(s.slice(0, 7) + '-01', { month: 'long', year: 'numeric' }).replace(/\s*г\.?$/, ''));
}
function askConfirm(msg) {
  return new Promise((res) => {
    if (inTG && TG.showConfirm) { try { TG.showConfirm(msg, (ok) => res(!!ok)); return; } catch { /* fall back */ } }
    res(window.confirm(msg));
  });
}
async function copyText(s) {
  try { await navigator.clipboard.writeText(s); hap.ok(); toast(t('gd_copied')); } catch { window.prompt(t('gd_copy_link'), s); }
}
function shareTg(url, text) {
  const link = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  if (inTG) openLink(link);
  else if (navigator.share) navigator.share({ url, text }).catch(() => null);
  else window.open(link, '_blank', 'noopener');
}
const chevRow = (onClick, ic, title, sub, extra = null, cls = '') => html`<button class=${'card chats-row ' + cls} onClick=${onClick}><span class="ic"><${Icon} n=${ic} /></span><div class="grow"><b>${title}</b><span>${sub}</span></div>${extra}<${Icon} n="chev" cls="sm muted" /></button>`;

// ---------------------------------------------------------------- wave 5: surf (39)
function briefMentionsSurf() {
  const b = D()?.search?.brief ?? {};
  if ((b.anchors ?? []).some((a) => a.type === 'surf') || b.anchor?.icon === 'waves') return true;
  return /surf|серф|волн|wave/i.test([b.must_have, b.nice_to_have].filter(Boolean).join(' '));
}
const surfCache = {};
function useSurf(sid, on = true) {
  const [v, setV] = useState(surfCache[sid] ?? null);
  useEffect(() => {
    if (!on || !sid) return;
    const c = surfCache[sid];
    if (c && Date.now() - c._at < 15 * 60e3) { setV(c); return; }
    api('/app/api/surf?search_id=' + encodeURIComponent(sid))
      .then((j) => { j._at = Date.now(); surfCache[sid] = j; setV(j); emit(); })
      .catch((e) => setV({ failed: true, code: e.code, spots: [] }));
  }, [sid, on]);
  return v;
}
const sfH = (h) => (h == null ? '—' : t('sf_m', { x: fmt1(h) }));
const surfBest = (v) => v?.spots?.find((x) => x.id === v.best) ?? null;
function surfWind(w) {
  if (!w) return null;
  if (w.offshore_until) return t('sf_off_until', { h: hOnly(w.offshore_until) }) + (w.later && STR.en['sf_later_' + w.later] ? t('sf_later_' + w.later) : '');
  if (w.offshore_from) return t('sf_off_from', { h: hOnly(w.offshore_from) });
  return w.later === 'onshore' ? t('sf_onshore') : null;
}
function surfSpotSub(x) {
  const kind = [x.bottom ? t('sf_' + x.bottom) : null, x.level ? t('sf_lv_' + x.level) : null].filter(Boolean).join(', ');
  return [x.minutes != null ? t('em_min', { n: x.minutes }) : null, kind || null].filter(Boolean).join(' · ');
}
/** "Сегодня Green Bowl 1,2 м, лучше до 10:00". */
function surfLine(v) {
  const b = surfBest(v);
  if (!b || b.height == null) return null;
  return b.window?.to ? t('sf_line', { s: b.name, h: sfH(b.height), t: hm(b.window.to) }) : t('sf_line0', { s: b.name, h: sfH(b.height) });
}
async function setSurfPref(v) {
  const d = D();
  hap.sel();
  d.me.surf = v;
  d.me.surf_auto = false;
  emit();
  try { await api('/app/api/prefs', { search_id: d.search.id, surf: v }); toast(t(v ? 'sf_on' : 'sf_off')); }
  catch { toast(t('err_generic')); }
}
/** Surf as a living-water card (search-mode Today; K0 "Серф сегодня · Green Bowl до 10:00 · 1,2 м · ветер с берега"). */
function SurfWaterCard({ v }) {
  const b = surfBest(v);
  const ok = b && b.height != null;
  return html`<${WaterCard} cls="pw-surf" label=${t('sf_title')} onClick=${() => go(sp('surf'))}>
    <span class="water-k">${t('sf_row_today')}</span>
    <b class="water-v">${ok ? (b.window?.to ? t('pw_surf_until', { s: b.name, t: hm(b.window.to) }) : b.name) : t('sf_row')}</b>
    <span class="water-s">${ok ? [sfH(b.height), surfWind(b.wind)].filter(Boolean).join(' · ') : t('sf_row_sub')}</span>
  <//>`;
}
function SurfScreen() {
  const d = D();
  const v = useSurf(d.search.id);
  const base = useBasePlaces(d.search.country);
  const guest = isGuest();
  const best = surfBest(v);
  const spots = v?.spots ? [...v.spots].sort((a, b) => (b.id === v.best) - (a.id === v.best)) : [];
  const date = v?.date ?? dayKey(new Date().toISOString());
  const wd = wdShort(date);
  const kicker = [v?.area_name || v?.home?.label || null, `${t('today')}, ${LANG === 'ru' ? wd.toLowerCase() : wd} ${fmtDMshort(date)}`].filter(Boolean).join(' · ');
  const mw = modeWord();
  const linkOf = (x) => {
    const p = (base?.places ?? []).find((y) => y.id === x.id) ?? (d.places ?? []).find((y) => y.id === x.id);
    return p?.lat != null ? mapLink(p.lat, p.lng) : null;
  };
  const heroSub = best && `${[sfH(best.height), best.period != null ? t('sf_period', { n: best.period }) : null, surfWind(best.wind)].filter(Boolean).join(' · ')}${best.minutes != null ? ` · ${t('em_min', { n: best.minutes })}${mw ? ' ' + mw : ''}` : ''}`;
  let body;
  if (v == null) body = skel(150);
  else if (!spots.length) body = msgCard(v.failed || v.error ? t('sf_err') : !v.home ? t('sf_no_home') : t('sf_none'));
  else {
    body = html`<${WaterCard} cls="pw-surf-hd"><span class="water-k">${t('sf_best')}</span>
        ${best ? html`<b class="water-v">${best.name}${best.window && html` · <span class="nw">${hm(best.window.from)}–${hm(best.window.to)}</span>`}</b><span class="water-s">${heroSub}</span>`
          : html`<b class="water-v">${t('sf_flat_t')}</b><span class="water-s">${v.error ? t('sf_err_short') : t('sf_flat')}</span>`}<//>
      <div class="card w2-list"><div class="w2-lh"><span>${t('sf_near')}</span></div>
        ${spots.map((x) => {
          const link = linkOf(x);
          const st = x.stars ?? 1;
          const inner = html`<span class="sq"><${Icon} n="waves" /></span><div class="grow"><b>${x.name}</b><span>${surfSpotSub(x)}</span></div>
            <div class="sf-r"><b>${sfH(x.height)}</b>${x.period != null && html`<span class=${'sf-q s' + st} aria-label=${t('sp_tier') + ' ' + st}>${t('sf_s', { n: x.period })} · ${'★'.repeat(st)}</span>`}</div>`;
          return link ? html`<button key=${x.id} class="w2-row w3-irow" onClick=${() => openLink(link)}>${inner}</button>` : html`<div key=${x.id} class="w2-row w3-irow">${inner}</div>`;
        })}
      </div>
      ${v.error && best && html`<p class="w2-foot" style="margin:0 2px 14px">${t('sf_err_short')}</p>`}`;
  }
  return html`<main class="screen w2">
    <${W3Head} kicker=${kicker} title=${t('sf_title')} />
    ${body}
    ${!guest && html`<button class="w2-note" role="switch" aria-checked=${d.me.surf ? 'true' : 'false'} onClick=${() => setSurfPref(!d.me.surf)}><${Icon} n="sunrise" /><span>${t(d.me.surf ? 'sf_note_on' : 'sf_note_off')}</span></button>`}
    ${guest ? html`<${GuestNav} tab="today" />` : html`<${Nav} tab="today" />`}
  </main>`;
}

// ---------------------------------------------------------------- wave 5: guest guide (40)
const RULE_ICON = { smoke: 'cigarette-off', water: 'droplets', zap: 'zap', trash: 'trash-2', moon: 'moon', key: 'key', car: 'car', dog: 'dog', pool: 'waves', shoe: 'footprints', info: 'info' };
const RULE_KEYS = Object.keys(RULE_ICON);
const guideCache = {};
function useGuide(sid) {
  const [g, setG] = useState(guideCache[sid] ?? null);
  useEffect(() => {
    api('/app/api/guide?search_id=' + encodeURIComponent(sid)).then((j) => { guideCache[sid] = j.guide ?? {}; setG(guideCache[sid]); }).catch((e) => setG({ failed: true, code: e.code }));
  }, [sid]);
  return [g, (x) => { guideCache[sid] = x; setG(x); }];
}
const guideEmpty = (g) => !g || (!g.address && !g.map_url && !g.wifi_name && !(g.rules ?? []).length && !g.note);
function GuideBody({ g, bleed = false }) {
  const d = D();
  const [show, setShow] = useState(false);
  const ph = photoUrl(g.photo);
  const ml = mapLink(g.lat, g.lng, g.map_url);
  const title = g.title || (isGuest() ? d.home?.title : homeName()) || d.search.title;
  const places = (g.places ?? []).slice(0, 6);
  const em = (g.emergency ?? []).filter((x) => x.phone);
  const host = g.host;
  const hostLink = host?.tg_username ? `https://t.me/${String(host.tg_username).replace(/^@/, '')}` : null;
  return html`
    <div class=${'gd-hero' + (bleed ? ' bleed' : '')}>${ph ? html`<img src=${ph} alt="" decoding="async" />` : html`<div class="scene" style=${sceneStyle(d.search.country)}></div>`}</div>
    <p class="kicker">${hostNames().length ? t('gd_kicker', { h: hostsGen() }) : t('gd_title')}</p>
    <h1 class="h1 gd-h1">${title}</h1>
    ${(g.address || ml) && html`<div class="card gd-card"><${Icon} n="map-pin" cls="gd-ic" /><div class="grow gd-addr">${g.address || t('gd_map')}</div>
      ${ml && html`<button class="gd-pill acc" onClick=${() => openLink(ml)}>${t('gd_map')}</button>`}</div>`}
    ${g.wifi_name && html`<div class="card gd-card"><${Icon} n="wifi" cls="gd-ic" /><div class="grow"><b>${t('gd_wifi', { x: g.wifi_name })}</b>${g.wifi_password && html`<span>${t('gd_pass', { x: show ? g.wifi_password : '••••••••' })}</span>`}</div>
      ${g.wifi_password && html`<button class="gd-pill" onClick=${() => (show ? copyText(g.wifi_password) : setShow(true))}>${show ? t('gd_copy') : t('gd_show')}</button>`}</div>`}
    ${(g.rules ?? []).length > 0 && html`<div class="card w2-list"><div class="w2-lh"><span>${t('gd_rules')}</span></div>
      ${g.rules.map((r, i) => html`<div key=${i} class="w2-row w3-irow gd-rule"><${Icon} n=${RULE_ICON[r.icon] ?? 'info'} /><div class="grow">${r.text}</div></div>`)}</div>`}
    ${g.note && html`<div class="card w3-text"><p>${g.note}</p></div>`}
    ${places.length > 0 && html`<div class="gd-places">${places.map((p, i) => html`<div key=${i} class="card gd-place"><span>${p.emoji ?? TYPE_EMOJI[p.type] ?? '📍'} ${p.minutes != null ? t('em_min', { n: p.minutes }) : ptName(p.type)}</span><b>${p.name}</b></div>`)}</div>`}
    ${em.length > 0 && html`<div class="card w2-list"><div class="w2-lh"><span>${t('gd_emergency')}</span></div>
      ${em.map((x, i) => html`<div key=${i} class="w2-row w3-irow"><span class="sq mango"><${Icon} n="siren" /></span><div class="grow"><b>${x.label}</b><span>${x.phone}</span></div><${RoundBtn} ic="phone" label=${t('dr_call')} onClick=${() => openLink(telLink(x.phone))} /></div>`)}</div>`}
    ${host && html`<div class="card w2-list"><div class="w2-row w3-irow"><span class="letter-av">${initial(host.name)}</span><div class="grow"><b>${host.name}</b><span>${t('gd_host')}</span></div>
      ${hostLink && html`<${RoundBtn} ic="send" label=${t('gd_write')} onClick=${() => openLink(hostLink)} />`}</div></div>`}`;
}
function GuideGuest() {
  const d = D();
  const [g] = useGuide(d.search.id);
  return html`<main class="screen gd-screen">
    ${!inTG && html`<button class="back-btn" aria-label=${t('back')} onClick=${back}><${Icon} n="left" /></button>`}
    ${g == null ? html`<div class="gd-hero bleed skeleton"></div>${skel(120)}` : g.failed ? html`<div style="height:calc(var(--safe-top) + 60px)"></div>${msgCard(t('err_generic'))}`
      : html`<${GuideBody} g=${g} bleed />${guideEmpty(g) && msgCard(t('gd_empty'))}`}
    <${GuestNav} tab="today" />
  </main>`;
}
function GuideMember() {
  const d = D();
  const [g, setG] = useGuide(d.search.id);
  const [mode, setMode] = useState(null);
  const [f, setF] = useState(null);
  const [showPw, setShowPw] = useState(false);
  const [icAt, setIcAt] = useState(-1);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!g || g.failed || f) return;
    setF({ address: g.address ?? '', map_url: g.map_url ?? '', wifi_name: g.wifi_name ?? '', wifi_password: g.wifi_password ?? '', note: g.note ?? '',
      rules: (g.rules ?? []).map((r) => ({ icon: RULE_ICON[r.icon] ? r.icon : 'info', text: r.text ?? '' })) });
  }, [g]);
  const m = mode ?? (guideEmpty(g) ? 'edit' : 'view');
  const set = (k, val) => setF({ ...f, [k]: val });
  const setRule = (i, patch) => set('rules', f.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  async function save() {
    setBusy(true);
    try {
      const body = { address: f.address.trim() || null, map_url: f.map_url.trim() || null, wifi_name: f.wifi_name.trim() || null, wifi_password: f.wifi_password || null, note: f.note.trim() || null,
        rules: f.rules.filter((r) => r.text.trim()).map((r) => ({ icon: r.icon, text: r.text.trim() })) };
      const r = await api('/app/api/guide', { search_id: d.search.id, ...body });
      setG({ ...g, ...body, ...(r.guide ?? {}) });
      setF(null);
      hap.ok(); toast(t('gd_saved')); setMode('view'); window.scrollTo(0, 0);
    } catch (e) { toast(e.code === 'sensitive' ? t('gd_sensitive') : t('err_generic')); }
    setBusy(false);
  }
  async function link(action) {
    if (action === 'regenerate' && !(await askConfirm(t('gd_regen_q')))) return null;
    if (action === 'revoke' && !(await askConfirm(t('gd_revoke_q')))) return null;
    try {
      const r = await api('/app/api/guide-link', { search_id: d.search.id, action });
      setG({ ...guideCache[d.search.id], url: r.url ?? null });
      d.guide_ready = !!r.url;
      emit();
      if (action === 'regenerate') toast(t('gd_regen_ok'));
      if (action === 'revoke') { hap.ok(); toast(t('gd_revoked')); }
      return r.url ?? null;
    } catch { toast(t('err_generic')); return null; }
  }
  const share = async () => { const url = await link('share'); if (url) shareTg(url, t('gd_share_text')); };
  const copy = async () => { const url = g.url || (await link('share')); if (url) copyText(url); };
  const lrow = (ic, label, onClick, cls = '') => html`<button class="w2-row w3-irow" onClick=${onClick}><span class=${'sq ' + cls}><${Icon} n=${ic} /></span><div class="grow"><b>${label}</b></div></button>`;
  let body;
  if (g == null || (!g.failed && !f && m === 'edit')) body = skel(260);
  else if (g.failed) body = msgCard(t('err_generic'));
  else {
    const editor = f && html`<div class="x-form gd-form">
        <p class="e-lbl">${t('gd_address')}</p><textarea class="e-input" rows="2" placeholder=${t('gd_address_ph')} value=${f.address} onInput=${(e) => set('address', e.currentTarget.value)}></textarea>
        <p class="e-lbl">${t('gd_map_url')}</p><input class="e-input" inputmode="url" placeholder="https://maps.app.goo.gl/…" value=${f.map_url} onInput=${(e) => set('map_url', e.currentTarget.value)} />
        <p class="e-lbl">${t('gd_wifi_name')}</p><input class="e-input" value=${f.wifi_name} placeholder="ToyaNing_5G" onInput=${(e) => set('wifi_name', e.currentTarget.value)} />
        <p class="e-lbl">${t('gd_wifi_pass')}</p><div class="gd-pw"><input class="e-input" type=${showPw ? 'text' : 'password'} autocomplete="off" value=${f.wifi_password} onInput=${(e) => set('wifi_password', e.currentTarget.value)} />
          <button class="gd-pill" aria-pressed=${showPw ? 'true' : 'false'} onClick=${() => setShowPw(!showPw)}>${showPw ? t('gd_hide') : t('gd_show')}</button></div>
        <p class="e-lbl">${t('gd_rules')}</p>
        <div class="card w2-list gd-rules-ed">
          ${f.rules.map((r, i) => html`<div key=${i} class="gd-rule-ed">
            <div class="gd-rule-row"><button class="gd-ic-btn" aria-label=${t('gd_rule_icon') + ': ' + t('gd_ic_' + r.icon)} aria-expanded=${icAt === i ? 'true' : 'false'} onClick=${() => setIcAt(icAt === i ? -1 : i)}><${Icon} n=${RULE_ICON[r.icon] ?? 'info'} /></button>
              <input class="gd-rule-in" value=${r.text} placeholder=${t('gd_rule_ph')} aria-label=${t('gd_rules')} onInput=${(e) => setRule(i, { text: e.currentTarget.value })} />
              <button class="icon-btn" aria-label=${t('gd_rule_del')} onClick=${() => { set('rules', f.rules.filter((_, j) => j !== i)); setIcAt(-1); }}><${Icon} n="x" cls="sm" /></button></div>
            ${icAt === i && html`<div class="gd-icons" role="group" aria-label=${t('gd_rule_icon')}>${RULE_KEYS.map((k) => html`<button key=${k} class=${'gd-ic-opt' + (r.icon === k ? ' on' : '')} aria-pressed=${r.icon === k ? 'true' : 'false'} aria-label=${t('gd_ic_' + k)} title=${t('gd_ic_' + k)} onClick=${() => { hap.sel(); setRule(i, { icon: k }); setIcAt(-1); }}><${Icon} n=${RULE_ICON[k]} /></button>`)}</div>`}
          </div>`)}
          ${f.rules.length < 12 && html`<button class="w2-add gd-add" onClick=${() => { set('rules', [...f.rules, { icon: 'info', text: '' }]); setIcAt(f.rules.length); }}><${Icon} n="plus" cls="sm" />${t('gd_rule_add')}</button>`}
        </div>
        <p class="e-lbl">${t('gd_note')}</p><textarea class="e-input" rows="2" placeholder=${t('gd_note_ph')} value=${f.note} onInput=${(e) => set('note', e.currentTarget.value)}></textarea>
      </div>
      <button class="btn accent block big" style="margin:16px 0 14px" disabled=${busy} onClick=${save}><${Icon} n="check" />${t('gd_save')}</button>`;
    body = html`
      <div class="seg full gd-seg" role="group">
        <button aria-pressed=${m === 'view' ? 'true' : 'false'} onClick=${() => { hap.sel(); setMode('view'); }}>${t('gd_view')}</button>
        <button aria-pressed=${m === 'edit' ? 'true' : 'false'} onClick=${() => { hap.sel(); setMode('edit'); }}>${t('gd_edit')}</button>
      </div>
      ${m === 'view' ? (guideEmpty(g) ? msgCard(t('gd_empty_member')) : html`<div class="gd-preview"><${GuideBody} g=${g} /></div>`) : editor}
      <div class="card w2-list">
        <div class="w2-lh"><span>${t('gd_link')}</span></div>
        <div class="w2-row"><span class="muted" style="margin:0">${g.url ? t('gd_link_on') : t('gd_link_none')}</span></div>
        ${lrow('send', t('gd_share'), share)}
        ${lrow('copy', t('gd_copy_link'), copy)}
        ${g.url && lrow('refresh-cw', t('gd_regen'), () => link('regenerate'))}
        ${g.url && lrow('ban', t('gd_revoke'), () => link('revoke'), 'mango')}
      </div>`;
  }
  return html`<main class="screen w2">
    <${W3Head} kicker=${homeName()} title=${t('gd_title')} />
    ${body}
    <${Nav} tab="today" />
  </main>`;
}

// ---------------------------------------------------------------- wave 5: what next (41)
const NX = [['stay', 'house'], ['new', 'search'], ['leave', 'plane']];
const nxWeeks = (r) => (r.weeks_left > 0 ? t('nx_weeks', { n: r.weeks_left }) : t('nx_soon'));
const ownerContactName = () => (D()?.house_contacts ?? []).find((c) => c.role === 'owner')?.name ?? null;
function NextCard() {
  const r = D()?.renewal;
  if (!r || r.status !== 'open' || isGuest()) return null;
  return html`<button class="w2-banner nx-card" onClick=${() => go(sp('next'))}><${Icon} n="calendar-clock" /><div class="grow"><b>${t('nx_card')}</b><span>${nxWeeks(r)}</span></div><${Icon} n="chev" cls="sm muted" /></button>`;
}
async function nextVote(choice) {
  const d = D();
  const r = d.renewal;
  if (!r || r.status !== 'open' || !canVoteRole(d.me.role)) return;
  hap.sel();
  const prev = r.votes ?? [];
  r.votes = [...prev.filter((v) => v.user_id !== d.user.id), { user_id: d.user.id, name: d.user.display_name, choice, at: new Date().toISOString() }];
  emit();
  try {
    const x = await api('/app/api/next-vote', { search_id: d.search.id, choice });
    if (x.renewal) d.renewal = x.renewal;
    hap.ok(); emit();
    if (x.renewal?.status === 'decided') refresh();
  } catch { r.votes = prev; emit(); toast(t('err_generic')); }
}
function NextScreen() {
  const d = D();
  const r = d.renewal;
  const o = ownerContactName() ?? t('nx_owner');
  const leaseTo = r?.lease_to ?? d.deal?.data?.terms?.to;
  const kicker = [homeName(), leaseTo ? t('nx_lease_to', { d: fmtDM(leaseTo) }) : null].filter(Boolean).join(' · ');
  if (!r) return html`<main class="screen w2"><${W3Head} kicker=${kicker} title=${t('nx_title')} />${msgCard(t('nx_none'))}<${Nav} tab="today" /></main>`;
  const today = dayKey(new Date().toISOString());
  const votes = r.votes ?? [];
  const decided = r.status === 'decided';
  const sel = decided ? r.choice : votes.find((v) => v.user_id === d.user.id)?.choice ?? null;
  const canVote = canVoteRole(d.me.role) && !decided;
  const avs = (c) => {
    const vs = votes.filter((v) => v.choice === c);
    return vs.length ? html`<span class="avs nx-avs">${vs.map((v) => html`<${Av} key=${v.user_id} m=${memberById(v.user_id) ?? { name: v.name }} size=${26} ring />`)}</span>` : null;
  };
  const sub = (c) => (c === 'stay' ? t('nx_stay_sub', { o }) : t('nx_' + c + '_sub'));
  let head;
  if (decided) {
    const what = r.choice === 'stay' ? t('nx_do_stay', { o }) : r.choice === 'new' ? t(r.new_search_id ? 'nx_do_new' : 'nx_do_new_wait') : t('nx_do_leave');
    head = html`<div class="m-hero w5-hero"><p class="m-k">${t('nx_decided')}</p><p class="w5-big">${t('nx_' + r.choice)}</p>
      <p class="w5-sub">${what}${r.decided_how === 'owner' ? ' ' + t('nx_by_owner') : ''}</p>
      ${r.choice === 'new' && r.new_search_id && html`<button class="btn block m-settle" onClick=${() => go(`/s/${r.new_search_id}/today`)}><${Icon} n="search" cls="sm" />${t('nx_open_new')}</button>`}
      ${r.choice === 'leave' && html`<button class="btn block m-settle" onClick=${() => go(sp('moveout'))}><${Icon} n="door-open" cls="sm" />${t('nx_to_moveout')}</button>`}</div>`;
  } else {
    head = html`<div class="w3-warn nx-note"><div class="w3-warn-h"><${Icon} n="calendar-clock" /><b>${nxWeeks(r)}</b></div>
      <p>${[r.note, r.deadline && r.deadline >= today ? t('nx_by', { d: fmtDM(r.deadline) }) : t('nx_late')].filter(Boolean).join(' ')}</p></div>`;
  }
  return html`<main class="screen w2">
    <${W3Head} kicker=${kicker} title=${t('nx_title')} />
    ${head}
    ${NX.map(([c, ic]) => html`<button key=${c} class=${'card nx-opt' + (sel === c ? ' on' : '')} aria-pressed=${sel === c ? 'true' : 'false'} disabled=${!canVote} onClick=${() => nextVote(c)}>
      <${Icon} n=${ic} cls="nx-ic" /><div class="grow"><b>${t('nx_' + c)}</b><span>${sub(c)}</span>${avs(c)}</div>${canVote && html`<${Icon} n="chev" cls="sm nx-chev" />`}</button>`)}
    <p class="w2-foot">${t('nx_foot')} ${t('nx_voted', { n: votes.length, m: r.voters ?? votersN() })}</p>
    <${Nav} tab="today" />
  </main>`;
}

// ---------------------------------------------------------------- wave 5: negotiation helper (42)
const ngCache = {};
function ngArgs(n) {
  const cur = n.listing?.currency;
  const ref = n.offer?.price ?? n.asked ?? n.market?.median;
  const fem = ['villa', 'apartment'].includes(n.listing?.property_type);
  const parts = [];
  let empty = null, season = null;
  for (const a of n.arguments ?? []) {
    if (a.key === 'median' && a.value != null) parts.push(t('ng_a_median', { x: scaled(a.value, ref) }));
    else if (a.key === 'not_included') {
      const xs = (a.items ?? []).map((k) => pick2(INC[k]) ?? human(k).toLowerCase());
      if (xs.length) parts.push(xs.length > 1 ? t('ng_a_noinc_n', { x: joinNames(xs) }) : t(/а$/.test(xs[0]) ? 'ng_a_noinc_f' : 'ng_a_noinc', { x: xs[0] }));
    } else if (a.key === 'empty_since' && a.date) empty = t(fem ? 'ng_a_empty' : 'ng_a_empty_m', { d: fmtDM(a.date) });
    else if (a.key === 'season' && STR.en['ng_a_season_' + a.season]) season = t('ng_a_season_' + a.season);
    else if (a.key === 'term_upfront' && a.months && !n.offer?.months_upfront) parts.push(t('ng_a_term', { n: a.months }));
    else if (a.key === 'long_listed' && a.days) parts.push(t('ng_a_long', { n: a.days }));
    else if (a.key === 'was_cheaper' && a.price != null) parts.push(t('ng_a_cheaper', { x: money(a.price, cur), d: monthYear(a.date).toLowerCase() }));
  }
  const tail = [empty, season].filter(Boolean).join(' — ');
  if (tail) parts.push(tail);
  return parts.join(', ');
}
function NegoScreen({ id }) {
  const d = D();
  const l = listingById(id);
  const [n, setN] = useState(ngCache[id] ?? null);
  useEffect(() => {
    api('/app/api/negotiation?listing_id=' + encodeURIComponent(id)).then((j) => { ngCache[id] = j; setN(j); }).catch((e) => setN({ failed: true, code: e.code }));
  }, [id]);
  const li = { ...(l ?? {}), ...(n?.listing ?? {}) };
  const cur = li.currency;
  const asked = n?.asked ?? li.price;
  const dn = li.district ? districtLabel(li.district, d.search).split(/\s+\/\s+/)[0] : districtShort(li);
  const sub = [dn, li.bedrooms != null ? t('br', { n: li.bedrooms }) : null, asked != null ? t('ng_asked', { x: money(asked, cur) }) : null].filter(Boolean).join(' · ');
  let body;
  if (n == null) body = skel(220);
  else if (n.failed) body = msgCard(n.code === 'owner_only' ? t('ng_owner_only') : t('err_generic'));
  else {
    const o = n.offer;
    const args = ngArgs(n);
    const mk = n.market;
    let market;
    if (!mk || mk.median == null) market = msgCard(t('ng_market_none'));
    else {
      const ds = joinNames((mk.districts ?? []).map((s) => prepRu(districtLabel(s, d.search).split(/\s+\/\s+/)[0])));
      const beds = mk.bedrooms != null ? t('ng_beds', { n: mk.bedrooms }) : t('ng_similar');
      const title = ds ? t('ng_in', { b: beds, d: ds }) : beds;
      const mn = mk.min ?? mk.median, mx = mk.max ?? mk.median;
      const lo = Math.min(mn, asked ?? mn), hi = Math.max(mx, asked ?? mx);
      const pos = (x) => (hi > lo ? ((x - lo) / (hi - lo)) * 100 : 50);
      const p25 = mk.p25 ?? mk.median, p75 = mk.p75 ?? mk.median;
      market = html`<div class="card ng-mk"><p class="w3-ct">${title}</p>
        <div class="ng-range" role="img" aria-label=${[t('ng_median', { x: money(mk.median, cur) }), asked != null ? t('ng_asked', { x: money(asked, cur) }) : null].filter(Boolean).join(', ')}>
          <i class="ng-track"></i><i class="ng-band" style=${`left:${pos(p25)}%;width:${Math.max(0, pos(p75) - pos(p25))}%`}></i>
          <i class="ng-med" style=${`left:${pos(mk.median)}%`}></i>${asked != null && html`<i class="ng-dot" style=${`left:${pos(asked)}%`}></i>`}</div>
        <div class="ng-lbl"><span>${money(mn, cur)}</span><b>${t('ng_median', { x: scaled(mk.median, mx) })} · ${mk.source === 'pack' ? t('ng_pack') : t('ng_count', { n: mk.count ?? 0 })}</b><span>${money(mx, cur)}</span></div></div>`;
    }
    const pt = li.property_type;
    const hist = n.history ?? [];
    body = html`
      <div class="m-hero w5-hero"><p class="m-k">${t('ng_offer')}</p>
        ${o ? html`<p class="w5-big">${money(o.price, cur)}${o.months_upfront ? ' · ' + t('ng_upfront', { n: o.months_upfront }) : ''}</p>
            ${args && html`<p class="w5-sub">${t('ng_args', { x: args })}</p>`}${o.capped && html`<p class="w5-sub">${t('ng_capped')}</p>`}`
          : html`<p class="w5-big">${t('ng_none_t')}</p><p class="w5-sub">${args ? t('ng_args', { x: args }) : t('ng_none')}</p>`}</div>
      ${market}
      <div class="card w2-list"><div class="w2-lh"><span>${t(pt === 'villa' ? 'ng_hist_villa' : ['apartment', 'condo'].includes(pt) ? 'ng_hist_flat' : 'ng_hist_house')}</span></div>
        ${hist.length ? hist.map((h, i) => {
          const s2 = [h.note || h.title || h.source, h.match && h.match !== 'same' && STR.en['ng_m_' + h.match] ? t('ng_m_' + h.match) : null].filter(Boolean).join(' · ');
          return html`<div key=${i} class="w2-row w3-irow"><${Icon} n="history" cls="ng-hic" /><div class="grow"><b>${monthYear(h.date)} · ${money(h.price, h.currency ?? cur)}</b>${s2 && html`<span>${s2}</span>`}</div></div>`;
        }) : html`<div class="w2-row"><span class="muted" style="margin:0">${t('ng_hist_none')}</span></div>`}
      </div>
      <p class="w5-foot"><${Icon} n="eyeoff" /><span>${t('ng_foot')}</span></p>`;
  }
  return html`<main class="screen w2">
    <${W2Head} l=${l ?? null} title=${shortTitle(li.title) || '—'} sub=${sub} />
    ${body}
    <${Nav} tab="listings" />
  </main>`;
}

// ---------------------------------------------------------------- wave 5: search recap (43)
function recapTexts(rc) {
  const [c, sub] = String(rc.search?.region ?? '').split('/');
  const reg = S.regions?.[c];
  const nm = (x) => x?.[LANG] ?? x?.en ?? null;
  const area = nm(reg?.sub?.[sub]?.name) ?? rc.search?.region_name ?? nm(reg?.name) ?? '';
  const country = nm(reg?.name) ?? rc.search?.region_name ?? '';
  const ms = rc.members ?? [];
  const title = t(ms.length > 1 ? 'rc_found' : 'rc_found1', { a: joinNames(ms.map((m) => firstName(m.name))), p: inPlace(area) }).trim();
  const k = rc.counts ?? {};
  const num = (x) => Number(x ?? 0);
  const tiles = [[num(k.contacted), t('rc_contacted')], [num(k.replied), t('rc_replied')], [num(k.viewings), t('rc_viewings', { n: num(k.viewings) })], [num(k.deals), t('rc_deals', { n: num(k.deals) })]];
  const p = rc.prices;
  const saved = p && p.saved_month > 0 ? (p.saved_term > p.saved_month ? t('rc_saved', { m: money(p.saved_month, p.currency), t: money(p.saved_term, p.currency) }) : t('rc_saved1', { m: money(p.saved_month, p.currency) })) : null;
  return { title, days: rc.days != null ? t('rc_in_days', { n: rc.days }) : null, tiles, saved, foot: ['hunt', country].filter(Boolean).join(' · ') };
}
function RecapCard({ rc, x }) {
  const ph = photoUrl(rc.listing?.photo);
  return html`<div class="rc-card">
    <div class="rc-top"><span class="avs rc-avs">${(rc.members ?? []).slice(0, 5).map((m) => html`<${Av} key=${m.user_id} m=${m} size=${34} />`)}</span><b>${x.title}</b></div>
    ${ph && html`<img class="rc-photo" src=${ph} alt="" decoding="async" />`}
    ${x.days && html`<p class="rc-days">${x.days}</p>`}
    <div class="rc-tiles">${x.tiles.map(([v, lb], i) => html`<div key=${i}><b>${v}</b><span>${lb}</span></div>`)}</div>
    ${x.saved && html`<div class="rc-saved"><${Icon} n="trending-down" /><span>${x.saved}</span></div>`}
    <p class="rc-foot">${x.foot}</p>
  </div>`;
}
const loadImg = (src) => new Promise((res) => {
  if (!src) return res(null);
  const im = new Image();
  try { if (new URL(src, location.href).origin !== location.origin) im.crossOrigin = 'anonymous'; } catch { /* keep */ }
  im.onload = () => res(im);
  im.onerror = () => res(null);
  im.src = src;
});
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function wrapLines(ctx, text, maxW) {
  const out = [];
  let cur = '';
  for (const w of String(text).split(/\s+/)) {
    const tst = cur ? cur + ' ' + w : w;
    if (cur && ctx.measureText(tst).width > maxW) { out.push(cur); cur = w; } else cur = tst;
  }
  if (cur) out.push(cur);
  return out;
}
/** The recap card drawn to a 1080 px wide PNG (same layout as RecapCard). */
async function recapPng(rc, x) {
  await document.fonts?.ready;
  await Promise.all(['600 32px Unbounded', '600 16px Inter', '400 13px Inter'].map((f) => document.fonts?.load(f).catch(() => null)));
  const css = (n) => cssVar(n);
  const W = 358, k = 1080 / W, P = 20, IW = W - 2 * P;
  const ms = (rc.members ?? []).slice(0, 5);
  const [photo, ...avs] = await Promise.all([loadImg(photoUrl(rc.listing?.photo)), ...ms.map((m) => loadImg(m.animal ? `/art/${m.animal.pack}/avatars/${m.animal.slug}.svg` : null))]);
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  const avW = ms.length ? 34 + (ms.length - 1) * 24 : 0;
  ctx.font = '600 16px Inter';
  const tl = wrapLines(ctx, x.title, IW - avW - 12);
  ctx.font = '600 15px Inter';
  const sl = x.saved ? wrapLines(ctx, x.saved, IW - 28 - 32) : [];
  const topH = Math.max(34, tl.length * 21);
  let y = P + topH;
  const photoY = y + 14, photoH = photo ? 150 : 0;
  if (photo) y = photoY + photoH;
  const daysY = y + 18;
  if (x.days) y = daysY + 40;
  const tilesY = y + 14, tileH = 58;
  y = tilesY + tileH * 2 + 8;
  const savedY = y + 14, savedH = 28 + sl.length * 20;
  if (x.saved) y = savedY + savedH;
  const footY = y + 22;
  const H = footY + 14 + P;
  cv.width = 1080;
  cv.height = Math.round(H * k);
  ctx.scale(k, k);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = css('--rc-bg');
  rrect(ctx, 0, 0, W, H, 28);
  ctx.fill();
  // avatars
  const cy = P + topH / 2;
  ms.forEach((m, i) => {
    const cx = P + 17 + i * 24;
    ctx.fillStyle = css('--rc-ring');
    ctx.beginPath(); ctx.arc(cx, cy, 19, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = m.animal?.bg_light || '#E4E9E4';
    ctx.beginPath(); ctx.arc(cx, cy, 17, 0, Math.PI * 2); ctx.fill();
    if (avs[i]) ctx.drawImage(avs[i], cx - 13.25, cy - 13.25, 26.5, 26.5);
    else { ctx.fillStyle = '#132019'; ctx.font = '600 14px Inter'; ctx.textAlign = 'center'; ctx.fillText(initial(m.name), cx, cy + 5); ctx.textAlign = 'left'; }
  });
  ctx.fillStyle = css('--rc-ink');
  ctx.font = '600 16px Inter';
  tl.forEach((s, i) => ctx.fillText(s, P + avW + 12, cy - (tl.length * 21) / 2 + 15 + i * 21));
  if (photo) {
    ctx.save();
    rrect(ctx, P, photoY, IW, photoH, 18);
    ctx.clip();
    const sc = Math.max(IW / photo.naturalWidth, photoH / photo.naturalHeight);
    const w = photo.naturalWidth * sc, h = photo.naturalHeight * sc;
    ctx.drawImage(photo, P + (IW - w) / 2, photoY + (photoH - h) / 2, w, h);
    ctx.restore();
  }
  if (x.days) { ctx.fillStyle = css('--rc-ink'); ctx.font = '600 32px Unbounded'; ctx.fillText(x.days, P, daysY + 32); }
  const tw = (IW - 8) / 2;
  x.tiles.forEach(([v, lb], i) => {
    const tx = P + (i % 2) * (tw + 8), ty = tilesY + Math.floor(i / 2) * (tileH + 8);
    ctx.fillStyle = css('--rc-tile');
    rrect(ctx, tx, ty, tw, tileH, 16); ctx.fill();
    ctx.fillStyle = css('--rc-ink'); ctx.font = '600 22px Unbounded'; ctx.fillText(String(v), tx + 12, ty + 29);
    ctx.fillStyle = css('--rc-ink-2'); ctx.font = '400 12.5px Inter'; ctx.fillText(lb, tx + 12, ty + 47);
  });
  if (x.saved) {
    ctx.fillStyle = css('--rc-save');
    rrect(ctx, P, savedY, IW, savedH, 16); ctx.fill();
    ctx.save();
    ctx.translate(P + 14, savedY + 14 + 1);
    ctx.scale(20 / 24, 20 / 24);
    ctx.strokeStyle = css('--rc-green'); ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.stroke(new Path2D('M22 17 13.5 8.5l-5 5L2 7M16 17h6v-6'));
    ctx.restore();
    ctx.fillStyle = css('--rc-ink'); ctx.font = '600 15px Inter';
    sl.forEach((s, i) => ctx.fillText(s, P + 14 + 20 + 12, savedY + 14 + 15 + i * 20));
  }
  ctx.fillStyle = css('--rc-ink-2'); ctx.font = '600 12px Inter';
  ctx.fillText(x.foot, P, footY + 12);
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('png'))), 'image/png'));
}
function RecapScreen() {
  const d = D();
  const [rc, setRc] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/app/api/recap?search_id=' + encodeURIComponent(d.search.id)).then(setRc).catch(() => setRc({ failed: true })); }, [d.search.id]);
  const x = rc && !rc.failed ? recapTexts(rc) : null;
  async function share() {
    setBusy(true);
    try {
      const blob = await recapPng(rc, x);
      if (inTG) {
        const r = await fetch('/app/api/recap-share?search_id=' + encodeURIComponent(d.search.id), { method: 'POST', headers: { ...authHeaders(), 'content-type': 'image/png' }, body: blob });
        if (!r.ok) throw new Error(String(r.status));
        hap.ok();
        toast(t('rc_sent'));
      } else {
        const file = new File([blob], 'hunt-recap.png', { type: 'image/png' });
        if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text: t('rc_share_text') }).catch(() => null);
        else {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'hunt-recap.png';
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        }
      }
    } catch { toast(t('err_generic')); }
    setBusy(false);
  }
  return html`<main class="screen w2 no-nav">
    ${!inTG && html`<div class="rc-back"><${BackIfWeb} /></div>`}
    ${rc == null ? skel(520) : rc.failed ? msgCard(t('err_generic')) : html`<${RecapCard} rc=${rc} x=${x} />
      ${rc.complete === false && html`<p class="w2-foot" style="margin-top:12px">${t('rc_incomplete')}</p>`}
      <button class="btn accent block big rc-share" disabled=${busy} onClick=${share}><${Icon} n="share-2" />${t('rc_share')}</button>`}
  </main>`;
}

// ---------------------------------------------------------------- wave 5: guests (44, 44b)
const GAREAS = [['guide', 'key'], ['places', 'map'], ['contacts', 'users'], ['issues', 'wrench']];
function GuestNav({ tab }) {
  const a = D()?.me?.guest?.areas ?? {};
  const items = [['today', 'house', 'gs_nav_home'], a.places && ['gplaces', 'map', 'gs_nav_places'], a.contacts && ['gcontacts', 'users', 'gs_nav_contacts']].filter(Boolean);
  return html`<nav class="nav" aria-label="Hunt">
    ${items.map(([k, ic, lb]) => html`<a key=${k} href=${'#' + sp(k)} aria-current=${tab === k ? 'page' : null} aria-label=${t(lb)}
      onClick=${(e) => { e.preventDefault(); if (tab !== k) { hap.sel(); go(sp(k), true); } }}><${Icon} n=${ic} /><span>${t(lb)}</span></a>`)}
  </nav>`;
}
const guestTitle = () => D()?.home?.title || D()?.search?.title || '';
function GuestSurfCard({ v }) {
  const line = surfLine(v);
  return line ? html`<button class="card gs-surf" onClick=${() => go(sp('surf'))}><${Icon} n="waves" /><span>${line}</span></button>` : null;
}
function GuestHome() {
  const d = D();
  const g = d.me.guest ?? {};
  const a = g.areas ?? {};
  const sv = useSurf(d.search.id, !!a.places);
  const hosts = (g.hosts ?? []).map(genRu);
  const kicker = [hosts.length ? t('gs_kicker', { h: joinNames(hosts) }) : t('gs_kicker0'), g.from && g.to ? rangeDM(g.from, g.to) : null].filter(Boolean).join(' · ');
  const sees = [a.guide && t('gs_a_guide'), a.places && t('gs_a_places'), a.contacts && t('gs_a_contacts')].filter(Boolean);
  const until = g.to ? fmtDMshort(g.to) : '—';
  const tile = (k, ic, onClick) => html`<button key=${k} class="card gs-tile" onClick=${onClick}><span class="sq"><${Icon} n=${ic} /></span><b>${t('gs_' + k)}</b><span>${t('gs_' + k + '_sub')}</span></button>`;
  const tiles = [a.guide && tile('guide', 'key', () => go(sp('guide'))), a.places && tile('places', 'map', () => go(sp('gplaces'), true)),
    a.contacts && tile('contacts', 'users', () => go(sp('gcontacts'), true)), a.issues && tile('issue', 'wrench', () => openSheet('issue'))].filter(Boolean);
  const issues = a.issues ? d.issues ?? [] : [];
  return html`<main class="screen w2">
    <div class="head"><div><p class="kicker">${kicker}</p><h1 class="h1 w3-h1">${guestTitle()}</h1></div>
      <button class="gs-me" aria-label=${t('settings')} onClick=${() => openSheet('settings')}><${Av} m=${{ animal: d.me.animal, name: d.user.display_name }} size=${56} /></button></div>
    <div class="gs-banner"><${Icon} n="user" /><span>${sees.length ? t('gs_banner', { x: joinNames(sees), d: until }) : t('gs_banner0', { d: until })}</span></div>
    ${tiles.length > 0 && html`<div class="gs-tiles">${tiles}</div>`}
    ${a.places && html`<${GuestSurfCard} v=${sv} />`}
    ${issues.length > 0 && html`<div class="card w2-list"><div class="w2-lh"><span>${t('gs_my_issues')}</span></div>
      ${issues.map((i) => html`<div key=${i.id} class="w2-row is-row"><div class="grow"><div class="is-hd"><b>${i.title}</b>${issueChip(i)}</div>${i.note && html`<span>${i.note}</span>`}</div></div>`)}</div>`}
    <p class="w5-foot"><${Icon} n="lock" /><span>${t('gs_lock')}</span></p>
    <${GuestNav} tab="today" />
  </main>`;
}
let gpType = 'all';
function GuestPlaces() {
  const d = D();
  const base = useBasePlaces(d.search.country);
  const sv = useSurf(d.search.id, true);
  const [type, setType0] = useState(gpType);
  const setType = (k) => { gpType = k; setType0(k); };
  const home = d.home?.lat != null ? [d.home.lat, d.home.lng] : null;
  const all = allPlaces(base).filter((p) => p.lat != null && !['construction', 'daytrip'].includes(p.type))
    .map((p) => ({ ...p, min: home ? minutesFor(km(home, [p.lat, p.lng])) : null }))
    .filter((p) => p.min == null || p.min <= 40)
    .sort((a, b) => (a.min ?? 999) - (b.min ?? 999) || a.tier - b.tier);
  const types = PT_ORDER.filter((ty) => all.some((p) => p.type === ty));
  const shown = all.filter((p) => type === 'all' || p.type === type).slice(0, 60);
  return html`<main class="screen w2">
    <div class="head w3-head"><div><p class="kicker">${guestTitle()}</p><h1 class="h1 w3-h1">${t('gs_places')}</h1></div></div>
    <${GuestSurfCard} v=${sv} />
    ${types.length > 1 && html`<div class="w3-chips" role="group">
      <button aria-pressed=${type === 'all' ? 'true' : 'false'} onClick=${() => setType('all')}>${t('sp_all')}</button>
      ${types.map((ty) => html`<button key=${ty} class="ic-chip" aria-pressed=${type === ty ? 'true' : 'false'} onClick=${() => { hap.sel(); setType(ty); }}><${Icon} n=${TYPE_ICON[ty] ?? 'map-pin'} cls="sm" />${ptName(ty)}</button>`)}
    </div>`}
    ${shown.length ? html`<div class="card w2-list">${shown.map((p) => html`<button key=${p.id} class="w2-row w3-irow" onClick=${() => openLink(mapLink(p.lat, p.lng))}>
        <span class="sq big"><${Icon} n=${TYPE_ICON[p.type] ?? 'map-pin'} /></span>
        <div class="grow"><b>${p.name}</b><span>${[p.min != null ? t('em_min', { n: p.min }) : null, ptName(p.type), p.note ? p.note.replace(/^./, (c) => c.toLowerCase()) : null].filter(Boolean).join(' · ')}</span></div>
        <span class="sp-stars" aria-label=${t('sp_tier') + ' ' + p.tier}>${stars(p.tier)}</span></button>`)}</div>`
      : msgCard(base ? t('gs_places_none') : '…')}
    <${GuestNav} tab="gplaces" />
  </main>`;
}
const dirWrite = (e) => (e.channel === 'whatsapp' || e.channel === 'telegram' ? channelLink(e.channel, e.address) : null);
function GuestContacts() {
  const d = D();
  const all = d.directory ?? [];
  const ord = (k) => { const i = DG_BUILTIN.indexOf(k); return i < 0 ? 99 : i; };
  const groups = [...new Set(all.map((e) => e.grp))].sort((a, b) => ord(a) - ord(b));
  return html`<main class="screen w2">
    <div class="head w3-head"><div><p class="kicker">${guestTitle()}</p><h1 class="h1 w3-h1">${t('gs_contacts')}</h1></div></div>
    ${groups.length ? groups.map((k) => html`<div key=${k} class="card w2-list"><div class="w2-lh"><span>${dgName(k, true)}</span></div>
      ${all.filter((e) => e.grp === k).map((e) => {
        const wl = dirWrite(e);
        const ph = e.phone || (e.channel === 'phone' ? e.address : null);
        const ml = e.channel === 'map' || (!wl && !ph) ? mapLink(e.lat, e.lng, e.map_url) : null;
        return html`<div key=${e.id} class="w2-row w3-irow dr-row" role="button" tabindex="0" onClick=${() => openSheet('gcontact', e.id)} onKeyDown=${(ev) => ev.key === 'Enter' && openSheet('gcontact', e.id)}>
          <span class="sq big"><${Icon} n=${e.icon && ICONS[e.icon] ? e.icon : DG_ICON[e.grp] ?? 'store'} /></span>
          <div class="grow"><b>${e.name}</b>${e.subtitle && html`<span>${e.subtitle}</span>`}</div>
          <div class="dr-btns">${wl && html`<span class="dr-w" role="button" tabindex="0" aria-label=${t('dr_write')} onClick=${(ev) => { ev.stopPropagation(); openLink(wl); }}><${Icon} n="message-circle" />${e.channel === 'whatsapp' ? 'WA' : 'TG'}</span>`}
            ${ph && html`<${RoundBtn} ic="phone" label=${t('dr_call')} onClick=${() => openLink(telLink(ph))} />`}
            ${ml && html`<${RoundBtn} ic="map-pin" cls="gray" label=${t('dr_map')} onClick=${() => openLink(ml)} />`}</div></div>`;
      })}</div>`) : msgCard(t('gs_contacts_none'))}
    <${GuestNav} tab="gcontacts" />
  </main>`;
}
function GuestContactSheet({ id }) {
  const d = D();
  const e = (d.directory ?? []).find((x) => x.id === id);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  if (!e) return html`<p class="muted">—</p><button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
  const wl = dirWrite(e);
  const ph = e.phone || (e.channel === 'phone' ? e.address : null);
  const ml = mapLink(e.lat, e.lng, e.map_url);
  async function ask() {
    setBusy(true);
    try { await api('/app/api/guest-message', { search_id: d.search.id, directory_id: e.id, text: text.trim() }); hap.ok(); toast(t('gs_ask_sent')); closeSheet(); }
    catch { toast(t('err_generic')); }
    setBusy(false);
  }
  return html`<h2>${e.name}</h2>${e.subtitle && html`<p class="muted" style="margin:0 0 12px">${e.subtitle}</p>`}
    <div class="doc-actions">
      ${wl && html`<button class="btn accent" onClick=${() => openLink(wl)}><${Icon} n="message-circle" />${t('dr_write')}</button>`}
      ${ph && html`<button class="btn surface outline" onClick=${() => openLink(telLink(ph))}><${Icon} n="phone" />${t('dr_call')}</button>`}
      ${ml && html`<button class="btn surface outline" onClick=${() => openLink(ml)}><${Icon} n="map-pin" />${t('dr_map')}</button>`}
    </div>
    ${wl && html`<p class="section" style="margin-top:4px">${t('gs_ask')}</p><p class="muted" style="margin:0 0 10px;font-size:14px">${t('gs_ask_text')}</p>
      <textarea class="e-input" rows="3" placeholder=${t('gs_ask_ph')} value=${text} onInput=${(ev) => setText(ev.currentTarget.value)}></textarea>
      <button class="btn surface block" style="margin-top:10px" disabled=${busy || !text.trim()} onClick=${ask}><${Icon} n="sparkles" cls="sm" />${t('gs_ask')}</button>`}
    <button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
}
function GuestsScreen() {
  const d = D();
  const today = dayKey(new Date().toISOString());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 7));
  const [areas, setAreas] = useState({ guide: true, places: true, contacts: true, issues: true });
  const [link, setLink] = useState(null);
  const [busy, setBusy] = useState(false);
  const active = (d.guests ?? []).filter((g) => g.status === 'active');
  async function invite() {
    if (to < from) return toast(t('gi_bad_dates'));
    if (!Object.values(areas).some(Boolean)) return toast(t('gi_no_areas'));
    setBusy(true);
    try {
      const r = await api('/app/api/guest-invite', { search_id: d.search.id, from, to, areas });
      setLink(r.link);
      hap.ok();
      if (r.link) shareTg(r.link, t('gi_share_text'));
    } catch { toast(t('err_generic')); }
    setBusy(false);
  }
  async function upd(g, body, msg) {
    try { const r = await api('/app/api/guest', { search_id: d.search.id, user_id: g.user_id, ...body }); if (r.guests) d.guests = r.guests; hap.ok(); toast(msg); emit(); }
    catch { toast(t('err_generic')); }
  }
  const extend = (g) => { const nt = addDays(g.to > today ? g.to : today, 7); upd(g, { to: nt }, t('gi_extended', { d: fmtDMshort(nt) })); };
  const revoke = async (g) => { if (await askConfirm(t('gi_revoke_q', { x: firstName(g.name) }))) upd(g, { revoke: true }, t('gi_revoked')); };
  const areaTxt = (a) => GAREAS.filter(([k]) => a?.[k]).map(([k]) => t('gi_a_' + k)).join(', ');
  const dateCard = (lbl, val, set, min) => html`<label class="card gi-date"><span>${lbl}</span><b>${val ? fmtDayMonth(val) : '—'}</b>
    <input type="date" value=${val} min=${min} aria-label=${lbl} onInput=${(e) => e.currentTarget.value && set(e.currentTarget.value)} /></label>`;
  return html`<main class="screen w2">
    <${W3Head} kicker=${t('gi_kicker', { h: homeName() })} title=${t('gi_title')} />
    ${active.length > 0 && html`<div class="card w2-list"><div class="w2-lh"><span>${t('gi_now')}</span></div>
      ${active.map((g) => html`<div key=${g.user_id} class="w2-row gi-row"><${Av} m=${g} size=${44} /><div class="grow"><b>${g.name}</b><span>${[rangeDM(g.from, g.to), areaTxt(g.areas)].filter(Boolean).join(' · ')}</span>
        <div class="gi-btns"><button class="gi-btn" onClick=${() => extend(g)}>${t('gi_extend')}</button><button class="gi-btn gray" onClick=${() => revoke(g)}>${t('gi_revoke')}</button></div></div></div>`)}</div>`}
    <div class="gi-dates">${dateCard(t('gi_from'), from, (v) => { setFrom(v); if (to < v) setTo(addDays(v, 7)); }, today)}${dateCard(t('gi_to'), to, setTo, from)}</div>
    <div class="card w2-list"><div class="w2-lh"><span>${t('gi_sees')}</span></div>
      ${GAREAS.map(([k, ic]) => html`<button key=${k} class="gt-row" role="switch" aria-checked=${areas[k] ? 'true' : 'false'} onClick=${() => { hap.sel(); setAreas({ ...areas, [k]: !areas[k] }); }}>
        <${Icon} n=${ic} /><span class="grow">${t('gi_' + k)}</span><span class=${'sw' + (areas[k] ? ' on' : '')}><i></i></span></button>`)}
      ${[['money', 'wallet'], ['docs', 'file-text'], ['chats', 'msgs']].map(([k, ic]) => html`<div key=${k} class="gt-row off" role="switch" aria-checked="false" aria-disabled="true">
        <${Icon} n=${ic} /><span class="grow">${t('gi_' + k)}</span><span class="sw"><i></i></span></div>`)}
    </div>
    <button class="btn accent block big" disabled=${busy} onClick=${invite}><${Icon} n="send" />${t('gi_send')}</button>
    ${link && html`<button class="btn surface block w3-second" onClick=${() => copyText(link)}><${Icon} n="copy" />${t('gi_copy')}</button>`}
    <p class="w2-foot">${cap(t('gi_foot', { d: fmtDayMonth(to) }))}</p>
    <${Nav} tab="today" />
  </main>`;
}
function GuestDraftCard({ x }) {
  const d = D();
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(x.text ?? '');
  const [busy, setBusy] = useState(false);
  async function act(action) {
    setBusy(true);
    try {
      await api('/app/api/draft', { draft_id: x.id, action, ...(action === 'send' && text !== x.text ? { text } : {}) });
      d.guest_drafts = (d.guest_drafts ?? []).filter((y) => y.id !== x.id);
      hap.ok(); toast(t(action === 'send' ? 'gq_sent' : 'gq_skipped')); emit();
    } catch { toast(t('err_generic')); }
    setBusy(false);
  }
  return html`<div class="card gq-card">
    <div class="gq-h"><${Icon} n="message-circle" /><b>${t('gq_req', { g: firstName(x.requester_name) || '?', c: x.dir_name || x.address || '' })}</b></div>
    ${edit ? html`<textarea class="e-input" rows="3" value=${text} onInput=${(e) => setText(e.currentTarget.value)}></textarea>` : html`<p class="gq-text">«${text}»</p>`}
    <div class="gq-btns"><button class="btn accent" disabled=${busy || !text.trim()} onClick=${() => act('send')}><${Icon} n="send" cls="sm" />${t('gq_send')}</button>
      <button class="btn surface outline" disabled=${busy} onClick=${() => act('skip')}>${t('gq_skip')}</button></div>
    ${!edit && html`<button class="btn link gq-edit" onClick=${() => setEdit(true)}><${Icon} n="pencil" cls="sm" />${t('gq_edit')}</button>`}
  </div>`;
}
function GuestDrafts() {
  const d = D();
  const xs = d.guest_drafts ?? [];
  if (!xs.length || !canVoteRole(d.me.role)) return null;
  return html`${xs.map((x) => html`<${GuestDraftCard} key=${x.id} x=${x} />`)}`;
}

// ---------------------------------------------------------------- wave 5 links on the house screen
function W5Links() {
  const d = D();
  const nG = (d.guests ?? []).filter((g) => g.status === 'active').length;
  const sv = surfCache[d.search.id];
  return html`<div class="w2-links w3-links">
    ${(d.me.surf || briefMentionsSurf()) && chevRow(() => go(sp('surf')), 'waves', t('sf_row'), surfLine(sv) ?? t('sf_row_sub'))}
    ${chevRow(() => go(sp('guide')), 'key', t('gd_title'), d.guide_ready ? t('gd_row_ready') : t('gd_row_sub'))}
    ${canVoteRole(d.me.role) && chevRow(() => go(sp('guests')), 'users', t('gi_row'), nG ? t('gi_row_sub', { n: nG }) : t('gi_row_sub0'), nG ? html`<span class="count-badge acc">${nG}</span>` : null)}
    ${d.deal && chevRow(() => go(sp('recap')), 'share-2', t('rc_title'), t('rc_row_sub'))}
  </div>`;
}

// ---------------------------------------------------------------- wave 6 · D: home mode (46 before move-in, 46b living, 46c "Ещё")
Object.assign(ICONS, {
  'layout-grid': '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  'book-open': '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
});
const HM_IDX = { start: 1, search: 2, viewings: 3, choice: 4, deal: 5, movein: 6, living: 7, extension: 7, next: 8, relet: 9, moveout: 9, closed: 9 };
const HM_BEFORE = ['choice', 'deal', 'movein'];
/** Home mode: the project has a chosen home (path.home_listing_id; before the pipeline lands: a deal). Guests keep their own app. */
function homeMode() {
  const d = D();
  if (!d?.search || !d.me || d.me.role === 'guest') return false;
  return d.path ? !!d.path.home_listing_id : !!d.deal;
}
const hmToday = () => dayKey(new Date().toISOString());
const hmDays = (day) => (day ? Math.round((Date.parse(String(day).slice(0, 10) + 'T00:00:00Z') - Date.parse(hmToday() + 'T00:00:00Z')) / 864e5) : null);
const hmRow = (key) => (D()?.path?.rows ?? []).find((r) => r.key === key) ?? null;
/** Deal facts for the badges: lease signed, payments before move-in done (path.rows deal.facts; else documents + deal dates). */
function hmDealFacts() {
  const d = D();
  const f = hmRow('deal')?.facts;
  if (f) return { signed: !!f.signed_at, paid: Number(f.paid) > 0 && !(Number(f.pending) > 0) };
  const from = d.deal?.data?.terms?.from;
  const pays = (d.dates ?? []).filter((x) => x.kind === 'payment' && (!from || x.date <= from));
  return { signed: (d.documents ?? []).some((x) => x.kind === 'lease' && x.signed_at), paid: pays.length > 0 && pays.every((x) => x.done) };
}
/** {key, idx, n, closed}: path (A) when present, else a rough guess from the search status and the deal. */
function homeStage() {
  const d = D();
  const p = d.path;
  if (p?.key) return { key: p.key, idx: p.idx ?? HM_IDX[p.key] ?? 1, n: p.n ?? 9, closed: !!p.closed || p.key === 'closed' };
  if (d.search.status === 'closed') return { key: 'closed', idx: 9, n: 9, closed: true };
  if (isLiving()) return { key: 'living', idx: 7, n: 9, closed: false };
  const k = hmDealFacts().signed ? 'movein' : 'deal';
  return { key: k, idx: HM_IDX[k], n: 9, closed: false };
}
/** 'before' (choice/deal/movein) | 'living' (living/extension/next/relet/moveout) | 'closed'. */
function homePhase() {
  const st = homeStage();
  return st.closed ? 'closed' : HM_BEFORE.includes(st.key) ? 'before' : 'living';
}
const homeListing = () => listingById(D()?.path?.home_listing_id) ?? dealListing();
const hmTerms = () => D()?.path?.terms ?? [];
const hmCurTerm = () => hmTerms().find((x) => x.current) ?? null;
/** The whole stay: first move-in → end of the current term (path living facts / terms; else the deal's first term). */
function hmStay() {
  const tm = D()?.deal?.data?.terms ?? {};
  const lv = hmRow('living')?.facts;
  const ct = hmCurTerm();
  const from = lv?.from ?? hmTerms()[0]?.from ?? tm.from ?? null;
  const to = ct?.to ?? lv?.to ?? tm.to ?? null;
  return { from, to };
}
const hmMoveIn = () => hmRow('movein')?.facts?.date ?? hmRow('movein')?.date ?? D()?.deal?.data?.terms?.from ?? null;
/** "3 спальни в Унгасане" / "3 bedrooms in Ungasan"; falls back to the home name. */
function homeDesc(l) {
  const dn = l ? districtShort(l) : '';
  if (l?.bedrooms == null) return dn ? cap(inPlace(dn)) : '';
  return [t('bedrooms', { n: l.bedrooms }), dn ? inPlace(dn) : null].filter(Boolean).join(' ');
}
/** Home name for home-mode titles (wave 8.1: the short name, see homeName). */
const hmName = () => homeName();
function HomeNav({ tab }) {
  // wave 8.1: Дом · Афиша · Деньги · Ещё; the map and the plan live at the top of Ещё (+ quick links on Home)
  const cur = ['listings', 'map', 'plan', 'archive'].includes(tab) ? 'more' : tab;
  const items = [['today', 'house'], ['afisha', 'ticket'], ['money', 'wallet'], ['more', 'layout-grid']];
  return html`<nav class="nav hm-nav" aria-label="Hunt">
    ${items.map(([k, ic]) => html`<a key=${k} href=${'#' + sp(k)} aria-current=${cur === k ? 'page' : null}
      onClick=${(e) => { e.preventDefault(); if (cur !== k || tab !== k) { hap.sel(); go(sp(k), true); } }}><${Icon} n=${ic} /><span>${t('hm_nav_' + k)}</span></a>`)}
  </nav>`;
}
/** Home Plan data (bookings + today's top event), shared by the day and the evening Home. */
function useEventPlan() {
  const d = D();
  const [v, setV] = useState(null);
  useEffect(() => {
    let live = true;
    api('/app/api/event-plan?s=' + encodeURIComponent(d.search.id)).then((j) => live && setV(j)).catch(() => live && setV({ failed: true }));
    return () => { live = false; };
  }, [d.search.id, AF.rev]);
  return v;
}
/** Wave 8.1: today's top event as a small ticket on Home ("Сегодня вечером"), linking to the event and the Афиша. */
function TonightTicket({ ev, total }) {
  if (!ev) return null;
  const d = D();
  const evening = Number(String(ev.starts_at ?? '').slice(11, 13)) >= 17;
  const meta = [afHM(ev), afPlace(ev), ev.minutes != null ? t('em_min', { n: ev.minutes }) : null].filter(Boolean).join(' · ');
  const more = Math.max(0, (total ?? 0) - 1);
  return html`<div class="hm81-tk">
    <button class="hm81-tk-main" onClick=${() => { hap.sel(); go(sp('event', ev.key)); }}>
      <span class="frame hm81-tk-ph"><span class="in">${photoUrl(ev.photo) ? html`<img src=${photoUrl(ev.photo)} alt="" decoding="async" />` : html`<span class="scene solid" style=${sceneStyle(d.search.country)}></span>`}</span></span>
      <span class="grow hm81-tk-t"><small>${evening ? t('w81_tonight') : cap(t('pp_today'))}</small><b>${afTitle(ev)}</b><span>${meta}</span></span>
    </button>
    <button class="hm81-tk-all" onClick=${() => { hap.sel(); go(sp('afisha')); }}>${more ? t('w81_tonight_n', { n: more }) : t('af_title')}<${Icon} n="arrow-up-right" cls="sm" /></button>
  </div>`;
}
function HomeHero({ sv = null }) {
  const d = D();
  const l = homeListing();
  const ph = photosOf(l)[0];
  const phase = homePhase();
  const ep = useEventPlan();
  const name = hmName();
  let over = name, title = name, sub;
  if (phase === 'before') {
    const mi = hmMoveIn();
    const n = hmDays(mi);
    title = mi == null ? t('hm_movein_none') : n < 0 ? t('hm_moved_in', { d: fmtDayMonth(mi) }) : n === 0 ? t('hm_movein_today') : n === 1 ? t('hm_movein_tomorrow')
      : n < 7 ? t('hm_movein_wd', { wd: t('hm_wd_acc', { n: asDate(mi).getUTCDay() }) }) : t('hm_movein_date', { d: fmtDayMonth(mi) });
    sub = [l?.bedrooms != null ? t('bedrooms', { n: l.bedrooms }) : null, n != null && n > 1 ? t('hm_in_days', { n }) : null].filter(Boolean).join(' · ');
  } else if (phase === 'living') {
    const { from, to } = hmStay();
    const lv = hmRow('living')?.facts;
    const total = lv?.days ?? (from && to ? Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 864e5) : null);
    const day = lv?.day ?? (from ? Math.max(1, 1 - hmDays(from)) : null);
    if (day != null && total) over = `${name} · ${t('w81_day', { d: Math.min(day, total), n: total })}`;
    const left = hmDays(to);
    const today = hmToday();
    sub = [`${wdShort(today)} ${fmtDayMonth(today)}`, left != null && left >= 0 ? t('hm_left_lease', { n: left }) : null].filter(Boolean).join(' · ');
  } else sub = t('hm_closed');
  // V4-1 / wave 8.1: the one statement types and cycles through 2–3 real facts: the title (move-in countdown / day), the next
  // payment, the surf (when there is a forecast), tonight's top event
  const today = hmToday();
  const pay = (d.dates ?? []).filter((x) => !x.done && x.kind === 'payment' && x.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const b = phase !== 'closed' ? surfBest(sv) : null;
  const surfLine = b && b.height != null ? (b.window?.to ? t('w8_surf_line', { h: sfH(b.height), t: hm(b.window.to) }) : `${t('sf_title')} ${sfH(b.height)}`) : null;
  const payLine = pay ? (pay.amount != null ? t('hm_pay', { x: money(pay.amount, pay.currency), w: t('hm_in_days', { n: hmDays(pay.date) }) }) : `${pay.title} ${t('hm_in_days', { n: hmDays(pay.date) })}`) : null;
  const top = phase !== 'closed' && ep && !ep.failed ? ep.top : null;
  const evLine = top ? t('w81_ev_line', { t: afTitle(top) }) : null;
  const ordA = (OR.sid === d.search.id ? OR.v?.active ?? [] : []).find((o) => o.status === 'confirmed' && o.time && (!o.day || o.day === today)); // wave 10
  const ordLine = ordA ? t('or_line_by', { s: ordA.supplier, t: hm(ordA.time) }) : null;
  const lines = (phase === 'living' ? [ordLine, surfLine, evLine, payLine] : [ordLine, title, payLine, surfLine, evLine]).filter(Boolean).slice(0, 3);
  if (!lines.length) lines.push(title);
  const open = (d.deal?.data?.checklist ?? []).filter((c) => !c.done).length;
  const st = homeStage();
  const pw = d.power?.days_left != null ? Math.max(0, Math.floor(d.power.days_left)) : null;
  const stats = [
    pay && { k: t('w8_k_pay'), v: t('hm_in_days', { n: hmDays(pay.date) }), go: 'deal' },
    pw != null && { k: t('w8_k_power'), v: t('w8_power_v', { n: pw }), go: 'power' },
    { k: t('w8_k_stage'), v: t('w8_stage_v', { i: Math.min(st.idx, st.n), n: st.n }), go: 'path' },
  ].filter(Boolean);
  const ms = d.members.slice(0, 2);
  return html`<section class="w8-hero hm8">
    <${BigWord} text=${t('w8_home')} />
    ${b && b.height != null && html`<${WaterCard} cls="water-dot hm8-surf" label=${t('sf_title')} onClick=${() => go(sp('surf'))}><b>${sfH(b.height)}</b><small>${b.window?.to ? t('w8_surf_dot', { t: hm(b.window.to) }) : b.name}</small><//>`}
    <div class="hm8-stage">
      <${FloatPhoto} src=${ph} cls="hm8-ph" label=${name} onClick=${() => l && go(sp('listing', l.id))} />
      <${AniStickers} ms=${ms} size=${58} pos=${['left:2%;top:-6%', 'right:2%;bottom:-12%']} />
    </div>
    <p class="kicker hm8-over">${over}</p>
    <${Typed} lines=${lines} />
    ${sub && html`<p class="w8-sub">${sub}</p>`}
    ${phase !== 'closed' && html`<${OrderHome} />`}
    <div class="w8-pills">
      ${phase === 'before' && d.deal && html`<button class="btn accent" onClick=${() => go(sp('deal'))}>${open ? t('w8_todo', { n: open }) : t('before_move')}</button>`}
      ${phase === 'living' && html`<button class="btn accent" onClick=${() => go(sp('afisha'))}>${t('w8_tonight_btn')}</button>`}
      ${surfLine ? html`<button class="btn surface" onClick=${() => go(sp('surf'))}>${t('sf_title')} ${sfH(b.height)}</button>`
        : html`<button class="btn surface" onClick=${() => go(sp('path'))}>${t('pp_title')}</button>`}
    </div>
    <div class="w8-stats">${stats.map((x) => html`<button key=${x.k} onClick=${() => go(sp(x.go))}><small>${x.k}</small><b>${x.v}</b></button>`)}</div>
    <${TonightTicket} ev=${top} total=${ep?.total} />
    <div class="hm81-links">
      <button class="hm81-link" onClick=${() => { hap.sel(); go(sp('map')); }}><${Icon} n="map" cls="sm" />${t('w81_map')}</button>
      <button class="hm81-link" onClick=${() => { hap.sel(); go(sp('plan')); }}><${Icon} n="calendar" cls="sm" />${t('w81_plan')}</button>
      ${phase !== 'closed' && canVoteRole(d.me.role) && html`<button class="hm81-link" onClick=${() => { hap.sel(); go(sp('party-edit', 'new')); }}><${Icon} n="party-popper" cls="sm" />${t('w9_party_link')}</button>`}
    </div>
  </section>`;
}
/** V4-6: the evening Home (living, 18:00–04:00) — night palette, "Ночь", tonight's event in a black frame. */
function NightHero() {
  const d = D();
  const v = useEventPlan();
  const today = hmToday();
  const bk = (v?.bookings ?? []).find((x) => x.occ === today && x.status !== 'cancelled');
  const top = v?.top;
  const ev = bk ? { key: bk.event_id + '@' + bk.occ, title: bk.title, time: String(bk.starts_at ?? '').slice(11, 16), place: bk.place, photo: photoUrl(bk.photo), st: bk.status }
    : top ? { key: top.key, title: afTitle(top), time: afHM(top), place: afPlace(top), photo: photoUrl(top.photo), why: afWhy(top), mins: top.minutes } : null;
  const tmr = addDays(today, 1);
  const pay = (d.dates ?? []).filter((x) => !x.done && x.kind === 'payment' && x.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const lv = hmRow('living')?.facts;
  return html`<section class="w8-hero hm8 hm8-night">
    <${BigWord} text=${t('w8_night')} />
    ${ev ? html`<div class="hm8-stage">
        <button class="frame hm8-frame" aria-label=${ev.title} onClick=${() => go(sp('event', ev.key))}><span class="in">${ev.photo ? html`<img src=${ev.photo} alt="" decoding="async" />` : html`<span class="float-none" style=${sceneStyle(d.search.country)}></span>`}</span></button>
        ${ev.time && html`<${Sticker} text=${hm(ev.time)} cls="lime" style="right:4%;top:-8%;--r:-12deg" />`}
      </div>
      <${Typed} lines=${[ev.title]} />
      <p class="w8-sub">${[ev.place, ev.mins != null ? t('em_min', { n: ev.mins }) : null, ev.st ? t('af_st_' + ev.st) : ev.why].filter(Boolean).join(' · ')}</p>
      <div class="w8-pills"><button class="btn accent" onClick=${() => go(sp('event', ev.key))}>${ev.st ? t('af_st_' + ev.st) : t('w8_go_too')}</button>
        <button class="btn surface" onClick=${() => go(sp('afisha'))}>${t('w8_other')}</button></div>`
      : html`<div class="hm8-stage"><${FloatPhoto} src=${photosOf(homeListing())[0]} cls="hm8-ph" label=${hmName()} onClick=${() => homeListing() && go(sp('listing', homeListing().id))} /></div>
      <${Typed} lines=${[v && !v.failed ? t('w8_quiet_night') : hmName()]} />
      <div class="w8-pills"><button class="btn accent" onClick=${() => go(sp('afisha'))}>${t('w8_tonight_btn')}</button></div>`}
    <div class="w8-stats">
      <button onClick=${() => go(sp('plan'))}><small>${t('w8_k_tomorrow')}</small><b>${fmtDM(tmr)}</b></button>
      ${pay && html`<button onClick=${() => go(sp('deal'))}><small>${t('w8_k_pay')}</small><b>${t('hm_in_days', { n: hmDays(pay.date) })}</b></button>`}
      ${lv?.day && html`<button onClick=${() => go(sp('path'))}><small>${t('w8_k_home')}</small><b>${t('w8_day_n', { n: lv.day })}</b></button>`}
    </div>
  </section>`;
}
function HomeStageCard() {
  const st = homeStage();
  const f = homePhase() === 'before' ? hmDealFacts() : null;
  return html`<button class="card hm-stage" onClick=${() => go(sp('path'))}>
    <span class="hm-stage-h"><span class="grow">${t('hm_stage_k', { i: Math.min(st.idx, st.n), n: st.n, k: t('hm_st_' + st.key) })}</span>
      ${f && html`<span class=${'chip ' + (f.signed ? 'jungle' : 'mango')}>${f.signed && html`<${Icon} n="check" cls="xs" />`}${t('hm_b_lease')}</span>
        <span class=${'chip ' + (f.paid ? 'jungle' : 'mango')}>${f.paid && html`<${Icon} n="check" cls="xs" />`}${t('hm_b_paid')}</span>`}</span>
    <${StageBar} idx=${st.idx} n=${st.n} closed=${st.closed} />
  </button>`;
}
/** Checklist toggle of an extension term (seq ≥ 2): optimistic, like toggleCheck. */
async function toggleTermCheck(term, i) {
  const c = term?.checklist?.[i];
  if (!c) return;
  c.done = !c.done;
  hap.sel(); emit();
  try { await api('/app/api/term-check', { search_id: D().search.id, seq: term.seq, index: i, done: c.done }); }
  catch { c.done = !c.done; emit(); toast(t('err_generic')); }
}
function HomeChecklist({ list, title, deal, term, ro }) {
  if (!list?.length) return null;
  const k = list.filter((c) => c.done).length;
  const can = !ro && (deal || term);
  return html`<div class="card w2-list hm-check"><div class="w2-lh"><span>${t(title, { k, n: list.length })}</span></div>
    <div class="checklist">${list.map((c, i) => html`<button key=${i} class=${'check' + (c.done ? ' done' : '')} role="checkbox" aria-checked=${c.done ? 'true' : 'false'}
      disabled=${!can} onClick=${() => (term ? toggleTermCheck(term, i) : deal && toggleCheck(deal, i))}><span class="box">${c.done && html`<${Icon} n="check" />`}</span><span>${c.text ?? c.label}</span></button>`)}</div></div>`;
}
function HomeSurf({ v }) {
  const b = surfBest(v);
  if (!b || b.height == null) return null;
  const mw = modeWord();
  return html`<${WaterCard} cls="hm-surf" label=${t('sf_title')} onClick=${() => go(sp('surf'))}>
    <span class="hm-surf-k">${t('hm_surf_k')}</span>
    <b class="hm-surf-t">${b.window?.to ? t('hm_surf_t', { s: b.name, t: hm(b.window.to) }) : b.name}</b>
    <span class="hm-surf-s">${[sfH(b.height), surfWind(b.wind), b.minutes != null ? t('em_min', { n: b.minutes }) + (mw ? ' ' + mw : '') : null].filter(Boolean).join(' · ')}</span>
  <//>`;
}
/** The "Сегодня" rows (46b): only what the data has; each row opens its screen. */
function homeTodayRows() {
  const d = D();
  const today = hmToday();
  const rows = [];
  const r = d.renewal;
  if (r && r.status === 'open') rows.push({ k: 'next', ic: 'calendar-clock', cls: 'mango', title: t('nx_card'), sub: nxWeeks(r), go: 'next' });
  const pay = (d.dates ?? []).filter((x) => !x.done && x.kind === 'payment' && x.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (pay) {
    const n = hmDays(pay.date);
    rows.push({ k: 'pay', ic: 'wallet', cls: n <= 3 ? 'mango' : '', title: pay.amount != null ? t('hm_pay', { x: money(pay.amount, pay.currency), w: t('hm_in_days', { n }) }) : `${pay.title} ${t('hm_in_days', { n })}`,
      sub: [fmtDM(pay.date), pay.amount != null ? pay.title : null].filter(Boolean).join(' · '), go: 'deal' });
  }
  for (const i of (d.issues ?? []).filter((x) => x.status !== 'fixed').slice(0, 2)) {
    rows.push({ k: 'is' + i.id, ic: 'wrench', cls: 'mango', title: i.title, sub: i.status === 'scheduled' && i.scheduled_at ? t('is_scheduled', { when: whenLabel(i.scheduled_at) }) : [t('is_open'), agoRel(i.updated_at)].filter(Boolean).join(' · '), go: 'home' });
  }
  const pw = d.power;
  if (pw?.days_left != null) {
    const n = Math.max(0, Math.floor(pw.days_left));
    rows.push({ k: 'pw', ic: 'zap', cls: n <= 5 ? 'mango' : '', title: t('hm_power', { n }), sub: pw.runout ? t('hm_power_sub', { d: fmtDM(new Date(Date.parse(pw.runout) - 864e5).toISOString()) }) : null, go: 'power' });
  }
  for (const b of (d.bikes ?? []).filter((x) => x.status !== 'returned' && x.paid_until && hmDays(x.paid_until) <= 5).slice(0, 2)) {
    const n = hmDays(b.paid_until);
    rows.push({ k: 'bk' + b.id, ic: 'bike', cls: 'mango', title: n < 0 ? t('hm_bike_late') : t('hm_bike', { w: t('hm_in_days', { n }) }), sub: [b.model, b.rental_name].filter(Boolean).join(' · '), go: 'bikes' });
  }
  for (const g of (d.guests ?? []).filter((x) => x.status === 'active')) {
    const n = hmDays(g.from);
    if (n > 7 || hmDays(g.to) < 0) continue;
    rows.push({ k: 'g' + g.user_id, ic: 'userplus', cls: '', title: n > 0 ? t('hm_guest_in', { g: firstName(g.name), w: t('hm_in_days', { n }) }) : t('hm_guest_here', { g: firstName(g.name), d: fmtDM(g.to) }), sub: rangeDM(g.from, g.to), go: 'guests' });
  }
  return rows;
}
function HomeTodayList() {
  const rows = homeTodayRows();
  if (!rows.length) return null;
  return html`<div class="card w2-list hm-list"><div class="w2-lh"><span>${t('hm_today')}</span></div>
    ${rows.map((r) => html`<button key=${r.k} class="w2-row w3-irow" onClick=${() => go(sp(r.go))}><span class=${'sq big ' + r.cls}><${Icon} n=${r.ic} /></span>
      <div class="grow"><b>${r.title}</b>${r.sub && html`<span>${r.sub}</span>`}</div><${Icon} n="chev" cls="sm muted" /></button>`)}</div>`;
}
function HomeActions() {
  const d = D();
  const phase = homePhase();
  const act = (k, ic, screen, sub = null) => html`<button key=${k} class="card hm-act" onClick=${() => go(sp(screen))}><span class="sq"><${Icon} n=${ic} /></span><b>${t('hm_q_' + k)}</b>${sub != null && html`<span>${sub}</span>`}</button>`;
  const cur = d.money?.currency ?? briefCur(d.search);
  const month = d.money?.totals?.this_month;
  const bikes = (d.bikes ?? []).filter((b) => b.status !== 'returned').length;
  const items = phase === 'before'
    ? [act('lease', 'file-text', 'deal'), act('money', 'wallet', 'money'), act('contacts', 'users', 'directory'), act('bikes', 'bike', 'bikes')]
    : [act('money', 'wallet', 'money', month ? money(month, cur) : null), act('contacts', 'users', 'directory'), act('bikes', 'bike', 'bikes', bikes ? String(bikes) : null),
      canVoteRole(d.me.role) && phase !== 'closed' ? act('guests', 'userplus', 'guests') : act('docs', 'file-text', 'docs')];
  return html`<div class="hm-acts">${items}</div>`;
}
function HomeToday() {
  const d = D();
  const phase = homePhase();
  const live = phase === 'living';
  const sv = useSurf(d.search.id, phase !== 'closed' && (briefMentionsSurf() || !!d.me.surf));
  const ro = phase === 'closed' || !canVoteRole(d.me.role);
  const ct = hmCurTerm();
  const termList = live && ct && ct.seq > 1 && Array.isArray(ct.checklist) && ct.checklist.some((c) => !c.done) ? ct.checklist : null;
  const night = nightMode();
  const ev = useEvening(); // wave 9: tonight's event / party takes over the hero in the evening
  return html`<main class="screen hm-screen">
    ${phase !== 'closed' && eveningOn(ev) ? html`<${EveningHero} v=${ev} /><${OrderHome} />` : night ? html`<${NightHero} /><${OrderHome} />` : html`<${HomeHero} sv=${sv} />`}
    <${HomeStageCard} />
    <${GuestDrafts} />
    ${phase === 'before' && html`<${HomeChecklist} list=${d.deal?.data?.checklist} title="hm_checklist" deal=${d.deal} ro=${ro} />`}
    ${termList && html`<${HomeChecklist} list=${termList} title="hm_term_checklist" term=${ct} ro=${ro} />`}
    ${live && night && html`<${HomeSurf} v=${sv} />`}
    ${live && html`<${HomeTodayList} />`}
    <${HomeActions} />
    <${Nav} tab="today" />
  </main>`;
}

// ---------------------------------------------------------------- wave 6 · D: "Ещё" (46c) and the listings archive
function MoreScreen() {
  const d = D();
  const st = homeStage();
  const row = (k, ic, title, sub, screen) => html`<button key=${k} class="w2-row w3-irow" onClick=${() => go(sp(screen))}><span class="sq big"><${Icon} n=${ic} /></span>
    <div class="grow"><b>${title}</b>${sub && html`<span>${sub}</span>`}</div><${Icon} n="chev" cls="sm muted" /></button>`;
  const card = (title, rows) => html`<div class="card w2-list hm-more"><div class="w2-lh"><span>${title}</span></div>${rows.filter(Boolean)}</div>`;
  const nDocs = (d.documents ?? []).length;
  const cur = d.money?.currency ?? briefCur(d.search);
  const month = d.money?.totals?.this_month;
  const today = hmToday();
  const all = dirEntries();
  const grps = [...new Set(all.map((e) => e.grp))].map((k) => dgName(k).toLowerCase());
  const bikes = (d.bikes ?? []).filter((b) => b.status !== 'returned');
  const nextPay = bikes.map((b) => b.paid_until).filter(Boolean).sort()[0];
  const nG = (d.guests ?? []).filter((g) => g.status === 'active').length;
  const iv = d.items ?? { items: [] };
  const mi = hmMoveIn();
  const hid = homeListing()?.id;
  const nArch = (d.listings ?? []).filter((l) => l.id !== hid).length;
  const openIssues = (d.issues ?? []).filter((i) => i.status !== 'fixed').length;
  const away = agentAwayHours();
  return html`<main class="screen w2 mo8">
    <div class="head"><div><h1 class="w8-title">${t('hm_more')}</h1></div></div>
    <div class="card w2-list hm-more mo81-top">
      ${row('map', 'map', t('w81_map'), t('w81_map_sub'), 'map')}
      ${row('plan', 'calendar', t('w81_plan'), t('w81_plan_sub'), 'plan')}
      ${row('orders', 'basket', t('or_title'), OR.v?.active.length ? t('or_more_active') : t('or_more_sub'), 'orders')}
    </div>
    ${card(t('hm_more_home'), [
      row('docs', 'file-text', t('hm_m_docs'), [nDocs ? t('hm_files', { n: nDocs }) : null, (d.dates ?? []).length ? t('hm_dates_word') : null].filter(Boolean).join(' · ') || null, 'docs'),
      row('contacts', 'users', t('hm_m_contacts'), grps.length ? grps.join(', ') : t('hm_m_contacts0'), 'directory'),
      row('bikes', 'bike', t('hm_m_bikes'), bikes.length ? (nextPay ? t('hm_m_bikes_sub', { n: bikes.length, d: fmtDM(nextPay) }) : String(bikes.length)) : t('hm_m_bikes0'), 'bikes'),
      d.deal && row('house', 'wrench', t('hm_m_house'), openIssues ? t('is_open').toLowerCase() + ` · ${openIssues}` : t('hm_m_house_sub'), 'home'),
    ])}
    ${card(t('hm_more_life'), [
      canVoteRole(d.me.role) && row('guests', 'userplus', t('hm_m_guests'), nG ? t('gi_row_sub', { n: nG }) : t('hm_m_guests_sub'), 'guests'),
      row('items', 'box', t('hm_m_items'), iv.items?.length ? `${iv.items.length} · ${money(iv.total, iv.currency ?? cur)}` : t('hm_m_items0'), 'items'),
      row('act', 'rotate-3d', t('hm_m_act'), mi ? t('hm_m_act_sub', { d: fmtDM(mi) }) : t('hm_m_act0'), 'act'),
      row('useful', 'book-open', t('hm_m_useful'), t('hm_m_useful_sub'), 'useful'),
      d.renewal && row('next', 'calendar-clock', t('hm_m_next'), d.renewal.status === 'open' ? nxWeeks(d.renewal) : t('hm_m_next_sub'), 'next'),
    ])}
    ${card(t('hm_more_search'), [
      html`<button key="agent" class="w2-row w3-irow mo-agent" onClick=${() => go(sp('agent'))}><span class=${'sq big ink' + (agentOn() ? ' on' : '')}><${Icon} n="plug" /></span>
        <div class="grow"><b>${LANG === 'ru' ? 'Подключить агента' : 'Connect the agent'}</b><span>${agentSub()}</span></div><${Icon} n="chev" cls="sm muted" /></button>`,
      canAccess() && row('access', 'shield-check', LANG === 'ru' ? 'Доступ к чатам' : 'Access to chats', LANG === 'ru' ? 'Что видит Hunt, отозвать всё' : 'What Hunt sees, take it back', 'access'),
      row('archive', 'layers', t('hm_m_archive'), t('hm_m_archive_sub', { n: nArch }), 'archive'),
      row('path', 'route', t('hm_m_path'), t('hm_m_path_sub', { i: Math.min(st.idx, st.n), n: st.n }), 'path'),
    ])}
    ${away > 0 && html`<p class="w81-away"><${Icon} n="eyeoff" cls="xs" />${t('w81_offline', { n: away })}</p>`}
    <${Nav} tab="more" />
  </main>`;
}
/** Read-only archive of the search's listings once a home is chosen (voting is off in home mode). */
function Archive() {
  const d = D();
  const hid = homeListing()?.id;
  const liked = likedList(d).filter((l) => l.id !== hid);
  const seen = new Set(liked.map((l) => l.id));
  const list = [...liked, ...d.listings.filter((l) => l.id !== hid && !seen.has(l.id))];
  return html`<main class="screen w2">
    <${W3Head} kicker=${hmName()} title=${t('hm_m_archive')} />
    <p class="w2-foot hm-arch-note">${t('hm_arch_note')}</p>
    ${list.length ? html`<div class="stack">${list.map((l) => html`<${ListingCard} key=${l.id} l=${l} />`)}</div>` : html`<p class="empty-note">—</p>`}
    <${Nav} tab="more" />
  </main>`;
}

// ---------------------------------------------------------------- wave 6 · D: home-centred map
let hmLayers = null;
function HomeMap({ arg }) {
  const d = D();
  const l = homeListing();
  if (!l || l.lat == null || l.lng == null) return html`<main class="screen"><div class="center-msg">${t('hm_map_none')}</div><${Nav} tab="map" /></main>`;
  return html`<${HomeMapInner} l=${l} evening=${arg === 'evening'} />`;
}
/** Wave 9 · map "Вечер": tonight's events (from 16:00, not over) around the home, the district filter of Афиша, and today's party. */
function useEveningPins(on) {
  const d = D();
  const [v, setV] = useState(null);
  useEffect(() => {
    if (!on) return undefined;
    let live = true;
    const q = new URLSearchParams({ s: d.search.id, tab: 'all', day: hmToday() });
    if (AF.d.length) q.set('d', AF.d.join(','));
    Promise.all([api('/app/api/afisha?' + q).catch(() => null), api('/app/api/parties?s=' + encodeURIComponent(d.search.id)).catch(() => null)]).then(([f, pp]) => {
      if (!live) return;
      const all = f && !f.failed ? [...f.top, ...f.items] : [];
      const evs = all.filter((o) => o.pt && Number(o.starts_at.slice(11, 13)) >= 16 && Date.parse(o.ends_at ?? o.starts_at) + (o.ends_at ? 0 : 2 * 3600e3) > Date.now());
      const party = (pp?.parties ?? []).find((x) => ptDay(x.starts_at) === hmToday() && x.status === 'active') ?? null;
      setV({ evs, party });
    });
    return () => { live = false; };
  }, [on, d.search.id, AF.rev]);
  return on ? v : null;
}
function HomeMapInner({ l, evening = false }) {
  const d = D();
  const s = d.search;
  const v = useLocation(l.id);
  const basePl = useBasePlaces(s.country);
  const [layers, setLayers0] = useState(() => (evening ? { places: false, contacts: false, evening: true } : { ...(hmLayers ?? { places: true, contacts: true }), evening: !!hmLayers?.evening })); // map/evening: tonight only, places off
  const eve = useEveningPins(layers.evening);
  const setLayers = (x) => { hmLayers = x; setLayers0(x); };
  const [ready, setReady] = useState(false);
  const [fail, setFail] = useState(false);
  const box = useRef(null);
  const mapR = useRef(null);
  const marks = useRef([]);
  const fitted = useRef(false);
  const theme = useThemeKey();
  const dirPins = (d.directory ?? []).filter((e) => e.lat != null && e.lng != null);
  useEffect(() => {
    let dead = false;
    setReady(false);
    fitted.current = false;
    loadML().then(async (ml) => {
      const style = await mapStyle();
      if (dead || !box.current) return;
      const map = new ml.Map({ container: box.current, style, center: [l.lng, l.lat], zoom: 13, attributionControl: false, dragRotate: false, pitchWithRotate: false, fadeDuration: 0 });
      map.touchZoomRotate.disableRotation();
      mapR.current = map;
      map.on('load', () => !dead && setReady(true));
    }).catch(() => !dead && setFail(true));
    return () => { dead = true; marks.current.forEach((m) => m.remove()); marks.current = []; mapR.current?.remove(); mapR.current = null; };
  }, [theme]);
  useEffect(() => {
    const map = mapR.current;
    const ml = window.maplibregl;
    if (!ready || !map || !ml) return;
    marks.current.forEach((m) => m.remove());
    marks.current = [];
    const add = (el, ll, z) => { el.style.zIndex = String(z); marks.current.push(new ml.Marker({ element: el, anchor: 'center' }).setLngLat(ll).addTo(map)); };
    const b = new ml.LngLatBounds();
    b.extend([l.lng, l.lat]);
    const accent = cssVar('--map-accent');
    const geo = v && !locStale(v) ? v.geo : null;
    const grs = [...new Set((geo?.features ?? []).map((f) => Number(f.properties?.ring)).filter((x) => !Number.isNaN(x)))].sort((a, c) => a - c);
    const r0 = grs[0], r1 = grs[1] ?? grs[0], rl = grs[grs.length - 1];
    if (geo && grs.length && !map.getSource('iso')) {
      map.addSource('iso', { type: 'geojson', data: geo });
      const fillOp = grs.length >= 3 ? ['match', ['get', 'ring'], r0, 0.22, r1, 0.13, 0.06] : grs.length === 2 ? ['match', ['get', 'ring'], r0, 0.22, 0.1] : 0.18;
      map.addLayer({ id: 'iso-fill', type: 'fill', source: 'iso', paint: { 'fill-color': accent, 'fill-opacity': fillOp } });
      map.addLayer({ id: 'iso-line', type: 'line', source: 'iso', layout: { 'line-join': 'round' }, paint: { 'line-color': accent, 'line-width': 1.5, 'line-dasharray': [2, 1.6], 'line-opacity': 0.8 } });
    }
    for (const f of geo?.features ?? []) {
      if (Number(f.properties.ring) === r1) { const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates; for (const p of polys) for (const pt of p[0]) b.extend(pt); }
      if (grs.length > 1 && Number(f.properties.ring) === rl) continue;
      const tp = topPoint(f.geometry);
      if (!tp) continue;
      const el = document.createElement('div');
      el.className = 'ring-tag';
      el.textContent = t('lc_min', { n: f.properties.ring });
      add(el, tp, 8);
    }
    if (layers.places) {
      // Places in the rings when the agent computed them, else the pack/own places within ~8 km of the home.
      const pins = (v?.places?.length ? v.places.filter((p) => p.ring !== rl || p.tier === 1 || p.own) : allPlaces(basePl).filter((p) => p.type !== 'daytrip' && km([l.lat, l.lng], [p.lat, p.lng]) <= 8)).slice(0, 40);
      for (const p of pins) {
        const el = document.createElement('button');
        el.className = `lpin sm g-${groupOfType(p.type)}`;
        el.textContent = p.emoji ?? placeEmoji(p, basePl?.types);
        el.setAttribute('aria-label', p.name);
        el.addEventListener('click', (e) => { e.stopPropagation(); openSheet('spot', p.id); });
        add(el, [p.lng, p.lat], 3);
        if (!geo) b.extend([p.lng, p.lat]);
      }
    }
    if (layers.contacts) for (const e of dirPins) {
      const el = document.createElement('button');
      el.className = 'hm-dpin';
      el.innerHTML = `<svg class="icon" viewBox="0 0 24 24">${ICONS[e.icon] ?? ICONS[DG_ICON[e.grp]] ?? ICONS.store}</svg>`;
      el.setAttribute('aria-label', e.name);
      el.addEventListener('click', (ev) => { ev.stopPropagation(); openSheet('dir_entry', e.id); });
      add(el, [e.lng, e.lat], 4);
      b.extend([e.lng, e.lat]);
    }
    if (layers.evening && eve) for (const o of eve.evs) {
      // a small black frame with the start time (wave 9); tap → the ticket
      const el = document.createElement('button');
      el.className = 'ev9-pin';
      el.textContent = afHM(o);
      el.setAttribute('aria-label', `${afTitle(o)}, ${afHM(o)}`);
      el.addEventListener('click', (e) => { e.stopPropagation(); hap.sel(); openSheet('ev_ticket', o); });
      add(el, [o.pt[1], o.pt[0]], 7);
      b.extend([o.pt[1], o.pt[0]]);
    }
    const home = document.createElement(layers.evening && eve?.party ? 'button' : 'div');
    home.className = 'lhome' + (layers.evening && eve?.party ? ' ev9-home' : '');
    home.setAttribute('aria-label', layers.evening && eve?.party ? `${eve.party.title}, ${ptHM(eve.party.starts_at)}` : hmName());
    if (layers.evening && eve?.party) {
      home.innerHTML = `<span class="ev9-hs">${t('pt_at_home')} ${ptHM(eve.party.starts_at)}</span>`;
      home.addEventListener('click', (e) => { e.stopPropagation(); go(sp('party', eve.party.id)); });
    }
    add(home, [l.lng, l.lat], 6);
    if (!fitted.current) {
      fitted.current = !!v;
      const H = box.current.clientHeight;
      const top = Math.min(H * 0.3, (document.querySelector('.hm-map-top')?.getBoundingClientRect().bottom ?? 120) + 24);
      map.fitBounds(b, { padding: { top, bottom: Math.min(H * 0.3, 130), left: 32, right: 32 }, maxZoom: 14, duration: 0 });
    }
  }, [ready, v, layers, basePl, d, eve]);
  const loc = v && !locStale(v) ? v.location : null;
  const sub = [districtShort(l), l.bedrooms != null ? t('br', { n: l.bedrooms }) : null].filter(Boolean).join(' · ');
  const hasPlaces = !!S.regions?.[s.country]?.places || (d.places ?? []).length > 0 || (v?.places ?? []).length > 0;
  const tg2 = (k, ic) => html`<button class=${'ds-hint pl-tg' + (layers[k] ? ' on' : '')} aria-pressed=${layers[k] ? 'true' : 'false'} onClick=${() => { hap.sel(); setLayers({ ...layers, [k]: !layers[k] }); }}><${Icon} n=${ic} cls="sm" />${t('hm_layer_' + k)}</button>`;
  return html`<main class="map-screen hm-map">
    <div class="map" ref=${box} role="application" aria-label=${t('hm_nav_map')}></div>
    <div class="map-top hm-map-top">
      <button class="card lc-card" onClick=${() => go(sp(loc ? 'location' : 'listing', l.id))}>
        <${Img} src=${photosOf(l)[0]} cls="lc-thumb" /><div class="grow"><b>${hmName()}</b><span>${sub}</span></div>
        ${loc && html`<span class=${'lc-score ' + scoreCls(loc.score)}><b>${loc.score}</b><small>${t('lc_word')}</small></span>`}</button>
      ${html`<div class="map-pl">${tg2('evening', 'moon')}${hasPlaces && tg2('places', 'map-pin')}${dirPins.length > 0 && tg2('contacts', 'users')}
        ${hasPlaces && html`<button class="ds-hint pl-tg" onClick=${() => go(sp('spots'))}><${Icon} n="layers" cls="sm" />${t('sp_list')}</button>`}</div>`}
      ${layers.evening && eve && !eve.evs.length && !eve.party && html`<p class="ds-hint ev9-none">${t('mp_evening_none')}</p>`}
    </div>
    ${fail && html`<div class="center-msg" style="position:absolute;inset:40% 0 auto">${t('map_fail')}</div>`}
    <span class="attrib">© OpenFreeMap © OpenStreetMap</span>
    <${Nav} tab="map" />
  </main>`;
}

// ---------------------------------------------------------------- wave 6 · D: home plan (one calendar list)
function homePlanRows() {
  const d = D();
  const { rows, alts, season } = calendarRows();
  const today = hmToday();
  const me = d.user.id;
  const terms = hmTerms();
  const last = terms.length > 1 ? terms[terms.length - 1] : null;
  let out = rows;
  if (last) {
    // An extension: the first term's end is no longer the move-out; show the new terms instead.
    out = out.filter((r) => r.k !== 'moveout' || d.moveout?.date || r.date >= (last.to ?? ''));
    for (const x of terms.slice(1)) {
      if (x.from && x.from >= today) out.push({ go: 'path', date: x.from, cls: 'acc', title: t('hm_cl_term'), sub: x.landlord ?? null });
      if (x === last && x.to && x.to >= today && !d.moveout?.date && !out.some((r) => r.k === 'moveout')) out.push({ go: 'next', date: x.to, cls: 'acc', title: t('hm_cl_term_end'), sub: x.landlord ?? null });
    }
  }
  for (const b of d.bikes ?? []) if (b.status !== 'returned' && b.return_date && b.return_date >= today) out.push({ go: 'bikes', date: b.return_date, cls: '', title: t('hm_cl_bike_return', { m: b.model }), sub: b.rental_name });
  if (d.me.role === 'owner') {
    const stayTo = hmStay().to;
    const lead = Number(regionPack()?.visa?.extend_lead_days) || 7;
    for (const v of d.visas ?? []) {
      if (v.user_id === me || !memberById(v.user_id) || !v.visa_until || (stayTo && v.visa_until >= stayTo)) continue;
      const dd = addDays(v.visa_until, -lead);
      if (dd >= today) out.push({ go: 'important', date: dd, cls: 'mango', title: t('hm_cl_visa', { g: firstName(memberById(v.user_id).name) }), sub: t('hm_cl_visa_sub', { d: fmtDM(v.visa_until) }) });
    }
  }
  for (const g of (d.guests ?? []).filter((x) => x.status === 'active')) {
    if (g.from && g.from >= today) out.push({ go: 'guests', date: g.from, cls: '', title: t('hm_cl_guest_in', { g: firstName(g.name) }), sub: rangeDM(g.from, g.to) });
    if (g.to && g.to >= today) out.push({ go: 'guests', date: g.to, cls: '', title: t('hm_cl_guest_out', { g: firstName(g.name) }), sub: null });
  }
  out = out.filter((r) => r.date >= today || (r.to && r.to >= today)).sort((a, b) => a.date.localeCompare(b.date) || Number(!!b.by) - Number(!!a.by));
  return { rows: out, alts, season };
}
function HomePlan() {
  const d = D();
  const { rows, alts, season } = homePlanRows();
  const rn = regionPack()?.name;
  const region = rn ? (LANG === 'ru' ? rn.ru : rn.en) : '';
  const l = homeListing();
  const dn = l ? districtShort(l) : '';
  const dateCell = (r) => html`<span class=${'cl-d ' + r.cls}>${r.by ? t('cl_by', { d: fmtDMshort(r.date) }) : fmtDMshort(r.date) + (r.to && r.to !== r.date ? '–' + fmtDMshort(r.to) : '')}</span>`;
  return html`<main class="screen w2">
    <div class="head w3-head"><div><p class="kicker">${[region, dn].filter(Boolean).join(' · ') || hmName()}</p><h1 class="h1 w3-h1">${t('cl_title')}</h1></div></div>
    <${AfPlanCard} />
    ${rows.length ? html`<div class="card w2-list">${rows.map((r, i) => r.go
        ? html`<button key=${i} class="w2-row cl-row hm-cl-go" onClick=${() => go(sp(r.go))}>${dateCell(r)}<div class="grow"><b>${r.title}</b>${r.sub && html`<span>${r.sub}</span>`}</div><${Icon} n="chev" cls="sm muted" /></button>`
        : html`<div key=${i} class="w2-row cl-row">${dateCell(r)}<div class="grow"><b>${r.title}</b>${r.sub && html`<span>${r.sub}</span>`}</div></div>`)}</div>`
      : html`<div class="card" style="padding:16px"><p class="muted" style="margin:0">${t('cl_none')}</p></div>`}
    ${season && html`<p class="w2-foot">${t('cl_now_season', { x: season })}</p>`}
    ${alts.map((a) => html`<p class="w2-foot">${a}. ${LANG === 'ru' ? 'Агент уточнит ближе к дате.' : 'The agent re-checks closer to the date.'}</p>`)}
    <${Nav} tab="plan" />
  </main>`;
}

// ---------------------------------------------------------------- wave 7 · Афиша (E3 tickets, E2 detail, E5 Тусовки)
// /app/api/afisha: the 7-day strip, the day's ranked list (event of the day = the first 3, a swipeable stack), Тусовки with the
// weekday card. Each event photo may carry one category effect (fx.js, data from the region pack's events.yaml).
const AF = { cache: {}, seed: 0, f: { all: [], social: [] }, d: [], day: null, hint: pref.get('af_hint') !== '0', rev: 0 };
const AF_FILTERS = { all: ['ru', 'en', 'free', 'evening', 'morning', 'night', 'r20', 'book', 'beginner'], social: ['today', 'bars', 'clubs', 'sport'] };
const AF_FICON = { evening: 'moon', morning: 'sunrise', night: 'moon', bars: 'martini', sport: 'trophy', free: null, r20: 'bike', book: 'message-circle' };
const AF_CAT_ICON = { culture: 'flame', nature: 'mountain', sport: 'dumbbell', dance: 'music', music: 'music', food: 'utensils', workshop: 'palette', party: 'party-popper', wellness: 'sunrise',
  kids: 'party-popper', other: 'ticket', bar: 'martini', club: 'music', beach_club: 'party-popper', social_sport: 'trophy', meetup: 'users', quiz: 'mic' };
const AF_TOPIC_ICON = { sea: 'waves', snorkel: 'waves', diving: 'waves', boat: 'waves', surf: 'waves', surf_meetup: 'waves', cinema: 'film', stargazing: 'sparkles', yoga: 'sunrise', market: 'store', padel: 'trophy', kecak: 'flame', fire_show: 'flame' };
const afIcon = (o) => AF_TOPIC_ICON[o.topic] ?? AF_CAT_ICON[o.category] ?? 'ticket';
const afCat = (o) => (o.topic && STR[LANG]['af_t_' + o.topic] ? t('af_t_' + o.topic) : t('af_c_' + o.category));
const afTitle = (o) => (LANG === 'en' && o.title_en ? o.title_en : o.title);
const afAbout = (o) => o.about?.[LANG] ?? o.about?.ru ?? o.about?.en ?? '';
const afPlace = (o) => String(o.place?.name ?? '').split(/[·,(]/)[0].trim();
const afWhy = (o) => (o.why ? (LANG === 'en' ? o.why.en : o.why.ru) : null);
const afHM = (o) => o.starts_at.slice(11, 16).replace(/^0(\d)/, '$1');
const afDay = (occ) => `${dfmt(occ, { weekday: 'short' }).replace('.', '')} ${Number(occ.slice(8, 10))}`;
const afDayLong = (occ) => cap(dfmt(occ, { weekday: 'short', day: 'numeric', month: 'long' }).replace('.', ''));
function afPrice(o) {
  if (o.price_kind === 'free') return o.entry === 'free' || o.social ? t('af_entry_free') : t('af_free');
  if (o.price != null) return money(o.price, o.currency);
  if (o.price_kind === 'on_site') return t('af_on_site');
  return null;
}
const afLang = (o) => (o.lang === 'none' ? t('af_l_none') : o.lang === 'mixed' ? 'RU/EN' : o.lang ? o.lang.toUpperCase() : null);
/** The one criteria badge on a ticket: 18+ for nightlife, else the language. */
const afBadge = (o, small = false) => (o.age_min && (o.social || small) ? `${o.age_min}+` : afLang(o) ?? (o.social ? t('af_c_' + o.category) : null));
function afLive(o) {
  if (o.live) return t('af_live');
  if (o.in_hours > 0 && o.in_hours < 6) return o.in_hours < 1 ? t('af_in_min', { n: Math.max(5, Math.round(o.in_hours * 60 / 5) * 5) }) : t('af_in_h', { n: Math.round(o.in_hours) });
  if (o.recurring && o.social) return t('af_from', { t: afHM(o) });
  return null;
}
function afKey() { const d = D(); return `${d.search.id}|${AF.tab}|${AF.day ?? ''}|${(AF.f[AF.tab] ?? []).join(',')}|${AF.d.join(',')}|${AF.seed}`; }
/** Wave 8.1: ride time on a ticket; far ones (≥ 1 h) in hours: "1,5 ч на байке". */
const afTravel = (o) => (o.minutes == null ? null : o.minutes >= 60 ? t('w81_far_bike', { x: minLabel(o.minutes) }) : t('af_min_bike', { n: o.minutes }));
function useAfisha(tab) {
  const d = D();
  AF.tab = tab;
  const key = afKey();
  const [v, setV] = useState(AF.cache[key] ?? null);
  const [, bump] = useState(0);
  useEffect(() => {
    let live = true;
    const q = new URLSearchParams({ s: d.search.id, tab, seed: String(AF.seed) });
    if (AF.day && tab === 'all') q.set('day', AF.day);
    if ((AF.f[tab] ?? []).length) q.set('f', AF.f[tab].join(','));
    if (AF.d.length) q.set('d', AF.d.join(','));
    if (!AF.cache[key]) setV(null);
    api('/app/api/afisha?' + q).then((j) => { AF.cache[key] = j; if (live) setV(j); }).catch((e) => live && setV({ failed: true, code: e.code }));
    return () => { live = false; };
  }, [key, AF.rev]);
  return [v, () => bump((x) => x + 1)];
}
const afReset = () => { AF.cache = {}; AF.rev++; };
async function afFeedback(o, kind, on = true, extra = {}) {
  const d = D();
  hap.sel();
  try { await api('/app/api/event-feedback', { search_id: d.search.id, event_id: o.id, occ: o.occ, kind, on, ...extra }); afReset(); emit(); return true; }
  catch { toast(t('err_generic')); return false; }
}

/** Photo with the category effect inside a thick black frame (wave 8, V4-3/V4-8); no photo that passed the quality bar → the
 * styled category card. The title and the stub live under the frame now. */
function TkPhoto({ o, big = false, pill = null, children }) {
  const fxRef = useRef(null), imgRef = useRef(null);
  const ph = photoUrl(o.photo);
  useEffect(() => (ph && o.effect ? fxMount(fxRef.current, { shader: o.effect.shader, mix: o.effect.mix ?? 1, img: imgRef.current }) : undefined), [ph, o.effect?.shader]);
  const live = afLive(o);
  const tl = pill ?? (o.recurring && o.social ? { ic: 'repeat', text: LANG === 'en' ? o.recurring.en : o.recurring.ru } : { ic: afIcon(o), text: afCat(o) });
  return html`<div class=${'frame tk8-frame' + (big ? '' : ' sm')}><div class=${'in tk-ph' + (big ? ' big' : '') + (ph ? '' : ' none')} style=${ph ? '' : sceneStyle(D().search.country)}>
    ${ph ? html`<img ref=${imgRef} src=${ph} alt="" draggable="false" decoding="async" loading=${big ? 'eager' : 'lazy'} />` : html`<span class="tk-motif"><${Icon} n=${afIcon(o)} /></span>`}
    ${ph && o.effect && html`<div class="fx" ref=${fxRef} aria-hidden="true"></div>`}
    ${big && html`<span class="tk-pill"><${Icon} n=${tl.ic} cls="xs" />${tl.text}</span>`}
    ${live && html`<span class="tk-live"><i></i>${live}</span>`}
    ${children}
  </div></div>`;
}
const Perf = () => html`<div class="tk-perf" aria-hidden="true"><i></i></div>`;
function TicketBig({ o, pill, onBook, onNope = null, front = true }) {
  const why = afWhy(o);
  const price = afPrice(o);
  const badge = afBadge(o);
  const st = o.booking_status;
  const meta = [o.social ? afCat(o) : afPlace(o), o.social ? afPlace(o) : null, `${afDay(o.occ)} ${afHM(o)}`, price, badge, afTravel(o)].filter(Boolean).join(' · ');
  return html`<article class="tk big tk8" onClick=${() => go(sp('event', o.key))}>
    <${TkPhoto} o=${o} big pill=${pill} />
    ${st && st !== 'cancelled' && st !== 'declined' ? html`<${Sticker} text=${t('w8_going')} style="right:-6px;top:-18px;--r:-12deg" />`
      : o.liked_before && html`<${Sticker} text=${t('fb_liked')} cls="sky" style="right:-6px;top:-18px;--r:-12deg" />`}
    <div class="tk8-body">
      <h2 class="tk8-t">${afTitle(o)}</h2>
      <p class="tk8-m">${meta}</p>
      ${front && html`<div class="w8-pills tk8-pills">
        <button class=${'btn ' + (st ? 'surface' : 'accent') + ' tk-go'} onClick=${(e) => { e.stopPropagation(); st ? go(sp('event', o.key)) : onBook(o); }}>${st ? t('af_st_' + st) : t('af_book')}</button>
        ${onNope && html`<button class="btn surface" onClick=${(e) => { e.stopPropagation(); onNope(o); }}>${t('af_nope')}</button>`}
      </div>`}
      ${why && front && html`<p class="tk-why"><${Icon} n="sparkles" cls="xs" />${why}</p>`}
    </div>
  </article>`;
}
function TicketSmall({ o }) {
  return html`<button class="tk small tk8" onClick=${() => go(sp('event', o.key))}>
    <${TkPhoto} o=${o} />
    <span class="tk8-cap"><b>${afHM(o)}</b> ${afTitle(o)}</span>
    <span class="tk8-sub">${[afDay(o.occ), afTravel(o), afBadge(o, true)].filter(Boolean).join(' · ')}</span>
    ${o.liked_before && html`<span class="tk9-liked"><${Icon} n="sparkles" cls="xs" />${t('fb_liked')}</span>`}
  </button>`;
}
function afBook(o) {
  if (D().me.role === 'viewer') return toast(t('af_viewer'));
  openSheet('ev_book', o);
}
/** Event of the day: a stack of up to 3 tickets; swipe right = записаться, left = не моё. */
function AfStack({ list, social }) {
  const [i, setI] = useState(0);
  const [dx, setDx] = useState(0);
  const [anim, setAnim] = useState(false);
  const st = useRef(null);
  const topRef = useRef(null);
  useEffect(() => { setI(0); setDx(0); }, [list.map((x) => x.key).join()]);
  // Once a drag is horizontal, the page must not scroll with it (diagonal pulls used to scroll the list). touch-action
  // alone isn't enough in iOS WebViews, so a non-passive touchmove cancels the scroll while the card is held.
  useEffect(() => {
    const el = topRef.current;
    if (!el) return;
    let t0 = null, locked = false;
    const ts = (e) => { const p = e.touches[0]; t0 = { x: p.clientX, y: p.clientY }; locked = false; };
    // WebKit only lets the FIRST touchmove cancel scrolling, so the direction is decided on the first move: sideways
    // first = the card owns the whole gesture; vertical first = a normal page scroll.
    const tm = (e) => {
      if (!t0) return;
      const p = e.touches[0], mx = p.clientX - t0.x, my = p.clientY - t0.y;
      if (!locked) {
        if (!mx && !my) return;
        if (Math.abs(mx) < Math.abs(my)) { t0 = null; return; }
        locked = true; tg(() => TG.disableVerticalSwipes?.());
      }
      if (e.cancelable) e.preventDefault();
    };
    const te = () => { if (locked) tg(() => TG.enableVerticalSwipes?.()); t0 = null; locked = false; };
    el.addEventListener('touchstart', ts, { passive: true });
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('touchend', te);
    el.addEventListener('touchcancel', te);
    return () => { el.removeEventListener('touchstart', ts); el.removeEventListener('touchmove', tm); el.removeEventListener('touchend', te); el.removeEventListener('touchcancel', te); };
  }, [i, list.length > 0]);
  const cards = list.slice(i, i + 3);
  if (!cards.length) return null;
  const top = cards[0];
  const done = () => { if (AF.hint) { AF.hint = false; pref.set('af_hint', '0'); } };
  const fly = (dir) => {
    setAnim(true);
    setDx(dir * 520);
    setTimeout(() => {
      setAnim(false); setDx(0);
      if (dir > 0) afBook(top);
      else { afFeedback(top, 'nope'); toast(t('af_noped')); setI((x) => x + 1); }
      done();
    }, 220);
  };
  const down = (e) => { if (e.button > 0) return; st.current = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false }; };
  const move = (e) => {
    const s = st.current;
    if (!s) return;
    const mx = e.clientX - s.x, my = e.clientY - s.y;
    if (!s.moved && Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my)) { s.moved = true; e.currentTarget.setPointerCapture?.(s.id); }
    if (s.moved) setDx(mx);
  };
  const up = (e) => {
    const s = st.current;
    st.current = null;
    if (!s?.moved) return;
    e.preventDefault();
    if (Math.abs(dx) > 90) fly(dx > 0 ? 1 : -1);
    else { setAnim(true); setDx(0); setTimeout(() => setAnim(false), 260); }
  };
  const pill = social ? null : { ic: 'flame', text: t('af_of_day') };
  return html`<section class="af-stack" aria-label=${t('af_of_day')}>
    <div class="af-deck">
      ${cards.slice(1).reverse().map((o, k, arr) => html`<div key=${o.key} class=${'af-behind b' + (arr.length - k)} aria-hidden="true"><${TicketBig} o=${o} front=${false} /></div>`)}
      <div ref=${topRef} class=${'af-top' + (anim ? ' anim' : '')} style=${`transform:translateX(${dx}px) rotate(${dx / 30}deg)`}
        onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up} onDragStart=${(e) => e.preventDefault()} onClickCapture=${(e) => { if (Math.abs(dx) > 4) { e.stopPropagation(); e.preventDefault(); } }}>
        <${TicketBig} key=${top.key} o=${top} pill=${pill} onBook=${afBook} onNope=${() => fly(-1)} />
        ${dx !== 0 && html`<span class=${'af-stamp ' + (dx > 0 ? 'yes' : 'no')} style=${`opacity:${Math.min(1, Math.abs(dx) / 90)}`}>${dx > 0 ? t('af_book') : t('af_nope')}</span>`}
      </div>
    </div>
    ${AF.hint && html`<p class="af-hint"><span><${Icon} n="left" cls="xs" />${t('af_hint_l')}</span><span>${t('af_hint_r')}<${Icon} n="arrow-right" cls="xs" /></span></p>`}
  </section>`;
}
/** Wave 8.1: the empty Афиша — a statement, the next sweep on a sticker, the region's verified recurring events (events.yaml
 * sources with `recurring`, e.g. the Uluwatu kecak at sunset) as "каждый день" placeholders so it is never empty, interests. */
function AfRecCard({ r }) {
  const d = D();
  const fx = useRef(null);
  const eff = (r.topics ?? []).map((k) => regionPack()?.events?.effects?.[k]).find((x) => x !== undefined) ?? null;
  useEffect(() => (eff ? fxMount(fx.current, { shader: eff.shader, mix: eff.mix ?? 1 }) : undefined), [eff?.shader]);
  const ru = LANG === 'ru';
  const title = (ru && r.name_ru) || r.name;
  const when = (ru && r.recurring_ru) || r.recurring;
  const daily = /daily|каждый день|every day/i.test(`${r.recurring} ${r.recurring_ru ?? ''}`);
  const ic = AF_TOPIC_ICON[(r.topics ?? []).find((k) => AF_TOPIC_ICON[k])] ?? 'ticket';
  return html`<div class="af81-rec">
    <div class="frame af81-rec-ph"><div class="in">
      <span class="scene solid" style=${sceneStyle(d.search.country)}></span><span class="tk-motif"><${Icon} n=${ic} /></span>
      ${eff && html`<div class="fx" ref=${fx} aria-hidden="true"></div>`}
      <span class="af81-rec-pill"><${Icon} n="repeat" cls="xs" />${daily ? t('w81_af_daily') : t('w81_af_rec')}</span>
    </div></div>
    ${r.starts && html`<${Sticker} text=${r.starts} cls="sm" style="right:-6px;top:-14px;--r:10deg" />`}
    <p class="af81-rec-t">${title}</p>
    <p class="af81-rec-m">${[when, r.area ? afArea(r.area) : null].filter(Boolean).join(' · ')}</p>
  </div>`;
}
function AfEmpty() {
  const pk = regionPack();
  const l = homeListing() ?? listingById(D()?.listings?.[0]?.id);
  const dist = l?.district;
  const city = dist ? Object.values(pk?.areas ?? {}).find((a) => (a.districts ?? []).includes(dist))?.city ?? null : null;
  const recs = (pk?.events?.sources ?? []).filter((x) => x.recurring).sort((a, b) => (b.city === city) - (a.city === city)).slice(0, 3);
  return html`<section class="af81-empty">
    <div class="af81-e-hd">
      <${Typed} lines=${[t('w81_af_big')]} cls="af81-big" />
      <${Sticker} text=${t('w81_af_sweep', { t: '08:00' })} cls="lg" style="right:-4px;top:-18px;--r:12deg" />
    </div>
    <p class="w8-sub">${recs.length ? t('w81_af_sub') : t('w81_af_none_sub')}</p>
    ${recs.map((r) => html`<${AfRecCard} key=${r.id} r=${r} />`)}
    <div class="w8-pills af81-e-pills"><button class="btn accent" onClick=${() => { hap.sel(); openSheet('af_prefs'); }}><${Icon} n="sparkles" cls="sm" />${t('w81_af_prefs')}</button></div>
  </section>`;
}
function Afisha({ arg }) {
  const d = D();
  const tab = arg === 'social' ? 'social' : 'all';
  const [v, rerender] = useAfisha(tab);
  const fs = AF.f[tab] ?? [];
  const setF = (k) => {
    hap.sel();
    const cur = new Set(fs);
    if (k === 'all') cur.clear(); else if (cur.has(k)) cur.delete(k); else cur.add(k);
    AF.f[tab] = [...cur];
    rerender();
  };
  const reshuffle = () => { hap.impact(); AF.seed = (AF.seed + 1 + Math.floor(Math.random() * 1000)) % 1e6; rerender(); };
  const setDay = (day) => { hap.sel(); AF.day = day; rerender(); };
  // wave 8.1: "Рядом" (no district: the whole region, near first) or any districts (multi-select)
  const setD = (k) => { hap.sel(); const cur = new Set(AF.d); if (k == null) cur.clear(); else if (cur.has(k)) cur.delete(k); else cur.add(k); AF.d = [...cur]; rerender(); };
  const pkAreas = regionPack()?.areas ?? {};
  const dChips = [...new Set([...AF.d, ...(v?.areas ?? []).map((x) => x.id)])].filter((k) => pkAreas[k]);
  const area = v?.area ? afArea(v.area) : null;
  const kick = [v?.day || v?.today ? cap(dfmt(v.day || v.today, { weekday: 'long', day: 'numeric', month: 'long' })) : ' ', area].filter((x) => x && x.trim()).join(' · ') || ' ';
  const hm = homeMode();
  const all = v && !v.failed ? [...v.top, ...v.items] : [];
  const isToday = !v?.day || v.day === v.today;
  const q = tab === 'social' ? t('af_social') : isToday ? t('w8_tonight_q') : t('w8_day_q', { d: afDay(v.day) });
  // wave 8.1: nothing collected at all (not just filtered out) → the designed empty state instead of a grey box
  const nothing = !!v && !v.failed && !all.length && !v.total && !fs.length;
  return html`<main class="screen af-screen">
    <div class="head w3-head w8-head">${!inTG && html`<div class="row w8-head-top"><${BackIfWeb} /></div>`}
      <div class="row af8-hd"><div class="grow"><p class="kicker">${kick}</p><h1 class="sr">${t(tab === 'social' ? 'af_social' : 'af_title')}</h1><${Typed} lines=${[q]} /></div>
      <button class="round af-more" aria-label=${t('af_more')} title=${t('af_more')} onClick=${reshuffle}><${Icon} n="shuffle" /></button></div></div>
    <div class="seg af-tabs" role="tablist">
      <button role="tab" aria-pressed=${tab === 'all' ? 'true' : 'false'} onClick=${() => tab !== 'all' && go(sp('afisha'), true)}>${t('af_title')}</button>
      <button role="tab" aria-pressed=${tab === 'social' ? 'true' : 'false'} onClick=${() => tab !== 'social' && go(sp('afisha', 'social'), true)}>${t('af_social')}</button>
      <button class="af-prefs" aria-label=${t('af_prefs')} onClick=${() => openSheet('af_prefs')}><${Icon} n="settings-2" cls="sm" /></button>
    </div>
    ${hm && tab === 'all' && html`<${AfParties} />`}
    ${!nothing && dChips.length > 0 && html`<div class="w3-chips af81-dist" role="group" aria-label=${t('w81_districts')}>
      <button aria-pressed=${AF.d.length ? 'false' : 'true'} onClick=${() => setD(null)}><${Icon} n="navigation" cls="xs" />${t('w81_near')}</button>
      ${dChips.map((k) => html`<button key=${k} aria-pressed=${AF.d.includes(k) ? 'true' : 'false'} onClick=${() => setD(k)}>${pkAreas[k].name?.[LANG] ?? pkAreas[k].name?.en ?? k}${(v?.areas ?? []).find((x) => x.id === k) ? html`<i class="af81-n">${v.areas.find((x) => x.id === k).n}</i>` : null}</button>`)}
    </div>`}
    ${!nothing && html`<div class="w3-chips" role="group">
      ${tab === 'all' && html`<button aria-pressed=${fs.length ? 'false' : 'true'} onClick=${() => setF('all')}>${t('af_f_all')}</button>`}
      ${AF_FILTERS[tab].map((k) => html`<button key=${k} class="ic-chip" aria-pressed=${fs.includes(k) ? 'true' : 'false'} onClick=${() => setF(k)}>${AF_FICON[k] && html`<${Icon} n=${AF_FICON[k]} cls="xs" />`}${t('af_f_' + k)}</button>`)}
    </div>`}
    ${tab === 'all' && v?.days && !nothing && html`<div class="af-days" role="group">${v.days.map((x) => html`<button key=${x.day} aria-pressed=${x.day === v.day ? 'true' : 'false'} disabled=${!x.n && x.day !== v.day} onClick=${() => setDay(x.day)}>
      <span>${dfmt(x.day, { weekday: 'short' }).replace('.', '')}</span><b>${Number(x.day.slice(8, 10))}</b>${x.n ? html`<i>${x.n}</i>` : html`<i class="z">·</i>`}</button>`)}</div>`}
    ${!v ? html`${skel(420)}${skel(200)}` : v.failed ? msgCard(t('err_generic')) : nothing ? html`<${AfEmpty} />` : !all.length ? html`<div class="card af-empty"><span class="scene solid" style=${sceneStyle(d.search.country)}></span>
        <b>${t('af_empty_f')}</b><span>${t('af_empty_f_sub')}</span></div>` : html`
      <${AfStack} list=${v.top} social=${tab === 'social'} />
      ${v.items.length > 0 && html`<div class="af-grid">${v.items.map((o) => html`<${TicketSmall} key=${o.key} o=${o} />`)}</div>`}`}
    ${tab === 'social' && v?.weekly?.length > 0 && html`<div class="card af-week"><p>${t('af_by_wd')}</p><div>${v.weekly.slice(0, 4).map((w) => html`<button key=${w.wd} onClick=${() => go(sp('event', w.key))}>
      <span>${t('af_wd' + w.wd)}</span><b>${w.title}</b></button>`)}</div></div>`}
    <${Nav} tab=${hm ? 'afisha' : 'today'} />
  </main>`;
}
const afArea = (id) => {
  const pk = regionPack();
  const ar = Object.values(pk?.areas ?? {}).find((a) => (a.districts ?? []).includes(id)) ?? pk?.areas?.[id];
  return ar?.name ? ar.name[LANG] ?? ar.name.en : null;
};

/** E2: the event page. */
function EventDetail({ id }) {
  const d = D();
  const [eid, occ] = String(id ?? '').split('@');
  const [v, setV] = useState(null);
  const [rev, setRev] = useState(0);
  useEffect(() => {
    api(`/app/api/event?s=${encodeURIComponent(d.search.id)}&id=${encodeURIComponent(eid)}&occ=${encodeURIComponent(occ ?? '')}`).then(setV).catch((e) => setV({ failed: true, code: e.code }));
  }, [id, rev, AF.rev]);
  const fxRef = useRef(null), imgRef = useRef(null);
  const o = v?.occurrence;
  useEffect(() => (photoUrl(o?.photo) && o.effect ? fxMount(fxRef.current, { shader: o.effect.shader, mix: o.effect.mix ?? 1, img: imgRef.current }) : undefined), [photoUrl(o?.photo), o?.effect?.shader]);
  if (!v) return html`<main class="screen no-nav">${skel(300)}${skel(160)}</main>`;
  if (v.failed || !o) return html`<main class="screen no-nav"><${BackIfWeb} />${msgCard(v.event?.past ? t('af_past') : t('err_generic'))}</main>`;
  const me = d.user.id;
  const voters = d.members.filter((m) => m.role === 'owner' || m.role === 'member');
  const others = voters.filter((m) => m.user_id !== me);
  const wanted = d.members.filter((m) => o.want.includes(m.user_id) || o.going.includes(m.user_id));
  const end = o.ends_at ? '–' + o.ends_at.slice(11, 16).replace(/^0(\d)/, '$1') : '';
  const price = afPrice(o);
  const meta = [afDayLong(o.occ), afHM(o) + end, price ? price + (o.price_note && o.price != null && LANG === 'ru' ? ` ${o.price_note}` : '') : null].filter(Boolean).join(' · ');
  const kick = [afCat(o), afPlace(o) || afArea(o.place?.area)].filter(Boolean).join(' · ');
  const why = afWhy(o);
  const sea = o.sea ? o.sea_state : null;
  const band = Number(o.starts_at.slice(11, 13)) < 12 ? 'morning' : Number(o.starts_at.slice(11, 13)) < 17 ? 'day' : 'evening';
  const ch = v.organizer?.channel;
  const chName = { whatsapp: 'WhatsApp', telegram: 'Telegram', instagram: 'Instagram', facebook: 'Messenger', email: 'email', phone: 'SMS' }[ch] ?? null;
  const nGo = 1 + others.length;
  const st = o.booking_status;
  const badges = [afLang(o) && (o.lang === 'none' ? t('af_l_none') : afLang(o)), o.age_min && `${o.age_min}+`, o.entry && o.entry !== 'free' && t('af_e_' + o.entry), o.dress_code, o.beginner && t('af_beginner'), o.vibe && t('af_v_' + o.vibe), o.crowd && t('af_cr_' + o.crowd)].filter(Boolean);
  const wantOn = o.mine.want;
  const toggleWant = async () => { if (await afFeedback(o, 'want', !wantOn)) { if (!wantOn) toast(t('af_want_sent')); setRev((x) => x + 1); } };
  const bookmark = async () => { if (await afFeedback(o, 'bookmark', !o.mine.bookmark)) { toast(t(o.mine.bookmark ? 'af_unsaved' : 'af_saved')); setRev((x) => x + 1); } };
  const nope = async () => { if (await afFeedback(o, 'nope', !o.mine.nope)) { toast(t(o.mine.nope ? 'af_unnoped' : 'af_noped')); setRev((x) => x + 1); } };
  const cancel = async () => {
    const b = v.bookings?.find((x) => x.status !== 'cancelled');
    if (!b) return;
    try { await api('/app/api/event-book-cancel', { search_id: d.search.id, booking_id: b.id }); hap.ok(); toast(t('af_cancelled')); afReset(); setRev((x) => x + 1); } catch { toast(t('err_generic')); }
  };
  const bookLabel = o.booking === 'ticket' ? t('af_tickets') : nGo === 2 ? t('af_book_two') : nGo === 3 ? t('af_book_three') : t('af_book');
  // V4-8: back circle, the photo in a black frame with one category effect, a language sticker, then the words
  return html`<main class="detail evd evd8">
    ${!inTG && html`<div class="row evd8-top"><button class="round w8-back" aria-label=${t('back')} onClick=${back}><${Icon} n="arrow-left" /></button></div>`}
    <div class="evd8-stage">
      <div class="frame evd8-frame"><div class="in evd-hero">
        ${o.photo ? html`<img ref=${imgRef} src=${photoUrl(o.photo)} alt="" decoding="async" />` : html`<span class="scene solid" style=${sceneStyle(d.search.country)}></span><span class="tk-motif"><${Icon} n=${afIcon(o)} /></span>`}
        ${o.photo && o.effect && html`<div class="fx" ref=${fxRef} aria-hidden="true"></div>`}
        ${o.photo?.credit && html`<a class="evd-credit" href=${o.photo.source_url || null} onClick=${(e) => { if (o.photo.source_url) { e.preventDefault(); openLink(o.photo.source_url); } }}>${o.photo.credit.startsWith('©') ? o.photo.credit : '© ' + o.photo.credit}</a>`}
      </div></div>
      ${afLang(o) && html`<${Sticker} text=${afLang(o)} cls="sky" style="right:-4px;top:-22px;--r:10deg" />`}
    </div>
    <div class="sheet-body evd-body">
      <p class="kicker">${kick}</p>
      <h1 class="evd-h">${afTitle(o)}</h1>
      <p class="meta">${meta}</p>
      ${o.recurring && html`<span class="chip evd-rec"><${Icon} n="repeat" cls="xs" />${LANG === 'en' ? o.recurring.en : o.recurring.ru}${o.minutes != null ? ' · ' + afTravel(o) : ''}</span>`}
      ${sea && html`<${WaterCard} cls="evd-sea"><span class="evd-sea-in"><${Icon} n="waves" /><span><b>${t(sea.calm ? 'af_sea_calm' : 'af_sea_rough', { w: t('af_band_' + band) })}</b>
        <span>${[sea.wave != null ? t('af_wave', { x: fmtNum(sea.wave) }) : null, sea.wind != null ? t(sea.wind <= 12 ? 'af_wind_low' : sea.wind <= 22 ? 'af_wind_mid' : 'af_wind_high') : null].filter(Boolean).join(' · ')}</span></span></span><//>`}
      ${why && html`<p class="tk-why evd-why"><${Icon} n="sparkles" cls="xs" />${why}</p>`}
      ${o.liked_before && html`<p class="tk-why evd-why tk9-liked-line"><${Icon} n="sparkles" cls="xs" />${t('fb_liked_line', { r: '★'.repeat(o.liked_before.rating) })}</p>`}
      <${EventFeedback} o=${o} onDone=${() => setRev((x) => x + 1)} />
      ${afAbout(o) && html`<p class="evd-about">${afAbout(o)}</p>`}
      ${badges.length > 0 && html`<div class="chips evd-badges">${badges.map((b) => html`<span class="chip">${b}</span>`)}</div>`}
      <div class="card w2-list evd-agent">
        <div class="w2-lh"><span>${t(o.booking === 'none' ? 'af_how' : o.booking === 'ticket' ? 'af_how' : 'af_agent')}</span></div>
        ${o.booking === 'message' && html`<div class="w2-row"><span class="sq big accent-sq"><${Icon} n="message-circle" /></span><div class="grow"><b>${chName ? t('af_ag_msg', { c: chName }) : t('af_ag_msg0')}</b><span>${t('af_ag_msg_s')}</span></div></div>`}
        ${o.booking === 'ticket' && html`<button class="w2-row" onClick=${() => openLink(o.ticket_url)}><span class="sq big accent-sq"><${Icon} n="ticket" /></span><div class="grow"><b>${t('af_ag_ticket')}</b><span>${t('af_ag_ticket_s')}</span></div><${Icon} n="ext" cls="sm muted" /></button>`}
        ${o.booking === 'none' && html`<div class="w2-row"><span class="sq big accent-sq"><${Icon} n="door-open" /></span><div class="grow"><b>${t('af_ag_none')}</b><span>${t('af_ag_none_s')}</span></div></div>`}
        ${o.booking !== 'none' && html`<div class="w2-row"><span class="sq big accent-sq"><${Icon} n="users" /></span><div class="grow"><b>${others.length ? t('af_ag_seats', { n: nGo, names: others.map((m) => firstName(m.name)).join(', ') }) : t('af_ag_seat1')}</b><span>${t('af_ag_seats_s')}</span></div></div>`}
        ${o.price_kind !== 'free' && html`<div class="w2-row"><span class="sq big accent-sq"><${Icon} n="wallet" /></span><div class="grow"><b>${t('af_ag_pay')}</b><span>${t('af_ag_pay_s')}</span></div></div>`}
      </div>
      <div class="evd-who">
        ${wanted.length ? html`<span class="avs free">${wanted.slice(0, 4).map((m) => html`<${Av} key=${m.user_id} m=${m} size=${32} free />`)}</span>` : html`<span class="avs free"><${Av} m=${memberById(me)} size=${32} free /></span>`}
        <span class="grow">${wanted.length ? whoText(o, wanted, me) : t('af_who_none')}</span>
        ${canVoteRole(d.me.role) && html`<button class=${'btn sm ' + (wantOn ? 'surface' : 'link')} onClick=${toggleWant}>${t(wantOn ? 'af_want_on' : 'af_want')}</button>`}
      </div>
      ${(o.source?.url || o.source?.name) && html`<p class="evd-src">${t('af_source')}: ${o.source.url ? html`<a href=${o.source.url} onClick=${(e) => { e.preventDefault(); openLink(o.source.url); }}>${o.source.name || hostOf(o.source.url)}</a>` : o.source.name}</p>`}
      ${canVoteRole(d.me.role) && html`<button class="btn ghost block" onClick=${nope}>${t(o.mine.nope ? 'af_unnope' : 'af_nope')}</button>`}
    </div>
    ${canVoteRole(d.me.role) && html`<div class="evd-bar">
      <button class="round evd-bm" aria-label=${t('sh_title')} onClick=${() => openSheet('share', { kind: 'event', o })}><${Icon} n="share" /></button>
      <button class=${'round evd-bm' + (o.mine.bookmark ? ' on' : '')} aria-label=${t('af_save')} aria-pressed=${o.mine.bookmark ? 'true' : 'false'} onClick=${bookmark}><${Icon} n="bookmark" /></button>
      ${st && st !== 'cancelled' && st !== 'declined'
        ? html`<div class="evd-st"><b>${t('af_st_' + st)}</b><button class="btn link" onClick=${cancel}>${t('af_cancel')}</button></div>`
        : html`<button class="btn accent big grow" onClick=${() => afBook(o)}>${bookLabel}</button>`}
    </div>`}
  </main>`;
}
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
function whoText(o, ms, me) {
  const going = ms.filter((m) => o.going.includes(m.user_id));
  if (going.length) return t('af_going', { names: going.map((m) => (m.user_id === me ? t('af_you') : firstName(m.name))).join(', ') });
  const w = ms.filter((m) => m.user_id !== me);
  if (!w.length) return t('af_you_want');
  return w.length === 1 ? t('af_wants1', { name: firstName(w[0].name) }) : t('af_wantsN', { names: w.map((m) => firstName(m.name)).join(', ') });
}

/** "Записаться": who goes (members + guests), what to ask (nightlife: guest list / table; padel: a slot), a note. */
function EventBookSheet({ o }) {
  const d = D();
  const voters = d.members.filter((m) => m.role === 'owner' || m.role === 'member');
  const [who, setWho] = useState(() => new Set(voters.map((m) => m.user_id).filter((u) => u === d.user.id || o.want.includes(u)).concat(d.user.id)));
  const [guests, setGuests] = useState(0);
  const kinds = o.category === 'social_sport' ? ['slot', 'join'] : ['bar', 'club', 'beach_club', 'party'].includes(o.category) ? ['join', 'guest_list', 'table'] : ['join'];
  const [kind, setKind] = useState(kinds[0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const toggle = (u) => { hap.sel(); const n = new Set(who); n.has(u) ? n.delete(u) : n.add(u); if (!n.size) n.add(d.user.id); setWho(n); };
  const ticket = o.booking === 'ticket';
  async function save() {
    setBusy(true);
    try {
      await api('/app/api/event-book', { search_id: d.search.id, event_id: o.id, occ: o.occ, who: [...who], guests, kind, note: note.trim() || null });
      hap.ok();
      toast(t(ticket || o.booking === 'none' ? 'af_booked_self' : 'af_booked_req'));
      afReset();
      closeSheet();
      if (ticket && o.ticket_url) openLink(o.ticket_url);
    } catch (e) { toast(e.code === 'event_past' ? t('af_past') : e.code === 'sensitive' ? e.message : t('err_generic')); }
    setBusy(false);
  }
  const n = who.size + guests;
  return html`<h2>${t('af_who_title')}</h2>
    <p class="muted af-sheet-sub">${afTitle(o)} · ${afDayLong(o.occ)}, ${afHM(o)}</p>
    <div class="card grp">${voters.map((m) => html`<button key=${m.user_id} class="opt" role="checkbox" aria-checked=${who.has(m.user_id) ? 'true' : 'false'} onClick=${() => toggle(m.user_id)}>
      <${Av} m=${m} size=${36} /><span class="grow">${m.user_id === d.user.id ? t('af_you_cap') : m.name}</span><span class=${'cbox' + (who.has(m.user_id) ? ' on' : '')}>${who.has(m.user_id) && html`<${Icon} n="check" />`}</span></button>`)}
      <div class="opt"><span class="sq"><${Icon} n="userplus" /></span><span class="grow">${t('af_guests')}</span>
        <span class="stepper"><button aria-label="−" disabled=${!guests} onClick=${() => { hap.sel(); setGuests(Math.max(0, guests - 1)); }}><${Icon} n="minus" cls="sm" /></button><b>${guests}</b><button aria-label="+" disabled=${guests >= 10} onClick=${() => { hap.sel(); setGuests(guests + 1); }}><${Icon} n="plus" cls="sm" /></button></span></div>
    </div>
    ${kinds.length > 1 && html`<div class="seg full af-kind" role="group">${kinds.map((k) => html`<button key=${k} aria-pressed=${kind === k ? 'true' : 'false'} onClick=${() => { hap.sel(); setKind(k); }}>${t('af_k_' + k)}</button>`)}</div>`}
    ${!ticket && o.booking !== 'none' && html`<input class="e-input af-note" value=${note} maxlength="300" placeholder=${t('af_note_ph')} onInput=${(e) => setNote(e.currentTarget.value)} />`}
    <p class="muted af-sheet-note">${t(ticket ? 'af_book_note_ticket' : o.booking === 'none' ? 'af_book_note_none' : 'af_book_note', { n })}</p>
    <button class="btn accent block" disabled=${busy} onClick=${save}>${t(ticket ? 'af_book_ticket_btn' : o.booking === 'none' ? 'af_book_none_btn' : 'af_book_btn', { n })}</button>
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}
const AF_INTERESTS = ['nightlife', 'sport', 'surf', 'culture', 'nature', 'food', 'wellness', 'music', 'creative', 'social'];
function AfPrefsSheet() {
  const d = D();
  const cur = Object.values(AF.cache).find((x) => x?.prefs)?.prefs ?? {};
  const [night, setNight] = useState(cur.nightlife !== false);
  const [line, setLine] = useState(cur.afisha ?? homeMode());
  const [ints, setInts] = useState(new Set(cur.taste?.interests ?? []));
  const [age, setAge] = useState(cur.taste?.age_band ?? null);
  const save = async (patch) => {
    try { await api('/app/api/afisha-prefs', { search_id: d.search.id, ...patch }); afReset(); } catch { toast(t('err_generic')); }
  };
  const tog = (k) => { hap.sel(); const n = new Set(ints); n.has(k) ? n.delete(k) : n.add(k); setInts(n); save({ taste: { age_band: age, interests: [...n] } }); };
  return html`<h2>${t('af_prefs')}</h2>
    <div class="card grp">
      <${Toggle} on=${night} label=${t('af_p_night')} sub=${t('af_p_night_sub')} onChange=${(v) => { hap.sel(); setNight(v); save({ nightlife: v ? null : false }); }} />
      <${Toggle} on=${line} label=${t('af_p_line')} sub=${t('af_p_line_sub')} onChange=${(v) => { hap.sel(); setLine(v); save({ afisha: v }); }} />
    </div>
    <p class="section">${t('af_p_like')}</p>
    <div class="chips af-ints">${AF_INTERESTS.map((k) => html`<button key=${k} class=${'bchip' + (ints.has(k) ? ' on' : ' off')} aria-pressed=${ints.has(k) ? 'true' : 'false'} onClick=${() => tog(k)}>${t('af_i_' + k)}</button>`)}</div>
    <p class="section">${t('af_p_age')}</p>
    <div class="seg full" role="group">${['18-24', '25-30', '31-40', '40+'].map((a) => html`<button key=${a} aria-pressed=${age === a ? 'true' : 'false'} onClick=${() => { hap.sel(); setAge(a); save({ taste: { age_band: a, interests: [...ints] } }); }}>${a}</button>`)}</div>
    <p class="muted af-sheet-note">${t('af_p_note')}</p>
    <button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
}
/** Home Plan: today's top event and the upcoming bookings (/app/api/event-plan). */
function AfPlanCard() {
  const d = D();
  const parties = ptUpcoming(useParties()); // wave 9: the members' own parties in the Plan
  const [v, setV] = useState(null);
  useEffect(() => { api('/app/api/event-plan?s=' + encodeURIComponent(d.search.id)).then(setV).catch(() => setV({ failed: true })); }, [d.search.id, AF.rev]);
  if (!v || v.failed || (!v.top && !v.bookings?.length && !v.total && !parties.length)) return null;
  const top = v.top;
  return html`<div class="card w2-list af-plan">
    <button class="w2-lh af-plan-h" onClick=${() => go(sp('afisha'))}><span>${t('af_title')}${v.total ? ` · ${t('af_n_week', { n: v.total })}` : ''}</span><span class="af-plan-all">${t('af_all')}<${Icon} n="chev" cls="sm" /></span></button>
    ${parties.map((p) => html`<button key=${p.id} class="w2-row cl-row hm-cl-go" onClick=${() => go(sp('party', p.id))}><span class="cl-d acc">${fmtDMshort(ptDay(p.starts_at))}</span>
      <div class="grow"><b>${p.title}</b><span>${[ptHM(p.starts_at), t('pt_at_home'), t('pt_going_n', { n: p.counts?.heads ?? 0 })].join(' · ')}</span></div><${Icon} n="chev" cls="sm muted" /></button>`)}
    ${v.bookings.map((b) => html`<button key=${b.id} class="w2-row cl-row hm-cl-go" onClick=${() => go(sp('event', b.event_id + '@' + b.occ))}><span class="cl-d">${fmtDMshort(b.occ)}</span>
      <div class="grow"><b>${b.title}</b><span>${[b.starts_at.slice(11, 16), b.place, t('af_st_' + b.status)].filter(Boolean).join(' · ')}</span></div><${Icon} n="chev" cls="sm muted" /></button>`)}
    ${top && !v.bookings.some((b) => b.event_id === top.id && b.occ === top.occ) && html`<button class="w2-row af-plan-top" onClick=${() => go(sp('event', top.key))}>
      ${top.photo ? html`<img class="af-thumb" src=${photoUrl(top.photo)} alt="" loading="lazy" />` : html`<span class="sq big"><${Icon} n=${afIcon(top)} /></span>`}
      <div class="grow"><b>${afTitle(top)}</b><span>${[t('af_today_at', { t: afHM(top) }), afPlace(top), afWhy(top)].filter(Boolean).join(' · ')}</span></div><${Icon} n="chev" cls="sm muted" /></button>`}
  </div>`;
}

// ---------------------------------------------------------------- wave 9 · evenings & parties (DESIGN.md "Block vibe")
// Своя тусовка (party ticket, guests, checklist → Деньги, invite link, local rules, recap), the evening Home hero with the
// leave-by time, "Как было?" on events, the evening map layer and the share card (canvas, ticket style) + public links.
Object.assign(STR.ru, {
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
});
Object.assign(STR.en, {
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
});
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
const PT_ICON = { drinks: 'martini', ice: 'snowflake', food: 'utensils', music: 'speaker', cups: 'glass-water', cleanup: 'brush', other: 'sparkles' };
const PT = { rev: 0 };
const ptHM = (iso) => hm(String(iso ?? '').slice(11, 16));
const ptDay = (iso) => String(iso ?? '').slice(0, 10);
const ptCover = (p) => (p?.cover ? photoUrl(p.cover) : photosOf(homeListing())[0] ?? null);
const ptWhen = (p) => `${afDayLong(ptDay(p.starts_at))} · ${ptHM(p.starts_at)}${p.ends_at ? '–' + ptHM(p.ends_at) : ''}`;
const ptCan = () => canVoteRole(D()?.me?.role) && D()?.search?.status !== 'closed';
/** "+08:00" of the project's time zone on a day (no DST in our regions, computed anyway). */
function tzOff(day) {
  try {
    const v = new Intl.DateTimeFormat('en-US', { timeZone: tzNow(), timeZoneName: 'longOffset' }).formatToParts(new Date(day + 'T12:00:00Z')).find((x) => x.type === 'timeZoneName')?.value ?? 'GMT';
    const m = v.match(/([+-])(\d{1,2}):?(\d{2})?/);
    return m ? `${m[1]}${String(m[2]).padStart(2, '0')}:${m[3] ?? '00'}` : '+00:00';
  } catch { return '+00:00'; }
}
function useParties() {
  const d = D();
  const [v, setV] = useState(null);
  useEffect(() => {
    let live = true;
    api('/app/api/parties?s=' + encodeURIComponent(d.search.id)).then((j) => live && setV(j.parties)).catch(() => live && setV([]));
    return () => { live = false; };
  }, [d.search.id, PT.rev]);
  return v;
}
const ptUpcoming = (list) => (list ?? []).filter((p) => !p.past && p.status === 'active');

/** A party as a ticket: the cover (or the house) in the black frame, perforation, the stub with the date and the counts. */
function PartyTicket({ p, small = false }) {
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
function AfParties() {
  const list = ptUpcoming(useParties());
  return html`<section class="pt9-af">
    ${list.slice(0, 2).map((p) => html`<${PartyTicket} key=${p.id} p=${p} small />`)}
    ${ptCan() && html`<button class="pt9-new" onClick=${() => { hap.sel(); go(sp('party-edit', 'new')); }}><span class="round ink"><${Icon} n="plus" /></span>
      <span class="grow"><b>${t('pt_new')}</b><span>${t('pt_new_sub')}</span></span><${Icon} n="arrow-up-right" cls="sm" /></button>`}
  </section>`;
}

/** The party screen: ticket hero, counts, invite link, guests, checklist, local rules; after the party rating, photos, recap. */
function PartyScreen({ id }) {
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
function RateRow({ cur, note: note0 = '', onSave }) {
  const [r, setR] = useState(cur);
  const [note, setNote] = useState(note0 ?? '');
  const [busy, setBusy] = useState(false);
  return html`<div class="fb9">
    <div class="fb9-stars" role="radiogroup" aria-label=${t('fb_q')}>${[1, 2, 3, 4, 5].map((n) => html`<button key=${n} role="radio" aria-checked=${r === n ? 'true' : 'false'} class=${'fb9-n' + (r != null && n <= r ? ' on' : '')} onClick=${() => { hap.sel(); setR(n); }}>${n}</button>`)}</div>
    <input class="e-input fb9-note" value=${note} maxlength="300" placeholder=${t('fb_note_ph')} onInput=${(e) => setNote(e.currentTarget.value)} />
    <button class="btn accent" disabled=${!r || busy} onClick=${async () => { setBusy(true); await onSave(r, note.trim() || null); setBusy(false); }}>${t('fb_save')}</button>
  </div>`;
}
function PartyItemSheet({ arg }) {
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
function PartyEdit({ id }) {
  const d = D();
  const isNew = !id || id === 'new';
  const [v, setV] = useState(isNew ? { party: null } : null);
  useEffect(() => { if (!isNew) api(`/app/api/party?s=${encodeURIComponent(d.search.id)}&id=${encodeURIComponent(id)}`).then(setV).catch(() => setV({ failed: true })); }, [id]);
  if (!v) return html`<main class="screen no-nav">${skel(300)}</main>`;
  if (v.failed) return html`<main class="screen no-nav"><${BackIfWeb} />${msgCard(t('err_generic'))}</main>`;
  return html`<${PartyForm} p=${v.party} />`;
}
function PartyForm({ p }) {
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
function useEvening() {
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
const eveningOn = (v) => !!v?.tonight && (v.local_min >= 15 * 60 || (v.tonight.minutes_left != null && v.tonight.minutes_left <= 360));
function EveningHero({ v }) {
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
function EvLateSheet({ x }) {
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
function EventFeedback({ o, onDone }) {
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
async function shareCardPng(x) {
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
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('png'))), 'image/png'));
}
function ShareSheet({ arg }) {
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
function EvTicketSheet({ o }) {
  return html`<div class="ev9-sheet"><${TicketBig} o=${o} onBook=${(x) => { closeSheet(); afBook(x); }} /></div>
    <button class="btn ghost block" onClick=${closeSheet}>${t('close')}</button>`;
}

// ---------------------------------------------------------------- sheets
// ---------------------------------------------------------------- wave 6 · B: Полезное (47)
// Region pack useful.yaml + instance-wide links members suggested and the agent/owner approved (/app/api/useful).
const ufCache = {};
let ufRev = 0; // bumped after a suggestion so an open Полезное screen reloads
function useUseful(sid) {
  const [v, setV] = useState(ufCache[sid] ?? null);
  const reload = () => api('/app/api/useful?s=' + encodeURIComponent(sid)).then((j) => { ufCache[sid] = j; setV(j); }).catch((e) => setV({ failed: true, code: e.code }));
  useEffect(() => { reload(); }, [sid, ufRev]);
  return [v, reload];
}
const UF_FILTERS = ['all', 'chats', 'apps', 'guides', 'maps'];
const UF_FOLD = 5;
const UF_GROUPS = ['telegram', 'apps', 'guides'];
const UF_CATS = ['chats_rent', 'flea', 'bikes', 'news', 'visas', 'medicine', 'food', 'apps', 'guides', 'maps', 'other'];
const UF_BADGE = { telegram: 'TG', app: 'App', web: 'Web', hunt: 'Hunt' };
const UF_ICON = { telegram: 'send', app: 'smartphone', web: 'book-open', hunt: 'map' };
const ufGroup = (x) => (x.kind === 'telegram' ? 'telegram' : x.kind === 'app' ? 'apps' : 'guides');
const ufIsMap = (x) => x.kind === 'hunt' || x.category === 'maps';
const ufMatch = (x, f) => f === 'all' || (f === 'chats' && x.kind === 'telegram') || (f === 'apps' && x.kind === 'app')
  || (f === 'maps' && ufIsMap(x)) || (f === 'guides' && x.kind !== 'telegram' && x.kind !== 'app' && !ufIsMap(x));
function ufHandle(url) {
  const m = String(url ?? '').match(/^https:\/\/t\.me\/([A-Za-z0-9_]{3,})\/?$/);
  if (m) return '@' + m[1];
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}
function ufAbout(x, nPlaces) {
  let a = x.about?.[LANG] ?? x.about?.ru ?? x.about?.en ?? x.note ?? '';
  if (a.includes('{n}')) a = nPlaces ? a.replace('{n}', String(nPlaces)) : a.replace(/\{n\}\s*/, '');
  return a;
}
function ufSub(x, nPlaces) {
  const about = ufAbout(x, nPlaces);
  // Pack guides/apps carry their source in the text; a Telegram chat or a suggested link shows its handle / host first.
  const h = x.kind === 'telegram' || x.source === 'crm' ? ufHandle(x.url) : null;
  return [h, about].filter(Boolean).join(' · ');
}
function ufOpen(x) {
  if (x.kind === 'hunt') {
    const scr = String(x.url).replace(/^hunt:/, '');
    if (isGuest()) { if (D().me.guest?.areas?.places) go(sp('gplaces'), true); return; }
    go(sp(scr === 'spots' || scr === 'map' ? scr : 'spots'));
    return;
  }
  hap.sel();
  openLink(x.url);
}
let ufFilter = 'all';
function Useful() {
  const d = D();
  const [v, reload] = useUseful(d.search.id);
  const [f, setF0] = useState(ufFilter);
  const [allTg, setAllTg] = useState(false);
  const setF = (k) => { ufFilter = k; setF0(k); };
  const base = useBasePlaces(d.search.country);
  const nPlaces = base ? allPlaces(base).length : 0;
  const region = S.regions?.[d.search.country]?.name?.[LANG] ?? S.regions?.[d.search.country]?.name?.en ?? '';
  const kicker = v?.verified ? t('uf_kicker', { r: region, d: fmtDM(v.verified) }) : region || ' ';
  const canAdd = !!v?.can_suggest;
  const guest = isGuest();
  const items = (v?.items ?? []).filter((x) => !(guest && x.kind === 'hunt' && !d.me.guest?.areas?.places));
  const shown = items.filter((x) => ufMatch(x, f));
  const pending = f === 'all' ? v?.pending ?? [] : [];
  async function decide(x, status) {
    hap.sel();
    try { await api('/app/api/useful-decide', { search_id: d.search.id, id: x.id, status }); hap.ok(); toast(t(status === 'approved' ? 'uf_approved' : 'uf_rejected')); reload(); }
    catch { toast(t('err_generic')); }
  }
  const row = (x, trail, sub = ufSub(x, nPlaces)) => html`<div key=${x.id} class="w2-row uf-row" role="button" tabindex="0" onClick=${() => ufOpen(x)} onKeyDown=${(e) => e.key === 'Enter' && ufOpen(x)}>
    <span class="sq big"><${Icon} n=${x.icon && ICONS[x.icon] ? x.icon : UF_ICON[x.kind] ?? 'link'} /></span>
    <div class="grow"><b>${x.name}</b>${sub && html`<span>${sub}</span>`}${x.attribution && html`<span class="uf-attr">${t('uf_source', { s: x.attribution })}</span>`}</div>
    ${trail ?? html`<span class="chip uf-kind">${UF_BADGE[x.kind] ?? 'Web'}</span>`}</div>`;
  const pendTrail = (x) => (x.can_decide
    ? html`<span class="uf-dec"><${RoundBtn} ic="check" label=${t('uf_approve')} onClick=${() => decide(x, 'approved')} /><${RoundBtn} ic="x" cls="gray" label=${t('uf_reject')} onClick=${() => decide(x, 'rejected')} /></span>`
    : html`<span class="chip mango uf-kind">${t('uf_pending')}</span>`);
  return html`<main class="screen w2">
    <${W3Head} kicker=${kicker} title=${t('uf_title')}
      right=${canAdd && html`<button class="w3-plus" aria-label=${t('uf_add')} onClick=${() => openSheet('useful_add')}><${Icon} n="plus" cls="lg" /></button>`} />
    <div class="w3-chips" role="group">${UF_FILTERS.map((k) => html`<button key=${k} aria-pressed=${f === k ? 'true' : 'false'} onClick=${() => { hap.sel(); setF(k); }}>${t('uf_f_' + k)}</button>`)}</div>
    ${!v ? skel(220) : v.failed ? msgCard(t('err_generic')) : html`
      ${pending.length > 0 && html`<div class="card w2-list uf-pend"><div class="w2-lh"><span>${t(pending.some((x) => x.can_decide) ? 'uf_review' : 'uf_mine')}</span></div>
        ${pending.map((x) => row(x, pendTrail(x), [ufSub(x, nPlaces), x.can_decide && x.suggested_by_name ? t('uf_by', { name: firstName(x.suggested_by_name) }) : null].filter(Boolean).join(' · ')))}</div>`}
      ${UF_GROUPS.map((g) => ({ g, list: shown.filter((x) => ufGroup(x) === g) })).filter((x) => x.list.length).map(({ g, list }) => {
        // "Все": a long Telegram list folds to the first few (city chats first); the "Чаты" filter shows them all.
        const fold = g === 'telegram' && f === 'all' && !allTg && list.length > UF_FOLD;
        const vis = g === 'telegram' ? [...list.filter((x) => x.city), ...list.filter((x) => !x.city)] : list;
        return html`<div key=${g} class="card w2-list">
          <div class="w2-lh"><span>${t('uf_g_' + g)}</span></div>${(fold ? vis.slice(0, UF_FOLD) : vis).map((x) => row(x))}
          ${fold && html`<button class="w2-row uf-more" onClick=${() => { hap.sel(); setAllTg(true); }}><span class="grow">${t('uf_more', { n: list.length - UF_FOLD })}</span><${Icon} n="chevd" cls="sm muted" /></button>`}</div>`;
      })}
      ${!shown.length && !pending.length && msgCard(t('uf_none'))}`}
    ${guest ? html`<${GuestNav} tab="today" />` : html`<${Nav} tab=${typeof homeMode === 'function' && homeMode() ? 'more' : 'today'} />`}
  </main>`;
}
function UsefulAddSheet() {
  const d = D();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [about, setAbout] = useState('');
  const [cat, setCat] = useState('chats_rent');
  const [busy, setBusy] = useState(false);
  const region = S.regions?.[d.search.country]?.name?.[LANG] ?? '';
  const urlOk = /^@[A-Za-z0-9_]{4,}$/.test(url.trim()) || /^(https:\/\/|t\.me\/)\S+\.?\S*$/i.test(url.trim());
  async function save() {
    if (!name.trim() || !urlOk) return;
    setBusy(true);
    try {
      const r = await api('/app/api/useful-suggest', { search_id: d.search.id, name: name.trim(), url: url.trim(), about: about.trim() || null, category: cat });
      hap.ok();
      toast(t(r.link?.status === 'approved' ? 'uf_approved' : 'uf_sent'));
      delete ufCache[d.search.id];
      ufRev++;
      closeSheet();
      go(sp('useful'), true);
    } catch (e) {
      toast(e.code === 'useful_exists' ? t('uf_exists') : e.code === 'bad_url' ? t('uf_bad_url') : e.code === 'sensitive' ? e.message : e.code === 'rate_limited' ? t('uf_rate') : t('err_generic'));
    }
    setBusy(false);
  }
  const chip = (on, label, fn) => html`<button class=${'bchip' + (on ? ' on' : ' off')} aria-pressed=${on ? 'true' : 'false'} onClick=${() => { hap.sel(); fn(); }}>${label}</button>`;
  return html`<h2>${t('uf_add')}</h2>
    <div class="x-form">
      <p class="e-lbl">${t('uf_name')}</p><input class="e-input" value=${name} maxlength="80" placeholder=${t('uf_name_ph')} onInput=${(e) => setName(e.currentTarget.value)} />
      <p class="e-lbl">${t('uf_link')}</p><input class="e-input" value=${url} inputmode="url" autocapitalize="off" placeholder=${t('uf_link_ph')} onInput=${(e) => setUrl(e.currentTarget.value)} />
      <p class="e-lbl">${t('uf_about')}</p><input class="e-input" value=${about} maxlength="200" placeholder=${t('uf_about_ph')} onInput=${(e) => setAbout(e.currentTarget.value)} />
      <p class="e-lbl">${t('uf_cat')}</p><div class="chips">${UF_CATS.map((k) => chip(cat === k, t('uf_c_' + k), () => setCat(k)))}</div>
      <p class="muted uf-note">${t(d.me.role === 'owner' ? 'uf_note_owner' : 'uf_note', { r: region })}</p>
    </div>
    <button class="btn accent block" style="margin-top:14px" disabled=${busy || !name.trim() || !urlOk} onClick=${save}>${t(d.me.role === 'owner' ? 'uf_add_btn_owner' : 'uf_add_btn')}</button>
    <button class="btn ghost block" onClick=${closeSheet}>${t('cancel')}</button>`;
}

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
const OR = { sid: null, v: null, items: null, price_at: {}, pend: new Map(), at: 0, loading: null };
const ordSid = () => D()?.search?.id;
const ordReset = () => { if (OR.sid !== ordSid()) { OR.sid = ordSid(); OR.v = null; OR.items = null; OR.pend.clear(); OR.at = 0; } };
function ordApply(j) {
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
async function ordLoad(shop = false) {
  ordReset();
  const sid = OR.sid;
  const j = await api(`/app/api/${shop ? 'shop' : 'orders'}?s=${encodeURIComponent(sid)}`);
  if (OR.sid === sid) ordApply(j);
}
/** Orders (Home, status, history); `shop` also needs the catalog. Refreshes when the app comes back and every 25 s while open. */
function useOrders(shop = false) {
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
const ordSup = (id) => OR.v?.suppliers.find((s) => s.id === id) ?? null;
const ordItem = (id) => { for (const l of Object.values(OR.items ?? {})) { const x = l.find((i) => i.id === id); if (x) return x; } return null; };
const ordLast = (sup) => (OR.v?.history ?? []).filter((o) => o.status === 'delivered' && (!sup || o.supplier_id === sup)).sort((a, b) => String(b.delivered_at).localeCompare(String(a.delivered_at)))[0] ?? null;
const ordName = (x) => (LANG === 'ru' ? x?.ru ?? x?.name_ru : x?.en ?? x?.name_en) ?? '';
/** "Кальмар целый (чуми манис)" → "Кальмар целый". */
const ordShort = (x) => ordName(x).replace(/\s*\(.*?\)/g, '');
/** The one word behind the toy: the noun ("Красный снэппер" → "Снэппер", "Red snapper, whole" → "Snapper"). */
function ordWord(x) {
  const w = ordShort(x).split(/[,\d]/)[0].trim().split(/\s+/);
  return cap(LANG === 'ru' ? (w.length > 1 && /(ый|ий|ой|ая|яя|ое|ее|ые|ие)$/.test(w[0]) ? w[1] : w[0]) : w[w.length - 1]);
}
const ordCan = () => canVoteRole(D()?.me?.role) && !D()?.path?.closed;
/** The basket of a supplier with the taps that have not reached the server yet. */
function ordBasket(sup) {
  const b = OR.v?.baskets.find((x) => x.supplier_id === sup);
  let lines = (b?.lines ?? []).map((l) => (OR.pend.has(l.item_id) ? { ...l, qty: OR.pend.get(l.item_id).qty } : l));
  for (const [id, p] of OR.pend) {
    const it = ordItem(id);
    if (it?.sup === sup && !lines.some((l) => l.item_id === id)) lines.push({ item_id: id, qty: p.qty, by: D().user.id, unit: it.unit, step: it.step, toy: it.toy, grp: it.grp, name_id: it.name_id, name_ru: it.ru, name_en: it.en, price: it.price, unsure: it.unsure });
  }
  lines = lines.filter((l) => l.qty > 0);
  return { id: b?.id ?? null, supplier_id: sup, lines, ...ordTotals(lines) };
}
function ordTotals(lines) {
  let sum = 0, unknown = 0, unsure = 0;
  for (const l of lines) { if (l.price == null) unknown++; else { sum += Math.round(l.qty * l.price); if (l.unsure) unsure++; } }
  return { sum, unknown, unsure, count: lines.length };
}
const ordQty = (id) => OR.pend.get(id)?.qty ?? OR.v?.baskets.flatMap((b) => b.lines).find((l) => l.item_id === id)?.qty ?? 0;
/** Optimistic: the number changes at once, the server gets the last absolute quantity 350 ms after the last tap. */
function ordSetQty(item, qty) {
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
async function ordFlush(id, rec) {
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
const ordFlushAll = () => Promise.all([...OR.pend].map(([id, rec]) => rec.sent ?? ordFlush(id, rec)));
async function ordPost(act, body) {
  const j = await api('/app/api/order-' + act, { search_id: ordSid(), ...body });
  if (j.suppliers) ordApply(j);
  return j;
}
/** "Как в прошлый раз": the last delivered order (of `sup`), or exactly the order `oid` ("Повторить" on its receipt). */
async function ordAgain(sup, oid = null) {
  hap.impact('medium');
  try { const j = await ordPost('again', { ...(sup ? { supplier_id: sup } : {}), ...(oid ? { order_id: oid } : {}) }); go(sp('basket', j.supplier_id)); }
  catch (e) { toast(e.code === 'no_last_order' ? t('or_hist_none') : t('err_generic')); }
}

// ---- formatting
/** Prices keep their thousands: 2 500 → "2,5 тыс", 1 160 000 → "1,16 млн". */
function ordMoney(n, cur = 'IDR', unit = true) {
  if (n == null) return '';
  if (cur !== 'IDR') return money(n, cur, true);
  const f = (x, d) => new Intl.NumberFormat(LOC(), { maximumFractionDigits: d }).format(x);
  const sep = LANG === 'ru' ? ' ' : '';
  if (Math.abs(n) >= 1e6) return f(n / 1e6, 2) + (unit ? sep + t('or_mln') : '');
  return f(n / 1e3, 1) + (unit ? sep + t('or_thou') : '');
}
const ordNum = (n) => new Intl.NumberFormat(LOC(), { maximumFractionDigits: 2 }).format(n);
const ordQ = (unit, n) => t('or_q_' + (unit ?? 'pcs'), { n: ordNum(n) });
const ordBadge = (unit, n) => (unit === 'pcs' || unit === '30pcs' ? `×${ordNum(n)}` : ordQ(unit, n));
const ordUnit = (unit) => t('or_u_' + (unit ?? 'pcs'));
const ordPrice = (x, cur, short = false) => (x.price == null ? t(x.req ? 'or_by_req' : 'or_ask') : [ordMoney(x.price, cur), t((short ? 'or_su_' : 'or_u_') + (x.unit ?? 'pcs'))].filter(Boolean).join(' '));
const ordSum = (b, cur) => (b.sum ? `≈ ${ordMoney(b.sum, cur)}` : b.unknown ? t('or_ask') : '');
const ordDay = (day) => { if (!day) return ''; const n = hmDays(day); return n === 0 ? t('or_x_today') : n === 1 ? t('or_x_tomorrow') : fmtDM(day); };
const ordTab = (s) => (s.kind === 'fruit' || s.kind === 'fish' ? t('or_' + s.kind) : s.name);
const ordTone = (screen, arg) => {
  const sup = screen === 'shop' || screen === 'basket' || screen === 'order-check' ? ordSup(arg) ?? (arg ? null : OR.v?.suppliers[0]) : screen === 'good' ? ordSup(ordItem(arg)?.sup) : screen === 'order' ? ordSup([...(OR.v?.active ?? []), ...(OR.v?.history ?? [])].find((o) => o.id === arg)?.supplier_id) : null;
  return sup?.kind === 'fish' ? 'orders-sky' : 'orders';
};

// ---- "сколько приготовить денег": one range for the basket, the check and the order (mockup design/mockup-v5/range-*)
// Priced lines: by weight ×0.95…1.25, the rest ×1.00…1.15. A line without a price: the 25th…90th percentile of this supplier's known
// prices in the same group and unit × qty; none → it stays out and is named ("+ N без цены"). Delivery: free from min_free_delivery,
// else delivery_fee when known, else nothing. After 2 delivered orders with every price known the supplier's own history wins:
// price list × min(paid / list) × 0.97 … × max × 1.03 (delivery is inside what was paid). No amount is hard-coded: any currency.
const RG_KG = [0.95, 1.25], RG_PCS = [1, 1.15], RG_ASK = [0.25, 0.9], RG_LEARN = [0.97, 1.03], RG_LEARN_MIN = 2;
const rgPct = (xs, p) => { const i = (xs.length - 1) * p, a = Math.floor(i), b = Math.min(a + 1, xs.length - 1); return xs[a] + (xs[b] - xs[a]) * (i - a); };
const rgMed = (xs) => rgPct([...xs].sort((a, b) => a - b), 0.5);
const RG_BANDS = new WeakMap();
/** Known prices of a supplier's catalog by group and unit → [p25, p90] (unsure prices are typos and stay out); null without the catalog. */
function ordBands(sup) {
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
function ordRatios(s, o = null) {
  const rs = s?.ratios ?? [];
  if (!o || o.status !== 'delivered') return rs.map((r) => r[1]);
  return rs.filter((r) => r[0] !== o.id && String(r[2] ?? '') < String(o.delivered_at ?? '')).map((r) => r[1]);
}
/**
 * The range of lines (a basket or an order's snapshot) at supplier `s`: {lo, hi} rounded outwards, and the parts the receipt explains.
 * `o` = the order when it is not the basket (a delivered one looks only at earlier orders). null when nothing can be estimated.
 */
function ordSpread(lines, s, o = null) {
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
function ordRangeTxt(lo, hi, cur = 'IDR') {
  const f = (x, d) => new Intl.NumberFormat(LOC(), { minimumFractionDigits: d, maximumFractionDigits: d }).format(x);
  const [k, d, u] = hi >= 1e6 ? [1e6, 1, t('or_mln')] : hi >= 1e4 ? [1e3, 0, t('or_thou')] : [1, 0, ''];
  const a = f(lo / k, d), b = f(hi / k, d);
  const sym = cur !== 'IDR' ? SYM[cur] ?? cur : '';
  return { n: a === b ? a : `${a}–${b}`, u: [u, sym].filter(Boolean).join(' '), big: k > 1 };
}
/** One line: "1,0–1,6 млн" (en "1.0–1.6M", as ordMoney writes units). */
const ordRangeStr = (lo, hi, cur) => { const r = ordRangeTxt(lo, hi, cur); return r.u ? r.n + (LANG === 'ru' || !r.big ? ' ' : '') + r.u : r.n; };
/** Every digit: "836 500" (+ the symbol outside rupiah). */
const ordFull = (n, cur = 'IDR') => ordNum(Math.round(n)) + (cur !== 'IDR' ? ' ' + (SYM[cur] ?? cur) : '');
/** "+10%", "−4%". */
const ordPctTxt = (r) => { const p = Math.round((r - 1) * 100); return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)}%`; };
/** "ананас и кокосы", "рис, сыр, соус и ещё 2". */
function ordNames(lines, max) {
  const ns = lines.map((l) => { const x = ordName(l).split(/[,(]/)[0].trim(); return x.charAt(0).toLocaleLowerCase(LOC()) + x.slice(1); });
  if (ns.length <= max) return ns.length > 1 ? t('or_and', { a: ns.slice(0, -1).join(', '), b: ns[ns.length - 1] }) : ns[0] ?? '';
  return t('or_and_more', { a: ns.slice(0, max).join(', '), n: ns.length - max });
}
/** The breakdown under the range on the receipt: up to 4 rows. */
function ordSpreadRows(sp) {
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
function ordSpreadWhy(sp) {
  if (sp.learn) return [sp.est ? t('or_rg_w_list', { x: ordFull(sp.est, sp.cur) }) : null, t('or_rg_w_learn', { p: ordPctTxt(sp.learn.med) }), sp.ask.lines.length ? t('or_rg_ask', { t: ordNames(sp.ask.lines, 2) }) : null].filter(Boolean).join(', ');
  return [sp.est ? t('or_rg_w_list', { x: ordFull(sp.est, sp.cur) }) : null, sp.kg.n ? t('or_rg_w_kg') : null, sp.ask.lines.length ? t('or_rg_ask', { t: ordNames(sp.ask.lines, 2) }) : null,
    sp.deliv ? (sp.deliv.free ? t('or_free_ok') : t('or_rg_w_fee', { x: ordFull(sp.deliv.fee, sp.cur) })) : null].filter(Boolean).join(', ');
}

// ---- pieces
const TOY_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const goodFail = (e) => { const im = e.currentTarget; im.onerror = null; im.removeAttribute('srcset'); if (!im.src.endsWith('/goods/sack-192.webp')) im.src = '/goods/sack-192.webp'; }; // a missing picture = the grocery sack
/** A goods toy (/goods/<slug>-192|384|768.webp, design/art/goods): decorative, the name is always next to it. */
function Good({ slug, size = 96, rot = 0, cls = '', shadow = true, big = false }) {
  const s = TOY_RE.test(slug ?? '') ? slug : 'sack';
  return html`<span class=${`good ${shadow ? '' : 'flat '}${cls}`} style=${`--gs:${size}px;--gr:${rot}deg`} aria-hidden="true"><img src=${`/goods/${s}-${big || size > 96 ? 384 : 192}.webp`}
    srcset=${`/goods/${s}-192.webp 192w, /goods/${s}-384.webp 384w${big ? `, /goods/${s}-768.webp 768w` : ''}`} sizes=${`${size}px`} alt="" loading=${big ? 'eager' : 'lazy'} decoding="async" draggable="false" onError=${goodFail} /></span>`;
}
const ordRot = (i) => [-8, 7, -8, 10, 9, -6, 5, 9, -11, 8][i % 10];
function OrdTabs({ cur }) {
  const list = OR.v?.suppliers ?? [];
  return html`<div class="or-tabs"><${BackRound} /><div class="or-pills" role="group" aria-label=${t('or_title')}>
    ${list.map((s) => html`<button key=${s.id} class="or-pill" aria-pressed=${cur === s.id ? 'true' : 'false'} onClick=${() => { if (cur !== s.id) { hap.sel(); go(sp('shop', s.id), true); } }}>${ordTab(s)}</button>`)}
    <button class="or-pill" aria-pressed=${cur === 'services' ? 'true' : 'false'} onClick=${() => { if (cur !== 'services') { hap.sel(); go(sp('shop', 'services'), true); } }}>${t('or_services')}</button>
  </div></div>`;
}
/** The black bar at the bottom: what is in the basket and the next step. */
function OrdCart({ sup, cta, onGo }) {
  const b = ordBasket(sup);
  if (!b.count) return null;
  const s = ordSup(sup);
  const sp = ordSpread(b.lines, s);
  return html`<div class="or-cart" role="region" aria-label=${t('or_receipt')}><span class="grow" aria-live="polite">${[t('or_pos', { n: b.count }), sp ? ordRangeStr(sp.lo, sp.hi, sp.cur) : ordSum(b, s?.currency)].filter(Boolean).join(' · ')}</span>
    <button class="or-cart-go" onClick=${onGo}>${cta}<${Icon} n="arrow-right" cls="sm" /></button></div>`;
}
function Qty({ item, qty, name, small = false }) {
  const st = item.step || 1;
  const last = qty > 0 && qty - st <= 0;
  return html`<span class=${'or-qty' + (small ? ' sm' : '') + (qty ? ' on' : '')}>
    ${qty > 0 && html`<button aria-label=${t(last ? 'or_remove' : 'or_less', { t: name }) + (last ? '' : ': ' + name)} onClick=${(e) => { e.stopPropagation(); ordSetQty(item, qty - st); }}><${Icon} n=${last ? 'trash-2' : 'minus'} cls="sm" /></button><b aria-live="polite">${ordQ(item.unit, qty)}</b>`}
    <button class="plus" aria-label=${t('or_add', { t: name })} onClick=${(e) => { e.stopPropagation(); ordSetQty(item, qty + st); }}><${Icon} n="plus" cls="sm" /></button></span>`;
}
/** "ещё 108 тыс до бесплатной доставки" */
function FreeBar({ sum, s }) {
  if (!s?.min_free_delivery) return null;
  const left = Math.max(0, s.min_free_delivery - sum);
  return html`<div class="or-free"><span>${left ? t('or_free_left', { x: ordMoney(left, s.currency) }) : t('or_free_ok')}</span>
    <i class="or-free-bar" role="progressbar" aria-valuemin="0" aria-valuemax=${s.min_free_delivery} aria-valuenow=${Math.min(sum, s.min_free_delivery)} aria-label=${t('or_delivery')}><b style=${`width:${Math.min(100, Math.round((sum / s.min_free_delivery) * 100))}%`}></b></i></div>`;
}
/**
 * The printed receipt: the basket (edit) and every order afterwards (the status screen, the expense in Деньги). White paper with a
 * torn edge in both themes; toys hang over its left edge.
 */
function Receipt({ o, edit = false, s = null, date = null, slot = true, print = false, head = null, children }) {
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
function OrdSpread({ sp, paper = false, caret = false, bare = false }) {
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
function OrdFact({ o, s }) {
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
function ordShelf(sup) {
  const all = OR.items?.[sup] ?? [];
  const usual = all.filter((x) => x.fav >= (OR.usual ?? 2)).sort((a, b) => b.fav - a.fav || (a.top ?? 99) - (b.top ?? 99)).slice(0, 8);
  const pop = all.filter((x) => x.top && !usual.includes(x)).sort((a, b) => a.top - b.top);
  return { list: [...usual, ...pop].slice(0, 8), usual: usual.length };
}
let ordGrp = {}; // supplier → the group the pills jumped to
function ShopScreen({ arg }) {
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
function GoodScreen({ id }) {
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
function BasketScreen({ id }) {
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
function OrderCheck({ id }) {
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
const ACTIVE_OR = ['opened', 'draft', 'sent', 'confirmed'];
const ordFind = (id) => [...(OR.v?.active ?? []), ...(OR.v?.history ?? [])].find((o) => o.id === id) ?? null;
function OrderScreen({ id }) {
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
function ordAmount(s, cur) {
  const n = parseAmount(s);
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  return cur === 'IDR' && n < 10000 ? Math.round(n * 1000) : Math.round(n);
}
/** Prefilled in the field's unit (thousands for rupiah). */
const ordField = (n, cur) => (n ? String(cur === 'IDR' ? n / 1000 : n).replace('.', LANG === 'ru' ? ',' : '.') : '');
function OrdConfSheet({ o }) {
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
function OrdPaidSheet({ o }) {
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
function OrderReceiptOf({ id }) {
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
const SET_WD = { ru: ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'], en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] };
const setWd = (i) => (SET_WD[LANG] ?? SET_WD.en)[i];
/** Sets of a supplier (or all of them), in the order they were made. */
const ordSets = (sup) => (OR.v?.sets ?? []).filter((x) => !sup || x.supplier_id === sup);
/** What goes into the basket: items the supplier still lists. */
const setLines = (st) => st.lines.filter((l) => !l.gone);
/** "по пн, чт", "раз в 2 недели, пн", "" without a reminder. */
function setRepeatTxt(st) {
  if (st.repeat === 'none' || !st.days) return '';
  const d = [0, 1, 2, 3, 4, 5, 6].filter((i) => st.days & (1 << i)).map(setWd).join(', ');
  return t(st.repeat === 'biweekly' ? 'st_rep_b' : 'st_rep_w', { d });
}
/** Mirrors src/order-sets.ts nameKey / defaultSetName. */
const setKey = (s) => String(s ?? '').toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
function setDefaultName(su) {
  const base = (su?.kind === 'fruit' ? t('st_def_fruit') : su?.kind === 'fish' ? t('st_def_fish') : t('st_def_other', { s: su?.name ?? '' })).slice(0, 40);
  const taken = new Set(ordSets().map((x) => setKey(x.name)));
  let name = base;
  for (let n = 2; taken.has(setKey(name)) && n < 100; n++) name = `${base.slice(0, 40 - String(n).length - 1)} ${n}`;
  return name;
}
/** Live prices for lines of a set or an old order (items no longer listed drop out); as they are without the catalog. */
const setLive = (lines) => (OR.items ? lines.map((l) => { const it = ordItem(l.item_id); return it ? { ...l, price: it.price, unsure: it.unsure, toy: it.toy ?? l.toy } : null; }).filter(Boolean) : lines.filter((l) => !l.gone));
async function setApply(st) {
  hap.impact('medium');
  try {
    await ordFlushAll();
    const j = await ordPost('set-apply', { set_id: st.id });
    closeSheet();
    toast(j.gone ? `${t('st_added')}. ${t('st_gone_n', { n: j.gone })}` : t('st_added'));
    go(sp('basket', j.supplier_id));
  } catch (e) { toast(e.code === 'set_empty' ? t('st_empty') : e.code === 'too_many_lines' ? t('err_generic') : e.code === 'no_set' ? t('st_gone') : t('err_generic')); }
}
async function ordRestore(oid) {
  try { await ordPost('restore', { order_id: oid }); hap.ok(); toast(t('st_restored')); }
  catch (e) { toast(e.code === 'restore_expired' || e.code === 'nothing_to_restore' ? t('st_restore_late') : t('err_generic')); }
}
/** The repeat chips, the weekdays and the time; `onChange({repeat, days, time})` with only what changed. */
function SetRepeat({ repeat, days, time, can = true, onChange }) {
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
function SetTile({ st, cur }) {
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
function SetRows({ sup }) {
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
function OrdClearSheet({ sup }) {
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
function OrdSaveSheet({ arg }) {
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
function OrdSetSheet({ id }) {
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
function SetApplyScreen({ id }) {
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
function OrdersScreen() {
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
const svOk = (c) => ['cleaning', 'pool', 'garden', 'other'].includes(c.role);
const SV_RE = /massage|массаж|pijat|clean|уборк|pool|бассейн|laundry|прач|стирк|garden|сад/i;
const SV_WD = [['sun', 'su', 'вс', 'воскр', 'minggu'], ['mon', 'mo', 'пн', 'понед', 'senin'], ['tue', 'tu', 'вт', 'вторн', 'selasa'], ['wed', 'we', 'ср', 'сред', 'rabu'], ['thu', 'th', 'чт', 'четв', 'kamis'], ['fri', 'fr', 'пт', 'пятн', 'jumat'], ['sat', 'sa', 'сб', 'субб', 'sabtu']];
/** "вт, пт" / "Tue, Fri" → [2, 5]; anything that is not a list of weekdays → null (nothing is invented). */
function svDays(s) {
  const parts = String(s ?? '').toLowerCase().split(/[,;/]| и | and /).map((x) => x.trim().replace(/\.$/, '')).filter(Boolean);
  if (!parts.length) return null;
  const out = parts.map((p) => SV_WD.findIndex((k) => k.some((y) => p === y || (y.length > 2 && p.startsWith(y)))));
  return out.includes(-1) ? null : [...new Set(out)];
}
function svNext(days) {
  if (!days?.length) return null;
  const wd = asDate(hmToday()).getUTCDay();
  const n = Math.min(...days.map((x) => (x - wd + 7) % 7));
  return { n, wd: (wd + n) % 7, day: addDays(hmToday(), n) };
}
const svCost = (c, sep = ' ') => (c.cost ? `${ordMoney(c.cost, c.currency ?? 'IDR')}${sep}${t('or_per_' + (c.period ?? 'visit'))}` : c.payer === 'rent' ? t('or_sv_rent') : '');
const svToy = (c) => (c.role === 'pool' || /pool|бассейн/i.test(c.subtitle ?? '') ? 'ring' : /massage|массаж|pijat/i.test(`${c.name} ${c.subtitle ?? ''} ${c.note ?? ''}`) ? 'flower' : 'spray');
function ServicesScreen() {
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
function OrderTicket({ o }) {
  const st = { opened: 1, draft: 1, sent: 1, confirmed: 2 }[o.status] ?? 1;
  const sub = [o.total ? (o.time ? ordMoney(o.total, o.currency) : t('or_tk_x', { x: ordMoney(o.total, o.currency) })) : o.supplier, o.time ? `${o.day && hmDays(o.day) !== 0 ? ordDay(o.day) + ' ' : ''}${t('or_tk_by', { t: hm(o.time) })}` : null].filter(Boolean).join(' · ');
  return html`<button class="or-ticket" onClick=${() => { hap.sel(); go(sp('order', o.id)); }}><span class="or-ticket-art"><${Good} slug="scooter" size=${118} rot=${-6} shadow=${false} /></span>
    <span class="grow"><b>${t('or_tk_' + o.status)}</b><span>${sub}</span><i class="or-seg" aria-hidden="true">${[0, 1, 2].map((k) => html`<u class=${k < st ? 'on' : ''}></u>`)}</i></span><span class="or-ticket-go"><${Icon} n="arrow-up-right" cls="sm" /></span></button>`;
}
function OrderHome() {
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
const ordSupOfDir = (dirId) => (OR.v?.suppliers ?? []).find((s) => s.dir_entry_id && s.dir_entry_id === dirId) ?? null;

function Sheet() {
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
    view = {
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
    }[route.screen]?.() ?? html`<${Today} />`;
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
(demoOn ? demoRegions() : fetch('/art/regions.json').then((r) => r.json())).then((j) => { S.regions = j; if (S.data?.search) applyRegion(S.data.search.country); emit(); }).catch(() => null);
render(html`<${App} />`, document.getElementById('root'));

// for desk.js (a circular import: used only while rendering)
export {
  genRu, isGuest, Nav,
  BackRound, copyText, shortLabel, channelLink, closeSheet, authHeaders,
  S, D, LANG, t, api, emit, toast, hap, go, sp, back, refresh, load, openSheet, openLink, pref, inTG, isDark, cssVar, Icon, Av, BigWord, Typed, Sticker, FloatPhoto, WaterCard, CountUp, Good, Receipt, TkPhoto, Img, money, scaled, bigMoney, dfmt, fmtTime, fmtDM, fmtDayMonth, wdShort, dayKey, cap, firstName, shortTitle, pl, skel, msgCard, listingById, memberById, votesFor, myVote, vote, photosOf, photoUrl, districtShort, districtName, priceText, minutesFor, km, interestOf, canVoteRole, isNewForMe, homeMode, homeListing, homePhase, homeStage, hmStay, hmDays, hmToday, hmName, useEventPlan, useSurf, surfBest, sfH, hm, briefMentionsSurf, nightMode, sortedThreads, thArchived, chArchRoute, homeThreads, archThreads, archNew, homeRow, waitingUs, channelsOf, contactName, channelName, useAfisha, AF, afTitle, afHM, afPlace, afPrice, afLang, afWhy, afTravel, afDay, afDayLong, afFeedback, afBook, afIcon, afArea, useOrders, ordSup, ordShelf, ordBasket, ordSetQty, ordName, ordShort, ordPrice, ordBadge, ordRot, ordTab, ordCan, ordAgain, ordLast, ordMoney, ordFlushAll, viewingsByDay, regionPack, subRegion, loadML, mapStyle, inviteFriends, docTitle, docSub, dealPaid, vStatus,
};
