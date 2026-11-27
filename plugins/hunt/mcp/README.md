# Hunt MCP servers

Four local MCP servers ship with the Hunt plugin (`hunt-bridge` is the fourth: see `../channels/BRIDGE.md`). They are Python scripts with
[PEP 723](https://peps.python.org/pep-0723/) inline dependencies, started by `uv run --script`
(see `../.mcp.json`). The only thing you need installed is [uv](https://docs.astral.sh/uv/); uv
fetches Python and the dependencies into its cache on first start.

| Server | File | What it does |
|---|---|---|
| `hunt` | `hunt_core.py` + `huntcore/` | Hunt CRM API (Cloudflare Worker), region packs, time/date/route helpers, event photo quality gate (Pillow). `hunt_core.py` is the entry (uv script header, `mcp.run()`); the code lives in `huntcore/<area>.py` (base, searches, listings, messages, deals, money, house, home, places, packs, registry, routes, location, flood, items, living, stage, useful, events, parties, orders, event_photos, event_sources, portals). A module reads another's names as `_area.name`; tests patch a name where it is defined: `monkeypatch.setattr(hc.owner_of("name"), "name", …)` |
| `hunt-telegram` | `hunt_telegram.py` | Telegram user account over Telethon: login by QR, inbox, history, media, guarded sending, folders |
| `hunt-browser` | `hunt_browser.py` | WhatsApp Web (QR), Messenger and Instagram DMs in dedicated headless Chromium profiles: inbox, history, media, verified sending, pacing. See `../channels/headless.md`. Tests: `uv run --with pytest --with playwright==1.60.0 --with mcp --with keyring pytest mcp/tests/test_browser_local.py` |
| `hunt-bridge` | `hunt_bridge.py` | any other channel through a small local HTTP service (Signal, a local portal): see `../channels/BRIDGE.md` |

All work with `mcp` 1.x (`FastMCP`) and 2.x (`MCPServer`).

## Setup

1. **CRM.** Deploy `crm/` and open the bot. After `/start` the bot sends the CRM
   URL and an agent token. In Claude Code: "connect Hunt", and the agent calls
   `hunt_config_set(api_url, token)`. Check with `hunt_status`.
2. **Telegram** (optional, recommended on a separate "hunting" number):
   - create an app at <https://my.telegram.org> → API development tools; the agent stores it with
     `tg_setup_api(api_id, api_hash, account="hunt")`;
   - `tg_login_qr(account="hunt")` returns a QR (ASCII and PNG). On the phone: Telegram → Settings →
     Devices → Link Desktop Device → scan. `tg_login_status` waits for it;
   - if the account has a two-step password, `tg_login_status` returns a `password_url` on
     `127.0.0.1`. Open it in a browser on the same computer and type the password there.
     The agent never sees it.
   - personal account instead of a hunting number: `tg_settings(account="personal", read_scope="folder",
     folder_auto=true, max_new_chats_per_day=10, new_chat_interval_s=240)`.

## Files and configuration

| What | Where |
|---|---|
| Config | `~/.config/hunt/config.json` (mode 600): `api_url`, `digest_cursors`, `telegram` settings |
| CRM agent token | OS keychain via `keyring`: service `hunt`, username = `api_url` |
| Telegram API id/hash | OS keychain: service `hunt-telegram`, username = account label (fallback `default`) |
| Telegram sessions | `~/.config/hunt/telegram/<label>.session` (mode 600, directory 700) |
| Telegram pacing state | `~/.config/hunt/telegram/state.json` (last send, new chats in 24 h, cooldowns) |
| Region packs | `$HUNT_REGIONS`, else the data repository installed by `packs_update`, else a `hunt-data` checkout next to the hunt repository, else `<plugin root>/regions` (only `_generic` ships there) |

Environment overrides: `HUNT_CONFIG_DIR` (config folder), `HUNT_API_URL` + `HUNT_TOKEN` (headless
machines without a keychain; the token is then read from the environment), `HUNT_REGIONS`,
`CLAUDE_PLUGIN_ROOT`.

Telegram settings (`tg_settings`, global or per account):

| Key | Default | Meaning |
|---|---|---|
| `min_send_interval_s` | 20 | between any two sends; `tg_send` waits up to 90 s by itself |
| `new_chat_interval_s` | 120 | between two first messages to new people |
| `max_new_chats_per_day` | 20 | rolling 24 h |
| `quiet_hours` | off | `{"start": "21:00", "end": "08:00", "tz": "Asia/Makassar"}`: no sends inside |
| `folder_auto` | false | add every new chat opened by `tg_send` to the folder |
| `folder_title` | `Hunt` | folder name (max 12 chars) |
| `read_scope` | `non_contacts` | `folder` = `tg_inbox` only reads chats inside the folder |
| `duplicate_window_h` | 6 | same text to the same chat within this window is not sent again |
| `media_max_mb` | 50 | `tg_media` skips bigger files |

## Tools

### hunt (core)

- Setup: `hunt_config_set(api_url, token)`, `hunt_status()`
- Searches: `search_create`, `search_list`, `search_get`, `search_update`,
  `search_digest(search_id, since?, advance=true)`: remembers the last cursor per search, so a
  repeated call returns only what humans did since the previous check
- Listings: `listing_upsert(search_id, listing_id, ...fields)`, `listing_list(search_id, status?, decision?, district?, q?)`,
  `listing_get`, `listing_update` (+ `short_name`: the chosen home's short name for the Mini App titles), `listing_photos(listing_id, paths | urls)` (max 10, replaces the
  album; local files need the search group connected), `listing_publish`
- Contacts: `contact_resolve(channel+address | q, search_id?)` (+ `notes_elsewhere`: notes about this person from other searches), `contact_get`, `contact_note_add(contact_id, text, sentiment)` (shared across the instance), `contact_upsert(contact_id|"new", ...)`,
  `contact_link(contact_id, listing_id, role)`, `contact_messages(contact_id)`
- Messages: `messages_log([...])` (dedupe by channel + external_id, batches of 100)
- Drafts: `draft_create(...)`, `drafts_ready(search_id)` (approved or edited; send `final_text`),
  `draft_mark(draft_id, sent|failed)`
- Viewings: `viewing_set(search_id, listing_id, viewing_id|"new", starts_at, status, meet_note, outcome)`
  (omitted fields keep their values), `viewings_day(search_id, date)`, `day_plan_post(search_id, date)`
- Ratings: `ratings_get(search_id, download_voice=true, download_photos=false)`: interest before viewing and ratings after it per
  listing (score, criteria, weak spots, notes), on-site checklist results (labels from the pack) and the scam check, best first;
  voice notes land in `<config>/voice/`, on-site photos in `<config>/onsite/`
- Deal: `deal_set(listing_id, data)`: refuses passport/ID/card/bank numbers and passwords locally;
  `deal_dates_set(listing_id, dates)` (payment / notice / moveout / deposit_return: the bot reminds members)
- Scam check: `listing_checks_set(listing_id, verdict, signals, advice?)`
- Documents (files stay in Telegram): `doc_list`, `doc_get(doc_id, out_dir?)` (downloads to `<config>/docs/`),
  `doc_set`, `doc_request`, `doc_summary_set(doc_id, sections, changes?)`, `doc_upload(listing_id, path, …)` (sent via the hunter's bot DM)
- Money: `expense_add`, `expenses_get` (balances, transfers, totals), `shares_set(search_id, {user_id: weight})`
- House: `living_get`, `issue_set`, `house_contact_set`
- Notify: `notify(search_id, text, to=owner|chat)`
- Wave 3: `rooms_set` (rent by rooms), `money_mode_set(split|shared)`, `power_get` (downloads members' meter photos to `<config>/meter/`) +
  `power_reading_set`, `moveout_get` / `moveout_set`, `relet_set`, `relet_lead_set`, `directory_get`, `dir_entry_set`, `dir_group_add`,
  `travel_times_set`, `travel_times_refresh(search_id)` (public Valhalla API, ≤ 1 req/s, disk cache `<config>/valhalla_cache.json`,
  × city `travel.rush_factor`), `region_districts(path, lat?, lng?)` (areas from `districts.yaml`, point-in-polygon on `districts.geojson`)
- Wave 5: `surf_forecast(search_id, refresh=false)` (today's spots near the home, stars, best window, wind),
  `guide_get` / `guide_set(search_id, address?, map_url?, wifi_name?, wifi_password?, rules?, note?)` (house guide for
  guests; rules ≤ 12 strings or `{icon?, text}`, refuses ID/card numbers), `next_get` / `next_note_set(search_id, note,
  lease_to?)` (the "what next" vote before the lease ends), `search_clone(search_id, title?, move_in?, term?)`,
  `negotiation_get(listing_id)` (owner only: market, history, offer ≤ `budget_said`, arguments; never contains
  `budget_cap`), `deal_prices_set(listing_id, asked?, agreed?)`, `recap_get`, `guests_get`.
  `location_refresh` now computes free-flow isochrones at the pack's ring set (`location.rings`, default 10/20/40 min),
  sends `rings` to the CRM, recomputes listings the CRM marks `stale`, and keys its disk cache
  (`<config>/isochrone_cache.json`) by the ring set; `rush_factor` is only a note in the result
- Wave 6: `stage_get(search_id, today?)` (the project stage derived by the CRM: path rows with facts, terms, history;
  `today` previews another day), `stage_set(search_id, stage, note?, listing_id?)` (a manual stage until the data catches
  up, `closed` = read-only archive, guests lose access; `auto` clears / reopens), `deal_terms_get(search_id)` and
  `deal_term_set(search_id, seq="new"|2…, date_from, date_to?, kind?, rent?, currency?, deposit?, deposit_prev?,
  deposit_prev_amount?, landlord?, landlord_contact_id?, status?, dates?, checklist?, note?)` (extension terms of the same
  home; seq 1 stays in the deal); `doc_set` / `doc_upload` take `term_seq`.
- Wave 7 (Афиша): `events_upsert(events)` (≤ 50, vocabularies, local-offset times, https links and ID/card numbers
  checked locally), `events_get(country, city?, search_id?, from_date?, to_date?, status?, q?)`, `event_set(event_id,
  fields)`, `event_bookings_get(search_id?, status?)`, `event_book_draft(booking_id, text?, lang?, channel?, address?,
  contact_id?, reason?)` (approval draft to the organizer), `event_booking_set(booking_id, asked|booked|declined|cancelled|
  attended, note?)`, `event_photo_check(path_or_url, organizer_own?, kind?)`: a local photo quality gate (Pillow, no upload): short side
  (photos ≥ 900, organizer posters ≥ 700 with text < 45%), variance-of-Laplacian sharpness, exposure, a text-area heuristic
  for flyers, a 16:9 / 3:2 saliency crop and a score; `event_photo_fetch(url, out_dir)` (og:image of an event/venue page,
  public https hosts only, redirects re-checked), `event_photo_pick(paths, organizer_own?)` (real photos before posters),
  `event_photo_upload(event_id, path, credit, source_url, organizer_own?, kind?, dry_run?)` (gate, resize ≤ 1600 px JPEG ~82,
  `POST /api/events/:id/photo`; only Telegram-only photos or refused hotlinks: public https images are linked as `photo_url`)
- Wave 9: `party_get(search_id, party_id?)`, `party_set(search_id, fields, party_id?)` (create / change; local-offset
  `starts_at`, capacity 1..300, vibe / status vocabularies, ID/card numbers refused locally), `party_guests_get(party_id)`,
  `party_notice_draft(party_id, owner|neighbours, channel, address, contact_id?, lang?, text?, reason?)` (approval draft to
  the house owner or neighbours, never sent by itself), `event_feedback_get(search_id, from_date?, to_date?)` ("Как было?"
  ratings + venue/organizer averages), `event_source_read(url, max_events?, tz?)`: one organizer/venue/ticket page read-only
  (JSON-LD `Event` incl. `@graph` and subtypes → iCalendar → og: tags → same-site event links), robots.txt honoured
  (UA `HuntBot/1.0 (+read-only)`), noindex pages skipped, ≤ 1 request/s per host, 6 h cache in
  `~/.config/hunt/event_source_cache.json`, public https only; each event carries a `suggested` dict for `events_upsert`
  and naive times are flagged (`naive_time`), never given an invented offset
- Portals: `listing_source_read(url, max_listings?)`: one rental-portal page (search list or single listing) read-only →
  normalized listings (price + currency + period kept as given, rooms, m², place, map pin, photo URLs, posted/updated,
  owner or agent when the page says it) with a `suggested` dict for `listing_upsert` and what is `missing`. Site
  adapters for 4zida.rs, rumah123.com, 99.co, travelio.com, cityexpert.rs, rentor.ge, balihousing.com / baliarenda.com,
  renthub.in.th; otherwise JSON-LD → embedded app JSON → og: tags → same-site links. Same politeness as
  `event_source_read` (robots.txt with wildcards, noindex, ≤ 1 request/s per host, 6 h cache in the same file); sites in
  `BLOCKED_SITES` and pages answering 401/403/429/bot challenge come back as `skipped: "blocked"` (open by hand)
- Regions: `region_list()`, `region_get(path)` (country → city merge, city wins; `district_list`;
  `bali/bukit/<district>` adds `district`), `region_doc(path, name)` (`rules.md`, `market.md`,
  `contract.md`, `scam.md`, `checklist.yaml`, `sources.yaml`, `visa.md`, `emergency.yaml`, `districts.yaml`, `calendar.yaml`, `places.yaml`, `useful.yaml`, `events.yaml`, `templates/<lang>/<file>.md`; city first, then country)
- Time: `time_info(tz | region, date?)`, `dates_between(start, end)`, `route_link(points, travelmode)`

### hunt-telegram

- `tg_setup_api(api_id, api_hash, account)`, `tg_login_qr(account)`, `tg_login_status(account, wait_s)`,
  `tg_status(account)`, `tg_settings(...)`
- `tg_inbox(account, since, include_contacts=false, limit_dialogs=100)`: private chats with incoming
  messages since a time; read-only, nothing is marked as read
- `tg_history(account, peer, limit=200, before_id?)`: full thread with captions, media, locations
- `tg_post_media(link, out_dir, account?)`: read only, the photos of ONE post and its album (t.me link), with the post's author and repost origin (event photos)
- `tg_media(account, peer, out_dir, since?, kinds, max=0, direction="in")`: downloads everything, skips files it already has
- `tg_send(account, peer, text, reply_to?)`: pacing guard, quiet hours, cooldowns, duplicate guard, auto-folder
- `tg_folder_ensure(account, title)`, `tg_folder_add(account, peer, title)`, `tg_folder_remove(account, peer, title)`
- `tg_resolve(account, query)`: @username, t.me link, +phone or id → summary with scam/fake flags

Every message carries `external_id = tg:<my id>:<peer id>:<message id>`. Pass it to `messages_log`
so the CRM log stays free of duplicates.

## Security notes

- The CRM token and the Telegram API id/hash live only in the OS keychain. They are never written
  to files and never returned by a tool.
- Every CRM call carries `X-Hunt-Client: claude-code | codex` (`--client codex` in the Codex manifest,
  else `HUNT_CLIENT`, else `claude-code`), so the Mini App can say which agent is connected. Nothing else
  about the computer is sent.
- Telegram session files are created with mode 600 before Telethon opens them. A session file is
  as powerful as a logged-in phone: do not copy, sync or commit it. Revoke it in Telegram →
  Settings → Devices ("Hunt (Claude Code)").
- No passwords are stored. The 2FA password is typed by the user into a one-time page on
  `127.0.0.1` that expires after 10 minutes and goes straight to Telegram.
- Hunt never reads or writes Telegram service chats (login codes) and skips saved contacts
  unless asked (`include_contacts=true`).
- One Telethon client per account lives in the server process. A lock file keeps a second Hunt
  process (another Claude Code session) away from the same session file, which avoids SQLite
  "database is locked".
- On `FLOOD_WAIT`, `PEER_FLOOD` or a frozen account, `tg_send` returns `STOP: ...`, records a
  cooldown and refuses further sends until it ends. Do not work around it.
- `deal_set` refuses passport/ID numbers, card numbers (Luhn), IBAN/account numbers and passwords
  before anything leaves the machine. Contracts stay on the user's machine; the CRM only gets a
  summary.

## Tests

Offline, no network, no keychain, no real config:

```sh
cd plugins/hunt/mcp
uv run --no-project --with pytest --with httpx --with pyyaml --with mcp --with keyring \
  --with telethon --with qrcode --with pypng --with pillow pytest -q tests
```

Without `--with telethon` the Telegram tests are skipped, without `--with pillow` the wave 7 tests. Add `--with 'mcp<2'` to test against mcp 1.x.
