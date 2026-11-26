#!/usr/bin/env node
// Unit checks of the pure Афиша ranking (src/afisha-rank.ts): occurrences, filters, taste/youth/sea scoring, "why" lines,
// the diversity re-rank and dedupe. No Worker, no D1.   node --experimental-strip-types scripts/test-wave7-rank.mts
import { occurrences, recursOn, recurringLabel, scoreItem, diversify, passFilters, isDuplicate, rng, type RankItem, type RankCtx, type FeedbackRow } from '../src/afisha-rank.ts';

let pass = 0, fail = 0;
const ok = (cond: unknown, name: string, extra: unknown = '') => { if (cond) pass++; else { fail++; console.log(`FAIL ${name}`, extra); } };

// ---- occurrences
const weekly = { freq: 'weekly' as const, weekdays: [1], time: '21:00' };
const oc = occurrences({ starts_at: null, ends_at: null, recurrence: weekly }, '2026-11-20', '2026-12-01', 'Asia/Makassar');
ok(oc.length === 2 && oc[0].occ === '2026-11-23' && oc[0].starts_at === '2026-11-23T21:00:00+08:00', 'weekly Monday occurrences', oc);
ok(recursOn({ freq: 'monthly', nth: -1, weekdays: [5], time: '20:00' }, '2026-11-27') && !recursOn({ freq: 'monthly', nth: -1, weekdays: [5], time: '20:00' }, '2026-11-20'), 'last Friday of the month');
ok(recursOn({ freq: 'seasonal', months: [11, 12], time: '06:00' }, '2026-11-21') && !recursOn({ freq: 'seasonal', months: [6], time: '06:00' }, '2026-11-21'), 'seasonal months');
const fest = occurrences({ starts_at: '2026-11-21T16:00:00+08:00', ends_at: '2026-11-23T23:00:00+08:00', recurrence: null }, '2026-11-22', '2026-11-30', 'Asia/Makassar');
ok(fest.length === 2 && fest[0].occ === '2026-11-22', 'multi-day festival shows on each day in the window', fest);
ok(recurringLabel(weekly)?.ru === 'Каждый понедельник' && recurringLabel({ freq: 'daily', time: '18:00' })?.en === 'Every day', 'recurring labels');
const late = occurrences({ starts_at: null, ends_at: null, recurrence: { freq: 'daily', time: '22:00', end: '02:00' } }, '2026-11-21', '2026-11-21', 'Asia/Makassar');
ok(late[0].ends_at === '2026-11-22T02:00:00+08:00', 'end after midnight rolls to the next day', late);

// ---- scoring
const NOW = Date.parse('2026-11-21T08:00:00+08:00');
const base = (o: Partial<RankItem>): RankItem => ({
  key: (o.id ?? 'e') + '@2026-11-21', id: 'e', occ: '2026-11-21', starts_at: '2026-11-21T18:00:00+08:00', ends_at: null, title: 'X', category: 'culture', topic: null,
  organizer_key: null, place_key: null, lang: 'en', price_kind: 'paid', price: 150000, tags: [], quality: 0.5, source_rep: 0.5, photo_score: 0.5, place_tier: null,
  in_user_list: false, minutes: 15, sea: false, outdoor: false, sea_state: null, age_min: null, booking: 'message', ...o,
});
const ctx = (o: Partial<RankCtx> = {}): RankCtx => ({ now: NOW, members: [{ user_id: 'u1', name: 'Олег', interests: [], age_band: '25-30', nightlife: null }, { user_id: 'u2', name: 'Игорь Иванов', interests: [], age_band: '25-30', nightlife: null }],
  feedback: [], viewer: 'u1', busy: [], blocked: new Map(), payDays: new Set(), rings: [10, 20, 40], weights: [1, 0.7, 0.3], priceMedian: 150000, ...o });
const fb = (o: Partial<FeedbackRow>): FeedbackRow => ({ user_id: 'u1', event_id: 'old', category: null, topic: null, organizer_key: null, place_key: null, liked: 0, nope: 0, want: 0, bookmark: 0, attended: 0, rating: null, updated_at: '2026-11-20T10:00:00Z', ...o });

