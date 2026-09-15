/**
 * The Slipway contract.
 *
 * Every adapter, every package and every HTTP boundary in this repository is
 * defined in terms of the types in this file. Two rules govern all of them:
 *
 * 1. Money is never a JavaScript `number`. Amounts are decimal strings
 *    ({@link Money}) so that a value survives a round trip through JSON, a
 *    database and a provider API without picking up binary floating point
 *    error.
 * 2. Slipway never sees a secret key. Authentication is a bearer token the
 *    consuming application obtained itself ({@link AuthContext}).
 */

/**
 * A decimal amount, as a string, in the major unit of its currency.
 *
 * Never a `number`. `0.1 + 0.2` is not `0.3` in binary floating point, and a
 * ramp that loses a hundredth of a naira per quote loses the user's trust
 * faster than it loses their money. Use the helpers in `decimal.ts` to do
 * arithmetic on these.
 *
 * @example
 * ```ts
 * const amount: Money = '100.50';   // one hundred naira fifty kobo
 * const wrong = 100.5;              // not a Money; will not type-check
 * ```
 */
export type Money = string;

/**
 * An ISO 3166-1 alpha-2 country code, uppercase.
 *
 * @example
 * ```ts
 * const ng: CountryCode = 'NG';  // Nigeria
 * const ke: CountryCode = 'KE';  // Kenya
 * ```
 */
export type CountryCode = string;

/**
 * An ISO 4217 fiat currency code, uppercase.
 *
 * @example
 * ```ts
 * const ngn: FiatCode = 'NGN';
 * ```
 */
export type FiatCode = string;

/**
 * Which way value is moving, from the user's point of view.
 *
 * `deposit` is on-ramp: the user pays fiat and receives a Stellar asset.
 * `withdraw` is off-ramp: the user sends a Stellar asset and receives fiat.
 *
 * @example
 * ```ts
 * // "I want naira in my bank account" is a withdraw.
 * const direction: Direction = 'withdraw';
 * ```
 */
export type Direction = 'deposit' | 'withdraw';

/**
 * How fiat actually reaches or leaves the user.
 *
 * This union is deliberately closed. An adapter that meets a payment method it
 * does not recognise drops it rather than coercing it into the nearest member,
 * because showing a Kenyan user "bank transfer" when the anchor meant M-Pesa
 * is worse than showing them nothing.
 *
 * @example
 * ```ts
 * const method: PaymentMethod = 'mobile_money';  // M-Pesa, MTN MoMo
 * ```
 */
export type PaymentMethod =
  | 'bank_transfer'
  | 'mobile_money'
  | 'card'
  | 'cash_pickup'
  | 'ussd';

/**
 * A Stellar asset, identified the way SEP-38 identifies one.
 *
 * `issuer` is absent for the native asset (XLM) and present for every
 * credit alphanum asset.
 *
 * @example
 * ```ts
 * const usdc: StellarAsset = {
 *   code: 'USDC',
 *   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
 * };
 * ```
 */
export interface StellarAsset {
  /** The asset code, e.g. `USDC`. */
  readonly code: string;
  /** The issuing account, absent for the native asset. */
  readonly issuer?: string;
}

/**
 * One route a provider says it can serve.
 *
 * A capability is an advertisement, not a promise: it says the provider will
 * consider the route, not that a given amount will quote successfully. Bounds
 * are optional because an anchor that does not publish a limit must not be
 * reported as having a limit of zero.
 *
 * @example
 * ```ts
 * const cap: Capability = {
 *   country: 'NG',
 *   fiat: 'NGN',
 *   asset: { code: 'USDC', issuer: 'GBBD47IF6LWK...' },
 *   direction: 'withdraw',
 *   methods: ['bank_transfer'],
 *   minAmount: '5',
 *   maxAmount: '1000000',
 *   kycRequired: true,
 * };
 * ```
 */
export interface Capability {
  /** Country this route serves. */
  readonly country: CountryCode;
  /** Fiat currency on the fiat side of the route. */
  readonly fiat: FiatCode;
  /** Stellar asset on the crypto side of the route. */
  readonly asset: StellarAsset;
  /** Which way the route runs. */
  readonly direction: Direction;
  /** Payment methods the provider accepts for this route. May be empty. */
  readonly methods: readonly PaymentMethod[];
  /** Smallest amount the provider will accept, in the sell currency. Omitted when undisclosed. */
  readonly minAmount?: Money;
  /** Largest amount the provider will accept, in the sell currency. Omitted when undisclosed. */
  readonly maxAmount?: Money;
  /** Whether the provider requires identity verification before it will settle. */
  readonly kycRequired: boolean;
}

