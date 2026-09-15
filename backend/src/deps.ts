/**
 * What every route handler is given.
 *
 * Passed explicitly rather than reached for through module state, so a test can
 * build an app over an in-memory database and a fixture-backed registry without
 * touching the real ones.
 */

import type { AdapterRegistry } from '@slipwaykit/core';
import type { Db } from './db/index.js';
import type { Env } from './env.js';
import type { Logger } from './services/attestor.js';

/** Dependencies shared by the whole API. */
export interface AppDeps {
  /** Open database. */
  readonly db: Db;
  /** Adapters to quote. */
  readonly registry: AdapterRegistry;
  /** Validated configuration. */
  readonly env: Env;
  /** Where to send diagnostics. */
  readonly logger: Logger;
}

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
