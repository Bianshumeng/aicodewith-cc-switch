CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  fingerprint_hash TEXT NOT NULL,
  last_seen TIMESTAMPTZ NOT NULL,
  last_ip TEXT,
  geo_country TEXT,
  geo_region TEXT,
  geo_city TEXT,
  app_version TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS config_snapshots (
  id BIGSERIAL PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_configs (
  device_id TEXT PRIMARY KEY REFERENCES devices(device_id) ON DELETE CASCADE,
  version BIGINT NOT NULL,
  config JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
