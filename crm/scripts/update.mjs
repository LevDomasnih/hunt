#!/usr/bin/env node
// Update your own Hunt server in one step from the checkouts you deployed from (crm/README.md, "Update"):
// pull hunt and hunt-data (fast-forward only), install, then
//   Cloudflare (default): save a D1 Time Travel bookmark, apply migrations, deploy; print the way back.
//   --node: build the Node server (migrations and a copy of the database happen when it starts); restart it yourself.
// Docker needs none of this: docker compose pull && docker compose up -d.
//   npm run update [-- --config wrangler.mine.toml] [--db hunt] [--dry-run]
//   npm run update:node [-- --dry-run]
// Stops on uncommitted changes in hunt (your own edits are never merged or thrown away here).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const crm = join(dirname(fileURLToPath(import.meta.url)), '..');
const hunt = join(crm, '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const NODE = flag('--node'), DRY = flag('--dry-run');
const config = opt('--config'), db = opt('--db', 'hunt');
const wcfg = config ? ['-c', config] : [];
const data = process.env.HUNT_REGIONS ? resolve(process.env.HUNT_REGIONS, '..') : join(hunt, '..', 'hunt-data');

const say = (s) => console.log(`\n▸ ${s}`);
function run(cmd, argv, opts = {}) {
  console.log(`  $ ${[cmd, ...argv].join(' ')}`);
  if (DRY) return '';
  const r = spawnSync(cmd, argv, { cwd: opts.cwd ?? crm, stdio: opts.capture ? ['inherit', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status !== 0) throw Object.assign(new Error(`${cmd} ${argv.join(' ')} failed`), { step: opts.step });
  return r.stdout ?? '';
}
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const version = () => readFileSync(join(crm, 'src', 'version.ts'), 'utf8').match(/export const VERSION = '([^']+)'/)?.[1] ?? '?';

const before = version();
say(`Hunt ${before}: updating ${NODE ? 'the Node server' : 'the Cloudflare Worker'}${DRY ? ' (dry run: nothing changes)' : ''}`);

if (git(hunt, 'status', '--porcelain', '--untracked-files=no')) {
  console.log(`\nThere are uncommitted changes in ${hunt}. Commit or put them aside first; the update never merges into your edits.`);
  if (!DRY) process.exit(1);
}
say('Code and countries');
run('git', ['pull', '--ff-only'], { cwd: hunt });
if (existsSync(join(data, '.git'))) run('git', ['pull', '--ff-only'], { cwd: data });
else console.log(`  (no hunt-data checkout at ${data}: the countries stay as they are; HUNT_REGIONS=<path>/regions points elsewhere)`);
const after = DRY ? before : version();
console.log(`  Hunt ${before} → ${after}`);

say('Install');
run('npm', ['ci', '--no-audit', '--no-fund']);

if (NODE) {
  say('Build');
  run('node', ['scripts/copy-art.mjs', '--no-demo']);
  run('npm', ['run', 'build:web']);
  run('npm', ['run', 'build:node']);
  console.log(`
Done: Hunt ${after} is built. Restart the server (for example: systemctl restart hunt).
On start it copies the database to backups/ next to it before new migrations, then applies them.
Way back: git checkout v${before} && npm ci && node scripts/copy-art.mjs --no-demo && npm run build:web && npm run build:node, then restart.
The migrations only add, so the older code runs on the newer database. Put a backups/ copy in place only if a migration broke data.`);
  process.exit(0);
}

// Cloudflare: bookmark → migrate → deploy. The bookmark restores the whole database to the moment before the migrations.
say('Database bookmark (D1 Time Travel)');
let bookmark = null;
if (!DRY) {
  const out = run('npx', ['wrangler', 'd1', 'time-travel', 'info', db, '--json', ...wcfg], { capture: true });
  try { bookmark = JSON.parse(out).bookmark ?? null; } catch { bookmark = out.match(/bookmark\W+([0-9a-f-]{16,})/i)?.[1] ?? null; }
  if (!bookmark) { console.log('Could not read a bookmark; stopping before the migrations.'); process.exit(1); }
  console.log(`  bookmark ${bookmark}`);
} else run('npx', ['wrangler', 'd1', 'time-travel', 'info', db, '--json', ...wcfg]);
const restore = `npx wrangler d1 time-travel restore ${db} --bookmark=${bookmark ?? '<bookmark>'}${config ? ` -c ${config}` : ''}`;

try {
  say('Migrations');
  run('npx', ['wrangler', 'd1', 'migrations', 'apply', db, '--remote', ...wcfg], { step: 'migrate' });
  say('Deploy');
  run('npm', ['run', 'deploy', '--', ...wcfg], { step: 'deploy' });
} catch (e) {
  console.log(`\n${e.message}.`);
  if (e.step === 'migrate') console.log(`The Worker was not deployed and still runs ${before}. If the database looks wrong, restore it:\n  ${restore}`);
  else console.log(`The migrations are applied; ${before} keeps running on them (they only add). Retry: npm run deploy${config ? ` -- -c ${config}` : ''}`);
  process.exit(1);
}

const url = (readFileSync(config ? resolve(crm, config) : join(crm, 'wrangler.toml'), 'utf8').match(/^PUBLIC_URL\s*=\s*"([^"]+)"/m) ?? [])[1];
if (url && !DRY && !url.includes('FILL_ME')) {
  const h = await fetch(`${url}/health`).then((r) => r.json()).catch(() => null);
  console.log(`\n${url}/health: ${h ? `version ${h.version}` : 'no answer yet'}`);
}
console.log(`
Done: Hunt ${after} is live.
Way back:
  the code      npx wrangler rollback${config ? ` -c ${config}` : ''}   (the previous Worker; it runs fine on the new tables)
  the database  ${restore}   (only if a migration broke data)`);
