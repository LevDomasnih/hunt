// Wave 7 · Афиша: pure parts (no D1, no Env) — occurrences of recurring events, the recommendation score with its "why",
// the diversity re-rank and the feed filters. Checked by scripts/test-wave7-rank.mts (node --experimental-strip-types).

export const CATEGORIES = ['culture', 'nature', 'sport', 'dance', 'music', 'food', 'workshop', 'party', 'wellness', 'kids', 'other',
  'bar', 'club', 'beach_club', 'social_sport', 'meetup', 'quiz'] as const;
/** The "Тусовки" tab. */
export const SOCIAL = new Set(['party', 'bar', 'club', 'beach_club', 'social_sport', 'meetup', 'quiz']);
/** Categories hidden from recommendations for a member who turned nightlife off (plus anything tagged alcohol_promo). */
export const NIGHTLIFE = new Set(['bar', 'club', 'party']);
export const LANGS = ['ru', 'en', 'id', 'mixed', 'none'];
export const OLD_TAGS = new Set(['dinner_show', 'hotel_lobby', 'ballroom', 'bus_tour', 'buffet_evening', 'timeshare', 'tour_group', 'seniors']);
export const YOUNG_TAGS = new Set(['dj', 'sunset', 'festival', 'rooftop', 'beach_club', 'meetup', 'creative', 'young_crowd', 'live']);
export const TAGS = [...OLD_TAGS, ...YOUNG_TAGS, 'alcohol_promo'];
/** Profile interests → categories/topics they lift. */
export const INTERESTS: Record<string, string[]> = {
  nightlife: ['party', 'bar', 'club', 'beach_club', 'dj', 'sunset_session'], sport: ['social_sport', 'sport', 'padel', 'run_club', 'volleyball'],
  surf: ['surf', 'surf_meetup'], culture: ['culture', 'kecak', 'temple', 'ceremony', 'dance'], nature: ['nature', 'waterfall', 'volcano', 'sunrise_hike', 'snorkel'],
  food: ['food', 'market', 'cooking_class'], wellness: ['wellness', 'yoga', 'meditation'], music: ['music', 'live_music', 'dance', 'festival'],
  creative: ['workshop', 'cinema'], social: ['meetup', 'quiz', 'language_exchange'],
};

// ---------------------------------------------------------------- dates

