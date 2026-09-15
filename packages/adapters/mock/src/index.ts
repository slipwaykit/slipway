/**
 * `@slipwaykit/adapter-mock` — a Slipway adapter that talks to nothing.
 *
 * It exists so that the demo works with no anchor reachable, so that the
 * conformance suite has a reference implementation that passes, and so that
 * tests of registry behaviour do not need fixtures. Every number it returns is
 * derived from its configuration, so a given config always quotes identically.
 *
 * @example
 * ```ts
 * import { MockAdapter } from '@slipwaykit/adapter-mock';
 *
 * const adapter = new MockAdapter({
 *   id: 'mock-ng',
 *   name: 'Mock Naira Ramp',
 *   country: 'NG',
 *   fiat: 'NGN',
 *   rate: '1580.00',
 *   feeFixed: '1500.00',
 *   feePercent: '0.9',
 * });
 * ```
 */

import {
  RampError,
  decimal,
  type AuthContext,
  type Capability,
  type CustomerRef,
  type CustomerStatus,
  type Direction,
  type Fee,
  type InitiateRequest,
  type InitiateResult,
  type PaymentMethod,
  type Quote,
  type QuoteRequest,
  type RampAdapter,
  type StellarAsset,
  type Transaction,
  type TransactionRef,
  type TxStatus,
} from '@slipwaykit/core';

/**
 * How a {@link MockAdapter} should behave.
 *
 * @example
 * ```ts
 * const config: MockAdapterConfig = {
 *   id: 'mock-ke',
 *   name: 'Mock Shilling Ramp',
 *   country: 'KE',
 *   fiat: 'KES',
 *   rate: '129.40',
 *   feePercent: '1.5',
 *   methods: ['mobile_money'],
 * };
 * ```
 */
export interface MockAdapterConfig {
  /** Stable adapter id. */
  readonly id: string;
  /** Display name. Defaults to a name derived from `id`. */
  readonly name?: string;
  /** Country served. */
  readonly country: string;
  /** Fiat currency served. */
  readonly fiat: string;
  /** Stellar asset served. Defaults to USDC on the SDF testnet issuer. */
  readonly asset?: StellarAsset;
  /** Directions served. Defaults to both. */
  readonly directions?: readonly Direction[];
  /** Payment methods served. Defaults to `['bank_transfer']`. */
  readonly methods?: readonly PaymentMethod[];
  /** Fiat units per asset unit, as a decimal string. */
  readonly rate: string;
  /** A flat fee, charged in the buy currency. Defaults to `'0'`. */
  readonly feeFixed?: string;
  /** A percentage fee, e.g. `'1.5'` for 1.5%. Defaults to `'0'`. */
  readonly feePercent?: string;
  /** Smallest sell amount accepted. Omitted means unbounded. */
  readonly minAmount?: string;
  /** Largest sell amount accepted. Omitted means unbounded. */
  readonly maxAmount?: string;
  /** Whether quotes claim KYC is needed. Defaults to `false`. */
  readonly kycRequired?: boolean;
  /** How long a quote stays valid, in milliseconds. Defaults to 60000. */
  readonly quoteTtlMs?: number;
  /** Artificial delay before every call resolves, in milliseconds. Defaults to 0. */
  readonly latencyMs?: number;
  /** Make every call fail with this code, to exercise error paths. */
  readonly failWith?: RampError['code'];
  /** Clock injection, for deterministic expiry in tests. */
  readonly now?: () => number;
}

const DEFAULT_ASSET: StellarAsset = {
  code: 'USDC',
  issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
};

/** The sequence of statuses a mock transaction walks through on each poll. */
const STATUS_WALK: readonly TxStatus[] = [
  'pending_user',
  'pending_provider',
  'pending_stellar',
  'completed',
];

interface MockTransaction {
  readonly id: string;
  readonly quote: Quote;
  polls: number;
}

/**
 * A ramp adapter with no network dependency.
 *
 * @example
 * ```ts
 * const adapter = new MockAdapter({ id: 'mock-ng', country: 'NG', fiat: 'NGN', rate: '1580' });
 * const quote = await adapter.quote({
 *   country: 'NG', fiat: 'NGN', asset: { code: 'USDC' },
 *   direction: 'withdraw', amount: '100', method: 'bank_transfer',
 * });
 * quote.landedAmount;  // '158000' less configured fees
 * ```
 */
export class MockAdapter implements RampAdapter {
  /** Stable adapter id, from the configuration. */
  public readonly id: string;
  /** Display name. */
  public readonly name: string;

