-- Better Auth rate-limit table, used with rateLimit.storage = "database" so limits hold across
-- Worker isolates (the default in-memory limiter is per isolate and barely limits anything).
CREATE TABLE IF NOT EXISTS "rateLimit" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "key" TEXT NOT NULL UNIQUE,
  "count" INTEGER NOT NULL,
  "lastRequest" INTEGER NOT NULL
);
