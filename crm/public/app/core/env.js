// Split from app.js (wave 11): see the section comment below.

 // wave 7: one category effect per event photo

export const TG = window.Telegram && window.Telegram.WebApp;
export const inTG = !!(TG && TG.initData);
export const MAPLIBRE = 'https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl';
export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const tg = (fn) => { try { return fn(); } catch { return undefined; } };
export const pref = {
  get: (k) => tg(() => localStorage.getItem('hunt.' + k)),
  set: (k, v) => tg(() => localStorage.setItem('hunt.' + k, v)),
};
