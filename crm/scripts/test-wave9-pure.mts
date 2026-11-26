// Wave 9 · pure checks (no Worker): leave-by math, party RSVP rules (capacity, +1, who sees the address), .ics, default texts,
// the SSRF guard of the image proxy, and the "how was it" signal in the ranking.
//   node --experimental-strip-types scripts/test-wave9-pure.mts
import { leaveBy, inRush, partyCounts, canAnswer, partyVisible, icsEvent, partyNoticeText, lateText, askFeedbackNow } from '../src/evening.ts';
import { publicIp, urlBlocked, safeImageFetch, fnv, MAX_IMG } from '../src/ssrf.ts';
import { scoreItem, attendedWeight, venueBoost, likedBefore, type RankItem, type RankCtx, type FeedbackRow } from '../src/afisha-rank.ts';

let pass = 0, fail = 0;
const ok = (c: unknown, name: string, extra: unknown = '') => { if (c) pass++; else { fail++; console.log('FAIL', name, typeof extra === 'string' ? extra : JSON.stringify(extra)); } };

// ---- leave-by
const nowMs = Date.parse('2026-11-21T12:00:00+08:00');
const a = leaveBy({ starts_at: '2026-11-21T21:00:00+08:00', minutes: 14, rush_factor: 1.3, nowMs });
ok(a && a.leave_at === '20:35' && a.ride === 14 && !a.rush, 'leave-by off-peak: 21:00 − 14 − 10 → 20:35 (rounded down to 5)', a);
const b = leaveBy({ starts_at: '2026-11-21T18:00:00+08:00', minutes: 30, rush_factor: 1.5, nowMs });
ok(b && b.rush && b.ride === 45 && b.leave_at === '17:05', 'leave-by in rush: 30 × 1.5 = 45 min ride → 17:05', b);
const c = leaveBy({ starts_at: '2026-11-21T18:00:00+08:00', minutes: 30, rush_factor: null, nowMs });
ok(c && !c.rush && c.leave_at === '17:20', 'no rush factor: free-flow ride', c);
ok(leaveBy({ starts_at: '2026-11-21T21:00:00+08:00', minutes: null }) === null, 'no ride time → null');
const home = leaveBy({ starts_at: '2026-11-21T19:00:00+08:00', minutes: 0, atHome: true });
ok(home && home.leave_at === null && home.ride === 0, 'party at home: no leave-by');
const late = leaveBy({ starts_at: '2026-11-21T12:20:00+08:00', minutes: 20, nowMs });
ok(late && late.late && late.minutes_left! < 0, 'leave-by passed → late', late);
ok(inRush(8 * 60) && inRush(17 * 60) && !inRush(13 * 60) && !inRush(21 * 60), 'rush windows 07–09:30, 16:30–19:30');
const mid = leaveBy({ starts_at: '2026-11-22T00:30:00+08:00', minutes: 40, nowMs });
ok(mid && mid.leave_at === '23:40', 'leave-by wraps over midnight', mid);

// ---- party RSVP
const gs = [{ answer: 'going', plus_one: 1 }, { answer: 'going', plus_one: 0 }, { answer: 'maybe', plus_one: 0 }, { answer: 'no', plus_one: 0 }, { answer: 'going', plus_one: 1, removed: 1 }];
const cnt = partyCounts(gs, 5);
ok(cnt.going === 2 && cnt.heads === 3 && cnt.plus_ones === 1 && cnt.left === 2 && cnt.maybe === 1 && cnt.no === 1, 'counts: removed guests do not count, +1 adds a head', cnt);
ok(canAnswer({ capacity: 5, plus_one_allowed: true, heads: 3, answer: 'going', plusOne: true }).ok, 'capacity: 3 + 2 ≤ 5');
ok(!canAnswer({ capacity: 4, plus_one_allowed: true, heads: 3, answer: 'going', plusOne: true }).ok, 'capacity: 3 + 2 > 4 → full');
ok(canAnswer({ capacity: 4, plus_one_allowed: true, heads: 4, mine: { answer: 'going', plus_one: 1 }, answer: 'going', plusOne: false }).ok, 'changing my own answer frees my heads first');
ok(canAnswer({ capacity: 1, plus_one_allowed: true, heads: 9, answer: 'maybe', plusOne: false }).ok, 'maybe / no never hit the capacity');
const np = canAnswer({ capacity: null, plus_one_allowed: false, heads: 0, answer: 'going', plusOne: true });
ok(!np.ok && np.why === 'no_plus_one', '+1 refused when the party has no +1');
ok(partyVisible({ guest: { answer: 'going', plus_one: 0 } }).address === true, 'going guest sees the address');
ok(partyVisible({ guest: { answer: 'maybe', plus_one: 0 } }).address === false && partyVisible({ guest: null }).address === false, 'maybe / public page: no address');
ok(partyVisible({ guest: { answer: 'going', plus_one: 0, removed: 1 } }).address === false, 'removed guest: no address');

