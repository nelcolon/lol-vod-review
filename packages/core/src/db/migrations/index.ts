/**
 * Versioned migrations. Each module exports `{ version, name, sql }`; the list must be in
 * ascending version order. `PRAGMA user_version` tracks what has been applied.
 *
 * Migrations are TS modules (not `.sql` files) so they ship inside the compiled bundle and
 * need no filesystem access at runtime (Electron asar friendly).
 */
import * as m001 from './001_init.js';
import * as m002 from './002_clip_details.js';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [m001, m002];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;
