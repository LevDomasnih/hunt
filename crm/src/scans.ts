// Split from wave4.ts.
import { noSecrets, txt } from './check';
import { Env, HttpError, event, now, rid } from './util';

// ---------------------------------------------------------------- 3D scans

export const SCAN_PHASES = ['movein', 'moveout', 'bike'];
export async function setScan(env: Env, s: { id: string }, id: string, b: any, actor: string) {
  const old = id === 'new' ? null : await env.DB.prepare('SELECT * FROM scans WHERE id=? AND search_id=?').bind(id, s.id).first<any>();
  if (id !== 'new' && !old) throw new HttpError(404, 'no_scan');
  const v = (k: string) => (k in b ? b[k] : old?.[k] ?? null);
  const room = txt(v('room'), 60);
  if (!room) throw new HttpError(400, 'missing', 'room is required');
  const phase = SCAN_PHASES.includes(v('phase')) ? v('phase') : 'movein';
  const status = ['ok', 'redo', 'todo'].includes(v('status')) ? v('status') : v('doc_id') ? 'ok' : 'todo';
  const deal = await env.DB.prepare('SELECT listing_id FROM deals WHERE search_id=? ORDER BY updated_at DESC LIMIT 1').bind(s.id).first<any>();
  const note = txt(v('note'), 200);
  noSecrets('The scan note', note ?? '');
  const sid = old?.id ?? rid('sc_');
  const t = now();
  await env.DB.prepare(`INSERT INTO scans (id, search_id, listing_id, bike_id, room, phase, status, note, doc_id, app, sort, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET listing_id=excluded.listing_id, bike_id=excluded.bike_id, room=excluded.room, phase=excluded.phase, status=excluded.status, note=excluded.note,
    doc_id=excluded.doc_id, app=excluded.app, sort=excluded.sort, updated_at=excluded.updated_at`)
    .bind(sid, s.id, v('listing_id') ?? deal?.listing_id ?? null, v('bike_id'), room, phase, status, note, v('doc_id'), txt(v('app'), 30), Number(v('sort')) || 0, old?.created_by ?? actor, old?.created_at ?? t, t).run();
  if (!old || old.status !== status) await event(env, s.id, 'scan', sid, actor, { room, phase, status });
  return env.DB.prepare('SELECT * FROM scans WHERE id=?').bind(sid).first<any>();
}
export async function scansOf(env: Env, sid: string) {
  const rows = (await env.DB.prepare(`SELECT sc.*, d.size doc_size, d.created_at doc_at, d.file_name, (d.tg_file_id IS NOT NULL) has_file FROM scans sc LEFT JOIN documents d ON d.id=sc.doc_id
    WHERE sc.search_id=? ORDER BY sc.phase, sc.sort, sc.created_at`).bind(sid).all<any>()).results ?? [];
  return rows.map((r) => ({ ...r, has_file: !!r.has_file }));
}
