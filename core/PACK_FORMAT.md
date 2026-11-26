# Region pack format

A region pack teaches the Hunt agent how renting works in one country, and then in a city and district inside it. Packs hold data and knowledge only, no core code. Lower levels override upper ones: country → city → district.

Scope: long-term and mid-term **residential rental** (1–12+ months) for foreigners and locals. No buying.

## Layout

```
regions/<country>/
  pack.yaml          # machine-readable: currency, languages, fields, questions, terms, flags
  rules.md           # rental law and official requirements, with sources
  market.md          # market reality, customs and etiquette
  contract.md        # lease review checklist for this country
  scam.md            # scam check before viewings and money: red flags, verification steps, owner documents
  checklist.yaml     # on-site viewing checklist members tick in the Mini App
  sources.yaml       # where listings are and where to post requests, per city
  places.yaml        # base points of interest for the location score (wave 4)
  calendar.yaml      # local days and seasons that change daily life (wave 4)
  districts.yaml     # areas (+ districts.geojson outlines), emergency.yaml, visa.md (wave 3)
  useful.yaml        # "Полезное": chats, apps, guides and maps people living there use (wave 6)
  events.yaml        # optional "Афиша": photo effects per topic/category + event sources that are not chats (wave 7), party rules (wave 9)
  art/               # the look: theme.yaml, avatars/ (8 animals), toys/ (rendered), motif-mark.svg, motif-scene.svg, island.webp (skill hunt-art)
  templates/<lang>/  # message templates
    first_contact.md
    follow_up.md
    ask_details.md
    negotiate.md
    schedule_viewing.md
    running_late.md
    decline.md
    cancel_viewing.md
    found_place.md
  <city>/
    pack.yaml        # districts with aliases and centers, price references, travel, city overrides
    market.md        # optional, city specifics
    useful.yaml      # optional, city chats on top of the country list (wave 6)
    events.yaml      # optional, city effect overrides and event sources (wave 7)
regions/_generic/
  events.yaml        # core Афиша defaults (effects table, party rules), merged under every country
```

Folder names are lowercase ASCII slugs: `bali`, `bali/bukit`, `kz/almaty`, `th/bangkok`, `th/phuket`. "Bali" is treated as a country-level pack for practical reasons. Indonesia-wide law goes into its `rules.md`.

## pack.yaml (country)

```yaml
id: th                     # slug
name: {en: Thailand, ru: Таиланд}
currency: THB
languages:                 # languages to write to landlords/agents, in order of usefulness
  - {code: en, note: "agents and most condo owners"}
  - {code: th, note: "local owners of houses"}
  - {code: ru, note: "Phuket/Pattaya Russian-speaking agents"}
timezone: Asia/Bangkok
owner_docs: {en: "the title deed (Chanote / อ.ช.2) and the owner's ID", ru: "чанот (อ.ช.2) и ID-карту хозяина"}  # one line: what to ask the owner for (Mini App button "Ask the owner for documents")
units: {area: m2, price_period: month}
listing_fields:            # fields added to every listing card in this country
  furnished: {type: enum, values: [full, partial, none]}
  utilities_billing: {type: enum, values: [gov_rate, owner_rate, included], note: "..."}
brief_questions:           # extra questions for the search brief
  - {id: property_type, text: {en: "...", ru: "..."}, options: [condo, house, townhouse]}
typical_terms:
  min_term: "..."
  deposit: "..."
  advance: "..."
  agent_fee: "who pays, how much"
  utilities: "..."
  payment_methods: [bank_transfer, cash]
red_flags:                 # phrases or situations that mean "skip" or "careful"
  - {pattern: "...", why: "..."}
scams:                     # common scams with how to avoid
  - {name: "...", how_to_avoid: "..."}
legal_flags:               # things the agent must check or warn about; details in rules.md
  - {id: tm30, text: "...", when: "after move-in"}
season_months: {high: [11, 12, 1, 2, 3], low: [5, 6, 7, 8, 9, 10], wet: [5, 6, 7, 8, 9, 10]}   # wave 5, one line
location: {rings: [10, 20, 40], weights: [1.0, 0.7, 0.3]}   # wave 5, one line: location score rings
verified: 2026-11          # month when the facts were checked
drive: scooter             # optional: scooter (default) | car — how people get around; the default for travel times and isochrones
rooms: total               # optional: homes are counted by rooms ("2-комн."), not bedrooms
homes: villas              # optional: what people look at, for the project line
housing_ads: {mode: friends_only, relet: plain_with_consent, note: {en: "...", ru: "..."}}   # optional, one line. mode (roommate / room offers): public | friends_only (only private messages to people the members know). relet (the whole place for the rest of the lease): public | plain_with_consent (post only after the owner agrees, worded as a normal rental, no re-let / sublet words) | friends_only. The agent and the Mini App re-let screen follow it
```

