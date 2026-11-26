// Wave 10 · pure checks of the orders (no Worker): steps, totals, the free-delivery bar, hours and slots, the message and its
// translation, chat links, the price-list import.
//   node --experimental-strip-types scripts/test-wave10-pure.mts
import { cleanQty, totals, lineSum, freeDelivery, parseHours, slots, badTime, orderMessage, orderTranslation, chatUrl, parseImport, type MsgOpts } from '../src/order-text.ts';

let pass = 0, fail = 0;
const ok = (c: unknown, name: string, extra: unknown = '') => { if (c) pass++; else { fail++; console.log('FAIL', name, typeof extra === 'string' ? extra : JSON.stringify(extra)); } };
const throws = (f: () => unknown, re: RegExp, name: string) => { try { f(); ok(false, name, 'no error'); } catch (e) { ok(re.test(String((e as Error).message)), name, String((e as Error).message)); } };

// ---- quantities
ok(cleanQty(0.5, 0.5) === 0.5 && cleanQty(1.2, 0.5) === 1 && cleanQty(1.3, 0.5) === 1.5, 'kg go by 0.5');
ok(cleanQty(1.4, 1) === 1 && cleanQty(0.2, 1) === 1, 'pieces go by 1, a positive amount is at least one step');
ok(cleanQty(0, 1) === 0 && cleanQty(-3, 1) === 0, 'zero and below remove the line');
ok(cleanQty('x', 1) === null && cleanQty(null, 1) === null && cleanQty('', 1) === null && cleanQty(Infinity, 1) === null, 'not a number → null');
ok(cleanQty(99999, 1) === 200, 'capped');
ok(cleanQty(0.1 + 0.2, 0.1) === 0.3, 'no float tails');

// ---- totals
const L = (price: number | null, qty: number, unsure = false) => ({ price, qty, unsure });
ok(lineSum(L(54000, 1.5)) === 81000 && lineSum(L(null, 3)) === null, 'line sums');
const t = totals([L(13000, 4), L(54000, 2), L(null, 2), L(90000, 1, true)]);
ok(t.sum === 250000 && t.unknown === 1 && t.unsure === 1 && t.count === 4, 'unknown prices are counted, not summed; unsure ones are summed and flagged', t);
ok(totals([]).sum === 0, 'empty basket');

// ---- free delivery
ok(freeDelivery(192000, 300000)!.left === 108000 && !freeDelivery(192000, 300000)!.reached && freeDelivery(192000, 300000)!.pct === 64, 'ещё 108 тыс');
ok(freeDelivery(300000, 300000)!.reached && freeDelivery(900000, 300000)!.pct === 100, 'reached, the bar is full');
ok(freeDelivery(1, null) === null && freeDelivery(1, 0) === null, 'no threshold → no bar');

// ---- hours and slots
ok(JSON.stringify(parseHours('08:00-17:00')) === '[480,1020]' && JSON.stringify(parseHours('8:00 – 17:00')) === '[480,1020]', 'hours parse');
ok(parseHours('17:00-08:00') === null && parseHours('nope') === null && parseHours(null) === null && parseHours('25:00-26:00') === null, 'bad hours → null');
ok(slots('08:00-17:00', false, 0).join() === '09:00,11:00,13:00,15:00,17:00', 'tomorrow: the whole day inside the hours', slots('08:00-17:00', false, 0));
ok(slots('08:00-17:00', true, 13 * 60).join() === '15:00,17:00', 'today: not earlier than an hour from now', slots('08:00-17:00', true, 13 * 60));
ok(slots('08:00-17:00', true, 16 * 60 + 30).length === 0, 'today is over');
ok(slots(null, false, 0).length > 0, 'unknown hours still give pills');
ok(badTime('16:00', '08:00-17:00', true, 600) === null && badTime('18:00', '08:00-17:00', false, 0) === 'closed' && badTime('09:00', '08:00-17:00', true, 600) === 'past' && badTime('9:00', null, false, 0) === 'format', 'time checks');
ok(badTime('21:00', null, false, 0) === null, 'no hours → any time');

