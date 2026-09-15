/**
 * Building the adapter registry the API and the poller both query.
 *
 * Two sources feed it. Every seeded anchor advertising SEP-24 becomes a
 * `Sep24Adapter`, one per corridor it serves, because SEP-24 has no field
 * stating which fiat an asset maps to. Alongside those sit clearly-labelled
 * mock adapters for the four African corridors, so the comparison UI has
 * something to compare while no live SEP-24 anchor serves them.
 */

import { AdapterRegistry, type RampAdapter } from '@slipwaykit/core';
import { MockAdapter } from '@slipwaykit/adapter-mock';
import { Sep24Adapter } from '@slipwaykit/adapter-sep24';
import { SEED_ANCHORS, type SeedAnchor } from './anchors.seed.js';

/** How to build a registry. */
export interface RegistryOptions {
  /** Anchors to build SEP-24 adapters from. Defaults to {@link SEED_ANCHORS}. */
  readonly anchors?: readonly SeedAnchor[];
  /** Include the mock adapters for the African corridors. Defaults to `true`. */
  readonly includeMocks?: boolean;
  /** `fetch` replacement, injected by the test suite. */
  readonly fetchImpl?: typeof fetch;
  /** Clock replacement, injected by the test suite. */
  readonly now?: () => number;
}

/**
 * Illustrative rates for the mock adapters.
 *
 * These are **not** market data and must never be presented as though they
 * were. They exist so the comparison UI has more than one row on a corridor no
 * live SEP-24 anchor serves yet. Every adapter built from this table has an id
 * beginning `mock:`, and the UI labels them accordingly.
 */
const MOCK_CORRIDORS = [
  { country: 'NG', fiat: 'NGN', rate: '1580.00', feePercent: '1.2', feeFixed: '500', methods: ['bank_transfer', 'ussd'] },
  { country: 'NG', fiat: 'NGN', rate: '1602.50', feePercent: '2.5', feeFixed: '0', methods: ['bank_transfer'] },
  { country: 'KE', fiat: 'KES', rate: '129.40', feePercent: '1.5', feeFixed: '0', methods: ['mobile_money'] },
  { country: 'KE', fiat: 'KES', rate: '128.10', feePercent: '0.5', feeFixed: '20', methods: ['mobile_money', 'bank_transfer'] },
  { country: 'GH', fiat: 'GHS', rate: '15.80', feePercent: '1.8', feeFixed: '2', methods: ['mobile_money'] },
  { country: 'ZA', fiat: 'ZAR', rate: '18.45', feePercent: '0.9', feeFixed: '5', methods: ['bank_transfer'] },
] as const;

/**
 * Build the registry.
 *
 * @param options - Which anchors, whether to include mocks, and what to inject.
 * @returns A registry holding one adapter per anchor per corridor.
 *
 * @example
 * ```ts
 * const registry = buildRegistry();
 * const { quotes, errors } = await registry.quoteAll(request);
 * ```
 */
export function buildRegistry(options: RegistryOptions = {}): AdapterRegistry {
  const adapters: RampAdapter[] = [];
  const seeds = options.anchors ?? SEED_ANCHORS;

  for (const anchor of seeds) {
    // Only SEP-24 anchors get an adapter. A seeded SEP-6 anchor is recorded for
    // the /api/anchors listing but has nothing to serve quotes with yet.
    if (anchor.protocol !== 'sep24') continue;

    for (const country of anchor.countries) {
      for (const fiat of anchor.fiats) {
        adapters.push(
          new Sep24Adapter({
            homeDomain: anchor.homeDomain,
            country,
            fiat,
            // One anchor, many corridors. Without a distinct id per corridor,
            // the registry's id map keeps only the last one built.
            id: `sep24:${anchor.homeDomain}:${country}-${fiat}`,
            ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
            ...(options.now === undefined ? {} : { now: options.now }),
          }),
        );
      }
    }
  }

  if (options.includeMocks ?? true) {
    MOCK_CORRIDORS.forEach((corridor, position) => {
      adapters.push(
        new MockAdapter({
          id: `mock:${corridor.country.toLowerCase()}-${position}`,
          name: `Demo ${corridor.fiat} Ramp ${position + 1}`,
          country: corridor.country,
          fiat: corridor.fiat,
          rate: corridor.rate,
          feePercent: corridor.feePercent,
          feeFixed: corridor.feeFixed,
          methods: [...corridor.methods],
          minAmount: '1',
          maxAmount: '100000',
          ...(options.now === undefined ? {} : { now: options.now }),
        }),
      );
    });
  }

  return new AdapterRegistry(adapters, options.now === undefined ? {} : { now: options.now });
}

/**
 * Whether an adapter is one of the illustrative mocks.
 *
 * The API marks these in its responses so that no consumer can mistake a demo
 * rate for a real one.
 *
 * @param adapterId - The adapter's id.
 * @returns Whether it is a mock.
 *
 * @example
 * ```ts
 * isMockAdapter('mock:ng-0');                  // true
 * isMockAdapter('sep24:testanchor.stellar.org'); // false
 * ```
 */
export function isMockAdapter(adapterId: string): boolean {
  return adapterId.startsWith('mock:');
}

/**
 * Recover an anchor's home domain from a SEP-24 adapter id.
 *
 * @param adapterId - An adapter id, e.g. `sep24:testanchor.stellar.org`.
 * @returns The home domain, or `undefined` for a non-SEP-24 adapter.
 *
 * @example
 * ```ts
 * homeDomainOf('sep24:mykobo.co');         // 'mykobo.co'
 * homeDomainOf('sep24:mykobo.co:DE-EUR');  // 'mykobo.co'
 * ```
 */
export function homeDomainOf(adapterId: string): string | undefined {
  if (!adapterId.startsWith('sep24:')) return undefined;
  // Either `sep24:{homeDomain}` or `sep24:{homeDomain}:{country}-{fiat}`.
  return adapterId.split(':')[1];
}
