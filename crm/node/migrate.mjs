// Applies crm/migrations to a SQLite database in the table wrangler uses (d1_migrations), so a database exported from D1 keeps
// its history. Shared by node/server.mjs and the tests that run against it.
// Before the first new migration of a database that already has data, a copy is written next to it (opts.backupDir, the newest
// opts.keep copies stay): an update that goes wrong is rolled back by stopping the server and putting that file in place.
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** @param {import('node:sqlite').DatabaseSync} sql @param {{ backupDir?: string, keep?: number }} [opts] @returns {string[]} the files applied now */
export function migrate(sql, dir, opts = {}) {
  sql.exec('CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  const done = new Set(sql.prepare('SELECT name FROM d1_migrations').all().map((r) => r.name));
  const files = readdirSync(dir).filter((x) => x.endsWith('.sql')).sort();
  // Migrations only add (crm/README.md, "Update"), so code older than its database still runs: say so and go on.
  const unknown = [...done].filter((n) => !files.includes(n));
  if (unknown.length) console.warn(`warning: the database has migrations this code does not know (${unknown.join(', ')}): it is newer than the code`);
  const pending = files.filter((f) => !done.has(f));
  if (pending.length && done.size && opts.backupDir) backup(sql, opts.backupDir, pending[0], opts.keep ?? 3);
  const applied = [];
  for (const f of pending) {
    sql.exec('BEGIN');
    try {
      sql.exec(readFileSync(join(dir, f), 'utf8'));
      sql.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f);
      sql.exec('COMMIT');
      applied.push(f);
    } catch (e) {
      sql.exec('ROLLBACK');
      throw new Error(`migration ${f} failed: ${e.message}`);
    }
  }
  return applied;
}

/** A consistent copy of the whole database (VACUUM INTO), named after the first migration it precedes. */
function backup(sql, dir, before, keep) {
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = join(dir, `hunt-${stamp}-before-${before.replace(/\.sql$/, '')}.db`);
  sql.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  console.log('database copied before migrations:', file);
  const old = readdirSync(dir).filter((f) => /^hunt-.*-before-.*\.db$/.test(f)).sort().reverse().slice(keep);
  for (const f of old) rmSync(join(dir, f), { force: true });
}
