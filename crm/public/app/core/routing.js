// Split from app.js (wave 11): see the section comment below.
import { TG, inTG, tg } from './env.js';
import { S } from './store.js';
import { useEffect, useState } from 'https://unpkg.com/htm@3.1.1/preact/standalone.module.js';

// ---------------------------------------------------------------- routing
export function parseHash() {
  let h = location.hash.slice(1);
  h = h.split(/[&?]?tgWebApp/)[0];
  try { h = decodeURIComponent(h); } catch { /* keep */ }
  if (!h || h === '/') return { screen: 'start', key: 'start' };
  if (!h.startsWith('/')) return h === 'plan' ? { screen: 'plan', legacy: true, key: h } : { screen: 'listing', arg: h, legacy: true, key: h };
  const p = h.split('/').filter(Boolean);
  if (p[0] === 'searches') return { screen: 'picker', key: 'picker' };
  if (p[0] === 'new') return { screen: 'newproject', key: 'new' };
  if (p[0] === 's' && p[1]) return { sid: p[1], screen: p[2] || 'today', arg: p[3], key: h };
  return { screen: 'start', key: 'start' };
}
export let depth = 0;
export function go(path, replace = false) {
  if (replace) {
    history.replaceState(null, '', '#' + path);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    depth++;
    location.hash = path;
  }
}
export const sp = (screen, arg) => `/s/${S.data?.search?.id}/${screen}${arg ? '/' + encodeURIComponent(arg) : ''}`;
export function back() {
  if (depth > 0) { depth--; history.back(); } else go(sp('today'), true);
}
export function useRoute() {
  const [r, set] = useState(parseHash);
  useEffect(() => {
    const f = () => set(parseHash());
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return r;
}
export function openLink(url) {
  if (!url) return;
  if (inTG && /^https:\/\/t\.me\//.test(url)) tg(() => TG.openTelegramLink(url));
  else if (/^(tg|mailto|tel):/.test(url)) location.href = url;
  else if (inTG) tg(() => TG.openLink(url));
  else window.open(url, '_blank', 'noopener');
}
