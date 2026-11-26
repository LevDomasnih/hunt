-- Wave 6: the project pipeline (one lifecycle per search, shown as a path and stage bars), several lease terms per home
-- (extensions), closed projects, and "Полезное" (useful links per region; members suggest, the agent/owner approves).
-- Additive only.

-- Effective stage of the project (derived from the data, or the manual override): start | search | viewings | choice | deal |
-- movein | living | extension | next | moveout | closed. Recomputed when the search is opened, after the agent writes that move
-- it (deal, documents, viewings, move-out, renewal) and by the cron; NULL until the first computation.
ALTER TABLE searches ADD COLUMN stage TEXT;
-- Manual override by the search owner (Mini App) or the agent (stage_set); NULL = automatic. Cleared automatically once the
-- derived stage moves past it.
ALTER TABLE searches ADD COLUMN stage_manual TEXT;
ALTER TABLE searches ADD COLUMN stage_changed_at TEXT;
-- Small history: JSON [{stage, at, by: user id | 'agent' | 'auto', manual: 0|1}], newest last, at most 30 entries.
ALTER TABLE searches ADD COLUMN stage_history TEXT;
-- The chosen listing pinned to the project as its home (set when a choice/deal is made; kept through extensions).
ALTER TABLE searches ADD COLUMN home_listing_id TEXT;
-- When the project was closed (archived, read-only; guests lose access).
ALTER TABLE searches ADD COLUMN closed_at TEXT;

-- Lease terms of the project home after the first one (the first term stays in deals.data.terms / dates / payments).
-- seq 2, 3, … = extensions ("stay" in What next), possibly with a new landlord (e.g. the owner directly instead of the sublessor).
-- Money, documents and dates per term: dates use the deal date shape (deal.ts DealDate); documents link by documents.term_seq.
CREATE TABLE IF NOT EXISTS deal_terms (
  id            TEXT PRIMARY KEY,          -- 'dt_' + random
  search_id     TEXT NOT NULL REFERENCES searches(id),
  listing_id    TEXT NOT NULL REFERENCES listings(id),
  seq           INTEGER NOT NULL,          -- 2, 3, …
  kind          TEXT,                      -- lease | sublease
  date_from     TEXT NOT NULL,             -- YYYY-MM-DD
  date_to       TEXT,                      -- YYYY-MM-DD
  rent          INTEGER,                   -- per month, main units
  currency      TEXT,
  deposit       INTEGER,                   -- the new deposit of this term
  deposit_prev  TEXT,                      -- what happened to the previous term's deposit: returned | carried | pending | kept
  deposit_prev_amount INTEGER,             -- returned / carried amount (main units)
  landlord      TEXT,                      -- name only ("Made, owner"), never ID numbers
  landlord_contact_id TEXT REFERENCES contacts(id),
  status        TEXT NOT NULL DEFAULT 'draft', -- draft | signed | active | ended
  dates         TEXT,                      -- JSON [DealDate] (payments, notice, move-out, deposit return) of this term
  checklist     TEXT,                      -- JSON [{text, done}]
  note          TEXT,
  created_by    TEXT NOT NULL,             -- user id or 'agent'
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (search_id, seq)
);
CREATE INDEX IF NOT EXISTS deal_terms_search ON deal_terms(search_id, seq);

-- Which lease term a document belongs to (NULL = the first term).
ALTER TABLE documents ADD COLUMN term_seq INTEGER;

-- "Полезное": links the members suggested (pending) and the agent/owner approved (instance-wide, shown with the region pack's
-- useful.yaml). Pack items are not stored here; overrides of pack items (activity, last_checked) use pack_id.
CREATE TABLE IF NOT EXISTS useful_links (
  id            TEXT PRIMARY KEY,          -- 'ul_' + random
  country       TEXT NOT NULL,             -- pack country: bali | kz | th
  city          TEXT,                      -- sub-pack slug or NULL for the whole country
  pack_id       TEXT,                      -- id of a useful.yaml item this row annotates (activity / last_checked), else NULL
  category      TEXT NOT NULL DEFAULT 'other', -- chats_rent | flea | bikes | news | visas | medicine | food | apps | guides | maps | other
  kind          TEXT NOT NULL DEFAULT 'web',   -- telegram | app | web | hunt
  name          TEXT NOT NULL,
  url           TEXT NOT NULL,
  about_ru      TEXT,
  about_en      TEXT,
  lang          TEXT,                      -- ru | en | id | th | kk | multi
  activity      TEXT,                      -- JSON {members?, per_day?, at} filled by the agent (read-only Telegram stats)
  last_checked  TEXT,                      -- YYYY-MM-DD
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  suggested_by  TEXT REFERENCES users(id),
  search_id     TEXT REFERENCES searches(id), -- where it was suggested (the approver sees it in that search's digest)
  decided_by    TEXT,                      -- user id or 'agent'
  note          TEXT,                      -- the suggester's "why"
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS useful_links_country ON useful_links(country, status);
