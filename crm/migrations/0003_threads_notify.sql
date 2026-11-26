-- Conversation summaries per contact ("Переписка" in the Mini App). The agent rewrites them after every
-- incoming or outgoing message: what is agreed, what is open, one line about the last message.
CREATE TABLE IF NOT EXISTS threads (
  search_id     TEXT NOT NULL REFERENCES searches(id),
  contact_id    TEXT NOT NULL REFERENCES contacts(id),
  listing_id    TEXT REFERENCES listings(id),
  state         TEXT NOT NULL DEFAULT 'waiting_them', -- waiting_us | waiting_them | closed
  known         TEXT,                      -- facts agreed, 1-3 short lines
  open          TEXT,                      -- open questions, 1-3 short lines
  last          TEXT,                      -- one line about the last message
  last_at       TEXT,                      -- when the last message was sent or received
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (search_id, contact_id)
);
CREATE INDEX IF NOT EXISTS threads_state ON threads(search_id, state, last_at);

-- Viewing reminder DM sent (once, 60-75 min before a confirmed viewing).
ALTER TABLE viewings ADD COLUMN reminded_at TEXT;

-- One-time notification markers, e.g. 'pay:<listing>:<date>' for deal payment reminders.
CREATE TABLE IF NOT EXISTS sent_marks (
  key           TEXT PRIMARY KEY,
  at            TEXT NOT NULL
);

-- Bot DMs postponed by quiet hours; the cron sends them once not_before has passed.
-- key collapses repeats (several messages from one contact at night = one DM in the morning).
CREATE TABLE IF NOT EXISTS outbox (
  key           TEXT PRIMARY KEY,
  chat_id       INTEGER NOT NULL,
  payload       TEXT NOT NULL,             -- JSON {kind:'text', text, reply_markup?} | {kind:'draft', draft_id}
  not_before    TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
