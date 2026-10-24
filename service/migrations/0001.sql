-- Accounting only. No images, URLs, or observations. Hash dedupe expires at 30 minutes.
CREATE TABLE reservations (
 id TEXT PRIMARY KEY, pool TEXT NOT NULL, ip_hash TEXT NOT NULL,
 session_id TEXT NOT NULL, image_sha TEXT NOT NULL, day TEXT NOT NULL,
 units INTEGER NOT NULL CHECK(units = 9), status TEXT NOT NULL DEFAULT 'reserved',
 created_at INTEGER NOT NULL
);
CREATE INDEX dedupe ON reservations(session_id,image_sha,created_at);
CREATE TABLE jobs (
 id TEXT PRIMARY KEY, state TEXT NOT NULL, mode TEXT NOT NULL,
 provider_task_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 session_id TEXT NOT NULL, error_code TEXT
);
-- Synthetic mock accounting is isolated from the real 990-unit allowance.
CREATE TABLE mock_reservations (
 id TEXT PRIMARY KEY, pool TEXT NOT NULL, ip_hash TEXT NOT NULL,
 session_id TEXT NOT NULL, image_sha TEXT NOT NULL, day TEXT NOT NULL,
 units INTEGER NOT NULL CHECK(units = 9), status TEXT NOT NULL DEFAULT 'reserved',
 created_at INTEGER NOT NULL
);
CREATE INDEX mock_dedupe ON mock_reservations(session_id,image_sha,created_at);
