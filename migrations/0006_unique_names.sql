-- Case-insensitive unique player names (rules in src/shared/names.ts, enforced in src/worker/auth.ts).
-- Names made before the rule may collide ignoring case; keep the oldest row's name and give the
-- others a suffix from their id so the unique index can be built.
UPDATE "user"
SET "name" = substr("name", 1, 9) || '_' || substr("id", 1, 6)
WHERE rowid NOT IN (SELECT min(rowid) FROM "user" GROUP BY lower("name"));
CREATE UNIQUE INDEX IF NOT EXISTS "user_name_lower_idx" ON "user" (lower("name"));

