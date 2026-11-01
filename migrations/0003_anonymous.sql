-- Better Auth anonymous plugin: marks guest users (user.isAnonymous, boolean stored as 0/1).
ALTER TABLE "user" ADD COLUMN "isAnonymous" INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS "user_isAnonymous_idx" ON "user" ("isAnonymous");
