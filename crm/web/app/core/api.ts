// Split from app.js (wave 11): see the section comment below.
import { demoApi, demoOn } from '../../demo.js';
import { groupDecision, votesFor } from './data.js';
import { TG, inTG, pref, tg } from './env.js';
import { applyLang, t } from './i18n.js';
import { S, emit, toast } from './store.js';

// ---------------------------------------------------------------- api
export const urlKey = new URLSearchParams(location.search).get('k');
if (urlKey) tg(() => sessionStorage.setItem('hunt.k', urlKey));
export const linkKey = urlKey || tg(() => sessionStorage.getItem('hunt.k'));
export const authHeaders = () => (inTG ? { 'x-tg-init-data': TG.initData } : linkKey ? { 'x-hunt-link': linkKey } : {});
export async function api(path, body?, method?) {
  if (demoOn) { try { return await demoApi(path, body); } catch (e) { if (body) { S.demoHint = Date.now() + 1500; } throw e; } }
  const r = await fetch(path, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { ...authHeaders(), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e: any = new Error(d.message || d.error || String(r.status));
    e.code = d.error;
    e.status = r.status;
    if (d.error === 'closed') S.closedHint = Date.now() + 1500; // wave 6 · A: the generic error toast says "closed" instead
    throw e;
  }
  return d;
}
export function applyRegion(country) {
  const has = !!S.regions?.[country];
  if (has) document.documentElement.dataset.region = country;
  else delete document.documentElement.dataset.region;
}
export const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
/** Theme preference: 'light' (default), 'dark' or 'auto' (follows Telegram / the system). Stored per device. */
export function themePref() { try { const v = localStorage.getItem('hunt.theme'); return v === 'dark' || v === 'auto' ? v : 'light'; } catch { return 'light'; } }
export function setThemePref(v) { try { localStorage.setItem('hunt.theme', v); } catch {} applyTheme(); }
export function applyTheme() {
  const pref = themePref();
  const sys = inTG && TG.colorScheme ? TG.colorScheme : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = pref === 'auto' ? sys : pref;
  tg(() => {
    if (!inTG) return;
    TG.setHeaderColor(cssVar('--ground'));
    TG.setBackgroundColor(cssVar('--ground'));
    TG.setBottomBarColor?.(cssVar('--ground'));
  });
  emit();
}
export const isDark = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);

export const startParam = tg(() => TG?.initDataUnsafe?.start_param) || null;
export let loadSeq = 0;
export async function load(sid, { quiet = false, listing = null } = {}) {
  const seq = ++loadSeq;
  if (!quiet) { S.loading = true; emit(); }
  try {
    const q = sid ? `?s=${encodeURIComponent(sid)}` : listing ? `?l=${encodeURIComponent(listing)}` : '';
    // Money, the house, documents and wave 4 blocks come from a second call (keeps each Worker call small); merged before render.
    const more = (s) => api('/app/api/state-more?s=' + encodeURIComponent(s)).catch(() => null);
    const [d, m0] = await Promise.all([api('/app/api/state' + q), sid ? more(sid) : null]);
    const canMore = d.search && d.me?.role && d.me.role !== 'guest';
    const m = canMore ? (m0 && m0.search_id === d.search.id ? m0 : await more(d.search.id)) : null;
    if (m) { const { search_id, ...rest } = m; Object.assign(d, rest); }
    if (seq !== loadSeq) return;
    S.data = d;
    S.error = null;
    applyLang(d.user?.lang);
    if (d.search) {
      pref.set('sid', d.search.id);
      applyRegion(d.search.country);
      document.documentElement.toggleAttribute('data-closed', !!d.path?.closed); // wave 6 · A: closed = read-only
    }
  } catch (e) {
    if (seq !== loadSeq) return;
    S.error = e;
  }
  S.loading = false;
  emit();
}
export let refreshTimer;
export const refresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => S.data?.search && load(S.data.search.id, { quiet: true }), 600); };

export async function vote(lid, decision) {
  const d = S.data;
  const uid = d.user.id;
  d.votes = d.votes.filter((v) => !(v.listing_id === lid && v.user_id === uid)).concat([{ listing_id: lid, user_id: uid, decision, at: new Date().toISOString() }]);
  const l = d.listings.find((x) => x.id === lid);
  if (l) l.decision = groupDecision(votesFor(lid)) ?? l.decision;
  emit();
  try {
    const r = await api('/app/api/vote', { listing_id: lid, decision });
    if (l && 'decision' in r) { l.decision = r.decision; emit(); }
  } catch { toast(t('err_generic')); }
  refresh();
}
export async function unvote(lid) {
  const d = S.data;
  d.votes = d.votes.filter((v) => !(v.listing_id === lid && v.user_id === d.user.id));
  const l = d.listings.find((x) => x.id === lid);
  if (l && votesFor(lid).length) l.decision = groupDecision(votesFor(lid));
  emit();
  try { await api('/app/api/unvote', { listing_id: lid }); } catch { toast(t('err_generic')); }
  refresh();
}
