-- Per-account mute list (src/worker/mutes). One-way and silent: the muted player is never told.
-- Rows go away with either user (ON DELETE CASCADE; D1 enforces foreign keys).
CREATE TABLE IF NOT EXISTS "player_mute" (
  "muter_id" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "muted_id" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "created_at" INTEGER NOT NULL,
  PRIMARY KEY ("muter_id", "muted_id"),
  CHECK ("muter_id" <> "muted_id")
);
-- "Has the recipient muted this sender?" checks go by (muter_id, muted_id), the primary key; this
-- index serves the cascade when the muted user is deleted.
CREATE INDEX IF NOT EXISTS "player_mute_muted_idx" ON "player_mute" ("muted_id");
