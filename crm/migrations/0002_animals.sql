-- Animal avatars: each member gets an animal from the search's country region pack, unique within the search.
ALTER TABLE members ADD COLUMN animal TEXT;
-- When the member saw the "your animal" reveal in the Mini App (shown once per search).
ALTER TABLE members ADD COLUMN reveal_seen_at TEXT;
-- Mini App feed and counters read messages by search.
CREATE INDEX IF NOT EXISTS messages_search ON messages(search_id, direction, at);
