-- Wave 10: orders from suppliers (fruit, fish…): a catalog per supplier, one shared basket, the sent order and its receipt.
-- Members order and pay themselves; the agent only imports price lists and records the supplier's answers. Additive only.

CREATE TABLE IF NOT EXISTS suppliers (
  id                TEXT PRIMARY KEY,          -- 'su_' + random
  search_id         TEXT NOT NULL REFERENCES searches(id),
  dir_entry_id      TEXT,                      -- directory(id): the contact card gets "Заказать"
  name              TEXT NOT NULL,
  kind              TEXT NOT NULL DEFAULT 'other', -- fruit | fish | other (pill label, screen tone)
  channel           TEXT,                      -- whatsapp | telegram | phone
  address           TEXT,                      -- number or @handle
  hours             TEXT,                      -- 'HH:MM-HH:MM' local, NULL = not known
  min_free_delivery INTEGER,                   -- main units; NULL = no free delivery known
  delivery_note_ru  TEXT,
  delivery_note_en  TEXT,
  note_ru           TEXT,                      -- "Цены идут за рынком"
  note_en           TEXT,
  lang              TEXT NOT NULL DEFAULT 'id',
  currency          TEXT NOT NULL DEFAULT 'IDR',
  sort              INTEGER NOT NULL DEFAULT 0,
  hidden            INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS suppliers_search ON suppliers(search_id, sort);

CREATE TABLE IF NOT EXISTS supplier_items (
  id            TEXT PRIMARY KEY,              -- 'si_' + random
  supplier_id   TEXT NOT NULL REFERENCES suppliers(id),
  name_id       TEXT NOT NULL,                 -- the name as in the supplier's list (what the message says); import key
  name_ru       TEXT NOT NULL,
  name_en       TEXT NOT NULL,
  grp           TEXT NOT NULL DEFAULT 'other',
  unit          TEXT NOT NULL DEFAULT 'kg',    -- kg | pcs | pack | bunch | 30pcs
  step          REAL NOT NULL DEFAULT 1,       -- 0.5 for kg, 1 for pieces
  price         INTEGER,                       -- per unit, main currency units; NULL = we ask
  price_unsure  INTEGER NOT NULL DEFAULT 0,    -- 1 = the source looks wrong, "уточнить"
  by_request    INTEGER NOT NULL DEFAULT 0,
  price_at      TEXT,                          -- YYYY-MM-DD of the list
  toy           TEXT,                          -- /goods/<toy>-192.webp
  top           INTEGER,                       -- 1..8 = the big toys until there are favourites
  fav           INTEGER NOT NULL DEFAULT 0,    -- how many delivered orders had it ("ваше обычное" from 2)
  sort          INTEGER NOT NULL DEFAULT 0,
  hidden        INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (supplier_id, name_id)
);

-- Every price change of an item (import or a single edit), old → new.
CREATE TABLE IF NOT EXISTS supplier_prices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id       TEXT NOT NULL REFERENCES supplier_items(id),
  old_price     INTEGER,
  new_price     INTEGER,
  at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS supplier_prices_item ON supplier_prices(item_id, id);

-- status: basket (collecting) | opened (WhatsApp opened, "Отправил?") | draft (the agent's approval draft) | sent (waiting for
-- the answer) | confirmed (price / time known) | delivered (paid, one expense) | cancelled.
CREATE TABLE IF NOT EXISTS orders (
  id            TEXT PRIMARY KEY,              -- 'or_' + random
  search_id     TEXT NOT NULL REFERENCES searches(id),
  supplier_id   TEXT NOT NULL REFERENCES suppliers(id),
  status        TEXT NOT NULL DEFAULT 'basket',
  via           TEXT,                          -- whatsapp | telegram | agent
  draft_id      TEXT,
  deliver_day   TEXT,                          -- YYYY-MM-DD local
  deliver_time  TEXT,                          -- HH:MM
  note          TEXT,
  with_address  INTEGER,                       -- NULL = default (on for the first order to the supplier)
  text          TEXT,                          -- the message as it went out
  total_est     INTEGER,                       -- priced lines at the moment of sending
  unknown_n     INTEGER,                       -- lines without a price
  total_final   INTEGER,                       -- what the supplier said / what was paid
  reply         TEXT,                          -- the supplier's answer (agent)
  reply_tr      TEXT,
  opened_at     TEXT,
  sent_at       TEXT,
  sent_by       TEXT,
  confirmed_at  TEXT,
  confirmed_by  TEXT,                          -- user id or 'agent'
  delivered_at  TEXT,
  paid_by       TEXT,
  expense_id    TEXT,
  cancelled_at  TEXT,
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_search ON orders(search_id, status, updated_at);
-- One open basket per supplier (a supplier belongs to one search).
CREATE UNIQUE INDEX IF NOT EXISTS orders_basket ON orders(supplier_id) WHERE status='basket';

CREATE TABLE IF NOT EXISTS order_lines (
  order_id      TEXT NOT NULL REFERENCES orders(id),
  item_id       TEXT NOT NULL REFERENCES supplier_items(id),
  qty           REAL NOT NULL,
  added_by      TEXT NOT NULL,
  price         INTEGER,                       -- snapshot when the order left the basket (a basket uses the live price)
  price_unsure  INTEGER,
  name_id       TEXT,                          -- snapshots too: an old receipt never changes
  name_ru       TEXT,
  name_en       TEXT,
  at            TEXT NOT NULL,
  PRIMARY KEY (order_id, item_id)
);

-- The order's expense in Деньги (one per order, whatever is tapped twice); the app shows the receipt from it.
ALTER TABLE expenses ADD COLUMN order_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS expenses_order ON expenses(order_id) WHERE order_id IS NOT NULL;
