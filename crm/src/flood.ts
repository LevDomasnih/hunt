// Split from wave4.ts.
import { noSecrets, txt } from './check';
import { Env, HttpError, event, now, parseJson } from './util';

// ---------------------------------------------------------------- flood

export const FLOOD_LEVELS = ['low', 'medium', 'high'];
export async function setFlood(env: Env, l: any, b: any, actor: string) {
  if (!FLOOD_LEVELS.includes(b.level)) throw new HttpError(400, 'bad_level', 'level must be low, medium or high');
  const old = parseJson<any>(l.flood, {});
  const sources = (Array.isArray(b.sources) ? b.sources : []).slice(0, 8).map((x: any) => ({
    kind: ['terrain', 'chats', 'notes', 'area'].includes(x?.kind) ? x.kind : 'notes', title: txt(x?.title, 80) ?? '', text: txt(x?.text, 300),
  }));
  const t = b.terrain && typeof b.terrain === 'object' ? { elev: Number(b.terrain.elev) || null, ring_mean: Number(b.terrain.ring_mean) || null, diff: Number.isFinite(Number(b.terrain.diff)) ? Math.round(Number(b.terrain.diff) * 10) / 10 : null, ring_m: Number(b.terrain.ring_m) || null } : old.terrain ?? null;
  const flood = { level: b.level, summary: txt(b.summary, 300), sources, terrain: t, notes: old.notes ?? [], at: now() };
  noSecrets('The flood data', flood.summary ?? '', sources);
  await env.DB.prepare('UPDATE listings SET flood=?, updated_at=? WHERE id=?').bind(JSON.stringify(flood), now(), l.id).run();
  if (old.level !== b.level) await event(env, l.search_id, 'flood', l.id, actor, { title: l.title, level: b.level });
  return flood;
}
export async function addFloodNote(env: Env, l: any, user: { id: string; display_name: string }, text: unknown) {
  const t = txt(text, 200);
  if (!t) throw new HttpError(400, 'missing', 'text is required');
  noSecrets('The note', t);
  const f = parseJson<any>(l.flood, {});
  f.notes = [...(f.notes ?? []), { user_id: user.id, name: user.display_name, text: t, at: now() }].slice(-10);
  await env.DB.prepare('UPDATE listings SET flood=? WHERE id=?').bind(JSON.stringify(f), l.id).run();
  await event(env, l.search_id, 'instruction', l.id, user.id, { name: user.display_name, kind: 'flood_note', text: `${l.title}: ${t}` });
  return f;
}