const dance = base({ id: 'd', category: 'dance', topic: 'dance' });
const s0 = scoreItem(dance, ctx());
const s1 = scoreItem(dance, ctx({ feedback: [fb({ user_id: 'u2', category: 'dance', topic: 'dance', liked: 1 })] }));
ok(s1.score > s0.score, 'a like on the category lifts the score', [s0.score, s1.score]);
ok(s1.why?.ru.includes('Игорь любит танцы'), 'why names the member who likes it', s1.why);
const both = scoreItem(base({ id: 's', category: 'party', topic: 'sunset_session', tags: ['sunset', 'dj'] }), ctx({ feedback: [fb({ topic: 'sunset_session', category: 'beach_club', liked: 1 }), fb({ user_id: 'u2', topic: 'sunset_session', category: 'beach_club', want: 1 })] }));
ok(both.why?.ru.startsWith('вы оба отмечали закаты'), '"вы оба отмечали закаты"', both.why);
// decay: an old like weighs less
const fresh = scoreItem(dance, ctx({ feedback: [fb({ category: 'dance', liked: 1, updated_at: '2026-11-20T00:00:00Z' })] }));
const stale = scoreItem(dance, ctx({ feedback: [fb({ category: 'dance', liked: 1, updated_at: '2026-06-01T00:00:00Z' })] }));
ok(fresh.score > stale.score, 'feedback decays with time', [fresh.score, stale.score]);
// "не моё": the item drops hard, the category only slightly and never below a floor
const nopeItem = scoreItem(dance, ctx({ feedback: [fb({ event_id: 'd', category: 'dance', nope: 1 })] }));
ok(nopeItem.score < s0.score - 2.5, 'не моё drops that item', [s0.score, nopeItem.score]);
const manyNope = scoreItem(base({ id: 'd2', category: 'dance' }), ctx({ feedback: Array.from({ length: 20 }, (_, i) => fb({ event_id: 'x' + i, category: 'dance', nope: 1 })) }));
ok(manyNope.score > s0.score - 0.7 && !manyNope.excluded, 'не моё never kills a category', [s0.score, manyNope.score]);
// youth fit: tour-group formats sink unless someone liked them; DJ/sunset rise
const dinner = scoreItem(base({ id: 'ds', category: 'culture', tags: ['dinner_show', 'buffet_evening'] }), ctx());
const sunset = scoreItem(base({ id: 'ss', category: 'beach_club', tags: ['sunset', 'dj'], starts_at: '2026-11-21T20:30:00+08:00' }), ctx());
ok(sunset.score > dinner.score + 1.5 && !dinner.excluded, 'youth_fit: sunset+DJ above dinner show (not banned)', [sunset.score, dinner.score]);
const dinnerLiked = scoreItem(base({ id: 'ds', category: 'culture', tags: ['dinner_show'] }), ctx({ feedback: [fb({ category: 'culture', liked: 1 }), fb({ user_id: 'u2', category: 'culture', liked: 1 })] }));
ok(dinnerLiked.score > dinner.score, 'a liked kind of thing softens the youth penalty');
// nightlife opt-out: the viewer never gets bars/alcohol promos
ok(scoreItem(base({ category: 'bar' }), ctx({ members: [{ user_id: 'u1', name: 'Олег', interests: [], age_band: null, nightlife: false }] })).excluded === 'nightlife_off', 'nightlife off excludes bars');
ok(scoreItem(base({ category: 'music', tags: ['alcohol_promo'] }), ctx({ members: [{ user_id: 'u1', name: 'Олег', interests: [], age_band: null, nightlife: false }] })).excluded === 'nightlife_off', 'nightlife off excludes alcohol promos');
// sea: calm → why, rough → sinks
const snork = base({ id: 'sn', category: 'nature', topic: 'snorkel', sea: true, starts_at: '2026-11-22T08:00:00+08:00', occ: '2026-11-22' });
const calm = scoreItem({ ...snork, sea_state: { calm: true, wave: 0.4, wind: 8 } }, ctx());
const rough = scoreItem({ ...snork, sea_state: { calm: false, wave: 1.8, wind: 30 } }, ctx());
ok(calm.why?.ru.includes('море утром спокойное') && rough.score < calm.score - 2, 'sea state: calm why / rough penalty', [calm.why, rough.score]);
// calendar: a viewing at the same time, Nyepi
ok(scoreItem(dance, ctx({ busy: [{ from: Date.parse('2026-11-21T17:30:00+08:00'), to: Date.parse('2026-11-21T19:30:00+08:00'), why: 'viewing' }] })).score < s0.score - 2, 'clash with a viewing');
ok(scoreItem(dance, ctx({ blocked: new Map([['2026-11-21', 'nyepi']]) })).excluded === 'nyepi', 'Nyepi excludes');
// wave 8.1: no distance cutoff — far events stay, flagged, and sink below near ones (more for a longer ride)
const near15 = scoreItem(base({ minutes: 15 }), ctx()), far75 = scoreItem(base({ minutes: 75 }), ctx()), far120 = scoreItem(base({ minutes: 120 }), ctx());
ok(far75.excluded === null && far75.far === true && near15.far === false, '> 60 min stays (flag far, not excluded)', [far75.excluded, far75.far]);
ok(far75.score < near15.score - 1 && far120.score < far75.score, 'far sinks, the longer the ride the lower', [near15.score, far75.score, far120.score]);
ok(scoreItem(base({ minutes: null, other_city: true }), ctx()).score < scoreItem(base({ minutes: null }), ctx()).score, 'another city without a home point ranks lower');
ok(scoreItem(base({ starts_at: '2026-11-21T05:00:00+08:00' }), ctx()).excluded === 'past', 'past excluded');
// interests from the profile
const sport = scoreItem(base({ id: 'p', category: 'social_sport', topic: 'padel' }), ctx({ members: [{ user_id: 'u1', name: 'Олег', interests: ['sport'], age_band: '25-30', nightlife: null }] }));
ok(sport.why?.ru.includes('Олег любит') && !sport.new_for_you, 'profile interest → why, not new', sport.why);
ok(scoreItem(base({ id: 'w', category: 'workshop' }), ctx()).new_for_you, 'unknown category is new for you');

