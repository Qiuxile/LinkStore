-- LinkStore initial schema.
-- Hashes are lowercase SHA-256 hex digests. No plaintext codes are stored.

CREATE TABLE admin_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  admin_code_hash TEXT NOT NULL
    CHECK (length(admin_code_hash) = 64 AND admin_code_hash NOT GLOB '*[^0-9a-f]*'),
  session_version INTEGER NOT NULL DEFAULT 1 CHECK (session_version >= 1),
  rotated_at TEXT NOT NULL
);

CREATE TABLE redemption_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_hash TEXT NOT NULL UNIQUE
    CHECK (length(code_hash) = 64 AND code_hash NOT GLOB '*[^0-9a-f]*'),
  target_url TEXT NOT NULL CHECK (length(target_url) BETWEEN 1 AND 2048),
  max_uses INTEGER NOT NULL CHECK (max_uses BETWEEN 1 AND 1000000),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  expires_at TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
  CHECK (used_count <= max_uses)
);

CREATE INDEX idx_redemption_codes_created_at
  ON redemption_codes (created_at DESC);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  ip TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_audit_logs_created_at
  ON audit_logs (created_at DESC);
