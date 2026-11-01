-- Player uploads in R2, tracked here for per-user quotas and rate limits (src/worker/http/quota.ts).
CREATE TABLE IF NOT EXISTS "upload" (
  "key" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT NOT NULL,
  "bytes" INTEGER NOT NULL,
  "createdAt" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "upload_userId_idx" ON "upload" ("userId", "createdAt");
