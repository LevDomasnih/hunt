import { Env, json, errorResponse, HttpError, body, safeEqual } from './util';
import { handleAgent } from './agent';
import { handleWebhook, setupInvite, adminExists, BOT_COMMANDS, BOT_UPDATES } from './bot';
import { handleApp, signLink, LINK_MAX_DAYS } from './app';
import { tg } from './tg';
import { runCron } from './notify';
import { handleGuidePage } from './guide';
import { rateLimit } from './media';
import { withStage } from './stage';
import { handlePartyPage } from './party';
import { handleImgProxy, handleEventPage } from './imgproxy';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (path === '/' || path === '/health') return json({ ok: true, service: 'hunt-crm' });
      if (path === '/tg/webhook' && req.method === 'POST') return await handleWebhook(req, env);
      // Wave 6: writes that can move the project stage recompute it afterwards (withStage).
      if (path.startsWith('/app')) return await withStage(req, env, path, () => handleApp(req, env, path));
      if (path.startsWith('/g/')) {
        await rateLimit(env, 'guide', req.headers.get('cf-connecting-ip') ?? 'local', 300); // public page: per IP and hour
        return await handleGuidePage(req, env, path);
      }
      // Wave 9: the public party invite (RSVP without Telegram), the public read-only event page, the event image proxy.
      if (path.startsWith('/p/')) return await handlePartyPage(req, env, path); // rate limits inside (page views, RSVP per IP and per party)
      if (path.startsWith('/e/')) {
        await rateLimit(env, 'evpage', req.headers.get('cf-connecting-ip') ?? 'local', 300);
        return await handleEventPage(req, env, path);
      }
      if (path.startsWith('/img/')) {
        await rateLimit(env, 'img', req.headers.get('cf-connecting-ip') ?? 'local', 1200);
        return await handleImgProxy(req, env, path);
      }
      if (path.startsWith('/api/')) return await withStage(req, env, path, () => handleAgent(req, env, path));

      // One-time setup: registers the webhook and returns an admin invite link.
      if (path === '/setup' && req.method === 'POST') {
        await rateLimit(env, 'setup', req.headers.get('cf-connecting-ip') ?? 'local', 10);
        const b = await body(req);
        if (!env.SETUP_KEY || !safeEqual(String(b.key ?? ''), env.SETUP_KEY.trim())) throw new HttpError(403, 'bad_setup_key');
        // One-time: once an admin exists (the first invite was used), /setup no longer mints admin invites.
        if (await adminExists(env)) throw new HttpError(409, 'already_set_up', 'This instance already has an admin; use /invite in the bot');
        await tg(env, 'setWebhook', {
          url: `${env.PUBLIC_URL}/tg/webhook`,
          secret_token: env.TG_WEBHOOK_SECRET.trim(),
          allowed_updates: BOT_UPDATES,
        });
        await tg(env, 'setMyCommands', { commands: BOT_COMMANDS });
        await tg(env, 'setChatMenuButton', { menu_button: { type: 'web_app', text: 'Hunt', web_app: { url: `${env.PUBLIC_URL}/app` } } });
        return json({ ok: true, admin_invite: await setupInvite(env) });
      }

      // Private web link for people outside Telegram (requires an agent token).
      // Default: a link for the caller themself. For a member/guest of one of the caller's searches: only with search_id,
      // bound to that search and the person's current role (the link opens nothing else and dies when the role changes).
      if (path === '/link' && req.method === 'POST') {
        const auth = req.headers.get('authorization');
        if (!auth) throw new HttpError(401, 'no_token');
        const { authAgent } = await import('./agent');
        const ctx = await authAgent(req, env);
        await rateLimit(env, 'link', ctx.user.id, 60);
        const b = await body(req);
        const userId = String(b.user_id ?? ctx.user.id);
        const days = Math.min(LINK_MAX_DAYS, Math.max(1, Math.floor(Number(b.days) || LINK_MAX_DAYS)));
        let scope: { sid: string; role: string } | null = null;
        if (userId !== ctx.user.id) {
          if (!b.search_id) throw new HttpError(400, 'search_id_required', 'A link for someone else needs search_id (one of your searches)');
          const r = await env.DB.prepare(
            `SELECT s.owner_id, (SELECT role FROM members WHERE search_id=s.id AND user_id=?2) mrole,
                    (SELECT 1 FROM guests WHERE search_id=s.id AND user_id=?2 AND status='active') grole
             FROM searches s WHERE s.id=?1`,
          ).bind(String(b.search_id), userId).first<{ owner_id: string; mrole: string | null; grole: number | null }>();
          if (!r || r.owner_id !== ctx.user.id) throw new HttpError(403, 'not_your_search');
          const role = r.mrole ?? (r.grole ? 'guest' : null);
          if (!role) throw new HttpError(403, 'not_your_member');
          scope = { sid: String(b.search_id), role };
        }
        const u = await env.DB.prepare('SELECT link_gen FROM users WHERE id=?').bind(userId).first<{ link_gen: number }>();
        if (!u) throw new HttpError(404, 'no_user');
        const tok = await signLink(env, userId, days, Number(u.link_gen), scope);
        return json({ url: `${env.PUBLIC_URL}/app?k=${encodeURIComponent(tok)}`, days, scope });
      }
      return json({ error: 'not_found' }, 404);
    } catch (e) {
      return errorResponse(e);
    }
  },

  // Cron Trigger (wrangler.toml): postponed DMs, viewing and payment reminders.
  async scheduled(_c: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCron(env));
  },
};
