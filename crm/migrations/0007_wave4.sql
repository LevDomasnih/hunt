-- Wave 4: places (Google Maps lists + region pack), location score with scooter isochrones, bikes, 3D scans,
-- house dossier, things bought with the villa, flood risk. Additive only.

-- User places of a search (imported from Google Maps lists / My Maps / single place links, or added by the agent).
-- Base places come from the region pack (public/art/<country>/places.json) and are not stored here.
CREATE TABLE IF NOT EXISTS places (
  id            TEXT PRIMARY KEY,          -- 'pl_' + random
  search_id     TEXT NOT NULL REFERENCES searches(id),
  source        TEXT NOT NULL DEFAULT 'manual', -- google_list | my_maps | google_place | manual
  list_name     TEXT,                      -- the list / layer name (never the author)
  name          TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'other', -- pack type (beach, surf, coffee, food, ...) | nightlife | construction | other
  tier          INTEGER NOT NULL DEFAULT 2, -- 1 top, 2 good, 3 ordinary
  note          TEXT,
  address       TEXT,
  lat           REAL NOT NULL,
  lng           REAL NOT NULL,
  area          TEXT,                      -- districts.yaml area id | 'trip'
  url           TEXT,
  ext_key       TEXT,                      -- dedupe key from the importer (e.g. name + rounded point)
  hidden        INTEGER NOT NULL DEFAULT 0,
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS places_search ON places(search_id, area);
CREATE UNIQUE INDEX IF NOT EXISTS places_ext ON places(search_id, ext_key);

-- Scooter (car in KZ) isochrones per listing, computed agent-side (Valhalla): FeatureCollection, properties.ring = 5 | 10 | 30.
CREATE TABLE IF NOT EXISTS isochrones (
  listing_id    TEXT PRIMARY KEY REFERENCES listings(id),
  costing       TEXT NOT NULL,
  rush          REAL,
  geo           TEXT NOT NULL,
  at            TEXT NOT NULL
);

-- Which places / brief anchors fall in which ring: JSON {rings: {"5": [place ids], "10": [...], "30": [...]}, anchors: {anchor_id: 5|10|30|null}, at}.
-- Base place ids are 'b:<pack id>'. Recomputed when isochrones, places or anchors change.
ALTER TABLE listings ADD COLUMN location TEXT;

-- Flood risk: JSON {level: low|medium|high, summary, sources:[{kind: terrain|chats|notes|area, title, text}], terrain?, notes?:[{user_id, name, text, at}], at}.
ALTER TABLE listings ADD COLUMN flood TEXT;

-- Bike rentals.
CREATE TABLE IF NOT EXISTS bikes (
  id            TEXT PRIMARY KEY,          -- 'bk_' + random
  search_id     TEXT NOT NULL REFERENCES searches(id),
  model         TEXT NOT NULL,
  plate         TEXT,
  rider_id      TEXT REFERENCES users(id), -- NULL = shared
  price         INTEGER,
  currency      TEXT,
  period        TEXT NOT NULL DEFAULT 'month', -- month | week | day
  paid_until    TEXT,                      -- YYYY-MM-DD
  deposit       TEXT,                      -- what was left: "passport copy", "1 000 000 IDR" (never the original passport, never numbers)
  rental_name   TEXT,
  channel       TEXT,                      -- whatsapp | telegram | phone
  address       TEXT,                      -- number or @handle
  phone         TEXT,
  checklist     TEXT,                      -- JSON {video|helmets|stnk|fuel: {done, note}}
  status        TEXT NOT NULL DEFAULT 'active', -- active | returned
  date_from     TEXT,
  return_date   TEXT,
  note          TEXT,
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bikes_search ON bikes(search_id, status);

-- 3D scans (move-in act, move-out, bikes). The file is a document (kind 'scan', Telegram file_id only).
CREATE TABLE IF NOT EXISTS scans (
  id            TEXT PRIMARY KEY,          -- 'sc_' + random
  search_id     TEXT NOT NULL REFERENCES searches(id),
  listing_id    TEXT REFERENCES listings(id),
  bike_id       TEXT REFERENCES bikes(id),
  room          TEXT NOT NULL,
  phase         TEXT NOT NULL DEFAULT 'movein', -- movein | moveout | bike
  status        TEXT NOT NULL DEFAULT 'ok',     -- ok | redo | todo
  note          TEXT,
  doc_id        TEXT REFERENCES documents(id),
  app           TEXT,                      -- Scaniverse | Polycam | …
  sort          INTEGER NOT NULL DEFAULT 0,
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS scans_search ON scans(search_id, phase);

-- House dossier, instance-wide (like people notes): one per property.
CREATE TABLE IF NOT EXISTS dossiers (
  id            TEXT PRIMARY KEY,          -- 'ds_' + random
  title         TEXT NOT NULL,
  area_text     TEXT,
  lat           REAL,
  lng           REAL,
  owner_contact_id TEXT REFERENCES contacts(id),
  owner_identity TEXT,                     -- normalized identity of the owner ('phone:+62…')
  listing_ids   TEXT,                      -- JSON [listing ids] across searches
  verdict_title TEXT,
  verdict       TEXT,
  stats         TEXT,                      -- JSON {months, price, currency, price_note, issues}
  updated_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS dossiers_owner ON dossiers(owner_identity);
CREATE TABLE IF NOT EXISTS dossier_items (
  id            TEXT PRIMARY KEY,          -- 'di_' + random
  dossier_id    TEXT NOT NULL REFERENCES dossiers(id),
  kind          TEXT NOT NULL DEFAULT 'other', -- issue | power | cleaning | conflict | good | money | other
  title         TEXT NOT NULL,
  text          TEXT,
  sentiment     INTEGER NOT NULL DEFAULT 0,
  date          TEXT,
  search_id     TEXT REFERENCES searches(id),
  author        TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS dossier_items_d ON dossier_items(dossier_id, created_at);

-- Things bought for the house (resold at move-out).
CREATE TABLE IF NOT EXISTS items (
  id            TEXT PRIMARY KEY,          -- 'it_' + random
  search_id     TEXT NOT NULL REFERENCES searches(id),
  listing_id    TEXT REFERENCES listings(id),
  name          TEXT NOT NULL,
  price         INTEGER,
  currency      TEXT,
  seller        TEXT,                      -- "Наталья" (from whom)
  bought_at     TEXT,                      -- YYYY-MM-DD
  photo         TEXT,                      -- KV key 'i/<search>/<user>-<ts>'
  icon          TEXT,
  status        TEXT NOT NULL DEFAULT 'have', -- have | offered | sold
  sold_price    INTEGER,
  resale_target INTEGER,
  note          TEXT,
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS items_search ON items(search_id, status);
