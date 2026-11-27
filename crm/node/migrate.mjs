// Applies crm/migrations to a SQLite database in the table wrangler uses (d1_migrations), so a database exported from D1 keeps
// its history. Shared by node/server.mjs and the tests that run against it.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** @param {import('node:sqlite').DatabaseSync} sql @returns {string[]} the files applied now */
export function migrate(sql, dir) {
  sql.exec('CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  const done = new Set(sql.prepare('SELECT name FROM d1_migrations').all().map((r) => r.name));
  const applied = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
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
