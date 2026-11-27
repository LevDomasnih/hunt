// What the page runs in: Telegram or a browser, motion and storage helpers, the map library's address.
export const TG = window.Telegram && window.Telegram.WebApp;
export const inTG = !!(TG && TG.initData);
export const MAPLIBRE = 'https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl';
export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Runs `fn`, swallowing errors (Telegram methods missing in old clients, storage blocked in private windows). */
export const tg = <T>(fn: () => T): T | undefined => { try { return fn(); } catch { return undefined; } };
export const pref = {
  get: (k: string) => tg(() => localStorage.getItem('hunt.' + k)),
  set: (k: string, v: string) => tg(() => localStorage.setItem('hunt.' + k, v)),
};
