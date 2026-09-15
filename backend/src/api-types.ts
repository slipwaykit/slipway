/**
 * The HTTP contract: every response body the API returns.
 *
 * This file imports nothing at runtime and nothing from Hono, Drizzle or Zod,
 * so a consumer — the frontend — can type-check against it without installing
 * the backend's server dependencies. The routes import their shapes from here,
 * which keeps the contract and the implementation from drifting apart.
 *
 * @example
 * ```ts
 * import type { QuotesResponse } from '../../backend/src/api-types';
 * ```
 */

import type { QuoteRequest } from '@slipwaykit/core';

/**
 * The machine-readable body returned for every 4xx and 5xx.
 *
 * Shaped so a client can branch on `error.code` without parsing prose, which is
 * the same contract `RampError` offers inside the library.
 *
 * @example
 * ```ts
 * const body: ApiErrorBody = {
 *   error: {
 *     code: 'INVALID_REQUEST',
 *     message: 'One or more query parameters are invalid.',
 *     issues: [{ path: 'amount', message: 'must be a decimal string' }],
 *   },
 * };
 * ```
 */
export interface ApiErrorBody {
  readonly error: {
    /** A stable, machine-readable code. */
    readonly code: string;
    /** A sentence a developer can act on. */
    readonly message: string;
    /** Per-field problems, when the failure was validation. */
    readonly issues?: readonly { path: string; message: string }[];
  };
}

/** One adapter's answer, as the API renders it. */
export interface QuoteView {
  /** Which adapter answered. */
  readonly adapterId: string;
  /** Its display name. */
  readonly adapterName: string;
  /** Whether this is an illustrative demo rate rather than a live anchor. */
  readonly isMock: boolean;
  /** Amount sold. */
  readonly sellAmount: string;
  /** Gross bought, before the fees listed below. */
  readonly buyAmount: string;
  /** What the recipient actually receives. Sort on this. */
  readonly landedAmount: string;
  /** Headline rate, before fees. */
  readonly rate: string;
  /** Every deduction between `buyAmount` and `landedAmount`. */
  readonly fees: readonly { kind: string; amount: string; currency: string; description?: string }[];
  /** Unix epoch milliseconds after which this must not be acted on. */
  readonly expiresAt: number;
  /** The anchor's own quote id, when it issued one. */
  readonly providerQuoteId?: string;
  /** How long the quote took. */
  readonly latencyMs: number;
}

/** One adapter's failure, as the API renders it. */
export interface QuoteErrorView {
  /** Which adapter failed. */
  readonly adapterId: string;
  /** Its display name. */
  readonly adapterName: string;
  /** Whether this is a demo adapter. */
  readonly isMock: boolean;
  /** A `RampErrorCode`. The UI translates this into plain language. */
  readonly code: string;
  /** A developer-facing explanation. */
  readonly message: string;
  /** Whether calling again later could plausibly succeed. */
  readonly retryable: boolean;
  /** How long it took to fail. */
  readonly latencyMs: number;
}

/**
 * The body of `GET /api/quotes`.
 *
 * @example
 * ```ts
 * const body: QuotesResponse = await (await fetch(url)).json();
 * const best = body.quotes[0];   // largest landedAmount
 * ```
 */
export interface QuotesResponse {
  /** The request as the API understood it, amount still a string. */
  readonly request: QuoteRequest;
  /** Successful quotes, best landed amount first. */
  readonly quotes: readonly QuoteView[];
  /** Adapters that were asked and did not produce a quote. */
  readonly errors: readonly QuoteErrorView[];
  /** When the comparison ran, Unix epoch milliseconds. */
  readonly queriedAt: number;
}

/** One anchor, with its capability summary and health. */
export interface AnchorView {
  /** Home domain. */
  readonly homeDomain: string;
  /** Display name. */
  readonly name: string;
  /** What the domain advertises: `sep24`, `sep6` or `unknown`. */
  readonly protocol: string;
  /** Whether Slipway has an adapter that can serve it. */
  readonly usable: boolean;
  /** Countries this anchor is understood to serve. */
  readonly countries: readonly string[];
  /** Fiat currencies it is understood to serve. */
  readonly fiats: readonly string[];
  /** When it last answered, Unix epoch milliseconds, or null. */
  readonly lastSeenAt: number | null;
  /** The `RampErrorCode` of its most recent failure, or null. */
  readonly lastError: string | null;
  /** Where the entry came from. */
  readonly source: string;
  /** `YYYY-MM-DD` the home domain was last verified. */
  readonly checkedAt: string;
  /** Any caveat worth showing, such as why it is not usable. */
  readonly note?: string;
  /** What its live `/info` advertises, when it could be read. */
  readonly capabilities?: readonly {
    direction: string;
    assetCode: string;
    methods: readonly string[];
    minAmount?: string;
    maxAmount?: string;
    kycRequired: boolean;
  }[];
  /** Why the capability summary is missing, when it is. */
  readonly capabilityError?: string;
}

/**
 * The body of `GET /api/anchors`.
 *
 * @example
 * ```ts
 * const { anchors }: AnchorsResponse = await (await fetch(url)).json();
 * ```
 */
export interface AnchorsResponse {
  /** Every seeded anchor, usable or not. */
  readonly anchors: readonly AnchorView[];
}

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