`season_months` (wave 5, optional): month numbers 1-12 for the rental high and low season and the wet season, derived from the pack's `seasons:` prose / `market.md`. Include only keys you can justify (`wet` may be left out, shoulder months stay out). Exported to `regions.json` as `<country>.seasons: {high, low, wet}` (missing keys → `[]`, no key → `null`) for the CRM negotiation helper.

`location` (wave 5, optional, one line; a city pack may override it): the location score's travel-time rings in whole minutes (ascending) and one weight 0-1 per ring. Default (also when the key is missing or invalid): `{rings: [10, 20, 40], weights: [1.0, 0.7, 0.3]}`. The agent computes free-flow isochrones at exactly these minutes (`location_refresh`; the city's `travel.rush_factor` is only shown as a rush-hour note), and the CRM weighs a place inside a ring by its weight. Exported to `regions.json` as `<country>.location: {rings, weights}` (a city pack's own key as `<country>.sub.<city>.location`). Changing the rings makes every stored isochrone stale until the agent recomputes it.

## <city>/pack.yaml

```yaml
id: bangkok
name: {en: Bangkok, ru: Бангкок}
center: [13.7563, 100.5018]
travel: {mode: bts_taxi, avg_kmh: 15}
districts:
  sukhumvit: {name: {en: Sukhumvit, ru: Сукхумвит}, aliases: [Asok, Phrom Phong, Thong Lo], center: [13.737, 100.560], note: "expats, BTS"}
price_ref:                 # monthly, local currency, typical range for a decent option
  studio: "12k–20k"
  1br: "18k–35k"
  2br: "30k–60k"
  note: "Portal sample Nov 2026: 2BR median 38k (n=40)"   # optional; "<N>BR median <X>" is machine-read
overrides:                 # optional, same keys as country pack
  typical_terms: {deposit: "..."}
sources: {}                # optional, or keep everything in country sources.yaml
```

`price_ref` is exported to `regions.json` (wave 5) as `<country>.sub.<city>.price_ref: {currency, basis, beds: {"1": [lo, hi], …}, median: {"2": n}}`, numbers in main currency units: keys `1br/2br/3br` (bedrooms), `1k/2k/3k` (Kazakh room count, `basis: "rooms"`), `studio` → `"0"`; the value's first `lo-hi` range is used (`10M-18M`, `190k–300k (…)`; `k` = thousand, `M` = million), the rest of the text is for people. `median` comes from the `note` when it says `<N>BR median <X>`. The CRM negotiation helper uses it as the market fallback when it has seen fewer than 5 comparable listings, so keep the first range in each value the typical decent option.

## rules.md

For the agent, in English, concise and practical. Sections:

1. Legal basis: which law governs residential leases; any special consumer protection rules.
2. Contract: written/oral, language, notarization or registration requirements, stamp duty.
3. Deposit and advance: norms vs legal limits, legal deadline for return, allowed deductions.
4. Foreigners: registration of residence (who does it, deadline, penalty), visa or permit links (for example, a lease needed for a residence permit).
5. Taxes and fees the tenant may be asked about (who legally pays).
6. Utilities: legal rates vs owner markups.
7. Termination: notice periods, early exit, eviction protections.
8. Subletting: what is legal, what to check (owner consent, master lease term).
9. Short-term rental restrictions (for example, a minimum of 30 days in condos).
10. What to check before paying (ownership documents, ID of the landlord, agent licensing).

Every non-obvious claim gets a source link and a date. Mark unverified claims `(unverified)`. Say so when rules differ by city.

## market.md

Seasons and price swings, how fast good places go, typical negotiation (what is negotiable, realistic discount), etiquette and tone (formal/informal, emoji, response time), common listing jargon with meaning, how viewings usually happen, agent vs owner landscape, payment habits (cash, transfer, upfront months).

## contract.md

Checklist of items to verify in a lease in this country, ordered by risk. Each item has: what to look for, a good version, a red flag. Include a move-in checklist (inventory, meter readings, photos/video, keys, contacts) and a move-out checklist (notice, inspection, deposit return).

## scam.md

The scam check the agent runs on a listing before proposing a viewing and before any money moves; the result goes to the CRM with `listing_checks_set` (verdict `ok | caution | danger` + signals `ok | warn | todo`) and shows on the listing screen. Sections:

1. Verdict: what ok / caution / danger mean for the humans.
2. Red flags for this country (prepayment or booking fee before viewing, price far below the district median, the same photos under another agent or price, owner "abroad", payment to a third party or crypto, no video call, pressure, name mismatch).
3. Verification steps, one signal each: duplicates across agents, portals and chats; reverse image search; price vs district median (city `price_ref`, `market.md`); prepayment asked before viewing; owner documents.
4. Owner documents: what proves the right to rent in this country (Bali: SHM/HGB land certificate + owner KTP; Kazakhstan: fresh certificate of registered rights + ID; Thailand: Chanote / อ.ช.2 + owner ID) and how to match names. The agent never stores ID numbers.
5. What the agent writes in the CRM (short signals, hunter's language, no ID/card numbers) and 1–2 polite messages asking for documents in the local languages.

## checklist.yaml

The on-site viewing checklist: each member ticks ok / not ok and adds a short note in the Mini App; the agent reads the results in `ratings_get` (`onsite`). 8–10 items, one item per 4 lines (a tiny line parser reads it):

```yaml
items:
  - id: water_pressure
    icon: droplets
    label: {en: "Water pressure and hot water", ru: "Напор и горячая вода"}
    hint: {en: "Open the shower and the kitchen tap for a minute", ru: "Включи душ и кран на кухне на минуту"}
```

Double-quote `label`/`hint` values. `icon` is a lucide icon name from this list (the Mini App ships only these): droplets, cloud-rain, air-vent, wifi, car, hard-hat, dog, plug, zap, flame, thermometer, shower-head, bug, sun, volume-2, key, lock, waves, trees, refrigerator, washing-machine, bed, utensils, trash-2, shield, signal, fan, heater, building, wind, house.

## sources.yaml

```yaml
portals:
  - {name: DDproperty, url: https://www.ddproperty.com, cities: [bangkok, phuket], type: portal, contact: "in-site form + phone", note: "..."}
telegram:
  - {handle: "@...", title: "...", cities: [phuket], lang: ru, note: "..."}
facebook_groups:
  - {name: "...", url: "...", cities: [...]}
whatsapp_communities: []
agencies:
  - {name: "...", url: "...", cities: [...], note: "..."}
post_request_where: ["..."]   # where posting "looking for a place" works
guides:   # optional: the main forums and guides to start from, in English, Russian and the local language
  - {name: "...", url: "https://...", kind: forum, lang: en, cities: [...], note: "what it is, activity or date, checked YYYY-MM-DD"}
```

List only sources that exist and are active as far as you can verify; mark the others `(unverified)`.

`guides` (optional): forums and Q&A communities (`kind: forum | qa`), long-term renting guides (`guide`) and pages that list chats and groups (`group_list`); `lang` is the language of the page (`en`, `ru`, the local code or `multi`). They are public pages: the agent reads them as a starting point and checks any chat they name before using it.

A `telegram` entry may carry `events: true` (wave 7): the agent also reads that chat, read-only, for local events (see `events.yaml` below).

## templates/<lang>/*.md

Short, human, chat-style messages. Placeholders in `{curly}`: `{name}`, `{listing_ref}`, `{move_in}`, `{term}`, `{bedrooms}`, `{who}`, `{budget_said}`, `{date}`, `{time}`, `{minutes}`. No em dashes, no numbered questionnaires, 1–2 questions per message. Several variants per file are welcome, separated by `---`.

## places.yaml (optional, country or city level)

Curated base set of points of interest for location scoring. Hunt scores a listing by what is reachable on a scooter (or the region's usual transport) within the pack's rings (`location.rings`, 10/20/40 minutes free-flow by default); each place contributes `type weight × tier weight × ring weight`. The user's own map lists (Google Maps saved places) are layered on top, so the base set focuses on what such lists usually lack: beaches, surf, coworking, gyms, yoga, groceries, markets, medical. Coffee and food appear only as a few tier-1 landmarks per area.

```yaml
version: 1
types:                      # type key -> defaults
  beach: {weight_default: 1.0, emoji: "🏖"}
  surf: {weight_default: 1.0, emoji: "🏄"}
  daytrip: {emoji: "🗺", scored: false}   # shown on the map, not scored
places:
  - id: melasti-beach       # kebab-case, unique within the file
    name: Melasti Beach     # latin display name
    type: beach             # key from `types`
    tier: 1                 # 1 = must-know/top (1.0), 2 = good (0.6), 3 = ordinary (0.3)
    area: ungasan           # region-defined area key; `trip` = outside the living areas
    lat: -8.84823           # WGS84, verified (OpenStreetMap Nominatim/Overpass)
    lon: 115.15763
    note_ru: "Белый песок, бирюза, к вечеру людно"   # <= 60 chars
    note_en: "White sand, turquoise water, busy at dusk"
    tags: [sunset, swim]    # optional; surf: level-beginner|level-intermediate|level-advanced, reef|beach-break
    osm: "relation/9754137" # optional source OSM object (<osm_type>/<osm_id>)
  - id: surf-kuta-beach
    type: surf
    # … same keys …
    faces: 256              # surf only (wave 5): compass degrees the beach faces
```

`faces` (surf only, optional): the seaward normal of the coastline at the access point, integer degrees 0-359 (west-facing beach = 270); wind blowing from `faces + 180` is offshore. Derive it from the OSM coastline (`way["natural"="coastline"]` near the spot, length-weighted bearing of the segments within ~300 m + 90°, since OSM keeps land on the left of the way); leave it out where the coast is ambiguous (points, headlands, river mouths). The CRM surf forecast (Open-Meteo marine + wind) rates each spot by its `level-*` tag (wave height against the level) and `faces` (offshore / cross / onshore wind).

Optional per type: `k` (saturation constant of the location score, default 1.5). The Mini App build (`crm/scripts/copy-art.mjs`) turns the file into `/art/<country>/places.json` (`{types, places:[{id, name, type, tier, area, lat, lng, note:{ru,en}, tags, faces?}]}`, area aliases `kuta → kuta_legian`, `nusadua → nusa_dua`); the Worker scores listings with it (ids `b:<id>`), the user's imported Google Maps places come on top (×1.5, a base place the user also saved counts once).

Rules: only real, currently operating places; coordinates verified against a map source within ~300 m, never guessed (offshore surf breaks use the beach or access point they are reached from); notes short and human. Each area key the region uses should have at least a beach, market or supermarket. Mark the data licence in the file header (OSM data is ODbL).

## Life in the house: districts, emergency, visa, power (wave 3)

These files are read by a tiny line parser (Mini App build, `crm/scripts/copy-art.mjs`) as well as by PyYAML, so they use a strict subset: 2-space block mappings, block lists whose items are one-line flow maps (`- {...}`), every value on one line, free text in double quotes (use «» inside Russian text), comments only on their own line, no multi-line strings.

### districts.yaml + districts.geojson (country level)

Areas for the Mini App "Districts" map mode and for the agent (`region_districts`). Area ids are lowercase slugs and valid `brief.districts` values; reuse a city-pack district slug when the area equals one district.

```yaml
verified: 2026-11
areas:
  canggu:
    name: {en: "Canggu", ru: "Чангу"}
    group: {en: "South-west coast", ru: "Юго-запад Бали"}   # one line "where", the kicker on the area screen
    city: canggu                                           # city sub-pack folder
    districts: [canggu, berawa, batu_bolong]               # city-pack district slugs inside the area
    center: [-8.645, 115.138]
    tags: {en: ["parties", "surf", "cafes"], ru: ["тусовки", "серф", "кафе"]}
    vibe: {en: "2-3 human sentences …", ru: "2–3 живых предложения …"}
    scores: {surf: 5, quiet: 1, no_traffic: 1, food: 5, coworking: 5, nightlife: 5}   # integers 1-5, exactly these keys
    airport_min: 45          # off-peak by car to the main airport
    ocean_min: 5             # to the nearest good beach (omit inland)
    price: {"2": [25000000, 35000000], "3": [35000000, 50000000]}   # monthly market fallback per bedrooms (KZ: rooms)
    pros: {en: ["…", "…", "…"], ru: ["…", "…", "…"]}   # ≤ 4 words each
    cons: {en: ["…", "…", "…"], ru: ["…", "…", "…"]}
    osm: ["Canggu (desa, Kuta Utara) R…"]              # boundary sources
    flood: {level: high, note: {en: "…", ru: "…"}}     # optional (wave 4): area default for the flood-risk card, low | medium | high
```

`districts.geojson`: a minified FeatureCollection, one feature per area, `properties: {id, name_en, name_ru}`, Polygon/MultiPolygon from OSM admin polygons (Nominatim `polygon_geojson=1`, generic User-Agent, ≤ 1 request/s), several villages unioned per area, simplified and rounded to 5 decimals, < 300 KB per country. The Mini App assigns listings to areas by point-in-polygon (else by `districts`), computes the price range from CRM listings (≥ 3 with the brief's bedrooms, else `price`) and "% for your brief" from the brief priorities against `scores`.

### emergency.yaml (country level)

```yaml
verified: 2026-11
numbers:
  - {id: ambulance, phone: "119", label: {en: "Ambulance", ru: "Скорая"}}
  - {id: police, phone: "110", label: {en: "Police", ru: "Полиция"}}
  - {id: tourist_police, phone: "+62 361 224111", label: {en: "Tourist police", ru: "Туристическая полиция"}}
power: {name: "PLN", phone: "123", label: {en: "Power cut", ru: "Отключили свет"}, note: {en: "…", ru: "…"}}
places:
  - {id: bimc_nusa_dua, kind: hospital, name: "BIMC Hospital Nusa Dua", city: bukit, lat: -8.7989, lng: 115.2284, phone: "+62 361 3000911", hours: "24/7", note: {en: "…", ru: "…"}}
```

`kind`: hospital | clinic | pharmacy; `city` = the city sub-pack. Coordinates verified on OSM; omit `phone` rather than guess. The Mini App "Important" screen shows the nearest hospital and pharmacy to the home (straight line × road factor), the numbers, the power line and the house owner.

### visa.md (country level)

Short practical rules: common long-stay visas, how and where to extend, the lead time, overstay penalties, and "what the agent tells the hunter". Sources with dates, `(unverified)` where unsure. Members only ever enter their visa expiry **date**; never passport or visa numbers.

### pack.yaml keys

Country `pack.yaml`, each on one line:

```yaml
power: {prepaid: true, tokens: {en: "PLN Mobile app or Indomaret near home …", ru: "Приложение PLN Mobile или Indomaret у дома …"}, tariff_kwh: 1700, currency: IDR, outage_phone: "123", note: {en: "…", ru: "…"}}
visa: {extend_lead_days: 14, remind_days_before: 7, note: {en: "…", ru: "…"}}
```

`power.prepaid` = token meters (the "Power" screen reads balances from meter photos); `tokens` = where to buy / how bills are paid; `tariff_kwh` estimates the monthly cost. `visa.extend_lead_days` = apply this many days before expiry; the bot reminds `remind_days_before` days before that date.

City `pack.yaml` `travel:` gets `rush_factor` (e.g. `travel: {mode: scooter, avg_kmh: 18, rush_factor: 1.5, note: "…"}`): the agent multiplies off-peak route times (Valhalla, `travel_times_refresh`) by it for the "Your places" screen. Since wave 5 the location-score isochrones are free-flow (see `location` above); `rush_factor` only adds the "in rush hour roughly +30%" note there.

## calendar.yaml (country level, wave 4)

Local days that change daily life for tenants (closures, curfews such as Nyepi, alcohol bans, water fights, staff days off) and seasons. Same strict YAML subset as the wave 3 files (one-line flow items). The Mini App merges it with the lease dates, bikes and visas in the Plan tab; the bot reminds members `remind[].days` before an event (once, after 08:00 local, outside quiet hours) while the search is `found` / `living` and the lease covers the date.

```yaml
verified: 2026-11
events:
  - {id: nyepi_2027, date: "2027-03-08", kind: holiday, impact: high, title: {en: "Nyepi, the day of silence", ru: "Ньепи — день тишины"}, note: {en: "…", ru: "…"}, remind: [{days: 2, title: {en: "Stock up for Nyepi", ru: "Запастись на Ньепи"}, note: {en: "…", ru: "…"}}], alt: {en: "…", ru: "…"}}
  - {id: songkran_2027, date: "2027-04-13", to: "2027-04-15", kind: festival, impact: high, title: {…}, note: {…}}
seasons:
  - {id: rainy, from: "11-01", to: "04-30", title: {en: "Rainy season", ru: "Сезон дождей"}, note: {en: "…", ru: "…"}}
```

`kind`: holiday | ceremony | festival; `impact`: low | medium | high (high shows in the accent colour); `to` = the last day of a multi-day event; `alt` = a footnote when sources disagree on the date. Only dates from an official or clearly reliable calendar; lunar and Balinese pawukon dates move every year, so list concrete dates per year and say in the header where they come from. `seasons[].from/to` are `MM-DD`.

## useful.yaml (country, optional city; wave 6)

"Полезное" in the Mini App: Telegram chats and channels, apps, guides and maps that people living in the region actually use. Shown to every search of that country (city items only to searches in that city), together with the links members suggested and the agent or a search owner approved (CRM table `useful_links`, see `core/API.md`). Same strict YAML subset as the wave 3 files (one-line flow items, free text in double quotes).

```yaml
verified: 2026-11-20       # the day the list was last checked
items:
  - {id: tg-arendabali, name: "Вместе на Бали · жильё", url: "https://t.me/arendabali", kind: telegram, category: chats_rent, about: {ru: "много свежих вилл каждый день", en: "lots of fresh villas every day"}, lang: ru, last_checked: "2026-11-20", activity: {members: 8464, at: "2026-11-20"}}
  - {id: app-pln-mobile, name: "PLN Mobile", url: "https://play.google.com/store/apps/details?id=com.icon.pln123", kind: app, category: apps, icon: zap, about: {ru: "купить токены на свет", en: "buy power tokens"}, lang: id, last_checked: "2026-11-20"}
  - {id: web-baliforum-places, name: "Балифорум · места", url: "https://bali.live/places", kind: web, category: guides, icon: book-open, about: {ru: "каталог мест с отзывами", en: "places catalog with reviews"}, lang: ru, attribution: "Балифорум (bali.live)", last_checked: "2026-11-20"}
  - {id: hunt-places, name: "Наша подборка мест", url: "hunt:spots", kind: hunt, category: maps, icon: map, about: {ru: "{n} мест + ваши списки из Google", en: "{n} places + your Google lists"}, lang: multi}
```

- `id`: kebab-case, unique within the country (a city item with the same id replaces the country one in that city). The agent annotates an item by this id (`useful_annotate`), so keep ids stable.
- `kind`: `telegram` (a `https://t.me/<handle>` link; the Mini App opens it in Telegram), `app` (an official site or a store page), `web` (a site), `hunt` (a Hunt screen: `hunt:spots` = our places layer; `{n}` in `about` becomes the number of places).
- `category`: `chats_rent` (rentals), `flea` (flea market), `bikes`, `news` (news and rules, the main community chat), `visas`, `medicine`, `food`, `apps`, `guides`, `maps`, `other`. The Mini App groups by kind (Telegram / Apps / Guides and maps) and filters Все / Чаты / Приложения / Гайды / Карты.
- `name`: the chat's or app's own name, shortened honestly (no invented titles). `about`: what it is for, a few words, ru + en. `lang`: the language people write in (`ru`, `en`, `id`, `th`, `kk`, `multi`). `icon` (optional): a lucide name the Mini App ships (e.g. `bike`, `car`, `zap`, `pill`, `stamp`, `shopping-cart`, `wallet`, `house`, `map`, `book-open`); default by kind.
- `last_checked`: only the day someone actually checked the link (opened the public t.me page, the site answered); leave it out otherwise. `activity` (optional): `{members, per_day, at}` from a read-only look (the public t.me preview or the Telegram MCP's `tg_resolve` / `tg_history` without joining); never join a group or post to measure it.
- `events: true` (optional, wave 7 "Афиша"): the agent also reads this chat or site for local events in its daily sweep. Telegram is read only: chats the hunter's account is already in or public channels readable without joining; never join, post or react. Only `telegram` and `web` items make sense here.
- `attribution`: required for external guides and catalogs. Third-party guides, maps and catalogs are **links only**: the agent may read them as a source when answering a question and links back; it never scrapes or bulk-copies them into Hunt. Importing someone else's map or catalog (as places, a layer, a list) needs its owner's permission.

`crm/scripts/copy-art.mjs` exports the country file and its city files to `/art/<country>/useful.json` (`{verified, items: [{id, city, name, url, kind, category, about, lang, last_checked, activity, events, attribution, icon}]}`, items with a bad id or a non-https link are skipped with a warning). The Worker merges it with `useful_links` in `GET /app/api/useful`; the client never reads the file directly.

## events.yaml (country, optional city; wave 7, wave 9)

"Афиша": the daily curated events feed. The file holds data that is not an event: which live effect an event photo may carry, and the event sources that are not chats. Events themselves live in the CRM (`POST /api/events`, see `core/API.md`); Telegram event sources are the `useful.yaml` / `sources.yaml` items flagged `events: true`. Same strict YAML subset as the wave 3 files.

`regions/_generic/events.yaml` holds the core defaults; `regions/<country>/events.yaml` and `<country>/<city>/events.yaml` override them key by key (city wins). A country without a file gets the defaults.

```yaml
effects:                       # key = event topic or category -> shader, or {shader, mix}
  kecak: embers
  sea: {shader: caustics, mix: 0.35}
  bar: neon
  workshop: none               # explicitly no effect
sources:
  - {id: uluwatu-temple-kecak, name: "Uluwatu Temple · Kecak & Fire Dance", url: "https://www.openstreetmap.org/way/707659668", kind: place, city: bukit, area: uluwatu, topics: [kecak, fire_show, temple], recurring: "daily at sunset, about 18:00-19:00", lang: none, note: "places.yaml trip-uluwatu-temple"}
  - {id: potato-head, name: "Potato Head Beach Club", url: "https://www.potatohead.co", kind: venue, city: canggu, topics: [beach_club, dj], events_url: "https://www.potatohead.co/events", read: jsonld, note: "(unverified) no fixed weekly night recorded"}
  - {id: megatix-bali, name: "Megatix · Bali events", url: "https://megatix.co.id", kind: ticket, topics: [club, festival], read: list, note: "(unverified) open event pages one by one"}
party:                         # wave 9 "Своя тусовка": local rules for a party at the house
  quiet_after: "22:00"
  hint_ru: "На Бали после 22:00 принято тише …"
  hint_en: "In Bali keep it down after 22:00 …"
  notice_owner: true
  notice_neighbours: true
  fines_ru: "Банджар может оштрафовать за шумную вечеринку …"
  fines_en: "The banjar can fine a noisy party …"
```

- `effects`: key = a topic slug (`^[a-z_]{2,30}$`, e.g. `kecak`, `snorkel`, `padel`) or a category (`culture`, `nature`, `sport`, `dance`, `music`, `food`, `workshop`, `party`, `wellness`, `kids`, `other`, `bar`, `club`, `beach_club`, `social_sport`, `meetup`, `quiz`). The Worker looks up the event's topic first, then its category; unknown → no effect. Value: a shader name or `{shader, mix}` with `mix` 0..1 (overlay strength, default 1). Shaders (`design/shaders/<name>.glsl`, premultiplied alpha): `embers`, `caustics`, `bokeh`, `foam`, `mist`, `rays`, `droplets`, `steam`, `smoke`, `grain`, `confetti`, `stars`, `fireflies`, `neon`, `floodlight`; `none` = explicitly no effect (overrides a default and stops the topic → category fallback). One effect per photo: a content moment, never chrome decoration. A new topic is a one-line change.
- `sources` (optional): venues, places and sites the agent checks in the daily sweep: `{id (kebab-case, unique), name, url (https), kind: venue | instagram | facebook | web | place | ticket, city?, area?, topics?: [..], recurring?: "what was verified", name_ru?, recurring_ru?, starts?: "HH:MM", lang?, note?, events_url?, read?}`. A verified `recurring` source also fills an empty Афиша as a placeholder ("каждый день"): `name_ru` / `recurring_ru` are the Russian title and schedule line for it, `starts` the usual start time. Links with attribution only: the agent opens the venue's own page or post one at a time and cites it (`source_url`, `source_name`); it never bulk-scrapes or copies a third-party catalog. `recurring` only for a schedule actually verified from the venue's own material; everything else says `(unverified)` in `note`, and the agent confirms the night from recent posts before sending a recurrence. Never invent a weekly night.

- Organizer / venue / ticket pages (wave 9): `events_url` (optional, https) = the page that LISTS the events when it differs from `url`; `read` (optional) = how the agent reads it with `event_source_read`: `jsonld` (schema.org `Event` JSON-LD, the default expectation), `og` (one event per page from its og: tags), `list` (a listing page: candidate event links on the same site, opened one by one), `ics` (an iCalendar feed). `kind: ticket` = a ticket platform's listing for the region (megatix, Resident Advisor …): links to the event pages, never a catalog to copy; the organizer's own page wins when both exist. Items with `read` come first in the sweep and their exact date, time and line-up beat chat posts. Reading is polite by design: robots.txt and noindex honoured (UA `HuntBot/1.0 (+read-only)`), ≤ 1 request/s per host, a 6 h cache, one page per call, public https only. A site that refuses bots (403) stays listed with that fact in `note`; the agent then uses the venue's own posts. Event photos from these pages are linked, not stored (`photo_url` + credit, see `core/API.md`).
- `party` (optional, wave 9 "Своя тусовка"): local rules for a party at the house, shown as a hint on the party screen and used for the default owner/neighbour notice: `{quiet_after: "HH:MM", hint_ru, hint_en, notice_owner: bool, notice_neighbours: bool, fines_ru?, fines_en?}`. `regions/_generic/events.yaml` holds the defaults (quiet after 23:00, warn the owner); a country file overrides it key by key (a city file's `party` is ignored with a warning: the rules are per country). Only what is known locally and honestly worded: "the banjar can fine a noisy party", never invented amounts or rules.

`crm/scripts/copy-art.mjs` merges the files and exports `<country>.events = {effects: {key: {shader, mix} | null}, sources: [{id, name, url, kind, city, area, topics, recurring, name_ru, recurring_ru, starts, lang, note, events_url, read}], party: {quiet_after, hint_ru, hint_en, notice_owner, notice_neighbours, fines_ru?, fines_en?} | null}` into `public/art/regions.json` (`null` = `none`; unknown shaders, bad keys and bad sources are skipped with a warning; a non-https `events_url`, an unknown `read` and bad `party` keys are dropped with a warning). The Worker resolves each event's `effect` from it and reads `events.party` for the party hint and the notice default text.
