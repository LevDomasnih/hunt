# Hunt CRM API

The CRM backend is a Cloudflare Worker with D1 (database), Workers KV (listing photos, rating voice notes, on-site photos, receipt photos, event photos) and a Telegram bot (free tier only, no card). Deal documents are not stored: only their Telegram file_id. It has three faces:

1. **Agent API** (`/api/*`): the Hunt MCP server calls it with `Authorization: Bearer <agent token>`.
2. **Telegram bot** (`/tg/webhook`): cards in the search group, vote buttons, draft approvals, notifications.
3. **Mini App** (`/app`, data under `/app/api/*`): opened inside Telegram, authenticated by Telegram `initData` (HMAC with the bot token), plus a private web link with a signed token for people outside Telegram.

Every authenticated agent call, reads included, counts as the agent being around: `agent_seen_at` of the caller's own searches moves forward at most once per 10 minutes (the Mini App shows "agent offline" only in the settings sheet, after 24 h).

All bodies are JSON. Errors: `{ "error": "code", "message": "human text" }` with a 4xx/5xx status; a 500 never carries the raw error, only `{error: "internal", message, ref}` (the `ref` is in the Worker log). IDs are strings. Times are ISO-8601.

Every JSON write (agent API and Mini App) is checked before any route runs: a free-text field that looks like a passport / ID number (keyword + number, RU `серия … номер …`, `загран …`, a bare 16-digit NIK) or a card number (Luhn over digit groups, also with dots or a trailing expiry) is refused with 400 `sensitive`. Ids, links, addresses, phones and dates are not scanned. `POST /api/messages` (other people's words) masks such numbers instead of refusing.

## Roles

Per search: `owner`, `member` (legacy `viewer`) and, since wave 5, `guest`. Guests are not rows in `members` but in `guests`.

- **owner**: everything, including `budget_said` (never `budget_cap`, which nobody sees in the app), the negotiation helper, draft approvals, search settings (brief, money mode, approval mode).
- **member**: everything else: votes, ratings, money, documents, the deal, the house, the guide, guests (invites and approving guest drafts), the "what next" vote.
- **viewer** (legacy, read-only): listings, votes, viewings, the house basics; never money, documents, the deal, drafts, conversations, contact channels, invite links; can't write. Every route uses a whitelist of roles (`owner`/`member` for writes), never "not viewer".
- Joining needs an invite (`invite_link`, owner and members only): writing in the search group or pressing a vote button under a card does not make anyone a member (the bot answers non-members "join through the invite first"). The owner removes a member with `POST /app/api/member-remove` (the member invite is rotated).
- **guest**: dated access (`date_from`–`date_to`) invited by a member through a one-time link (`invites` kind `guest`, `data = {from, to, areas}`); areas `guide`, `places`, `contacts` (directory entries outside the home group; messages go out only as drafts kind `guest` that a member approves), `issues` (report and see their own issues). Never money, documents, the deal, threads, votes, drafts or listings. Enforced server-side: every other `/app/api/*` path answers 403 `guest` to a user who is only a guest. Access ends after `to`; the cron marks such guests `expired`; a member can change `to`/areas or revoke.

## Agent API

### Setup and profile
| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/me` | | `{user, profile}` |
| PUT | `/api/profile` | profile JSON (core/profile.schema.json) | `{ok}` |

### Searches
| Method | Path | Body / query | Returns |
|---|---|---|---|
| POST | `/api/searches` | `{title, region, brief, approval_mode}` | `{search, group_link, invite_link}`: `group_link` adds the bot to a Telegram group for the search; `invite_link` lets a friend join to vote in the Mini App |
| GET | `/api/searches` | | `[search + role]`: own searches in full; searches where the hunter is only a member: `{id, title, region, status, owner_id, role, created_at, updated_at, brief}` with the public brief (no `budget_cap*`, no `budget_said`) |
| GET | `/api/searches/:id` | | `{search, members, stats}` |
| PATCH | `/api/searches/:id` | partial | `{search}` |
| GET | `/api/searches/:id/digest?since=<cursor>` | | `{cursor, events}`: human events since the cursor (`vote`, `vote_undone`, `comment`, `chat`, `instruction`, `draft_decided`, `listing_added`, `viewing_changed`, `brief_changed` with `{changes:[{key,from,to}], summary}`, `checklist` with `{index, text, done}`, `rating` with `{name, title, score, note, voice?, criteria}`, `expense`, `expense_deleted`, `settled`, `shares_changed`, `issue`, `document` (`from_bot: true` = a member sent a file to the bot), `deal_date`, `date_due` (deposit not returned 3 days after the date; actor `system`); `instruction` carries `kind`: `running_late`, `ask_owner_docs`, `issue`, `doc_request`; `vote` carries the member's `decision` and the resulting `group` decision); pass the returned cursor next time |
| GET | `/api/searches/:id/ratings` | | `{region, voters, listings:[{listing_id, title, district, price, currency, decision, status, interest, rating, onsite, checks}]}` for listings with votes, ratings or on-site answers, best score first (see "Interest, decision, ratings"); `onsite` = `{items:{<item>: {ok, not_ok, notes:[{user_id, name, ok, note}]}}, photos:[KV keys]}` |
| PATCH | `/api/searches/:id` | `{shares: {user_id: weight}}` | split weights for shared money (also `title`, `region`, `brief`, `status` incl. `living`, `approval_mode`, `money_mode: split\|shared`, `rooms: {rooms:[{id?, name, user_id\|null, share}], others_equal}` or null; room shares are percents adding up to 100) |

### Listings
| Method | Path | Body / query | Returns |
|---|---|---|---|
| PUT | `/api/searches/:id/listings/:lid` | listing fields (upsert) | `{listing, created}` |
| GET | `/api/searches/:id/listings?status=&decision=&q=` | | `[listing]` |
| GET | `/api/listings/:lid` | | `{listing, contacts, messages_tail, viewings, votes, interest, ratings, deal}`: `deal` is the current deal JSON (members may have ticked checklist items) or null; `ratings` is the rating summary or null |
| GET | `/api/voice?key=v/<lid>/<user>-<ts>` | | the raw audio of a rating voice note (key from `ratings.notes[].voice`), for transcription |
| PATCH | `/api/listings/:lid` | partial | `{listing}`; `short_name` (wave 8.1, ≤ 40 chars, `""`/null clears): the chosen home's short name in the Mini App titles ("Дом в Унгасане"; fallback "Дом в <district>" / "Дом") |
| POST | `/api/listings/:lid/photos` | multipart files or `{urls:[]}` | `{photos}`: stored in KV (`{kv}`) or kept as URLs; mirrored to the search group if there is one |
| PUT | `/api/listings/:lid/checks` | `{verdict: ok\|caution\|danger, signals:[{status: ok\|warn\|todo, title, detail?}], advice?}` | `{listing}` with `checks` (+ `checked_at`); 400 `sensitive` on ID/card numbers; event `checks` |
| GET | `/api/media?key=` | | raw KV file: `v/<listing>/…` voice note, `o/<listing>/…` on-site photo, `r/<search>/…` receipt |
| POST | `/api/listings/:lid/publish` | `{}` | posts or refreshes the card in the search chat; 409 `no_search_chat` if the search has no group yet |

### Contacts
| Method | Path | Body / query | Returns |
|---|---|---|---|
| POST | `/api/contacts/resolve` | `{channel, address}` or `{q}`, optional `search_id` | `{contact, channels, listings, notes, notes_elsewhere, stats}` or `{contact:null}`. Both find only the caller's own contacts: two hunters may have the same number, each with their own contact. `listings` only from the caller's searches; `notes` = people notes from every search on this instance, notes from other hunters' searches come without `search_id`/`search_title` (`elsewhere: true`); `notes_elsewhere` = not from `search_id`; `stats` = `{searches, notes, reply_minutes, messages}` |
| GET | `/api/contacts/:cid?search_id=` | | the same card; 404 unless the contact is linked to one of the caller's searches (listing, thread, house contact, message, draft) |
| POST | `/api/contacts/:cid/notes` | `{text, sentiment: 1\|0\|-1, search_id?}` | `{note}`; 400 `sensitive`; event `person_note`; `search_id` (own) or an own contact required |
| PUT | `/api/contacts/:cid` | `{name, role, lang, notes, channels:[{channel,address,display}]}` | `{contact}`; only the caller's own contact (404 otherwise); a channel that belongs to another contact of the caller is never moved (409 `channel_taken` with that contact's id) |
| POST | `/api/contacts/:cid/link` | `{listing_id, role}` | `{ok}` |

### Messages log
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/messages` | `[{search_id, contact_id, listing_id, channel, direction, text, media, external_id, at}]` (≤ 200) | `{inserted, skipped}`: each message needs `search_id` and/or `listing_id` of the caller's own search (404 otherwise, 400 `search_required` without either; `contact_id` must exist); passport/card numbers in `text` and captions are masked; dedupe by `(channel, external_id)`. A new `in` message for a listing with decision `want_view` or `take` DMs the owner and members (contact + first 120 chars + "Open" to the conversation) |
| GET | `/api/contacts/:cid/messages?limit=` | | `[message]`: only messages logged in the caller's own searches, `limit` ≤ 1000 (404 for a contact of other searches only) |

### Drafts (approval queue)
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/drafts` | `{search_id, contact_id, listing_id, channel, address, text, kind, reason}` | `{draft}`; in `ask` mode the bot sends it to the owner with Send / Edit / Skip; in `routine_auto` mode routine kinds (`schedule`, `running_late`, `decline`, `cancel`, `found`) come back as `approved` |
| GET | `/api/drafts?search_id=&status=ready` | | `[draft]`: `ready` = approved or edited; send `edited_text` when present, else `text` |
| PATCH | `/api/drafts/:did` | `{status: "sent"|"failed"}` | `{draft}` |

### Threads (conversation summaries)
One row per (search, contact): what the Mini App shows in "Messages". Rewrite it after every incoming or outgoing message.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| PUT | `/api/threads` | `{search_id, contact_id, listing_id?, state, known, open, last, last_at}`; `state`: `waiting_us` \| `waiting_them` \| `closed`; `known` = facts agreed, `open` = open questions, `last` = one line about the last message (each 1–3 short lines, max 600 chars); omitted fields keep their values | `{thread, created}`; a change of `state` or `last` adds a `thread` event to the members' feed |
| GET | `/api/threads?search_id=` | | `[thread]` with `contact_name`, newest first |

### Viewings
| Method | Path | Body | Returns |
|---|---|---|---|
| PUT | `/api/viewings/:vid` (`new` to create) | `{search_id, listing_id, starts_at, status, meet_note, outcome}`; on update, omitted fields keep their values | `{viewing}` |
| GET | `/api/searches/:id/viewings?date=` | | `[viewing]` + route link |
| POST | `/api/searches/:id/day-plan` | `{date}` | posts the day plan to the search chat |

### Deals
| Method | Path | Body | Returns |
|---|---|---|---|
| PUT | `/api/deals/:lid` | deal JSON: `name`, `terms {type, from, to, rent, currency}`, `checklist[]`, `dates[]`, legacy `payments[]` | `{deal}`; 400 `sensitive` if it contains a passport/ID number near a keyword or a card number |
| PUT | `/api/deals/:lid/dates` | `{dates:[{date, kind: payment\|notice\|moveout\|deposit_return\|other, title, amount?, currency?, note?, done?}]}` | `{deal}`: replaces `data.dates` only. Deals without `dates` fall back to `payments[]` (refund = deposit return) |

### Shared money
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/searches/:id/expenses` | | `{currency, shares, expenses, settlements, balances:{<cur>: {net:{user_id: n}, transfers:[{from, to, amount}]}}, totals:{total, per_member, equal_share, power_per_month}}` |
| POST | `/api/searches/:id/expenses` | `{title, amount, paid_by, currency?, date?, kind?, method?, split?, note?, listing_id?}` | `{expense}`; `kind`: rent, deposit, power, water, internet, cleaning, pool, repair, food, transport, other; `split` `{user_id: weight}` overrides the search shares |

Split: each expense is divided by `split` (or the search `shares`, default: equal between owner and members); net = paid − owed, settlements move money between two members; `transfers` is the greedy list that settles everyone.

### Life in the house
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/searches/:id/living` | | `{status, issues, contacts, deal, dates}` |
| PUT | `/api/issues/:iid` (`new`) | `{search_id, title, status: open\|scheduled\|fixed, note?, scheduled_at?, fixed_at?}` | `{issue}`; omitted fields keep their values; event `issue` on status change |
| PUT | `/api/house-contacts/:hid` (`new`) | `{search_id, name, role, note?, cost?, currency?, period: month\|week\|visit\|once, payer: rent\|us, schedule?, channel?, address?, sort?}` | `{contact}` |
| DELETE | `/api/house-contacts/:hid` | | `{ok}` |

### Documents
Files stay in Telegram; the CRM keeps `tg_file_id` and the agent's summary.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/searches/:id/documents?listing_id=` | | `[document]` (`has_file` instead of the Telegram ids) |
| GET | `/api/documents/:did` | | `{document}` |
| GET | `/api/documents/:did/file` | | the file, streamed from Telegram (Bot API getFile, ≤ 20 MB) |
| PUT | `/api/documents/:did` (`new`) | `{listing_id, kind: lease\|receipt\|owner_consent\|movein_video\|other, title, status: have\|request\|due, due_date?, version?, doc_date?, signed_at?, pages?, note?, summary?: {sections:[{icon, title, text}], changes?, changes_from?}, term_seq?}` | `{document}`; 400 `sensitive` on ID/card numbers |
| POST | `/api/listings/:lid/documents` | multipart `file` + the fields above | `{document}`: the bot sends the file to the hunter's DM and keeps the file_id; 409 `no_tg_user` if the hunter never started the bot |

### Wave 3: move-out, re-let, power, directory, places near

| Method | Path | Body | Returns |
|---|---|---|---|
| GET / PUT | `/api/searches/:id/moveout` | `{date?, steps?: {notice\|keys\|video\|cleaning\|deposit: {status: done\|wait\|todo\|info, note?, date?, at?, channel?}}, pushback?: {who, to?, quote, points} \| null}` (omitted keys keep values) | `{moveout}` with facts merged in: date from the lease `moveout` date, video done when a `moveout_video` document exists, deposit from `deposit_return`; event `moveout` |
| GET / PUT | `/api/searches/:id/relet` | `{date_from, date_to, price, currency, consent: yes\|asked\|no\|unknown, consent_note, ad_text, photos, channels:[{kind, label?, count?, url?}], status: draft\|posted\|found\|closed}` | `{relet}` incl. `leads`; event `relet` on status/consent change |
| PUT | `/api/searches/:id/relet/leads/:lid` (`new`) | `{name, status: new\|reply\|viewing\|agreed\|not_suitable, note?, channel?, address?, contact_id?}` | `{lead}`; event `relet_lead` |
| GET | `/api/searches/:id/power` | | `{balance, at, daily, days_left, runout, weeks:[{from, to, kwh}], month_kwh, last_photo_at, waiting_photo, readings}` |
| POST | `/api/searches/:id/power` | `{kind: reading\|topup, kwh, at?, photo?, amount?, currency?, note?}` | `{reading, power}`; a `reading` with the `photo` key of a member's photo replaces that photo row |
| GET | `/api/searches/:id/directory` | | `{groups:[{key, name}], entries}` |
| PUT / DELETE | `/api/searches/:id/directory/:did` (`new`) | `{grp: home\|bikes\|food\|services\|health\|<custom>, name, subtitle?, channel: whatsapp\|telegram\|phone\|map, address?, phone?, map_url?, lat?, lng?, icon?, sort?}` | `{entry}` / `{ok}` |
| POST | `/api/searches/:id/directory-groups` | `{name}` | `{groups}` |
| PUT | `/api/listings/:lid/travel` | `{times:[{anchor_id, minutes, km?, mode?}], replace?}` | `{travel}` = `listings.travel` `{anchor_id: {min, km, mode, at}}` |

`GET /api/searches/:id/living` also returns `moveout`, `relet`, `power`, `directory`, `dir_groups`, `visas` (`[{user_id, name, visa_until}]`), `rooms`, `money_mode`. `GET /api/media?key=m/<search>/…` returns a member's meter photo. Brief anchors (`brief.anchors: [{id, name, type, lat, lng, map_url?, max_minutes?, mode?, by}]`) are added and removed by members in the Mini App (event `brief_changed` key `anchors`).

Money with rooms: rent expenses without their own split follow the room shares (a member's rooms add up, a shared room with a share is split equally between voters); other expenses are equal between voters (`others_equal`, default) or follow `shares`. `GET /api/searches/:id/expenses` adds `mode`, `rooms`, `rent_weights` and `totals.{this_month, by_kind, by_month, per_month_avg}`.

New digest events: `person_note`, `moveout`, `relet`, `relet_lead`, `money_mode`, `directory`; new instruction kinds: `meter_photo` (`ref` = reading id, `photo` = KV key), `moveout_reply`, `relet`, `dir_message` (`ref` = directory entry id or house contact id), `brief_area`.

### Wave 4: places, location score, flood, bikes, 3D scans, dossier, things

**Places.** Base places come from the region pack (`regions/<country>/places.yaml` → `/art/<country>/places.json`, ids `b:<pack id>`); user places of a search are stored in `places` (ids `pl_…`). Types: the pack's `types` keys (beach, surf, coworking, gym, yoga, supermarket, market, hospital, pharmacy, coffee, food, daytrip) plus `nightlife`, `construction` (only a penalty when quiet matters) and `other` (shown, not scored). Tiers 1 top / 2 good / 3 ordinary. The Worker assigns `area` (districts.geojson point-in-polygon; outside every area → the nearest area when it is within ~30 min by the region's travel speed, else `trip`) unless the body gives one. Never send a Google list's author name, avatar or Google id.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/searches/:id/places` | | `{places, base: {count, types}}` (user places incl. hidden) |
| POST | `/api/searches/:id/places` | `{places:[{name, lat, lng, type?, tier?, note?, address?, url?, source: google_list\|my_maps\|google_place\|manual, list_name?, ext_key?, area?}]}` (≤ 500) | `{added, updated, places}`: upsert by `ext_key` (default: lowercased name + point rounded to 4 decimals); rings of every listing with isochrones are recomputed; event `places` |
| PATCH | `/api/places/:pid` | `{type?, tier?, note?, name?, hidden?, area?}` | `{place}` |
| DELETE | `/api/places/:pid` | | `{ok}` |

**Location score.** The agent computes free-flow scooter isochrones (car in KZ) at the region pack's ring minutes and stores them; the Worker works out which places and brief anchors are inside each ring (innermost wins) and scores. The ring set comes from `pack.yaml` `location: {rings: [10, 20, 40], weights: [1.0, 0.7, 0.3]}` (that is also the default when a pack has none), exported to `/art/regions.json` as `<country>.location` (a city pack may override: `sub.<id>.location`). Contours are free-flow travel times at exactly the ring minutes (wave 4 divided them by the rush factor; wave 5 does not): the city pack's `travel.rush_factor` is only a note ("in rush hour roughly +30%"), and it still multiplies the personal anchors' travel times (`travel_times_refresh`). Isochrones stored for another ring set (`isochrones.rings` differs from the pack's; NULL = legacy 5/10/30) are stale: the score is null until the agent recomputes them.
place = tier weight (1 / 0.6 / 0.3) × ring weight (10 min 1, 20 min 0.7, 40 min 0.3 by default) × pack type weight (`weight_default`) × 1.5 for the search's own places; per group (surf = surf+beach, shops = supermarket+market, cafes = coffee+food, work = coworking, sport = gym+yoga, medical = hospital+pharmacy, nightlife) a saturating sum `s = 1 − exp(−Σ/k)` (`k` = mean pack `k` of the group's types, default 1.5); group weights default 1 (nightlife 0.5) times the brief: surf ×3 when the brief mentions surf/beach or has a surf/beach anchor; shops ×2 always (long stays live on groceries); cafes ×1.5 when the brief mentions cafes/food or the search has ≥ 3 own cafe/food places; work ×1.5 for remote work / coworking / a work or cowork anchor; sport ×1.5 for gym/yoga; nightlife ×0 when quiet matters (quiet / calm / construction words, `construction_tolerance: dealbreaker`), ×3 for party words, else 0.5. `brief.priorities: {surf, shops, cafes, work, sport, medical, nightlife}` overrides the multipliers. Brief anchors form the group "your places" with the top group weight and `s` = mean ring weight of the anchors. Score = 100 × Σ W·s / Σ W minus penalties: no supermarket within the first two rings (20 min by default) −10; when quiet matters, a nightlife or construction place within the first ring −8 each; clamped 0–100. `ring_points` splits the score before penalties between the rings.

