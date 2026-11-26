// Orders · "Наборы": pure checks (no Worker): names, the repeat schedule, the next occurrence, when the cron reminds, the reminder
// text, and that the server's range is exactly the Mini App's (public/app.js ordSpread / ordRangeStr run side by side).
//   node --experimental-strip-types scripts/test-order-sets-pure.mts
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  nameKey, defaultSetName, firesOn, nextOccurrence, biweeklyAnchor, dueDay, wdIdx, mondayOf, bandsOf, spread, rangeStr, reminderText, reminderButtons, skippedLine, DUE_WINDOW_MIN,
} from '../src/order-sets.ts';

let pass = 0, fail = 0;
const ok = (c: unknown, name: string, extra: unknown = '') => { if (c) pass++; else { fail++; console.log('FAIL', name, typeof extra === 'string' ? extra : JSON.stringify(extra)); } };

// ---- names
ok(nameKey('  Фрукты  на НЕДЕЛЮ ') === 'фрукты на неделю' && nameKey('Ёжик') === nameKey('ежик'), 'name key: case, spaces, ё');
ok(defaultSetName('fruit', 'Fruit Market', 'ru') === 'Фрукты на неделю' && defaultSetName('fish', 'Fish Market', 'en') === 'Fish for dinner', 'default names by kind');
ok(defaultSetName('other', 'Water Bali', 'ru') === 'Water Bali: как обычно', 'other kinds: the supplier name');
ok(defaultSetName('fruit', 'x', 'ru', new Set(['фрукты на неделю', 'фрукты на неделю 2'])) === 'Фрукты на неделю 3', 'taken names get a number');
ok(defaultSetName('other', 'A'.repeat(60), 'ru').length <= 40, 'never longer than 40');

// ---- schedule (2026-11-30 is a Monday)
ok(wdIdx('2026-11-30') === 0 && wdIdx('2026-12-06') === 6 && mondayOf('2026-12-03') === '2026-11-30', 'weekdays from Monday');
const MON = 1, THU = 8;
const w = { repeat: 'weekly', days: MON | THU, time: '09:00' };
ok(firesOn(w, '2026-11-30') && firesOn(w, '2026-12-03') && !firesOn(w, '2026-12-01'), 'weekly on Mon and Thu');
ok(!firesOn({ ...w, repeat: 'none' }, '2026-11-30'), 'no repeat never fires');
const b = { repeat: 'biweekly', days: MON, time: '09:00', anchor: '2026-11-30' };
ok(firesOn(b, '2026-11-30') && !firesOn(b, '2026-12-07') && firesOn(b, '2026-12-14') && firesOn(b, '2026-11-16') && !firesOn(b, '2026-11-23'), 'every 2 weeks from the anchor week, both ways');
ok(!firesOn({ ...b, anchor: null }, '2026-11-30'), 'every 2 weeks without an anchor never fires');
// Thursday 26.11 10:30: the next Monday 30.11 09:00 (the hint "пн 30.11 в 09:00")
ok(JSON.stringify(nextOccurrence({ repeat: 'weekly', days: MON, time: '09:00' }, '2026-11-26', 630)) === '{"day":"2026-11-30","time":"09:00"}', 'next occurrence: the coming Monday');
ok(nextOccurrence({ repeat: 'weekly', days: MON, time: '09:00' }, '2026-11-30', 539)!.day === '2026-11-30', 'today when the time is still ahead');
ok(nextOccurrence({ repeat: 'weekly', days: MON, time: '09:00' }, '2026-11-30', 540)!.day === '2026-12-07', 'next week once the time has come');
ok(nextOccurrence({ repeat: 'weekly', days: 0, time: '09:00' }, '2026-11-30', 0) === null && nextOccurrence({ repeat: 'weekly', days: 1, time: '9am' }, '2026-11-30', 0) === null, 'no days or a bad time: no occurrence');
ok(biweeklyAnchor(MON, '09:00', '2026-11-26', 630) === '2026-11-30', 'anchor = the week of the first reminder');
ok(biweeklyAnchor(THU, '18:00', '2026-11-26', 630) === '2026-11-23', 'anchor: this week when the day is still ahead');
const bw = { repeat: 'biweekly', days: THU, time: '18:00', anchor: biweeklyAnchor(THU, '18:00', '2026-11-26', 630) };
ok(nextOccurrence(bw, '2026-11-26', 630)!.day === '2026-11-26' && nextOccurrence(bw, '2026-11-26', 18 * 60 + 1)!.day === '2026-12-10', 'every 2 weeks: today, then in 14 days');

// ---- when the cron reminds (once a day, within the window, never another day)
const due = { repeat: 'weekly', days: MON, time: '09:00', last_sent: null as string | null };
ok(dueDay(due, '2026-11-30', 539) === null, 'not before the time');
ok(dueDay(due, '2026-11-30', 540) === '2026-11-30' && dueDay(due, '2026-11-30', 540 + DUE_WINDOW_MIN - 1) === '2026-11-30', 'due at the time and a little after (missed ticks)');
ok(dueDay(due, '2026-11-30', 540 + DUE_WINDOW_MIN) === null, 'too late: skipped, not sent at night');
ok(dueDay({ ...due, last_sent: '2026-11-30' }, '2026-11-30', 600) === null, 'once per occurrence');
ok(dueDay({ ...due, last_sent: '2026-11-23' }, '2026-11-30', 600) === '2026-11-30', 'last week does not block this week');
ok(dueDay(due, '2026-12-01', 600) === null, 'other weekdays never');
ok(dueDay({ ...due, repeat: 'none' }, '2026-11-30', 600) === null, 'no repeat, no reminder');