// ---- .ics and texts
const ics = icsEvent({ uid: 'pt_x@hunt', title: 'Закат, у бассейна; приходи', starts_at: '2026-11-23T18:30:00+08:00', ends_at: '2026-11-23T23:00:00+08:00', location: 'Jl. Demo 7, Ungasan', stamp: '2026-11-21T00:00:00Z' });
ok(ics.includes('DTSTART:20261123T103000Z') && ics.includes('DTEND:20261123T150000Z') && ics.includes('SUMMARY:Закат\\, у бассейна\\; приходи') && ics.includes('LOCATION:Jl. Demo 7\\, Ungasan') && ics.includes('\r\n'), '.ics: UTC times, escaped text, CRLF', ics);
ok(!icsEvent({ uid: 'u', title: 't', starts_at: '2026-11-23T18:30:00+08:00' }).includes('LOCATION'), '.ics without an address has no LOCATION');
const nt = partyNoticeText('id', { to: 'neighbours', day: '2026-11-23', time: '18:30', heads: 12, quiet_after: '22:00', name: 'Lev' });
ok(/tetangga/.test(nt) && nt.includes('22:00') && nt.includes('12 orang') && !nt.includes('—'), 'neighbour notice in Indonesian with the quiet hour, no dashes', nt);
ok(/quiet after 22:00/.test(partyNoticeText('xx', { to: 'owner', day: '2026-11-23', time: '18:30', heads: 3, quiet_after: '22:00', name: null })), 'unknown language → English');
ok(/опаздываем минут на 15/.test(lateText('ru', { title: 'Сальса', minutes: 15, n: 2 })), 'running late text');
ok(askFeedbackNow({ occ: '2026-11-20', today: '2026-11-21', localMin: 9 * 60 }) && !askFeedbackNow({ occ: '2026-11-20', today: '2026-11-21', localMin: 8 * 60 + 59 }), '"Как было?" from 09:00 the next morning');
ok(!askFeedbackNow({ occ: '2026-11-20', today: '2026-11-20', localMin: 10 * 60 }) && !askFeedbackNow({ occ: '2026-11-20', today: '2026-11-23', localMin: 10 * 60 }), 'not the same day, not after 2 days');

// ---- SSRF guard
for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '192.168.1.1', '172.16.5.4', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '224.0.0.1']) ok(!publicIp(ip), `private ${ip}`);
for (const ip of ['1.1.1.1', '93.184.216.34', '2606:4700::1111']) ok(publicIp(ip), `public ${ip}`);
const res = (map: Record<string, string[]>) => async (host: string) => map[host] ?? [];
ok((await urlBlocked('http://example.org/a.jpg', res({}))) === 'not_https', 'http refused');
ok((await urlBlocked('https://a.test:8443/x.jpg', res({ 'a.test': ['1.1.1.1'] }))) === 'port', 'non-default port refused');
ok((await urlBlocked('https://u:p@img.org/x.jpg', res({ 'img.org': ['1.1.1.1'] }))) === 'credentials', 'credentials refused');
ok((await urlBlocked('https://evil.org/x.jpg', res({ 'evil.org': ['1.1.1.1', '10.0.0.5'] }))) === 'private_ip', 'any private A record → refused');
ok((await urlBlocked('https://169.254.169.254/latest', res({}))) === 'private_ip', 'metadata IP literal refused');
ok((await urlBlocked('https://localhost/x', res({}))) === 'blocked', 'localhost refused');
ok((await urlBlocked('https://cdn.org/x.jpg', res({ 'cdn.org': ['93.184.216.34'] }))) === null, 'public host passes');
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
const fake = (routes: Record<string, () => Response>) => (async (u: string) => (routes[u] ?? (() => new Response('nf', { status: 404 })))()) as unknown as typeof fetch;
const R = res({ 'a.org': ['1.1.1.1'], 'b.org': ['10.1.1.1'], 'c.org': ['1.0.0.1'] });
let r = await safeImageFetch('https://a.org/x.jpg', { resolve: R, fetcher: fake({ 'https://a.org/x.jpg': () => new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } }) }) });
ok(r.ok && r.type === 'image/jpeg', 'image fetched', r);
r = await safeImageFetch('https://a.org/x.jpg', { resolve: R, fetcher: fake({ 'https://a.org/x.jpg': () => new Response(null, { status: 302, headers: { location: 'https://b.org/inner.jpg' } }) }) });
ok(!r.ok && r.fail === 'blocked', 'redirect to a private host refused', r);
r = await safeImageFetch('https://a.org/x.jpg', { resolve: R, fetcher: fake({ 'https://a.org/x.jpg': () => new Response(null, { status: 301, headers: { location: '/y.jpg' } }), 'https://a.org/y.jpg': () => new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } }) }) });
ok(r.ok, 'relative redirect on a public host followed', r);
r = await safeImageFetch('https://a.org/x.svg', { resolve: R, fetcher: fake({ 'https://a.org/x.svg': () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }) }) });
ok(!r.ok && r.fail === 'not_image', 'SVG refused', r);
r = await safeImageFetch('https://a.org/x.jpg', { resolve: R, fetcher: fake({ 'https://a.org/x.jpg': () => new Response('<html>', { headers: { 'content-type': 'image/jpeg' } }) }) });
ok(!r.ok && r.fail === 'not_image', 'declared image but HTML bytes refused', r);
r = await safeImageFetch('https://a.org/x.jpg', { resolve: R, fetcher: fake({ 'https://a.org/x.jpg': () => new Response(new Uint8Array(MAX_IMG + 10), { headers: { 'content-type': 'image/jpeg' } }) }) });
ok(!r.ok && r.fail === 'too_big', '> 5 MB refused (streamed, no content-length trust)', r);
r = await safeImageFetch('https://a.org/x.jpg', { resolve: R, fetcher: fake({ 'https://a.org/x.jpg': () => new Response('no', { status: 403 }) }) });
ok(!r.ok && r.fail === 'refused', 'hotlink protection → refused', r);
r = await safeImageFetch('https://a.org/gone.jpg', { resolve: R, fetcher: fake({}) });
ok(!r.ok && r.fail === '404', '404 → stale', r);
ok(fnv('https://x/a.jpg') !== fnv('https://x/b.jpg') && /^[a-z0-9]+$/.test(fnv('x')), 'photo version hash');

