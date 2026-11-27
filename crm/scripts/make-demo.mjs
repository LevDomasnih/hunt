#!/usr/bin/env node
// Records the site's demo (public/demo-home/demo.json): an invented project on a throwaway local server, seeded through the real agent
// API, then every answer the big screen asks for is saved. Nobody in it is real; the homes are toys (design/art/homes).
//   node scripts/make-demo.mjs        Dates are shifted to "today" in the browser (public/demo.js).
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toEnglish } from './demo-en.mjs';

const crm = join(dirname(fileURLToPath(import.meta.url)), '..'), dir = mkdtempSync(join(tmpdir(), 'hunt-demo-'));
const PORT = 8793, BASE = `http://127.0.0.1:${PORT}`, cfg = join(dir, 'wrangler.toml');
writeFileSync(cfg, readFileSync(join(crm, 'wrangler.toml'), 'utf8').replace(/database_name = "[^"]*"/, 'database_name = "t"').replace(/database_id = "[^"]*"/, 'database_id = "local"').replace(/^id = "[^"]*"/m, 'id = "local"')
  .replace('main = "src/index.ts"', `main = "${crm}/src/index.ts"`).replace('migrations_dir = "migrations"', `migrations_dir = "${crm}/migrations"`).replace('directory = "./public"', `directory = "${crm}/public"`));
