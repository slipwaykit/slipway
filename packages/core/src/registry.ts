/**
 * A set of adapters queried together.
 *
 * The registry's job is to make one slow or broken provider harmless. Every
 * adapter is quoted concurrently, every failure is captured as a `RampError`
 * rather than rejecting the batch, and results come back sorted by the only
 * figure worth sorting on: the landed amount.
 */

import { cmp } from './decimal.js';
import { RampError } from './errors.js';
import type { Capability, Quote, QuoteRequest, RampAdapter } from './types.js';

/**
 * One adapter's failure to answer, recorded so the UI can show that a provider
 * was tried and did not respond rather than silently omitting it.
 *
 * @example
 * ```ts
 * const failure: QuoteFailure = {
 *   adapterId: 'sep24:example.com',
 *   adapterName: 'Example Anchor',
 *   error: new RampError('PROVIDER_UNAVAILABLE', 'Timed out after 10000ms', { retryable: true }),
 *   latencyMs: 10004,
 * };
 * ```
 */
export interface QuoteFailure {
  /** Which adapter failed. */
  readonly adapterId: string;
  /** That adapter's display name. */
  readonly adapterName: string;
  /** Why it failed. */
  readonly error: RampError;
  /** How long it took to fail, in milliseconds. */
  readonly latencyMs: number;
}

/**
 * One adapter's successful answer, with the time it took.
 *
 * @example
 * ```ts
 * const success: QuoteSuccess = { quote, latencyMs: 412 };
 * ```
 */
export interface QuoteSuccess {
  /** The quote. */
  readonly quote: Quote;
  /** How long it took to produce, in milliseconds. */
  readonly latencyMs: number;
}

/**
 * The outcome of quoting every adapter in a registry.
 *
 * Failures are data, not exceptions. `quoteAll` resolves even when every
 * adapter fails.
 *
 * @example
 * ```ts
 * const { quotes, errors } = await registry.quoteAll(request);
 * console.log(`${quotes.length} answered, ${errors.length} did not`);
 * ```
 */
export interface QuoteAllResult {
  /** Successful quotes, best landed amount first. */
  readonly quotes: readonly QuoteSuccess[];
  /** Adapters that failed, in registration order. */
  readonly errors: readonly QuoteFailure[];
}

/**
 * A set of adapters that can be queried as one.
 *
 * @example
 * ```ts
 * const registry = new AdapterRegistry([
 *   new MockAdapter({ id: 'mock-ng' }),
 *   new Sep24Adapter({ homeDomain: 'testanchor.stellar.org', country: 'NG', fiat: 'NGN' }),
 * ]);
 *
 * const { quotes, errors } = await registry.quoteAll({
 *   country: 'NG', fiat: 'NGN', asset: { code: 'USDC' },
 *   direction: 'withdraw', amount: '100', method: 'bank_transfer',
 * });
 * ```
 */
export class AdapterRegistry {
  readonly #adapters = new Map<string, RampAdapter>();
  readonly #now: () => number;

  /**
   * @param adapters - Adapters to register immediately.
   * @param options - Optional clock injection, for deterministic latency in tests.
   *
   * @example
   * ```ts
   * const registry = new AdapterRegistry([mockAdapter]);
   * ```
   */
  public constructor(
    adapters: readonly RampAdapter[] = [],
    options: { readonly now?: () => number } = {},
  ) {
    this.#now = options.now ?? (() => Date.now());
    for (const adapter of adapters) this.register(adapter);
  }

  /**
   * Add an adapter. Replaces any adapter already registered under the same id.
   *
   * @param adapter - The adapter to register.
   * @returns This registry, for chaining.
   *
   * @example
   * ```ts
   * registry.register(new MockAdapter({ id: 'mock-ke' }));
   * ```
   */
  public register(adapter: RampAdapter): this {
    this.#adapters.set(adapter.id, adapter);
    return this;
  }

  /**
   * Look one adapter up by id.
   *
   * @param id - The adapter id.
   * @returns The adapter, or `undefined` when nothing is registered under `id`.
   *
   * @example
   * ```ts
   * const adapter = registry.get('mock-ng');
   * ```
   */
  public get(id: string): RampAdapter | undefined {
    return this.#adapters.get(id);
  }

  /**
   * Every registered adapter, in registration order.
   *
   * @returns The adapters.
   *
   * @example
   * ```ts
   * for (const adapter of registry.list()) console.log(adapter.name);
   * ```
   */
  public list(): readonly RampAdapter[] {
    return [...this.#adapters.values()];
  }

  /**
   * Collect capabilities from every adapter, skipping those that fail.
   *
   * @returns Each adapter's id paired with what it says it can do.
   *
   * @example
   * ```ts
   * const all = await registry.capabilities();
   * const ngn = all.flatMap((entry) => entry.capabilities.filter((c) => c.fiat === 'NGN'));
   * ```
   */
  public async capabilities(): Promise<
    readonly { adapterId: string; capabilities: readonly Capability[]; error?: RampError }[]
  > {
    return Promise.all(
      this.list().map(async (adapter) => {
        try {
          return { adapterId: adapter.id, capabilities: await adapter.capabilities() };
        } catch (error) {
          return { adapterId: adapter.id, capabilities: [], error: RampError.from(error) };
        }
      }),
    );
  }

  /**
   * Quote every adapter concurrently and sort the winners by landed amount.
   *
   * Never rejects. A provider that throws, times out or returns nonsense
   * appears in `errors`, so a caller can show the user that it was asked.
   *
   * @param request - The route to price.
   * @returns Successful quotes sorted best-first, plus every failure.
   *
   * @example
   * ```ts
   * const { quotes, errors } = await registry.quoteAll(request);
   * const best = quotes[0]?.quote;   // largest landedAmount
   * ```
   */
  public async quoteAll(request: QuoteRequest): Promise<QuoteAllResult> {
    const quotes: QuoteSuccess[] = [];
    const errors: QuoteFailure[] = [];

    await Promise.all(
      this.list().map(async (adapter) => {
        const startedAt = this.#now();
        try {
          const quote = await adapter.quote(request);
          quotes.push({ quote, latencyMs: this.#now() - startedAt });
        } catch (error) {
          errors.push({
            adapterId: adapter.id,
            adapterName: adapter.name,
            error: RampError.from(error),
            latencyMs: this.#now() - startedAt,
          });
        }
      }),
    );

    // Descending landed amount. Sorting on `rate` would rank a provider that
    // quotes a great rate and takes it all back in fees above one that does not.
    quotes.sort((a, b) => cmp(b.quote.landedAmount, a.quote.landedAmount));
    return { quotes, errors };
  }
}