/**
 * The kind of a deduction between what a user sends and what a recipient gets.
 *
 * `spread` is the difference between a provider's mid-market rate and the rate
 * it actually offers. It is a fee in every sense that matters to a user, so
 * Slipway reports it as one even when the provider calls its service "free".
 *
 * @example
 * ```ts
 * const kind: FeeKind = 'spread';
 * ```
 */
export type FeeKind = 'fixed' | 'percent' | 'spread' | 'network' | 'provider';

/**
 * One deduction, denominated in a stated currency.
 *
 * @example
 * ```ts
 * const fee: Fee = {
 *   kind: 'spread',
 *   amount: '250.00',
 *   currency: 'NGN',
 *   description: 'Difference between quoted rate and mid-market rate',
 * };
 * ```
 */
export interface Fee {
  /** What kind of deduction this is. */
  readonly kind: FeeKind;
  /** How much, as a decimal string, in {@link Fee.currency}. */
  readonly amount: Money;
  /** Currency the fee is charged in: a fiat code or a Stellar asset code. */
  readonly currency: string;
  /** Human-readable explanation, shown to the user in a fee breakdown. */
  readonly description?: string;
}

/**
 * A request for pricing on one route.
 *
 * `amount` is always the amount being *sold*: fiat for a deposit, the Stellar
 * asset for a withdraw.
 *
 * @example
 * ```ts
 * const request: QuoteRequest = {
 *   country: 'NG',
 *   fiat: 'NGN',
 *   asset: { code: 'USDC' },
 *   direction: 'withdraw',
 *   amount: '100',
 *   method: 'bank_transfer',
 * };
 * ```
 */
export interface QuoteRequest {
  /** Country the user is ramping in or out of. */
  readonly country: CountryCode;
  /** Fiat currency on the fiat side. */
  readonly fiat: FiatCode;
  /** Stellar asset on the crypto side. */
  readonly asset: StellarAsset;
  /** Which way the value moves. */
  readonly direction: Direction;
  /** Amount being sold, as a decimal string. */
  readonly amount: Money;
  /** How the user wants fiat to move. */
  readonly method: PaymentMethod;
}

/**
 * A priced route, with the one number that actually matters made explicit.
 *
 * {@link Quote.landedAmount} is what the recipient receives after every fee and
 * every spread. An adapter that cannot compute it honestly throws
 * `QUOTE_INCOMPLETE` rather than reporting the gross amount, because a
 * comparison built on gross amounts ranks the least honest provider first.
 *
 * @example
 * ```ts
 * const quote: Quote = {
 *   adapterId: 'sep24:testanchor.stellar.org',
 *   request,
 *   sellAmount: '100',
 *   buyAmount: '158000.00',
 *   landedAmount: '156500.00',   // what actually lands in the bank account
 *   rate: '1580.00',
 *   fees: [{ kind: 'fixed', amount: '1500.00', currency: 'NGN' }],
 *   expiresAt: 1757942400000,
 * };
 * ```
 */
export interface Quote {
  /** Which adapter produced this quote. */
  readonly adapterId: string;
  /** The request this quote answers, echoed back for display and auditing. */
  readonly request: QuoteRequest;
  /** Amount sold, in the sell currency. */
  readonly sellAmount: Money;
  /** Gross amount bought, in the buy currency, before fees denominated in it. */
  readonly buyAmount: Money;
  /**
   * Amount the recipient actually receives, after every fee and spread.
   * This is the figure a comparison sorts on.
   */
  readonly landedAmount: Money;
  /** Effective rate, buy units per sell unit, as a decimal string. */
  readonly rate: Money;
  /** Every deduction between {@link Quote.buyAmount} and {@link Quote.landedAmount}. */
  readonly fees: readonly Fee[];
  /** Unix epoch milliseconds after which this quote must not be acted on. */
  readonly expiresAt: number;
  /** The provider's own identifier for this quote, when it issued one. */
  readonly providerQuoteId?: string;
}

/**
 * Where a ramp transaction has got to.
 *
 * Adapters map provider-specific vocabularies onto this union. An unrecognised
 * provider status maps to `pending_provider` rather than throwing: a poller
 * that crashes on an unknown string is worse than one that reports "still
 * working" for a few seconds longer than it should.
 *
 * @example
 * ```ts
 * const status: TxStatus = 'pending_user';  // waiting on the user to pay
 * ```
 */