  readonly #config: MockAdapterConfig;
  readonly #now: () => number;
  readonly #transactions = new Map<string, MockTransaction>();
  #counter = 0;

  /**
   * @param config - How this adapter should behave.
   *
   * @example
   * ```ts
   * new MockAdapter({ id: 'mock-gh', country: 'GH', fiat: 'GHS', rate: '15.80' });
   * ```
   */
  public constructor(config: MockAdapterConfig) {
    this.#config = config;
    this.id = config.id;
    this.name = config.name ?? `Mock ${config.fiat} Ramp`;
    this.#now = config.now ?? (() => Date.now());
  }

  /**
   * The single route this mock serves, one capability per direction.
   *
   * @returns The configured capabilities.
   *
   * @example
   * ```ts
   * const [deposit, withdraw] = await adapter.capabilities();
   * ```
   */
  public async capabilities(): Promise<readonly Capability[]> {
    await this.#simulate();
    const directions = this.#config.directions ?? (['deposit', 'withdraw'] as const);
    return directions.map((direction) => ({
      country: this.#config.country,
      fiat: this.#config.fiat,
      asset: this.#config.asset ?? DEFAULT_ASSET,
      direction,
      methods: this.#config.methods ?? (['bank_transfer'] as const),
      ...(this.#config.minAmount === undefined ? {} : { minAmount: this.#config.minAmount }),
      ...(this.#config.maxAmount === undefined ? {} : { maxAmount: this.#config.maxAmount }),
      kycRequired: this.#config.kycRequired ?? false,
    }));
  }

  /**
   * Price a route from the configured rate and fees.
   *
   * @param request - The route to price.
   * @returns A quote whose `landedAmount` is the gross less both fees.
   * @throws A `RampError` with `UNSUPPORTED_ROUTE` or `AMOUNT_OUT_OF_BOUNDS`.
   *
   * @example
   * ```ts
   * const quote = await adapter.quote(request);
   * ```
   */
  public async quote(request: QuoteRequest): Promise<Quote> {
    await this.#simulate();

    const capabilities = await this.capabilities();
    const match = capabilities.find(
      (capability) =>
        capability.country === request.country &&
        capability.fiat === request.fiat &&
        capability.direction === request.direction &&
        capability.asset.code === request.asset.code &&
        capability.methods.includes(request.method),
    );
    if (!match) {
      throw new RampError(
        'UNSUPPORTED_ROUTE',
        `${this.id} does not serve ${request.direction} ${request.asset.code} to ${request.fiat} in ${request.country} by ${request.method}.`,
      );
    }
    if (match.minAmount !== undefined && decimal.cmp(request.amount, match.minAmount) < 0) {
      throw new RampError(
        'AMOUNT_OUT_OF_BOUNDS',
        `Minimum is ${match.minAmount}, requested ${request.amount}.`,
      );
    }
    if (match.maxAmount !== undefined && decimal.cmp(request.amount, match.maxAmount) > 0) {
      throw new RampError(
        'AMOUNT_OUT_OF_BOUNDS',
        `Maximum is ${match.maxAmount}, requested ${request.amount}.`,
      );
    }

    // A withdraw sells the asset and buys fiat; a deposit does the reverse.
    const withdraw = request.direction === 'withdraw';
    const buyCurrency = withdraw ? request.fiat : request.asset.code;
    const rate = withdraw ? this.#config.rate : decimal.div('1', this.#config.rate, 12);
    const buyAmount = decimal.round(decimal.mul(request.amount, rate), withdraw ? 2 : 7);

    const fees: Fee[] = [];
    const feePercent = this.#config.feePercent ?? '0';
    if (decimal.cmp(feePercent, '0') > 0) {
      fees.push({
        kind: 'percent',
        amount: decimal.round(
          decimal.mul(buyAmount, decimal.div(feePercent, '100', 12)),
          withdraw ? 2 : 7,
        ),
        currency: buyCurrency,
        description: `${feePercent}% provider fee`,
      });
    }
    const feeFixed = this.#config.feeFixed ?? '0';
    if (decimal.cmp(feeFixed, '0') > 0) {
      fees.push({
        kind: 'fixed',
        amount: feeFixed,
        currency: buyCurrency,
        description: 'Flat provider fee',
      });
    }

    const landedAmount = decimal.sub(buyAmount, decimal.sum(fees.map((fee) => fee.amount)));
    if (decimal.isNegative(landedAmount)) {
      throw new RampError(
        'AMOUNT_OUT_OF_BOUNDS',
        `Fees of ${decimal.sum(fees.map((f) => f.amount))} ${buyCurrency} exceed the gross ${buyAmount} ${buyCurrency}.`,
      );
    }

    return {
      adapterId: this.id,
      request,
      sellAmount: request.amount,
      buyAmount,
      landedAmount,
      rate: decimal.normalise(rate),
      fees,
      expiresAt: this.#now() + (this.#config.quoteTtlMs ?? 60_000),
      providerQuoteId: `mock-quote-${(this.#counter += 1)}`,
    };
  }

  /**
   * Start a mock ramp. Requires a token even though nothing verifies it, so
   * that callers exercise the same auth path they would against a real anchor.
   *
   * @param request - The accepted quote and the user's token.
   * @returns A handle to poll with {@link MockAdapter.getTransaction}.
   * @throws A `RampError` with `AUTH_REQUIRED` or `QUOTE_EXPIRED`.
   *
   * @example
   * ```ts
   * const started = await adapter.initiate({ quote, auth: { token: 'anything' } });
   * ```
   */
  public async initiate(request: InitiateRequest): Promise<InitiateResult> {
    await this.#simulate();
    this.#requireAuth(request.auth);
    if (this.#now() > request.quote.expiresAt) {
      throw new RampError('QUOTE_EXPIRED', 'This quote expired before it was acted on.');
    }

    const id = `mock-tx-${(this.#counter += 1)}`;
    this.#transactions.set(id, { id, quote: request.quote, polls: 0 });
    return {
      id,
      adapterId: this.id,
      status: 'pending_user',
      interactiveUrl: `https://mock.slipway.invalid/interactive/${id}`,
    };
  }

  /**
   * Read a mock transaction. Each call advances it one step along
   * `pending_user` to `pending_provider` to `pending_stellar` to `completed`.
   *
   * @param ref - The transaction id and the user's token.
   * @returns The transaction's current state.
   * @throws A `RampError` with `AUTH_REQUIRED` or `NOT_FOUND`.
   *
   * @example
   * ```ts
   * let tx = await adapter.getTransaction({ id: started.id, auth });
   * while (tx.status !== 'completed') tx = await adapter.getTransaction({ id: started.id, auth });
   * ```
   */
  public async getTransaction(ref: TransactionRef): Promise<Transaction> {
    await this.#simulate();
    this.#requireAuth(ref.auth);

    const record = this.#transactions.get(ref.id);
    if (!record) {
      throw new RampError('NOT_FOUND', `No mock transaction with id ${ref.id}.`);
    }

    const index = Math.min(record.polls, STATUS_WALK.length - 1);
    record.polls += 1;
    const status = STATUS_WALK[index] ?? 'completed';

    return {
      id: record.id,
      adapterId: this.id,
      status,
      interactiveUrl: `https://mock.slipway.invalid/interactive/${record.id}`,
      amountIn: record.quote.sellAmount,
      amountOut: record.quote.landedAmount,
      providerStatus: status,
      ...(status === 'completed' || status === 'pending_stellar'
        ? { stellarTxHash: `mock${record.id.replace(/\W/g, '')}`.padEnd(64, '0').slice(0, 64) }
        : {}),
      updatedAt: this.#now(),
    };
  }

  /**
   * A mock verification state: approved when the adapter is configured without
   * KYC, and always outstanding on one field when it is.
   *
   * @param ref - The user's token.
   * @returns The verification state.
   *
   * @example
   * ```ts
   * const status = await adapter.customerStatus({ auth: { token } });
   * ```
   */
  public async customerStatus(ref: CustomerRef): Promise<CustomerStatus> {
    await this.#simulate();
    this.#requireAuth(ref.auth);
    if (!(this.#config.kycRequired ?? false)) {
      return { state: 'approved', fields: [] };
    }
    return {
      state: 'not_started',
      fields: [
        { name: 'first_name', type: 'string', description: 'Given name', optional: false },
        { name: 'last_name', type: 'string', description: 'Family name', optional: false },
      ],
    };
  }

  #requireAuth(auth: AuthContext | undefined): void {
    if (!auth?.token) {
      throw new RampError(
        'AUTH_REQUIRED',
        'Supply an AuthContext with a SEP-10 token. Slipway never obtains one for you.',
      );
    }
  }

  async #simulate(): Promise<void> {
    const latency = this.#config.latencyMs ?? 0;
    if (latency > 0) await new Promise((resolve) => setTimeout(resolve, latency));
    if (this.#config.failWith) {
      throw new RampError(
        this.#config.failWith,
        `${this.id} is configured to fail with ${this.#config.failWith}.`,
        { retryable: this.#config.failWith === 'PROVIDER_UNAVAILABLE' },
      );
    }
  }
}
