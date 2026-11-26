-- Wave 3: move-out, people notes, rent split by rooms, shared budget, power tokens, visa dates, places near (travel times),
-- re-let of the remaining term, contacts directory. Additive only.

-- Travel times from the listing to the brief anchors, computed agent-side (Valhalla, rush-hour factor):
-- JSON {<anchor_id>: {min, km, mode, at}}.
ALTER TABLE listings ADD COLUMN travel TEXT;

-- Rent split by rooms: JSON {rooms:[{id, name, user_id|null (shared), share (percent)}], others_equal: bool}.
-- Rent expenses without their own split follow the room shares; others are equal (others_equal) or follow searches.shares.
ALTER TABLE searches ADD COLUMN rooms TEXT;

-- 'split' (default: balances, settle up, shares) | 'shared' (one common wallet: totals and the expense list only).
ALTER TABLE searches ADD COLUMN money_mode TEXT NOT NULL DEFAULT 'split';

-- Custom groups of the contacts directory: JSON [{key, name}] (built-in: home, bikes, food, services, health).
ALTER TABLE searches ADD COLUMN dir_groups TEXT;

-- Visa expiry DATE only (YYYY-MM-DD). Never a passport or visa number. Visible to the member and the search owner.
ALTER TABLE members ADD COLUMN visa_until TEXT;

-- Notes about owners / agents, shared across the whole instance (every search), keyed by a normalized identity
-- ('phone:+62…', 'telegram:@x', 'facebook:123', 'contact:<id>').
CREATE TABLE IF NOT EXISTS people_notes (
  id            TEXT PRIMARY KEY,          -- 'pn_' + random
  identity      TEXT NOT NULL,
  contact_id    TEXT REFERENCES contacts(id),
  search_id     TEXT REFERENCES searches(id),
  text          TEXT NOT NULL,
  sentiment     INTEGER NOT NULL DEFAULT 0, -- 1 good, -1 bad, 0 neutral
  author        TEXT NOT NULL,             -- user id or 'agent'
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS people_notes_identity ON people_notes(identity);
CREATE INDEX IF NOT EXISTS people_notes_contact ON people_notes(contact_id);

-- Power meter: readings (balance in kWh, read by the agent from a photo) and top-ups.
CREATE TABLE IF NOT EXISTS meter_readings (
  id            TEXT PRIMARY KEY,          -- 'mr_' + random
  search_id     TEXT NOT NULL REFERENCES searches(id),
  kind          TEXT NOT NULL DEFAULT 'reading', -- reading | topup | photo (a member's photo waiting for the agent)
  kwh           REAL,                      -- reading: balance left; topup: kWh bought
  amount        INTEGER,                   -- topup: money paid (main units)
  currency      TEXT,
  photo         TEXT,                      -- KV key 'm/<search>/<user>-<ts>'
  note          TEXT,
  at            TEXT NOT NULL,             -- when the meter showed this (ISO)
  created_by    TEXT NOT NULL,             -- user id or 'agent'
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS meter_readings_search ON meter_readings(search_id, at);

-- Move-out of the current home: one per search.
CREATE TABLE IF NOT EXISTS moveouts (
  search_id     TEXT PRIMARY KEY REFERENCES searches(id),
  listing_id    TEXT REFERENCES listings(id),
  date          TEXT,                      -- YYYY-MM-DD
  steps         TEXT,                      -- JSON {notice|keys|video|cleaning|deposit: {status: done|wait|todo|info, note, date?, at?, channel?}}
  pushback      TEXT,                      -- JSON {who, contact_id?, quote, points} the agent's talking points
  updated_at    TEXT NOT NULL
);

-- Re-let the remaining term of the current home.
CREATE TABLE IF NOT EXISTS relets (
  search_id     TEXT PRIMARY KEY REFERENCES searches(id),
  listing_id    TEXT REFERENCES listings(id),
  date_from     TEXT,
  date_to       TEXT,
  price         INTEGER,
  currency      TEXT,
  consent       TEXT NOT NULL DEFAULT 'unknown', -- yes | asked | no | unknown
  consent_note  TEXT,
  ad_text       TEXT,
  photos        TEXT,                      -- JSON [photo ref] (same shape as listings.photos)
  channels      TEXT,                      -- JSON [{kind, label, count?, url?}]
  status        TEXT NOT NULL DEFAULT 'draft', -- draft | posted | found | closed
  updated_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS relet_leads (
  id            TEXT PRIMARY KEY,          -- 'rl_' + random
  search_id     TEXT NOT NULL REFERENCES searches(id),
  contact_id    TEXT REFERENCES contacts(id),
  name          TEXT NOT NULL,
  channel       TEXT,
  address       TEXT,
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'new', -- new | reply | viewing | agreed | not_suitable
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS relet_leads_search ON relet_leads(search_id, updated_at);

-- Contacts directory near the home (bike rental, water, laundry, markets…). House contacts show as the group "home".
CREATE TABLE IF NOT EXISTS directory (
  id            TEXT PRIMARY KEY,          -- 'dr_' + random
  search_id     TEXT NOT NULL REFERENCES searches(id),
  grp           TEXT NOT NULL DEFAULT 'services', -- home | bikes | food | services | health | <custom key>
  name          TEXT NOT NULL,
  subtitle      TEXT,                      -- price / hours / "delivers home"
  channel       TEXT,                      -- whatsapp | telegram | phone | map
  address       TEXT,                      -- number or @handle for the channel
  phone         TEXT,                      -- for the call button (whatsapp entries call the same number)
  map_url       TEXT,
  lat           REAL,
  lng           REAL,
  icon          TEXT,
  sort          INTEGER NOT NULL DEFAULT 0,
  created_by    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS directory_search ON directory(search_id, grp, sort);
