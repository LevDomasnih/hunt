// Updates (src/updates.ts) without a Worker: version order, X-Hunt-Version, the plugin gate, /health, and the daily check:
// once a day, the admins hear about a newer version once, nothing when main is not ahead, nothing with UPDATE_CHECK=0.
//   node --experimental-strip-types scripts/test-updates-pure.mts
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { VERSION, MIN_PLUGIN } from '../src/version.ts';

const crm = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'hunt-updates-'));
const out = join(tmp, 'updates.mjs');
buildSync({ entryPoints: [join(crm, 'src', 'updates.ts')], bundle: true, format: 'esm', platform: 'neutral', outfile: out, logLevel: 'silent' });
const U = await import(pathToFileURL(out).href);
rmSync(tmp, { recursive: true, force: true });

let pass = 0, fail = 0;
const ok = (c: unknown, name: string, extra: unknown = '') => { if (c) pass++; else { fail++; console.log('FAIL', name, typeof extra === 'string' ? extra : JSON.stringify(extra)); } };
const bump = (v: string) => v.split('.').map((x, i) => (i === 1 ? Number(x) + 1 : i === 2 ? 0 : Number(x))).join('.');

// ---- versions
ok(U.cmpVersion('0.10.0', '0.9.9') > 0 && U.cmpVersion('1.0.0', '1.0.0') === 0 && U.cmpVersion('0.2.1', '0.3.0') < 0, 'x.y.z order is numeric');
const req = (v?: string) => new Request('https://x/api/me', { headers: v == null ? {} : { 'x-hunt-version': v } });
ok(U.pluginVersion(req('0.2.0')) === '0.2.0' && U.pluginVersion(req()) === null && U.pluginVersion(req('0.2')) === null && U.pluginVersion(req('<b>')) === null, 'X-Hunt-Version: only x.y.z');
let threw: any = null;
try { U.requirePlugin('0.0.0'); } catch (e) { threw = e; }
ok(MIN_PLUGIN === '0.0.0' ? !threw : threw?.status === 426 && threw?.code === 'plugin_outdated', 'an older plugin is refused with 426');
let fine = true;
try { U.requirePlugin(null); U.requirePlugin(MIN_PLUGIN); U.requirePlugin(bump(MIN_PLUGIN)); } catch { fine = false; }
ok(fine, 'no version, the minimum and newer pass');
ok(JSON.stringify(Object.keys(U.health())) === JSON.stringify(['ok', 'service', 'version', 'api', 'min_plugin']) && U.health().version === VERSION, '/health fields');
ok(U.updateCommand('docker').startsWith('docker compose pull') && U.updateCommand('cloudflare').includes('npm run update') && U.updateCommand('node').includes('update:node'), 'one update command per install');
ok(U.runtimeOf({ HUNT_RUNTIME: 'docker' }) === 'docker' && U.runtimeOf({}) === 'cloudflare' && U.runtimeOf({ HUNT_RUNTIME: 'x' }) === 'cloudflare', 'runtime from HUNT_RUNTIME');

// ---- the daily check: a fake D1 (server_state + admins) and fake GitHub / Telegram
function fakeEnv(extra: Record<string, string> = {}) {
  const state = new Map<string, string>();
  const DB = {
    prepare(sql: string) {
      let args: any[] = [];
      const st = {
        bind(...a: any[]) { args = a; return st; },
        async first() { return sql.includes('server_state') && state.has('update') ? { value: state.get('update') } : null; },
        async run() { if (sql.startsWith('INSERT INTO server_state')) state.set('update', args[0]); return {}; },
        async all() { return { results: sql.includes('is_admin=1') ? [{ tg_user_id: 1, lang: 'ru' }, { tg_user_id: 2, lang: 'en' }] : [] }; },
      };
      return st;
    },
  };
  return { env: { DB, TG_BOT_TOKEN: '123:test', ...extra } as any, state };
}
let latest = bump(VERSION), sent: any[] = [], fetched: string[] = [];
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input instanceof Request ? input.url : input);
  fetched.push(url);
  if (url.startsWith('https://raw.githubusercontent.com/')) return new Response(JSON.stringify({ name: 'hunt', version: latest }), { status: 200 });
  if (url.includes('api.telegram.org')) { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: true, result: {} })); }
  return new Response('no', { status: 404 });
}) as any;

const a = fakeEnv();
await U.updatesCron(a.env);
ok(sent.length === 2 && sent.every((m) => m.parse_mode === 'HTML' && m.text.includes(latest) && m.text.includes('npm run update')), 'a newer version: every admin hears it, with the command', sent.map((m) => m.text));
ok(sent[0].text.includes('Вышла') && sent[1].text.includes('is out') && sent[0].text.includes(`releases/tag/v${latest}`), 'in their language, with the release link');
ok(fetched[0] === 'https://raw.githubusercontent.com/LevDomasnih/hunt/main/plugins/hunt/.claude-plugin/plugin.json', 'reads the manifest of main', fetched[0]);
sent = []; fetched = [];
await U.updatesCron(a.env);
ok(!fetched.length && !sent.length, 'not again within a day');
a.state.set('update', JSON.stringify({ ...JSON.parse(a.state.get('update')!), checked_at: new Date(Date.now() - 25 * 3600e3).toISOString() }));
await U.updatesCron(a.env);
ok(fetched.length === 1 && !sent.length, 'the next day: checked, the same version is not told twice');
latest = bump(latest);
a.state.set('update', JSON.stringify({ ...JSON.parse(a.state.get('update')!), checked_at: null }));
sent = [];
await U.updatesCron(a.env);
ok(sent.length === 2 && JSON.parse(a.state.get('update')!).notified === latest, 'a later version is told again');

const b = fakeEnv(); latest = VERSION; sent = [];
await U.updatesCron(b.env);
ok(!sent.length && JSON.parse(b.state.get('update')!).latest === VERSION, 'main not ahead: silence, the check is remembered');
const c = fakeEnv({ UPDATE_CHECK: '0' }); latest = bump(VERSION); sent = []; fetched = [];
await U.updatesCron(c.env);
ok(!fetched.length && !sent.length && !c.state.size, 'UPDATE_CHECK=0: no request at all');
const d = fakeEnv({ UPDATE_REPO: 'someone/fork', HUNT_RUNTIME: 'docker' }); fetched = []; sent = [];
await U.updatesCron(d.env);
ok(fetched[0].includes('/someone/fork/main/') && sent[0].text.includes('docker compose pull') && sent[0].text.includes('github.com/someone/fork/releases'), 'a fork: its own repository and the Docker command');
const e = fakeEnv({ UPDATE_REPO: '../../evil' }); fetched = [];
await U.updatesCron(e.env);
ok(fetched[0].includes('/LevDomasnih/hunt/main/'), 'a bad UPDATE_REPO falls back to the default');

console.log(`updates: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
