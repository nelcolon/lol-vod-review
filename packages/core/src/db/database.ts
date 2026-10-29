/**
 * SQLite connection (better-sqlite3), WAL mode, versioned migrations (PLAN §3.5).
 *
 * `better-sqlite3@12` ships prebuilt binaries for Windows Node 24 — verified to load here
 * (SQLite 3.53). If a future Node/Electron ABI has no prebuild, `electron-rebuild` or the
 * `node:sqlite` built-in are the fallbacks; the repository layer only uses `prepare/run/
 * get/all/transaction`, so swapping is contained to this file.
 */
import Database from 'better-sqlite3';
import { MIGRATIONS, SCHEMA_VERSION } from './migrations/index.js';

export type SqliteDatabase = Database.Database;

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
  const db = new Database(path, options.readonly ? { readonly: true } : {});
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
