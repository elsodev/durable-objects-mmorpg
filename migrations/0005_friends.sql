-- Friends (src/worker/friends). Rows go away with the user (ON DELETE CASCADE; D1 enforces foreign keys).
CREATE TABLE IF NOT EXISTS "friend_request" (
  "from_id" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "to_id" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "created_at" INTEGER NOT NULL,
  PRIMARY KEY ("from_id", "to_id"),
  CHECK ("from_id" <> "to_id")
);
CREATE INDEX IF NOT EXISTS "friend_request_to_idx" ON "friend_request" ("to_id", "created_at");

-- One row per pair, smaller id first, so (a, b) and (b, a) can't both exist.
CREATE TABLE IF NOT EXISTS "friendship" (
  "a_id" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "b_id" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "created_at" INTEGER NOT NULL,
  PRIMARY KEY ("a_id", "b_id"),
  CHECK ("a_id" < "b_id")
);
CREATE INDEX IF NOT EXISTS "friendship_b_idx" ON "friendship" ("b_id");

-- Case-insensitive name lookup for "add friend by name".
CREATE INDEX IF NOT EXISTS "user_name_nocase_idx" ON "user" ("name" COLLATE NOCASE);
