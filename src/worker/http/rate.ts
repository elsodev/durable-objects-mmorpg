// Fixed-window counters in the shared "rateLimit" table (migrations/0002), under keys Better Auth
// never uses ("<feature>:<action>:<userId>"). `lastRequest` holds the window start.

/**
 * Takes one unit and returns true, or returns false (without counting) when `key` already used
 * `max` in the current window. One statement, so parallel requests can't both slip past.
 */
export async function takeQuota(db: D1Database, key: string, now: number, windowMs: number, max: number): Promise<boolean> {
  const row = await db
    .prepare(
      `INSERT INTO "rateLimit" (id, key, count, lastRequest) VALUES (?5, ?1, 1, ?2)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN "rateLimit".lastRequest <= ?2 - ?3 THEN 1 ELSE "rateLimit".count + 1 END,
         lastRequest = CASE WHEN "rateLimit".lastRequest <= ?2 - ?3 THEN ?2 ELSE "rateLimit".lastRequest END
        WHERE "rateLimit".lastRequest <= ?2 - ?3 OR "rateLimit".count < ?4
       RETURNING count`,
    )
    .bind(key, now, windowMs, max, crypto.randomUUID())
    .first<{ count: number }>();
  return !!row;
}
