#!/usr/bin/env node
// Migrations only add, so an update can be rolled back by running the previous code on the same database (crm/README.md, "Update").
// From 0022 on a statement that drops or renames something fails this check unless its line says why: `-- contract: <reason>`.
// Such a change goes in two releases: first the code stops using the thing, a later release drops it.
// Also: numbers in order, no gaps, no two files with one number.
//   node scripts/migrations-check.mjs   (CI)
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const FROM = 22; // 0015 rebuilt a table before this rule existed
const DESTRUCTIVE = /\b(DROP\s+(TABLE|COLUMN|INDEX|VIEW|TRIGGER)|RENAME\s+(TO|COLUMN)|DELETE\s+FROM)\b/i;
const errors = [];
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
files.forEach((f, i) => {
  const n = Number(f.slice(0, 4));
  if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(f)) errors.push(`${f}: name it NNNN_words.sql`);
  if (n !== i + 1) errors.push(`${f}: expected number ${String(i + 1).padStart(4, '0')}`);
  if (n < FROM) return;
  readFileSync(join(dir, f), 'utf8').split('\n').forEach((line, j) => {
    const code = line.replace(/--.*$/, '');
    if (DESTRUCTIVE.test(code) && !/--\s*contract:\s*\S/.test(line)) errors.push(`${f}:${j + 1}: drops, renames or deletes; add "-- contract: <why>" if this is the second step of a two-release change`);
  });
});
if (errors.length) { console.log(errors.join('\n')); process.exit(1); }
console.log(`migrations: ${files.length} files, additive from ${String(FROM).padStart(4, '0')}`);
