// Minimal D1Database over node:sqlite for tests: prepare/bind/first/all/run/batch, with the repo's
// migrations applied, so SQL in the Worker is exercised against a real SQLite engine.

type Sqlite = {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...p: unknown[]): unknown[];
    run(...p: unknown[]): { changes: number | bigint };
    reader?: boolean;
    columns?(): unknown[];
  };
};

// No @types/node in this repo: load Node built-ins untyped and describe only what is used.
const proc = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process;
const builtin = (id: string): unknown => proc.getBuiltinModule(id);
const { DatabaseSync } = builtin("node:sqlite") as { DatabaseSync: new (path: string) => Sqlite };
const { readdirSync, readFileSync } = builtin("node:fs") as {
  readdirSync(p: string): string[];
  readFileSync(p: string, enc: "utf8"): string;
};
const { fileURLToPath } = builtin("node:url") as { fileURLToPath(u: URL): string };
const join = (dir: string, f: string): string => `${dir}/${f}`;

const MIGRATIONS = fileURLToPath(new URL("../migrations", (import.meta as unknown as { url: string }).url));

class Stmt {
  constructor(
    private readonly db: Sqlite,
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}
  bind(...params: unknown[]): Stmt {
    return new Stmt(this.db, this.sql, params);
  }
  private returnsRows(): boolean {
    return /^\s*(SELECT|WITH)\b/i.test(this.sql) || /\bRETURNING\b/i.test(this.sql);
  }
  exec(): { results: unknown[]; meta: { changes: number } } {
    const s = this.db.prepare(this.sql);
    if (this.returnsRows()) {
      const rows = s.all(...(this.params as never[])).map((r) => ({ ...(r as object) }));
      return { results: rows, meta: { changes: rows.length } };
    }
    const r = s.run(...(this.params as never[]));
    return { results: [], meta: { changes: Number(r.changes) } };
  }
  async all() {
    return { ...this.exec(), success: true };
  }
  async run() {
    return { ...this.exec(), success: true };
  }
  async first(col?: string) {
    const row = this.exec().results[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return col ? row[col] : row;
  }
}

export interface TestDb {
  db: D1Database;
  raw: Sqlite;
  /** Inserts a user row like Better Auth would. */
  addUser(id: string, name: string, opts?: { guest?: boolean }): void;
}

export function createTestDb(): TestDb {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
    raw.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  }
  const db = {
    prepare: (sql: string) => new Stmt(raw, sql),
    async batch(stmts: Stmt[]) {
      raw.exec("BEGIN");
      try {
        const out = stmts.map((s) => ({ ...s.exec(), success: true }));
        raw.exec("COMMIT");
        return out;
      } catch (err) {
        raw.exec("ROLLBACK");
        throw err;
      }
    },
  } as unknown as D1Database;
  let n = 0;
  return {
    db,
    raw,
    addUser(id, name, opts = {}) {
      raw
        .prepare(`INSERT INTO "user" (id, name, email, createdAt, updatedAt, isAnonymous) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, name, `${id}@test.local`, 1000 + n, 1000 + n++, opts.guest ? 1 : 0);
    },
  };
}
