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

export type { ApiErrorBody } from './api-types.js';
