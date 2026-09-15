/**
 * The scheduled corridor poller.
 *
 * Every fifteen minutes it quotes a fixed notional across every registered
 * adapter on every corridor, and records what happened — including the
 * failures, because a chart that quietly omits the runs where an anchor was
 * down overstates how reliable that anchor is.
 *
 * Each corridor runs inside its own try/catch. One corridor that throws
 * something unexpected must not stop the other five from being recorded.
 */

import cron, { type ScheduledTask } from 'node-cron';
import { eq } from 'drizzle-orm';
import { RampError, type AdapterRegistry, type QuoteRequest } from '@slipwaykit/core';
import type { Db } from '../db/index.js';
import { anchors, attestations, corridors, snapshots } from '../db/schema.js';
import type { Env } from '../env.js';
import { SEED_ANCHORS, SEED_CORRIDORS, type SeedCorridor } from './anchors.seed.js';
import { homeDomainOf } from './registry.js';
import type { Attestor, Logger } from './attestor.js';

/** What the poller needs to run. */
export interface PollerDeps {
  /** Open database. */
  readonly db: Db;
  /** Adapters to quote. */
  readonly registry: AdapterRegistry;
  /** Where successful snapshots go. */
  readonly attestor: Attestor;
  /** Validated configuration. */
  readonly env: Env;
  /** Where to send diagnostics. */
  readonly logger: Logger;
  /** Clock replacement, injected by the test suite. */
  readonly now?: () => number;
  /** Corridors to poll. Defaults to {@link SEED_CORRIDORS}. */
  readonly corridors?: readonly SeedCorridor[];
}

/** What one run did. */
export interface PollSummary {
  /** How many corridors were attempted. */
  readonly corridors: number;
  /** How many snapshot rows were written, successes and failures together. */
  readonly snapshots: number;
  /** How many of those were successful quotes. */
  readonly successes: number;
  /** How many attestations were written on chain. */
  readonly attested: number;
  /** Corridors that threw something the poller did not expect. */
  readonly failed: readonly string[];
}

/**
 * Write the seed anchors and corridors into the database if they are not there.
 *
 * Idempotent, so it can run on every startup.
 *
 * @param db - Open database.
 * @returns Nothing.
 *
 * @example
 * ```ts
 * await seedDatabase(db);
 * ```
 */
export async function seedDatabase(db: Db): Promise<void> {
  for (const anchor of SEED_ANCHORS) {
    await db
      .insert(anchors)
      .values({
        homeDomain: anchor.homeDomain,
        name: anchor.name,
        protocol: anchor.protocol,
        countries: anchor.countries.join(','),
      })
      .onConflictDoNothing();
  }

  for (const corridor of SEED_CORRIDORS) {
    await db
      .insert(corridors)
      .values({
        id: corridor.id,
        country: corridor.country,
        fiat: corridor.fiat,
        assetCode: corridor.assetCode,
        assetIssuer: corridor.assetIssuer ?? null,
        direction: corridor.direction,
      })
      .onConflictDoNothing();
  }
}

/**
 * Run one polling pass over every corridor.
 *
 * Never rejects. A corridor that throws is counted in `failed` and the run
 * continues.
 *
 * @param deps - Database, registry, attestor and configuration.
 * @returns What the run did.
 *
 * @example
 * ```ts
 * const summary = await runPoll({ db, registry, attestor, env, logger });
 * console.log(`${summary.successes}/${summary.snapshots} quotes succeeded`);
 * ```
 */
