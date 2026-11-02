-- Player feedback from the HUD's bug button (src/worker/feedback). Screenshots live in R2 under
-- the private "feedback/" prefix, which /files/* never serves; only admins read them through
-- /api/feedback/:id/screenshot. No foreign key to "user": reports outlive the guests who sent them.
CREATE TABLE IF NOT EXISTS "feedback" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "user_id" TEXT NOT NULL,
  "user_name" TEXT NOT NULL,
  "is_guest" INTEGER NOT NULL DEFAULT 0,
  "category" TEXT NOT NULL CHECK ("category" IN ('bug', 'idea', 'other')),
  "message" TEXT NOT NULL CHECK (length("message") BETWEEN 1 AND 1000),
  "screenshot_key" TEXT CHECK ("screenshot_key" IS NULL OR "screenshot_key" LIKE 'feedback/%'),
  "screenshot_type" TEXT CHECK ("screenshot_type" IS NULL OR "screenshot_type" IN ('image/png', 'image/jpeg', 'image/webp')),
  "zone" TEXT CHECK ("zone" IS NULL OR length("zone") <= 32),
  "pos_x" INTEGER,
  "pos_y" INTEGER,
  "viewport" TEXT CHECK ("viewport" IS NULL OR length("viewport") <= 24),
  "renderer" TEXT CHECK ("renderer" IS NULL OR length("renderer") <= 16),
  "user_agent" TEXT CHECK ("user_agent" IS NULL OR length("user_agent") <= 256),
  "created_at" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'new' CHECK ("status" IN ('new', 'seen', 'resolved')),
  "updated_at" INTEGER,
  "updated_by" TEXT
);
-- The admin list pages newest first (keyset on created_at, id).
CREATE INDEX IF NOT EXISTS "feedback_created_idx" ON "feedback" ("created_at", "id");
-- Per-player rate limit counts.
CREATE INDEX IF NOT EXISTS "feedback_user_idx" ON "feedback" ("user_id", "created_at");
