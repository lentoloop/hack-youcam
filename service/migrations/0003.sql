-- Server-only provider cleanup metadata; no image/result content.
ALTER TABLE jobs ADD COLUMN cleanup_status TEXT NOT NULL DEFAULT 'pending' CHECK(cleanup_status IN ('pending','deleted','failed','not_applicable','unknown_task'));
ALTER TABLE jobs ADD COLUMN cleanup_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN cleanup_last_attempt_at TEXT;
ALTER TABLE jobs ADD COLUMN submit_started INTEGER NOT NULL DEFAULT 0;
