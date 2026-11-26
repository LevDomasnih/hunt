-- Which conversations Hunt may see, sealed texts, and one-button revocation (src/access.ts, src/vault.ts).
CREATE TABLE access (
  user_id     TEXT PRIMARY KEY REFERENCES users(id),
  tg_status   TEXT NOT NULL DEFAULT 'off',   -- off | on | rights (more rights than needed: nothing is read) | revoking (we stopped, waiting for the person to remove the bot)
  tg_conn     TEXT,                          -- Telegram's business connection id
  tg_extra    TEXT NOT NULL DEFAULT '[]',    -- JSON: rights that are too much
  tg_mode     TEXT,                          -- new | only: what the person said they picked (Telegram does not tell the bot)
  wa_status   TEXT NOT NULL DEFAULT 'off',   -- off | button
  dropped     INTEGER NOT NULL DEFAULT 0,    -- messages of people who are not owners: thrown away unread
  retain_days INTEGER NOT NULL DEFAULT 30,   -- conversations go this many days after a project is closed
  ai_cap      REAL,                          -- dollars per project for the server's assistant
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX access_conn ON access(tg_conn) WHERE tg_conn IS NOT NULL;
-- A contact's private chat in the person's Telegram: known once they wrote; last_in_at opens the 24 hours.
CREATE TABLE access_peers (
  user_id     TEXT NOT NULL REFERENCES users(id),
  contact_id  TEXT NOT NULL REFERENCES contacts(id),
  chat_id     INTEGER NOT NULL,
  last_in_at  TEXT,
  PRIMARY KEY (user_id, contact_id)
);
CREATE INDEX access_peers_chat ON access_peers(user_id, chat_id);
CREATE TABLE access_mutes (
  user_id     TEXT NOT NULL REFERENCES users(id),
  contact_id  TEXT NOT NULL REFERENCES contacts(id),
  PRIMARY KEY (user_id, contact_id)
);
-- Who opened conversations: one row per person, way and day.
CREATE TABLE access_log (
  user_id     TEXT NOT NULL REFERENCES users(id),  -- whose conversations
  actor       TEXT NOT NULL,                       -- users.id
  via         TEXT NOT NULL,                       -- app | agent
  day         TEXT NOT NULL,
  PRIMARY KEY (user_id, actor, via, day)
);
CREATE TABLE access_receipts (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  data        TEXT NOT NULL,                       -- JSON: what was revoked and deleted, never the texts
  at          TEXT NOT NULL
);
CREATE INDEX access_receipts_user ON access_receipts(user_id, at);
-- Which key seals this person's conversations. The wrapped key itself is in KV, outside the database's own backups.
CREATE TABLE chat_keys (
  owner_id    TEXT PRIMARY KEY REFERENCES users(id),
  kid         TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE TABLE ai_usage (
  id          TEXT PRIMARY KEY,
  search_id   TEXT NOT NULL REFERENCES searches(id),
  kind        TEXT NOT NULL,                       -- chat | listing | lease | other
  usd         REAL NOT NULL,
  at          TEXT NOT NULL
);
CREATE INDEX ai_usage_search ON ai_usage(search_id);