export async function runPoll(deps: PollerDeps): Promise<PollSummary> {
  const now = deps.now ?? ((): number => Date.now());
  const list = deps.corridors ?? SEED_CORRIDORS;

  let written = 0;
  let successes = 0;
  let attested = 0;
  const failed: string[] = [];

  for (const corridor of list) {
    try {
      const request: QuoteRequest = {
        country: corridor.country,
        fiat: corridor.fiat,
        asset: {
          code: corridor.assetCode,
          ...(corridor.assetIssuer === undefined ? {} : { issuer: corridor.assetIssuer }),
        },
        direction: corridor.direction,
        amount: deps.env.SLIPWAY_POLL_NOTIONAL,
        method: corridor.pollMethod,
      };

      const { quotes, errors } = await deps.registry.quoteAll(request);
      const createdAt = now();

      for (const { quote, latencyMs } of quotes) {
        const [row] = await deps.db
          .insert(snapshots)
          .values({
            corridorId: corridor.id,
            adapterId: quote.adapterId,
            sellAmount: quote.sellAmount,
            buyAmount: quote.buyAmount,
            landedAmount: quote.landedAmount,
            rate: quote.rate,
            feesJson: JSON.stringify(quote.fees),
            errorCode: null,
            latencyMs,
            createdAt,
          })
          .returning({ id: snapshots.id });

        written += 1;
        successes += 1;
        await markAnchorSeen(deps.db, quote.adapterId, createdAt, null);

        // Attestation is best effort and must never block the run.
        if (row !== undefined && deps.attestor.enabled) {
          const result = await deps.attestor.attest({
            adapterId: quote.adapterId,
            corridorId: corridor.id,
            sellAmount: quote.sellAmount,
            landedAmount: quote.landedAmount,
            latencyMs,
            success: true,
          });
          if (result !== undefined) {
            await deps.db.insert(attestations).values({
              snapshotId: row.id,
              txHash: result.txHash,
              ledger: result.ledger ?? null,
              createdAt: now(),
            });
            attested += 1;
          }
        }
      }

      for (const failure of errors) {
        await deps.db.insert(snapshots).values({
          corridorId: corridor.id,
          adapterId: failure.adapterId,
          sellAmount: deps.env.SLIPWAY_POLL_NOTIONAL,
          buyAmount: null,
          landedAmount: null,
          rate: null,
          feesJson: null,
          errorCode: failure.error.code,
          latencyMs: failure.latencyMs,
          createdAt,
        });
        written += 1;
        await markAnchorSeen(deps.db, failure.adapterId, createdAt, failure.error.code);
      }
    } catch (error) {
      // One bad corridor cannot stop the run.
      failed.push(corridor.id);
      deps.logger.warn('[poller] corridor failed', {
        corridorId: corridor.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  deps.logger.info('[poller] run complete', {
    corridors: list.length,
    snapshots: written,
    successes,
    attested,
    failed: failed.length,
  });

  return { corridors: list.length, snapshots: written, successes, attested, failed };
}

/**
 * Error codes that mean the anchor itself could not be reached.
 *
 * Everything else — `UNSUPPORTED_ROUTE`, `AMOUNT_OUT_OF_BOUNDS`,
 * `QUOTE_INCOMPLETE` — means the anchor answered perfectly well and simply
 * cannot price this particular request. Recording those as health failures
 * would paint every anchor red the moment it is asked about a corridor it was
 * never going to serve.
 */
const UNREACHABLE_CODES = new Set(['PROVIDER_UNAVAILABLE', 'RATE_LIMITED']);

/** Record that an anchor answered, or did not, so `/api/anchors` can show health. */
async function markAnchorSeen(
  db: Db,
  adapterId: string,
  at: number,
  errorCode: string | null,
): Promise<void> {
  const homeDomain = homeDomainOf(adapterId);
  // Mock adapters have no anchor row and no health worth reporting.
  if (homeDomain === undefined) return;

  const unreachable = errorCode !== null && UNREACHABLE_CODES.has(errorCode);

  await db
    .update(anchors)
    .set(
      unreachable
        ? { lastError: errorCode }
        : // The anchor responded, so it was seen, whatever it said about the route.
          { lastSeenAt: at, lastError: null },
    )
    .where(eq(anchors.homeDomain, homeDomain));
}

/**
 * Start the scheduled poller.
 *
 * @param deps - What {@link runPoll} needs.
 * @returns The scheduled task, so a caller can stop it.
 *
 * @example
 * ```ts
 * const task = startPoller({ db, registry, attestor, env, logger });
 * process.on('SIGTERM', () => task.stop());
 * ```
 */
export function startPoller(deps: PollerDeps): ScheduledTask {
  const task = cron.schedule(deps.env.SLIPWAY_POLL_CRON, () => {
    void runPoll(deps).catch((error: unknown) => {
      // runPoll already swallows per-corridor failures; this is the last resort.
      deps.logger.warn('[poller] run failed', {
        reason: error instanceof Error ? error.message : String(error),
      });
    });
  });

  deps.logger.info('[poller] scheduled', { cron: deps.env.SLIPWAY_POLL_CRON });
  return task;
}

/** Re-exported so callers can narrow a recorded `errorCode` back to a `RampErrorCode`. */
export { RampError };
