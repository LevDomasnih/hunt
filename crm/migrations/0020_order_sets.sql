-- Orders: saved baskets ("Наборы") with an optional repeat reminder, and the undo of "Очистить". Additive only.
-- A set belongs to one supplier; its lines are item + qty. "В корзину" adds them to the basket; the reminder only DMs the
-- members (the order is never sent by itself).

CREATE TABLE IF NOT EXISTS order_sets (
  id            TEXT PRIMARY KEY,              -- 'os_' + random
  search_id     TEXT NOT NULL REFERENCES searches(id),
  supplier_id   TEXT NOT NULL REFERENCES suppliers(id),
  name          TEXT NOT NULL,                 -- ≤ 40 characters
  name_key      TEXT NOT NULL,                 -- lower-cased, ё → е, spaces folded: unique per search
  repeat        TEXT NOT NULL DEFAULT 'none',  -- none | weekly | biweekly
  days          INTEGER NOT NULL DEFAULT 0,    -- weekdays bitmask: 1 = Monday … 64 = Sunday
  time          TEXT NOT NULL DEFAULT '09:00', -- HH:MM in the search's time zone
  anchor        TEXT,                          -- biweekly: the Monday (YYYY-MM-DD) of a week that fires
  last_sent     TEXT,                          -- the local day ('YYYY-MM-DD') of the last reminder: once per occurrence
  skipped       TEXT,                          -- the last occurrence somebody skipped ('YYYY-MM-DD')
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS order_sets_name ON order_sets(search_id, name_key);
CREATE INDEX IF NOT EXISTS order_sets_repeat ON order_sets(repeat) WHERE repeat != 'none';

CREATE TABLE IF NOT EXISTS order_set_lines (
  set_id        TEXT NOT NULL REFERENCES order_sets(id),
  item_id       TEXT NOT NULL REFERENCES supplier_items(id),
  qty           REAL NOT NULL,
  sort          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (set_id, item_id)
);

-- "Очистить" keeps what it removed for a while, so "Вернуть" puts back exactly those lines (qty, who added them).
ALTER TABLE orders ADD COLUMN cleared TEXT;    -- JSON [{item_id, qty, added_by, at}] of the last clear
ALTER TABLE orders ADD COLUMN cleared_at TEXT;
