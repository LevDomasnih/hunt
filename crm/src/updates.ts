// Updates: which version this server and the agents talking to it run, and once a day whether a newer Hunt is out.
// The plugin sends X-Hunt-Version; a plugin older than MIN_PLUGIN gets a clear "update the plugin" instead of failing calls.
// The daily check reads the plugin manifest of the main branch (UPDATE_REPO, default the public repository): no user data
// leaves the server. When main is ahead, the admins hear it once per version in the bot, with the update step for this kind
// of install. UPDATE_CHECK=0 turns the check off.
import { Env, HttpError, now, esc, parseJson } from './util';
import { tg } from './tg';
import { VERSION, API, MIN_PLUGIN } from './version';

const SEMVER = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
export const DEFAULT_REPO = 'LevDomasnih/hunt';
const CHECK_MS = 24 * 3600e3;
const repoOf = (env: Env) => (/^[\w.-]+\/[\w.-]+$/.test(env.UPDATE_REPO ?? '') ? env.UPDATE_REPO! : DEFAULT_REPO);

/** Negative when a < b, 0 when equal, positive when a > b (x.y.z). */
export function cmpVersion(a: string, b: string): number {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  return (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]);
}

/** The plugin's version from X-Hunt-Version, null when missing or not x.y.z (older plugins send none). */
export function pluginVersion(req: Request): string | null {
  const v = (req.headers.get('x-hunt-version') ?? '').trim();
  return SEMVER.test(v) ? v : null;
}

/** An agent call from a plugin this server can no longer serve. A plugin that sends no version is let through. */
export function requirePlugin(version: string | null) {
  if (version && cmpVersion(version, MIN_PLUGIN) < 0) {
    throw new HttpError(426, 'plugin_outdated',
      `This Hunt server needs the plugin ${MIN_PLUGIN} or newer (yours is ${version}). Update: /hunt:update, or claude plugin marketplace update hunt && claude plugin update hunt@hunt (Codex: codex plugin marketplace upgrade hunt), then start a new session.`);
  }
}

/** GET /health: public and cheap, no database. The agent compares its own version with these. */
export const health = () => ({ ok: true, service: 'hunt-crm', version: VERSION, api: API, min_plugin: MIN_PLUGIN });

type Runtime = 'cloudflare' | 'docker' | 'node';
export const runtimeOf = (env: Env): Runtime => (env.HUNT_RUNTIME === 'docker' || env.HUNT_RUNTIME === 'node' ? env.HUNT_RUNTIME : 'cloudflare');

/** The one command that updates this kind of install (crm/README.md, "Update"). */
export function updateCommand(rt: Runtime): string {
  if (rt === 'docker') return 'docker compose pull && docker compose up -d';
  if (rt === 'node') return 'cd hunt/crm && npm run update:node';
  return 'cd hunt/crm && npm run update';
}

interface UpdateState { latest?: string; checked_at?: string; notified?: string }

async function readState(env: Env): Promise<UpdateState> {
  const r = await env.DB.prepare("SELECT value FROM server_state WHERE key='update'").first<{ value: string }>();
  return parseJson<UpdateState>(r?.value, {});
}
async function writeState(env: Env, s: UpdateState) {
  await env.DB.prepare("INSERT INTO server_state (key, value, updated_at) VALUES ('update', ?1, ?2) ON CONFLICT(key) DO UPDATE SET value=?1, updated_at=?2")
    .bind(JSON.stringify(s), now()).run();
}

/** The version on the main branch of the repository, null when it cannot be read. */
export async function latestVersion(env: Env): Promise<string | null> {
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${repoOf(env)}/main/plugins/hunt/.claude-plugin/plugin.json`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const v = String(((await r.json()) as any)?.version ?? '');
    return SEMVER.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function updateText(lang: string | null | undefined, latest: string, rt: Runtime, repo: string): string {
  const R = lang !== 'en', cmd = esc(updateCommand(rt)), link = `https://github.com/${repo}/releases/tag/v${latest}`;
  return R
    ? `<b>Вышла Hunt ${esc(latest)}</b>, у тебя ${esc(VERSION)}.\n<a href="${link}">Что нового</a>\n\nОбновить: скажи своему Ханту «обнови Hunt» или выполни сам:\n<code>${cmd}</code>\nПеред новыми миграциями база сохраняется, откат описан в crm/README.md.`
    : `<b>Hunt ${esc(latest)} is out</b>, you run ${esc(VERSION)}.\n<a href="${link}">What's new</a>\n\nUpdate: tell your Hunt "update Hunt" or run it yourself:\n<code>${cmd}</code>\nThe database is saved before new migrations; the way back is in crm/README.md.`;
}

/** Cron: at most once a day read the latest version; tell the admins once per newer version. */
export async function updatesCron(env: Env): Promise<void> {
  if (env.UPDATE_CHECK === '0') return;
  const s = await readState(env);
  if (s.checked_at && Date.parse(s.checked_at) > Date.now() - CHECK_MS) return;
  const latest = await latestVersion(env);
  const next: UpdateState = { ...s, checked_at: now(), ...(latest ? { latest } : {}) };
  if (latest && cmpVersion(latest, VERSION) > 0 && s.notified !== latest) {
    const repo = repoOf(env);
    const admins = (await env.DB.prepare('SELECT u.tg_user_id, u.lang FROM hunters h JOIN users u ON u.id=h.user_id WHERE h.is_admin=1 AND u.tg_user_id IS NOT NULL').all<any>()).results ?? [];
    for (const a of admins) {
      await tg(env, 'sendMessage', { chat_id: a.tg_user_id, text: updateText(a.lang, latest, runtimeOf(env), repo), parse_mode: 'HTML', link_preview_options: { is_disabled: true } }).catch(() => null);
    }
    next.notified = latest;
  }
  await writeState(env, next);
}
