-- Ratings after a viewing: each member scores 1-5 on four criteria; score = mean of the four,
-- listing score = mean of member scores. voice = KV key of a voice note (the agent transcribes it later).
CREATE TABLE IF NOT EXISTS ratings (
  listing_id    TEXT NOT NULL REFERENCES listings(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  overall       INTEGER NOT NULL,          -- general impression
  area          INTEGER NOT NULL,          -- area and road
  inside        INTEGER NOT NULL,          -- the house inside
  quiet         INTEGER NOT NULL,          -- quiet and neighbours
  note          TEXT,
  voice         TEXT,
  at            TEXT NOT NULL,
  PRIMARY KEY (listing_id, user_id)
);

-- "Rate it" DM sent (once, 60-90 min after the viewing started).
ALTER TABLE viewings ADD COLUMN rate_asked_at TEXT;
