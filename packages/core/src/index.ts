/**
 * `@slipwaykit/core` — the contract every Slipway adapter implements.
 *
 * @example
 * ```ts
 * import { AdapterRegistry, RampError, type RampAdapter } from '@slipwaykit/core';
 *
 * const registry = new AdapterRegistry([myAdapter]);
 * const { quotes, errors } = await registry.quoteAll(request);
 * ```
 */

export * from './types.js';
export * from './errors.js';
export * from './registry.js';
export * as decimal from './decimal.js';
