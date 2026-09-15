/**
 * Database connection and schema creation.
 *
 * SQLite through better-sqlite3, which is synchronous and single-file. For an
 * MVP that writes a few hundred rows a day and reads them back for a chart,
 * anything more is operational overhead with no benefit.
 */

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

/** The Drizzle handle, with the schema bound to it. */
export type Db = BetterSQLite3Database<typeof schema>;

/** An open database, and the handle needed to close it. */
export interface Connection {
  /** Query with this. */
  readonly db: Db;
  /** Close the underlying file handle. */
  readonly close: () => void;
}

/**
 * `CREATE TABLE IF NOT EXISTS` for the whole schema.
 *
 * Kept as plain SQL rather than pulled in through drizzle-kit: four tables that
 * are created once at startup do not justify a migration toolchain, and this
 * way the shape of the database is readable in one place.
 */
const DDL = `
CREATE TABLE IF NOT EXISTS anchors (
  home_domain   TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  protocol      TEXT NOT NULL DEFAULT 'unknown',
  countries     TEXT NOT NULL DEFAULT '',
  last_seen_at  INTEGER,
  last_error    TEXT
);

CREATE TABLE IF NOT EXISTS corridors (
  id            TEXT PRIMARY KEY,
  country       TEXT NOT NULL,
  fiat          TEXT NOT NULL,
  asset_code    TEXT NOT NULL,
  asset_issuer  TEXT,
  direction     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  corridor_id   TEXT NOT NULL REFERENCES corridors(id),
  adapter_id    TEXT NOT NULL,
  sell_amount   TEXT NOT NULL,
  buy_amount    TEXT,
  landed_amount TEXT,
  rate          TEXT,
  fees_json     TEXT,
  error_code    TEXT,
  latency_ms    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS snapshots_corridor_time ON snapshots (corridor_id, created_at);

CREATE TABLE IF NOT EXISTS attestations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id  INTEGER NOT NULL REFERENCES snapshots(id),
  tx_hash      TEXT NOT NULL,
  ledger       INTEGER,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS attestations_snapshot ON attestations (snapshot_id);
`;

/**
 * Open the database and make sure the schema exists.
 *
 * @param path - File path, or `:memory:` for an ephemeral database.
 * @returns The Drizzle handle and a close function.
 *
 * @example
 * ```ts
 * const { db, close } = createDb(':memory:');
 * const rows = await db.select().from(schema.anchors);
 * close();
 * ```
 */
export function createDb(path: string): Connection {
  const sqlite = new Database(path);

  // WAL keeps the poller's writes from blocking the API's reads.
  if (path !== ':memory:') sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(DDL);

  const db = drizzle(sqlite, { schema });
  return { db, close: () => sqlite.close() };
}

export * as schema from './schema.js';
export {
  anchors,
  attestations,
  corridors,
  snapshots,
  type AnchorRow,
  type AttestationRow,
  type CorridorRow,
  type NewSnapshot,
  type SnapshotRow,
} from './schema.js';
