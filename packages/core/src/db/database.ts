/**
 * SQLite connection (`node:sqlite`), WAL mode, versioned migrations (PLAN §3.5).
 *
 * Built on Node's own SQLite so the same code runs under plain Node (tests) and inside
 * Electron 45 (Node 24.22) without a native module: better-sqlite3 12 has no Electron 45
 * prebuild and does not compile against its V8. `SqliteDatabase` is a thin adapter that
 * keeps the better-sqlite3 surface the repository layer uses (`prepare/run/get/all`,
 * `exec`, `pragma`, `transaction`).
 */
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, SCHEMA_VERSION } from './migrations/index.js';

/** Statement surface as loosely typed as better-sqlite3's (rows are cast by the repository). */
export interface SqliteStatement {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  run(...params: any[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: any[]): any;
  all(...params: any[]): any[];
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export class SqliteDatabase {
  readonly raw: DatabaseSync;
  private depth = 0;

  constructor(path: string, options: { readonly?: boolean } = {}) {
    this.raw = new DatabaseSync(path, { readOnly: options.readonly ?? false });
  }

  prepare(sql: string): SqliteStatement {
    return this.raw.prepare(sql) as unknown as SqliteStatement;
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  /** `pragma('x = 1')`, `pragma('x')` → rows, `pragma('x', { simple: true })` → first column of the first row. */
  pragma(source: string, options: { simple?: boolean } = {}): unknown {
    const rows = this.raw.prepare(`PRAGMA ${source}`).all() as Array<Record<string, unknown>>;
    if (!options.simple) return rows;
    const first = rows[0];
    return first === undefined ? undefined : Object.values(first)[0];
  }

  /** Like better-sqlite3: returns a function that runs `fn` in a transaction (savepoints when nested). */
  transaction<A extends unknown[], T>(fn: (...args: A) => T): (...args: A) => T {
    return (...args: A): T => {
      const sp = `lvr_sp_${this.depth}`;
      this.raw.exec(this.depth === 0 ? 'BEGIN' : `SAVEPOINT ${sp}`);
      this.depth += 1;
      try {
        const out = fn(...args);
        this.depth -= 1;
        this.raw.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
        return out;
      } catch (e) {
        this.depth -= 1;
        this.raw.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
        throw e;
      }
    };
  }

  close(): void {
    this.raw.close();
  }
}

export interface OpenDatabaseOptions {
  /** Run pending migrations on open. Default true. */
  migrate?: boolean;
  /** Enable WAL (ignored for `:memory:`). Default true. */
  wal?: boolean;
  /** Busy timeout in ms. Default 5000. */
  busyTimeoutMs?: number;
  readonly?: boolean;
}

/** Open (and create) the database at `path`, or `':memory:'`. */
export function openDatabase(path: string, options: OpenDatabaseOptions = {}): SqliteDatabase {
  const db = new SqliteDatabase(path, { readonly: options.readonly ?? false });
  db.pragma(`busy_timeout = ${options.busyTimeoutMs ?? 5000}`);
  db.pragma('foreign_keys = ON');
  if ((options.wal ?? true) && path !== ':memory:' && !options.readonly) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }
  if (options.migrate ?? true) migrate(db);
  return db;
}

export function currentSchemaVersion(db: SqliteDatabase): number {
  return Number(db.pragma('user_version', { simple: true }));
}

export interface MigrationResult {
  from: number;
  to: number;
  applied: Array<{ version: number; name: string }>;
}

/** Apply all migrations above the current `user_version`, each in its own transaction. */
export function migrate(db: SqliteDatabase): MigrationResult {
  const from = currentSchemaVersion(db);
  const applied: MigrationResult['applied'] = [];
  let version = from;
  for (const m of MIGRATIONS) {
    if (m.version <= version) continue;
    if (m.version !== version + 1) throw new Error(`migration gap: have ${version}, next is ${m.version}`);
    db.transaction(() => {
      db.exec(m.sql);
      db.pragma(`user_version = ${m.version}`);
    })();
    version = m.version;
    applied.push({ version: m.version, name: m.name });
  }
  if (version > SCHEMA_VERSION) throw new Error(`database schema ${version} is newer than this build (${SCHEMA_VERSION})`);
  return { from, to: version, applied };
}
