// Wave 9: event photos by link ("link, don't store") and the public read-only event page.
//
// Image proxy GET /img/e/<event_id>/<v>: the Worker fetches the event's stored photo_url (never a URL from the request) from
// the organizer's/venue's public https page with a short edge cache (`cf.cacheTtl`; the Cache API is not available on
// workers.dev). Viewers' IPs never reach third-party sites and bad hosts can be blocked. <v> is a version hash of the URL
// (cache-busting, not a secret: the proxy only ever fetches the URL stored for that event). SSRF rules: https only, default
// port, no credentials, every A/AAAA address public (DNS-over-HTTPS), redirects followed by hand (≤ 3) and re-checked,
// ≤ 5 MB, image/* only (jpeg/png/webp/gif/avif checked by their bytes; no SVG). A failure marks the photo stale (the app
// falls back to the category card, the next agent sweep refreshes the photo).
//
// Public event page GET /e/<id>.<sig>[?d=YYYY-MM-DD]: a ticket-style card with the photo (through the proxy), date, time,
// place, price and the source link; noindex, no-store, strict CSP. Parties are never shown here (their link is the invite).
import { Env, HttpError, hmac, hex, now, parseJson } from './util';
import { kvPhoto, mediaHeaders, rateLimit } from './media';
import { fnv, proxySrc, safeImageFetch } from './ssrf';
export { fnv, proxySrc };
import { h } from './local';
import { packData } from './life';

