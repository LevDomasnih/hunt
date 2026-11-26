import { esc, parseJson } from './util';
import { t, Decision } from './i18n';
import { InlineButton } from './tg';

export function money(n: number | null | undefined, cur?: string | null): string {
  if (n == null) return '';
  const short =
    n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${+(n / 1000).toFixed(0)}k` : String(n);
  return cur ? `${short} ${cur}` : short;
}

const DEC_ICON: Record<string, string> = { want_view: '👀', thinking: '🤔', not_interested: '✕', take: '✅' };

export function listingCard(l: any, lang: string, votes: { name: string; decision: string }[] = []): string {
  const fields = parseJson<Record<string, unknown>>(l.fields, {});
  const head = [
    l.bedrooms != null ? `${l.bedrooms} ${t(lang, 'beds')}` : '',
    l.price != null ? `${money(l.price, l.currency)}${t(lang, 'per_month')}` : '',
    l.district || l.area_text || '',
  ]
    .filter(Boolean)
    .join(' · ');
  const lines = [`<b>${esc(l.title)}</b>`, head ? esc(head) : ''];
  if (l.price_note) lines.push(esc(l.price_note));
  const extra = Object.entries(fields)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
    .join(' · ');
  if (extra) lines.push(esc(extra));
  if (l.available) lines.push(`📅 ${esc(l.available)}`);
  if (l.summary) lines.push('', esc(l.summary));
  const links = [l.map_url ? `<a href="${esc(l.map_url)}">📍 map</a>` : '', l.source_url ? `<a href="${esc(l.source_url)}">🔗 listing</a>` : '']
    .filter(Boolean)
    .join('  ');
  if (links) lines.push('', links);
  if (votes.length) lines.push('', `${t(lang, 'voted')}: ` + votes.map((v) => `${DEC_ICON[v.decision] ?? ''} ${esc(v.name)}`).join(', '));
  return lines.filter((x, i) => x !== '' || lines[i - 1] !== '').join('\n');
}

export function listingKeyboard(l: any, lang: string, appUrl: string): InlineButton[][] {
  const d = (x: Decision) => ({ text: (l.decision === x ? '• ' : '') + t(lang, x), callback_data: `v:${x}:${l.id}` });
  return [
    [d('want_view'), d('thinking')],
    [d('not_interested'), { text: t(lang, 'open'), url: `${appUrl}#${encodeURIComponent(l.id)}` }],
  ];
}

export function draftCard(d: any, lang: string, contactName: string | null, listingTitle: string | null): string {
  const who = [contactName, d.channel, d.address].filter(Boolean).join(' · ');
  const lines = [`📝 <b>${t(lang, 'draft_for')}</b> ${esc(who)}`];
  if (listingTitle) lines.push(`🏠 ${esc(listingTitle)}`);
  if (d.reason) lines.push(`${t(lang, 'why')}: ${esc(d.reason)}`);
  lines.push('', `<blockquote>${esc(d.edited_text ?? d.text)}</blockquote>`);
  return lines.join('\n');
}

export function draftKeyboard(d: any, lang: string): InlineButton[][] {
  return [[
    { text: t(lang, 'send'), callback_data: `d:ok:${d.id}` },
    { text: t(lang, 'edit'), callback_data: `d:ed:${d.id}` },
    { text: t(lang, 'skip'), callback_data: `d:no:${d.id}` },
  ]];
}

/** Google Maps directions link with waypoints, no API key needed. */
export function routeLink(points: { lat: number | null; lng: number | null; map_url?: string | null }[]): string | null {
  const pts = points.filter((p) => p.lat != null && p.lng != null).map((p) => `${p.lat},${p.lng}`);
  if (pts.length < 2) return null;
  const u = new URL('https://www.google.com/maps/dir/');
  u.searchParams.set('api', '1');
  u.searchParams.set('origin', pts[0]);
  u.searchParams.set('destination', pts[pts.length - 1]);
  if (pts.length > 2) u.searchParams.set('waypoints', pts.slice(1, -1).join('|'));
  return u.toString();
}

export function dayPlan(rows: any[], lang: string, dateLabel: string): string {
  if (!rows.length) return `${t(lang, 'plan_title')} ${esc(dateLabel)}: ${t(lang, 'nothing')}`;
  const lines = [`🗓 <b>${t(lang, 'plan_title')} ${esc(dateLabel)}</b>`];
  for (const r of rows) {
    const time = String(r.starts_at).slice(11, 16);
    const ok = r.status === 'confirmed' ? '✅' : r.status === 'cancelled' ? '✕' : '⏳';
    const map = r.map_url ? ` · <a href="${esc(r.map_url)}">📍</a>` : '';
    lines.push(`${ok} <b>${time}</b> ${esc(r.title)}${r.meet_note ? ` · ${esc(r.meet_note)}` : ''}${map}`);
  }
  const route = routeLink(rows.filter((r) => r.status !== 'cancelled'));
  if (route) lines.push('', `<a href="${esc(route)}">🧭 ${t(lang, 'route')}</a>`);
  return lines.join('\n');
}
