-- The site: sign-in from a browser through the bot, sessions, and translations of messages for the two-language chat.
CREATE TABLE web_logins (
  id          TEXT PRIMARY KEY,        -- public part: goes to the bot link or the one-time link
  kind        TEXT NOT NULL,           -- bot (number match) | link (one-time link from /web)
  secret_hash TEXT NOT NULL,           -- the browser's secret (bot) or the link's code (link)
  number      INTEGER,                 -- the number the site shows
  options     TEXT,                    -- JSON [n, n, n] offered in the bot
  device      TEXT,                    -- "Chrome, macOS · ID"
  status      TEXT NOT NULL,           -- new | asked | approved | denied | done
  user_id     TEXT REFERENCES users(id),
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE TABLE web_sessions (
  hash        TEXT PRIMARY KEY,        -- sha256 of the cookie
  id          TEXT NOT NULL UNIQUE,    -- shown to the person, to end one session
  user_id     TEXT NOT NULL REFERENCES users(id),
  device      TEXT,
  created_at  TEXT NOT NULL,
  last_at     TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX web_sessions_user ON web_sessions(user_id);
ALTER TABLE messages ADD COLUMN tr TEXT;   -- the text in the owner's language (the agent writes it when it logs the message)
ALTER TABLE drafts ADD COLUMN tr TEXT;     -- what the draft says, in the owner's language
