-- The provider balance was 986 after 2026-10-25 19:18, while D1 starts at 990.
-- Round the four externally spent units up to one indivisible nine-unit dev run.
INSERT INTO reservations(id,pool,ip_hash,session_id,image_sha,day,units,status,created_at)
VALUES('external-dev-spend-20261025','dev','','','','2026-10-25',9,'spent',1792948680000);
