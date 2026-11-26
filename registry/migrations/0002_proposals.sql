-- Proposals: a hunter's new city (or a correction) waits here until the admin decides. Text files of a region pack only.
CREATE TABLE proposals (
  id          TEXT PRIMARY KEY,                 -- 'prop_' + random
  key_id      TEXT NOT NULL REFERENCES keys(id), -- the Hunt server it came through
  ref         TEXT NOT NULL,                    -- that server's own id (idempotent resend)
  country     TEXT NOT NULL,
  title       TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  author      TEXT,                             -- a nickname the hunter chose, NULL = not named
  base        TEXT,                             -- hunt-data version the files were made from
  sources     TEXT NOT NULL DEFAULT '[]',       -- [{section, entry}], suggested together with the files
  flags       TEXT NOT NULL DEFAULT '[]',       -- what the automatic check noticed
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | returned | rejected | approved | merged
  comment     TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (key_id, ref)
);
CREATE INDEX proposals_status ON proposals(status, created_at);
CREATE TABLE proposal_files (
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  path        TEXT NOT NULL,                    -- regions/<country>/…
  content     TEXT NOT NULL,
  PRIMARY KEY (proposal_id, path)
);
