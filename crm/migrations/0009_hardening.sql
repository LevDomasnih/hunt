-- Wave 5.1 hardening: revocable links and tokens, cheaper state queries, D1 counters for KV writes and rate limits.
-- Additive only.

-- Web link generation: part of every signed web link and photo token; bumping it (/revoke, the app) kills them all.
ALTER TABLE users ADD COLUMN link_gen INTEGER NOT NULL DEFAULT 0;

-- Revoked agent tokens stay for the audit trail; authAgent ignores them.
ALTER TABLE tokens ADD COLUMN revoked_at TEXT;

-- When the agent last did something in the search (written by event() for actor 'agent' and by agent writes);
-- replaces five MAX() subqueries in the Mini App state.
ALTER TABLE searches ADD COLUMN agent_seen_at TEXT;

-- Listing screen and state: messages by listing.
CREATE INDEX IF NOT EXISTS messages_listing ON messages(listing_id, at);

-- Feed: the latest events of the feed kinds per search.
CREATE INDEX IF NOT EXISTS events_search_kind ON events(search_id, kind, id);

-- Small counters: KV writes per UTC day ('kv:<day>'), per-user rate limits ('rl:<bucket>:<user>:<window>').
-- Old rows are deleted by the cron.
CREATE TABLE IF NOT EXISTS counters (
  key   TEXT PRIMARY KEY,
  n     INTEGER NOT NULL DEFAULT 0,
  at    TEXT NOT NULL
);

-- Backfill: the last agent activity per search from the events log (one pass, cheap at this size).
UPDATE searches SET agent_seen_at = (SELECT MAX(at) FROM events e WHERE e.search_id = searches.id AND e.actor = 'agent');
