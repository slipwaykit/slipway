/**
 * `@slipwaykit/adapter-sep24` — one adapter class for every SEP-24 anchor.
 *
 * Nothing about a particular anchor is compiled in. Give the adapter a home
 * domain and it discovers the rest through SEP-1: the SEP-24 transfer server,
 * the SEP-38 quote server, the SEP-12 KYC server and the assets on offer. This
 * is what makes Slipway a Stellar project rather than a per-provider
 * integration kit.
 *
 * @example
 * ```ts
 * import { Sep24Adapter } from '@slipwaykit/adapter-sep24';
 *
 * const adapter = new Sep24Adapter({
 *   homeDomain: 'testanchor.stellar.org',
 *   country: 'NG',
 *   fiat: 'NGN',
 * });
 *
 * const quote = await adapter.quote({
 *   country: 'NG', fiat: 'NGN', asset: { code: 'SRT' },
 *   direction: 'withdraw', amount: '100', method: 'bank_transfer',
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
  type CustomerState,
  type FieldSpec,
  type InitiateRequest,
  type InitiateResult,
  type Quote,
  type QuoteRequest,
  type RampAdapter,
  type Transaction,
  type TransactionRef,
} from '@slipwaykit/core';

import { requestJson, type FetchLike } from './errors.js';
import { mapPaymentMethod, parseInfo, toCapabilities, type AnchorInfo } from './info.js';
import { asArray, asBoolean, asDecimalString, asRecord, asString } from './json.js';
import {
  priceViaInfo,
  priceViaSep38,
  toSep38FiatAsset,
  toSep38StellarAsset,
  type PricedQuote,
} from './quote.js';
import { mapStatus } from './status.js';
import { fetchAnchorToml, type AnchorToml } from './toml.js';

export { mapHttpError, mapTransportError, requestJson, REQUEST_TIMEOUT_MS } from './errors.js';
export type { FetchLike, RequestOptions } from './errors.js';
export { mapPaymentMethod, parseInfo, toCapabilities } from './info.js';
export type { AnchorInfo, AssetInfo } from './info.js';
export { priceViaInfo, priceViaSep38, toSep38FiatAsset, toSep38StellarAsset } from './quote.js';
export type { InfoPriceOptions, PricedQuote, Sep38PriceOptions } from './quote.js';
export { isTerminal, knownSep24Statuses, mapStatus } from './status.js';
export { fetchAnchorToml } from './toml.js';
export type { AnchorToml, TomlCurrency } from './toml.js';

/**
 * How to reach one anchor.
 *
 * `fetchImpl` and `now` exist so that tests inject recorded fixtures and a
 * fake clock. Nothing in the test suite touches a network (rule 7).
 *
 * @example
 * ```ts
 * const config: Sep24AdapterConfig = {
 *   homeDomain: 'testanchor.stellar.org',
 *   country: 'NG',
 *   fiat: 'NGN',
 *   fetchImpl: fixtureFetch,
 *   now: () => 1_757_942_400_000,
 * };
 * ```
 */
export interface Sep24AdapterConfig {
  /** The anchor's home domain, with no scheme, e.g. `testanchor.stellar.org`. */
  readonly homeDomain: string;
  /** ISO 3166-1 alpha-2 country this adapter is being used for. */
  readonly country: string;
  /** ISO 4217 fiat currency this adapter is being used for. */
  readonly fiat: string;
  /** `fetch` replacement. Defaults to the global `fetch`. */
  readonly fetchImpl?: FetchLike;
  /** Clock replacement. Defaults to `Date.now`. */
  readonly now?: () => number;
}

/** SEP-12 status strings, mapped onto {@link CustomerState}. */
const CUSTOMER_STATE_MAP: Readonly<Record<string, CustomerState>> = {
  NEEDS_INFO: 'not_started',
  PROCESSING: 'pending',
  ACCEPTED: 'approved',
  REJECTED: 'rejected',
};

const FIELD_TYPES = new Set(['string', 'number', 'date', 'binary']);

