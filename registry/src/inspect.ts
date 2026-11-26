// What may be in a proposal and what the admin should look at. Pack texts are read by every hunter's agent, so a proposal that
// talks to agents, hides text or carries somebody's contacts is the thing to catch. Hard errors refuse, flags are shown.

export interface PackFile { path: string; content: string }
export const MAX_FILES = 120, MAX_FILE = 400_000, MAX_TOTAL = 900_000;
// No toys and no island here: they are rendered from the drawings when the proposal is merged.
const PATH = /^regions\/([a-z]{2,20})\/(?:[a-z0-9_]+\/){0,3}[a-z0-9_-]+\.(yaml|md|geojson|svg)$/;
const HIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f­​-‏‪-‮⁠-⁩﻿]/;

/** Throws nothing: the first hard problem as text, or null. */
export function refuse(country: string, files: PackFile[]): string | null {
  if (!files.length) return 'no files';
  if (files.length > MAX_FILES) return `more than ${MAX_FILES} files`;
  const seen = new Set<string>();
  let total = 0;
  for (const f of files) {
    const m = typeof f?.path === 'string' ? PATH.exec(f.path) : null;
    if (!m) return `bad path ${String(f?.path).slice(0, 80)}`;
    if (m[1] !== country) return `${f.path} is not in regions/${country}`;
    if (seen.has(f.path)) return `${f.path} twice`;
    seen.add(f.path);
    if (typeof f.content !== 'string' || !f.content) return `${f.path} is empty`;
    if (f.content.length > MAX_FILE) return `${f.path} is too big`;
    total += f.content.length;
    if (HIDDEN.test(f.content)) return `${f.path} has hidden characters`;
    if (m[2] === 'svg' && (/<(script|foreignObject|image|iframe|style|a)\b|\son\w+\s*=|<!DOCTYPE|<!ENTITY|javascript:|data:/i.test(f.content) || /(href|src)\s*=\s*["'](?!#)/i.test(f.content) || !/^\s*(<\?xml[^>]*>\s*)?<svg\b/.test(f.content))) return `${f.path} is not a plain drawing`;
    if (m[2] === 'geojson') { try { if (JSON.parse(f.content)?.type !== 'FeatureCollection') return `${f.path} is not a FeatureCollection`; } catch { return `${f.path} is not JSON`; } }
  }
  return total > MAX_TOTAL ? 'too big in total' : null;
}

const RULES: [string, RegExp, ((p: string) => boolean)?][] = [
  ['talks to an agent', /(ignore|disregard|forget)\b.{0,30}\b(previous|prior|above|earlier|all)\b.{0,20}\b(instruction|rule|prompt)|system prompt|you are now\b|as an ai\b|(игнорируй|забудь|не соблюдай).{0,40}(инструкц|правил)|ты теперь\b/i],
  ['asks for actions', /\b(tg_send|wa_send|fb_send|ig_send|draft_create|draft_mark|bridge_send|notify|mcp__|curl |wget |rm -rf|eval\(|base64|subprocess|npx |uvx? run|pip install)\b|~\/\.|\.env\b/i],
  ['mentions secrets', /\b(api[_ -]?key|access token|secret key|seed phrase|private key)\b|пароль от|токен доступа/i],
  ['hidden comment', /<!--/],
  ['e-mail', /[\w.+-]+@[\w-]+\.[a-z]{2,}/i],
  ['phone', /(?:\+|00)\d[\d ()-]{8,}\d|wa\.me\//, (p) => !/(emergency\.yaml|places\.yaml|events\.yaml)$/.test(p)],
  ['@nickname', /(^|[\s"'([,])@[A-Za-z][A-Za-z0-9_]{4,31}\b/m, (p) => !/(useful\.yaml|events\.yaml)$/.test(p)],
  ['plain http link', /http:\/\//i],
  ['link shortener', /\b(bit\.ly|goo\.gl|t\.co|tinyurl\.com|cutt\.ly|clck\.ru)\b/i],
];
export function flags(files: PackFile[]): { path: string; what: string; line: number; text: string }[] {
  const out: { path: string; what: string; line: number; text: string }[] = [];
  for (const f of files) {
    if (f.path.endsWith('.geojson') || f.path.endsWith('.svg')) continue;
    for (const [i, l] of f.content.split('\n').entries()) for (const [what, re, on] of RULES) {
      if (on && !on(f.path)) continue;
      if (re.test(l)) out.push({ path: f.path, what, line: i + 1, text: l.trim().slice(0, 160) });
      if (out.length >= 80) return out;
    }
  }
  return out;
}