// ---- diversity
const cats = ['dance', 'dance', 'dance', 'music', 'music', 'food', 'culture', 'party', 'nature', 'workshop'];
const items = cats.map((c, i) => scoreItem(base({ id: 'i' + i, key: 'i' + i, category: c, organizer_key: i < 4 ? 'org1' : 'o' + i, quality: 0.9 - i * 0.02 }),
  ctx({ feedback: [fb({ category: 'dance', liked: 1 }), fb({ category: 'music', liked: 1 }), fb({ category: 'food', liked: 1 }), fb({ category: 'culture', liked: 1 }), fb({ category: 'party', liked: 1 })] })));
for (const seed of [0, 1, 7, 42, 999]) {
  const out = diversify(items, { seed });
  ok(out.length === items.length, `diversify keeps everything (seed ${seed})`);
  ok(out.every((x, i) => i === 0 || x.category !== out[i - 1].category || out.slice(i).every((y) => y.category === x.category)), `no two of a category in a row (seed ${seed})`, out.map((x) => x.category));
  ok(out.slice(0, 5).some((x) => x.new_for_you), `≥ 1 new for you in the first five (seed ${seed})`, out.slice(0, 5).map((x) => x.category));
  ok(out.slice(0, 6).filter((x) => x.organizer_key === 'org1').length <= 2, `organizer cap (seed ${seed})`);
}
const a = diversify(items, { seed: 1 }).map((x) => x.key).join(), b = diversify(items, { seed: 2 }).map((x) => x.key).join();
ok(a !== b && a === diversify(items, { seed: 1 }).map((x) => x.key).join(), '"Ещё" reshuffles with a new seed, same seed = same order');
const r = rng(5); ok(r() !== r(), 'rng advances');

// ---- filters
const f = (s: string) => new Set(s.split(',').filter(Boolean));
ok(passFilters({ lang: 'none', price_kind: 'paid', starts_at: '2026-11-21T18:00:00+08:00', minutes: 22, booking: 'message', category: 'culture' }, f('ru')), 'RU includes "без слов"');
ok(!passFilters({ lang: 'en', price_kind: 'paid', starts_at: '2026-11-21T18:00:00+08:00', minutes: 22, booking: 'message', category: 'culture' }, f('ru')), 'RU excludes EN');
ok(!passFilters({ lang: 'en', price_kind: 'paid', starts_at: '2026-11-21T18:00:00+08:00', minutes: 22, booking: 'message', category: 'culture' }, f('free')), 'free filter');
ok(passFilters({ lang: 'en', price_kind: 'free', starts_at: '2026-11-21T19:00:00+08:00', minutes: 9, booking: 'none', category: 'bar' }, f('evening,r10,bars')), 'evening + ring 10 + bars');
ok(!passFilters({ lang: 'en', price_kind: 'free', starts_at: '2026-11-21T08:00:00+08:00', minutes: 9, booking: 'none', category: 'bar' }, f('evening')), 'morning is not evening');

// ---- dedupe
const k = (o: any) => ({ title: 'Kecak Fire Dance', starts_at: '2026-11-21T18:00:00+08:00', recurrence: null, place_name: 'Uluwatu Temple', lat: null, lng: null, ...o });
ok(isDuplicate(k({}), k({ title: 'Kecak fire dance at Uluwatu', starts_at: '2026-11-21T18:30:00+08:00', place_name: 'Pura Luhur Uluwatu Temple' })), 'same event from two sources');
ok(!isDuplicate(k({}), k({ starts_at: '2026-11-21T20:30:00+08:00' })), 'different time → not a duplicate');
ok(!isDuplicate(k({}), k({ place_name: 'Garuda Wisnu Kencana' })), 'different place → not a duplicate');
ok(isDuplicate(k({ recurrence: { freq: 'daily', time: '18:00' }, starts_at: null }), k({})), 'a post about one night of a recurring event');
ok(isDuplicate(k({ lat: -8.829, lng: 115.085, place_name: null }), k({ lat: -8.8295, lng: 115.0852, place_name: null })), 'same point within 300 m');

console.log(`afisha-rank: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