const CFG = ['--config', cfg, '--persist-to', join(dir, 'db')];
const wr = (a) => execFileSync('npx', ['--no-install', 'wrangler', ...a], { cwd: crm, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sqlFile = join(dir, 'q.sql');
const exec = (q) => { writeFileSync(sqlFile, q); wr(['d1', 'execute', 't', '--local', ...CFG, '--file', sqlFile]); };
const sleep = (ms) => new Promise((f) => setTimeout(f, ms)), H = (t) => createHash('sha256').update(t).digest('hex');
writeFileSync(join(dir, 'vars'), `TG_BOT_TOKEN=000:fake\nTG_WEBHOOK_SECRET=h\nSETUP_KEY=s\nLINK_SECRET=l\nPUBLIC_URL=${BASE}\nBOT_USERNAME=demo_bot\n`);
wr(['d1', 'migrations', 'apply', 't', '--local', ...CFG]);
const T0 = new Date(Date.now() - 12 * 864e5).toISOString(), P = [['masha', 'Маша'], ['oleg', 'Олег'], ['anya', 'Аня']];
exec(P.map(([n, name], i) => `INSERT INTO users (id, tg_user_id, display_name, lang, created_at) VALUES ('u_${n}',${9000 + i},'${name}','ru','${T0}');`).join('\n') + `\nINSERT INTO hunters (user_id, is_admin, created_at) VALUES ('u_oleg',0,'${T0}');\nINSERT INTO tokens (hash, user_id, label, created_at) VALUES ('${H('tok')}','u_oleg','t','${T0}');`);
const dev = spawn('npx', ['--no-install', 'wrangler', 'dev', ...CFG, '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', '9793', '--env-file', join(dir, 'vars'), '--show-interactive-dev-session=false'], { cwd: crm, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let log = ''; dev.stdout.on('data', (d) => (log += d)); dev.stderr.on('data', (d) => (log += d));
try {
  for (let i = 0; ; i++) { if (await fetch(`${BASE}/health`).then((r) => r.ok, () => false)) break; if (i > 200) throw new Error('no server ' + log.slice(-500)); await sleep(300); }
  const api = async (m, path, b) => { const r = await fetch(BASE + path, { method: m, headers: { authorization: 'Bearer tok', 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json().catch(() => null); if (!r.ok) throw new Error(`${m} ${path} ${r.status} ${JSON.stringify(j)}`); return j; };
  const OFF = 8, now = Date.now(), day = (n) => new Date(now + OFF * 36e5 + n * 864e5).toISOString().slice(0, 10), at = (n, t) => `${day(n)}T${t}:00+08:00`, ago = (min) => new Date(now - min * 6e4).toISOString();
  const photo = (k) => JSON.stringify([{ url: `/demo-home/${k}.webp` }]);
  // ---- living
  const HM = (await api('POST', '/api/searches', { title: 'Букит, дом с крышей', region: 'bali/bukit', brief: { currency: 'IDR', timezone: 'Asia/Makassar', nice_to_have: 'сёрф', travel_kmh: 25 } })).search.id;
  const SR = (await api('POST', '/api/searches', { title: 'Букит', region: 'bali/bukit', approval_mode: 'ask', brief: { currency: 'IDR', timezone: 'Asia/Makassar', bedrooms: ['2'], budget_cap: 24000000, move_in: day(46), travel_kmh: 25, anchor: { label: 'Бингин', lat: -8.8057, lng: 115.1133, icon: 'waves' }, nice_to_have: 'сёрф' } })).search.id;
  exec([HM, SR].flatMap((s) => P.slice(0, 1).map(([n]) => `INSERT OR IGNORE INTO members (search_id, user_id, role) VALUES ('${s}','u_${n}','member');`)).join('\n'));
  await api('PUT', `/api/searches/${HM}/listings/home-roof`, { title: 'Дом с крышей', price: 22000000, currency: 'IDR', bedrooms: 2, district: 'ungasan', area_text: 'Унгасан', lat: -8.8266, lng: 115.1601, status: 'taken' });
  await api('PATCH', '/api/listings/home-roof', { short_name: 'Дом с крышей', decision: 'take' });
  await api('PUT', '/api/deals/home-roof', { name: 'Дом с крышей', terms: { type: 'lease', from: day(-8), to: day(111), rent: 22000000, deposit: 22000000, currency: 'IDR' }, checklist: [{ text: 'Снять видео дома', done: true }, { text: 'Счётчик света', done: true }],
    dates: [{ date: day(-9), kind: 'payment', title: 'Первый месяц', amount: 22000000, currency: 'IDR', done: true }, { date: day(22), kind: 'payment', title: 'Платёж хозяину', amount: 22000000, currency: 'IDR' }, { date: day(80), kind: 'notice', title: 'Сказать, остаёмся ли' }, { date: day(118), kind: 'deposit_return', title: 'Вернут залог', amount: 22000000, currency: 'IDR' }] });
  await api('PATCH', `/api/searches/${HM}`, { status: 'living' });
  const me = 'u_oleg';
  for (const [title, amount, paid_by, kind, n] of [['Токен на свет', 500000, 'u_masha', 'power', -7], ['Продукты на неделю', 1240000, me, 'food', -6], ['Байк на месяц', 1500000, me, 'transport', -5], ['Ужин у моря', 640000, 'u_masha', 'food', -3], ['Бассейн', 450000, me, 'pool', -2], ['Кофе и круассаны', 96000, 'u_masha', 'food', -1], ['Завтрак на пляже', 192000, me, 'food', 0]]) await api('POST', `/api/searches/${HM}/expenses`, { title, amount, currency: 'IDR', paid_by, kind, date: day(n), listing_id: 'home-roof' });
  await api('POST', `/api/searches/${HM}/power`, { kind: 'reading', kwh: 92, at: ago(5 * 1440) }); await api('POST', `/api/searches/${HM}/power`, { kind: 'reading', kwh: 38, at: ago(30) });
  await api('PUT', '/api/issues/new', { search_id: HM, title: 'Мастер, бойлер', status: 'scheduled', scheduled_at: at(0, '23:00') });
  await api('PUT', `/api/searches/${HM}/bikes/new`, { model: 'Scoopy, красный', rider_id: me, price: 1500000, currency: 'IDR', period: 'month', paid_until: day(6) });
  for (const [kind, title, extra] of [['lease', 'Договор аренды', { status: 'have', signed_at: day(-9), pages: 6, summary: { sections: [{ icon: 'calendar', title: 'Срок', text: '4 месяца' }, { icon: 'wallet', title: 'Оплата', text: '22 млн, раз в месяц' }] } }], ['receipt', 'Чек за первый месяц', { status: 'have', doc_date: day(-9), pages: 1 }], ['other', 'Опись вещей', { status: 'have', doc_date: day(-8), pages: 4 }], ['movein_video', 'Видео дома при заезде', { status: 'have', doc_date: day(-8) }], ['owner_consent', 'Согласие хозяина на гостей', { status: 'request' }]]) await api('PUT', '/api/documents/new', { listing_id: 'home-roof', kind, title, ...extra });
  const EN_GOODS = { 'Air galon': 'Water 19 l', 'Kelapa muda': 'Young coconut', Mangga: 'Mango', Pisang: 'Bananas', Alpukat: 'Avocado', Tomat: 'Tomatoes', 'Buah naga': 'Dragon fruit', Gas: 'Gas 12 kg', Jahe: 'Ginger', 'Bawang putih': 'Garlic', Telur: 'Eggs', Jamur: 'Mushrooms', Terong: 'Eggplant', Brokoli: 'Broccoli' };
  const su = (await api('PUT', `/api/searches/${HM}/suppliers/new`, { name: 'Рынок', kind: 'fruit', channel: 'whatsapp', address: '+6281200000044', hours: '08:00-20:00', min_free_delivery: 300000 })).supplier.id;
  const items = [['Air galon', 'Вода 19 л', 'pcs', 22000, 'water', 1], ['Kelapa muda', 'Молодой кокос', 'pcs', 18000, 'coconut', 2], ['Mangga', 'Манго', 'kg', 38000, 'mango', 3], ['Pisang', 'Бананы', 'kg', 25000, 'banana', 4], ['Alpukat', 'Авокадо', 'kg', 45000, 'avocado', 5], ['Tomat', 'Помидоры', 'kg', 22000, 'tomato', 6], ['Buah naga', 'Питахая', 'kg', 35000, 'dragon-fruit-red', 7], ['Gas', 'Газ 12 кг', 'pcs', null, 'gas', 8], ['Jahe', 'Имбирь', 'kg', 40000, 'ginger', null], ['Bawang putih', 'Чеснок', 'kg', 44000, 'garlic', null], ['Telur', 'Яйца', '30pcs', 62000, 'egg', null], ['Jamur', 'Шампиньоны', 'kg', 52000, 'button-mushrooms', null], ['Terong', 'Баклажаны', 'kg', 21000, 'eggplant-purple', null], ['Brokoli', 'Брокколи', 'kg', 34000, 'broccoli', null]];
  await api('POST', `/api/searches/${HM}/suppliers/${su}/import`, { items: items.map(([name_id, name_ru, unit, price, toy, top], i) => ({ name_id, name_ru, name_en: EN_GOODS[name_id], grp: i < 8 ? 'fruit' : 'veg', unit, price, toy, top, by_request: price == null })), price_at: day(-2) });
  const ev = (o) => ({ country: 'bali', area: 'uluwatu', currency: 'IDR', lang: 'en', booking: 'message', organizer_channel: 'instagram', organizer_address: 'demo', source_kind: 'place', source_url: 'https://example.com/demo', source_name: 'demo', place_name: 'Букит', lat: -8.81, lng: 115.11, quality: 0.9, ...o });
  await api('POST', '/api/events', [
    ev({ title: 'Урок сёрфа для новичков', about_ru: 'Доска и тренер, мелкая волна', category: 'sport', topic: 'surf', starts_at: at(2, '15:00'), price_kind: 'paid', price: 300000, beginner: true, place_name: 'Пляж Кута', lat: -8.718, lng: 115.169 }),
    ev({ title: 'Ночной рынок', about_ru: 'Еда из сорока лавок', category: 'food', starts_at: at(0, '23:30'), price_kind: 'free', booking: 'none', lang: 'none', place_name: 'Джимбаран', lat: -8.79, lng: 115.165 }),
    ev({ title: 'Падел вчетвером', about_ru: 'Ищут двоих на вечер', category: 'social_sport', topic: 'padel', starts_at: at(1, '19:00'), price_kind: 'paid', price: 150000, place_name: 'Унгасан', lat: -8.83, lng: 115.17 }),
    ev({ title: 'Кечак на закате', about_ru: 'Огонь и сто голосов над морем', category: 'culture', topic: 'kecak', starts_at: at(1, '18:00'), price_kind: 'paid', price: 150000, lang: 'none', place_name: 'Улувату', lat: -8.829, lng: 115.085 }),
    ev({ title: 'Йога на рассвете', about_ru: 'Час практики и кофе', category: 'wellness', topic: 'yoga', starts_at: at(3, '07:00'), price_kind: 'paid', price: 120000, lang: 'ru', place_name: 'Бингин', lat: -8.806, lng: 115.113 }),
    ev({ title: 'Джаз во дворе', about_ru: 'Трио и вино из Негары', category: 'music', starts_at: at(4, '20:00'), price_kind: 'free', booking: 'none', place_name: 'Печату', lat: -8.82, lng: 115.12 })]);
  // ---- search
  const homes = [['villa-field', 'Вилла у поля', 22000000, 'uluwatu', 'Печату', -8.832, 115.128, 'field'], ['loft-bingin', 'Лофт у Бингина', 18000000, 'uluwatu', 'Бингин', -8.806, 115.1045, 'loft'], ['round-house', 'Круглый дом', 23000000, 'ungasan', 'Унгасан', -8.829, 115.166, 'round'], ['stilt-house', 'Дом на сваях', 24000000, 'jimbaran', 'Джимбаран', -8.793, 115.171, 'stilt'], ['roof-two', 'Дом с террасой', 26000000, 'nusa_dua', 'Нуса-Дуа', -8.805, 115.215, 'roof']];
  for (const [id, title, price, , area, lat, lng] of homes) await api('PUT', `/api/searches/${SR}/listings/${id}`, { title, price, currency: 'IDR', bedrooms: 2, area_text: area, lat, lng, fields: { pool: 'private', internet_mbps: 100, electricity: 'included' }, summary: 'Свет и сад' });
  exec(homes.map(([id, , , , , , , k]) => `UPDATE listings SET photos='${photo(k)}' WHERE id='${id}';`).join('\n') + `\nUPDATE listings SET photos='${photo('roof')}' WHERE id='home-roof';`
    + [['surf', 'Урок сёрфа%'], ['market', 'Ночной рынок'], ['padel', 'Падел%']].map(([k, n]) => `\nUPDATE afisha SET photo_url='https://demo.local/ev-${k}.webp', photo_score=0.9, photo_credit='CC0' WHERE title LIKE '${n}';`).join(''));
  for (const [id, , , , , , , ] of homes.slice(0, 4)) await api('PUT', `/api/listings/${id}/flood`, { level: id === 'loft-bingin' ? 'medium' : 'low', summary: 'ok', sources: [] });
  await api('PUT', '/api/listings/villa-field/checks', { verdict: 'ok', signals: [{ status: 'ok', title: 'Фото не повторяются' }] });
  const ppl = {};
  for (const [k, name, id, ch, addr] of [['wayan', 'Wayan', 'villa-field', 'whatsapp', '+6281200000033'], ['ketut', 'Ketut', 'stilt-house', 'whatsapp', '+6281200000055'], ['made', 'Made', 'round-house', 'telegram', '@made_demo'], ['nyoman', 'Nyoman', 'loft-bingin', 'telegram', '@nyoman_demo'], ['putu', 'Putu', 'roof-two', 'instagram', 'putu_demo']]) {
    ppl[k] = (await api('PUT', '/api/contacts/new', { name, role: 'owner', lang: 'id', channels: [{ channel: ch, address: addr }] })).contact.id;
    await api('POST', `/api/contacts/${ppl[k]}/link`, { listing_id: id, role: 'owner' });
  }
  const th = (k, listing_id, state, last, min, known, open) => api('PUT', '/api/threads', { search_id: SR, contact_id: ppl[k], listing_id, state, last, last_at: ago(min), known, open });
  await th('wayan', 'villa-field', 'waiting_us', 'Ок, 22, если въезжаете десятого', 14, 'Бассейн, сад, 12 минут до сёрфа', 'Бассейн чистят?\nСвет до какого лимита?\nСоседи с собакой?');
  await th('ketut', 'stilt-house', 'waiting_us', 'Могу показать завтра в 13:30', 66, 'Две спальни над морем', 'Интернет какой?');
  await th('made', 'round-house', 'waiting_them', 'Скоро отвечу', 100, null, null); await th('nyoman', 'loft-bingin', 'waiting_them', 'Спрошу хозяина', 300, null, null); await th('putu', 'roof-two', 'closed', 'Уже сдали', 2800, null, null);
  const ms = (k, id, a) => api('POST', '/api/messages', a.map(([dir, min, tr, text], i) => ({ channel: k === 'made' || k === 'nyoman' ? 'telegram' : 'whatsapp', direction: dir, text, tr, at: ago(min), external_id: `${k}${i}`, search_id: SR, contact_id: ppl[k], listing_id: id })));
  await ms('wayan', 'villa-field', [['in', 59, 'Свободен с десятого, 25 миллионов', 'Kosong mulai tanggal 10, 25 juta kak'], ['out', 56, 'Нас двое на полтора месяца. Можно дешевле?', 'Kami berdua 1,5 bulan. Bisa kurang?'], ['in', 48, '24 последняя', '24 terakhir kak'], ['out', 21, 'Даём 22, платим сразу', 'Kami tawar 22, bayar langsung'], ['in', 14, 'Ок, 22 миллиона, если въезжаете десятого', '22 juta boleh, kalau masuk tanggal 10']]);
  await ms('ketut', 'stilt-house', [['out', 90, 'Здравствуйте! Дом свободен с января?', 'Halo! Rumahnya kosong mulai Januari?'], ['in', 66, 'Да, могу показать завтра в 13:30', 'Iya, besok jam 13.30 bisa lihat']]);
  await ms('made', 'round-house', [['out', 100, 'Здравствуйте! Сколько за полтора месяца?', 'Halo! Berapa untuk satu setengah bulan?']]);
  for (const [n, t, id, st, note] of [[1, '10:00', 'villa-field', 'proposed', 'ворота слева от варунга'], [1, '11:30', 'loft-bingin', 'confirmed', 'ключ даст мама хозяина'], [1, '13:30', 'stilt-house', 'proposed', 'спросить про собаку']]) await api('PUT', '/api/viewings/new', { search_id: SR, listing_id: id, starts_at: at(n, t), status: st, meet_note: note });
  await api('POST', '/api/drafts', { search_id: SR, contact_id: ppl.wayan, listing_id: 'villa-field', channel: 'whatsapp', address: '+6281200000033', text: 'Deal 22 juta kak. Besok jam 10 kami datang lihat ya', tr: 'По рукам, 22. Завтра в 10:00 придём посмотреть', kind: 'negotiate', reason: 'Дешевле медианы рядом' });
  await api('PUT', '/api/deals/villa-field/prices', { asked: 25000000 }).catch(() => null);
  // ---- the second city: a search in Belgrade (euro, Serbian owners on Viber and WhatsApp; the README shows both cities)
  const atB = (n, t) => `${day(n)}T${t}:00+01:00`;
  const BG = (await api('POST', '/api/searches', { title: 'Белград', region: 'rs/belgrade', approval_mode: 'ask', brief: { currency: 'EUR', timezone: 'Europe/Belgrade', bedrooms: ['2'], budget_cap: 950, move_in: day(30), anchor: { label: 'Трг Републике', lat: 44.8163, lng: 20.4601, icon: 'pin' } } })).search.id;
  exec(P.slice(0, 2).filter(([n]) => n !== 'oleg').concat([P[2]]).map(([n]) => `INSERT OR IGNORE INTO members (search_id, user_id, role) VALUES ('${BG}','u_${n}','member');`).join('\n'));
  const flats = [['dorcol-old', 'Квартира в старом доме', 850, 'Дорчол', 44.8212, 20.4636, 'facade'], ['vracar-attic', 'Мансарда на Врачаре', 780, 'Врачар', 44.7992, 20.4768, 'attic'], ['zemun-yard', 'Дом с двором', 900, 'Земун', 44.8437, 20.4082, 'court'], ['blok-45', 'Квартира в блоке', 650, 'Новый Белград', 44.8046, 20.3990, 'block'], ['sava-river', 'Квартира у реки', 1200, 'Савамала', 44.8068, 20.4492, 'river']];
  for (const [id, title, price, area, lat, lng] of flats) await api('PUT', `/api/searches/${BG}/listings/${id}`, { title, price, currency: 'EUR', bedrooms: 2, area_text: area, lat, lng, fields: { furnished: 'full', heating: 'central_flat_rate', internet_mbps: 300, beli_karton_ok: true }, summary: 'Мебель и центральное отопление' });
  exec(flats.map(([id, , , , , , k]) => `UPDATE listings SET photos='${photo(k)}' WHERE id='${id}';`).join('\n'));
  await api('PUT', '/api/listings/dorcol-old/checks', { verdict: 'ok', signals: [{ status: 'ok', title: 'Хозяин совпадает с катастром' }] });
  const sr = {};
  for (const [k, name, id, ch, addr] of [['milan', 'Milan', 'dorcol-old', 'viber', '+381600000011'], ['jelena', 'Jelena', 'vracar-attic', 'whatsapp', '+381600000022'], ['ana', 'Ana', 'zemun-yard', 'telegram', '@ana_demo'], ['dragan', 'Dragan', 'blok-45', 'viber', '+381600000044'], ['marko', 'Marko', 'sava-river', 'whatsapp', '+381600000055']]) {
    sr[k] = (await api('PUT', '/api/contacts/new', { name, role: 'owner', lang: 'sr', channels: [{ channel: ch, address: addr }] })).contact.id;
    await api('POST', `/api/contacts/${sr[k]}/link`, { listing_id: id, role: 'owner' });
  }
  const thB = (k, listing_id, state, last, min, known, open) => api('PUT', '/api/threads', { search_id: BG, contact_id: sr[k], listing_id, state, last, last_at: ago(min), known, open });
  await thB('milan', 'dorcol-old', 'waiting_us', 'Ладно, 850, залог одна аренда', 18, 'Третий этаж, лифт, белый картон сразу', 'Сколько Инфостан зимой?\nИнтернет на кого?');
  await thB('jelena', 'vracar-attic', 'waiting_us', 'Могу показать завтра в 18:00', 52, 'Мансарда, пятый этаж без лифта', 'Кондиционер есть?');
  await thB('ana', 'zemun-yard', 'waiting_them', 'Спрошу хозяина', 140, null, null); await thB('dragan', 'blok-45', 'waiting_them', 'Отвечу вечером', 260, null, null); await thB('marko', 'sava-river', 'closed', 'Уже сдали', 3100, null, null);
  const msB = (k, id, ch, a) => api('POST', '/api/messages', a.map(([dir, min, tr, text], i) => ({ channel: ch, direction: dir, text, tr, at: ago(min), external_id: `${k}${i}`, search_id: BG, contact_id: sr[k], listing_id: id })));
  await msB('milan', 'dorcol-old', 'viber', [['in', 70, 'Квартира свободна с первого декабря, 900 евро', 'Stan je slobodan od prvog decembra, 900 evra'], ['out', 64, 'Нас трое, на год. Можно 800?', 'Nas troje, na godinu dana. Može 800?'], ['in', 40, '850, и белый картон оформим сразу', '850, i beli karton sredimo odmah'], ['out', 26, 'Договорились на 850, если залог одна аренда', 'Dogovoreno za 850 ako je depozit jedna kirija'], ['in', 18, 'Ладно, 850, залог одна аренда', 'Važi, 850, depozit jedna kirija']]);
  await msB('jelena', 'vracar-attic', 'whatsapp', [['out', 95, 'Добрый день! Квартира ещё свободна?', 'Dobar dan! Da li je stan još slobodan?'], ['in', 52, 'Да, могу показать завтра в 18:00', 'Jeste, mogu da pokažem sutra u 18h']]);
  await msB('dragan', 'blok-45', 'viber', [['out', 260, 'Сколько выходят счета зимой?', 'Koliko su računi zimi?']]);
  for (const [n, t, id, st, note] of [[1, '11:00', 'dorcol-old', 'proposed', 'домофон не работает, позвонить'], [1, '18:00', 'vracar-attic', 'confirmed', 'пятый этаж без лифта'], [2, '12:30', 'zemun-yard', 'proposed', 'спросить про парковку']]) await api('PUT', '/api/viewings/new', { search_id: BG, listing_id: id, starts_at: atB(n, t), status: st, meet_note: note });
  await api('POST', '/api/drafts', { search_id: BG, contact_id: sr.milan, listing_id: 'dorcol-old', channel: 'viber', address: '+381600000011', text: 'Dogovoreno, 850. Možemo da dođemo sutra u 11h?', tr: 'По рукам, 850. Можем прийти завтра в 11:00?', kind: 'negotiate', reason: 'Ниже медианы на Дорчоле' });
  await api('PUT', '/api/deals/dorcol-old/prices', { asked: 900 }).catch(() => null);
  const link = async () => new URL((await (await fetch(`${BASE}/link`, { method: 'POST', headers: { authorization: 'Bearer tok' }, body: '{}' })).json()).url).searchParams.get('k');
  const k = await link(), app = async (path, body) => { const r = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: { 'x-hunt-link': k, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return r.ok ? r.json() : null; };
  for (const [id, v] of [['villa-field', 'want_view'], ['loft-bingin', 'want_view'], ['stilt-house', 'want_view'], ['round-house', 'thinking'], ['dorcol-old', 'want_view'], ['vracar-attic', 'want_view'], ['zemun-yard', 'thinking']]) await app('/app/api/vote', { listing_id: id, decision: v });
  exec(['villa-field', 'stilt-house'].map((id) => `INSERT OR REPLACE INTO votes (listing_id, user_id, decision, at) VALUES ('${id}','u_masha','want_view','${ago(200)}');`).join('\n') + `\nUPDATE members SET reveal_seen_at='${T0}', animal='kingfisher' WHERE user_id='u_oleg';\nUPDATE members SET reveal_seen_at='${T0}', animal='myna' WHERE user_id='u_masha';\nUPDATE members SET animal='squirrel' WHERE user_id='u_oleg' AND search_id='${BG}';\nUPDATE members SET animal='stork' WHERE user_id='u_masha' AND search_id='${BG}';\n${['dorcol-old', 'vracar-attic'].map((id) => `INSERT OR REPLACE INTO votes (listing_id, user_id, decision, at) VALUES ('${id}','u_masha','want_view','${ago(150)}');`).join('\n')}\nUPDATE searches SET agent_seen_at='${ago(3)}';`);
  const sh = await app('/app/api/shop?s=' + HM), keys = sh.keys, idOf = (n) => { const a = sh.items[su].find((x) => x[keys.indexOf('ru')] === n); return a[keys.indexOf('id')]; };
  for (const [n, q] of [['Вода 19 л', 4], ['Молодой кокос', 4], ['Манго', 2], ['Газ 12 кг', 1]]) await app('/app/api/order-line', { search_id: HM, item_id: idOf(n), qty: q });
  // ---- record
  const out = {}, rec = async (path) => { const j = await app(path); if (!j) throw new Error('record ' + path); out[path] = j; return j; };
  out.SR = SR; out.HM = HM; out.BG = BG; out.day = day(0);
  await rec('/app/api/state');
  for (const s of [SR, HM, BG]) {
    await rec('/app/api/state?s=' + s); await rec('/app/api/state-more?s=' + s); await rec('/app/api/desk?s=' + s); await rec('/app/api/orders?s=' + s); await rec('/app/api/event-plan?s=' + s);
    for (const [, path] of [['parties', `/app/api/parties?s=${s}`], ['evening', `/app/api/evening?s=${s}`], ['surf', `/app/api/surf?search_id=${s}`]]) { const j = await app(path).catch(() => null); if (j) out[path] = j; }
    const st = out['/app/api/state?s=' + s];
    for (const t of st.threads) out[`/app/api/thread?s=${s}&c=${t.contact_id}`] = await app(`/app/api/thread?s=${s}&c=${t.contact_id}`);
    for (const l of st.listings) for (const p of [`/app/api/negotiation?listing_id=${l.id}`, `/app/api/listing?id=${l.id}`, `/app/api/location?id=${l.id}`]) { const j = await app(p).catch(() => null); if (j) out[p] = j; }
  }
  await rec('/app/api/shop?s=' + HM);
  const af = await app(`/app/api/afisha?s=${HM}&tab=all&seed=0`);
  out.afisha = { '': af };
  for (const d of af.days) { const j = await app(`/app/api/afisha?s=${HM}&tab=all&seed=0&day=${d.day}`); if (j) out.afisha[d.day] = j; for (const o of [...(j?.top ?? []), ...(j?.items ?? [])]) { const p = `/app/api/event?s=${HM}&id=${o.id}&occ=${o.occ}`; out[p] ??= await app(p); } }
  const reg = JSON.parse(readFileSync(join(crm, 'public/art/regions.json'), 'utf8')).bali;
  out.regions = { bali: { name: reg.name, tz: reg.tz, currency: reg.currency, areas: Object.fromEntries(Object.entries(reg.areas).map(([id, a]) => [id, { name: a.name, group: a.group, city: a.city, districts: a.districts, center: a.center, vibe: a.vibe, tags: a.tags, scores: a.scores, price: a.price, airport_min: a.airport_min, pros: a.pros, cons: a.cons }])), sub: Object.fromEntries(reg.islands.map((c) => [c, reg.sub[c]])), islands: reg.islands, location: reg.location, seasons: reg.seasons, events: { effects: reg.events.effects, sources: [], party: null }, checklist: [] } };
  const rs = JSON.parse(readFileSync(join(crm, 'public/art/regions.json'), 'utf8')).rs;
  out.regions.rs = { name: rs.name, tz: rs.tz, currency: rs.currency, areas: Object.fromEntries(Object.entries(rs.areas).filter(([, a]) => a.city === 'belgrade').map(([id, a]) => [id, { name: a.name, group: a.group, city: a.city, districts: a.districts, center: a.center, vibe: a.vibe, tags: a.tags, scores: a.scores, price: a.price, airport_min: a.airport_min, pros: a.pros, cons: a.cons }])), sub: { belgrade: rs.sub.belgrade }, islands: ['belgrade'], location: rs.location, seasons: rs.seasons, events: { effects: rs.events?.effects ?? {}, sources: [], party: null }, checklist: [] };
  // the toy maps the demo opens (Bali cities in the new project, Belgrade on the desk), from the pack art copy-art put in public/art
  for (const [k, c] of [...reg.islands.map((x) => ['bali', x]), ['rs', 'belgrade']]) for (const f of ['json', 'webp']) copyFileSync(join(crm, `public/art/${k}/island-${c}.${f}`), join(crm, `public/demo-home/island-${c}.${f}`));
  // Event photos are served through the proxy with an id: point them at the files of the demo.
  const pic = { 'Урок сёрфа для новичков': 'surf', 'Ночной рынок': 'market', 'Падел вчетвером': 'padel' };
  const walk = (x) => { if (!x || typeof x !== 'object') return; if (x.title && pic[x.title] && x.photo) x.photo = { url: `/demo-home/ev-${pic[x.title]}.webp`, credit: 'CC0' }; for (const v of Object.values(x)) walk(v); };
  walk(out);
  const txt = JSON.stringify(out).replaceAll('https://demo.local/', '/demo-home/').replace(/"photo_token":"[^"]*"/g, '"photo_token":""').replace(/"invite_link":"[^"]*"/g, '"invite_link":null').replaceAll('demo_bot', '').replace(/"pack":"bali"/g, '"pack":"demo"');
  writeFileSync(join(crm, 'public/demo-home/demo.json'), txt);
  const en = toEnglish(JSON.parse(txt)), enD = en.data;
  for (const v of Object.values(enD)) if (v?.user?.lang) v.user.lang = 'en';
  if (en.left.length) console.log('left in Russian:', en.left);
  writeFileSync(join(crm, 'public/demo-home/demo.en.json'), JSON.stringify(enD));
  console.log('demo.json', Math.round(txt.length / 1024), 'KB,', Object.keys(out).length, 'answers');
} catch (e) { console.log('ERROR', e.message, log.slice(-900)); process.exitCode = 1; } finally { try { process.kill(-dev.pid); } catch { /* gone */ } await sleep(700); rmSync(dir, { recursive: true, force: true }); }