/** GET /img/e/<event_id>/<v> (public, rate-limited per IP by the caller). */
export async function handleImgProxy(req: Request, env: Env, path: string): Promise<Response> {
  const m = path.match(/^\/img\/e\/(ev_[A-Za-z0-9_]{2,60})\/([a-z0-9]{1,8})$/);
  const nf = () => new Response('not found', { status: 404, headers: { 'cache-control': 'public, max-age=300', 'x-robots-tag': 'noindex' } });
  if (!m || req.method !== 'GET') return nf();
  const r = await env.DB.prepare('SELECT id, photo_url, photo_stale_at, status FROM afisha WHERE id=?').bind(m[1]).first<{ id: string; photo_url: string | null; photo_stale_at: string | null; status: string }>();
  if (!r?.photo_url || r.status === 'hidden' || !/^https:\/\//.test(r.photo_url) || fnv(r.photo_url) !== m[2]) return nf();
  // A recently failed photo is not re-fetched for 6 h (the sweep replaces it).
  if (r.photo_stale_at && Date.now() - Date.parse(r.photo_stale_at) < 6 * 3600e3) return nf();
  const got = await safeImageFetch(r.photo_url);
  if (!got.ok) {
    await env.DB.prepare('UPDATE afisha SET photo_stale_at=?, photo_fail=? WHERE id=? AND photo_url=?').bind(now(), got.fail, r.id, r.photo_url).run();
    return nf();
  }
  if (r.photo_stale_at) await env.DB.prepare('UPDATE afisha SET photo_stale_at=NULL, photo_fail=NULL WHERE id=?').bind(r.id).run();
  return new Response(got.body, { headers: mediaHeaders(got.type, { 'cache-control': 'public, max-age=86400', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex', 'cross-origin-resource-policy': 'same-origin' }) });
}

// ---------------------------------------------------------------- public read-only event page

const shareSig = async (env: Env, id: string) => hex(await hmac(env.LINK_SECRET, `share|${id}`)).slice(0, 16);
export async function eventShareUrl(env: Env, id: string, occ: string | null) {
  return `${env.PUBLIC_URL}/e/${id}.${await shareSig(env, id)}${occ ? `?d=${occ}` : ''}`;
}

/** GET /e/<id>.<sig> (HTML) and /e/<id>.<sig>/photo (a KV photo). */
export async function handleEventPage(req: Request, env: Env, path: string): Promise<Response> {
  const m = path.match(/^\/e\/(ev_[A-Za-z0-9_]{2,60})\.([a-f0-9]{16})(\/photo)?\/?$/);
  const notFound = () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } });
  if (!m || m[2] !== (await shareSig(env, m[1]))) return notFound();
  const r = await env.DB.prepare('SELECT * FROM afisha WHERE id=?').bind(m[1]).first<any>();
  if (!r || r.status === 'hidden') return notFound();
  if (m[3]) {
    if (!String(r.photo_url ?? '').startsWith('kv:')) return notFound();
    const got = await kvPhoto(env, String(r.photo_url).slice(3));
    return got ? new Response(got.body, { headers: mediaHeaders(got.type ?? 'image/jpeg', { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' }) }) : notFound();
  }
  const q = new URL(req.url).searchParams;
  const ql = q.get('lang');
  const lang = ql === 'en' || ql === 'ru' ? ql : /^ru|,\s*ru/i.test(req.headers.get('accept-language') ?? '') ? 'ru' : 'en';
  const ru = lang === 'ru';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(q.get('d') ?? '') ? q.get('d')! : String(r.starts_at ?? '').slice(0, 10) || null;
  const rec = parseJson<any>(r.recurrence, null);
  const time = rec?.time ?? String(r.starts_at ?? '').slice(11, 16);
  const title = ru ? r.title : r.title_en || r.title;
  const about = ru ? r.about_ru || r.about_en : r.about_en || r.about_ru;
  const when = day ? new Intl.DateTimeFormat(ru ? 'ru-RU' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(day + 'T12:00:00Z')) : '';
  const price = r.price_kind === 'free' ? (ru ? 'бесплатно' : 'free') : r.price != null ? `${new Intl.NumberFormat(ru ? 'ru-RU' : 'en-GB').format(r.price)} ${r.currency ?? ''}`.trim() : r.price_kind === 'on_site' ? (ru ? 'оплата на месте' : 'pay on site') : '';
  const photo = r.photo_url && !r.photo_stale_at ? (String(r.photo_url).startsWith('kv:') ? `/e/${m[1]}.${m[2]}/photo` : /^https:\/\//.test(r.photo_url) ? proxySrc(r.id, r.photo_url) : /^\/demo\/[\w./-]+$/.test(r.photo_url) ? r.photo_url : null) : null;
  const map = r.lat != null && r.lng != null ? `https://www.google.com/maps/search/?api=1&query=${Number(r.lat)},${Number(r.lng)}` : r.map_url && /^https:\/\//.test(r.map_url) ? r.map_url : null;
  const src = r.source_url && /^https?:\/\//.test(r.source_url) ? r.source_url : null;
  const pack = (await packData(env))?.[r.country] ?? {};
  const screen = ({ bali: '#FF8A5B', th: '#FF8FB1' } as Record<string, string>)[r.country] ?? '#FF8A5B';
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  const kicker = [r.place_name ? String(r.place_name).split(/[·,(]/)[0].trim() : null, pack?.name?.[lang] ?? null].filter(Boolean).join(' · ');
  const body = `<div class="bar" aria-hidden="true">hunt</div><main>
<div class="tk"><div class="frame">${photo ? `<img src="${h(photo)}" alt="">` : `<span class="none"></span>`}</div>
<div class="perf" aria-hidden="true"></div>
<div class="stub"><p class="k">${h(kicker)}</p><h1>${h(title)}</h1><p class="m">${h([when, time, price].filter(Boolean).join(' · '))}</p></div></div>
${about ? `<p class="about">${h(about)}</p>` : ''}
<div class="pills">${map ? `<a class="btn fill" href="${h(map)}" rel="noopener noreferrer" target="_blank">${ru ? 'Как добраться' : 'Directions'}</a>` : ''}${r.ticket_url && /^https:\/\//.test(r.ticket_url) ? `<a class="btn" href="${h(r.ticket_url)}" rel="noopener noreferrer" target="_blank">${ru ? 'Билеты' : 'Tickets'}</a>` : ''}</div>
${src ? `<p class="src">${ru ? 'Источник' : 'Source'}: <a href="${h(src)}" rel="noopener noreferrer" target="_blank">${h(r.source_name || new URL(src).hostname)}</a>${r.photo_credit ? ` · ${ru ? 'фото' : 'photo'} © ${h(String(r.photo_credit).replace(/^©\s*/, ''))}` : ''}</p>` : ''}
<p class="foot">hunt</p></main>`;
  const css = `:root{--ground:${screen};--ink:#151413;--muted:#36332E;--line:#1514131F;--paper:#F2F0EA}
@media (prefers-color-scheme:dark){:root{--ground:#151413;--ink:#F2F0EA;--muted:#A9A59C;--line:#F2F0EA26;--paper:#22201E}}
*{box-sizing:border-box}html{background:var(--ground)}body{margin:0;background:var(--ground);color:var(--ink);font:16px/1.4 "Inter Tight","Inter",-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;letter-spacing:-.012em}
:focus-visible{outline:3px solid #1F6BFF;outline-offset:2px}.bar{max-width:520px;margin:0 auto;padding:16px 20px 0;font-weight:800;font-size:23px;letter-spacing:-.06em}
main{max-width:520px;margin:0 auto;padding:18px 20px 40px}.tk{background:var(--paper);border-radius:34px;padding:12px;transform:rotate(-1.5deg);box-shadow:0 26px 44px rgba(40,20,10,.28)}
.frame{background:#151413;border-radius:26px;padding:10px;aspect-ratio:4/3.4;overflow:hidden}.frame img,.frame .none{display:block;width:100%;height:100%;object-fit:cover;border-radius:18px;background:#2a2725}
.perf{margin:12px 6px;border-top:2px dashed #15141333}.stub{padding:2px 10px 10px;color:#151413}.k{margin:0;color:#5F5C56;font-size:14px}
h1{margin:4px 0 6px;font-size:40px;line-height:.98;letter-spacing:-.055em;font-weight:800;overflow-wrap:anywhere}.m{margin:0;font-size:16px;font-weight:500;font-variant-numeric:tabular-nums}
.about{font-size:18px;line-height:1.4;margin:26px 0 0;letter-spacing:-.02em}.pills{display:flex;gap:10px;flex-wrap:wrap;margin:22px 0 0}
.btn{border-radius:999px;padding:0 20px;min-height:46px;display:inline-flex;align-items:center;font-family:inherit;font-weight:500;font-size:15px;line-height:1;color:var(--ink);box-shadow:inset 0 0 0 1.5px var(--ink);text-decoration:none}
.btn.fill{background:var(--ink);color:var(--ground);box-shadow:none}.src{color:var(--muted);font-size:13px;margin-top:22px}.src a{color:inherit}
.foot{color:var(--muted);font-size:13px;text-align:center;margin-top:28px;font-weight:800;letter-spacing:-.04em}`;
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${h(title)}</title><style nonce="${nonce}">${css}</style></head><body>${body}</body></html>`;
  return new Response(html, { headers: {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
    'content-security-policy': `default-src 'none'; img-src 'self'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  } });
}

/** Rate limits for the public routes (per IP and hour). */
export async function publicLimit(env: Env, req: Request, bucket: string, max: number) {
  await rateLimit(env, bucket, req.headers.get('cf-connecting-ip') ?? 'local', max);
}
export { HttpError };
