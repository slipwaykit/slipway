/**
 * `GET /api/corridors` and `GET /api/corridors/:id/history`.
 *
 * History is what the poller has recorded, failures included. A landed-amount
 * chart that hides the runs where an anchor was down is a chart that makes an
 * unreliable anchor look good.
 */

import { Hono } from 'hono';
import { and, asc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import { attestations, corridors, snapshots } from '../db/schema.js';
import type { AppDeps, ApiErrorBody } from '../deps.js';
import { SEED_CORRIDORS } from '../services/anchors.seed.js';

const historyQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(7),
});

/** One recorded quote, or one recorded failure. */
export interface SnapshotView {
  /** Row id. */
  readonly id: number;
  /** Which adapter answered. */
  readonly adapterId: string;
  /** Its display name now, or its id if it is no longer registered. */
  readonly adapterName: string;
  /** Notional sold. */
  readonly sellAmount: string;
  /** Gross bought, null on failure. */
  readonly buyAmount: string | null;
  /** What would have landed, null on failure. */
  readonly landedAmount: string | null;
  /** Headline rate, null on failure. */
  readonly rate: string | null;
  /** Fee breakdown, null on failure. */
  readonly fees: unknown;
  /** `RampErrorCode` when the adapter failed. */
  readonly errorCode: string | null;
  /** How long it took, including failures. */
  readonly latencyMs: number;
  /** When it was recorded. */
  readonly createdAt: number;
  /** On-chain records of this snapshot. */
  readonly attestations: readonly { txHash: string; ledger: number | null }[];
}

/** One corridor, as the API renders it. */
export interface CorridorView {
  /** `{country}-{fiat}-{assetCode}-{direction}`. */
  readonly id: string;
  /** ISO 3166-1 alpha-2. */
  readonly country: string;
  /** ISO 4217. */
  readonly fiat: string;
  /** Stellar asset code. */
  readonly assetCode: string;
  /** Issuing account, or null. */
  readonly assetIssuer: string | null;
  /** `deposit` or `withdraw`. */
  readonly direction: string;
}

/**
 * The body of `GET /api/corridors`.
 *
 * @example
 * ```ts
 * const { corridors }: CorridorsResponse = await (await fetch(url)).json();
 * ```
 */
export interface CorridorsResponse {
  /** Every corridor, with the payment method the poller uses on it. */
  readonly corridors: readonly (CorridorView & { readonly pollMethod: string | null })[];
}

/**
 * The body of `GET /api/corridors/:id/history`.
 *
 * @example
 * ```ts
 * const { history }: HistoryResponse = await (await fetch(url)).json();
 * ```
 */
export interface HistoryResponse {
  /** The corridor asked about. */
  readonly corridor: CorridorView;
  /** Window size in days. */
  readonly days: number;
  /** Start of the window, Unix epoch milliseconds. */
  readonly since: number;
  /** Snapshots oldest first, failures included. */
  readonly history: readonly SnapshotView[];
}

/**
 * Build the corridors route.
 *
 * @param deps - Database.
 * @returns A Hono app to mount under `/api`.
 *
 * @example
 * ```ts
 * app.route('/api', createCorridorsRoute(deps));
 * // GET /api/corridors
 * // GET /api/corridors/NG-NGN-USDC-withdraw/history?days=7
 * ```
 */
export function createCorridorsRoute(deps: AppDeps): Hono {
  const app = new Hono();

  app.get('/corridors', async (context) => {
    const rows = await deps.db.select().from(corridors);
    const methods = new Map(SEED_CORRIDORS.map((seed) => [seed.id, seed.pollMethod]));

    const body: CorridorsResponse = {
      corridors: rows.map((row) => ({
        id: row.id,
        country: row.country,
        fiat: row.fiat,
        assetCode: row.assetCode,
        assetIssuer: row.assetIssuer,
        direction: row.direction,
        pollMethod: methods.get(row.id) ?? null,
      })),
    };
    return context.json(body);
  });

  app.get('/corridors/:id/history', async (context) => {
    const id = context.req.param('id');
    const parsed = historyQuery.safeParse(
      Object.fromEntries(new URL(context.req.url).searchParams.entries()),
    );

    if (!parsed.success) {
      const body: ApiErrorBody = {
        error: {
          code: 'INVALID_REQUEST',
          message: 'One or more query parameters are invalid.',
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      };
      return context.json(body, 400);
    }

    const [corridor] = await deps.db.select().from(corridors).where(eq(corridors.id, id));
    if (corridor === undefined) {
      const body: ApiErrorBody = {
        error: { code: 'NOT_FOUND', message: `No corridor with id ${id}.` },
      };
      return context.json(body, 404);
    }

    const since = Date.now() - parsed.data.days * 24 * 60 * 60 * 1000;
    const rows = await deps.db
      .select()
      .from(snapshots)
      .where(and(eq(snapshots.corridorId, id), gte(snapshots.createdAt, since)))
      .orderBy(asc(snapshots.createdAt));

    const proofs = await deps.db.select().from(attestations);
    const bySnapshot = new Map<number, { txHash: string; ledger: number | null }[]>();
    for (const proof of proofs) {
      const list = bySnapshot.get(proof.snapshotId) ?? [];
      list.push({ txHash: proof.txHash, ledger: proof.ledger });
      bySnapshot.set(proof.snapshotId, list);
    }

    const history: SnapshotView[] = rows.map((row) => ({
      id: row.id,
      adapterId: row.adapterId,
      adapterName: deps.registry.get(row.adapterId)?.name ?? row.adapterId,
      sellAmount: row.sellAmount,
      buyAmount: row.buyAmount,
      landedAmount: row.landedAmount,
      rate: row.rate,
      fees: row.feesJson === null ? null : safeParse(row.feesJson),
      errorCode: row.errorCode,
      latencyMs: row.latencyMs,
      createdAt: row.createdAt,
      attestations: bySnapshot.get(row.id) ?? [],
    }));

    const body: HistoryResponse = {
      corridor: {
        id: corridor.id,
        country: corridor.country,
        fiat: corridor.fiat,
        assetCode: corridor.assetCode,
        assetIssuer: corridor.assetIssuer,
        direction: corridor.direction,
      },
      days: parsed.data.days,
      since,
      history,
    };
    return context.json(body);
  });

  return app;
}

/** A fee blob that failed to parse is evidence, not a reason to fail the request. */
function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
