import type { Store, ToastAct } from '../../types/api.js';
import { TG, tg } from './env.js';
import { LANG, t } from './i18n.js';
import { useEffect, useState } from 'preact/hooks';

// ---------------------------------------------------------------- store
export const S: Store = { data: null, regions: null, error: null, loading: true, toast: null, sheet: null, planDay: null };
export const subs = new Set<() => void>();
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
export let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** A short line at the bottom; `act` = {label, icon?, run} adds one button (an undo) and keeps it longer. */
export function toast(msg: string, act: ToastAct | null = null, ms = 2400) {
  if (S.closedHint > Date.now() && msg === t('err_generic')) msg = t('pp_closed_toast');
  if (S.demoHint > Date.now() && msg === t('err_generic')) msg = LANG === 'en' ? 'This is a demo: nothing is sent' : 'Это демо: тут ничего не отправляется';
  S.toast = msg;
  S.toastAct = act;
  emit();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { S.toast = null; S.toastAct = null; emit(); }, act ? Math.max(ms, 6000) : ms);
}
export const openSheet = (kind: string, arg?: any) => { S.sheet = { kind, arg }; emit(); };
export const closeSheet = () => { S.sheet = null; emit(); };

export const hap = {
  impact: (s = 'light') => tg(() => TG?.HapticFeedback?.impactOccurred(s)),
  sel: () => tg(() => TG?.HapticFeedback?.selectionChanged()),
  ok: () => tg(() => TG?.HapticFeedback?.notificationOccurred('success')),
};
