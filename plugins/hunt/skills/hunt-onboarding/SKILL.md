---
name: hunt-onboarding
description: First-time Hunt setup and starting a new search — connect to a Hunt CRM (shared instance via invite link, or deploy your own on Cloudflare free tier), fill the hunter profile (how to introduce you, phone, email, languages, phone policy, tone, autonomy, quiet hours), connect channels (separate "hunting number" for Telegram/WhatsApp recommended, or a Hunt folder in the personal account), run the search brief with region-specific questions, create the Telegram group for friends, schedule regular runs and update the plugin, the countries or your own server (step 7). Use on "set up hunt", "/hunt new", "start a new search", "connect telegram/whatsapp", "update hunt" / "обнови Hunt", when hunt tools report missing config or 426 plugin_outdated.
---

# Onboarding

Ask with buttons where the client has them (AskUserQuestion in Claude Code), otherwise as a short numbered list, a few questions at a time. Questions and privacy levels: `docs/questionnaire.yaml` (also bundled as `questionnaire.yaml` next to this skill if present).

## 1. CRM

- **Shared instance**: the hunter got an invite link `t.me/<bot>?start=…` → opens it → the bot sends an agent token → `hunt_config_set(api_url, token)`.
- **Own instance** (from GitHub): follow `crm/README.md`: create a bot with @BotFather, `npm i`, `wrangler d1 create hunt`, put the id in `wrangler.toml`, `wrangler secret put` (TG_BOT_TOKEN, TG_WEBHOOK_SECRET, SETUP_KEY, LINK_SECRET), `npm run migrate`, `npm run deploy`, then `POST /setup {key}` → admin invite link → open it in Telegram → token. Only free Cloudflare features are used (Workers, D1, KV): listing photos, rating voice notes and receipts live in KV; deal documents stay in Telegram (the CRM keeps only the file id).
- Check with `hunt_status`.

## 2. Profile (once)

intro name, languages, phone and phone policy, email, who is moving, legend (what to say / not say), pets, smoking, tone, autonomy (ask vs routine_auto), timezone, quiet hours. Save with the CRM profile endpoint. Never ask for passport data.

## 3. Channels

Recommend, in this order (details in `docs/channels-research.md`):

1. **A separate hunting number** (local SIM or eSIM in the destination, dual-SIM phone): second Telegram account in the app, WhatsApp second account or WhatsApp Business. The agent uses only that account. Turn on Telegram cloud password and WhatsApp two-step PIN (tourist numbers get recycled).
2. **No second number**: the personal Telegram with a "Hunt" folder (the agent adds every landlord chat there automatically), WhatsApp with a "Hunt" list made by the user.
3. **Facebook**: the personal account only (second accounts break Meta rules); work in the Marketplace inbox.
4. **Instagram**: a second account is fine.
5. **Email**: `name+hunt@…` alias and a Gmail filter into a "Hunt" label.

Never use virtual/VoIP numbers. Telegram login: `tg_setup_api` (api_id/api_hash from my.telegram.org, the user gets them) → `tg_login_qr` → the user scans → if 2FA, the user types the password themselves. WhatsApp, Messenger and Instagram: before the first `wa_login` / `fb_login` / `ig_login` tell the hunter plainly that these platforms forbid automation and may ban the account, offer a separate number or sending by hand, and continue only after a clear yes. WhatsApp: `wa_login` saves a QR image (`~/.config/hunt/browser/qr-<account>.png`), the user scans it in WhatsApp → Linked devices, then `wa_login_status`. Messenger / Instagram: `fb_login` / `ig_login` opens a window of the dedicated profile where the user logs in themselves (or imports cookies). All three then run headless in the background (`hunt-browser`, see `channels/headless.md`).

**Other messengers**: a bridge the hunter runs (`channels/BRIDGE.md`): `bridge_add(name, url, token)` → `bridge_login` → `bridge_status`.

**Region packs**: `packs_update` installs the country data; run it at the first setup and when a pack is missing.

## 4. Brief (each search)

`region_list` → country → city → districts (multi). Then the common brief questions + the pack's `brief_questions`. Write a 6–10 line summary back for confirmation. `search_create` with region, brief, approval mode → share `group_link` (adds the bot to a new group for the search) and `invite_link` (for friends).

## 5. Notifications

