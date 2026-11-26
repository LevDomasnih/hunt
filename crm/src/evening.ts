// Wave 9 · pure parts (no D1, no Env): leave-by time for tonight's event, the party RSVP rules (who sees the address, capacity),
// the .ics file, the default texts to the house owner / neighbours and to an organizer when running late, the "how was it"
// signal. Checked by scripts/test-wave9-pure.mts (node --experimental-strip-types).

// ---------------------------------------------------------------- leave-by

/** Local minutes of the day of an ISO-with-offset string (as written). */
export const minOfDay = (iso: string) => { const m = String(iso).match(/T(\d{2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };
/** Rush hours on island/city roads (local): 07:00–09:30 and 16:30–19:30. */
export const RUSH: [number, number][] = [[7 * 60, 9 * 60 + 30], [16 * 60 + 30, 19 * 60 + 30]];
export const inRush = (min: number) => RUSH.some(([a, b]) => min >= a && min < b);
export const PARK_MIN = 10; // parking the bike, finding the place
const fmtHM = (min: number) => { const m = ((min % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

/**
 * When to leave for an event: free-flow ride minutes (already road-corrected, see wave5.minutesKm), times the city's rush
 * factor when the ride falls into rush hours, plus PARK_MIN; rounded down to 5 minutes. Returns null without a ride time.
 * `atHome` = the event is at the home itself (a party): no ride.
 */
export function leaveBy(o: { starts_at: string; minutes: number | null; rush_factor?: number | null; atHome?: boolean; nowMs?: number }) {
  if (o.atHome) return { leave_at: null, ride: 0, rush: false, minutes_left: null, late: false, label: null as string | null };
  if (o.minutes == null || !Number.isFinite(o.minutes)) return null;
  const start = minOfDay(o.starts_at);
  const f = o.rush_factor && o.rush_factor > 1 ? o.rush_factor : 1;
  // The ride ends at the start: rush if the departure or the arrival sits in a rush window.
  const freeLeave = start - o.minutes - PARK_MIN;
  const rush = f > 1 && (inRush(freeLeave) || inRush(start - PARK_MIN));
  const ride = Math.ceil(o.minutes * (rush ? f : 1));
  const leaveMin = Math.floor((start - ride - PARK_MIN) / 5) * 5;
  const startMs = Date.parse(o.starts_at);
  const leaveMs = Number.isFinite(startMs) ? startMs - (start - leaveMin) * 60e3 : NaN;
  const now = o.nowMs ?? Date.now();
  const left = Number.isFinite(leaveMs) ? Math.round((leaveMs - now) / 60e3) : null;
  return { leave_at: fmtHM(leaveMin), ride, rush, minutes_left: left, late: left != null && left < 0, label: fmtHM(leaveMin) };
}

// ---------------------------------------------------------------- party RSVP

export const ANSWERS = ['going', 'maybe', 'no'] as const;
export type Answer = (typeof ANSWERS)[number];
export interface GuestLike { answer: string; plus_one: number; removed?: number | boolean }
/** Heads that count against the capacity: "going" guests plus their +1. */
export function partyCounts(guests: GuestLike[], capacity: number | null) {
  const live = guests.filter((g) => !g.removed);
  const going = live.filter((g) => g.answer === 'going');
  const plus = going.reduce((n, g) => n + (g.plus_one ? 1 : 0), 0);
  const heads = going.length + plus;
  return { going: going.length, maybe: live.filter((g) => g.answer === 'maybe').length, no: live.filter((g) => g.answer === 'no').length, plus_ones: plus, heads,
    left: capacity == null ? null : Math.max(0, capacity - heads) };
}
/** May this guest switch to `answer` with `plusOne`? (Their own current heads are freed first.) */
export function canAnswer(o: { capacity: number | null; plus_one_allowed: boolean; heads: number; mine?: GuestLike | null; answer: Answer; plusOne: boolean }): { ok: true } | { ok: false; why: 'full' | 'no_plus_one' } {
  if (o.plusOne && !o.plus_one_allowed && o.answer === 'going') return { ok: false, why: 'no_plus_one' };
  if (o.answer !== 'going' || o.capacity == null) return { ok: true };
  const mineHeads = o.mine && !o.mine.removed && o.mine.answer === 'going' ? 1 + (o.mine.plus_one ? 1 : 0) : 0;
  const need = 1 + (o.plusOne ? 1 : 0);
  return o.heads - mineHeads + need <= o.capacity ? { ok: true } : { ok: false, why: 'full' };
}
/** What a page viewer may see: the exact address, how to get there and the Wi-Fi only on a "going" guest's personal link. */
export function partyVisible(viewer: { guest?: GuestLike | null }) {
  const going = !!viewer.guest && !viewer.guest.removed && viewer.guest.answer === 'going';
  return { address: going, how_to: going, wifi: going };
}

// ---------------------------------------------------------------- .ics

const icsEsc = (s: string) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsUtc = (iso: string) => new Date(Date.parse(iso)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** Fold a content line at 74 octets-ish (characters; good enough for calendar apps). */
const fold = (l: string) => { const out: string[] = []; for (let i = 0; i < l.length; i += 73) out.push((i ? ' ' : '') + l.slice(i, i + 73)); return out.join('\r\n'); };
export function icsEvent(o: { uid: string; title: string; starts_at: string; ends_at?: string | null; location?: string | null; description?: string | null; url?: string | null; stamp?: string }) {
  const end = o.ends_at && Date.parse(o.ends_at) > Date.parse(o.starts_at) ? o.ends_at : new Date(Date.parse(o.starts_at) + 4 * 3600e3).toISOString();
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//hunt//party//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${o.uid}`, `DTSTAMP:${icsUtc(o.stamp ?? new Date().toISOString())}`, `DTSTART:${icsUtc(o.starts_at)}`, `DTEND:${icsUtc(end)}`, `SUMMARY:${icsEsc(o.title)}`,
    ...(o.location ? [`LOCATION:${icsEsc(o.location)}`] : []), ...(o.description ? [`DESCRIPTION:${icsEsc(o.description)}`] : []), ...(o.url ? [`URL:${o.url}`] : []),
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(o.title)}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'];
  return lines.map(fold).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- default texts (short, human; approval as usual)

const DATE_FMT: Record<string, Intl.DateTimeFormatOptions> = { ru: { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' }, en: { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }, id: { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' } };
const LOC: Record<string, string> = { ru: 'ru-RU', en: 'en-GB', id: 'id-ID' };
const dayWords = (lang: string, day: string) => new Intl.DateTimeFormat(LOC[lang], DATE_FMT[lang]).format(new Date(day + 'T12:00:00Z'));

/** The notice to the house owner or the neighbours before a party (no "—" chains, lower-case start like a chat message). */
export function partyNoticeText(lang: string, x: { to: 'owner' | 'neighbours'; day: string; time: string; heads: number; quiet_after: string | null; name: string | null }) {
  const L = ['en', 'ru', 'id'].includes(lang) ? lang : 'en';
  const d = dayWords(L, x.day);
  const n = Math.max(2, x.heads);
  const q = x.quiet_after;
  if (L === 'ru') return x.to === 'owner'
    ? `здравствуйте! хотим ${d} позвать друзей домой, с ${x.time}, человек ${n}. ${q ? `после ${q} музыку выключим и будем тихо. ` : ''}всё уберём за собой. если есть правила, которые нам стоит знать, напишите, пожалуйста. спасибо!`
    : `здравствуйте! мы соседи${x.name ? `, ${x.name}` : ''}. ${d} с ${x.time} у нас будут гости, человек ${n}. ${q ? `после ${q} будем тихо. ` : ''}если будет мешать, напишите нам, сразу сделаем тише. спасибо!`;
  if (L === 'id') return x.to === 'owner'
    ? `halo pak/bu! ${d} kami mau undang teman ke rumah mulai jam ${x.time}, sekitar ${n} orang. ${q ? `setelah jam ${q} musik kami matikan. ` : ''}kami akan bersihkan semuanya. kalau ada aturan yang perlu kami tahu, mohon kabari ya. terima kasih!`
    : `halo! kami tetangga${x.name ? `, ${x.name}` : ''}. ${d} mulai jam ${x.time} ada tamu di rumah kami, sekitar ${n} orang. ${q ? `setelah jam ${q} kami akan tenang. ` : ''}kalau terganggu, kabari kami ya, langsung kami kecilkan. terima kasih!`;
  return x.to === 'owner'
    ? `hi! we'd like to have a few friends over on ${d} from ${x.time}, about ${n} people. ${q ? `music off and quiet after ${q}. ` : ''}we'll clean everything up. if there are any house rules we should know, please tell us. thanks!`
    : `hi! we're your neighbours${x.name ? `, ${x.name}` : ''}. on ${d} from ${x.time} we'll have some friends over, about ${n} people. ${q ? `we'll keep it quiet after ${q}. ` : ''}if it bothers you, just message us and we'll turn it down. thanks!`;
}
/** "Running late" to an organizer who has our booking. */
export function lateText(lang: string, x: { title: string; minutes: number; n: number }) {
  const L = ['en', 'ru', 'id'].includes(lang) ? lang : 'en';
  if (L === 'ru') return `привет! мы на ${x.title}, ${x.n} чел. опаздываем минут на ${x.minutes}, но едем. подержите, пожалуйста, места. спасибо!`;
  if (L === 'id') return `halo! kami yang ke ${x.title}, ${x.n} orang. kami telat sekitar ${x.minutes} menit tapi sedang di jalan. tolong tahan tempatnya ya, terima kasih!`;
  return `hi! we're coming to ${x.title}, ${x.n} people. running about ${x.minutes} min late but on our way, please hold our spot. thanks!`;
}

// ---------------------------------------------------------------- "how was it"

/** When the bot asks "Как было?": the morning after (≥ 09:00 local), at most 2 days later. */
export function askFeedbackNow(o: { occ: string; today: string; localMin: number }) {
  const next = new Date(Date.parse(o.occ + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);
  const last = new Date(Date.parse(o.occ + 'T00:00:00Z') + 2 * 864e5).toISOString().slice(0, 10);
  return o.today >= next && o.today <= last && o.localMin >= 9 * 60 && o.localMin < 22 * 60;
}
