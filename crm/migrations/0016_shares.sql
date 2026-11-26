-- "Share a city": the agent prepares a request, the hunter sees in the bot exactly what would go and decides. The files stay
-- here only until the decision.
CREATE TABLE pack_shares (
  id          TEXT PRIMARY KEY,                -- 'shr_' + random, also the ref in the registry
  user_id     TEXT NOT NULL REFERENCES users(id),
  country     TEXT NOT NULL,
  title       TEXT NOT NULL,
  digest      TEXT NOT NULL,                   -- sha256 of the payload: the same content is asked about once
  payload     TEXT,                            -- JSON {note, author, base, files, sources}; NULL after the decision
  status      TEXT NOT NULL,                   -- asked | declined | off | sent | returned | rejected | approved | merged
  comment     TEXT,
  remote_id   TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX pack_shares_user ON pack_shares(user_id, created_at);
-- The registry admin's bot cards: one per version of a proposal.
CREATE TABLE share_reviews (
  id          TEXT PRIMARY KEY,                -- proposal id in the registry
  seen        TEXT NOT NULL,                   -- its updated_at when the card was sent
  at          TEXT NOT NULL
);