const DAY_MS = 864e5;
export const addDay = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);
/** ISO weekday 1 = Monday … 7 = Sunday of a YYYY-MM-DD. */
export const isoWd = (d: string) => { const w = new Date(d + 'T00:00:00Z').getUTCDay(); return w === 0 ? 7 : w; };
const pad = (n: number) => String(n).padStart(2, '0');
/** "+08:00" of a timezone on a day (no DST in our regions, but computed anyway). */
export function tzOffset(tz: string, day: string): string {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(new Date(day + 'T12:00:00Z'));
    const v = p.find((x) => x.type === 'timeZoneName')?.value ?? 'GMT';
    const m = v.match(/([+-])(\d{1,2}):?(\d{2})?/);
    return m ? `${m[1]}${pad(Number(m[2]))}:${m[3] ?? '00'}` : '+00:00';
  } catch { return '+00:00'; }
}
/** Local YYYY-MM-DD and minutes of the day of an ISO-with-offset string (as written, no conversion). */
export const localDayOf = (iso: string) => String(iso).slice(0, 10);
export const localMinOf = (iso: string) => { const m = String(iso).match(/T(\d{2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };

export interface Recurrence { freq: 'daily' | 'weekly' | 'monthly' | 'seasonal'; time: string; end?: string; weekdays?: number[]; day?: number; nth?: number; months?: number[]; from?: string; until?: string }

/** Does a recurring event happen on this local day? */
export function recursOn(r: Recurrence, day: string): boolean {
  if (r.from && day < r.from) return false;
  if (r.until && day > r.until) return false;
  const wd = isoWd(day);
  const month = Number(day.slice(5, 7)), dom = Number(day.slice(8, 10));
  if (r.freq === 'daily') return true;
  if (r.freq === 'weekly') return !!r.weekdays?.includes(wd);
  if (r.freq === 'seasonal') return !!r.months?.includes(month) && (!r.weekdays?.length || r.weekdays.includes(wd));
  if (r.freq === 'monthly') {
    if (r.day) return dom === r.day;
    if (r.nth && r.weekdays?.length && r.weekdays[0] === wd) {
      if (r.nth > 0) return Math.ceil(dom / 7) === r.nth;
      return Number(addDay(day, 7).slice(5, 7)) !== month; // last <weekday> of the month
    }
  }
  return false;
}

export interface Occurrence { occ: string; starts_at: string; ends_at: string | null }
/** Occurrences between two local days (inclusive). One-off: its own day if inside. */
export function occurrences(ev: { starts_at: string | null; ends_at: string | null; recurrence: Recurrence | null }, from: string, to: string, tz: string): Occurrence[] {
  const out: Occurrence[] = [];
  const r = ev.recurrence;
  if (!r) {
    if (!ev.starts_at) return out;
    const d = localDayOf(ev.starts_at);
    const endDay = ev.ends_at ? localDayOf(ev.ends_at) : d;
    // A multi-day event (festival) shows on each of its days inside the window.
    for (let x = d < from ? from : d; x <= endDay && x <= to; x = addDay(x, 1)) out.push({ occ: x, starts_at: x === d ? ev.starts_at : `${x}T${ev.starts_at.slice(11)}`, ends_at: ev.ends_at });
    return out;
  }
  if (!/^\d{2}:\d{2}$/.test(r.time ?? '')) return out;
  for (let d = from; d <= to; d = addDay(d, 1)) {
    if (!recursOn(r, d)) continue;
    const off = tzOffset(tz, d);
    const end = r.end && /^\d{2}:\d{2}$/.test(r.end) ? `${r.end < r.time ? addDay(d, 1) : d}T${r.end}:00${off}` : null;
    out.push({ occ: d, starts_at: `${d}T${r.time}:00${off}`, ends_at: end });
  }
  return out;
}
/** "Каждый понедельник" / "Every Monday", "Каждый день", "По пятницам" … */
const WD_RU_EVERY = ['', 'Каждый понедельник', 'Каждый вторник', 'Каждую среду', 'Каждый четверг', 'Каждую пятницу', 'Каждую субботу', 'Каждое воскресенье'];
const WD_EN = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export function recurringLabel(r: Recurrence | null): { ru: string; en: string } | null {
  if (!r) return null;
  if (r.freq === 'daily') return { ru: 'Каждый день', en: 'Every day' };
  if (r.freq === 'weekly' && r.weekdays?.length === 1) return { ru: WD_RU_EVERY[r.weekdays[0]], en: `Every ${WD_EN[r.weekdays[0]]}` };
  if (r.freq === 'weekly' && r.weekdays?.length) return { ru: 'Каждую неделю', en: 'Every week' };
  if (r.freq === 'monthly') return { ru: 'Раз в месяц', en: 'Monthly' };
  if (r.freq === 'seasonal') return { ru: 'В сезон', en: 'In season' };
  return null;
}

// ---------------------------------------------------------------- scoring

export interface RankItem {
  key: string; id: string; occ: string; starts_at: string; ends_at: string | null; title: string;
  category: string; topic: string | null; organizer_key: string | null; place_key: string | null;
  lang: string | null; price_kind: string; price: number | null; tags: string[]; quality: number | null; source_rep: number | null;
  photo_score: number | null; place_tier: number | null; in_user_list: boolean; minutes: number | null; sea: boolean; outdoor: boolean;
  sea_state: { calm: boolean; wave: number | null; wind: number | null } | null; age_min: number | null; booking: string;
  /** wave 8.1: another city with no home point to measure from (distance unknown); a ranking signal only, like minutes > 60 */
  other_city?: boolean;
  /** wave 9: instance-wide members' ratings of this place / organizer */
  venue?: { avg: number; n: number } | null;
}
export interface FeedbackRow { user_id: string; event_id: string; category: string | null; topic: string | null; organizer_key: string | null; place_key: string | null;
  liked: number; nope: number; want: number; bookmark: number; attended: number; rating: number | null; updated_at: string }
export interface MemberTaste { user_id: string; name: string; interests: string[]; age_band: string | null; nightlife: boolean | null }
export interface RankCtx {
  now: number; // ms
  members: MemberTaste[];
  feedback: FeedbackRow[];
  viewer: string | null; // user id of who is looking (nightlife opt-out applies to them)
  busy: { from: number; to: number; why: 'viewing' }[];
  blocked: Map<string, 'nyepi' | 'moveout' | 'holiday'>; // local day → why (nyepi = skip; others = penalty)
  payDays: Set<string>;
  rings: number[]; weights: number[];
  priceMedian: number | null;
}
export interface Why { k: string; v: number; ru: string; en: string }
export interface Scored extends RankItem { score: number; parts: Why[]; why: { ru: string; en: string } | null; new_for_you: boolean; excluded: string | null; far?: boolean }

const CAT_RU: Record<string, string> = { culture: 'местную культуру', nature: 'природу', sport: 'спорт', dance: 'танцы', music: 'живую музыку', food: 'рынки и еду',
  workshop: 'мастер-классы', party: 'вечеринки', wellness: 'йогу и практики', kids: 'детские события', other: 'необычное', bar: 'бары', club: 'клубы',
  beach_club: 'бич-клубы', social_sport: 'спорт компанией', meetup: 'знакомства', quiz: 'квизы и караоке' };
const CAT_EN: Record<string, string> = { culture: 'local culture', nature: 'nature', sport: 'sport', dance: 'dancing', music: 'live music', food: 'markets and food',
  workshop: 'workshops', party: 'parties', wellness: 'yoga and practices', kids: 'kids events', other: 'odd things', bar: 'bars', club: 'clubs',
  beach_club: 'beach clubs', social_sport: 'sport together', meetup: 'meetups', quiz: 'quizzes and karaoke' };
const TOPIC_RU: Record<string, string> = { sunset_session: 'закаты', sunset: 'закаты', kecak: 'кечак', fire_show: 'огненные шоу', surf: 'сёрф', surf_meetup: 'сёрф',
  snorkel: 'снорклинг', diving: 'дайвинг', padel: 'падел', yoga: 'йогу', dj: 'диджеев', live_music: 'живую музыку', market: 'маркеты', waterfall: 'водопады',
  volcano: 'рассветы на вулкане', sunrise_hike: 'рассветы', dance: 'танцы', quiz: 'квизы', karaoke: 'караоке', beach_club: 'бич-клубы', festival: 'фестивали', cinema: 'кино' };
const TOPIC_EN: Record<string, string> = { sunset_session: 'sunsets', sunset: 'sunsets', kecak: 'kecak', fire_show: 'fire shows', surf: 'surfing', surf_meetup: 'surfing',
  snorkel: 'snorkelling', diving: 'diving', padel: 'padel', yoga: 'yoga', dj: 'DJ sets', live_music: 'live music', market: 'markets', waterfall: 'waterfalls',
  volcano: 'volcano sunrises', sunrise_hike: 'sunrises', dance: 'dancing', quiz: 'quizzes', karaoke: 'karaoke', beach_club: 'beach clubs', festival: 'festivals', cinema: 'cinema' };

const HALF_LIFE_DAYS = 30;
const decay = (at: string, now: number) => Math.pow(0.5, Math.max(0, now - Date.parse(at)) / DAY_MS / HALF_LIFE_DAYS);
/** One member's feelings about a feedback row, decayed: positive = liked/want/bookmark/attended (+ rating), negative = не моё. */
function rowWeight(f: FeedbackRow, now: number): number {
  let w = 0;
  if (f.liked) w += 1;
  if (f.want) w += 1.2;
  if (f.bookmark) w += 0.6;
  if (f.attended) w += attendedWeight(f.rating);
  if (f.nope) w -= 1;
  return w * decay(f.updated_at, now);
}
/** Wave 9: the taste weight of one attended event. Being there and rating it beats a like (like = 1, want = 1.2). */
export const RATING_W = [0, -1.5, -0.6, 0.6, 2.2, 3] as const;
export const attendedWeight = (rating: number | null | undefined) => (rating ? RATING_W[Math.max(1, Math.min(5, Math.round(rating)))] : 0.8);
/** Wave 9: instance-wide quality of a place or organizer from members' ratings (avg 1..5, n ratings) → a ranking boost. */
export function venueBoost(v: { avg: number; n: number } | null | undefined) {
  if (!v || !v.n) return 0;
  return Math.round((v.avg - 3) * 0.35 * Math.min(1, v.n / 3) * 100) / 100;
}
/** Wave 9: "вам понравилось" — the best rating (≥ 4) this group gave the same event (a recurring night), place or organizer. */
export function likedBefore(fb: FeedbackRow[], it: { id: string; place_key: string | null; organizer_key: string | null }): { rating: number; users: string[] } | null {
  const hits = fb.filter((f) => f.attended && (f.rating ?? 0) >= 4 && (f.event_id === it.id || (it.place_key && f.place_key === it.place_key) || (it.organizer_key && f.organizer_key === it.organizer_key)));
  if (!hits.length) return null;
  return { rating: Math.max(...hits.map((f) => f.rating ?? 0)), users: [...new Set(hits.map((f) => f.user_id))] };
}
const firstName = (n: string) => String(n ?? '').split(/\s+/)[0] || n;

export function hourBand(min: number): 'morning' | 'day' | 'evening' | 'night' {
  const h = Math.floor(min / 60);
  return h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'day' : h >= 17 && h < 22 ? 'evening' : 'night';
}
const BAND_RU = { morning: 'утром', day: 'днём', evening: 'вечером', night: 'ночью' };
const BAND_EN = { morning: 'in the morning', day: 'in the afternoon', evening: 'in the evening', night: 'at night' };

/** Score one occurrence for a group of members. Exclusions return excluded = reason (and are dropped by the feed). */
export function scoreItem(it: RankItem, ctx: RankCtx): Scored {
  const parts: Why[] = [];
  const add = (k: string, v: number, ru = '', en = '') => { if (v) parts.push({ k, v, ru, en }); };
  let excluded: string | null = null;
  const start = Date.parse(it.starts_at);
  const end = it.ends_at ? Date.parse(it.ends_at) : start + 2 * 3600e3;
  if (end < ctx.now) excluded = 'past';
  if (ctx.blocked.get(it.occ) === 'nyepi') excluded = 'nyepi';
  const viewer = ctx.members.find((m) => m.user_id === ctx.viewer);
  if (viewer?.nightlife === false && (it.tags.includes('alcohol_promo') || NIGHTLIFE.has(it.category))) excluded = 'nightlife_off';

  // --- taste: members' feedback per event, category, topic, organizer and place (decayed), profile interests, Google lists
  const fb = ctx.feedback;
  const own = fb.filter((f) => f.event_id === it.id);
  if (own.some((f) => f.nope)) add('nope_item', -3);
  const perMember = new Map<string, number>();
  let cat = 0, topic = 0, org = 0, place = 0;
  for (const f of fb) {
    const w = rowWeight(f, ctx.now);
    if (!w) continue;
    // "Не моё" lowers the category only slightly and never kills it (capped below).
    const wc = w < 0 ? w * 0.3 : w;
    if (f.category === it.category) { cat += wc * 0.5; perMember.set(f.user_id, (perMember.get(f.user_id) ?? 0) + wc); }
    if (it.topic && f.topic === it.topic) { topic += wc * 0.6; perMember.set(f.user_id, (perMember.get(f.user_id) ?? 0) + wc); }
    if (it.organizer_key && f.organizer_key === it.organizer_key && f.event_id !== it.id) org += (f.attended && f.rating ? (f.rating - 3) * 0.4 : 0) + (w > 0 ? 0.2 : 0);
    // wave 9: a rated visit to the same place (or an earlier night of the same recurring event) is the strongest signal
    if (it.place_key && f.place_key === it.place_key && f.event_id !== it.id) place += f.attended && f.rating ? (f.rating - 3) * 0.35 : w > 0 ? 0.25 : 0;
    if (f.event_id === it.id && f.attended && f.rating) place += (f.rating - 3) * 0.35;
  }
  cat = Math.max(-0.6, Math.min(2, cat));
  topic = Math.max(-0.4, Math.min(1.5, topic));
  const fans = ctx.members.filter((m) => (perMember.get(m.user_id) ?? 0) > 0.4);
  const word = (lang: 'ru' | 'en') => (it.topic && (lang === 'ru' ? TOPIC_RU : TOPIC_EN)[it.topic]) || (lang === 'ru' ? CAT_RU : CAT_EN)[it.category] || it.category;
  const tasteWhy = fans.length >= 2
    ? { ru: `${fans.length === 2 ? 'вы оба' : 'вы все'} отмечали ${word('ru')}`, en: `${fans.length === 2 ? 'you both' : 'you all'} liked ${word('en')}` }
    : fans.length === 1 ? { ru: `${firstName(fans[0].name)} любит ${word('ru')}`, en: `${firstName(fans[0].name)} likes ${word('en')}` } : { ru: '', en: '' };
  add('taste', cat + topic, tasteWhy.ru, tasteWhy.en);
  if (org) add('organizer', Math.min(1, org), org > 0.3 ? 'этому организатору вы ставили высокие оценки' : '', org > 0.3 ? 'you rated this organizer highly' : '');
  if (place) add('place', Math.max(-0.8, Math.min(1, place)), place >= 0.5 ? 'вам здесь понравилось' : '', place >= 0.5 ? 'you liked it here' : '');
  // wave 9: instance-wide ratings of the place / organizer (all searches of this instance)
  const vb = venueBoost(it.venue ?? null);
  if (vb) add('venue', vb, vb >= 0.3 ? 'тут высоко оценивают' : '', vb >= 0.3 ? 'rated highly here' : '');
  // Profile interests (the default before feedback): a member's interest that maps to this category/topic.
  const intFans = ctx.members.filter((m) => m.interests.some((i) => (INTERESTS[i] ?? []).some((x) => x === it.category || x === it.topic)));
  if (intFans.length) add('interest', Math.min(0.9, 0.45 * intFans.length), intFans.length === 1 ? `${firstName(intFans[0].name)} любит ${word('ru')}` : `под ваш вкус: ${word('ru')}`,
    intFans.length === 1 ? `${firstName(intFans[0].name)} likes ${word('en')}` : `your kind of thing: ${word('en')}`);
  if (it.in_user_list) add('list', 0.7, 'место из вашего списка в Google', 'a place from your Google list');

  // --- youth fit (the audience is ~20–30): down-rank tour-group / older formats unless someone liked that kind of thing,
  // up-rank parties, sunsets, festivals, meetups, creative things and late nightlife. A feature, never a ban.
  const old = it.tags.filter((t) => OLD_TAGS.has(t)).length;
  const young = it.tags.filter((t) => YOUNG_TAGS.has(t)).length;
  const someoneLikes = cat + topic > 0.3;
  let yf = -Math.min(1.6, old * 0.8) * (someoneLikes ? 0.4 : 1) + Math.min(1, young * 0.35);
  if (SOCIAL.has(it.category) && localMinOf(it.starts_at) >= 20 * 60) yf += 0.25;
  const youngBand = ctx.members.filter((m) => m.age_band && m.age_band !== '40+').length || (ctx.members.some((m) => m.age_band) ? 0 : 1);
  if (!youngBand) yf *= 0.3; // an older group: the youth signal barely matters
  if (it.price != null && ctx.priceMedian && it.price > ctx.priceMedian * 4) yf -= 0.2; // premium packages skew older/touristy
  add('youth', yf, young >= 2 || (young && SOCIAL.has(it.category)) ? 'молодая тусовка' : '', young >= 2 || (young && SOCIAL.has(it.category)) ? 'young crowd' : '');

  // --- quality: source reputation, the agent's quality hint, the photo, place tier
  const q = (it.source_rep ?? 0.5) * 0.6 + (it.quality ?? 0.5) * 0.8 + (it.photo_score ?? 0.4) * 0.3 + (it.place_tier === 1 ? 0.3 : it.place_tier === 2 ? 0.1 : 0);
  add('quality', q - 0.8); // centred: an average event adds ~0

  // --- fit: distance ring, calendar, sea and weather
  // wave 8.1: no hard distance cutoff — the whole region is shown, far events (> 60 min, or another city without a home point)
  // only sink: the penalty grows with the ride, so Ubud from Ungasan lands at the end unless the group loves exactly that
  if (it.minutes != null) {
    const i = ctx.rings.findIndex((r) => it.minutes! <= r);
    const w = i >= 0 ? ctx.weights[i] ?? 0.3 : -0.3;
    const far = it.minutes > 60 ? Math.min(2.2, 0.9 + ((it.minutes - 60) / 60) * 0.9) : 0;
    add('distance', w * 0.6 - far, i === 0 ? `${it.minutes} мин на байке` : '', i === 0 ? `${it.minutes} min by bike` : '');
  } else if (it.other_city) add('distance', -1.2);
  const far = (it.minutes != null && it.minutes > 60) || !!it.other_city;
  if (ctx.busy.some((b) => start < b.to && end > b.from)) add('busy', -2.5);
  const bl = ctx.blocked.get(it.occ);
  if (bl === 'moveout') add('busy', -1.5);
  else if (bl === 'holiday') add('busy', -0.3);
  if (ctx.payDays.has(it.occ)) add('payday', -0.2);
  if (it.sea && it.sea_state) {
    const band = hourBand(localMinOf(it.starts_at));
    if (it.sea_state.calm) add('sea', 0.6, `море ${BAND_RU[band]} спокойное`, `calm sea ${BAND_EN[band]}`);
    else add('sea', -2.5);
  }
  if (it.price_kind === 'free') add('free', 0.15, 'бесплатно', 'free');

  // --- exploration flag: nobody in the group showed interest in this category or topic yet
  const known = fb.some((f) => (f.category === it.category || (it.topic && f.topic === it.topic)) && rowWeight(f, ctx.now) > 0) || intFans.length > 0;
  const score = parts.reduce((s, p) => s + p.v, 0);
  return { ...it, score: Math.round(score * 100) / 100, parts, why: whyOf(parts, !known), new_for_you: !known, excluded, far };
}

/** The "why for you" line: the one or two strongest positive signals that have words. */
export function whyOf(parts: Why[], newForYou: boolean): { ru: string; en: string } | null {
  let pos = parts.filter((p) => p.v > 0 && p.ru).sort((a, b) => b.v - a.v);
  // Feedback and profile interests say the same thing: keep the stronger of the two.
  if (pos.some((p) => p.k === 'taste') && pos.some((p) => p.k === 'interest')) pos = pos.filter((p) => p.k !== (pos.find((x) => x.k === 'taste' || x.k === 'interest')!.k === 'taste' ? 'interest' : 'taste'));
  const top = pos.slice(0, 2);
  if (!top.length) return newForYou ? { ru: 'новое для вас', en: 'something new for you' } : null;
  return { ru: top.map((p) => p.ru).join(' · '), en: top.map((p) => p.en).join(' · ') };
}

// ---------------------------------------------------------------- the good shuffle

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Diversity re-rank of one day's scored items: a seeded jitter among items above the quality floor ("Ещё" = a new seed),
 * then greedy: never two of the same category in a row, at most `orgCap` per organizer, and at least one "new for you"
 * in the first five (plus ~20 % of the slots offered to exploration). Items below the floor go last in score order.
 */
export function diversify(items: Scored[], opts: { seed: number; orgCap?: number; explore?: number; jitter?: number; floor?: number } ): Scored[] {
  const R = rng(opts.seed || 1);
  const orgCap = opts.orgCap ?? 2, explore = opts.explore ?? 0.2, jitter = opts.jitter ?? 0.8;
  const live = items.filter((x) => !x.excluded);
  if (!live.length) return [];
  const best = Math.max(...live.map((x) => x.score));
  const floor = opts.floor ?? best - 4;
  const above = live.filter((x) => x.score >= floor).map((x) => ({ x, k: x.score + (opts.seed ? R() * jitter : 0) })).sort((a, b) => b.k - a.k).map((y) => y.x);
  const below = live.filter((x) => x.score < floor).sort((a, b) => b.score - a.score);
  const out: Scored[] = [];
  const orgN = new Map<string, number>();
  const pool = [...above];
  const fits = (x: Scored, strict: boolean) => {
    const last = out[out.length - 1];
    if (last && last.category === x.category && strict) return false;
    if (x.organizer_key && (orgN.get(x.organizer_key) ?? 0) >= orgCap && strict) return false;
    return true;
  };
  while (pool.length) {
    const wantExplore = (out.length === 4 && !out.some((y) => y.new_for_you)) || (out.length > 0 && R() < explore);
    let i = wantExplore ? pool.findIndex((x) => x.new_for_you && fits(x, true)) : -1;
    if (i < 0) i = pool.findIndex((x) => fits(x, true));
    if (i < 0) i = pool.findIndex((x) => fits(x, false) && !(out.length && out[out.length - 1].category === x.category));
    if (i < 0) i = 0; // only one category left: allow repeats rather than dropping events
    const [x] = pool.splice(i, 1);
    out.push(x);
    if (x.organizer_key) orgN.set(x.organizer_key, (orgN.get(x.organizer_key) ?? 0) + 1);
  }
  return [...out, ...below];
}

// ---------------------------------------------------------------- filters

/** Feed filter tokens: ru en id none · free paid · morning day evening night · r10 r20 r40 (ring minutes) · book · beginner ·
 *  bars clubs sport (Тусовки) · c:<category>. Language: RU = ru or "без слов"; EN = en, mixed or "без слов". */
export function passFilters(it: { lang: string | null; price_kind: string; starts_at: string; minutes: number | null; booking: string; beginner?: boolean; category: string }, f: Set<string>): boolean {
  const langs: string[] = [];
  if (f.has('ru')) langs.push('ru', 'none');
  if (f.has('en')) langs.push('en', 'mixed', 'none');
  if (f.has('id')) langs.push('id', 'mixed', 'none');
  if (f.has('none')) langs.push('none');
  if (langs.length && !langs.includes(it.lang ?? '')) return false;
  if (f.has('free') && it.price_kind !== 'free') return false;
  if (f.has('paid') && it.price_kind === 'free') return false;
  const bands = ['morning', 'day', 'evening', 'night'].filter((b) => f.has(b));
  if (bands.length && !bands.includes(hourBand(localMinOf(it.starts_at)))) return false;
  for (const r of [10, 20, 40]) if (f.has('r' + r) && (it.minutes == null || it.minutes > r)) return false;
  if (f.has('book') && it.booking === 'none') return false;
  if (f.has('beginner') && !it.beginner) return false;
  const soc: string[] = [];
  if (f.has('bars')) soc.push('bar', 'quiz');
  if (f.has('clubs')) soc.push('club', 'party', 'beach_club');
  if (f.has('sport')) soc.push('social_sport');
  if (soc.length && !soc.includes(it.category)) return false;
  const cats = [...f].filter((x) => x.startsWith('c:')).map((x) => x.slice(2));
  if (cats.length && !cats.includes(it.category)) return false;
  return true;
}

// ---------------------------------------------------------------- dedupe

export const normTitle = (s: string) => String(s ?? '').toLowerCase().replace(/[«»"'’`.,!?:;()\-–—|/\\#@]+/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s: string) => new Set(normTitle(s).split(' ').filter((w) => w.length > 2));
export function titleSimilar(a: string, b: string): boolean {
  const na = normTitle(a), nb = normTitle(b);
  if (!na || !nb) return false;
  if (na === nb || na.startsWith(nb) || nb.startsWith(na)) return true;
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return false;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size) >= 0.6;
}
export function kmBetween(a: [number, number], b: [number, number]) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export interface DupeKey { title: string; starts_at: string | null; recurrence: Recurrence | null; place_name: string | null; lat: number | null; lng: number | null }
/** Same title (≥ 0.6 token overlap), start within ±60 min (recurring: same time ±60 and overlapping weekdays), same place. */
export function isDuplicate(a: DupeKey, b: DupeKey): boolean {
  if (!titleSimilar(a.title, b.title)) return false;
  if (!!a.recurrence !== !!b.recurrence) {
    // A one-off post about a recurring night is the same event when it falls on one of its days at the same time.
    const r = (a.recurrence ?? b.recurrence)!, one = a.recurrence ? b : a;
    if (!one.starts_at || !recursOn({ ...r, from: undefined, until: undefined }, localDayOf(one.starts_at))) return false;
    if (Math.abs(localMinOf(one.starts_at) - Number(r.time.slice(0, 2)) * 60 - Number(r.time.slice(3, 5))) > 60) return false;
  } else if (a.recurrence && b.recurrence) {
    const ta = Number(a.recurrence.time.slice(0, 2)) * 60 + Number(a.recurrence.time.slice(3, 5));
    const tb = Number(b.recurrence.time.slice(0, 2)) * 60 + Number(b.recurrence.time.slice(3, 5));
    if (Math.abs(ta - tb) > 60) return false;
    const wa = a.recurrence.weekdays ?? [1, 2, 3, 4, 5, 6, 7], wb = b.recurrence.weekdays ?? [1, 2, 3, 4, 5, 6, 7];
    if (a.recurrence.freq !== 'daily' && b.recurrence.freq !== 'daily' && !wa.some((w) => wb.includes(w))) return false;
  } else {
    if (!a.starts_at || !b.starts_at || Math.abs(Date.parse(a.starts_at) - Date.parse(b.starts_at)) > 3600e3) return false;
  }
  if (a.lat != null && b.lat != null && a.lng != null && b.lng != null) return kmBetween([a.lat, a.lng], [b.lat, b.lng]) <= 0.3;
  const pa = normTitle(a.place_name ?? ''), pb = normTitle(b.place_name ?? '');
  return !!pa && !!pb && (pa === pb || pa.includes(pb) || pb.includes(pa));
}
