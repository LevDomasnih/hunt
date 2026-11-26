// Split from wave5.ts.
import { daysUntil } from './deal';
import { areaNameOf, regionInfo } from './homepoint';
import { isDay, txt } from './local';
import { withSrc } from './media';
import { Env, HttpError, now, parseJson } from './util';
import { kmBetween } from './geo';
import { matchDossiers } from './dossier';

// ---------------------------------------------------------------- negotiation, price history, deal prices

/** A listing's price as the agent wrote it: the first price and every change go into price_history. */
export async function notePrice(env: Env, lid: string, oldPrice: number | null | undefined, price: unknown, currency: unknown, source: unknown) {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0 || Number(oldPrice) === p) return;
  await env.DB.prepare('INSERT INTO price_history (listing_id, price, currency, source, at) VALUES (?,?,?,?,?)').bind(lid, Math.round(p), txt(currency, 8), txt(source, 40), now()).run();
}
const quant = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return Math.round(s[lo] + (s[hi] - s[lo]) * (i - lo)); };
const roundDown = (x: number) => { const u = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1))) - 1) / 2; return Math.max(u, Math.floor(x / u) * u); };
const photoKeys = (raw: any) => new Set(parseJson<any[]>(raw, []).map((p) => p?.kv ?? p?.file_id ?? p?.url).filter(Boolean));

