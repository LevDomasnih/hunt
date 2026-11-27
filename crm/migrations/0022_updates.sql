-- Updates: the plugin version of the owner's agent (X-Hunt-Version) and this server's own small state (the daily update check).
-- Additive only.
ALTER TABLE searches ADD COLUMN agent_version TEXT; -- x.y.z; NULL = not reported (a plugin before 0.2.0)
CREATE TABLE IF NOT EXISTS server_state (
  key        TEXT PRIMARY KEY,               -- 'update' = {latest, checked_at, notified}
  value      TEXT NOT NULL,                  -- JSON
  updated_at TEXT NOT NULL
);
