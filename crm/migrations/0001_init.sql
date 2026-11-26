-- Hunt CRM schema (Cloudflare D1 / SQLite).
-- Timestamps are ISO-8601 UTC strings. JSON columns hold TEXT with valid JSON.

PRAGMA foreign_keys = ON;

-- A person who uses Hunt (the one who hunts) or a friend invited to a search.
CREATE TABLE users (
  id            TEXT PRIMARY KEY,          -- 'u_' + random
  tg_user_id    INTEGER UNIQUE,            -- Telegram numeric id (set when the person opens the bot)
  tg_username   TEXT,
  display_name  TEXT NOT NULL,
  lang          TEXT NOT NULL DEFAULT 'en',-- UI language for bot and Mini App
  created_at    TEXT NOT NULL
);

-- Profile of the hunter: how the agent represents them. One per owner user.
CREATE TABLE profiles (
  user_id       TEXT PRIMARY KEY REFERENCES users(id),
  data          TEXT NOT NULL,             -- JSON, see core/profile.schema.json
  updated_at    TEXT NOT NULL
);

-- One house hunt.
CREATE TABLE searches (
  id            TEXT PRIMARY KEY,          -- 's_' + random
  owner_id      TEXT NOT NULL REFERENCES users(id),
  title         TEXT NOT NULL,             -- "Bukit, Nov 2026"
  region        TEXT NOT NULL,             -- pack path: 'bali/bukit', 'th/phuket'
  brief         TEXT NOT NULL,             -- JSON, see core/brief.schema.json
  status        TEXT NOT NULL DEFAULT 'active', -- active | paused | found | closed
  tg_chat_id    INTEGER,                   -- search group chat where cards are posted
  approval_mode TEXT NOT NULL DEFAULT 'ask',    -- ask | routine_auto
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- Who participates in a search and can vote.
CREATE TABLE members (
  search_id     TEXT NOT NULL REFERENCES searches(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  role          TEXT NOT NULL DEFAULT 'member', -- owner | member | viewer
  notify        INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (search_id, user_id)
);

-- A place to rent.
CREATE TABLE listings (
  id            TEXT PRIMARY KEY,          -- stable slug from source: 'fb-1722243245987208', 'krisha-12345'
  search_id     TEXT NOT NULL REFERENCES searches(id),
  title         TEXT NOT NULL,
  district      TEXT,                      -- district slug from the region pack
  area_text     TEXT,                      -- free text as the source says it
  lat           REAL,
  lng           REAL,
  map_url       TEXT,
  property_type TEXT,                      -- villa | house | apartment | condo | townhouse | room
  bedrooms      INTEGER,
  bathrooms     INTEGER,
  size_m2       REAL,
  price         INTEGER,                   -- per month, local currency, main units
  currency      TEXT,
  price_note    TEXT,                      -- "22M + electricity, was 27"
  includes      TEXT,                      -- JSON array: ["wifi","water","cleaning"]
  available     TEXT,                      -- "from 2026-11-23" or "23.11–31.03"
  fields        TEXT NOT NULL DEFAULT '{}',-- JSON, region pack listing_fields (living_room, pool…)
  photos        TEXT NOT NULL DEFAULT '[]',-- JSON array of {file_id, w, h}: Telegram file_id is the storage
  source        TEXT,                      -- 'facebook_group', 'krisha', 'telegram', 'agent'
  source_url    TEXT,
  summary       TEXT,                      -- agent's 1–3 line take for humans
  status        TEXT NOT NULL DEFAULT 'new', -- new | contacted | talking | needs_you | viewing | rejected | taken | closed
  next_step     TEXT,                      -- what happens next, human readable
  decision      TEXT,                      -- want_view | thinking | not_interested | take (set by humans)
  decided_by    TEXT REFERENCES users(id),
  decided_at    TEXT,
  tg_message_id INTEGER,                   -- card message in the search chat
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX listings_search ON listings(search_id, status);

-- Per-member votes; listings.decision is the latest decisive vote.
CREATE TABLE votes (
  listing_id    TEXT NOT NULL REFERENCES listings(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  decision      TEXT NOT NULL,
  comment       TEXT,
  at            TEXT NOT NULL,
  PRIMARY KEY (listing_id, user_id)
);

-- A person on the other side: owner, agent, owner's spouse, manager.
CREATE TABLE contacts (
  id            TEXT PRIMARY KEY,          -- 'c_' + random
  name          TEXT,
  role          TEXT,                      -- owner | agent | agency | manager | relative | tenant_subletting
  lang          TEXT,                      -- language we write to them in (en, ru, id, th, kk)
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- Ways to reach a contact. A contact can have several.
CREATE TABLE contact_channels (
  contact_id    TEXT NOT NULL REFERENCES contacts(id),
  channel       TEXT NOT NULL,             -- telegram | whatsapp | viber | messenger | instagram | email | line | portal:<name>
  address       TEXT NOT NULL,             -- normalized: '+6281200000033', '@odegalle', fb thread id, email
  display       TEXT,                      -- how it shows in the app header (business name etc.)
  PRIMARY KEY (channel, address)
);
CREATE INDEX contact_channels_contact ON contact_channels(contact_id);

-- Many-to-many: one agent has many listings, one listing has owner + spouse.
CREATE TABLE listing_contacts (
  listing_id    TEXT NOT NULL REFERENCES listings(id),
  contact_id    TEXT NOT NULL REFERENCES contacts(id),
  role          TEXT,                      -- primary | secondary
  PRIMARY KEY (listing_id, contact_id)
);

-- Every message in and out, on any channel.
CREATE TABLE messages (
  id            TEXT PRIMARY KEY,          -- 'm_' + random
  search_id     TEXT REFERENCES searches(id),
  contact_id    TEXT REFERENCES contacts(id),
  listing_id    TEXT REFERENCES listings(id),
  channel       TEXT NOT NULL,
  direction     TEXT NOT NULL,             -- in | out | call_missed
  text          TEXT,
  media         TEXT NOT NULL DEFAULT '[]',-- JSON array of {type, key|url, caption}
  external_id   TEXT,                      -- id in the channel, for dedupe
  at            TEXT NOT NULL,
  UNIQUE (channel, external_id)
);
CREATE INDEX messages_contact ON messages(contact_id, at);

-- Outgoing messages waiting for approval (or auto-approved routine ones).
CREATE TABLE drafts (
  id            TEXT PRIMARY KEY,          -- 'd_' + random
  search_id     TEXT NOT NULL REFERENCES searches(id),
  contact_id    TEXT REFERENCES contacts(id),
  listing_id    TEXT REFERENCES listings(id),
  channel       TEXT NOT NULL,
  address       TEXT NOT NULL,
  text          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'other', -- first_contact | follow_up | negotiate | schedule | running_late | decline | cancel | found | reply | other
  reason        TEXT,                      -- why the agent wants to send it, shown to the approver
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | approved | edited | rejected | sent | failed
  edited_text   TEXT,
  decided_by    TEXT REFERENCES users(id),
  tg_message_id INTEGER,                   -- approval message in the owner's DM with the bot
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX drafts_status ON drafts(search_id, status);

CREATE TABLE viewings (
  id            TEXT PRIMARY KEY,          -- 'v_' + random
  search_id     TEXT NOT NULL REFERENCES searches(id),
  listing_id    TEXT NOT NULL REFERENCES listings(id),
  starts_at     TEXT NOT NULL,             -- local time with offset: '2026-11-18T10:00:00+08:00'
  status        TEXT NOT NULL DEFAULT 'proposed', -- proposed | confirmed | done | cancelled
  meet_note     TEXT,                      -- "front office at villa 2", "current tenants will meet"
  outcome       TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX viewings_search ON viewings(search_id, starts_at);

-- The chosen place: contract versions, payments, move-in checklist.
CREATE TABLE deals (
  listing_id    TEXT PRIMARY KEY REFERENCES listings(id),
  search_id     TEXT NOT NULL REFERENCES searches(id),
  data          TEXT NOT NULL DEFAULT '{}',-- JSON: terms, payments[], deposit{}, checklist{}, contract_versions[] (no passport data)
  updated_at    TEXT NOT NULL
);

-- Audit and feed of what happened, for the digest and notifications.
CREATE TABLE events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  search_id     TEXT REFERENCES searches(id),
  kind          TEXT NOT NULL,             -- vote | draft_decided | listing_added | message_in | viewing_changed | note
  ref           TEXT,                      -- listing/draft/viewing id
  actor         TEXT,                      -- user id or 'agent'
  data          TEXT NOT NULL DEFAULT '{}',
  at            TEXT NOT NULL
);
CREATE INDEX events_search ON events(search_id, id);

-- Agent API tokens (hashed). One per owner, created at setup.
CREATE TABLE tokens (
  hash          TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  label         TEXT,
  created_at    TEXT NOT NULL
);

-- Invite links: t.me/<bot>?start=<code>.
-- kind=hunter: the person becomes a hunter (gets an agent token, can create searches).
-- kind=member: the person joins one search to vote and see cards.
CREATE TABLE invites (
  code          TEXT PRIMARY KEY,          -- random, used in the start parameter
  kind          TEXT NOT NULL,             -- hunter | member
  search_id     TEXT REFERENCES searches(id), -- for kind=member
  created_by    TEXT NOT NULL REFERENCES users(id),
  max_uses      INTEGER NOT NULL DEFAULT 1,
  uses          INTEGER NOT NULL DEFAULT 0,
  expires_at    TEXT,
  created_at    TEXT NOT NULL
);

-- Who may create searches and hold agent tokens on this instance.
CREATE TABLE hunters (
  user_id       TEXT PRIMARY KEY REFERENCES users(id),
  is_admin      INTEGER NOT NULL DEFAULT 0, -- admins can invite hunters
  invited_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL
);

-- Pending bot conversations (for example: waiting for edited draft text).
CREATE TABLE bot_state (
  tg_user_id    INTEGER PRIMARY KEY,
  state         TEXT NOT NULL,             -- JSON {kind:'edit_draft', draft_id}
  at            TEXT NOT NULL
);