// ---- the message
const lines = [
  { name_id: 'Galon air 19 L', name_ru: 'Вода 19 л', name_en: 'Water gallon', unit: 'pcs', qty: 2, price: null },
  { name_id: 'Mangga Arum Manis', name_ru: 'Манго арум манис', name_en: 'Mango', unit: 'kg', qty: 1.5, price: 54000 },
  { name_id: 'Telur', name_ru: 'Яйца', name_en: 'Eggs', unit: '30pcs', qty: 1, price: 60000 },
];
const o: MsgOpts = { lines, day: 'today', time: '16:00', hour: 13 };
const m = orderMessage('id', o);
ok(m.startsWith('Halo, selamat siang. Saya mau pesan:\n- 2 Galon air 19 L\n- 1,5 kg Mangga Arum Manis\n- 1 rak isi 30 Telur\n'), 'Indonesian list with the names of the price list and decimal commas', m);
ok(m.includes('Bisa diantar hari ini jam 16.00?') && m.endsWith('Bayar di tempat ya. Terima kasih'), 'time and cash on delivery', m);
ok(!m.includes('Alamat') && !m.includes('Catatan') && !m.includes('Lokasi'), 'no address or note unless given');
const a = orderMessage('id', { ...o, day: 'tomorrow', time: null, address: 'Jl. X\n1', map_url: 'https://maps.app.goo.gl/x', note: 'ring the bell' });
ok(a.includes('Bisa diantar besok?') && a.includes('Alamat: Jl. X 1') && a.includes('Lokasi: https://maps.app.goo.gl/x') && a.includes('Catatan: ring the bell'), 'address on one line, map, note', a);
ok(!orderMessage('id', { ...o, map_url: 'https://x' }).includes('Lokasi'), 'the map never goes without the address');
ok(orderMessage('id', { ...o, day: null }).includes('Kapan bisa diantar?') && orderMessage('id', { ...o, day: '2026-11-28', time: '10:00' }).includes('tanggal 28.11 jam 10.00'), 'no day / a date');
ok(['pagi', 'siang', 'sore', 'malam'].every((g, i) => orderMessage('id', { ...o, hour: [8, 12, 16, 20][i] }).includes(`selamat ${g}`)), 'greeting by the hour');
ok(orderMessage('en', o).includes('- 1 tray of 30 Telur') && orderMessage('en', o).includes('today at 16:00'), 'English supplier');
const tr = orderTranslation('ru', o);
ok(tr.includes('2 шт Вода 19 л; 1,5 кг Манго арум манис') && tr.includes('сегодня к 16:00') && tr.includes('Заплатим на месте'), 'Russian translation', tr);
ok(orderTranslation('en', o).includes('1.5 kg Mango'), 'English translation');
ok(!/[—]/.test(m + tr + a), 'no em dashes');

// ---- chat links
ok(chatUrl('whatsapp', '+62 811-0000 0021', 'a b&c\nd')!.startsWith('https://wa.me/6281100000021?text=a%20b%26c%0Ad'), 'wa.me digits and encoding', chatUrl('whatsapp', '+62 811-0000 0021', 'a b&c'));
ok(chatUrl('telegram', '@some_shop', 'x') === 'https://t.me/some_shop?text=x' && chatUrl('telegram', 'javascript:alert(1)', 'x') === null, 'telegram handle only');
ok(chatUrl('phone', '+62811', 'x') === null && chatUrl('whatsapp', '', 'x') === null && chatUrl('whatsapp', '123', 'x') === null, 'no chat → no link');

// ---- import
const im = parseImport([{ name_id: ' Kangkung ', name_ru: 'Кангкунг', price: 2500, unit: 'pcs', grp: 'greens', toy: 'greens' }, { name_id: 'Asparagus', price: 0 }, { name_id: 'Beras', by_request: 1, unit: 'kg' }, { name_id: 'Cabe', name_ru: 'Чили' }], '2026-11-24');
ok(im[0].name_id === 'Kangkung' && im[0].step === 1 && im[0].price_at === '2026-11-24' && im[0].has_price === 1 && im[0].by_request === 0, 'names trimmed, step by the unit', im[0]);
ok(im[1].price === null && im[1].has_price === 1, '0,00 = no price');
ok(im[2].by_request === 1 && im[2].price === null && im[2].step === 0.5, 'by request');
ok(im[3].has_price === 0 && im[3].by_request === null && im[3].unit === null && im[3].step === null, 'absent fields keep the old values');
throws(() => parseImport([{ name_id: 'A' }, { name_id: 'A ' }], null), /items\[1\]: duplicate/, 'duplicates refused');
throws(() => parseImport([{ name_ru: 'x' }], null), /name_id/, 'name_id required');
throws(() => parseImport([{ name_id: 'x', unit: 'ton' }], null), /unit/, 'unknown unit');
throws(() => parseImport([{ name_id: 'x', price: 'a lot' }], null), /price/, 'bad price');
throws(() => parseImport([{ name_id: 'x', toy: '../x' }], null), /toy/, 'toy slug only');
throws(() => parseImport([], null), /non-empty/, 'empty list');
throws(() => parseImport(Array.from({ length: 501 }, (_, i) => ({ name_id: 'n' + i })), null), /500/, 'size limit');
throws(() => parseImport([{ name_id: 'x' }], '24.11.2026'), /price_at/, 'date format');

console.log(`wave 10 pure: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