export type TxStatus =
  | 'incomplete'
  | 'pending_user'
  | 'pending_kyc'
  | 'pending_provider'
  | 'pending_stellar'
  | 'completed'
  | 'refunded'
  | 'expired'
  | 'error';

/**
 * A ramp transaction in flight.
 *
 * @example
 * ```ts
 * const tx: Transaction = {
 *   id: '82fhs729f63dh0v4',
 *   adapterId: 'sep24:testanchor.stellar.org',
 *   status: 'pending_stellar',
 *   stellarTxHash: '17a670bc424ff5ce3b386dbfaae9990b66a2a37b4fbe51547e8794962a3f9e6a',
 *   updatedAt: 1757942400000,
 * };
 * ```
 */
export interface Transaction {
  /** The provider's transaction identifier. */
  readonly id: string;
  /** Which adapter owns this transaction. */
  readonly adapterId: string;
  /** Current status. */
  readonly status: TxStatus;
  /** Hosted URL the user completes the flow in, when the provider supplies one. */
  readonly interactiveUrl?: string;
  /** Hash of the settling Stellar transaction, once there is one. */
  readonly stellarTxHash?: string;
  /** Amount received by the provider, when known. */
  readonly amountIn?: Money;
  /** Amount paid out by the provider, when known. */
  readonly amountOut?: Money;
  /** The provider's own status string, kept for support and debugging. */
  readonly providerStatus?: string;
  /** When this snapshot was taken, Unix epoch milliseconds. */
  readonly updatedAt: number;
}

/**
 * Proof that the consuming application has already authenticated the user.
 *
 * Slipway never performs SEP-10 or SEP-45 itself and never accepts a secret
 * key. The application signs the challenge, keeps the key, and hands Slipway
 * only the resulting bearer token.
 *
 * @example
 * ```ts
 * const auth: AuthContext = {
 *   token: jwtFromSep10Challenge,
 *   account: 'GDUY7J7A33TQWOSOQGDO776GGLM3UQERL4J3SPT56F6YS4ID7MLDERI4',
 * };
 * ```
 */
export interface AuthContext {
  /** A SEP-10 or SEP-45 bearer token obtained by the consuming application. */
  readonly token: string;
  /** The Stellar account the token authenticates, when the caller knows it. */
  readonly account?: string;
}

/**
 * A request to start a ramp against a quote the user has accepted.
 *
 * @example
 * ```ts
 * const request: InitiateRequest = {
 *   quote,
 *   auth: { token: jwt },
 *   returnUrl: 'https://myapp.example/ramp/done',
 * };
 * ```
 */
export interface InitiateRequest {
  /** The quote the user accepted. */
  readonly quote: Quote;
  /** Bearer token for the authenticated user. */
  readonly auth: AuthContext;
  /** Where the provider should send the user when the hosted flow finishes. */
  readonly returnUrl?: string;
}

/**
 * The result of starting a ramp.
 *
 * @example
 * ```ts
 * const result: InitiateResult = {
 *   id: '82fhs729f63dh0v4',
 *   adapterId: 'sep24:testanchor.stellar.org',
 *   status: 'pending_user',
 *   interactiveUrl: 'https://testanchor.stellar.org/interactive?token=...',
 * };
 * ```
 */
export interface InitiateResult {
  /** The provider's transaction identifier, to poll with. */
  readonly id: string;
  /** Which adapter started this. */
  readonly adapterId: string;
  /** Status immediately after initiation. */
  readonly status: TxStatus;
  /** Hosted URL to hand the user, when the provider supplies one. */
  readonly interactiveUrl?: string;
}

/**
 * How far a user has got through identity verification.
 *
 * @example
 * ```ts
 * const state: CustomerState = 'pending';  // documents submitted, under review
 * ```
 */
export type CustomerState = 'not_started' | 'pending' | 'approved' | 'rejected';

/**
 * One piece of information a provider wants before it will verify a user.
 *
 * @example
 * ```ts
 * const field: FieldSpec = {
 *   name: 'bank_account_number',
 *   type: 'string',
 *   description: 'Your 10 digit NUBAN account number',
 *   optional: false,
 * };
 * ```
 */