/**
 * A {@link RampAdapter} backed by any SEP-24 anchor.
 *
 * @example
 * ```ts
 * const adapter = new Sep24Adapter({
 *   homeDomain: 'testanchor.stellar.org',
 *   country: 'NG',
 *   fiat: 'NGN',
 * });
 *
 * const capabilities = await adapter.capabilities();
 * const quote = await adapter.quote(request);
 * const started = await adapter.initiate({ quote, auth: { token } });
 * const tx = await adapter.getTransaction({ id: started.id, auth: { token } });
 * ```
 */
export class Sep24Adapter implements RampAdapter {
  /** `sep24:{homeDomain}`, stable for the life of the anchor. */
  public readonly id: string;

  readonly #config: Sep24AdapterConfig;
  readonly #fetch: FetchLike;
  readonly #now: () => number;

  /** Cached as promises so concurrent callers share one round trip, not three. */
  #tomlPromise: Promise<AnchorToml> | undefined;
  #infoPromise: Promise<AnchorInfo> | undefined;
  #orgName: string | undefined;

  /**
   * Performs no I/O. Every network call happens lazily, on the first method
   * that needs it.
   *
   * @param config - Which anchor, which corridor, and what to inject.
   *
   * @example
   * ```ts
   * const adapter = new Sep24Adapter({
   *   homeDomain: 'testanchor.stellar.org', country: 'NG', fiat: 'NGN',
   * });
   * ```
   */
  public constructor(config: Sep24AdapterConfig) {
    this.#config = config;
    this.#fetch = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.#now = config.now ?? (() => Date.now());
    this.id = `sep24:${config.homeDomain}`;
  }

  /**
   * The anchor's `ORG_NAME` once its `stellar.toml` has been read, and its home
   * domain before that.
   *
   * @example
   * ```ts
   * adapter.name;                    // 'testanchor.stellar.org'
   * await adapter.capabilities();
   * adapter.name;                    // 'Stellar Development Foundation'
   * ```
   */
  public get name(): string {
    return this.#orgName ?? this.#config.homeDomain;
  }

