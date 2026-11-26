// Split from app.js (wave 11): see the section comment below.
import { Icon } from '../ui/icons.js';
import { TG, tg } from './env.js';
import { LANG, t } from './i18n.js';
import { html, useEffect, useState } from 'https://unpkg.com/htm@3.1.1/preact/standalone.module.js';
 // straight line → road distance

// ---------------------------------------------------------------- store
export const S = { data: null, regions: null, error: null, loading: true, toast: null, sheet: null, planDay: null };
export const subs = new Set();
export const emit = () => subs.forEach((f) => f());
export function useStore() {
  const [, set] = useState(0);
  useEffect(() => {
    const f = () => set((x) => x + 1);
    subs.add(f);
    return () => subs.delete(f);
  }, []);
  return S;
}
export let toastTimer;
/** A short line at the bottom; `act` = {label, icon?, run} adds one button (an undo) and keeps it longer. */
export function toast(msg, act = null, ms = 2400) {
  if (S.closedHint > Date.now() && msg === t('err_generic')) msg = t('pp_closed_toast');
  if (S.demoHint > Date.now() && msg === t('err_generic')) msg = LANG === 'en' ? 'This is a demo: nothing is sent' : 'Это демо: тут ничего не отправляется';
  S.toast = msg;
  S.toastAct = act;
  emit();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { S.toast = null; S.toastAct = null; emit(); }, act ? Math.max(ms, 6000) : ms);
}
export function ToastEl() {
  if (!S.toast) return null;
  const a = S.toastAct;
  if (!a) return html`<div class="toast" role="status">${S.toast}</div>`;
  return html`<div class="toast act" role="status"><span class="grow">${S.toast}</span><button class="toast-act" onClick=${() => { clearTimeout(toastTimer); S.toast = null; S.toastAct = null; emit(); a.run(); }}>${a.icon && html`<${Icon} n=${a.icon} cls="sm" />`}${a.label}</button></div>`;
}
export const openSheet = (kind, arg) => { S.sheet = { kind, arg }; emit(); };
export const closeSheet = () => { S.sheet = null; emit(); };

export const hap = {
  impact: (s = 'light') => tg(() => TG?.HapticFeedback?.impactOccurred(s)),
  sel: () => tg(() => TG?.HapticFeedback?.selectionChanged()),
  ok: () => tg(() => TG?.HapticFeedback?.notificationOccurred('success')),
};