export async function negotiationView(env: Env, l: any) {
  const s = await env.DB.prepare('SELECT id, region, brief FROM searches WHERE id=?').bind(l.search_id).first<any>();
  const brief = parseJson<any>(s?.brief, {});
  const { pack, sub } = await regionInfo(env, s?.region ?? '');
  const asked = Number(l.price) || null;
  const cur = l.currency ?? brief.currency ?? null;
  // Market: same bedrooms + district, then the brief districts; pack price_ref when the CRM saw fewer than 5.
  const comps = async (ds: string[], type: boolean) => ((await env.DB.prepare(`SELECT id, price FROM listings WHERE id!=? AND price > 0 AND coalesce(currency,'')=coalesce(?,'') AND bedrooms IS ?
      AND district IN (${ds.map(() => '?').join(',') || "''"}) ${type && l.property_type ? 'AND property_type=?' : ''}`)
    .bind(l.id, cur, l.bedrooms ?? null, ...ds, ...(type && l.property_type ? [l.property_type] : [])).all<any>()).results ?? []).map((x) => Number(x.price));
  let market: any = null;
  const scopes: [string[], boolean][] = [];
  if (l.district) scopes.push([[l.district], true], [[l.district], false]);
  const bd: string[] = [...new Set([...(l.district ? [l.district] : []), ...(Array.isArray(brief.districts) ? brief.districts : [])])];
  if (bd.length) scopes.push([bd, false]);
  for (const [ds, type] of scopes) {
    const xs = await comps(ds, type);
    if (xs.length >= 5) { market = { districts: ds, bedrooms: l.bedrooms ?? null, property_type: type ? l.property_type ?? null : null, count: xs.length, median: quant(xs, 0.5), p25: quant(xs, 0.25), p75: quant(xs, 0.75), min: Math.min(...xs), max: Math.max(...xs), source: 'crm' }; break; }
  }
  if (!market && l.bedrooms != null) {
    const pr = sub.price_ref;
    const area = Object.values<any>(pack.areas ?? {}).find((a) => (a.districts ?? []).includes(l.district) && a.price?.[String(l.bedrooms)]);
    const rng = pr?.beds?.[String(l.bedrooms)] ?? area?.price?.[String(l.bedrooms)];
    if (rng && (!pr?.currency || !cur || pr.currency === cur)) {
      const [lo, hi] = rng.map(Number);
      const med = Number(pr?.median?.[String(l.bedrooms)]) || Math.round((lo + hi) / 2);
      market = { districts: l.district ? [l.district] : bd, bedrooms: l.bedrooms, property_type: null, count: 0, median: med, p25: Math.round(lo + (med - lo) / 2), p75: Math.round(med + (hi - med) / 2), min: lo, max: hi, source: 'pack' };
    }
  }
  // History: price changes of this listing, the same house in other listings (contact, photos, ±50 m), the dossier.
  const history: any[] = [];
  for (const r of (await env.DB.prepare('SELECT price, currency, source, at FROM price_history WHERE listing_id=? ORDER BY at').bind(l.id).all<any>()).results ?? [])
    if (!history.some((x) => x.match === 'same' && x.price === r.price)) history.push({ date: String(r.at).slice(0, 7), price: r.price, currency: r.currency ?? cur, source: r.source ?? l.source, note: null, match: 'same', title: l.title });
  const cids = ((await env.DB.prepare('SELECT contact_id FROM listing_contacts WHERE listing_id=?').bind(l.id).all<any>()).results ?? []).map((x) => x.contact_id);
  const near = l.lat != null ? [Number(l.lat) - 0.0006, Number(l.lat) + 0.0006, Number(l.lng) - 0.0006, Number(l.lng) + 0.0006] : null;
  const others = (await env.DB.prepare(`SELECT l.id, l.title, l.price, l.currency, l.source, l.price_note, l.lat, l.lng, l.photos, l.created_at, s.title stitle,
      EXISTS (SELECT 1 FROM listing_contacts lc WHERE lc.listing_id=l.id AND lc.contact_id IN (${cids.map(() => '?').join(',') || "''"})) same_contact
    FROM listings l JOIN searches s ON s.id=l.search_id WHERE l.id!=? AND l.price > 0 AND (
      l.id IN (SELECT listing_id FROM listing_contacts WHERE contact_id IN (${cids.map(() => '?').join(',') || "''"}))
      ${near ? 'OR (l.lat BETWEEN ? AND ? AND l.lng BETWEEN ? AND ?)' : ''} OR l.photos LIKE ?) LIMIT 40`)
    .bind(...cids, l.id, ...cids, ...(near ?? []), `%${[...photoKeys(l.photos)][0] ?? '\u0000'}%`).all<any>()).results ?? [];
  const mine = photoKeys(l.photos);
  for (const o of others) {
    const photos = mine.size > 0 && [...photoKeys(o.photos)].filter((k) => mine.has(k)).length >= Math.min(2, mine.size); // a repost: the same photos
    const point = near && o.lat != null && kmBetween([Number(l.lat), Number(l.lng)], [Number(o.lat), Number(o.lng)]) <= 0.05;
    const match = photos ? 'photos' : o.same_contact && (point || (l.bedrooms == null)) ? 'contact' : point ? 'point' : null;
    if (!match) continue;
    history.push({ date: String(o.created_at).slice(0, 7), price: o.price, currency: o.currency, source: o.source, note: o.price_note ?? o.stitle, match, title: o.title });
  }
  for (const d of await matchDossiers(env, l).catch(() => [])) {
    if (d.stats?.price) history.push({ date: String(d.updated_at ?? d.created_at).slice(0, 7), price: Number(d.stats.price), currency: d.stats.currency ?? cur, source: 'dossier', note: d.stats.price_note ?? d.verdict_title ?? null, match: 'dossier', title: d.title });
  }
  history.sort((a, b) => a.date.localeCompare(b.date));
  // Arguments and the offer.
  const args: any[] = [];
  if (market && asked && market.median < asked) args.push({ key: 'median', value: market.median });
  const inc = parseJson<string[]>(l.includes, []).map((x) => String(x).toLowerCase());
  const notInc = ['electricity', 'cleaning', 'internet', 'water'].filter((k) => !inc.includes(k) && !(k === 'internet' && inc.includes('wifi')));
  if (notInc.includes('electricity') || /\+\s*(свет|electric|listrik|power)/i.test(l.price_note ?? '')) args.push({ key: 'not_included', items: notInc.slice(0, 2) });
  const av = String(l.available ?? '').match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? (/^(now|сейчас|сразу|immediately)/i.test(l.available ?? '') ? null : null);
  const today = new Date().toISOString().slice(0, 10);
  if (av && av <= today) args.push({ key: 'empty_since', date: av });
  const month = Number(today.slice(5, 7));
  const seasons = pack.seasons ?? {};
  const season = (seasons.low ?? []).includes(month) ? 'low' : (seasons.wet ?? []).includes(month) ? 'wet' : (seasons.high ?? []).includes(month) ? 'high' : null;
  if (season && season !== 'high') args.push({ key: 'season', season });
  const listed = Math.round((Date.now() - Date.parse(l.created_at)) / 864e5);
  if (listed >= 14) args.push({ key: 'long_listed', days: listed });
  const termText = [brief.term, ...(Array.isArray(brief.payment_terms) ? brief.payment_terms : [])].join(' ');
  const months = Math.max(0, ...[...termText.matchAll(/(\d+)\s*(?:months?|мес)/gi)].map((x) => Number(x[1])).filter((n) => n <= 12));
  const upfront = /upfront|вперёд|вперед/i.test(termText) ? Math.max(0, ...[...termText.matchAll(/(\d+)\s*months?\s*upfront/gi)].map((x) => Number(x[1]))) || null : null;
  const upMonths = upfront ?? (months >= 3 ? Math.min(months, 6) : null);
  if (upMonths) args.push({ key: 'term_upfront', months: upMonths });
  const cheaper = history.filter((x) => x.price && asked && x.price < asked && (x.currency ?? cur) === cur).sort((a, b) => a.price - b.price)[0];
  if (cheaper) args.push({ key: 'was_cheaper', price: cheaper.price, date: cheaper.date });
  let offer: any = null;
  if (asked) {
    let target = market && market.median < asked ? Math.max(market.median, asked * 0.85) : asked * 0.93;
    if (season === 'low' || season === 'wet') target *= 0.98;
    if (upMonths) target *= 0.98;
    if (cheaper) target = Math.min(target, Math.max(cheaper.price, asked * 0.85));
    target = Math.min(roundDown(target), asked);
    const said = Number(brief.budget_said) || null;
    const capped = !!said && target > said;
    if (capped) target = roundDown(said!);
    offer = { price: target, months_upfront: upMonths, capped };
  }
  return {
    listing: { id: l.id, title: l.title, price: asked, currency: cur, district: l.district, bedrooms: l.bedrooms, property_type: l.property_type, photo: withSrc(l.id, parseJson<any[]>(l.photos, []))[0] ?? null, area_name: areaNameOf(pack, l.district) },
    market, history: history.slice(-6), offer, arguments: args, asked, budget_said: Number(brief.budget_said) || null,
  };
}