// ---- "how was it" signal
ok(attendedWeight(5) > 1.2 && attendedWeight(4) > 1.2 && attendedWeight(1) < 0, 'attended + 4–5 beats like (1) and want (1.2); 1 is negative');
ok(venueBoost({ avg: 4.8, n: 3 }) > 0.5 && venueBoost({ avg: 2, n: 4 }) < 0 && venueBoost({ avg: 5, n: 1 }) < venueBoost({ avg: 5, n: 3 }), 'venue boost grows with avg and n');
const T0 = Date.parse('2026-11-21T10:00:00Z');
const item = (id: string, over: Partial<RankItem> = {}): RankItem => ({ key: id + '@d', id, occ: '2026-11-22', starts_at: '2026-11-22T20:00:00+08:00', ends_at: null, title: id, category: 'music', topic: 'live_music',
  organizer_key: null, place_key: null, lang: 'en', price_kind: 'paid', price: null, tags: [], quality: 0.5, source_rep: 0.5, photo_score: null, place_tier: null, in_user_list: false, minutes: 15,
  sea: false, outdoor: false, sea_state: null, age_min: null, booking: 'none', ...over });
const ctx = (fb: FeedbackRow[]): RankCtx => ({ now: T0, members: [{ user_id: 'u1', name: 'A', interests: [], age_band: null, nightlife: null }], feedback: fb, viewer: 'u1', busy: [], blocked: new Map(), payDays: new Set(), rings: [10, 20, 40], weights: [1, 0.7, 0.3], priceMedian: null });
const fbRow = (o: Partial<FeedbackRow>): FeedbackRow => ({ user_id: 'u1', event_id: 'old', category: 'dance', topic: 'dance', organizer_key: null, place_key: null, liked: 0, nope: 0, want: 0, bookmark: 0, attended: 0, rating: null, updated_at: new Date(T0 - 864e5).toISOString(), ...o });
const likedOnly = scoreItem(item('x', { category: 'dance', topic: 'dance' }), ctx([fbRow({ liked: 1 })])).score;
const went5 = scoreItem(item('x', { category: 'dance', topic: 'dance' }), ctx([fbRow({ attended: 1, rating: 5 })])).score;
const went1 = scoreItem(item('x', { category: 'dance', topic: 'dance' }), ctx([fbRow({ attended: 1, rating: 1 })])).score;
ok(went5 > likedOnly && went1 < likedOnly, 'attended + rating 5 ranks above a like; rating 1 below', { likedOnly, went5, went1 });
const placeLiked = scoreItem(item('y', { place_key: 'p:club' }), ctx([fbRow({ attended: 1, rating: 5, place_key: 'p:club' })]));
ok(placeLiked.parts.some((p) => p.k === 'place' && p.v >= 0.5) && placeLiked.why?.ru.includes('понравилось'), 'repeat venue rated 5 → "вам здесь понравилось" in why', placeLiked.why);
const rec = scoreItem(item('night'), ctx([fbRow({ event_id: 'night', attended: 1, rating: 2, category: 'music', topic: 'live_music' })]));
ok(rec.parts.some((p) => p.k === 'place' && p.v < 0), 'a recurring night rated 2 sinks next time', rec.parts);
const venue = scoreItem(item('z', { venue: { avg: 4.7, n: 5 } }), ctx([]));
ok(venue.parts.some((p) => p.k === 'venue' && p.v > 0.3), 'instance-wide venue rating lifts the event', venue.parts);
const lb = likedBefore([fbRow({ attended: 1, rating: 4, place_key: 'p:club' })], { id: 'q', place_key: 'p:club', organizer_key: null });
ok(lb?.rating === 4 && lb.users[0] === 'u1', 'likedBefore: rated ≥ 4 at the same place');
ok(likedBefore([fbRow({ liked: 1, place_key: 'p:club' })], { id: 'q', place_key: 'p:club', organizer_key: null }) === null, 'likedBefore needs attended + rating');

console.log(`wave 9 pure: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
