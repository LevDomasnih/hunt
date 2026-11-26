-- Wave 9: evenings & parties. Members' own parties at the villa with a public invite page (RSVP without Telegram),
-- a checklist that feeds Money, photos and a "how was it" rating; "Как было?" notes after Афиша events; stale marks for
-- event photos shown by link through the image proxy. Additive only.

-- A party at the home. Private to its search (never in other searches' Афиша). The public invite token is HMAC-derived
-- (party|id|ver, 128 bits) and only its SHA-256 is stored; token_hash NULL = no public link (revoked).
CREATE TABLE IF NOT EXISTS parties (
  id              TEXT PRIMARY KEY,          -- 'pt_' + random
  search_id       TEXT NOT NULL REFERENCES searches(id),
  title           TEXT NOT NULL,
  starts_at       TEXT NOT NULL,             -- local ISO with offset
  ends_at         TEXT,
  theme           TEXT,
  vibe            TEXT,                      -- chill | dance | dinner | pool | games | sunset
  dress_code      TEXT,
  capacity        INTEGER,                   -- heads incl. +1s; NULL = no limit
  plus_one        INTEGER NOT NULL DEFAULT 1,
  byob            INTEGER,                   -- 1 = bring your own drinks, 0 = we have drinks, NULL = not said
  note            TEXT,
  address         TEXT,                      -- shown only to "going" guests on their personal link
  how_to          TEXT,                      -- how to get there (same)
  wifi            INTEGER NOT NULL DEFAULT 0, -- 1 = show the house guide's Wi-Fi to "going" guests
  cover           TEXT,                      -- KV key 'y/<id>/c-<ts>' or NULL (= the home's first photo)
  photos          TEXT,                      -- JSON [{kv, by, at}] after the party
  token_hash      TEXT,
  token_ver       INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'active', -- active | cancelled | done
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS parties_search ON parties(search_id, starts_at);
CREATE INDEX IF NOT EXISTS parties_token ON parties(token_hash);

-- Guests who answered on the public page. secret_hash = SHA-256 of the guest's personal link secret (shown once).
CREATE TABLE IF NOT EXISTS party_guests (
  id              TEXT PRIMARY KEY,          -- 'pg_' + random
  party_id        TEXT NOT NULL REFERENCES parties(id),
  name            TEXT NOT NULL,
  answer          TEXT NOT NULL,             -- going | maybe | no
  plus_one        INTEGER NOT NULL DEFAULT 0,
  secret_hash     TEXT NOT NULL,
  removed         INTEGER NOT NULL DEFAULT 0, -- a member removed the guest (their link stops working)
  came            INTEGER,                   -- after the party: 1 / 0 / NULL
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS party_guests_party ON party_guests(party_id);
CREATE UNIQUE INDEX IF NOT EXISTS party_guests_secret ON party_guests(secret_hash);

-- The party checklist: who brings what, what it cost (a cost with a payer becomes an expense in Money).
CREATE TABLE IF NOT EXISTS party_items (
  id              TEXT PRIMARY KEY,          -- 'pi_' + random
  party_id        TEXT NOT NULL REFERENCES parties(id),
  title           TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'other', -- drinks | ice | food | music | cups | cleanup | other
  who             TEXT REFERENCES users(id),
  cost            INTEGER,
  currency        TEXT,
  done            INTEGER NOT NULL DEFAULT 0,
  expense_id      TEXT,
  sort            INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS party_items_party ON party_items(party_id, sort);

-- Members' "how was it" after their party.
CREATE TABLE IF NOT EXISTS party_ratings (
  party_id        TEXT NOT NULL REFERENCES parties(id),
  user_id         TEXT NOT NULL REFERENCES users(id),
  rating          INTEGER NOT NULL,          -- 1..5
  note            TEXT,
  at              TEXT NOT NULL,
  PRIMARY KEY (party_id, user_id)
);

-- "Как было?" after an Афиша event: an optional note next to the rating.
ALTER TABLE event_feedback ADD COLUMN note TEXT;
-- Index for instance-wide venue / organizer quality (ratings across searches).
CREATE INDEX IF NOT EXISTS event_feedback_rating ON event_feedback(rating, updated_at);

-- Event photos shown by link (image proxy): the last failure, so the next sweep refreshes the photo. A new photo_url clears it.
ALTER TABLE afisha ADD COLUMN photo_stale_at TEXT;
ALTER TABLE afisha ADD COLUMN photo_fail TEXT;           -- 404 | refused | not_image | too_big | blocked | error
