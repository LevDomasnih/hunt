// The toast line at the bottom (state and toast() live in core/store.ts).
import { S, emit, toastTimer } from '../core/store.js';
import { Icon } from './icons.js';
import { html } from 'htm/preact';

export function ToastEl() {
  if (!S.toast) return null;
  const a = S.toastAct;
  if (!a) return html`<div class="toast" role="status">${S.toast}</div>`;
  return html`<div class="toast act" role="status"><span class="grow">${S.toast}</span><button class="toast-act" onClick=${() => { clearTimeout(toastTimer); S.toast = null; S.toastAct = null; emit(); a.run(); }}>${a.icon && html`<${Icon} n=${a.icon} cls="sm" />`}${a.label}</button></div>`;
}
