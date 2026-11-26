-- Wave 2: scam check, shared money, on-site checklist, life in the villa, morning digest, documents and deal dates.
-- Additive only.

-- Scam check written by the agent: JSON {verdict: ok|caution|danger, signals:[{status: ok|warn|todo, title, detail}], advice, checked_at}.
ALTER TABLE listings ADD COLUMN checks TEXT;

-- Split weights for shared money: JSON {user_id: weight}; NULL = everyone who can vote, equally.
ALTER TABLE searches ADD COLUMN shares TEXT;

-- Morning digest DM (08:00 in the search timezone); members.notify stays the switch for all other DMs.
ALTER TABLE members ADD COLUMN digest INTEGER NOT NULL DEFAULT 1;

-- Shared expenses of a search (rent, deposit, power tokens, cleaning...). Amounts in main units.
CREATE TABLE IF NOT EXISTS expenses (
  id            TEXT PRIMARY KEY,          -- 'x_' + random
  search_id     TEXT NOT NULL REFERENCES searches(id),
  listing_id    TEXT REFERENCES listings(id),
  title         TEXT NOT NULL,
  amount        INTEGER NOT NULL,
  currency      TEXT NOT NULL,
  date          TEXT NOT NULL,             -- YYYY-MM-DD (local)
  paid_by       TEXT NOT NULL REFERENCES users(id),
  split         TEXT,                      -- JSON {user_id: weight}; NULL = searches.shares
  kind          TEXT NOT NULL DEFAULT 'other', -- rent | deposit | power | water | internet | cleaning | pool | repair | food | transport | other
  method        TEXT,                      -- cash | transfer | card
  note          TEXT,
  receipt       TEXT,                      -- KV key of a receipt photo ('r/<search>/<user>-<ts>')
  created_by    TEXT NOT NULL,             -- user id or 'agent'
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS expenses_search ON expenses(search_id, date);

-- "We settled up": from_user paid to_user.
CREATE TABLE IF NOT EXISTS settlements (
  id            TEXT PRIMARY KEY,          -- 'st_' + random
  search_id     TEXT NOT NULL REFERENCES searches(id),
  from_user     TEXT NOT NULL REFERENCES users(id),
  to_user       TEXT NOT NULL REFERENCES users(id),
  amount        INTEGER NOT NULL,
  currency      TEXT NOT NULL,
  note          TEXT,
  created_by    TEXT NOT NULL,
  at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS settlements_search ON settlements(search_id, at);

-- On-site checklist answers: one row per viewing, member and pack item (regions/<country>/checklist.yaml).
CREATE TABLE IF NOT EXISTS site_checks (
  listing_id    TEXT NOT NULL REFERENCES listings(id),
  viewing_id    TEXT NOT NULL DEFAULT '',  -- '' when there is no viewing row
  user_id       TEXT NOT NULL REFERENCES users(id),
  item          TEXT NOT NULL,
  ok            INTEGER,                   -- 1 ok, 0 not ok, NULL unset
  note          TEXT,
  at            TEXT NOT NULL,
  PRIMARY KEY (listing_id, viewing_id, user_id, item)
);

-- Photos taken on site (KV keys 'o/<listing>/<user>-<ts>').
CREATE TABLE IF NOT EXISTS site_photos (
  key           TEXT PRIMARY KEY,
  listing_id    TEXT NOT NULL REFERENCES listings(id),
  viewing_id    TEXT NOT NULL DEFAULT '',
  user_id       TEXT NOT NULL REFERENCES users(id),
  at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS site_photos_listing ON site_photos(listing_id);

-- Life in the villa: things that broke and how they get fixed.
CREATE TABLE IF NOT EXISTS issues (
  id            TEXT PRIMARY KEY,          -- 'is_' + random
  search_id     TEXT NOT NULL REFERENCES searches(id),
  listing_id    TEXT REFERENCES listings(id),
  title         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open', -- open | scheduled | fixed
  note          TEXT,                      -- what the agent did ("wrote to Made in Indonesian")
  scheduled_at  TEXT,                      -- when the repair is booked (ISO with offset)
  fixed_at      TEXT,
  reported_by   TEXT,                      -- user id or 'agent'
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS issues_search ON issues(search_id, status);

-- People of the house: owner, cleaner, pool, repairs. Cost/period/payer for the money view.
CREATE TABLE IF NOT EXISTS house_contacts (
  id            TEXT PRIMARY KEY,          -- 'hc_' + random
  search_id     TEXT NOT NULL REFERENCES searches(id),
  listing_id    TEXT REFERENCES listings(id),
  contact_id    TEXT REFERENCES contacts(id),
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'other', -- owner | manager | cleaning | pool | garden | repair | security | internet | other
  note          TEXT,                      -- "repairs at his cost"
  cost          INTEGER,
  currency      TEXT,
  period        TEXT,                      -- month | week | visit | once
  payer         TEXT,                      -- rent (included in the rent) | us
  schedule      TEXT,                      -- "Tue, Fri"
  channel       TEXT,                      -- whatsapp | telegram | phone | ...
  address       TEXT,
  sort          INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS house_contacts_search ON house_contacts(search_id, sort);

-- Deal documents. Files are not stored by Hunt: only the Telegram file_id (and the chat it came from).
CREATE TABLE IF NOT EXISTS documents (
  id            TEXT PRIMARY KEY,          -- 'doc_' + random
  search_id     TEXT NOT NULL REFERENCES searches(id),
  listing_id    TEXT NOT NULL REFERENCES listings(id),
  kind          TEXT NOT NULL DEFAULT 'other', -- lease | receipt | owner_consent | movein_video | other
  title         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'have', -- have | request | due
  due_date      TEXT,                      -- YYYY-MM-DD for status due
  version       INTEGER,
  doc_date      TEXT,                      -- date of this version (YYYY-MM-DD)
  signed_at     TEXT,                      -- YYYY-MM-DD
  pages         INTEGER,
  note          TEXT,                      -- one line under the title
  summary       TEXT,                      -- JSON {sections:[{icon, title, text}], changes, changes_from} (no ID/card numbers)
  tg_file_id    TEXT,
  tg_chat_id    INTEGER,
  file_kind     TEXT,                      -- document | photo | video
  file_name     TEXT,
  mime          TEXT,
  size          INTEGER,
  created_by    TEXT,                      -- user id or 'agent'
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS documents_listing ON documents(listing_id, kind);
