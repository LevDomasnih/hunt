-- Wave 7: Афиша — a curated daily events feed per region (collected by the agent from read-only sources), per-member
-- feedback for the "good shuffle" recommendations, and bookings the agent arranges with the organizer (approval as usual).
-- Additive only. The table is `afisha` because `events` is the activity log.

-- Members' Афиша preferences: nightlife (1 / 0 = no bars, clubs or alcohol promos in recommendations / NULL = auto, on),
-- afisha (the top event in the morning digest: 1 / 0 / NULL = auto, on once the project has a home),
-- taste (JSON {age_band?: '18-24'|'25-30'|'31-40'|'40+', interests?: [nightlife, sport, surf, culture, nature, food,
-- wellness, music, creative, social]}) — the default taste before any feedback.
ALTER TABLE members ADD COLUMN nightlife INTEGER;
ALTER TABLE members ADD COLUMN afisha INTEGER;
ALTER TABLE members ADD COLUMN taste TEXT;

-- One event (one-off or recurring). Instance-wide per country, like useful_links; each search sees the ones within 60 min
-- of its home (or of its brief districts before a deal).
CREATE TABLE IF NOT EXISTS afisha (
  id              TEXT PRIMARY KEY,          -- 'ev_' + random
  country         TEXT NOT NULL,             -- pack slug: bali | kz | th
  city            TEXT,                      -- sub-pack slug or NULL
  area            TEXT,                      -- districts.yaml area id, if known
  title           TEXT NOT NULL,
  title_en        TEXT,
  about_ru        TEXT,                      -- one human line in Russian
  about_en        TEXT,
  category        TEXT NOT NULL,             -- culture | nature | sport | dance | music | food | workshop | party | wellness | kids | other | bar | club | beach_club | social_sport | meetup | quiz
  topic           TEXT,                      -- fine slug (kecak, snorkel, padel, …): photo effect and "why" lines
  starts_at       TEXT,                      -- local ISO with offset; NULL for recurring events without a first date
  ends_at         TEXT,
  recurrence      TEXT,                      -- JSON {freq: daily|weekly|monthly|seasonal, time, end?, weekdays?, day?, nth?, months?, from?, until?}
  place_name      TEXT,
  place_id        TEXT,                      -- 'b:<pack place id>' or a places.id
  lat             REAL,
  lng             REAL,
  map_url         TEXT,
  price_kind      TEXT NOT NULL DEFAULT 'unknown', -- free | paid | on_site | unknown
  price           INTEGER,                   -- main units, per person
  currency        TEXT,
  price_note      TEXT,
  entry           TEXT,                      -- free | fee | min_spend | guest_list (nightlife)
  lang            TEXT,                      -- ru | en | id | mixed | none
  booking         TEXT NOT NULL DEFAULT 'none', -- none | message | ticket
  ticket_url      TEXT,
  organizer_name  TEXT,
  organizer_channel TEXT,                    -- telegram | whatsapp | instagram | facebook | email | phone | web
  organizer_address TEXT,
  organizer_contact_id TEXT REFERENCES contacts(id),
  organizer_lang  TEXT,
  source_kind     TEXT,                      -- telegram | instagram | facebook | web | place | pack | user
  source_url      TEXT,
  source_name     TEXT,
  source_rep      REAL,                      -- 0..1 reputation of the source
  sources         TEXT,                      -- JSON [{kind, url, name}] (merged duplicates)
  photo_url       TEXT,                      -- only when the source allows reuse
  photo_credit    TEXT,
  photo_source_url TEXT,
  photo_score     REAL,                      -- 0..1 from the agent's quality gate
  age_min         INTEGER,                   -- 18 | 21
  dress_code      TEXT,
  vibe            TEXT,                      -- chill | party | sport | meet
  crowd           TEXT,                      -- expats | locals | mixed
  beginner        INTEGER,                   -- 1 = beginner-friendly
  outdoor         INTEGER,
  sea             INTEGER,                   -- 1 = needs a calm sea (snorkel, boat)
  tags            TEXT,                      -- JSON [audience signals]
  quality         REAL,                      -- 0..1 agent hint (venue activity, reviews)
  status          TEXT NOT NULL DEFAULT 'active', -- active | cancelled | hidden
  search_id       TEXT REFERENCES searches(id), -- the search it was collected for (informational)
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS afisha_country ON afisha(country, status, starts_at);

-- Per-member feedback on an event (D1, not KV): like / не моё / хочу пойти / bookmark / attended + rating. category,
-- topic, organizer_key and place_key are copied so the taste survives the event row and decays by updated_at.
CREATE TABLE IF NOT EXISTS event_feedback (
  event_id        TEXT NOT NULL REFERENCES afisha(id),
  user_id         TEXT NOT NULL REFERENCES users(id),
  search_id       TEXT NOT NULL REFERENCES searches(id),
  occ             TEXT,                      -- YYYY-MM-DD of the occurrence acted on last
  liked           INTEGER NOT NULL DEFAULT 0,
  nope            INTEGER NOT NULL DEFAULT 0,
  want            INTEGER NOT NULL DEFAULT 0,
  bookmark        INTEGER NOT NULL DEFAULT 0,
  attended        INTEGER NOT NULL DEFAULT 0,
  rating          INTEGER,                   -- 1..5 after attending
  category        TEXT,
  topic           TEXT,
  organizer_key   TEXT,
  place_key       TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (event_id, user_id, search_id)
);
CREATE INDEX IF NOT EXISTS event_feedback_search ON event_feedback(search_id, updated_at);

-- "Записаться": who goes, the draft to the organizer, the status. Payments are always by the humans.
CREATE TABLE IF NOT EXISTS event_bookings (
  id              TEXT PRIMARY KEY,          -- 'eb_' + random
  event_id        TEXT NOT NULL REFERENCES afisha(id),
  search_id       TEXT NOT NULL REFERENCES searches(id),
  occ             TEXT NOT NULL,             -- YYYY-MM-DD
  starts_at       TEXT NOT NULL,             -- local ISO with offset of that occurrence
  who             TEXT NOT NULL,             -- JSON [user ids]
  guests          INTEGER NOT NULL DEFAULT 0,
  kind            TEXT NOT NULL DEFAULT 'join', -- join | guest_list | table | slot
  note            TEXT,
  status          TEXT NOT NULL DEFAULT 'requested', -- requested | drafted | asked | booked | declined | cancelled | attended
  draft_id        TEXT REFERENCES drafts(id),
  requested_by    TEXT NOT NULL REFERENCES users(id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS event_bookings_search ON event_bookings(search_id, status, starts_at);