function monthsOf(terms: any) {
  const a = String(terms?.from ?? '').slice(0, 10), b = String(terms?.to ?? '').slice(0, 10);
  if (!isDay(a) || !isDay(b)) return null;
  return Math.max(1, Math.round(daysUntil(b, a) / 30.4));
}
export async function dealPrices(env: Env, lid: string) {
  const d = await env.DB.prepare('SELECT d.asked, d.agreed, d.data, l.currency FROM deals d JOIN listings l ON l.id=d.listing_id WHERE d.listing_id=?').bind(lid).first<any>();
  if (!d) return null;
  const terms = parseJson<any>(d.data, {}).terms ?? {};
  const months = monthsOf(terms);
  const saved = d.asked != null && d.agreed != null ? Math.max(0, d.asked - d.agreed) : null;
  return { asked: d.asked, agreed: d.agreed, currency: terms.currency ?? d.currency ?? null, saved_month: saved, months, saved_term: saved != null && months ? saved * months : null };
}
export async function setDealPrices(env: Env, lid: string, b: any) {
  const n = (v: unknown) => (v == null || v === '' ? undefined : Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : NaN);
  const asked = n(b.asked), agreed = n(b.agreed);
  if (Number.isNaN(asked) || Number.isNaN(agreed)) throw new HttpError(400, 'bad_amount', 'asked and agreed must be positive numbers');
  const ex = await env.DB.prepare('SELECT 1 FROM deals WHERE listing_id=?').bind(lid).first();
  if (!ex) throw new HttpError(404, 'no_deal', 'Create the deal first (deal_set)');
  await env.DB.prepare('UPDATE deals SET asked=coalesce(?, asked), agreed=coalesce(?, agreed), deal_at=coalesce(deal_at, ?) WHERE listing_id=?').bind(asked ?? null, agreed ?? null, now(), lid).run();
  return dealPrices(env, lid);
}
/** After a deal write: agreed = terms.rent, asked = the first price seen, deal_at = the first write (only fills blanks). */
export async function autoDealPrices(env: Env, l: any, data: any) {
  const rent = Number(data?.terms?.rent) || null;
  const first = await env.DB.prepare('SELECT price FROM price_history WHERE listing_id=? ORDER BY at LIMIT 1').bind(l.id).first<any>();
  await env.DB.prepare('UPDATE deals SET agreed=coalesce(agreed, ?), asked=coalesce(asked, ?), deal_at=coalesce(deal_at, ?) WHERE listing_id=?')
    .bind(rent, Number(first?.price) || Number(l.price) || null, now(), l.id).run();
}
