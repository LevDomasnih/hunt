// Wave 3: people notes, power meter, move-out, re-let, contacts directory, visa dates, places near (travel times).
// Shared by the agent API (agent.ts), the Mini App (app.ts) and the cron (notify.ts).
import { Env, HttpError, now, rid, parseJson, event } from './util';
import { sensitive, normAddr } from './agent';
import { dealDates } from './deal';

const txt = (v: unknown, n: number) => (v == null ? null : String(v).trim().slice(0, n) || null);
const isDay = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
function noSecrets(what: string, ...parts: unknown[]) {
  const s = sensitive(parts.map((x) => (typeof x === 'string' ? x : JSON.stringify(x ?? ''))).join(' '));
  if (s) throw new HttpError(400, 'sensitive', `${what} looks like it contains ${s}. Remove it.`);
}

// ---------------------------------------------------------------- region pack data (public/art/regions.json)

let packCache: { at: number; data: any } | null = null;
/** regions.json generated from the packs (power, visa, emergency…), cached for 10 minutes per isolate. */
export async function packData(env: Env): Promise<any> {
  if (packCache && Date.now() - packCache.at < 600e3) return packCache.data;
  try {
    const r = await env.ASSETS.fetch(new Request(`${env.PUBLIC_URL || 'https://hunt.local'}/art/regions.json`));
    const data = r.ok ? await r.json() : {};
    packCache = { at: Date.now(), data };
    return data;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------- people notes

/** Normalized identities of a contact: 'contact:<id>' plus one per channel (phone E.164, @telegram, facebook id…). */
export async function identitiesOf(env: Env, cid: string): Promise<string[]> {
  const chs = (await env.DB.prepare('SELECT channel, address FROM contact_channels WHERE contact_id=?').bind(cid).all<{ channel: string; address: string }>()).results ?? [];
  const out = new Set<string>([`contact:${cid}`]);
  for (const c of chs) out.add(identityOf(c.channel, c.address));
  return [...out];
}
export function identityOf(channel: string, address: string): string {
  const a = normAddr(channel, address);
  if (['whatsapp', 'viber', 'phone', 'line_phone'].includes(channel)) return `phone:${a}`;
  if (channel === 'telegram') return `telegram:${a}`;
  if (channel === 'messenger' || channel === 'facebook') return `facebook:${a.toLowerCase()}`;
  return `${channel}:${a.toLowerCase()}`;
}
const PRIMARY = ['phone:', 'telegram:', 'facebook:', 'instagram:', 'email:'];
const primaryIdentity = (ids: string[]) => PRIMARY.map((p) => ids.find((x) => x.startsWith(p))).find(Boolean) ?? ids[0];

export async function addNote(env: Env, b: { contact_id: string; search_id?: string | null; text: unknown; sentiment?: unknown }, actor: string) {
  const c = await env.DB.prepare('SELECT id, name FROM contacts WHERE id=?').bind(b.contact_id).first<{ id: string; name: string }>();
  if (!c) throw new HttpError(404, 'no_contact');
  const text = txt(b.text, 500);
  if (!text) throw new HttpError(400, 'missing', 'text is required');
  noSecrets('The note', text);
  const s = Number(b.sentiment);
  const sentiment = s > 0 ? 1 : s < 0 ? -1 : b.sentiment === '+' ? 1 : b.sentiment === '-' || b.sentiment === '−' ? -1 : 0;
  const id = rid('pn_');
  const identity = primaryIdentity(await identitiesOf(env, c.id));
  await env.DB.prepare('INSERT INTO people_notes (id, identity, contact_id, search_id, text, sentiment, author, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(id, identity, c.id, b.search_id ?? null, text, sentiment, actor, now()).run();
  if (b.search_id) await event(env, b.search_id, 'person_note', c.id, actor, { contact_name: c.name, text, sentiment });
  return env.DB.prepare('SELECT * FROM people_notes WHERE id=?').bind(id).first<any>();
}

/** Median minutes between our message and their next reply (last 200 messages, gaps under 7 days). */
function replyMinutes(msgs: { direction: string; at: string }[]): number | null {
  const gaps: number[] = [];
  let pending: number | null = null;
  for (const m of msgs) {
    const t = Date.parse(m.at);
    if (m.direction === 'out') { if (pending == null) pending = t; }
    else if (m.direction === 'in' && pending != null) {
      const g = (t - pending) / 60e3;
      if (g >= 0 && g < 7 * 1440) gaps.push(g);
      pending = null;
    }
  }
  if (!gaps.length) return null;
  gaps.sort((a, b) => a - b);
  return Math.round(gaps[Math.floor(gaps.length / 2)]);
}

/** Notes about this person from one hunter's projects + stats. `searchId` splits notes into here / elsewhere. */
export async function contactNotes(env: Env, cid: string, ownerId: string, searchId?: string | null) {
  const ids = await identitiesOf(env, cid);
  const ph = ids.map(() => '?').join(',');
  const [nr, sr, mr] = await env.DB.batch<any>([
    env.DB.prepare(`SELECT n.*, u.display_name author_name, s.title search_title FROM people_notes n LEFT JOIN users u ON u.id=n.author LEFT JOIN searches s ON s.id=n.search_id
                    WHERE (n.contact_id=? OR n.identity IN (${ph})) AND (s.owner_id=? OR (n.search_id IS NULL AND n.contact_id=?)) ORDER BY n.created_at DESC LIMIT 100`).bind(cid, ...ids, ownerId, cid),
    env.DB.prepare(`SELECT search_id FROM (SELECT l.search_id FROM listing_contacts lc JOIN listings l ON l.id=lc.listing_id WHERE lc.contact_id=?1
                    UNION SELECT search_id FROM threads WHERE contact_id=?1 UNION SELECT search_id FROM messages WHERE contact_id=?1 AND search_id IS NOT NULL
                    UNION SELECT search_id FROM house_contacts WHERE contact_id=?1 UNION SELECT search_id FROM people_notes WHERE contact_id=?1 AND search_id IS NOT NULL)
                    WHERE search_id IN (SELECT id FROM searches WHERE owner_id=?2)`).bind(cid, ownerId),
    env.DB.prepare(`SELECT direction, at FROM (SELECT direction, at FROM messages WHERE contact_id=? AND search_id IN (SELECT id FROM searches WHERE owner_id=?) ORDER BY at DESC LIMIT 200) ORDER BY at`).bind(cid, ownerId),
  ]);
  const notes = (nr.results ?? []).map((n: any) => ({ id: n.id, text: n.text, sentiment: n.sentiment, author: n.author, author_name: n.author === 'agent' ? 'agent' : n.author_name, search_id: n.search_id, search_title: n.search_title, at: n.created_at }));
  const searches = new Set((sr.results ?? []).map((r: any) => r.search_id).filter(Boolean));
  return {
    notes,
    notes_elsewhere: searchId ? notes.filter((n: any) => n.search_id !== searchId) : notes,
    stats: { searches: searches.size, notes: notes.length, reply_minutes: replyMinutes(mr.results ?? []), messages: (mr.results ?? []).length },
  };
}

// ---------------------------------------------------------------- power meter

export interface PowerView {
  balance: number | null; at: string | null; daily: number | null; days_left: number | null; runout: string | null;
  weeks: { from: string; to: string; kwh: number }[]; month_kwh: number | null; last_photo_at: string | null; waiting_photo: boolean; readings: any[];
}

/** Balance now, kWh a day, days left and the last four weeks, from readings (balance left) and top-ups (kWh bought). */
export function powerView(rows: any[]): PowerView {
  const all = [...rows].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const reads = all.filter((r) => r.kind === 'reading' && r.kwh != null);
  const tops = all.filter((r) => r.kind === 'topup' && r.kwh != null);
  const photos = all.filter((r) => r.photo);
  const lastPhoto = photos[photos.length - 1] ?? null;
  const out: PowerView = { balance: null, at: null, daily: null, days_left: null, runout: null, weeks: [], month_kwh: null, last_photo_at: lastPhoto?.at ?? null,
    waiting_photo: !!all.filter((r) => r.kind === 'photo').length && (!reads.length || Date.parse(all.filter((r) => r.kind === 'photo').slice(-1)[0].at) > Date.parse(reads[reads.length - 1].at)), readings: all.slice(-30) };
  if (!reads.length) return out;
  const day = 864e5;
  // Daily use per interval between two readings, spread evenly over its days.
  const perDay = new Map<string, number>();
  let used = 0, span = 0;
  const cutoff = Date.parse(reads[reads.length - 1].at) - 28 * day;
  for (let i = 1; i < reads.length; i++) {
    const a = reads[i - 1], b = reads[i];
    const ta = Date.parse(a.at), tb = Date.parse(b.at);
    if (tb - ta < 3600e3) continue;
    const bought = tops.filter((x) => Date.parse(x.at) > ta && Date.parse(x.at) <= tb).reduce((s, x) => s + Number(x.kwh), 0);
    const u = Number(a.kwh) + bought - Number(b.kwh);
    if (u < 0) continue; // a top-up we don't know about
    const days = (tb - ta) / day;
    if (tb > cutoff) { used += u; span += days; }
    for (let t = ta; t < tb; t += day) {
      const k = new Date(t).toISOString().slice(0, 10);
      perDay.set(k, (perDay.get(k) ?? 0) + (u * Math.min(day, tb - t)) / (tb - ta));
    }
  }
  const last = reads[reads.length - 1];
  const daily = span >= 0.5 ? used / span : null;
  const since = (Date.now() - Date.parse(last.at)) / day;
  const boughtAfter = tops.filter((x) => Date.parse(x.at) > Date.parse(last.at)).reduce((s, x) => s + Number(x.kwh), 0);
  const balance = Math.max(0, Number(last.kwh) + boughtAfter - (daily ?? 0) * Math.max(0, since));
  out.balance = Math.round(balance * 10) / 10;
  out.at = last.at;
  out.daily = daily == null ? null : Math.round(daily * 10) / 10;
  if (daily && daily > 0) {
    out.days_left = Math.round((balance / daily) * 10) / 10;
    out.runout = new Date(Date.now() + (balance / daily) * day).toISOString();
    out.month_kwh = Math.round(daily * 30);
  }
  // Four 7-day buckets ending on the last reading day.
  const end = Date.parse(last.at.slice(0, 10) + 'T00:00:00Z');
  for (let w = 3; w >= 0; w--) {
    const to = end - w * 7 * day, from = to - 6 * day;
    let kwh = 0;
    for (let t = from; t <= to; t += day) kwh += perDay.get(new Date(t).toISOString().slice(0, 10)) ?? 0;
    out.weeks.push({ from: new Date(from).toISOString().slice(0, 10), to: new Date(to).toISOString().slice(0, 10), kwh: Math.round(kwh) });
  }
  if (!out.weeks.some((w) => w.kwh > 0)) out.weeks = [];
  return out;
}

export async function searchPower(env: Env, sid: string) {
  const rows = (await env.DB.prepare('SELECT id, kind, kwh, amount, currency, photo, note, at, created_by FROM meter_readings WHERE search_id=? ORDER BY at DESC LIMIT 200').bind(sid).all<any>()).results ?? [];
  return powerView(rows);
}

export async function addReading(env: Env, sid: string, b: any, actor: string) {
  const kind = ['reading', 'topup', 'photo'].includes(b.kind) ? b.kind : 'reading';
  const kwh = b.kwh == null || b.kwh === '' ? null : Number(b.kwh);
  if (kind !== 'photo' && (kwh == null || !Number.isFinite(kwh) || kwh < 0 || kwh > 100000)) throw new HttpError(400, 'bad_kwh', 'kwh must be a number of kWh');
  const at = b.at && !Number.isNaN(Date.parse(b.at)) ? new Date(b.at).toISOString() : now();
  const photo = b.photo ? String(b.photo) : null;
  if (photo && !photo.startsWith(`m/${sid}/`)) throw new HttpError(400, 'bad_photo', 'photo must be a meter photo key m/<search>/…');
  const amount = b.amount == null || b.amount === '' ? null : Math.round(Number(b.amount));
  const note = txt(b.note, 200);
  noSecrets('The reading', note ?? '');
  // The agent reading a member's photo replaces that photo row.
  const pending = kind === 'reading' && photo ? await env.DB.prepare("SELECT id FROM meter_readings WHERE search_id=? AND kind='photo' AND photo=?").bind(sid, photo).first<{ id: string }>() : null;
  const id = pending?.id ?? rid('mr_');
  await env.DB.prepare(`INSERT INTO meter_readings (id, search_id, kind, kwh, amount, currency, photo, note, at, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, kwh=excluded.kwh, amount=excluded.amount, currency=excluded.currency, note=excluded.note, at=coalesce(?, at)`)
    .bind(id, sid, kind, kwh, Number.isFinite(amount as number) ? amount : null, txt(b.currency, 8), photo, note, at, actor, now(), b.at ? at : null).run();
  return env.DB.prepare('SELECT * FROM meter_readings WHERE id=?').bind(id).first<any>();
}

// ---------------------------------------------------------------- move-out

export const MOVEOUT_STEPS = ['notice', 'keys', 'video', 'cleaning', 'deposit'] as const;
const STEP_STATUS = ['done', 'wait', 'todo', 'info'];

function cleanSteps(v: any, old: any) {
  const out: Record<string, any> = { ...(old ?? {}) };
  if (v == null) return out;
  if (typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'bad_steps', 'steps must be {notice|keys|video|cleaning|deposit: {status, note}}');
  for (const [k, x] of Object.entries(v as Record<string, any>)) {
    if (!(MOVEOUT_STEPS as readonly string[]).includes(k)) throw new HttpError(400, 'bad_steps', `unknown step ${k}; use ${MOVEOUT_STEPS.join(', ')}`);
    if (x == null) { delete out[k]; continue; }
    const prev = out[k] ?? {};
    const status = x.status ?? prev.status ?? 'todo';
    if (!STEP_STATUS.includes(status)) throw new HttpError(400, 'bad_steps', `steps.${k}.status must be ${STEP_STATUS.join(', ')}`);
    out[k] = {
      status, note: 'note' in x ? txt(x.note, 200) : prev.note ?? null,
      date: 'date' in x ? (isDay(x.date) ? x.date : null) : prev.date ?? null,
      at: 'at' in x ? (x.at && !Number.isNaN(Date.parse(x.at)) ? String(x.at) : null) : prev.at ?? null,
      channel: 'channel' in x ? txt(x.channel, 20) : prev.channel ?? null,
    };
  }
  return out;
}

export async function setMoveout(env: Env, s: { id: string }, b: any, actor: string) {
  const old = await env.DB.prepare('SELECT * FROM moveouts WHERE search_id=?').bind(s.id).first<any>();
  const steps = cleanSteps(b.steps, parseJson(old?.steps, {}));
  let pushback = parseJson<any>(old?.pushback, null);
  if ('pushback' in b) {
    pushback = b.pushback == null ? null : { who: txt(b.pushback.who, 60), contact_id: b.pushback.contact_id ?? null, quote: txt(b.pushback.quote, 200), points: txt(b.pushback.points, 800) };
    if (pushback && !pushback.quote && !pushback.points) pushback = null;
  }
  const date = 'date' in b ? (isDay(b.date) ? b.date : null) : old?.date ?? null;
  const deal = await env.DB.prepare('SELECT listing_id FROM deals WHERE search_id=? ORDER BY updated_at DESC LIMIT 1').bind(s.id).first<any>();
  const listing = b.listing_id ?? old?.listing_id ?? deal?.listing_id ?? null;
  noSecrets('The move-out data', steps, pushback);
  await env.DB.prepare(`INSERT INTO moveouts (search_id, listing_id, date, steps, pushback, updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(search_id) DO UPDATE SET listing_id=excluded.listing_id, date=excluded.date, steps=excluded.steps, pushback=excluded.pushback, updated_at=excluded.updated_at`)
    .bind(s.id, listing, date, JSON.stringify(steps), pushback ? JSON.stringify(pushback) : null, now()).run();
  await event(env, s.id, 'moveout', s.id, actor, { date, steps: Object.fromEntries(Object.entries(steps).map(([k, v]: any) => [k, v.status])) });
  return moveoutView(env, s.id);
}

/** Move-out with the facts we already have: the move-out date and deposit return from the lease dates, the move-out video from documents. */
export async function moveoutView(env: Env, sid: string) {
  const [mo, dl, dv] = await env.DB.batch<any>([
    env.DB.prepare('SELECT * FROM moveouts WHERE search_id=?').bind(sid),
    env.DB.prepare('SELECT listing_id, data FROM deals WHERE search_id=? ORDER BY updated_at DESC LIMIT 1').bind(sid),
    env.DB.prepare("SELECT id, title, created_at FROM documents WHERE search_id=? AND kind='moveout_video' AND tg_file_id IS NOT NULL ORDER BY created_at DESC LIMIT 1").bind(sid),
  ]);
  const row = mo.results?.[0];
  if (!row) return null;
  const dates = dl.results?.[0] ? dealDates(parseJson(dl.results[0].data, {})) : [];
  const steps = parseJson<Record<string, any>>(row.steps, {});
  const video = dv.results?.[0];
  if (video && steps.video?.status !== 'done') steps.video = { ...(steps.video ?? {}), status: 'done', auto: true, doc_id: video.id };
  const dep = dates.find((d) => d.kind === 'deposit_return');
  if (!steps.deposit && dep) steps.deposit = { status: dep.done ? 'done' : 'wait', note: null, date: dep.date, amount: dep.amount ?? null, currency: dep.currency ?? null, auto: true };
  return {
    listing_id: row.listing_id, date: row.date ?? dates.find((d) => d.kind === 'moveout')?.date ?? null,
    steps, pushback: parseJson(row.pushback, null), updated_at: row.updated_at,
  };
}

// ---------------------------------------------------------------- re-let

export const RELET_CONSENT = ['yes', 'asked', 'no', 'unknown'];
export const LEAD_STATUS = ['new', 'reply', 'viewing', 'agreed', 'not_suitable'];

export async function setRelet(env: Env, s: { id: string }, b: any, actor: string) {
  const old = await env.DB.prepare('SELECT * FROM relets WHERE search_id=?').bind(s.id).first<any>();
  const v = (k: string) => (k in b ? b[k] : old?.[k] ?? null);
  const consent = v('consent') ?? 'unknown';
  if (!RELET_CONSENT.includes(consent)) throw new HttpError(400, 'bad_consent', `consent must be ${RELET_CONSENT.join(', ')}`);
  const status = v('status') ?? 'draft';
  if (!['draft', 'posted', 'found', 'closed'].includes(status)) throw new HttpError(400, 'bad_status', 'status must be draft, posted, found or closed');
  const photos = 'photos' in b ? (Array.isArray(b.photos) ? b.photos.slice(0, 10) : []) : parseJson(old?.photos, []);
  const channels = 'channels' in b ? (Array.isArray(b.channels) ? b.channels.slice(0, 12).map((c: any) => ({ kind: txt(c?.kind, 20) ?? 'other', label: txt(c?.label, 40), count: c?.count == null ? null : Number(c.count) || null, url: txt(c?.url, 300) })) : []) : parseJson(old?.channels, []);
  const price = v('price') == null || v('price') === '' ? null : Math.round(Number(v('price')));
  if (price != null && !Number.isFinite(price)) throw new HttpError(400, 'bad_price');
  const deal = await env.DB.prepare('SELECT listing_id FROM deals WHERE search_id=? ORDER BY updated_at DESC LIMIT 1').bind(s.id).first<any>();
  const row = {
    listing_id: v('listing_id') ?? deal?.listing_id ?? null, date_from: isDay(v('date_from')) ? v('date_from') : null, date_to: isDay(v('date_to')) ? v('date_to') : null,
    price, currency: txt(v('currency'), 8), consent, consent_note: txt(v('consent_note'), 200), ad_text: txt(v('ad_text'), 1500), status,
  };
  noSecrets('The re-let ad', row.ad_text ?? '', row.consent_note ?? '');
  await env.DB.prepare(`INSERT INTO relets (search_id, listing_id, date_from, date_to, price, currency, consent, consent_note, ad_text, photos, channels, status, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(search_id) DO UPDATE SET listing_id=excluded.listing_id, date_from=excluded.date_from, date_to=excluded.date_to, price=excluded.price, currency=excluded.currency,
    consent=excluded.consent, consent_note=excluded.consent_note, ad_text=excluded.ad_text, photos=excluded.photos, channels=excluded.channels, status=excluded.status, updated_at=excluded.updated_at`)
    .bind(s.id, row.listing_id, row.date_from, row.date_to, row.price, row.currency, row.consent, row.consent_note, row.ad_text, JSON.stringify(photos), JSON.stringify(channels), row.status, now()).run();
  if (!old || old.status !== status || old.consent !== consent) await event(env, s.id, 'relet', s.id, actor, { status, consent });
  return reletView(env, s.id);
}

export async function setLead(env: Env, s: { id: string }, id: string, b: any, actor: string) {
  const old = id === 'new' ? null : await env.DB.prepare('SELECT * FROM relet_leads WHERE id=? AND search_id=?').bind(id, s.id).first<any>();
  if (id !== 'new' && !old) throw new HttpError(404, 'no_lead');
  const v = (k: string) => (k in b ? b[k] : old?.[k] ?? null);
  const name = txt(v('name'), 80);
  if (!name) throw new HttpError(400, 'missing', 'name is required');
  const status = v('status') ?? 'new';
  if (!LEAD_STATUS.includes(status)) throw new HttpError(400, 'bad_status', `status must be ${LEAD_STATUS.join(', ')}`);
  const note = txt(v('note'), 200);
  noSecrets('The lead', note ?? '');
  const channel = txt(v('channel'), 20);
  const addr = v('address') ? normAddr(channel ?? '', String(v('address'))) : null;
  const lid = old?.id ?? rid('rl_');
  const t = now();
  await env.DB.prepare(`INSERT INTO relet_leads (id, search_id, contact_id, name, channel, address, note, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET contact_id=excluded.contact_id, name=excluded.name, channel=excluded.channel, address=excluded.address, note=excluded.note, status=excluded.status, updated_at=excluded.updated_at`)
    .bind(lid, s.id, v('contact_id'), name, channel, addr, note, status, old?.created_at ?? t, t).run();
  if (!old || old.status !== status) await event(env, s.id, 'relet_lead', lid, actor, { name, status, note });
  return env.DB.prepare('SELECT * FROM relet_leads WHERE id=?').bind(lid).first<any>();
}

export async function reletView(env: Env, sid: string) {
  const [r, l] = await env.DB.batch<any>([
    env.DB.prepare('SELECT * FROM relets WHERE search_id=?').bind(sid),
    env.DB.prepare(`SELECT * FROM relet_leads WHERE search_id=? ORDER BY CASE status WHEN 'agreed' THEN 0 WHEN 'viewing' THEN 1 WHEN 'reply' THEN 2 WHEN 'new' THEN 3 ELSE 9 END, updated_at DESC`).bind(sid),
  ]);
  const row = r.results?.[0];
  if (!row) return null;
  return { ...row, photos: parseJson(row.photos, []), channels: parseJson(row.channels, []), leads: l.results ?? [] };
}

// ---------------------------------------------------------------- contacts directory

export const DIR_GROUPS = ['home', 'bikes', 'food', 'services', 'health'];
export const DIR_CHANNELS = ['whatsapp', 'telegram', 'phone', 'map'];

export async function setDirEntry(env: Env, s: { id: string; dir_groups?: string | null }, id: string, b: any, actor: string) {
  const old = id === 'new' ? null : await env.DB.prepare('SELECT * FROM directory WHERE id=? AND search_id=?').bind(id, s.id).first<any>();
  if (id !== 'new' && !old) throw new HttpError(404, 'no_entry');
  const v = (k: string) => (k in b ? b[k] : old?.[k] ?? null);
  const name = txt(v('name'), 80);
  if (!name) throw new HttpError(400, 'missing', 'name is required');
  const custom = parseJson<{ key: string }[]>(s.dir_groups ?? null, []).map((g) => g.key);
  const grp = String(v('grp') ?? v('group') ?? 'services');
  if (!DIR_GROUPS.includes(grp) && !custom.includes(grp)) throw new HttpError(400, 'bad_group', `group must be one of ${[...DIR_GROUPS, ...custom].join(', ')}`);
  const channel = v('channel') ?? null;
  if (channel != null && !DIR_CHANNELS.includes(channel)) throw new HttpError(400, 'bad_channel', `channel must be ${DIR_CHANNELS.join(', ')}`);
  const address = v('address') ? normAddr(channel === 'telegram' ? 'telegram' : 'phone', String(v('address'))) : null;
  const phone = v('phone') ? normAddr('phone', String(v('phone'))) : channel === 'whatsapp' || channel === 'phone' ? address : null;
  const mapUrl = txt(v('map_url'), 400);
  if (mapUrl && !/^https?:\/\//.test(mapUrl)) throw new HttpError(400, 'bad_map_url', 'map_url must be an http(s) link');
  const lat = v('lat') == null || v('lat') === '' ? null : Number(v('lat'));
  const lng = v('lng') == null || v('lng') === '' ? null : Number(v('lng'));
  const subtitle = txt(v('subtitle'), 120);
  noSecrets('The contact', subtitle ?? '', name);
  const did = old?.id ?? rid('dr_');
  await env.DB.prepare(`INSERT INTO directory (id, search_id, grp, name, subtitle, channel, address, phone, map_url, lat, lng, icon, sort, created_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET grp=excluded.grp, name=excluded.name, subtitle=excluded.subtitle, channel=excluded.channel, address=excluded.address, phone=excluded.phone,
    map_url=excluded.map_url, lat=excluded.lat, lng=excluded.lng, icon=excluded.icon, sort=excluded.sort, updated_at=excluded.updated_at`)
    .bind(did, s.id, grp, name, subtitle, channel, address, phone, mapUrl, Number.isFinite(lat as number) ? lat : null, Number.isFinite(lng as number) ? lng : null,
      /^[a-z0-9-]{1,30}$/.test(String(v('icon') ?? '')) ? v('icon') : null, Number(v('sort')) || 0, old?.created_by ?? actor, now()).run();
  if (!old) await event(env, s.id, 'directory', did, actor, { name, grp });
  return env.DB.prepare('SELECT * FROM directory WHERE id=?').bind(did).first<any>();
}

/** Add a custom group; returns the new list. */
export async function addDirGroup(env: Env, sid: string, name: unknown) {
  const nm = txt(name, 30);
  if (!nm) throw new HttpError(400, 'missing', 'name is required');
  const row = await env.DB.prepare('SELECT dir_groups FROM searches WHERE id=?').bind(sid).first<{ dir_groups: string | null }>();
  const groups = parseJson<{ key: string; name: string }[]>(row?.dir_groups, []);
  if (groups.length >= 12) throw new HttpError(400, 'too_many', 'up to 12 custom groups');
  const existing = groups.find((g) => g.name.toLowerCase() === nm.toLowerCase());
  if (existing) return groups;
  groups.push({ key: `g_${Date.now().toString(36)}`, name: nm });
  await env.DB.prepare('UPDATE searches SET dir_groups=?, updated_at=? WHERE id=?').bind(JSON.stringify(groups), now(), sid).run();
  return groups;
}

// ---------------------------------------------------------------- travel times (places near)

export function cleanTravel(arr: unknown, old: any) {
  if (!Array.isArray(arr) || arr.length > 40) throw new HttpError(400, 'bad_times', 'times must be a list [{anchor_id, minutes, km?, mode?}]');
  const out: Record<string, any> = { ...(old ?? {}) };
  for (const [i, x] of arr.entries()) {
    const id = String((x as any)?.anchor_id ?? '');
    if (!/^[a-z0-9_-]{1,40}$/i.test(id)) throw new HttpError(400, 'bad_times', `times[${i}].anchor_id is required`);
    const min = Number((x as any).minutes);
    if (!Number.isFinite(min) || min < 0 || min > 1000) throw new HttpError(400, 'bad_times', `times[${i}].minutes must be a number`);
    const km = (x as any).km == null ? null : Number((x as any).km);
    out[id] = { min: Math.round(min), km: km != null && Number.isFinite(km) ? Math.round(km * 10) / 10 : null, mode: txt((x as any).mode, 20) ?? null, at: now() };
  }
  return out;
}

/** Brief anchors: brief.anchors [{id, name, type, lat, lng, map_url?, max_minutes?, mode?, by?}] (+ legacy brief.anchor). */
export const ANCHOR_TYPES = ['surf', 'beach', 'cowork', 'gym', 'yoga', 'shop', 'school', 'airport', 'work', 'friends', 'cafe', 'other'];
export function cleanAnchor(a: any, by: string | null) {
  const name = txt(a?.name, 60);
  if (!name) throw new HttpError(400, 'missing', 'name is required');
  let lat = Number(a.lat), lng = Number(a.lng);
  if (!(Number.isFinite(lat) && Number.isFinite(lng)) && a.map_url) {
    const m = String(a.map_url).match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ?? String(a.map_url).match(/[?&](?:q|query|ll|destination)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/) ?? String(a.map_url).match(/(-?\d{1,2}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/);
    if (m) { lat = Number(m[1]); lng = Number(m[2]); }
  }
  const hasPoint = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const mapUrl = txt(a.map_url, 400);
  if (!hasPoint && !mapUrl) throw new HttpError(400, 'no_point', 'give lat/lng or a Google Maps link with coordinates');
  if (mapUrl && !/^https?:\/\//.test(mapUrl)) throw new HttpError(400, 'bad_map_url', 'map_url must be an http(s) link');
  const max = a.max_minutes == null || a.max_minutes === '' ? null : Math.round(Number(a.max_minutes));
  return {
    id: /^[a-z0-9_-]{1,40}$/i.test(String(a.id ?? '')) ? String(a.id) : `a_${Date.now().toString(36)}`,
    name, type: ANCHOR_TYPES.includes(a.type) ? a.type : 'other',
    lat: hasPoint ? Math.round(lat * 1e6) / 1e6 : null, lng: hasPoint ? Math.round(lng * 1e6) / 1e6 : null, map_url: mapUrl,
    max_minutes: max != null && Number.isFinite(max) && max > 0 ? max : null,
    mode: ['scooter', 'car', 'walk'].includes(a.mode) ? a.mode : null, by,
  };
}
