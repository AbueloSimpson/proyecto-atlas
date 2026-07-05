-- Optional manual init (the worker's sync also creates these if missing):
--   wrangler d1 execute atlas --file schema.sql
CREATE TABLE IF NOT EXISTS channels (
  id TEXT NOT NULL,
  number INTEGER NOT NULL,
  name TEXT NOT NULL,
  logo TEXT,
  url TEXT NOT NULL,
  quality TEXT,
  provider TEXT NOT NULL,
  group_type TEXT NOT NULL,
  group_code TEXT NOT NULL,
  group_name TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (id, group_type, group_code)
);
CREATE INDEX IF NOT EXISTS idx_channels_group ON channels(group_type, group_code, position);
CREATE INDEX IF NOT EXISTS idx_channels_provider ON channels(provider);
CREATE INDEX IF NOT EXISTS idx_channels_number ON channels(number);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