// ---- the reminder
const txt = reminderText('ru', '2026-11-30', 'Фрукты на неделю', 28, '1,0–1,4 млн');
ok(txt === 'Понедельник: пора заказать «Фрукты на неделю»\n28 позиций, приготовить 1,0–1,4 млн', 'the reminder as in the mockup', txt);
ok(reminderText('en', '2026-12-03', 'Fish <b>', 1, null) === 'Thursday: time to order “Fish &lt;b&gt;”\n1 item', 'english, escaped, no range');
ok(reminderText('ru', '2026-11-30', 'x', 2, null).endsWith('2 позиции') && reminderText('ru', '2026-11-30', 'x', 21, null).endsWith('21 позиция'), 'russian plurals');
ok(reminderButtons('ru').go === 'Собрать корзину' && reminderButtons('ru').skip === 'Пропустить' && reminderButtons('en').skip === 'Skip', 'buttons');
ok(skippedLine('ru', 'Лев').startsWith('Пропускаем этот раз'), 'skipped line');
ok(!/кнопка открывает/.test(txt), 'the mockup caption is not part of the message');

// ---- the range: the server port against the Mini App's own code
const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'app.js'), 'utf8');
const a0 = app.indexOf('const RG_KG = ');
const a1 = app.indexOf('\n', app.indexOf('const ordRangeStr = '));
ok(a0 > 0 && a1 > a0, 'found ordSpread in app.js');
const STR: Record<string, Record<string, string>> = { ru: { or_mln: 'млн', or_thou: 'тыс' }, en: { or_mln: 'M', or_thou: 'k' } };
const client = (lang: string, items: Record<string, unknown[]>) => {
  const OR = { items };
  const t = (k: string) => STR[lang][k];
  const LOC = () => (lang === 'ru' ? 'ru-RU' : 'en-GB');
  const SYM = { KZT: '₸', THB: '฿', USD: '$', EUR: '€', RUB: '₽', IDR: 'IDR' };
  return new Function('OR', 't', 'LOC', 'SYM', 'LANG', `${app.slice(a0, a1)}\nreturn { ordSpread, ordRangeStr };`)(OR, t, LOC, SYM, lang);
};
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
let same = 0, nulls = 0;
for (let k = 0; k < 400; k++) {
  const cur = pick(['IDR', 'IDR', 'IDR', 'THB', 'KZT', 'USD']);
  const scale = cur === 'IDR' ? 1000 : cur === 'KZT' ? 50 : cur === 'THB' ? 5 : 1;
  const grps = ['fruit', 'veg', 'fish', 'water'];
  const catalog = Array.from({ length: 4 + Math.floor(rnd() * 30) }, (_, i) => ({
    id: 'i' + i, grp: pick(grps), unit: pick(['kg', 'pcs', 'pack', 'bunch']), price: rnd() < 0.2 ? null : Math.round((1 + rnd() * 120) * scale), unsure: rnd() < 0.1,
  }));
  const lines = catalog.filter(() => rnd() < (k % 25 === 0 ? 0 : 0.5)).map((x) => ({ ...x, qty: pick([0.5, 1, 1.5, 2, 3, 5, 12]) }));
  const ratios = Array.from({ length: pick([0, 0, 1, 2, 5, 40]) }, (_, i) => ['o' + i, Math.round((0.8 + rnd() * 0.5) * 1e4) / 1e4, `2026-11-${String(1 + i % 28).padStart(2, '0')}`]);
  // The orders view hands the app the last 30 ratios (supplierView); the cron takes the same 30.
  const su = { id: 'su', currency: cur, min_free_delivery: rnd() < 0.5 ? Math.round(rnd() * 300 * scale) : null, delivery_fee: rnd() < 0.5 ? Math.round(rnd() * 40 * scale) : null, ratios: ratios.slice(-30) };
  for (const lang of ['ru', 'en']) {
    const c = client(lang, { su: catalog });
    const cs = c.ordSpread(lines, su);
    const ss = spread(lines, su, ratios.slice(-30).map((r) => r[1] as number), bandsOf(catalog));
    if (!cs || !ss) { ok(!cs && !ss, `both null #${k}`, { cs, ss }); nulls++; continue; }
    const ct = c.ordRangeStr(cs.lo, cs.hi, cs.cur), st = rangeStr(ss.lo, ss.hi, ss.cur, lang);
    ok(cs.lo === ss.lo && cs.hi === ss.hi && ct === st && cs.miss.length === ss.miss, `range #${k} ${lang}`, { c: [cs.lo, cs.hi, ct], s: [ss.lo, ss.hi, st] });
    same++;
  }
}
ok(same > 300 && nulls > 0, 'the comparison covered ranges and empty cases', { same, nulls });
ok(rangeStr(1_000_000, 1_400_000, 'IDR', 'ru') === '1,0–1,4 млн' && rangeStr(730_000, 950_000, 'IDR', 'ru') === '730–950 тыс', 'the mockup numbers');

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
