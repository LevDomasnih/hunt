-- Wave 5: surf forecast, guest guide, "what next" before the lease ends, negotiation helper (price history, asked vs agreed),
-- search recap, guests on dates, configurable location rings. Additive only.

-- Surf line in the morning digest: 1 on, 0 off, NULL = auto (on when the brief mentions surf).
ALTER TABLE members ADD COLUMN surf INTEGER;

-- Ring set (JSON minutes, e.g. [10,20,40]) the isochrones were computed for. NULL = legacy 5/10/30, rush-divided → stale.
ALTER TABLE isochrones ADD COLUMN rings TEXT;

-- Open-Meteo marine + wind forecast per surf spot ('b:<pack id>' or own place id): hourly rows ~72 h ahead.
-- Refreshed at most every 3 hours, only when a member opens the surf screen; the digest reads the cache only.
CREATE TABLE IF NOT EXISTS surf_cache (
  spot_id       TEXT PRIMARY KEY,
  lat           REAL NOT NULL,
  lng           REAL NOT NULL,
  fetched_at    TEXT NOT NULL,
  hourly        TEXT NOT NULL              -- JSON {time:[local 'YYYY-MM-DDTHH:00'], h:[m], p:[s], wd:[deg], ws:[km/h], wdir:[deg]}
);

-- Guest guide of the house (one per search). The public link /g/<token>: token = HMAC(LINK_SECRET, guide|search|version),
-- only its SHA-256 is stored; regenerate = version+1, revoke = token_hash NULL.
CREATE TABLE IF NOT EXISTS guides (
  search_id     TEXT PRIMARY KEY REFERENCES searches(id),
  listing_id    TEXT REFERENCES listings(id),
  token_hash    TEXT UNIQUE,
  version       INTEGER NOT NULL DEFAULT 0,
  address       TEXT,
  map_url       TEXT,
  wifi_name     TEXT,
  wifi_password TEXT,                      -- visible to members, guests with the guide area and on the guide page only
  rules         TEXT,                      -- JSON [{icon, text}]
  note          TEXT,
  host_user_id  TEXT REFERENCES users(id), -- the member who shared the link: their name/Telegram is the hosts' contact
  updated_by    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- "What next?" ~6 weeks before the lease ends: members vote stay | new | leave; the result becomes an instruction for the agent.
CREATE TABLE IF NOT EXISTS renewals (
  id            TEXT PRIMARY KEY,          -- 'rn_' + random
  search_id     TEXT NOT NULL REFERENCES searches(id),
  listing_id    TEXT REFERENCES listings(id),
  lease_to      TEXT NOT NULL,             -- YYYY-MM-DD
  status        TEXT NOT NULL DEFAULT 'open', -- open | decided
  choice        TEXT,                      -- stay | new | leave
  decided_how   TEXT,                      -- majority | owner
  note          TEXT,                      -- the agent's line ("only a new direct contract with Made")
  new_search_id TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  decided_at    TEXT,
  UNIQUE (search_id, lease_to)
);
CREATE TABLE IF NOT EXISTS renewal_votes (
  renewal_id    TEXT NOT NULL REFERENCES renewals(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  choice        TEXT NOT NULL,
  at            TEXT NOT NULL,
  PRIMARY KEY (renewal_id, user_id)
);

-- Prices a listing was seen at (agent writes; the first price on insert, then every change).
CREATE TABLE IF NOT EXISTS price_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id    TEXT NOT NULL REFERENCES listings(id),
  price         INTEGER NOT NULL,
  currency      TEXT,
  source        TEXT,
  at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS price_history_listing ON price_history(listing_id, at);

-- Asked vs agreed monthly price of the deal (owner only; outside deals.data, which every member sees) and when the deal started.
ALTER TABLE deals ADD COLUMN asked INTEGER;
ALTER TABLE deals ADD COLUMN agreed INTEGER;
ALTER TABLE deals ADD COLUMN deal_at TEXT;

-- Guests: Telegram users invited by a member for dates, with per-area access. Not members: no votes, money, documents, chats.
CREATE TABLE IF NOT EXISTS guests (
  search_id     TEXT NOT NULL REFERENCES searches(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  invited_by    TEXT REFERENCES users(id),
  date_from     TEXT NOT NULL,             -- YYYY-MM-DD (access opens 3 days before)
  date_to       TEXT NOT NULL,             -- YYYY-MM-DD (access ends after this day, search timezone)
  areas         TEXT NOT NULL,             -- JSON {guide, places, contacts, issues}
  animal        TEXT,
  status        TEXT NOT NULL DEFAULT 'active', -- active | revoked | expired
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (search_id, user_id)
);
CREATE INDEX IF NOT EXISTS guests_user ON guests(user_id, status);

-- Invite payload (kind 'guest': {from, to, areas}).
ALTER TABLE invites ADD COLUMN data TEXT;

-- Drafts of kind 'guest': the guest who asked (a member approves).
ALTER TABLE drafts ADD COLUMN requested_by TEXT;
