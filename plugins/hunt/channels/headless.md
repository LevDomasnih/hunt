# Headless channels (MCP `hunt-browser`)

WhatsApp Web, Facebook Messenger and Instagram DMs run in **Hunt's own Chromium profiles in the background**: no window, no focus stealing, the hunter's Chrome and personal sessions are untouched. This is the default for these three channels. The old method (driving the hunter's Chrome with the browser extension, see `whatsapp.md` and `messenger.md`) stays as a fallback.

Server: `mcp/hunt_browser.py` (`uv run --script`, deps `mcp` + `playwright==1.60.0`).

## How it works

- One persistent Chromium per channel + account, profile in `~/.config/hunt/browser/<channel>-<account>/` (mode 700). `account` is a label, default `main`; use e.g. `hunt` for a hunting number.
- Headless by default, normal desktop user agent, English UI (`browser.locale` in config) so text checks stay stable. The page stays open between calls; after a crash or a closed browser the next call relaunches it. If the site logged out, tools say `login needed: ...` with the exact next step.
- Chromium comes from the Playwright cache (`~/Library/Caches/ms-playwright/chromium-1223`). The server never downloads browsers. If none is found, tools return the install command (`uvx --from playwright==1.60.0 playwright install chromium`) or you set `HUNT_CHROMIUM` / `browser.executable` to an existing Chrome.
- One profile can be used by one process at a time. Two Claude Code sessions with Hunt → the second gets "profile in use".
- `browser_screenshot(channel, account)` shows what the headless page sees (debugging; files may contain private chats, delete them). `browser_sessions()` lists what runs; `browser_close` frees memory.

## Tools (same shape for every channel)

| WhatsApp | Messenger | Instagram | What |
|---|---|---|---|
| `wa_login` / `wa_login_status` | `fb_login` / `fb_login_status` | `ig_login` / `ig_login_status` | connect (see below) |
| `wa_status` | `fb_status` | `ig_status` | logged in? who? pacing counters |
| `wa_inbox` | `fb_inbox` | `ig_inbox` | unread chats (+ missed calls on WA, message requests on IG); `all_chats=true` for recent ones |
| `wa_history` | `fb_history` | `ig_history` | whole thread oldest first: `dir` in/out/system, time, text with captions, media descriptors |
| `wa_media` | `fb_media` | `ig_media` | save full-size photos to files |
| `wa_send` | `fb_send` | `ig_send` | one message, verified (statuses below) |
| `wa_resolve` | `fb_resolve` | `ig_resolve` | number on WhatsApp? / thread by name / @username → thread |

Peers: WhatsApp = phone number in any format (opened with `/send?phone=<digits>`) or an exact chat name; Messenger = thread id or `facebook.com/messages/t/<id>` (`/e2ee/t/` too) or `m.me/<name>`, always opened on `www.facebook.com`; Instagram = thread id / `instagram.com/direct/t/<id>` or `@username` (for a new person the profile's Message button opens an empty thread; nothing is sent by that).

## Connecting (what the human does)

**WhatsApp** (QR, everything stays headless):
1. Agent calls `wa_login(account)`. It returns `qr_png` (`~/.config/hunt/browser/qr-<account>.png`) and `qr_page` (an HTML page that reloads the image every 3 s).
2. Show the QR: Read the PNG so it appears in the chat, or ask the hunter to open `qr_page`. WhatsApp rotates and expires the code; the server keeps the file fresh for about 6 minutes and presses "reload QR" when it expires.
3. Hunter: WhatsApp on the **hunting** phone → Settings → Linked devices → Link a device → scan. ("Log in with phone number" codes are not supported yet.)
4. Agent polls `wa_login_status(account, wait_s=60)`: `waiting_for_scan` → `syncing` → `linked` (with the own number).

**Messenger / Instagram** (no QR exists; never type the hunter's password):
1. Agent calls `fb_login(account)` / `ig_login(account)`. A **visible** Chromium window of Hunt's profile opens. Tell the hunter: it's Hunt's own window, log in there yourself; for Messenger also type the end-to-end encryption PIN if asked.
2. The window closes by itself once the session cookie exists (`c_user` / `sessionid`) and no PIN or security check is on screen. If the hunter closes it, that's fine too.
3. Agent polls `fb_login_status` / `ig_login_status(wait_s=60)` until `logged_in`. From then on everything is headless.
4. Alternative without a window: the hunter exports cookies from a logged-in browser (Cookie-Editor extension → Export JSON) and the agent calls `fb_login(cookies_file=...)`. Only cookies of the channel's domains are imported, values are never shown. Delete the export afterwards; it is a login token.

While a login window is open, other tools for that channel+account refuse to run.

## Sending rules (built in)

- The chat is opened **by id**, never "whatever is open". WhatsApp: the header must show the number's digits, or `expect_display` (the display name stored in the CRM; needed for saved contacts and business accounts, which show a name). Messenger: the URL must stay on the thread id; with `expect_display` the header must show it. Instagram: participants are checked through Instagram's own thread data (`@username` or `expect_display`).
- Duplicate guard: if our last message in the chat already has the same text, the send is skipped (`already_sent`, pass `allow_repeat=true` to override).
- After Enter the server looks for the new outgoing message (WhatsApp survives the page reload that sometimes follows a send). Statuses:
  - `sent`, `sent_pending` (WhatsApp clock icon: queued, **do not resend**)
  - `unknown, check before resending` → read `*_history` and look at the last outgoing message; never resend blindly. The server never retries a send by itself.
  - `not_sent` (nothing was submitted; safe to retry), `wrong_chat`, `no_chat`, `already_sent`, `failed_visible` (Messenger shows "not sent")
  - `paced` with `retry_after`
- Language: decide from messages with `dir: "in"` only. Interface labels and system rows (`dir: "system"`) are in the UI language and will fool you.
- Opening a chat (history, media, send) marks it as read for the other side, like opening it on the phone.

## Pacing

Per channel + account, shared by all Hunt processes (`~/.config/hunt/browser/pacing.json`):

| | min between sends | min between new chats | new chats per day |
|---|---|---|---|
| WhatsApp | 20 s | 150 s | 15 |
| Messenger | 30 s | 240 s | 10 |
| Instagram | 30 s | 300 s | 8 |

"New chat" = the conversation has no messages yet. Quiet hours block all sends: `browser.quiet_hours` in `~/.config/hunt/config.json` (`"21:00-08:00"` or `{"start", "end", "tz"}`), else the Telegram `quiet_hours`, else 21:00–08:00 in `browser.timezone` / the machine's zone. Override limits with `browser.pacing.<channel>`. Waits up to 30 s are slept out; longer ones return `paced`. If a limit/restriction dialog shows up after a send ("approaching the limit", "try again later", "temporarily blocked") the account is paused for 24 h and the result carries `limit_warning`: tell the hunter and stop that channel.

## Session lifetime

- **WhatsApp**: a linked device is logged out after ~30 days without use, and the phone must stay registered. Any `wa_*` call refreshes it; for long breaks run `wa_status` weekly. Unlinking on the phone (Linked devices) ends it immediately; then `wa_login` again. Up to 4 linked devices per account.
- **Messenger**: the session lasts until Facebook expires it or asks for a check; then `fb_status` says `login`/`checkpoint`/`pin` → `fb_login`. A new device can trigger "was this you?" mail. E2EE history restore needs the PIN once per profile.
- **Instagram**: similar; "suspicious login" challenges are passed by the hunter in the `ig_login` window.
- Deleting `~/.config/hunt/browser/<channel>-<account>/` logs that profile out locally (also unlink/log out on the phone).

## Risks and limits

- WhatsApp Web, facebook.com and instagram.com in automation are against those services' terms; behaviour (volume, copy-paste blasts) drives bans, not the browser. Use a hunting number for WhatsApp and a second Instagram account; Messenger can only be the hunter's personal account (second Facebook accounts break Meta's rules, additional profiles are deleted after 2026-12-14). Keep the pace low.
- The profiles hold live sessions: anyone with the folder can read the chats. Keep `~/.config/hunt` private and out of backups/sync you don't control.
- DOM changes break selectors. WhatsApp parts are modeled on battle-tested snippets and offline tests; the QR flow was checked live (logged out). Messenger and Instagram adapters have **not been run against logged-in accounts yet**: on the first real use, check with `browser_screenshot` and `*_history` before trusting `*_inbox` unread flags. Messenger's direction (`dir`) is inferred from bubble position. Instagram reads use the same JSON endpoints instagram.com itself calls, sends go through the page.
- Media: WhatsApp photos are taken from the viewer (`_thumb` suffix = only the thumbnail was available); videos are counted, not saved. Messenger photos via the viewer, best effort. Instagram gives full-size images directly.
- Not supported: voice notes, documents download, calls, WhatsApp phone-number linking codes, Messenger "Message seller" from a Marketplace listing (open the thread in the listing first, then use its id).