Tell the members once: the bot DMs them about replies, viewings and deal dates, and sends a morning digest at 08:00 local time (with a surf line when the brief is about surf; switch in the Mini App). Each member can switch both off in the Mini App (Members and settings → Notifications). Documents (lease, receipts, move-in video) are sent to the bot in a private chat; it attaches them to the deal.

## 5b. Your places (wave 4)

Ask once whether the group keeps places in Google Maps (saved lists or My Maps): a shared list link (Share → Copy link) is enough. `places_import(search_id, url=…)` brings them in (only the places; never the author), then decide the types of `unresolved` ones and run `location_refresh(search_id)` so every listing gets its location score. Members can paste more links in the Mini App (Map → Places → "Add from Google Maps"). Mention the local calendar in the Plan tab (holidays like Nyepi with "stock up" reminders) and the 3D act, bikes and things screens for when they move in.

## 5c. Next search from an old one (wave 5)

When the members chose "new" in the "what next" vote (`next_new`), don't start from zero: `search_clone(search_id, move_in=<lease end>)` copies the region, brief, members and own places. Confirm the brief in 3–5 lines (what changed since last time: dates, budget, areas to avoid from the house dossier and notes), `search_update` the brief, then share the new links. Guests are not copied.

## 6. Rhythm

Offer to schedule a run every 30 minutes during the day (Claude Code: a scheduled task or `/loop`; Codex: an automation in the Codex app, or cron/launchd running `codex exec` with the tick request) that does the tick from skill `hunt`. Explain: the computer must be on; approvals and votes work from the phone at any time.

## 7. Updating Hunt

On `/hunt:update`, "обнови Hunt", a tool error `426 plugin_outdated`, `hunt_status` → `updates.next`, or when the bot told an admin that a new version is out. The plugin and the server share one version; what changed is in `CHANGELOG.md` of the repository. Each step that changes something needs the hunter's yes; say the versions before and after.

1. **What is behind.** `hunt_status` → `updates`: `plugin` (installed / latest on GitHub), `server` (`version`, `min_plugin`), `packs` (installed / latest commit), checked at most once a day. `packs_update(check=True)` checks the countries again without downloading. Show one short list.
2. **Plugin.** Claude Code: `claude plugin marketplace update hunt`, then `claude plugin update hunt@hunt`. Codex: `codex plugin marketplace upgrade hunt`. The new tools load after `/reload-plugins` or in a new session: say so and call nothing new before that. Offer once to turn on auto-update (Claude Code: `/plugin` → Marketplaces → hunt → auto-update), then this step is never needed. A marketplace added from a local folder is a development checkout: `git pull` there instead.
3. **Countries.** `packs_update()`; report `countries`, `version` and `previous_version`, and if present `your_changes_kept` and `changed_in_both` (the hunter's copies are kept aside). Something looks wrong after it: `packs_update(rollback=True)` puts the previous copy back (call it again to return).
4. **Own server**, only when the hunter runs it (an admin of their own server). A shared server is its owner's job: say the version and stop. Ask once how it runs:
   - Docker with `docker-compose.yml` (the published image): in that folder `docker compose pull && docker compose up -d`, then `docker compose logs --tail 30 hunt` (expect "database copied before migrations" and the migration names). Way back: `HUNT_VERSION=<previous> docker compose up -d`.
   - Docker built from a checkout (`docker run … hunt`): offer to move to `crm/docker-compose.yml` (it uses the same `hunt-db` volume, the data stays). Or rebuild: `git pull --ff-only` in hunt and hunt-data, `node scripts/copy-art.mjs --no-demo`, `docker build -t hunt .`, `docker rm -f hunt`, the same `docker run` as before.
   - Cloudflare: in `<hunt>/crm` run `npm run update` (`npm run update -- --config <file>` with their own wrangler config). It stops on uncommitted changes, saves a D1 Time Travel bookmark, applies the migrations, deploys and prints the way back: show those lines to the hunter.
   - Node without Docker: `npm run update:node` in `<hunt>/crm`, then restart the process; it copies the database to `backups/` before new migrations.
   Then `hunt_status` again: `updates.server.version` is the new one.

Never update while messages are being sent. Never discard, reset or merge the hunter's own changes in a checkout; a failed step stops the update, and you show the way back from the script's output.
