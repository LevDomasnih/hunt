// The throwaway local server the integration tests run against: `wrangler dev` (Cloudflare's runtime, the default) or the
// Node build (dist/server.mjs, HUNT_TEST_SERVER=node). Either way the tests read and seed the database straight from its
// SQLite file: a second wrangler on the same files while `wrangler dev` runs made the worker stop answering on CI machines.
//   const srv = localServer({ name: 'web', port: 8798, inspector: 9798 }); srv.exec(sql); await srv.start(); … srv.stop()
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const crm = join(dirname(fileURLToPath(import.meta.url)), '..');
export const backend = process.env.HUNT_TEST_SERVER === 'node' ? 'node' : 'wrangler';
const sleep = (ms) => new Promise((f) => setTimeout(f, ms));

export function localServer({ name, port, inspector, vars = {} }) {
  const dir = mkdtempSync(join(tmpdir(), `hunt-${name}-`));
  const BASE = `http://127.0.0.1:${port}`;
  const env = { TG_BOT_TOKEN: '000:fake', TG_WEBHOOK_SECRET: 'hook', SETUP_KEY: 's', LINK_SECRET: 'l', PUBLIC_URL: BASE, BOT_USERNAME: 'test_bot', ...vars };
  let proc = null, log = '';
  let dbFile, kvFile;

  if (backend === 'node') {
    if (!process.env.HUNT_TEST_NO_BUILD) execFileSync(process.execPath, [join(crm, 'scripts/build-node.mjs')], { cwd: crm, stdio: 'ignore' });
    dbFile = kvFile = join(dir, 'hunt.db');
    const db = new DatabaseSync(dbFile);
    return import('../node/migrate.mjs').then(({ migrate }) => { migrate(db, join(crm, 'migrations')); db.close(); return api(); });
  }
  // wrangler: the real config with the names replaced and absolute paths, so FILL_ME values never matter
  const cfg = join(dir, 'wrangler.toml');
  writeFileSync(cfg, readFileSync(join(crm, 'wrangler.toml'), 'utf8').replace(/database_name = "[^"]*"/, 'database_name = "t"').replace(/database_id = "[^"]*"/, 'database_id = "local"').replace(/^id = "[^"]*"/m, 'id = "local"')
    .replace('main = "src/index.ts"', `main = "${crm}/src/index.ts"`).replace('migrations_dir = "migrations"', `migrations_dir = "${crm}/migrations"`).replace('directory = "./public"', `directory = "${crm}/public"`));
  const CFG = ['--config', cfg, '--persist-to', join(dir, 'db')];
  writeFileSync(join(dir, 'vars'), Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  execFileSync('npx', ['--no-install', 'wrangler', 'd1', 'migrations', 'apply', 't', '--local', ...CFG], { cwd: crm, stdio: ['ignore', 'pipe', 'pipe'] });
  const sqliteIn = (kind) => { const d = join(dir, 'db', 'v3', kind); const f = existsSync(d) && readdirSync(d).find((x) => /^[0-9a-f]{64}\.sqlite$/.test(x)); return f ? join(d, f) : null; };
  dbFile = sqliteIn('d1/miniflare-D1DatabaseObject');
  return Promise.resolve(api());

  function open(file) { const db = new DatabaseSync(file); db.exec('PRAGMA busy_timeout = 5000'); return db; }
  function withDb(file, fn) { if (!file) throw new Error('no database file yet'); const db = open(file); try { return fn(db); } finally { db.close(); } }
  function api() {
    return {
      BASE, dir, backend,
      exec: (q) => withDb(dbFile, (db) => db.exec(q)),
      rows: (q) => withDb(dbFile, (db) => db.prepare(q).all().map((r) => ({ ...r }))),
      /** Every key in the photo store (KV). */
      kvKeys: () => {
        if (backend === 'node') return withDb(kvFile, (db) => db.prepare("SELECT 1 FROM sqlite_master WHERE name='_cf_kv'").get() ? db.prepare('SELECT key FROM _cf_kv').all().map((r) => r.key) : []);
        const f = sqliteIn('kv/miniflare-KVNamespaceObject');
        return f ? withDb(f, (db) => db.prepare('SELECT key FROM _mf_entries').all().map((r) => r.key)) : [];
      },
      log: () => log,
      async start() {
        proc = backend === 'node'
          ? spawn(process.execPath, [join(crm, 'dist/server.mjs')], { cwd: crm, env: { ...process.env, ...env, PORT: String(port), HUNT_DB: dbFile, HUNT_CRON: '0' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
          : spawn('npx', ['--no-install', 'wrangler', 'dev', ...CFG, '--port', String(port), '--ip', '127.0.0.1', ...(inspector ? ['--inspector-port', String(inspector)] : []), '--env-file', join(dir, 'vars'), '--show-interactive-dev-session=false'],
            { cwd: crm, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
        proc.stdout.on('data', (d) => (log += d)); proc.stderr.on('data', (d) => (log += d));
        for (let i = 0; ; i++) {
          if (await fetch(`${BASE}/health`).then((r) => r.ok, () => false)) break;
          if (i > 200) throw new Error(`${backend} server did not start\n${log.slice(-1500)}`);
          await sleep(300);
        }
        if (backend === 'wrangler' && !kvFile) kvFile = sqliteIn('kv/miniflare-KVNamespaceObject');
      },
      stop() { try { if (proc) process.kill(-proc.pid); } catch { /* gone */ } },
      async cleanup() { this.stop(); await sleep(backend === 'node' ? 200 : 800); rmSync(dir, { recursive: true, force: true }); },
    };
  }
}
