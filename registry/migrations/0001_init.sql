-- Hunt sources registry: where listings are (portals, chats, groups, agencies), per country. No listings, no people.
CREATE TABLE sources (
  id          TEXT PRIMARY KEY,               -- 'src_' + random
  country     TEXT NOT NULL,                  -- pack slug: bali, kz, th
  section     TEXT NOT NULL,                  -- portals | telegram | facebook_groups | …
  key         TEXT NOT NULL,                  -- normalized handle / url / name, for duplicates
  data        TEXT NOT NULL,                  -- JSON entry, the same fields as in a pack's sources.yaml
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  sort        INTEGER NOT NULL DEFAULT 0,
  added_by    TEXT,                           -- keys(id), NULL = imported
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (country, section, key)
);
CREATE INDEX sources_list ON sources(country, status, section, sort);

-- One key per Hunt server. Only the hash is stored.
CREATE TABLE keys (
  id          TEXT PRIMARY KEY,
  hash        TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  revoked_at  TEXT
);

CREATE TABLE reports (
  source_id   TEXT NOT NULL REFERENCES sources(id),
  key_id      TEXT NOT NULL REFERENCES keys(id),
  kind        TEXT NOT NULL,                  -- dead | spam | ok
  at          TEXT NOT NULL,
  PRIMARY KEY (source_id, key_id)
);

CREATE TABLE counters (key TEXT PRIMARY KEY, n INTEGER NOT NULL, at TEXT NOT NULL);
