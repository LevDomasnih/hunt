# Hunt server (Cloudflare Worker + Telegram bot)

Runs on the Cloudflare free tier: Workers, D1 and KV. Documents stay in Telegram, photos in KV.

## Use a shared instance

If someone runs Hunt for you, they send an invite link `t.me/<bot>?start=…`. Open it, press Start, and the bot sends you an agent token. In Claude Code run `/hunt:new` and paste the API URL and the token when asked.

## Deploy your own

You need a Cloudflare account (free) and Node 20+.

1. **Bot.** In Telegram open @BotFather → `/newbot` → get the token. Then `/setdomain` is not needed; but do `/newapp` (or Bot Settings → Configure Mini App → Main App) and set the URL to `https://<your-worker>.workers.dev/app` after step 4.
2. **Install and log in.**
   ```bash
   cd crm && npm install && npx wrangler login
   ```
3. **Database.**
   ```bash
   npx wrangler d1 create hunt
   ```
   Put the printed `database_id` into `wrangler.toml`. Set `BOT_USERNAME` (without @) and `PUBLIC_URL` (your workers.dev URL, you'll see it after the first deploy; deploy once, then fix and deploy again).
4. **Secrets.**
   ```bash
   npx wrangler secret put TG_BOT_TOKEN
   npx wrangler secret put TG_WEBHOOK_SECRET   # any long random string
   npx wrangler secret put SETUP_KEY           # any long random string, used once
   npx wrangler secret put LINK_SECRET         # any long random string
   npx wrangler secret put CHAT_KEK            # optional: openssl rand -base64 32, encrypts conversations at rest
   ```
5. **Migrate and deploy.** The countries live in the data repository [hunt-data](https://github.com/LevDomasnih/hunt-data); `predeploy` copies them into the app (in a full checkout with the packs inside `plugins/hunt/regions` you can leave `HUNT_REGIONS` out).
   ```bash
   git clone https://github.com/LevDomasnih/hunt-data ../../hunt-data
   export HUNT_REGIONS=$PWD/../../hunt-data/regions
   npm run migrate && npm run deploy
   ```
6. **Set up the bot and get your admin invite.**
   ```bash
   curl -X POST https://<your-worker>.workers.dev/setup -H 'content-type: application/json' -d '{"key":"<SETUP_KEY>"}'
   ```
   It registers the webhook, the commands and the menu button, and returns `admin_invite`. Open that link in Telegram → the bot sends your agent token.

## Inviting people

- `/invite` in the bot (admins): a one-time link that makes someone a **hunter** (they get their own agent token and run their own searches with your bot).
- Each search has its own links (returned by `POST /api/searches`): `group_link` adds the bot to a new Telegram group for the search; `invite_link` lets a friend join the search to vote in the Mini App.
- Members vote with the buttons under the cards. Writing in the group or pressing a vote button does **not** make anyone a member: people join through `invite_link` (the bot tells a non-member voter to ask for it). The owner can remove a member in the Mini App (`/app/api/member-remove`); the member invite is then rotated.
- `/revoke` in the bot revokes all your agent tokens and every web link (then `/token` for a new agent token). Web links from `POST /link` last at most 30 days; a link for a friend needs `search_id` and opens only that search.

By default the instance is private: only people with an invite can use it (`OPEN_SIGNUP` stays unset).

## Data

`/privacy` and `/delete` in the bot. Contacts, notes and dossiers belong to the hunter who made them; `npm run test:households` checks that.