| Method | Path | Body | Returns |
|---|---|---|---|
| PUT | `/api/listings/:lid/isochrones` | `{costing, rush, rings: [10, 20, 40], geo: FeatureCollection}` — `rings` must equal the pack's ring set (else 400 `bad_rings`); one (Multi)Polygon feature per ring with `properties.ring` ∈ `rings` (coordinates rounded to 5 decimals, ≤ 1.5 MB); `rush` is stored for the note only | `{location}` (the breakdown below) |
| GET | `/api/listings/:lid/location` | | `{location, has_isochrones, ring_set, ring_weights, rush_factor, stale}`; `location` = `{score, base, groups:[{key, weight, s, points, n}], penalties:[{key, points, place?}], rings:{"10"\|"20"\|"40": {points, places:[{id, name, type, tier, own, contribution}]}} (keys = the ring minutes as strings), ring_set: [10, 20, 40], ring_weights: [1, 0.7, 0.3], rush_factor: 1.3, anchors:[{id, name, ring}], quiet, at}` or null |
| GET | `/api/searches/:id/locations` | | `[{listing_id, title, score, has_isochrones, stale}]` for open listings; `stale: true` = stored for another ring set (score null, `has_isochrones` stays true): recompute without waiting for `force` |

**Flood risk.**

| Method | Path | Body | Returns |
|---|---|---|---|
| PUT | `/api/listings/:lid/flood` | `{level: low\|medium\|high, summary, sources:[{kind: terrain\|chats\|notes\|area, title, text}], terrain?: {elev, ring_mean, diff, ring_m}}` | `{flood}`; members' notes (`notes`) are kept; event `flood` |

Area defaults live in `districts.yaml` (`flood: {level, note: {en, ru}}`).

**Bikes.**

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/searches/:id/bikes` | | `{bikes}` |
| PUT | `/api/searches/:id/bikes/:bid` (`new`) | `{model, plate?, rider_id?, price?, currency?, period: month\|week\|day, paid_until?, deposit?, rental_name?, channel?: whatsapp\|telegram\|phone, address?, phone?, checklist?: {video\|helmets\|stnk\|fuel: {done, note?}}, status?: active\|returned, date_from?, return_date?, note?}` (omitted keys keep values) | `{bike, warning?}`: `warning: original_passport` when the deposit looks like the original passport; 400 `sensitive` on ID numbers; event `bike` |
| POST | `/api/bikes/:bid/pay` | `{amount, currency?, date?, paid_by, until}` | `{bike, expense}`: an expense kind `transport` (split mode: on the rider, or the shares for a shared bike; shared money mode: the common wallet) and `paid_until = until` |
| DELETE | `/api/searches/:id/bikes/:bid` | | `{ok}` |

Reminders: payment 2 days before `paid_until` and on the day, return on `return_date` (members with notifications on; the rider only when set).

**3D scans.** Files are documents of kind `scan` (Telegram file_id only; Bot API getFile reads ≤ 20 MB, so the agent compresses big GLBs to ≤ 18 MB first). Members can also send a `.glb` to the bot DM: it becomes a scan of the current deal (caption = room; "bike <plate>" links a bike). `.usdz` is not stored: the bot asks for a GLB export.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/searches/:id/scans` | | `{scans}` (with `document`) |
| PUT | `/api/searches/:id/scans/:scid` (`new`) | `{listing_id?, room, phase: movein\|moveout\|bike, bike_id?, status: ok\|redo\|todo, note?, doc_id?, app?, sort?}` | `{scan}` (`todo` = a planned room without a file) |
| POST | `/api/listings/:lid/scans` | multipart `file` (.glb, ≤ 19 MB) + `room`, `phase`, `bike_id?`, `note?`, `app?`, `scan_id?` | `{scan, document}`: the bot sends the file to the hunter's DM, keeps the file_id |