  /**
   * Resolve the anchor's `stellar.toml`, once per instance.
   *
   * @returns The fields Slipway acts on.
   * @throws A `RampError` with `PROVIDER_UNAVAILABLE`.
   *
   * @example
   * ```ts
   * const toml = await adapter.toml();
   * toml.quoteServer;  // undefined when the anchor runs no SEP-38
   * ```
   */
  public async toml(): Promise<AnchorToml> {
    this.#tomlPromise ??= fetchAnchorToml(this.#config.homeDomain, this.#fetch).then((toml) => {
      this.#orgName = toml.orgName;
      return toml;
    });
    try {
      return await this.#tomlPromise;
    } catch (error) {
      // Do not cache a failure: the anchor may come back up before the next poll.
      this.#tomlPromise = undefined;
      throw RampError.from(error);
    }
  }

  /**
   * Fetch and parse SEP-24 `/info`, once per instance.
   *
   * @returns The parsed `/info`.
   * @throws A `RampError`.
   *
   * @example
   * ```ts
   * const info = await adapter.info();
   * info.withdraw.get('SRT')?.feePercent;
   * ```
   */
  public async info(): Promise<AnchorInfo> {
    this.#infoPromise ??= (async (): Promise<AnchorInfo> => {
      const toml = await this.toml();
      const body = await requestJson({
        url: `${toml.transferServer}/info`,
        context: 'SEP-24 GET /info',
        fetchImpl: this.#fetch,
      });
      return parseInfo(body);
    })();
    try {
      return await this.#infoPromise;
    } catch (error) {
      this.#infoPromise = undefined;
      throw RampError.from(error);
    }
  }

  /**
   * Every route this anchor advertises for the configured country and fiat.
   *
   * @returns One capability per enabled asset per direction.
   * @throws A `RampError` with `PROVIDER_UNAVAILABLE` when the anchor cannot be reached.
   *
   * @example
   * ```ts
   * const capabilities = await adapter.capabilities();
   * capabilities.map((c) => `${c.direction} ${c.asset.code}`);
   * ```
   */
  public async capabilities(): Promise<readonly Capability[]> {
    const [toml, info] = [await this.toml(), await this.info()];
    return toCapabilities(info, toml, this.#config.country, this.#config.fiat);
  }

  /**
   * Price a route, SEP-38 first and SEP-24 `/info` second.
   *
   * @param request - The route to price.
   * @returns A quote whose `landedAmount` is honest or which does not exist.
   * @throws A `RampError` with `UNSUPPORTED_ROUTE`, `AMOUNT_OUT_OF_BOUNDS`,
   * `QUOTE_INCOMPLETE`, or a transport code.
   *
   * @example
   * ```ts
   * const quote = await adapter.quote({
   *   country: 'NG', fiat: 'NGN', asset: { code: 'SRT' },
   *   direction: 'withdraw', amount: '100', method: 'bank_transfer',
   * });
   * quote.landedAmount;  // what actually reaches the bank account
   * ```
   */
  public async quote(request: QuoteRequest): Promise<Quote> {
    const toml = await this.toml();
    const info = await this.info();
    const capability = this.#matchCapability(
      toCapabilities(info, toml, this.#config.country, this.#config.fiat),
      request,
    );
    this.#enforceBounds(capability, request);

    const side = request.direction === 'deposit' ? info.deposit : info.withdraw;
    const assetInfo = side.get(capability.asset.code);
    const withdraw = request.direction === 'withdraw';
    const buyCurrency = withdraw ? this.#config.fiat : capability.asset.code;

    let priced: PricedQuote;
    if (toml.quoteServer !== undefined) {
      const stellarAsset = toSep38StellarAsset(capability.asset);
      const fiatAsset = toSep38FiatAsset(this.#config.fiat);
      priced = await priceViaSep38({
        quoteServer: toml.quoteServer,
        sellAsset: withdraw ? stellarAsset : fiatAsset,
        buyAsset: withdraw ? fiatAsset : stellarAsset,
        sellAmount: request.amount,
        buyCurrency,
        country: this.#config.country,
        fetchImpl: this.#fetch,
        now: this.#now,
      });
    } else if (assetInfo !== undefined) {
      priced = priceViaInfo({
        asset: assetInfo,
        toml,
        fiat: this.#config.fiat,
        sellAmount: request.amount,
        buyCurrency,
        now: this.#now,
      });
    } else {
      throw new RampError(
        'QUOTE_INCOMPLETE',
        `${toml.homeDomain} runs no SEP-38 quote server and published no /info entry for ${capability.asset.code}, so there is nothing to price with.`,
      );
    }

    return {
      adapterId: this.id,
      request,
      sellAmount: decimal.normalise(request.amount),
      buyAmount: priced.buyAmount,
      landedAmount: priced.landedAmount,
      rate: priced.rate,
      fees: priced.fees,
      expiresAt: priced.expiresAt,
      ...(priced.providerQuoteId === undefined
        ? {}
        : { providerQuoteId: priced.providerQuoteId }),
    };
  }

  /**
   * Start the anchor's hosted flow for an accepted quote.
   *
   * Requires a SEP-10 token the consuming application already obtained. Slipway
   * does not perform SEP-10 and has no code path that accepts a secret key
   * (rule 2).
   *
   * @param request - The accepted quote, the user's token, and where to return them.
   * @returns The anchor's transaction id and the URL to hand the user.
   * @throws A `RampError` with `AUTH_REQUIRED` when no token was supplied.
   *
   * @example
   * ```ts
   * const started = await adapter.initiate({ quote, auth: { token: sep10Jwt } });
   * window.location.href = started.interactiveUrl!;
   * ```
   */
  public async initiate(request: InitiateRequest): Promise<InitiateResult> {
    const token = this.#requireToken(request.auth);
    const toml = await this.toml();
    const info = await this.info();
    const { direction, asset, method } = request.quote.request;
    const side = direction === 'deposit' ? info.deposit : info.withdraw;

    const issuer =
      asset.issuer ?? toml.currencies.find((entry) => entry.code === asset.code)?.issuer;

    // Send the anchor its own vocabulary back: find the raw `types` key that
    // mapped to the user's chosen method, rather than sending Slipway's name.
    const assetInfo = side.get(asset.code);
    const rawType = assetInfo?.rawTypes.find(
      (type) => mapPaymentMethod(type) === method,
    );

    const body: Record<string, unknown> = {
      asset_code: asset.code,
      amount: request.quote.sellAmount,
      lang: 'en',
      ...(issuer === undefined ? {} : { asset_issuer: issuer }),
      ...(request.auth.account === undefined ? {} : { account: request.auth.account }),
      ...(request.quote.providerQuoteId === undefined
        ? {}
        : { quote_id: request.quote.providerQuoteId }),
      ...(rawType === undefined ? {} : { type: rawType }),
      // SEP-24 defines no standard browser return URL. Anchors ignore unknown
      // fields, and several honour this one, so it is sent on a best-effort basis.
      ...(request.returnUrl === undefined ? {} : { return_url: request.returnUrl }),
    };

    const response = await requestJson({
      url: `${toml.transferServer}/transactions/${direction}/interactive`,
      context: `SEP-24 POST /transactions/${direction}/interactive`,
      fetchImpl: this.#fetch,
      method: 'POST',
      token,
      body,
    });

    const record = asRecord(response);
    const id = record === undefined ? undefined : asString(record['id']);
    const url = record === undefined ? undefined : asString(record['url']);
    if (id === undefined) {
      throw new RampError(
        'PROVIDER_REJECTED',
        'The anchor accepted the interactive request but returned no transaction id.',
        { providerDetail: response },
      );
    }

    return {
      id,
      adapterId: this.id,
      status: 'pending_user',
      ...(url === undefined ? {} : { interactiveUrl: url }),
    };
  }

  /**
   * Read one transaction. Safe to call every five seconds: it is a plain GET
   * with no side effects.
   *
   * @param ref - The anchor's transaction id and the user's token.
   * @returns The transaction's current state.
   * @throws A `RampError` with `AUTH_REQUIRED`, `NOT_FOUND`, or a transport code.
   *
   * @example
   * ```ts
   * const tx = await adapter.getTransaction({ id: started.id, auth: { token } });
   * tx.status;         // 'pending_stellar'
   * tx.stellarTxHash;  // set once the anchor has paid out on chain
   * ```
   */
  public async getTransaction(ref: TransactionRef): Promise<Transaction> {
    const token = this.#requireToken(ref.auth);
    const toml = await this.toml();

    const response = await requestJson({
      url: `${toml.transferServer}/transaction?id=${encodeURIComponent(ref.id)}`,
      context: 'SEP-24 GET /transaction',
      fetchImpl: this.#fetch,
      token,
    });

    const envelope = asRecord(response);
    const record = envelope === undefined ? undefined : asRecord(envelope['transaction']);
    if (record === undefined) {
      throw new RampError('NOT_FOUND', `The anchor returned no transaction for id ${ref.id}.`, {
        providerDetail: response,
      });
    }

    const providerStatus = asString(record['status']);
    const interactiveUrl = asString(record['more_info_url']);
    const stellarTxHash = asString(record['stellar_transaction_id']);
    const amountIn = asDecimalString(record['amount_in']);
    const amountOut = asDecimalString(record['amount_out']);
    const updatedAt = Date.parse(asString(record['updated_at']) ?? '');

    return {
      id: asString(record['id']) ?? ref.id,
      adapterId: this.id,
      status: mapStatus(providerStatus),
      ...(interactiveUrl === undefined ? {} : { interactiveUrl }),
      ...(stellarTxHash === undefined ? {} : { stellarTxHash }),
      ...(amountIn === undefined ? {} : { amountIn }),
      ...(amountOut === undefined ? {} : { amountOut }),
      ...(providerStatus === undefined ? {} : { providerStatus }),
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : this.#now(),
    };
  }

  /**
   * A user's SEP-12 verification state, when the anchor runs a KYC server.
   *
   * @param ref - The user's token.
   * @returns The verification state and any fields still outstanding.
   * @throws A `RampError` with `UNSUPPORTED_ROUTE` when the anchor advertises
   * no `KYC_SERVER`, or `AUTH_REQUIRED` when no token was supplied.
   *
   * @example
   * ```ts
   * const status = await adapter.customerStatus({ auth: { token } });
   * if (status.state === 'not_started') render(status.fields);
   * ```
   */
  public async customerStatus(ref: CustomerRef): Promise<CustomerStatus> {
    const token = this.#requireToken(ref.auth);
    const toml = await this.toml();
    if (toml.kycServer === undefined) {
      throw new RampError(
        'UNSUPPORTED_ROUTE',
        `${toml.homeDomain} advertises no KYC_SERVER, so it exposes no SEP-12 customer status.`,
      );
    }

    const query = ref.id === undefined ? '' : `?id=${encodeURIComponent(ref.id)}`;
    const response = await requestJson({
      url: `${toml.kycServer}/customer${query}`,
      context: 'SEP-12 GET /customer',
      fetchImpl: this.#fetch,
      token,
    });

    const record = asRecord(response) ?? {};
    const rawStatus = asString(record['status'])?.toUpperCase() ?? '';
    const reason = asString(record['message']);

    return {
      state: CUSTOMER_STATE_MAP[rawStatus] ?? 'pending',
      fields: readFieldSpecs(record['fields']),
      ...(reason === undefined ? {} : { reason }),
    };
  }

  #requireToken(auth: AuthContext | undefined): string {
    if (auth?.token === undefined || auth.token === '') {
      throw new RampError(
        'AUTH_REQUIRED',
        'This call needs a SEP-10 token. Obtain one in your application and pass it in an AuthContext; Slipway never handles secret keys.',
      );
    }
    return auth.token;
  }

  #matchCapability(
    capabilities: readonly Capability[],
    request: QuoteRequest,
  ): Capability {
    const match = capabilities.find(
      (capability) =>
        capability.country === request.country &&
        capability.fiat === request.fiat &&
        capability.direction === request.direction &&
        capability.asset.code === request.asset.code &&
        (request.asset.issuer === undefined ||
          capability.asset.issuer === undefined ||
          capability.asset.issuer === request.asset.issuer) &&
        // An empty method list means the anchor did not constrain the method,
        // not that it accepts none. See Capability.methods in @slipwaykit/core.
        (capability.methods.length === 0 || capability.methods.includes(request.method)),
    );
    if (match === undefined) {
      throw new RampError(
        'UNSUPPORTED_ROUTE',
        `${this.#config.homeDomain} does not serve ${request.direction} of ${request.asset.code} against ${request.fiat} in ${request.country} by ${request.method}.`,
      );
    }
    return match;
  }

  #enforceBounds(capability: Capability, request: QuoteRequest): void {
    if (
      capability.minAmount !== undefined &&
      decimal.cmp(request.amount, capability.minAmount) < 0
    ) {
      throw new RampError(
        'AMOUNT_OUT_OF_BOUNDS',
        `${this.#config.homeDomain} takes at least ${capability.minAmount} ${request.asset.code}, and ${request.amount} was requested.`,
      );
    }
    if (
      capability.maxAmount !== undefined &&
      decimal.cmp(request.amount, capability.maxAmount) > 0
    ) {
      throw new RampError(
        'AMOUNT_OUT_OF_BOUNDS',
        `${this.#config.homeDomain} takes at most ${capability.maxAmount} ${request.asset.code}, and ${request.amount} was requested.`,
      );
    }
  }
}

/** Turn a SEP-12 `fields` object into {@link FieldSpec} values. */
function readFieldSpecs(raw: unknown): readonly FieldSpec[] {
  const record = asRecord(raw);
  if (record === undefined) return [];

  const specs: FieldSpec[] = [];
  for (const [name, value] of Object.entries(record)) {
    const field = asRecord(value);
    if (field === undefined) continue;

    const rawType = asString(field['type']);
    const type = rawType !== undefined && FIELD_TYPES.has(rawType) ? rawType : 'string';
    const description = asString(field['description']);
    const choices = asArray(field['choices'])
      ?.map((choice) => asString(choice))
      .filter((choice): choice is string => choice !== undefined);

    specs.push({
      name,
      type: type as FieldSpec['type'],
      ...(description === undefined ? {} : { description }),
      optional: asBoolean(field['optional']) ?? false,
      ...(choices === undefined || choices.length === 0 ? {} : { choices }),
    });
  }
  return specs;
}
