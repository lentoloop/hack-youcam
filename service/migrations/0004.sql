-- Cleanup snapshots are tied to the submission attempt.
ALTER TABLE jobs ADD COLUMN submission_generation INTEGER NOT NULL DEFAULT 0;
CREATE INDEX jobs_cleanup_selection ON jobs(cleanup_last_attempt_at,created_at) WHERE cleanup_status NOT IN ('deleted','not_applicable');
CREATE INDEX reservations_orphan_age ON reservations(status,created_at);
CREATE INDEX mock_reservations_orphan_age ON mock_reservations(status,created_at);