**House dossier** (the hunter's own, like people notes: `dossiers.owner_id`, `contacts.owner_id`).

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/dossiers/match?listing_id=` | | `{dossiers}` matching the listing: the same listing, a point within 80 m, the same owner identity, or the same title |
| GET | `/api/dossiers/:did` | | `{dossier}` with `items` and live `issues` of the linked listings |
| PUT | `/api/dossiers/:did` (`new`) | `{listing_id?, title, area_text?, lat?, lng?, owner_contact_id?, verdict_title?, verdict?, stats?: {months, price, currency, price_note, issues}}` | `{dossier}`; `listing_id` (one of the caller's listings) is added to `listing_ids` and is required for `new`; an existing dossier only when one of the caller's listings is linked (403 `not_your_dossier`); the owner identity comes from the contact |
| POST | `/api/dossiers/:did/items` | `{kind: issue\|power\|cleaning\|conflict\|good\|money\|other, title, text?, sentiment?, date?, search_id?}` | `{item}`; the dossier must be linked to one of the caller's listings; `search_id` (own) defaults to that listing's search |
| DELETE | `/api/dossier-items/:iid` | | `{ok}`; only items written from the caller's own searches (404 otherwise) |

**Things bought with the villa.**

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/searches/:id/items` | | `{items, total, currency, resale_target}` (`resale_target` = Σ item targets, else 60 % of the unsold total) |
| PUT | `/api/searches/:id/items/:iid` (`new`) | `{name, price?, currency?, seller?, bought_at?, icon?, status?: have\|offered\|sold, sold_price?, resale_target?, note?, listing_id?}` | `{item}`; event `item` |
| DELETE | `/api/searches/:id/items/:iid` | | `{ok}` |

**Local calendar.** Region pack `calendar.yaml` (`/art/regions.json` → `calendar`) merged with deal dates, bikes and visas in the Mini App Plan tab; the bot reminds members before days with `remind` (e.g. stock up 2 days before Nyepi), once per event and offset, after 08:00 local, outside quiet hours.

New digest events: `places`, `flood`, `bike`, `scan`, `item`, `dossier`; new instruction kinds: `places_import` (`text` = the pasted Google Maps link), `scan_send` (send the 3D act to the owners), `flood_note`, `items_offer`.

### Wave 5: surf, guest guide, what next, negotiation, recap, guests

All `/api/searches/:id/*` and `/api/listings/:id/*` routes below need the agent token of the search owner. Money is in main currency units.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/searches/:id/surf[?refresh=1]` | `refresh=1` skips the cache | SurfView (below) |
| GET | `/api/searches/:id/guide` | | `{guide: {address, map_url, wifi_name, wifi_password_set: bool, rules:[{icon, text}], note, host: {user_id, name} \| null, url \| null, listing_id}}` (the password itself only goes to the Mini App) |
| PUT | `/api/searches/:id/guide` | `{address?, map_url?, wifi_name?, wifi_password?, rules?: [{icon?, text}], note?}`; rules ≤ 12, `icon` ∈ smoke, water, zap, trash, moon, key, car, dog, pool, shoe, info | `{guide}`; 400 `sensitive` on passport/ID/card numbers |
| GET | `/api/searches/:id/next` | | `{renewal: Renewal \| null}` |
| PUT | `/api/searches/:id/next` | `{note?, lease_to?}` | `{renewal}`; creates the open renewal if missing (normally the cron opens it 42 days before `deals.data.terms.to`) |
| POST | `/api/searches/:id/clone` | `{title?, move_in?, term?}` | 201 `{search, invite_link, group_link}`: a new active search with the same region and brief (`move_in` = given or the old lease end), the same members (roles kept, guests not copied), own places copied; `renewal.new_search_id` is set |
| GET | `/api/listings/:id/negotiation` | | Negotiation (below); owner only |
| PUT | `/api/deals/:lid/prices` | `{asked?, agreed?}` | `{asked, agreed, currency, saved_month, months, saved_term}` |
| GET | `/api/searches/:id/recap` | | Recap (below) |
| GET | `/api/searches/:id/guests` | | `{guests: [{user_id, name, from, to, areas, status, invited_by}]}` |

**Deal prices.** Besides `PUT /api/deals/:lid/prices`, `PUT /api/deals/:lid` with `data.terms.rent` sets `agreed` (if not set yet) and `asked` = the first price seen for the listing (`price_history`) or `listings.price`; `deal_at` = the first deal write. The Worker writes a `price_history` row whenever an agent PUT/PATCH changes a listing's price (and the first price on insert).

**SurfView.** `{home: {lat, lng, label, source: deal|anchor|districts} | null, date, tz, area_name | null, spots: [{id, name, tier, level: beginner|intermediate|advanced|null, bottom: reef|beach|null, faces | null, minutes, height (m, 1 decimal), period (s), stars: 1|2|3, window: {from: "HH:MM", to: "HH:MM"} | null, wind: {offshore_until: "HH:MM"|null, offshore_from: "HH:MM"|null, later: onshore|cross|null} | null, rated_wind: bool}], best: <spot id> | null, updated_at, error: string | null}`.
- Home: the deal listing, else the brief anchor(s), else the centroid of the brief districts. Spots: the pack's surf places plus the search's own `surf` places within 30 min of the home (a distance estimate: straight line × 1.35 at the region's travel speed). Forecast cache: D1 table `surf_cache` (≈72 h of hourly values per spot), refreshed at most every 3 h with one Open-Meteo marine and one forecast request for all stale spots (comma-separated coordinates); the morning digest reads the cache only.
- Data: Open-Meteo marine (`wave_height`, `wave_period`, `wave_direction`, `swell_wave_height`, `swell_wave_period`) and forecast (`wind_speed_10m`, `wind_direction_10m`), hourly, cached in D1 (`surf_cache`).
- Rating per hour: wave height in the spot's level range (from its `level` tag: beginner 0.5–1.3 m, intermediate 0.8–2.0 m, advanced 1.2–3.0 m); period ≥ 10 s is good, ≥ 13 s great; wind offshore = from `faces` + 180° ± 50°, or under 8 km/h; onshore = from `faces` ± 60° over 15 km/h. Spots without `faces` are rated without wind (`rated_wind: false`). `stars` = the day's top rating; `window` = the longest run of daylight hours at that rating; `best` = the best spot of the day.

**Renewal ("what next").** `{id, status: open|decided, lease_to, deadline (lease_to − 28 days), weeks_left, note, choice | null, decided_how: majority|owner | null, decided_at | null, votes: [{user_id, name, choice, at}], voters: n, new_search_id | null}`. Members (owner + member) vote `stay`, `new` or `leave` in the Mini App. The majority decides; early decision when one option has more than half of the voters; when everyone voted and it is a tie, the owner's vote wins. The decision reaches the agent as a digest instruction: `next_stay {lease_to, contact_hint}` (draft to the owner/landlord about the price and terms of a new direct contract), `next_new {lease_to}` (`search_clone`, then the usual new-search flow), `next_leave {lease_to}` (move-out plan, move-out 3D scans, things for sale).

**Negotiation** (owner only; never contains `budget_cap`; the offer is ≤ `budget_said`). `{listing: {id, title, price, currency, district, bedrooms, property_type}, market: {districts: [slug], bedrooms, property_type | null, count, median, p25, p75, min, max, source: crm|pack} | null, history: [{date: "YYYY-MM", price, currency, source, note, match: same|contact|photos|point|dossier, title}], offer: {price, months_upfront | null, capped: bool} | null, arguments: [...], asked, budget_said}`. `market.source: pack` = no comparable CRM listings, the city pack's `price_ref` is used. Arguments: `{key: median, value}`, `{key: not_included, items: [electricity, …]}`, `{key: empty_since, date}`, `{key: season, season: low|wet|high}` (from the pack's `season_months`), `{key: term_upfront, months}`, `{key: long_listed, days}`, `{key: was_cheaper, price, date}`.

**Recap.** `{search: {id, title, region, region_name}, members: [{user_id, name, animal}], days | null, created_at, deal_at | null, counts: {contacted, replied, viewings, deals}, prices: {asked, agreed, currency, saved_month, months, saved_term} | null, listing: {id, title, photo} | null, complete: bool, missing: [string]}`.

**Guests.** Drafts of kind `guest` are created by the Worker when a guest asks to message a directory contact; they appear in `GET /api/drafts` like the others, with `requested_by` (the guest's user id) and reason "Guest <name> asks to write to <contact>". A member or the owner approves them in the Mini App; then `drafts_ready` returns them as usual.

New digest events: `guest` (`{name, from, to}`, a guest joined); new instruction kinds: `next_stay`, `next_new`, `next_leave`, and `issue` with `data.guest = true` (reported by a guest; relay it to the owner like any other issue).

### Wave 6 · Project pipeline (stages), lease terms, closed projects

A search is a **project** with one lifecycle; the Mini App shows it as the path (screen `path`), a stage bar on each project card and on Today. Stage keys in path order: `start` (1) `search` (2) `viewings` (3) `choice` (4) `deal` (5) `movein` (6) `living` (7) `next` (8) `moveout` (9), plus `extension` (a new lease term on the same home; idx 7, shown as extra rows "Продление · до <end>" after living) and `closed` (all 9 done). Migration `0010_wave6.sql`: `searches.stage`, `stage_manual`, `stage_changed_at`, `stage_history` (≤ 30 `{stage, at, by, manual}`), `home_listing_id`, `closed_at`; table `deal_terms`; `documents.term_seq`.

**Derivation** (Worker, `src/stage-derive.ts`, pure): *start* done when the brief has a budget or districts, or there are listings / messages · *viewings* current once a viewing exists · *choice* done by a deal, a listing with the group decision `take` (most voters, or the owner's take), a listing with status `taken`, or a pinned home (`stage_set` with `listing_id`); *choice* current while some members vote take or all viewings are past · *deal* done when the first term's lease document is signed (`signed_at`, or status `have` with a file) **and** every payment due on/before `terms.from` is done (`deal.data.dates`; legacy `payments[]` only without dates, `paid` = done) · *movein* current from then (or from `terms.from` with a choice); done on/after `terms.from` with evidence (move-in video or move-in scans + a meter reading + a house contact), when the status is `living`, or 7 days after `terms.from` · *living* until: an open renewal → `next`; 42 days before the lease end (the latest signed term's `to`) → `next`; decided `stay` without a signed new term, or a signed term ≥ 2 that has not started → `extension` (back to `living` when it starts); decided `new`/`leave`, a move-out row, a re-let row, or the lease end passed → `moveout`. `closed` only by an explicit close. A manual stage (owner or agent) wins until the derived stage reaches it, then it is dropped. The derived living-group stage sets `searches.status = 'living'` (from active/found). Recomputed on every Mini App state call (one D1 statement; writes only on a change), after writes that can move it (votes, deal, deal dates, documents, viewings, listings, move-out, re-let, renewal, meter readings, scans, terms) and by the cron (3 searches per tick, rotating). On a change: event `stage_changed` `{from, to, idx, manual, date, title, note?}` (feed + digest; the first computation is silent) and, for `deal`, `movein`, `next` (skipped while an open renewal already DMs), `moveout`, `closed`, a short bot DM to the owner and members with notifications on, once per search and stage (quiet hours postpone it).

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/searches/:id/stage[?today=YYYY-MM-DD]` | `today` previews the derivation on another day (stores nothing) | `{stage: Path, derived: {key, choice}}` |
| PUT | `/api/searches/:id/stage` | `{stage: <key> \| closed \| auto, note?, listing_id?}` | `{stage: Path, changed}`; `closed` = status closed + `closed_at`, guests expired, the Mini App read-only; `auto` clears the override and reopens a closed project; 409 `closed` for a manual stage on a closed project (reopen first) |
| GET | `/api/searches/:id/terms` | | `{terms: [Term]}`: seq 1 synthesized from the deal, seq ≥ 2 from `deal_terms` |
| GET | `/api/searches/:id/terms/:seq` | | `{term}` |
| PUT | `/api/searches/:id/terms/:seq` (`new` = next) | `{from, to?, kind?: lease\|sublease, rent?, currency?, deposit?, deposit_prev?: returned\|carried\|pending\|kept, deposit_prev_amount?, landlord?, landlord_contact_id?, status?: draft\|signed\|active\|ended, dates?: [DealDate], checklist?: [{text, done}], note?, listing_id?}` | `{term, terms}` (201 on create); seq 1 → 400 `term_one` (use the deal); omitted fields keep their values; 400 `sensitive` on ID/card numbers; event `term` on create / status change |

Documents take `term_seq` (2, 3…; NULL/1 = the first term) on `PUT /api/documents/:did` and the multipart upload. A signed lease document with `term_seq` N signs term N. Deal-date reminders and the "what next" cron use the extension terms' dates and the latest term end.

**Path** (`path` in the Mini App state for the selected search; `stage` in the agent API): `{key, idx, n: 9, derived_key, manual, manual_key, closed, at, date, today, can_edit (owner), home_listing_id, home: {listing_id, title, photo} | null, terms: [Term without dates/checklist, dates = count], rows: [{key, status: done|current|todo, date, date_to, go, facts}], history, closed_at}`. `go` = the screen a row opens (`brief`, `listings`, `plan`, `listing/<id>`, `deal`, `act`, `home`, `docs`, `next`, `relet`, `moveout`). Facts (numbers only): start `{members, budget, districts, created_at}` · search `{contacted, replied, listings, from, to}` · viewings `{count, days, first, last, upcoming}` · choice `{listing_id, title, how: deal|majority|taken|manual, at}` · deal `{signed_at, signed, lease_kind, landlord, stamp, paid, pending, currency}` · movein `{date, video, meters, contacts, landlord, days_left}` · living `{from, to, day, days}` · extension (one row per term ≥ 2, or one pending row) `{seq, from, to, landlord, status, deposit_prev, deposit_prev_amount, deposit, currency, rent}` · next `{lease_to, opens, deadline, status, choice, votes, voters, new_search_id}` · relet (only when a re-let exists) `{status, from, to}` · moveout `{date, done, total, landlord, deposit_status, days_left}`. Viewers get `paid`/`pending` as null and no terms.

**Term.** `{seq, kind, from, to, rent, currency, deposit, deposit_prev, deposit_prev_amount, landlord, landlord_contact_id?, status: draft|signed|active|ended, current, signed, dates: [DealDate + term_seq, index], checklist, note?, listing_id}`.

Mini App: `searches[i].stage = {key, idx, n: 9, closed, manual, at, date, line_key, estimated, home: {listing_id, title, photo} | null, photo, listings}` from the stored columns (no derivation per row; `estimated` before the first computation); `path` (above); `dates` items carry `term_seq` and `index` (within their term). `POST /app/api/stage {search_id, stage | closed | auto}` (owner only) → `{ok, path}`. `POST /app/api/deal-date` takes `term_seq` (≥ 2) to tick an extension date. `POST /app/api/term-check {search_id, seq, index, done}` (owner/member) ticks an extension term's checklist item (event `checklist` with `term_seq`). **Closed projects** are read-only: every Mini App write that names a closed search (by `search_id`, `listing_id`, a row id or a draft id) answers 409 `closed`, except reading files (`doc-link`, `doc-send`), my own settings (`prefs`, `lang`, `revoke-links`), the recap share and the owner's `stage`; reads stay (state, dossier, documents, money totals). Guests of a closed project lose access (their rows are expired; `member()` refuses guests of closed searches).

### Wave 6 · Полезное (useful links per region)

A list of useful Telegram chats and channels, apps, guides and maps per country (Mini App screen `useful`). Two sources in one shape: the region pack's `useful.yaml` (exported to `/art/<country>/useful.json` by `copy-art.mjs`, see `PACK_FORMAT.md`) and the D1 table `useful_links` (links members suggested, links the agent added, annotations of pack items). Approved rows show in every search of that country on the instance; pending ones only to the member who suggested them and to the owner of the search where they were suggested (and to the agent of that owner). Links are `https://` only (`@handle` and `t.me/x` become `https://t.me/x`); `kind` is inferred (`t.me` → telegram, App Store / Google Play → app, else web); `hunt:<screen>` links (kind `hunt`, e.g. our places layer) exist only in packs. A link added or approved by an admin is seen by everyone in the country (`shared=1`); one from another hunter only in that hunter's projects.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/useful?country=&city=[&status=rejected]` | `country` = pack slug (`bali`), `city` = sub-pack slug | `{country, city, verified, has_pack, items: [Useful], pending: [Useful], rejected?: [Useful]}`; pending = suggested in the caller's own searches or by the caller (an admin sees all) |
| POST | `/api/useful` | `{country, name, url, category?, about_ru?, about_en?, lang?, city?, search_id?, activity?, last_checked?, kind?}` | 201 `{link}` approved at once (`decided_by: agent`); 409 `useful_exists` (already in the pack or the table); `kind` ∈ telegram, app, web |
| POST | `/api/useful` | `{country, pack_id, activity?: {members?, per_day?}, last_checked?}` | `{annotation}` (201 on the first write): one shared row per country + pack item; the activity / check date then show on the pack item; 404 `no_pack_item` |
| PUT | `/api/useful/:id` | `{status?: pending\|approved\|rejected, activity?, last_checked?, name?, url?, kind?, category?, about_ru?, about_en?, lang?, city?}` | `{link}`; annotations take only `activity` / `last_checked` (any hunter); other rows: the owner of the search where it was suggested, the hunter who added it, or an admin (403 `not_yours`) |

**Useful.** `{id, source: pack|crm, pack_id, country?, city, name, url, kind: telegram|app|web|hunt, category, about: {ru, en}, lang, last_checked, activity: {members?, per_day?, at} | null, attribution, events, icon, status: pending|approved|rejected, mine, suggested_by, suggested_by_name, search_id, note, created_at}` (pack items: `source: pack`, `status: approved`, `annotation_id`). `category` ∈ chats_rent, flea, bikes, news, visas, medicine, food, apps, guides, maps, other. `verified` = the latest `last_checked` among the shown items (the Mini App kicker "<Region> · проверено <date>").

New digest events: `useful_suggested` (`{name, title, url, category, about, status}`, a member suggested a link in this search; check it read-only and decide with `PUT /api/useful/:id`), `useful_decided` (`{title, url, status}`, by the owner in the Mini App or by the agent). Text fields go through the passport/ID/card check (400 `sensitive`).

### Wave 7 · Афиша (events, feedback, bookings)

A curated daily events feed per region. The agent collects events from read-only sources (Telegram chats/channels flagged `events: true` in the pack's `useful.yaml` / `sources.yaml`, the pack's `events.yaml` `sources`, the places layer, members' Google-list places) and upserts them; each search sees the events of the whole region (wave 8.1: no distance cutoff) ranked for its members: the ride time from its home (deal house, else the brief anchor, else the brief districts) is a ranking signal, events more than 60 min away (or in another city when there is no home point) sink and carry `far: true`. Instance-wide per country (table `afisha`; `events` is the activity log). Times are local ISO with the region's offset.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| POST | `/api/events` | one Event or `[Event]` (≤ 50) | `{created, updated, merged, skipped: [{i, reason}], ids: [id \| null]}` (201 when something was created). Dedupe: same country, similar title (normalized, token overlap ≥ 0.6), start within ±60 min (recurring: same time ±60 and overlapping weekdays; a one-off post about one night of a recurring event counts), same place (normalized name or ≤ 300 m) → merged: empty fields filled, the better photo by `photo_score` kept, the source added to `sources`. Skip reasons: `no_date`, `no_place`, `past`, `no_source`, `bad_category`, `bad_time: …` and other `code: message` validation errors. Passport/card numbers anywhere refuse the whole call (400 `sensitive`) |
| GET | `/api/events?country=&city=&from=&to=&status=&q=[&search_id=]` | `from`/`to` YYYY-MM-DD (default today + 13 days) | `{events: [Event]}`; with one of your searches also `{occurrences: [Occurrence + {excluded, parts: [{k, v}]}]}` ranked for that search's members (`excluded` = past, far, nyepi, nightlife_off) |
| PUT | `/api/events/:id` | partial Event | `{event}`; only the hunter who added it or an admin (403 `not_yours`; upsert the same event to merge details instead) |
| POST | `/api/events/:id/photo` | multipart: `photo` (file, JPEG / PNG / WebP by its bytes, ≤ 2 MB: resize to ≤ 1600 px, JPEG ~82 first), `credit` (required, ≤ 140), `source_url` (required, the post or page the photo comes from), `score?` (0..1 from the quality gate) | 201 `{event, key}`: stored in KV `e/<event>/<ts>` (one write against the daily KV budget, waits above the soft limit: 429 `kv_budget`; 120 uploads per hunter per hour: 429 `rate_limited`), expires ~30 days after the last occurrence (recurring without `until`: a year); the event's `photo_url` becomes `kv:<key>`. Anyone may fill an empty photo or bring a better `score`; replacing otherwise needs the hunter who added the event or an admin (403 `not_yours`). 400 `not_image` / `no_file` / `missing`, 413 `too_big`. For https sources `photo_url` in the upsert still works |
| GET | `/api/event-bookings?search_id=&status=` | | `{bookings: [Booking]}` of your searches |
| POST | `/api/event-bookings/:id/draft` | `{text?, lang?, channel?, address?, contact_id?, reason?}` | 201 `{draft, booking}`: a normal approval draft (`drafts.kind = event_book`, sent to the owner for approval) to the organizer; without `text` the Worker writes a short message in the organizer's language (`lang` → `organizer_lang` → the event language; templates en / ru / id: who and how many, is there space, "we'll pay on site" for paid events); booking → `drafted`. 400 `no_organizer_contact`, 409 `booking_cancelled` / `booking_booked` |
| PUT | `/api/event-bookings/:id` | `{status: asked\|booked\|declined\|cancelled\|attended, note?}` | `{booking}`; `booked` → the people who go get one DM ("Записали…, оплата на месте, сами"), the event shows in the home Plan, the cron reminds them 2 h before. When the agent marks the booking draft sent (`PATCH /api/drafts/:id {status: sent}`) the booking becomes `asked` |

**Event** (input; output adds `id`, `sources: [{kind, url, name}]`, `photo: {url, src?, credit, source_url, score, stored} | null` (an uploaded photo has `url: null`, `src: /app/kv/<key>`, `stored: true`), `effect: {shader, mix} | null`, `created_by`, `created_at`, `updated_at`): `{country, city?, area?, title, title_en?, about_ru (one human line), about_en?, category, topic?, starts_at? | recurrence?, ends_at?, place_name? | place_id? ('b:<pack place id>') | lat+lng? | area?, map_url?, price_kind: free|paid|on_site|unknown, price? (main units, per person), currency?, price_note?, entry?: free|fee|min_spend|guest_list, lang: ru|en|id|mixed|none ("без слов"), booking: none|message|ticket, ticket_url?, organizer_name?, organizer_channel?: telegram|whatsapp|instagram|facebook|email|phone|web, organizer_address?, organizer_contact_id?, organizer_lang?, source_kind: telegram|instagram|facebook|web|place|pack|user, source_url, source_name?, source_rep? (0..1), photo_url? (only when the source allows reuse; `photo_reuse: false` drops it and keeps only the link), photo_credit?, photo_source_url?, photo_score? (0..1 from the quality gate), age_min?: 18|21, dress_code?, vibe?: chill|party|sport|meet, crowd?: expats|locals|mixed, beginner?, outdoor?, sea? (needs a calm sea), tags? (audience signals: dinner_show, hotel_lobby, ballroom, bus_tour, buffet_evening, timeshare, tour_group, seniors · dj, sunset, festival, rooftop, beach_club, meetup, creative, young_crowd, live · alcohol_promo), quality? (0..1), status?: active|cancelled|hidden, search_id? (the search it was collected for)}`. `category` ∈ culture, nature, sport, dance, music, food, workshop, party, wellness, kids, other, bar, club, beach_club, social_sport, meetup, quiz (party + the last six = the "Тусовки" tab). `topic` = a slug that picks the photo effect and the "why" words (kecak, snorkel, padel, sunset_session, …). `recurrence = {freq: daily|weekly|monthly|seasonal, time: "HH:MM", end?: "HH:MM" (after midnight rolls over), weekdays?: [1..7, 1 = Mon], day?: 1..31, nth?: 1..4|-1 (+ weekdays[0]: "last Friday"), months?: [1..12], from?, until?}`.

**Occurrence** (one day of an event, as the Mini App gets it): `{key: '<id>@<YYYY-MM-DD>', id, occ, starts_at, ends_at, title, title_en, about: {ru, en}, category, topic, social, effect, recurrence, recurring: {ru: 'Каждый понедельник', en} | null, place: {name, lat, lng, area, map_url}, minutes (by scooter from the home point, free-flow), far (wave 8.1: > 60 min or another city; ranks lower, never hidden), area_id (the pack area = district chip), price_kind, price, currency, price_note, entry, lang, booking, ticket_url, organizer: {name, channel}, source: {kind, url, name}, photo: {url, src?, credit, source_url} | null (`src` = an uploaded photo through `/app/kv/<key>?k=<photo_token>`; any member, viewer or active guest of a search in the event's country), age_min, dress_code, vibe, crowd, beginner, outdoor, sea, sea_state: {calm, wave, wind} | null, score, why: {ru, en} | null, new_for_you, in_hours, live, mine: {like, nope, want, bookmark, attended, rating}, want: [user ids], going: [user ids], booking_status, booking_id}`.

**Booking.** `{id, event_id, occ, starts_at, search_id, title, organizer: {name, channel, address, lang, contact_id}, who: [{user_id, name}], guests, kind: join|guest_list|table|slot, note, status: requested|drafted|asked|booked|declined|cancelled|attended, draft_id, requested_by, created_at, updated_at}`.

**Ranking** (`crm/src/afisha-rank.ts`, pure; `scripts/test-wave7-rank.mts`): score = taste + youth fit + quality + fit, each part kept with its words for the "why" line.
- *Taste*: members' feedback per category, topic, organizer and place, decayed with a 30-day half-life (like +1, want +1.2, bookmark +0.6, attended +0.5 + (rating − 3) × 0.5, не моё −1; не моё on the item itself −3, on its category only × 0.3 and capped, so a category never dies); profile interests (`members.taste.interests`) as the default before feedback; places from the members' Google lists (≤ 150 m) +0.7.
- *Youth fit* (the audience is ~20–30): tags typical for tour groups and older audiences sink (−0.8 each, capped; softened when someone liked that kind of thing; barely counts for an older group by `age_band`), young signals rise (DJ, sunset, festival, meetups…, nightlife after 20:00); premium packages above 4× the median price −0.2. A feature, never a ban.
- *Quality*: source reputation, the agent's quality hint, the photo score, the place tier.
- *Fit*: the ring of the region pack's `location` (10/20/40 min with their weights; > 60 min excluded), a viewing at the same time −2.5, Nyepi excluded, move-out day −1.5, other holidays −0.3, payment days −0.2; sea events read the surf forecast cache at the event's hour (nearest spot ≤ 25 km): calm (wave ≤ 0.8 m, wind ≤ 20 km/h) +0.6 "море утром спокойное", rough −2.5; free +0.15. A member with `nightlife = 0` never gets bars, clubs, parties or `alcohol_promo` events.
- *Diversity re-rank* per day: a seeded jitter among items within 4 points of the best ("Ещё" = a new seed), then greedy: never two of a category in a row, at most 2 per organizer, at least one "new for you" (no interest shown in that category/topic yet) in the first five and ~20 % of the slots offered to exploration.

New digest events: `event_book` (`{booking_id, event_id, title, occ, starts_at, who: [names], guests, kind, note, name, booking, ticket_url}`: a member pressed "Записаться"; draft the message with `POST /api/event-bookings/:id/draft`; for `booking: ticket` / `none` there is nothing to send), `event_book_cancel` (`{booking_id, title, status_was}`; tell the organizer if the message already went), `event_want` (`{event_id, title, occ, name}`: a member wants to go, the others got one DM), `event_booking` (`{booking_id, title, occ, status, note}`, the agent's status change).

### Wave 9 · Вечеринки, вечер, «Как было?», организаторы

Members' own parties at the house ("Своя тусовка": a public invite with RSVP, a checklist that feeds Money, local rules and a notice to the owner / neighbours), the evening Home ("Я выезжаю", "Опаздываю"), the next-morning "Как было?" rating (the strongest taste signal), sharing an event, and organizer / venue / ticket pages as a first-class Афиша source with "link, don't store" photos. Migration `0013_wave9.sql`. The agent API needs the agent token; the caller must own the search (like event bookings).

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/parties?search_id=` | | `{parties: [Party]}` (upcoming + the last 14 days, newest first) |
| POST | `/api/parties` | `{search_id, title, starts_at, ...fields}` | 201 `{party}` |
| GET | `/api/parties/:id` | | `{party, guests: [Guest], items: [Item], ratings: [Rating], recap, rules}` |
| PUT | `/api/parties/:id` | any of the fields | `{party}` |
| GET | `/api/parties/:id/guests` | | `{guests: [Guest], counts}` |
| POST | `/api/parties/:id/notice-draft` | `{to: owner\|neighbours, channel, address, contact_id?, lang?, text?, reason?}` | 201 `{draft}`: an approval draft (`drafts.kind = party_notice`), never sent by itself. Without `text` the Worker writes a short polite default in `lang` (en \| ru \| id): date, time, about how many people, "we keep it quiet after <quiet_after>", a contact. `channel` ∈ telegram, whatsapp, instagram, facebook, email, phone |
| GET | `/api/event-feedback?search_id=&from=&to=` | `from`/`to` YYYY-MM-DD | `{feedback: [{event_id, title, occ, user_id, name, attended, rating, note, liked, nope, want, updated_at}], venues: [{kind: place\|organizer, key, name, avg, n}]}` (`venues` = instance-wide ratings of places and organizers, ≥ 1 rating, avg 1..5; attended + rating beats likes in the ranking) |

**Party fields** (create / update): `title` (≤ 80, required on create), `starts_at` (local ISO with offset, e.g. `2026-11-28T19:00:00+08:00`, required on create), `ends_at?`, `theme?` (≤ 80, "Белая вечеринка"), `vibe?` (chill \| dance \| dinner \| pool \| games \| sunset), `dress_code?` (≤ 60), `capacity?` (1..300), `plus_one?` (default true), `byob?`, `note?` (≤ 300), `address?` (≤ 200) and `how_to?` (≤ 300): shown ONLY to guests who answered "Иду", on their personal link; `wifi?` (show the house guide's Wi-Fi to those guests), `status?` (active \| cancelled \| done). Passport / card numbers are refused (400 `sensitive`).

**Party** `{id (pt_…), search_id, title, starts_at, ends_at, theme, vibe, dress_code, capacity, plus_one, byob, note, status, cover: {src} | null, address, how_to, wifi, link (https URL of the public invite) | null, counts: {going, maybe, no, plus_ones, heads, left}, created_by, created_at, updated_at}`. **Guest** `{id (pg_…), name, answer: going|maybe|no, plus_one: 0|1, came: true|false|null, removed, created_at, updated_at}` (no secrets, no contact data). **Item** (checklist) `{id, title, kind: drinks|ice|food|music|cups|cleanup|other, who: user_id | null, who_name, cost, currency, done, expense_id}` (a cost becomes a Money expense; `money_mode` respected). **Rating** `{user_id, name, rating 1..5, note}`. `recap` = `{came, heads, spent, currency, rating, n_ratings, photos}`. `rules` = the region pack's `events.party` (`{quiet_after, hint_ru, hint_en, notice_owner, notice_neighbours, fines_ru?, fines_en?}`, see `PACK_FORMAT.md`) or null.

**Events changes.** `photo_url` may be any public https image from the organizer's / venue's own page ("link, don't store"; keep `photo_credit` + `photo_source_url`). The Mini App shows it through the image proxy `/img/e/<event_id>/<v>` (members never get the raw third-party URL; a stale photo is not shown, the category card is). When the remote image fails, the Worker marks it stale: `GET /api/events` → `photo: {url, credit, source_url, score, stored, stale: true, fail: "404"|"refused"|"not_image"|"too_big"|"blocked"}`; the next sweep sends a new `photo_url` (events upsert or `PUT /api/events/:id`; a new URL clears the mark). On `refused` (hotlink protection) the agent uploads the file with `POST /api/events/:id/photo` only if the organizer posted it for promotion. Only Telegram-only photos (no public URL) go to KV as before. The agent reads organizer pages with the MCP tool `event_source_read` (JSON-LD `Event` first, then iCalendar, og: tags, same-site event links; robots.txt and noindex honoured, ≤ 1 request/s per host, 6 h cache) and prefers them over chat posts for exact date, time and line-up.

New digest events: `party_created`, `party_updated`, `party_rsvp` `{name, answer, plus_one}`, `party_notice_requested` `{to, party_id}` (a member asked: draft the notice with `/notice-draft` in the owner's / neighbours' language, approval as usual), `party_rated`, `event_rated` `{event_id, occ, rating, note}`, `evening_leaving`, `event_late` (the Worker already drafted the organizer message itself when a booking exists).

**Mini App and public routes** (Mini App: `initData` auth like the rest of `/app/api/*`; members of the search, guests get 403):

| Method | Path | Body / query | What it does |
|---|---|---|---|
| GET | `/app/api/parties` | `?s=<search>` | the search's parties (as the agent list) |
| GET | `/app/api/party` | `?s=<search>&id=` | one party with guests, checklist, ratings, recap, rules |
| POST | `/app/api/party` | `{search_id, ...party fields}` (+ `id` to update) | create (gets the default checklist and an invite link right away) / change a party; returns the same as `GET /app/api/party` |
| POST | `/app/api/party-cover?search_id=&id=` | raw image body (JPEG/PNG/WebP/HEIC ≤ 10 MB) | the cover in KV `y/<party>/c-<ts>`; without one the invite shows the house's first photo |
| POST | `/app/api/party-link` | `{search_id, id, action: share\|regenerate\|revoke}` | the public invite link: share it, issue a new token (the old one stops working), revoke |
| POST | `/app/api/party-guest` | `{search_id, id, guest_id, action: remove\|restore\|came\|not_came}` | manage a guest (a removed guest's personal link stops showing the address and cannot answer) → `{guests, counts}` |
| POST | `/app/api/party-item` | `{search_id, id, item_id?, title?, kind?, who?, cost?, currency?, done?, delete?}` | add / change / tick / delete an item; a cost with a payer (`who`) becomes one expense in Money (paid by `who`, kind food/other, split as usual or the common wallet in `money_mode: shared`); changing or deleting it replaces / removes the expense |
| POST | `/app/api/party-photo?search_id=&id=` | raw image body | members' photos after the party (KV `y/<party>/<ts>`, ≤ 30, one KV write each) |
| POST | `/app/api/party-rate` | `{search_id, id, rating 1..5, note?}` | "how was it" after the party |
| POST | `/app/api/party-notice` | `{search_id, id, to: owner\|neighbours}` | asks the agent for the notice draft (digest `party_notice_requested`) |
| GET | `/app/api/evening` | `?s=` | `{today, tz, local_min, rush_factor, tonight: {kind: event\|party, key, title, starts_at, place, photo, minutes, ride, leave_at, rush, minutes_left, late, who, booking_id, booking_status, can_late, …} \| null, more}`: the viewer's booking today (or a party at the home); leave-by = start − ride (× the city's `travel.rush_factor` when the ride falls into 07:00–09:30 / 16:30–19:30) − 10 min, rounded down to 5 min |
| POST | `/app/api/evening-leaving` | `{search_id, key}` (`tonight.key`) | "Я выезжаю": one DM to the others going, quiet hours respected |
| POST | `/app/api/evening-late` | `{search_id, booking_id, minutes: 10\|15\|20\|30\|45}` | "Опаздываю": an organizer draft (`drafts.kind = running_late`, in the organizer's language) only when the booking is `asked`/`booked` and the organizer has a channel; approval as usual |
| POST | `/app/api/event-rate` | `{search_id, event_id, occ?, rating 1..5, note?}` | "Как было?"; the bot asks the same the next morning (≥ 09:00 local) with buttons 1–5 to each member who was going |
| POST | `/app/api/event-share` | `{search_id, event_id, occ?}` → `{url}` | a signed public link to a read-only event page (`/e/<id>.<sig>`) for sharing (t.me/share/url, the client-side share card) |
| GET | `/e/<id>.<sig>` | | public read-only event page (no address for parties) |
| GET | `/img/e/<event_id>/<v>` | | (`<v>` = a version hash of the stored URL, not a secret: the proxy only ever fetches the URL stored for that event) | image proxy for linked event photos: https only, public IPs only (DNS-over-HTTPS check), redirects re-checked, ≤ 5 MB, `image/*` only, short edge cache (`cf.cacheTtl`); hides viewers' IPs from third-party sites; failures mark the photo stale |
| GET | `/p/<token>` | | public party invite (no login): ticket-style card, RSVP Иду / Может / Не смогу + name + "+1"; rate-limited; `noindex`, `no-store`, strict CSP, everything escaped |
| POST | `/p/<token>/rsvp` | form `answer, name, plus_one` | RSVP (≤ 20 per IP and hour, ≤ 300 per party and hour, a honeypot field); capacity counts "going" guests + their +1; 303 to the personal link |
| GET/POST | `/p/<token>/<guest secret>` | form `answer, plus_one` | the guest's personal link to change the answer; address, how to get there and Wi-Fi only here and only for "Иду"; `/ics` = the calendar file (with the address only for "Иду"). Revoking or regenerating the invite kills the personal links too |

### Wave 10 · Заказы (orders from suppliers)

A supplier = a shop the members order from themselves (fruit market, fish market): a catalog, one shared basket per supplier, the sent order, its receipt and its one expense. Money in main units. Migration `0014_wave10.sql`. Code: `src/orders.ts`, pure parts `src/order-text.ts`.

**Agent** (token of the search owner). The agent imports price lists and records the supplier's answers. It cannot create an order, change a basket, mark an order delivered or pay.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/searches/:id/suppliers` | | `{suppliers: [row + items (count) + price_at]}` |
| PUT | `/api/searches/:id/suppliers/:sid` (`new`) | `{name, kind: fruit\|fish\|other, dir_entry_id?, channel: whatsapp\|telegram\|phone, address, hours: 'HH:MM-HH:MM'\|null, min_free_delivery?, delivery_fee? (main units; what a delivery under the minimum costs, null = not known), delivery_note_ru/en?, note_ru/en?, lang: id\|en, currency?, sort?, hidden?}`; with `dir_entry_id` the channel and number come from that directory entry unless given | `{supplier}` |
| POST | `/api/searches/:id/suppliers/:sid/import` | `{items: [{name_id, name_ru?, name_en?, grp?, unit?: kg\|pcs\|pack\|bunch\|30pcs, step?, price?, price_unsure?, by_request?, toy?, top?, sort?, price_at?, hidden?}], price_at?, full?}` (≤ 500): upsert by `name_id` (exactly as in the list), absent fields keep their values, favourites stay, every price change goes to `supplier_prices`; `price` null / 0 = no price; `full: true` hides what the list no longer has | `{imported, created, price_changes: [{name_id, from, to}], price_changes_n, hidden, missing}`; 400 `bad_items` names the row; event `catalog_imported` |
| GET | `/api/searches/:id/suppliers/:sid/catalog` | | `{supplier, items, price_history (last 60), units}` |
| GET | `/api/searches/:id/orders?status=` | | `{orders}`: baskets, active, the last 20 finished |
| GET | `/api/searches/:id/sets?supplier_id=` | | `{sets}` (read only, as in the orders view below); the agent never creates, changes, deletes or applies a set |
| PATCH | `/api/searches/:id/orders/:oid` | `{status?: sent\|confirmed\|cancelled, total?, deliver_time?, deliver_day?, reply?, reply_tr?}` on an active order | `{order}`; `confirmed` DMs owner and members once (quiet hours respected) |

**Mini App** (owner and member; legacy viewers only GET `shop`, `orders`, `order` without contacts, message text, paid sums and expenses; guests 403). Every POST takes `search_id` and, except `order-line` / `order-again`, answers with the orders view `{suppliers, baskets, active, history}`.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/app/api/shop?s=` | | the orders view + `keys`, `items: {supplier_id: [[…]]}` (one array per item in the order of `keys`: id, ru, en, name_id, grp, unit, step, price, flags (1 unsure, 2 by request), toy, top, fav), `price_at`, `usual_min` (2). The catalog is only here, never in the main state |
| GET | `/app/api/orders?s=` | | the orders view (Home, status, history): `suppliers` (with `delivery_fee` and, for owners and members, `ratios`: `[[order_id, paid / price list, delivered_at]]` of delivered orders where every line had a price, oldest first, ≤ 30), `baskets`, `active`, `history` (orders carry `method` of their expense: cash \| transfer \| card \| null), `sets` (below) |
| GET | `/app/api/order?s=&id=` | | `{order}` (the receipt behind an expense: `expenses.order_id`) |
| GET | `/app/api/order-preview?s=&id=` | | `{order, text, text_tr, address: {on} \| null, days: [{day, slots}] (today, tomorrow), free, can_open, can_agent, supplier}` |
| POST | `/app/api/order-line` | `{item_id, qty}` absolute quantity on the item's step, 0 removes (idempotent; 900 per hour) | the orders view; the line keeps who added it first |
| POST | `/app/api/order-again` | `{supplier_id?, order_id?}`: the last delivered order's lines (or exactly the order `order_id`, "Повторить" on its receipt) at current prices, existing lines stay | the orders view + `supplier_id` |
| POST | `/app/api/order-set` | `{order_id, day?, time?, note?, with_address?}`; day today…+7, time inside the supplier's hours | preview |
| POST | `/app/api/order-clear` | `{order_id}` (the basket): the lines go, the server keeps them (qty, who added, note, day, time) for 15 min | + `cleared: {order_id, supplier_id, n} \| null` |
| POST | `/app/api/order-restore` | `{order_id}`: "Вернуть" after a clear: exactly those lines back (an item added again meanwhile keeps the larger qty and its adder), once; 409 `nothing_to_restore` / `restore_expired` | + `restored`, `supplier_id` |
| POST | `/app/api/order-open` | `{order_id}`: snapshot of names, prices and text, status `opened` | + `url` (`wa.me/<digits>?text=…` or `t.me/<handle>?text=…`); the human presses send |
| POST | `/app/api/order-agent` | `{order_id}`: an approval draft (kind `other`), status `draft`; rejected / failed → basket, sent → `sent` | |
| POST | `/app/api/order-status` | `{order_id, action}`: `sent`, `not_sent` (back to the basket, merged if a new one exists), `confirm` `{total?, time?, day?}`, `cancel` (also rejects an unsent draft), `delivered` `{total?}` | `delivered`: in one batch exactly one expense (kind `food`, `paid_by` = who tapped, split as usual / the common wallet), favourites +1; 400 `need_total` when the sum is not known; repeats do nothing |

**Наборы (sets)** — migration `0020_order_sets.sql` (`order_sets`, `order_set_lines`, `orders.cleared` / `cleared_at`), pure parts `src/order-sets.ts`. A set = one supplier's saved basket (item + qty) with an optional reminder; it never sends an order. In the orders view: `sets: [{id (os_…), supplier_id, name, repeat: none | weekly | biweekly, days (bitmask, 1 = Monday … 64 = Sunday), time 'HH:MM' local, anchor (biweekly: a Monday of a week that fires), next: {day, time} | null, last_sent, skipped, lines: [{item_id, qty, unit, step, toy, grp, name_id, name_ru, name_en, price (live), unsure, gone?}]}]` (sets of hidden suppliers are left out; ≤ 50 per search).

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/app/api/order-set-save` | `{from_order_id, name, repeat?, days?, time?}`: the lines of the basket or of any earlier order of this search; `name` ≤ 40, unique per search case-insensitively (ё = е) → 409 `name_taken`; a reminder needs a weekday (400 `need_days`) | the orders view + `set_id` |
| POST | `/app/api/order-set-edit` | `{set_id, name?, repeat?, days?, time?}`; "every 2 weeks" takes the week of its first reminder as the anchor (again when the days change) | the orders view + `set_id` |
| POST | `/app/api/order-set-delete` | `{set_id}` | the orders view |
| POST | `/app/api/order-set-apply` | `{set_id}` ("В корзину"): ADDS the lines to the supplier's basket: existing lines stay, the same item keeps the larger qty, new lines are by who tapped, current prices, hidden items skipped; 409 `set_empty`, `too_many_lines` | the orders view + `supplier_id`, `added`, `gone` |

Reminder (cron, every 15 min, right after the outbox): a set with a repeat DMs owner and members (notifications on, their language, quiet hours postpone it) on its weekday at its local time (the search time zone), once a day (`last_sent`; a missed tick still sends within 3 h, never on another day): "Понедельник: пора заказать «Фрукты на неделю»\n28 позиций, приготовить 1,0–1,4 млн" (the range = the Mini App's `ordSpread`, ported in `order-sets.ts`). Buttons: "Собрать корзину" (web app `#/s/<sid>/set-apply/<set>`: the app calls `order-set-apply` and opens the basket) and "Пропустить" (callback `os:<day>:<set>`: owner / member only, sets `skipped`, edits the message and drops the buttons).

Statuses: `basket` → `opened` (WhatsApp opened, "Отправил?") or `draft` → `sent` → `confirmed` → `delivered`; `cancelled` from any active one. One open basket per supplier (unique index). The message is a template in the supplier's language (`lang`) with the names of the price list, polite, "Bayar di tempat"; the house address only when the guide has one and the toggle is on (default on for the first order to a supplier). Digest events (members): `order_sent`, `order_draft`, `order_confirmed`, `order_cancelled`, `order_delivered`, `expense`.

### Notify
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/notify` | `{search_id, text, to: "owner"|"chat"}` | `{ok}` |

### Interest, decision, ratings

- **Interest before viewing**: vote weights `take` +3, `want_view` +2, `thinking` +1, `not_interested` −2; `interest = {score: sum, max: 3 × members with role owner|member, votes}`.
- **Group decision** (`listings.decision`): recomputed from all votes after every vote/unvote (Mini App and bot buttons): the majority; ties go to the stronger positive (take > want_view > thinking); a tie between a positive and `not_interested` is `thinking`; the owner's `take` makes it `take`. A decision the agent sets through the API (`decided_by` becomes null) stays until members vote.
- **Ratings after viewing** (`ratings` table): each member gives 1–5 for `overall`, `area` (area and road), `inside`, `quiet` (quiet and neighbours), an optional note and voice note. Member score = mean of the four; listing `score` = mean of member scores (1 decimal); `criteria` = per-criterion means; `weak` = criteria under 3. Summary: `{score, by_member:[{user_id, score, overall, area, inside, quiet, at}], criteria, weak, notes:[{user_id, note, voice?}]}`.

## Telegram bot behaviour

Notifications (bot DMs to members with `members.notify = 1`), all best-effort:
- incoming message about a `want_view` / `take` listing (from `POST /api/messages`);
- draft approvals to the owner (`POST /api/drafts`);
- wave 7: "хочу пойти" on an event (once per person, event and day, to the other members); "Записали" when the agent marks a booking `booked` (the people who go); a reminder 2 h before a booked event (cron, once); the morning digest adds "🎟 Сегодня: <top event>, <time> · <place> (<why>)" for owner/members with the Афиша line on (`members.afisha`, NULL = on once the project has a home; a nightlife opt-out gets its own pick);
- viewing reminder 60–75 min before a `confirmed` viewing, once (`viewings.reminded_at`);
- deal dates (`deals.data.dates`, or legacy `payments`): payment 7 and 2 days before and the morning of the day; notice 14 and 3 days before; move-out 3 days before; deposit return on the day and 3 days later unless `done` (also an event `date_due` for the agent); once per date and offset (`sent_marks`), after 08:00 local and outside quiet hours;
- morning digest, 08:00–12:00 local (first cron tick outside quiet hours), once a day per member with `members.digest = 1`: new listings (24 h), replies waiting for us, drafts waiting (owner), today's payments and viewings, scam flags (`checks` not ok on want_view/take listings or upcoming viewings), open house issues; buttons Open Hunt / Approve messages / New listings; nothing to say = no DM;
- power tokens: when the estimated balance lasts ≤ 3 days (living searches with readings in the last 3 weeks), once per reading, after 08:00 and outside quiet hours, with the pack's "where to buy" line;
- visa: to the member only, when their `visa_until` is before the lease end: `remind_days_before` days before the apply-by date (expiry − pack `visa.extend_lead_days`), 3 days before and on the day;
- wave 5: the morning digest gets a surf line (best spot, stars, height, period, window) for members with `members.surf` on or auto (auto = the brief mentions surf/серф/волн); the "what next" renewal opens 42 days before the lease end (`deals.data.terms.to`) and members are reminded to vote before the deadline (lease end − 28 days); guests are marked `expired` after their `to` date and a member is told when a guest joins (event `guest`);
- "Rate <title>" 60–90 min after a `confirmed` or `done` viewing started, once per viewing (`viewings.rate_asked_at`), to members who can vote and have not rated it, with a button into the rating screen (`#/s/<sid>/rate/<lid>`); waits in `outbox` during quiet hours.
- orders · sets: on a set's reminder day and time (local), "пора заказать «<set>»" with the number of items and the money range, buttons "Собрать корзину" / "Пропустить", once per occurrence; never an order by itself (see "Наборы" above);

Quiet hours come from the owner's `profile.quiet_hours` (`"23:00-08:00"`, search timezone; default `23:00-08:00`, `"off"` disables). Inside them message alerts and draft approvals wait in `outbox` until the quiet hours end, date reminders and the digest wait for the next run; viewing reminders always go. A Cron Trigger (`*/15 * * * *`) sends the queue and the reminders.

- **/start** in DM: registers the user (`users.tg_user_id`), sets UI language from Telegram.
- **Search chat** (a group with the bot and the hunt's members):
  - each published listing is a media group (up to 10 photos) followed by a text card with key facts and buttons: `👀 Want to view` · `🤔 Thinking` · `✕ Not interested` · `Open`;
  - a vote updates `votes` and `listings.decision` and edits the card to show who voted what;
  - a reply to a card is saved as a comment event and shown to the agent in the digest;
  - day plans, viewing confirmations and important updates are posted here.
- **Owner DM**: draft approvals (`Send` · `Edit` · `Skip`); Edit asks for the new text as the next message; notifications in `ask` mode.
- **3D scans in the DM** (wave 4): a `.glb` becomes a scan of the current deal (document kind `scan`, caption = room, "bike <plate>" = a bike scan, move-out phase once a move-out exists); `.usdz` gets "export GLB"; files over 20 MB get "send it to the agent" (instruction `scan_big`).
- **Wave 4 reminders**: bikes (payment 2 days before `paid_until` and on the day, return on `return_date`; to the rider or everyone for a shared bike), local calendar (`calendar.yaml` `remind[].days` before an event, found/living searches while the lease covers it); once per date and offset, after 08:00 local, outside quiet hours.
- **Files in the DM**: a document, photo or video a member sends to the bot while one of their searches has a deal is attached to that deal (`documents` row with the Telegram file_id, kind guessed: video → move-in video, photo → receipt, "lease/договор" → lease) and an event `document` goes to the agent.
- Commands: `/list` (top listings), `/plan` (today's viewings), `/app` (opens the Mini App), `/token` (a new agent token, hunters), `/invite` (admins), `/revoke` (revokes all my agent tokens, `tokens.revoked_at`, and every web link and photo token, `users.link_gen + 1`).
- Free text in the DM (instructions), edited draft texts and group messages that look like passport/card numbers are refused (DM) or masked (group); group messages of non-members are ignored.
- Cron limits per tick (free tier): ≤ 32 D1 statements (+8 reserved for the "sent" marks and outbox deletes that follow successful sends), ≤ 40 Telegram calls, ≤ 20 outbox sends; outbox rows are deleted only after a successful send (a failing row is retried hourly, dropped after 3 days); several postponed "new message" alerts to one person go as one DM; the morning digest checks all its `sent_marks` in one query and writes them after the sends. Jobs start at a rotating position so a busy one doesn't starve the rest; everything is idempotent, the next tick continues.

## Mini App

Static page from Workers Static Assets (`crm/public/`), entry `/app`. Wave 5: surf today near the home (SurfView, and an optional surf line in the morning digest: `members.surf` 1 on / 0 off / NULL auto = on when the brief mentions surf/серф/волн), the house guide (address, map, Wi-Fi, rules, note, host contact, nearby places, emergency numbers) with a shareable public page, "what next" before the lease ends (vote stay / new / leave), the negotiation helper (owner), the recap card (shared as a PNG through the bot DM), guests (invite with dates and areas, change, revoke; approve their drafts). State additions for members: `me.surf` (effective), `me.surf_auto` (true when `members.surf` is NULL), `renewal` (open, or decided within the last 30 days), `guests: [{user_id, name, animal, from, to, areas: {guide, places, contacts, issues}, status, invited_by}]`, `guest_drafts: [{id, text, reason, channel, address, requested_by, requester_name, dir_name, created_at}]` (pending kind `guest` drafts; members and the owner), `guide_ready` (a guide row with a token exists); the location view adds `ring_set`, `ring_weights`, `rush_factor`, `stale`. **Guest state** (the user is a guest of `?s=<sid>` or only has guest searches): the same top-level keys with empty arrays / nulls for everything a guest can't see (`listings: []`, `votes: []`, `viewings: []`, `drafts: []`, `threads: []`, `feed: []`, `documents: []`, `money: null`, `deal: null`, …), plus `search: {id, title, region, country, role: guest, brief: {timezone}, members: [hosts]}`, `me: {role: guest, animal, reveal_seen: true, notify: false, digest: false, guest: {from, to, areas, hosts: [first names], days_left}}`, `members` (hosts), `home: {title, lat, lng, area_text, photo} | null`, `directory` (entries outside the home group, if `areas.contacts`, else []), `dir_groups`, `places` (own places if `areas.places`, else []), `issues` (the guest's own, if `areas.issues`), `bot_username`, `photo_token`, `counts: {new: 0, drafts: 0, replies_24h: 0}`. Wave 9 screens: the party (`party/<id>`: ticket hero with the cover or the house photo, counts, invite link share / copy / regenerate / revoke, guests with remove, checklist with "Возьму" and costs, local rules with "tell the owner / neighbours", after the party the rating, photos and recap), create / edit (`party-edit/new`, `party-edit/<id>`), own parties on top of Афиша and in the Plan, the evening Home hero (tonight's booking or party from 15:00 or ≤ 6 h before: leave-by sticker, who goes, "Я выезжаю", "Опаздываю" sheet), "Как было?" (1–5 + note) on past events and "вам понравилось" on repeat venues (`occurrence.liked_before {rating, users}`, `occurrence.venue {avg, n}`, `occurrence.pt [lat, lng]`, `occurrence.mine.note`), the map layer "Вечер" (`map/evening`: tonight's events from 16:00 as black time pins, Афиша's district filter, today's party as a sticker on the home pin), the share sheet (a 1080×1350 canvas card in the ticket style, Telegram share, the public link). Wave 7 screens: Афиша (`afisha`, `afisha/social` = Тусовки; from the home Plan card, "Ещё" and the search switcher): tickets with one category photo effect (`public/fx.js`, shaders in `public/fx/`, the table from the pack's `events.yaml`), the event of the day as a swipe stack (right = записаться, left = не моё), a 7-day strip, filter chips, a weekday card; the event page (`event/<id>@<day>`): sea card for sea events, "Агент запишет" steps, who's going, "Хочу пойти", bookmark; the booking sheet (who goes, guests, guest list / table / slot) and the settings sheet (nightlife, the digest line, interests, age). Wave 4 screens: listing location with the pack's rings (10/20/40 minutes by default, free-flow; rush hour shown as a note) (`location/<lid>`) and how the score is counted (`score/<lid>`), places by area with type filters and "add from Google Maps" (`spots`; the map has a places layer), flood risk (`flood/<lid>`; the area default also shows in the district sheet), bikes (`bikes`), the 3D move-in act (`act`, `<model-viewer>` streaming the GLB through the signed document proxy, AR where supported, move-out next to move-in), house dossier (`dossier/<lid>`), things bought for the house (`items`), local calendar (`calendar`, the Plan tab when the search has a deal or no viewings). Deck cards and compare show "Location N"; the listing screen links location, flood and an existing dossier. The state adds `places`, `bikes`, `scans`, `items` and per listing `location_score` and `flood`; base places come from `/art/<country>/places.json`, the calendar from `/art/regions.json`. Wave 3 screens: move-out (`moveout`), person card with notes (`contact/<cid>`, from a conversation or a house contact), rent split by rooms (`split`, from the money tiles), power (`power`), visa and emergency (`important`), places near a listing (`places/<lid>`), areas map (`map/districts[:<area>]`, the "Districts" segment on the map) and area detail (`district/<id>`), re-let (`relet`), contacts directory (`directory`); the house screen links them. Money has a `shared` mode (owner, the gear on the money screen) that shows totals only. The state adds `moveout`, `relet`, `power`, `directory`, `visas` and `search.{money_mode, rooms, dir_groups}`; region data (areas, emergency, power, visa) comes from `/art/regions.json`, outlines from `/art/<country>/districts.geojson`. Wave 2 screens: scam check (`#/s/<id>/check/<lid>`, a banner on the listing), money (`money`: balance, settle up, totals, expenses, "+" to add, shares), on-site checklist (`onsite/<lid>`, items from the pack `checklist.yaml`, photos, "Rate it"), the house (`home`; `today` shows it when the search status is `living`: issues with "Report", contacts with messenger buttons, next dates), documents and dates (`docs`, `doc/<id>`: open the file through a 15-minute signed link or get it in the bot DM). Settings have per-search switches for bot DMs (`members.notify`) and the morning digest (`members.digest`). Tabs: **Today** (next viewing, counters, conversations row, feed), **Listings** (list, swipe deck, compare), **Map** (pins by decision, anchor ring, day route), **Plan** (viewings by day, route, "running late"). Detail screens: listing, approve drafts (owner), deal (members tick the checklist), brief (tap the search name on Today or "Brief" on a search card; the owner edits it), conversations (`#/s/<id>/chats`, one per contact: agreed / open / last, the pending draft, a deep link into WhatsApp / Telegram / Messenger / Instagram / email).

The swipe deck and the "N new" counter show listings without my vote that nobody decided yet or that friends voted on (not agent-set decisions, not `take`). Listings tab segments: Liked (group `want_view`/`take` or score ≥ 3.5, by score then interest; Compare lives here), New, All, Passed. Compare shows `want_view`, `take` and every rated listing with score rows and a sort (score / price / interest). Today: the search name opens a switcher (my searches, "about this search", all searches); the "+" next to the animals shares the invite link. The brief in `state` never contains `budget_cap*`; `budget_said` goes to the owner only. Theme follows Telegram `colorScheme`; accent comes from the region pack. Language follows `users.lang`.

Each member gets an animal avatar from the search's country pack (`members.animal`, unique within the search), shown once in a reveal screen.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/app/api/state?s=<search>` (or `?l=<listing>`) | | `{user, searches[], search, me (+notify, digest), members, listings (+checks), votes, ratings, viewings, routes, drafts, threads, listing_contacts, channels, deal, dates, bot_username, feed, counts, agent_last_seen, photo_token}` plus placeholders (`money: null`, `issues: []`, …) filled by `state-more`; without `s` and with several searches only `{user, searches}`. Photos come as `{…, src}` (`/app/kv/<key>[?i=n]` or `/app/photo/<listing>/<index>`), never with a Telegram `file_id`. Feed: `instruction` events only to their author and the owner. Viewers get no deal, drafts, threads, channels, invite link |
| GET | `/app/api/state-more?s=<search>` | | `{search_id, money, issues, house_contacts, documents, onsite, onsite_photos, moveout, relet, power, directory, visas, places, bikes, scans, items}` (loaded in parallel with `state` and merged by the Mini App; keeps each call well under D1's 50 queries per invocation); viewers: no money, documents, house contacts, move-out, re-let, scans; guests: `{search_id}` |
| POST | `/app/api/revoke-links` | `{}` | `{ok}`: every web link and photo token of mine stops working (`users.link_gen + 1`) |
| POST | `/app/api/member-remove` | `{search_id, user_id}` | `{ok}` (owner): the member row goes, links minted for them die, the member invite is rotated; event `member_removed` |
| GET | `/app/api/listing?id=` | | `{messages, contacts, comments}` |
| POST | `/app/api/vote` | `{listing_id, decision, comment?}` | `{ok, decision}`: `decision` = the recomputed group decision |
| POST | `/app/api/unvote` | `{listing_id}` | `{ok, decision}`: drops my vote (deck undo), event `vote_undone` |
| POST | `/app/api/comment` | `{listing_id, text}` | `{ok}` |
| POST | `/app/api/rate` | `{listing_id, overall, area, inside, quiet, note?, voice?}` (1–5 each; owner/member) | `{ok, score, rating}`; upsert, event `rating` |
| POST | `/app/api/rating-voice?listing_id=` | raw audio body (webm, ogg, mp4, mpeg, aac, wav; ≤ 8 MB) | `{key}`: stored in KV; pass it as `voice` to `/app/api/rate` |
| POST | `/app/api/draft` | `{draft_id, action: send|skip, text?}` | `{ok, status}` (owner only; members may also decide drafts of kind `guest`) |
| POST | `/app/api/searches` | `{region: 'country/city', title, mode?: 'search'\|'living', wish?, brief?: {districts?, bedrooms?, move_in?, term?, budget_cap?, currency?, timezone?, …the `/app/api/brief` keys}}` | `201 {id, invite_link}`: a new project from the app; invited hunters only (`403 not_hunter`), the caller is the owner; `wish` becomes an `instruction` event for the agent; event `project_started`. State `user.can_create` says whether to show the button |
| POST | `/app/api/instruction` | `{search_id, text, kind?, minutes?, ref?, date?}` | `{ok}`: event `instruction` for the agent's digest ("running late") |
| POST | `/app/api/home-name` | `{search_id, listing_id, short_name}` | `{ok, short_name}` (owner only; wave 8.1, same rules as the agent's `short_name`) |
| PATCH | `/app/api/brief` | `{search_id, brief: {bedrooms?, budget_min?, budget_max?, budget_said?, move_in?, term?, payment_terms?, property_type?, districts?, must_have?, nice_to_have?, deal_breakers?}}` (null removes a key) | `{ok, changed, brief}` (owner only); event `brief_changed` with a diff for the agent |
| POST | `/app/api/deal-check` | `{listing_id, index, done}` | `{ok, done}`: ticks `deals.data.checklist[index]`, event `checklist` |
| POST | `/app/api/reroll-animal` | `{search_id}` | `{animal}` |
| POST | `/app/api/seen-reveal` | `{search_id}` | `{ok}` |
| POST | `/app/api/lang` | `{lang: en|ru}` | `{ok}` |
| POST | `/app/api/expense` | `{search_id, title, amount, currency?, date, paid_by?, split?, kind, method?, note?, receipt?}` | `{ok, expense}` (owner/member) |
| POST | `/app/api/expense-delete` | `{id}` | `{ok}` (who added or paid it, or the owner) |
| POST | `/app/api/expense-receipt?search_id=` | raw JPEG/PNG/WebP/HEIC (≤ 10 MB; SVG and other types → 400 `not_image`) | `{key}` in KV, pass as `receipt` |
| POST | `/app/api/settle` | `{search_id, from, to, amount, currency}` | `{ok, money}`; event `settled` |
| POST | `/app/api/shares` | `{search_id, shares}` | `{ok, money}`; event `shares_changed` |
| POST | `/app/api/onsite` | `{listing_id, viewing_id, item, ok: true\|false\|null, note?}` | `{ok}` |
| POST | `/app/api/onsite-photo?listing_id=&viewing_id=` | raw `image/*` | `{key, count}` |
| POST | `/app/api/issue` | `{search_id, title, note?}` | `{ok, issue}` + event `instruction` kind `issue` for the agent (guests with `areas.issues` too: `data.guest = true`) |
| POST | `/app/api/doc-link` | `{id}` | `{url}`: `/app/doc/<id>?t=` valid 15 min, bound to the user, re-checked against membership, streams from Telegram |
| POST | `/app/api/doc-send` | `{id}` | `{ok}`: the bot sends the file to my DM by file_id |
| POST | `/app/api/doc-request` | `{search_id, listing_id?, kind, title?}` or `{search_id, id}` | `{ok}`: document status `request` + instruction `doc_request` |
| POST | `/app/api/deal-date` | `{listing_id, index, done}` | `{ok}` (stops that date's reminders) |
| POST | `/app/api/prefs` | `{search_id, notify?, digest?, surf?: bool \| null}` | `{ok}`; `surf: null` = back to auto |
| POST | `/app/api/money-mode` | `{search_id, mode: split\|shared}` | `{ok, money}` (owner) |
| POST | `/app/api/rooms` | `{search_id, rooms: {rooms, others_equal} \| null}` | `{ok, rooms, money}` (owner/member) |
| POST | `/app/api/meter-photo?search_id=` | raw `image/*` | `{ok, key, power}`: KV `m/<search>/…`, a reading row kind `photo`, instruction `meter_photo` |
| POST | `/app/api/visa` | `{search_id, until: YYYY-MM-DD \| null}` | `{ok}`: a date only; visible to the member and the search owner |
| GET | `/app/api/contact?id=&s=` | | `{contact, channels, notes, stats}` for a contact of one of my searches |
| POST | `/app/api/note` | `{search_id, contact_id, text, sentiment}` | `{ok, note}` |
| POST | `/app/api/moveout-step` | `{search_id, key, status: done\|todo}` | `{ok, moveout}` |
| POST | `/app/api/anchor` | `{search_id, anchor: {name, type, lat?, lng?, map_url?, max_minutes?, mode?}}` or `{search_id, remove: id}` | `{ok, anchors}`; event `brief_changed` |
| POST | `/app/api/dir-entry` | `{search_id, id?, grp, name, subtitle?, channel, address?, map_url?}` | `{ok, entry}` |
| POST | `/app/api/dir-group` | `{search_id, name}` | `{ok, groups}` |
| POST | `/app/api/dir-delete` | `{id}` | `{ok}` |
| GET | `/app/api/location?id=` | | `{location, has_isochrones, geo, places:[{id, name, type, tier, own, lat, lng, ring, emoji}], types}` |
| POST | `/app/api/place` | `{id, type?, tier?, hidden?}` | `{ok, place}` (own places; members) |
| POST | `/app/api/places-link` | `{search_id, url}` | `{ok}`: instruction `places_import` with the Google Maps link |
| POST | `/app/api/bike` | `{search_id, id?, model, plate?, rider_id?, price?, period?, paid_until?, deposit?, rental_name?, address?, return_date?, status?}` | `{ok, bike, warning?}` |
| POST | `/app/api/bike-pay` | `{id, amount, until}` | `{ok, bike, expense, money}` |
| POST | `/app/api/bike-check` | `{id, key: video\|helmets\|stnk\|fuel, done}` | `{ok, bike}` |
| POST | `/app/api/scan-send` | `{search_id}` | `{ok}`: instruction `scan_send` |
| GET | `/app/api/dossier?listing_id=` | | `{dossiers}` (matches, as for the agent) |
| POST | `/app/api/item` | `{search_id, id?, name, price?, seller?, bought_at?, status?, sold_price?}` | `{ok, item, items}` |
| POST | `/app/api/item-delete` | `{id}` | `{ok, items}` |
| POST | `/app/api/item-photo?search_id=` | raw `image/*` | `{key}` (KV `i/<search>/…`) |
| POST | `/app/api/flood-note` | `{listing_id, text}` | `{ok, flood}` + instruction `flood_note` |
| GET | `/app/photo/<listing>/<index>?k=<photo_token>` | | a listing photo stored in Telegram, by listing and index (never by raw file_id); membership checked |
| GET | `/app/kv/<key>[?i=n]&k=<photo_token>` | | KV media; the search comes from the key prefix (`p/ a/ v/ o/` listing, `r/ m/ i/` search) and membership is checked (guests: the home's album only); `i` = a photo of an album value. `Cache-Control: private, max-age=172800, immutable`, `nosniff`, `CSP: default-src 'none'; sandbox`; a non-whitelisted stored type is served as an attachment |
| GET | `/app/api/surf?search_id=` | | SurfView (members; guests with `areas.places`) |
| GET | `/app/api/guide?search_id=` | | `{guide: {address, map_url, wifi_name, wifi_password (members; guests with areas.guide), rules, note, host: {user_id, name, tg_username} \| null, url \| null (members only), title, photo, lat, lng, places: [{name, type, emoji, minutes}], emergency: [{label, phone}]}}` |
| POST | `/app/api/guide` | `{search_id, address?, map_url?, wifi_name?, wifi_password?, rules?, note?}` | `{guide}` (members) |
| POST | `/app/api/guide-link` | `{search_id, action: share\|regenerate\|revoke}` | `{url \| null}` (members; share/regenerate make me the host contact) |
| POST | `/app/api/next-vote` | `{search_id, choice: stay\|new\|leave}` | `{renewal}` (members and the owner) |
| GET | `/app/api/negotiation?listing_id=` | | Negotiation (owner only; others 403 `owner_only`) |
| GET | `/app/api/recap?search_id=` | | Recap (members) |
| POST | `/app/api/recap-share?search_id=` | raw `image/png` (≤ 5 MB) | `{ok: true}`: the bot sends the PNG to my Telegram DM to forward |
| POST | `/app/api/guest-invite` | `{search_id, from, to, areas: {guide, places, contacts, issues}}` | `{link, code, expires_at}` (members and the owner) |
| POST | `/app/api/guest` | `{search_id, user_id, to?, areas?, revoke?: true}` | `{guests}` (members and the owner) |
| POST | `/app/api/guest-message` | `{search_id, directory_id, text}` | `{ok, draft_id}` (a guest with `areas.contacts`; the entry's channel must be whatsapp or telegram): a draft kind `guest` |
| GET | `/app/api/useful?s=<search>` | | wave 6: `{country, city, verified, items: [Useful], pending: [Useful + can_decide], role, can_suggest, can_decide}` for the search's country + city: pack items and approved links; pending = my own suggestions (any search of that country) and, for the owner, everything suggested in this search. Guests: items only, read-only |
| POST | `/app/api/useful-suggest` | `{search_id, name, url, about?, category?}` | `{link}` (owner and members; 10 per hour): pending, or approved at once when the owner suggests; event `useful_suggested`; 409 `useful_exists`, 400 `bad_url` / `sensitive` |
| POST | `/app/api/useful-decide` | `{search_id, id, status: approved\|rejected}` | `{link}` (owner only, links suggested in this search); event `useful_decided` |
| GET | `/app/api/afisha?s=&day=&tab=all\|social&f=&seed=&d=` | `d` = comma list of pack area ids (district chips, wave 8.1; empty = "Рядом": the whole region by score with the distance penalty); `f` = comma list: ru, en, id, none (language: RU = ru or без слов, EN = en, mixed or без слов), free, paid, morning, day, evening, night, r10/r20/r40 (ring minutes), book (needs booking), beginner, today, bars, clubs, sport (Тусовки), c:<category> | wave 7: `{country, tz, today, day, tab, seed, filters, days: [{day, n}] (7 days), top: [Occurrence] (event of the day, up to 3, never something I marked не моё), items: [Occurrence], weekly: [{wd, title, key}] (Тусовки: recurring nights by weekday), area, home, total, districts (selected), areas: [{id, n}] (district chips with this week's counts, other filters applied), prefs: {nightlife, afisha, taste}}` (owner, members, viewers). Тусовки without a day = the coming week, a recurring night once |
| GET | `/app/api/event?s=&id=&occ=` | | `{occurrence, bookings: [Booking], excluded, parts, organizer: {name, channel, can_message}}`; an old day falls back to the next occurrence within 30 days; `{event: {…, past: true}, occurrence: null}` when there is none |
| GET | `/app/api/event-plan?s=` | | `{today, top: Occurrence \| null, total, bookings: [{id, event_id, occ, starts_at, status, title, place, who, guests}]}`: upcoming requested / drafted / asked / booked events (the home Plan card) |
| POST | `/app/api/event-feedback` | `{search_id, event_id, occ?, kind: like\|nope\|want\|bookmark\|attended, on?: bool, rating?: 1–5}` | `{ok, notified}` (owner and members; 300 per hour). like and nope exclude each other. `want` on: event `event_want` and one DM to the other members per person, event and day (quiet hours postpone it) |
| POST | `/app/api/event-book` | `{search_id, event_id, occ, who: [user ids], guests?: 0–10, kind?: join\|guest_list\|table\|slot, note?}` | 201 `{booking}` (owner and members; 30 per hour); the same day again updates who/guests. Event `event_book` for the agent. 400 `bad_who` / `bad_occ`, 409 `event_past` |
| POST | `/app/api/event-book-cancel` | `{search_id, booking_id}` | `{ok}`; a pending draft to the organizer is withdrawn (rejected); event `event_book_cancel` |
| POST | `/app/api/afisha-prefs` | `{search_id, nightlife?: bool\|null, afisha?: bool\|null, taste?: {age_band?: 18-24\|25-30\|31-40\|40+, interests?: [nightlife, sport, surf, culture, nature, food, wellness, music, creative, social]}}` | `{prefs}`: `members.nightlife` (0 = no bars, clubs or alcohol promos in my recommendations), `members.afisha` (the morning-digest line: NULL = on once the project has a home), `members.taste` |

Any other `/app/api/*` path (besides `/app/api/useful`, wave 6) answers 403 `{error: "guest"}` to a user who is only a guest.

**Public guest guide** (no auth): `GET /g/<token>` → an HTML page (noindex) with the house guide; `GET /g/<token>/photo` → the home's first photo. Members create, regenerate or revoke the token with `/app/api/guide-link`; a revoked or regenerated token stops working at once.

## Security

- Agent token is shown once at setup and stored by the MCP server in the OS keychain.
- Mini App requests are verified with `initData` HMAC (constant-time) and a 24 h max age.
- Web links (`POST /link`, agent token): `base64url("2|uid|exp|gen|sid|role").sig`, at most 30 days, signed with `LINK_SECRET`. A hunter gets a link for themself; a link for someone else needs `search_id` of a search the caller owns and is bound to that search and the person's current role there (it opens nothing else: every id a request names must belong to that search, otherwise 403 `link_scope`; it dies when the role changes or the member is removed). `gen` = `users.link_gen`: `/revoke` in the bot or `POST /app/api/revoke-links` kills every link (401 `link_revoked`).
- Photo token (`state.photo_token`, `?k=` on `<img>` URLs): `uid.day[.sid].sig` = HMAC of `photo|uid|day|gen|sid`, the same all UTC day (cacheable URLs), valid until the end of the next UTC day, scoped like the link it came from; it is never a session (`x-hunt-link` refuses it).
- Agent tokens are stored hashed; `tokens.revoked_at` (set by `/revoke`) disables them. `/setup` works once (409 `already_set_up` after an admin exists; a repeat before that retires the previous admin invite); secrets and signatures are compared in constant time.
- Media and documents are served with `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`; only whitelisted types (JPEG/PNG/WebP/HEIC, audio, PDF, MP4, GLB) are inline, anything else is an attachment. Uploads accept only those image/audio types.
- Agent-provided links (`source_url`, `map_url`, `photos[].url`, directory and guide map links) must be `http(s)://`. Ids passed with a search (draft/house contact/issue/expense/doc request `listing_id`, `contact_id`, viewing ids) must belong to the same search.
- Free tier guards: KV writes are counted per UTC day in D1 (`counters`): listing albums wait above 900 (429 `kv_budget`), nothing is written above 990; listing albums are one KV value (photos as slices) with a 180-day TTL. Per-user rate limits (D1 counters, per hour): uploads 60, doc sends 30, recap shares 10, useful-link suggestions 10, event feedback 300, event bookings 30, `/link` 60; public: `/g/` 300 per IP, `/setup` 10 per IP.
- Guests (wave 5) get only the areas they were given, only between `from` and `to`, enforced in the Worker on every request; never money, documents, the deal, threads, votes, drafts or listings. The negotiation helper is owner-only and never returns `budget_cap`.
- The house Wi-Fi password in the guide is the one deliberate exception to "no passwords": it is the house's, shown to members and guests with the guide area, never returned to the agent API.
- Never store passport numbers, card numbers or passwords. Contracts are summarized into document summaries and `deals.data` (checked by `sensitive()`); the files stay in Telegram (file_id only) and on the user's machine.

## Several hunters on one server

Each hunter (`/invite`) has their own projects, contacts, notes about people and dossiers; nobody sees another's. A listing id that another hunter already used is stored as `<id>--<search>` (the answer's `listing.id`); the short id keeps working for its owner. Shared on purpose: region packs, the events feed, average ratings of places and organizers, links approved by an admin. `/privacy` and `/delete` in the bot (`crm/src/account.ts`); admins are not deleted by the bot. Check: `npm run test:households`.

## Sharing a city (`/api/shares`)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/shares` | `{country, title, note?, author?, base?, hunter_asked?, files: [{path: 'regions/<country>/…(yaml\|md\|geojson\|svg)', content}], sources: [{section, entry}]}` (≤ 1 MB) | 201 `{id, status: 'asked', summary}`: the bot sends the hunter a card with the whole text in a file. Nothing leaves before "Отправить". `{status: 'off' \| 'declined'}` when the hunter does not want to be asked; `known: true` for the same content. 400 `bad_path` / `sensitive` / `nothing`, 404 `sources_off`, 409 `no_tg_user`; 20 a day |
| GET | `/api/shares` | | `{shares: [{id, country, title, status: asked\|declined\|off\|sent\|returned\|rejected\|approved\|merged, comment}]}` |

Registry: `POST /v1/proposals` (the server's key), `GET /v1/proposals?refs=`; admin `GET /admin/proposals[?status=]`, `GET /admin/proposals/:id`, `POST /admin/proposals/decide {id, status: approved\|returned\|rejected\|merged, comment?, seen?}` (`registry/src/inspect.ts` refuses code, hidden characters and foreign paths and flags texts that talk to agents, contacts and secrets). A server with `SOURCES_ADMIN_KEY` shows proposals to its admins in the bot.