export interface FieldSpec {
  /** Machine name of the field, as the provider calls it. */
  readonly name: string;
  /** Broad shape of the expected value. */
  readonly type: 'string' | 'number' | 'date' | 'binary';
  /** What to show the user as a label or hint. */
  readonly description?: string;
  /** Whether the provider will proceed without this field. */
  readonly optional: boolean;
  /** Permitted values, when the provider constrains them. */
  readonly choices?: readonly string[];
}

/**
 * A user's verification state with one provider, and what is still outstanding.
 *
 * @example
 * ```ts
 * const status: CustomerStatus = {
 *   state: 'not_started',
 *   fields: [{ name: 'first_name', type: 'string', optional: false }],
 * };
 * ```
 */
export interface CustomerStatus {
  /** How far verification has got. */
  readonly state: CustomerState;
  /** Fields the provider still wants. Empty once the user is approved. */
  readonly fields: readonly FieldSpec[];
  /** The provider's own reason for a rejection, when it gives one. */
  readonly reason?: string;
}

/**
 * The interface every ramp provider is reduced to.
 *
 * Implementations must obey four rules. Money crossing this boundary is a
 * decimal string. Every thrown error is a `RampError`. `landedAmount` is
 * honest or the quote throws. `getTransaction` has no side effects and is safe
 * to poll.
 *
 * @example
 * ```ts
 * class MyAdapter implements RampAdapter {
 *   readonly id = 'my-provider';
 *   readonly name = 'My Provider';
 *   async capabilities(): Promise<Capability[]> { return []; }
 *   async quote(request: QuoteRequest): Promise<Quote> { throw new Error(); }
 *   async initiate(request: InitiateRequest): Promise<InitiateResult> { throw new Error(); }
 *   async getTransaction(ref: TransactionRef): Promise<Transaction> { throw new Error(); }
 * }
 * ```
 */
export interface RampAdapter {
  /** Stable identifier, unique within a registry, e.g. `sep24:testanchor.stellar.org`. */
  readonly id: string;
  /** Human-readable provider name, for display. */
  readonly name: string;

  /**
   * Routes this provider says it can serve.
   *
   * @example
   * ```ts
   * const caps = await adapter.capabilities();
   * const ngn = caps.filter((c) => c.fiat === 'NGN');
   * ```
   */
  capabilities(): Promise<readonly Capability[]>;

  /**
   * Price one route, including an honest landed amount.
   *
   * @throws A `RampError` with `UNSUPPORTED_ROUTE`, `AMOUNT_OUT_OF_BOUNDS`,
   * `QUOTE_INCOMPLETE` or a transport code.
   * @example
   * ```ts
   * const quote = await adapter.quote({
   *   country: 'NG', fiat: 'NGN', asset: { code: 'USDC' },
   *   direction: 'withdraw', amount: '100', method: 'bank_transfer',
   * });
   * ```
   */
  quote(request: QuoteRequest): Promise<Quote>;

  /**
   * Start a ramp against an accepted quote.
   *
   * @throws A `RampError` with `AUTH_REQUIRED` when no token was supplied.
   * @example
   * ```ts
   * const started = await adapter.initiate({ quote, auth: { token } });
   * window.location.href = started.interactiveUrl!;
   * ```
   */
  initiate(request: InitiateRequest): Promise<InitiateResult>;

  /**
   * Read a transaction's current state. Safe to call on a timer.
   *
   * @example
   * ```ts
   * const tx = await adapter.getTransaction({ id: started.id, auth: { token } });
   * ```
   */
  getTransaction(ref: TransactionRef): Promise<Transaction>;

  /**
   * A user's verification state, when the provider exposes one.
   *
   * Optional: a provider with no KYC surface simply does not implement it.
   *
   * @example
   * ```ts
   * const status = await adapter.customerStatus?.({ auth: { token } });
   * ```
   */
  customerStatus?(ref: CustomerRef): Promise<CustomerStatus>;
}

/**
 * Enough to look one transaction up.
 *
 * @example
 * ```ts
 * const ref: TransactionRef = { id: '82fhs729f63dh0v4', auth: { token: jwt } };
 * ```
 */
export interface TransactionRef {
  /** The provider's transaction identifier. */
  readonly id: string;
  /** Bearer token for the user who owns the transaction. */
  readonly auth: AuthContext;
}

/**
 * Enough to look one customer up.
 *
 * @example
 * ```ts
 * const ref: CustomerRef = { auth: { token: jwt } };
 * ```
 */
export interface CustomerRef {
  /** Bearer token for the user being asked about. */
  readonly auth: AuthContext;
  /** The provider's customer identifier, when one is already known. */
  readonly id?: string;
}
