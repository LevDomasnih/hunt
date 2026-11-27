// A D1-shaped database on node:sqlite, for running the Worker on an ordinary server (node/server.mjs).
// It covers what src/ uses: prepare().bind().first|all|run|raw, batch (one transaction, like D1) and exec.
import { DatabaseSync } from 'node:sqlite';

/** D1 binds booleans as 1/0 and has no undefined; node:sqlite wants plain SQLite values. */
const val = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v instanceof ArrayBuffer ? new Uint8Array(v) : v);

class Statement {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Statement(this.db, this.sql, args.map(val)); }
  stmt() { return this.db.cache(this.sql); }
  meta(changes = 0, last = 0, rows = 0) { return { changes, last_row_id: last, rows_read: rows, rows_written: changes, duration: 0, served_by: 'node-sqlite', changed_db: changes > 0 }; }
  async first(col) {
    const row = this.stmt().get(...this.args);
    if (!row) return null;
    return col ? (row[col] ?? null) : { ...row };
  }
  async all() { return this.allSync(); }
  allSync() {
    const st = this.stmt();
    if (!st.columns().length) { const r = st.run(...this.args); return { success: true, results: [], meta: this.meta(Number(r.changes), Number(r.lastInsertRowid)) }; }
    const results = st.all(...this.args).map((r) => ({ ...r }));
    const ch = this.db.db.prepare('SELECT changes() c, last_insert_rowid() l').get();
    return { success: true, results, meta: this.meta(/\b(insert|update|delete|replace)\b/i.test(this.sql) ? Number(ch.c) : 0, Number(ch.l), results.length) };
  }
  async run() {
    const st = this.stmt();
    if (st.columns().length) return this.allSync(); // RETURNING
    const r = st.run(...this.args);
    return { success: true, results: [], meta: this.meta(Number(r.changes), Number(r.lastInsertRowid)) };
  }
  async raw(opts) {
    const st = this.stmt();
    const cols = st.columns().map((c) => c.name);
    const rows = st.all(...this.args).map((r) => cols.map((c) => r[c]));
    return opts?.columnNames ? [cols, ...rows] : rows;
  }
}

export class NodeD1 {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.stmts = new Map();
  }
  cache(sql) {
    let s = this.stmts.get(sql);
    if (!s) { s = this.db.prepare(sql); if (this.stmts.size > 2000) this.stmts.clear(); this.stmts.set(sql, s); }
    return s;
  }
  prepare(sql) { return new Statement(this, sql); }
  /** Like D1: the statements run in one transaction; any error rolls all of them back. */
  async batch(list) {
    this.db.exec('BEGIN');
    try {
      const out = list.map((s) => s.allSync());
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  async exec(sql) { this.db.exec(sql); return { count: 1, duration: 0 }; }
  dump() { throw new Error('dump is not supported on node-sqlite'); }
  withSession() { return this; }
}
