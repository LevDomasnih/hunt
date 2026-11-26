// Split from wave5.ts.
import { sensitive } from './agent';
import { homeListing, placesAround, regionInfo } from './homepoint';
import { h, noSecrets, txt } from './local';
import { kvPhoto, mediaHeaders, withSrc } from './media';
import { fileResponse } from './tg';
import { Env, HttpError, event, hex, hmac, now, parseJson, sha256hex } from './util';

// ---------------------------------------------------------------- guide

const RULE_ICONS = ['smoke', 'water', 'zap', 'trash', 'moon', 'key', 'car', 'dog', 'pool', 'shoe', 'info'];
async function guideToken(env: Env, sid: string, version: number) {
  return hex(await hmac(env.LINK_SECRET, `guide|${sid}|${version}`)).slice(0, 32); // 128 bits, recomputable, only the hash is stored
}
export async function guideUrl(env: Env, row: any) {
  return row?.token_hash ? `${env.PUBLIC_URL}/g/${await guideToken(env, row.search_id, row.version)}` : null;
}
function cleanRules(v: unknown) {
  if (v == null) return null;
  if (!Array.isArray(v) || v.length > 12) throw new HttpError(400, 'bad_rules', 'rules must be a list of up to 12 {icon, text}');
  return v.map((x: any) => (typeof x === 'string' ? { icon: 'info', text: x } : x)).map((x: any) => ({ icon: RULE_ICONS.includes(x?.icon) ? x.icon : 'info', text: txt(x?.text, 140) })).filter((x) => x.text);
}
export async function setGuide(env: Env, sid: string, b: any, actor: string) {
  const old = await env.DB.prepare('SELECT * FROM guides WHERE search_id=?').bind(sid).first<any>();
  const v = (k: string, n: number) => (k in b ? txt(b[k], n) : old?.[k] ?? null);
  const row = {
    address: v('address', 200), map_url: v('map_url', 500), wifi_name: v('wifi_name', 64), wifi_password: v('wifi_password', 64), note: v('note', 400),
    rules: 'rules' in b ? cleanRules(b.rules) : parseJson(old?.rules, null),
  };
  if (row.map_url && !/^https:\/\//.test(row.map_url)) throw new HttpError(400, 'bad_url', 'map_url must be an https link');
  noSecrets('The guide', row.address ?? '', row.note ?? '', row.wifi_name ?? '', row.rules ?? []);
  if (row.wifi_password && sensitive(row.wifi_password)) throw new HttpError(400, 'sensitive', 'The Wi-Fi password looks like an ID or card number.');
  const hl = await homeListing(env, sid);
  const t = now();
  await env.DB.prepare(`INSERT INTO guides (search_id, listing_id, address, map_url, wifi_name, wifi_password, rules, note, updated_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(search_id) DO UPDATE SET listing_id=excluded.listing_id, address=excluded.address, map_url=excluded.map_url, wifi_name=excluded.wifi_name, wifi_password=excluded.wifi_password,
    rules=excluded.rules, note=excluded.note, updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
    .bind(sid, hl?.id ?? old?.listing_id ?? null, row.address, row.map_url, row.wifi_name, row.wifi_password, row.rules ? JSON.stringify(row.rules) : null, row.note, actor, old?.created_at ?? t, t).run();
  if (actor !== 'agent') await event(env, sid, 'guide', sid, actor, { fields: Object.keys(b).filter((k) => k !== 'search_id' && k !== 'wifi_password') });
}
/** share: make a link if there is none; regenerate: a new link (the old stops working); revoke: no link. share/regenerate make `uid` the host contact. */
export async function guideLink(env: Env, sid: string, action: string, uid: string) {
  if (!['share', 'regenerate', 'revoke'].includes(action)) throw new HttpError(400, 'bad_action');
  let row = await env.DB.prepare('SELECT * FROM guides WHERE search_id=?').bind(sid).first<any>();
  if (!row) { await setGuide(env, sid, {}, uid); row = await env.DB.prepare('SELECT * FROM guides WHERE search_id=?').bind(sid).first<any>(); }
  if (action === 'revoke') {
    await env.DB.prepare('UPDATE guides SET token_hash=NULL, updated_at=? WHERE search_id=?').bind(now(), sid).run();
    return null;
  }
  const version = action === 'regenerate' || !row.token_hash ? (action === 'regenerate' ? row.version + 1 : row.version) : row.version;
  const tok = await guideToken(env, sid, version);
  await env.DB.prepare('UPDATE guides SET token_hash=?, version=?, host_user_id=?, updated_at=? WHERE search_id=?').bind(await sha256hex(tok), version, uid, now(), sid).run();
  return `${env.PUBLIC_URL}/g/${tok}`;
}

/** The guide as members / guests / the public page see it. withSecret: Wi-Fi password; withUrl: the share link (members). */
export async function guideView(env: Env, s: { id: string; region: string; brief: any }, opts: { withSecret: boolean; withUrl: boolean; lang?: string; row?: any }) {
  const lang = opts.lang === 'en' ? 'en' : 'ru';
  const row = opts.row ?? (await env.DB.prepare('SELECT * FROM guides WHERE search_id=?').bind(s.id).first<any>());
  const hl = await homeListing(env, s.id);
  const { pack, kmh } = await regionInfo(env, s.region);
  const photos = parseJson<any[]>(hl?.photos, []);
  const lat = hl?.lat ?? null, lng = hl?.lng ?? null;
  let places: any[] = [];
  if (lat != null && lng != null) {
    const { list, types } = await placesAround(env, s, { lat, lng }, kmh);
    const order = ['beach', 'surf', 'coffee', 'supermarket', 'food', 'market', 'pharmacy', 'hospital', 'coworking', 'gym', 'yoga'];
    const byType = new Map<string, any>();
    for (const p of list.filter((x) => x.minutes <= 10).sort((a, b) => a.tier - b.tier || a.minutes - b.minutes)) if (order.includes(p.type) && !byType.has(p.type)) byType.set(p.type, p);
    places = order.filter((t) => byType.has(t)).slice(0, 6).map((t) => { const p = byType.get(t); return { name: p.name, type: p.type, emoji: types[p.type]?.emoji ?? null, minutes: p.minutes, lat: Number(p.lat), lng: Number(p.lng) }; });
  }
  const host = row?.host_user_id ? await env.DB.prepare('SELECT id, display_name, tg_username FROM users WHERE id=?').bind(row.host_user_id).first<any>() : null;
  const hosts = ((await env.DB.prepare(`SELECT u.display_name FROM members m JOIN users u ON u.id=m.user_id WHERE m.search_id=? AND m.role IN ('owner','member') ORDER BY m.role='owner' DESC, u.created_at`).bind(s.id).all<any>()).results ?? []).map((u) => String(u.display_name).split(' ')[0]);
  const em = (pack.emergency?.numbers ?? []).slice(0, 4).map((n: any) => ({ label: n.label?.[lang] ?? n.label?.en ?? n.id, phone: n.phone }));
  return {
    title: parseJson<any>(hl?.deal_data, {}).name ?? hl?.title ?? s.id, photo: hl ? withSrc(hl.id, photos)[0] ?? null : null, lat, lng,
    address: row?.address ?? hl?.area_text ?? null,
    map_url: row?.map_url ?? (lat != null ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : hl?.map_url ?? null),
    wifi_name: row?.wifi_name ?? null, wifi_password: opts.withSecret ? row?.wifi_password ?? null : null, wifi_password_set: !!row?.wifi_password,
    rules: parseJson<any[]>(row?.rules, []), note: row?.note ?? null,
    host: host ? { user_id: host.id, name: host.display_name, tg_username: host.tg_username ?? null } : null, hosts,
    url: opts.withUrl ? await guideUrl(env, row) : null, places, emergency: em, listing_id: hl?.id ?? null,
  };
}

const RULE_SVG: Record<string, string> = {
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  smoke: '<path d="M2 16h15v4H2zM22 16v4M18 8c0-2.5-2-2.5-2-5M22 8c0-2.5-2-2.5-2-5M2 2l20 20"/>',
  water: '<path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05zM12.56 6.6A11 11 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9L18 10l-2.7-3.6A2 2 0 0 0 13.7 6H7.3a2 2 0 0 0-1.6.8L3 10.5l-1.2.4C1.3 11.1 1 11.6 1 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
  dog: '<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.05Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/>',
  pool: '<path d="M2 12h20M2 17c1.5 0 2.5-1 4-1s2.5 1 4 1 2.5-1 4-1 2.5 1 4 1 2.5-1 4-1M6 12V5a2 2 0 0 1 4 0M14 12V5a2 2 0 0 1 4 0"/>',
  shoe: '<path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0ZM20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z"/>',
};
const svg = (paths: string, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

/** Public guest guide: GET /g/<token> (HTML) and /g/<token>/photo. No tracking, noindex, no-store, strict CSP, guide fields only. */
export async function handleGuidePage(req: Request, env: Env, path: string): Promise<Response> {
  const m = path.match(/^\/g\/([a-f0-9]{32})(\/photo)?\/?$/);
  const notFound = () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } });
  if (!m) return notFound();
  const row = await env.DB.prepare('SELECT g.*, s.region, s.brief, s.status FROM guides g JOIN searches s ON s.id=g.search_id WHERE g.token_hash=?').bind(await sha256hex(m[1])).first<any>();
  if (!row || row.status === 'closed') return notFound();
  const s = { id: row.search_id, region: row.region, brief: row.brief };
  if (m[2]) {
    const hl = await homeListing(env, s.id);
    const p = parseJson<any[]>(hl?.photos, [])[0];
    const hdr = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' };
    if (p?.kv) {
      const got = await kvPhoto(env, p.kv, p.i ?? null);
      return got ? new Response(got.body, { headers: mediaHeaders(got.type ?? 'image/jpeg', hdr) }) : notFound();
    }
    if (p?.file_id) { const r = await fileResponse(env, p.file_id); return new Response(r.body, { status: r.status, headers: { ...hdr, 'content-type': r.headers.get('content-type') ?? 'image/jpeg' } }); }
    if (p?.url && /^https:\/\//.test(p.url)) { const r = await fetch(p.url); return r.ok ? new Response(r.body, { headers: mediaHeaders(/^image\//.test(r.headers.get('content-type') ?? '') ? r.headers.get('content-type') : 'image/jpeg', hdr) }) : notFound(); }
    if (p?.url && /^\/demo\/[\w.-]+$/.test(p.url)) return env.ASSETS.fetch(new Request(new URL(p.url, req.url)));
    return notFound();
  }
  const ql = new URL(req.url).searchParams.get('lang');
  const lang = ql === 'en' || ql === 'ru' ? ql : /^ru|,\s*ru/i.test(req.headers.get('accept-language') ?? '') ? 'ru' : 'en';
  const g = await guideView(env, s, { withSecret: true, withUrl: false, lang, row });
  const ru = lang === 'ru';
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  const hosts = g.hosts.length > 1 ? `${g.hosts.slice(0, -1).join(', ')} ${ru ? 'и' : 'and'} ${g.hosts[g.hosts.length - 1]}` : g.hosts[0] ?? '';
  const hostsRu = ru ? g.hosts.map((n) => n.replace(/(.*?)(ь|й)$/, '$1я').replace(/(.*?)([^аяьйео])$/, '$1$2а')) : g.hosts;
  const hostsLabel = ru ? (hostsRu.length > 1 ? `${hostsRu.slice(0, -1).join(', ')} и ${hostsRu[hostsRu.length - 1]}` : hostsRu[0] ?? '') : hosts;
  const I = {
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    wifi: '<path d="M12 20h.01M2 8.82a15 15 0 0 1 20 0M5 12.86a10 10 0 0 1 14 0M8.5 16.43a5 5 0 0 1 7 0"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  };
  const min = (n: number) => (ru ? `${n} мин` : `${n} min`);
  const body = `
<div class="bar" aria-hidden="true">hunt</div>
${g.photo ? `<img class="hero" src="/g/${h(m[1])}/photo" alt="">` : ''}
<main>
<p class="kicker">${ru ? 'Гайд для гостей' : 'Guest guide'}${hostsLabel ? ` · ${ru ? 'от' : 'from'} ${h(hostsLabel)}` : ''}</p>
<h1>${h(g.title)}</h1>
${g.address || g.map_url ? `<section class="card row">${svg(I.pin)}<div class="grow"><b>${h(g.address ?? (ru ? 'Адрес' : 'Address'))}</b></div>${g.map_url ? `<a class="btn accent" href="${h(g.map_url)}" rel="noopener noreferrer" target="_blank">${ru ? 'Карта' : 'Map'}</a>` : ''}</section>` : ''}
${g.wifi_name ? `<section class="card row">${svg(I.wifi)}<div class="grow"><b>Wi-Fi: ${h(g.wifi_name)}</b>${g.wifi_password ? `<span class="muted">${ru ? 'пароль' : 'password'}: <span id="pw" data-pw="${h(g.wifi_password)}">••••••••</span></span>` : ''}</div>${g.wifi_password ? `<button class="btn" id="show" type="button">${ru ? 'Показать' : 'Show'}</button>` : ''}</section>` : ''}
${g.rules.length ? `<section class="card list"><h2>${ru ? 'Правила дома' : 'House rules'}</h2>${g.rules.map((r: any) => `<div class="li">${svg(RULE_SVG[r.icon] ?? RULE_SVG.info, 'ic muted')}<span>${h(r.text)}</span></div>`).join('')}</section>` : ''}
${g.note ? `<section class="card"><p>${h(g.note)}</p></section>` : ''}
${g.places.length ? `<div class="places">${g.places.map((p: any) => `<a class="card place" href="https://www.google.com/maps/search/?api=1&amp;query=${Number(p.lat)},${Number(p.lng)}" rel="noopener noreferrer" target="_blank"><span class="muted">${h(p.emoji ?? '📍')} ${min(p.minutes)}</span><b>${h(p.name)}</b></a>`).join('')}</div>` : ''}
${g.emergency.length ? `<section class="card list"><h2>${ru ? 'Экстренные номера' : 'Emergency numbers'}</h2>${g.emergency.map((e: any) => `<a class="li" href="tel:${h(String(e.phone).replace(/[^\d+]/g, ''))}">${svg(I.phone, 'ic muted')}<span class="grow">${h(e.label)}</span><b>${h(e.phone)}</b></a>`).join('')}</section>` : ''}
${g.host ? `<section class="card row">${svg(I.send)}<div class="grow"><b>${h(g.host.name)}</b><span class="muted">${ru ? 'хозяева дома' : 'your hosts'}</span></div>${g.host.tg_username ? `<a class="btn accent" href="https://t.me/${h(g.host.tg_username)}" rel="noopener noreferrer" target="_blank">Telegram</a>` : ''}</section>` : ''}
<p class="foot">hunt</p>
</main>`;
  // Wave 8 · Block vibe (DESIGN.md "Update 21.11.2026"): the region's solid screen colour, dot grid, ink text, a floating tilted
  // photo, a giant title, hairline lists and black pills; night palette in the dark theme. The strict CSP stays (no web fonts,
  // no data: images), so Inter Tight is used only when installed, then the system sans.
  const screen = ({ bali: '#E8E35C', kz: '#9ED0F2', th: '#FFB65C' } as Record<string, string>)[String(row.region ?? '').split('/')[0]] ?? '#E6E4DF';
  const css = `:root{--ground:${screen};--ink:#151413;--muted:#46433D;--line:#1514131F;--line2:#15141340;--fill:#151413;--on:#F2F0EA;--dots:#1514131C;--paper:#F5F4F0}
@media (prefers-color-scheme:dark){:root{--ground:#151413;--ink:#F2F0EA;--muted:#A9A59C;--line:#F2F0EA26;--line2:#F2F0EA66;--fill:#F2F0EA;--on:#151413;--dots:#F2F0EA1F;--paper:#22201E}}
*{box-sizing:border-box}html{background:var(--ground)}body{margin:0;background-color:var(--ground);background-image:radial-gradient(var(--dots) 1px,transparent 1.3px);background-size:18px 18px;color:var(--ink);font:16px/1.4 "Inter Tight","Inter",-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;letter-spacing:-.012em}
:focus-visible{outline:3px solid #1F6BFF;outline-offset:2px}
main{max-width:560px;margin:0 auto;padding:18px 20px 40px}.bar{max-width:560px;margin:0 auto;padding:16px 20px 0;font-weight:800;font-size:23px;letter-spacing:-.06em}
.hero{display:block;width:calc(100% - 48px);max-width:512px;height:230px;margin:22px auto 6px;object-fit:cover;border-radius:22px;transform:rotate(-2deg);box-shadow:0 26px 44px rgba(58,52,20,.34)}
.kicker{margin:18px 0 6px;color:var(--muted);font-weight:500;font-size:15px}h1{margin:0 0 20px;font-size:46px;line-height:.98;letter-spacing:-.055em;font-weight:800;overflow-wrap:anywhere}
.card{display:block;padding:16px 0;margin:0;border-top:1px solid var(--line);color:inherit;text-decoration:none}
.row{display:flex;align-items:center;gap:14px}.grow{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}.grow b{font-size:18px;font-weight:600;letter-spacing:-.025em}.muted{color:var(--muted)}
.ic{width:24px;height:24px;flex:none;color:var(--ink)}.ic.muted{color:var(--muted)}
.btn{border:0;border-radius:999px;padding:0 18px;font:500 15px/1 inherit;background:transparent;color:var(--ink);box-shadow:inset 0 0 0 1.5px var(--ink);text-decoration:none;cursor:pointer;min-height:46px;display:inline-flex;align-items:center}
.btn.accent{background:var(--fill);color:var(--on);box-shadow:none}.list{padding:0}.list h2{margin:0;padding:18px 0 6px;font-size:14px;font-weight:500;color:var(--muted)}
.li{display:flex;align-items:center;gap:14px;padding:13px 0;border-top:1px solid var(--line);color:inherit;text-decoration:none;font-size:16px}.li b{font-weight:600}
.places{display:grid;grid-template-columns:repeat(3,1fr);gap:14px 16px;margin:6px 0 4px;padding-top:4px;border-top:1px solid var(--line)}.place{padding:12px 0 0;margin:0;border-top:1.5px solid var(--ink);display:flex;flex-direction:column;gap:4px;font-size:14px}
.place b{font-size:16px;font-weight:600;letter-spacing:-.02em;overflow:hidden;text-overflow:ellipsis}.foot{color:var(--muted);font-size:13px;text-align:center;margin-top:28px;font-weight:800;letter-spacing:-.04em}
section.card p{margin:0;font-size:17px;line-height:1.45}
@media (max-width:360px){.places{grid-template-columns:repeat(2,1fr)}h1{font-size:38px}}`;
  const js = `document.getElementById('show')?.addEventListener('click',function(){var p=document.getElementById('pw');var o=p.textContent.indexOf('•')<0;p.textContent=o?'••••••••':p.dataset.pw;this.textContent=o?${JSON.stringify(ru ? 'Показать' : 'Show')}:${JSON.stringify(ru ? 'Скрыть' : 'Hide')};});`;
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${h(g.title)}</title><style nonce="${nonce}">${css}</style></head><body>${body}<script nonce="${nonce}">${js}</script></body></html>`;
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
      'content-security-policy': `default-src 'none'; img-src 'self'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    },
  });
}
