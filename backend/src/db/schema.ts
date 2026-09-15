/**
 * The Slipway database.
 *
 * Every money column is `text`, not `real`. SQLite's `REAL` is a double, and a
 * landed amount that survives the adapter layer as an exact decimal string only
 * to be rounded by the database would defeat the point of rule 1.
 */

import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Anchors Slipway knows about, and how they last behaved.
 *
 * `protocol` records what the anchor actually speaks. An anchor listed as
 * `sep6` is one Slipway has verified exists but cannot yet serve, which is
 * worth showing rather than hiding.
 *
 * @example
 * ```ts
 * await db.insert(anchors).values({
 *   homeDomain: 'testanchor.stellar.org',
 *   name: 'SDF Test Anchor',
 *   protocol: 'sep24',
 *   countries: 'US,CA',
 * });
 * ```
 */
export const anchors = sqliteTable('anchors', {
  /** Home domain, the anchor's identity in SEP-1. */
  homeDomain: text('home_domain').primaryKey(),
  /** Display name, from `ORG_NAME` once the TOML has been read. */
  name: text('name').notNull(),
  /** What the anchor speaks: `sep24`, `sep6`, or `unknown`. */
  protocol: text('protocol').notNull().default('unknown'),
  /** Comma-separated ISO 3166-1 alpha-2 codes. */
  countries: text('countries').notNull().default(''),
  /** When the anchor last answered, Unix epoch milliseconds. */
  lastSeenAt: integer('last_seen_at'),
  /** The `RampErrorCode` of the most recent failure, or null if the last call worked. */
  lastError: text('last_error'),
});

/**
 * A corridor: one country, currency, asset and direction.
 *
 * @example
 * ```ts
 * await db.insert(corridors).values({
 *   id: 'NG-NGN-USDC-withdraw',
 *   country: 'NG', fiat: 'NGN', assetCode: 'USDC', direction: 'withdraw',
 * });
 * ```
 */
export const corridors = sqliteTable('corridors', {
  /** `{country}-{fiat}-{assetCode}-{direction}`. */
  id: text('id').primaryKey(),
  /** ISO 3166-1 alpha-2. */
  country: text('country').notNull(),
  /** ISO 4217. */
  fiat: text('fiat').notNull(),
  /** Stellar asset code. */
  assetCode: text('asset_code').notNull(),
  /** Issuing account, null for the native asset. */
  assetIssuer: text('asset_issuer'),
  /** `deposit` or `withdraw`. */
  direction: text('direction').notNull(),
});

/**
 * One adapter's answer on one corridor at one moment, success or failure.
 *
 * Failures are recorded, not discarded: a chart of landed amounts that silently
 * omits the runs where an anchor was down overstates how reliable it is.
 *
 * @example
 * ```ts
 * await db.insert(snapshots).values({
 *   corridorId: 'NG-NGN-USDC-withdraw',
 *   adapterId: 'sep24:testanchor.stellar.org',
 *   sellAmount: '100',
 *   landedAmount: '156000',
 *   latencyMs: 412,
 *   createdAt: Date.now(),
 * });
 * ```
 */
export const snapshots = sqliteTable(
  'snapshots',
  {
    /** Autoincrementing row id. */
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Which corridor was quoted. */
    corridorId: text('corridor_id')
      .notNull()
      .references(() => corridors.id),
    /** Which adapter answered. */
    adapterId: text('adapter_id').notNull(),
    /** Notional sold, as a decimal string. */
    sellAmount: text('sell_amount').notNull(),
    /** Gross bought, as a decimal string. Null on failure. */
    buyAmount: text('buy_amount'),
    /** What would have landed, as a decimal string. Null on failure. */
    landedAmount: text('landed_amount'),
    /** Headline rate, as a decimal string. Null on failure. */
    rate: text('rate'),
    /** The fee breakdown, JSON-encoded. Null on failure. */
    feesJson: text('fees_json'),
    /** `RampErrorCode` when the adapter failed, null when it succeeded. */
    errorCode: text('error_code'),
    /** How long the call took, including failures. */
    latencyMs: integer('latency_ms').notNull(),
    /** When the snapshot was taken, Unix epoch milliseconds. */
    createdAt: integer('created_at').notNull(),
  },
  (table) => ({
    // The history endpoint reads one corridor over a time window, every time.
    corridorTime: index('snapshots_corridor_time').on(table.corridorId, table.createdAt),
  }),
);

/**
 * An on-chain record of a snapshot.
 *
 * @example
 * ```ts
 * await db.insert(attestations).values({
 *   snapshotId: 41,
 *   txHash: '17a670bc...',
 *   ledger: 1180432,
 *   createdAt: Date.now(),
 * });
 * ```
 */
export const attestations = sqliteTable(
  'attestations',
  {
    /** Autoincrementing row id. */
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Which snapshot was attested. */
    snapshotId: integer('snapshot_id')
      .notNull()
      .references(() => snapshots.id),
    /** Hash of the Soroban transaction. */
    txHash: text('tx_hash').notNull(),
    /** Ledger it was included in. */
    ledger: integer('ledger'),
    /** When it was written, Unix epoch milliseconds. */
    createdAt: integer('created_at').notNull(),
  },
  (table) => ({
    bySnapshot: index('attestations_snapshot').on(table.snapshotId),
  }),
);

/** A row read from {@link snapshots}. */
export type SnapshotRow = typeof snapshots.$inferSelect;
/** A row written to {@link snapshots}. */
export type NewSnapshot = typeof snapshots.$inferInsert;
/** A row read from {@link anchors}. */
export type AnchorRow = typeof anchors.$inferSelect;
/** A row read from {@link corridors}. */
export type CorridorRow = typeof corridors.$inferSelect;
/** A row read from {@link attestations}. */
export type AttestationRow = typeof attestations.$inferSelect;
