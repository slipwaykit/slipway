/**
 * The one error type that crosses an adapter boundary.
 *
 * Raw `fetch` rejections, provider error envelopes and thrown strings must
 * never escape an adapter. A caller comparing five providers needs to tell
 * "this route does not exist" apart from "this anchor is down, try again"
 * without parsing five different error vocabularies.
 */

/**
 * Every failure Slipway can report, as a closed union.
 *
 * The distinction that matters most is between codes that are worth retrying
 * (`PROVIDER_UNAVAILABLE`, `RATE_LIMITED`) and codes that will fail again the
 * same way no matter how many times they are called.
 *
 * @example
 * ```ts
 * function isWorthRetrying(code: RampErrorCode): boolean {
 *   return code === 'PROVIDER_UNAVAILABLE' || code === 'RATE_LIMITED';
 * }
 * ```
 */
export type RampErrorCode =
  /** The provider does not serve this country, currency, asset or direction. */
  | 'UNSUPPORTED_ROUTE'
  /** The amount is below the provider's minimum or above its maximum. */
  | 'AMOUNT_OUT_OF_BOUNDS'
  /** The provider disclosed too little to compute an honest landed amount. */
  | 'QUOTE_INCOMPLETE'
  /** The quote was acted on after `expiresAt`. */
  | 'QUOTE_EXPIRED'
  /** The operation needs an `AuthContext` and none was supplied. */
  | 'AUTH_REQUIRED'
  /** The supplied token was rejected by the provider. */
  | 'AUTH_INVALID'
  /** The user must complete identity verification before this will succeed. */
  | 'KYC_REQUIRED'
  /** The referenced transaction or customer does not exist. */
  | 'NOT_FOUND'
  /** The provider is throttling. Retryable after a delay. */
  | 'RATE_LIMITED'
  /** The provider is unreachable, timed out, or returned a 5xx. Retryable. */
  | 'PROVIDER_UNAVAILABLE'
  /** The provider understood the request and refused it. Not retryable. */
  | 'PROVIDER_REJECTED';

/**
 * Optional detail attached to a {@link RampError}.
 *
 * @example
 * ```ts
 * const options: RampErrorOptions = {
 *   retryable: true,
 *   providerDetail: { error: 'anchor is in maintenance' },
 *   httpStatus: 503,
 * };
 * ```
 */
export interface RampErrorOptions {
  /** Whether calling again later could plausibly succeed. Defaults to `false`. */
  readonly retryable?: boolean;
  /** The provider's raw response body, kept verbatim for support and debugging. */
  readonly providerDetail?: unknown;
  /** The HTTP status that produced this error, when there was one. */
  readonly httpStatus?: number;
  /** The underlying error, when this one wraps another. */
  readonly cause?: unknown;
}

/**
 * The only error an adapter throws.
 *
 * @example
 * ```ts
 * throw new RampError(
 *   'QUOTE_INCOMPLETE',
 *   'Anchor published no fee_percent and offers no SEP-38 quote server, so the landed amount cannot be computed honestly.',
 *   { providerDetail: infoBody },
 * );
 * ```
 *
 * @example
 * ```ts
 * try {
 *   await adapter.quote(request);
 * } catch (error) {
 *   if (RampError.is(error) && error.retryable) {
 *     await delay(1000);
 *   }
 * }
 * ```
 */
export class RampError extends Error {
  /** Which failure this is. */
  public readonly code: RampErrorCode;
  /** Whether calling again later could plausibly succeed. */
  public readonly retryable: boolean;
  /** The provider's raw response body, verbatim. */
  public readonly providerDetail: unknown;
  /** The HTTP status that produced this error, when there was one. */
  public readonly httpStatus: number | undefined;

  /**
   * @param code - Which failure this is.
   * @param message - A sentence a developer can act on. Not shown to end users;
   * the frontend translates {@link RampError.code} instead.
   * @param options - Retryability and provider detail.
   *
   * @example
   * ```ts
   * new RampError('RATE_LIMITED', 'Anchor returned 429.', { retryable: true, httpStatus: 429 });
   * ```
   */
  public constructor(code: RampErrorCode, message: string, options: RampErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'RampError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.providerDetail = options.providerDetail;
    this.httpStatus = options.httpStatus;
    // Restores the prototype chain when this file is emitted to ES5 by a
    // downstream consumer's bundler; harmless otherwise.
    Object.setPrototypeOf(this, RampError.prototype);
  }

  /**
   * Narrow an `unknown` caught value to a `RampError`.
   *
   * Uses a structural check rather than `instanceof` so that an error crossing
   * a bundle or realm boundary is still recognised.
   *
   * @param value - Anything caught.
   * @returns Whether it is a `RampError`.
   *
   * @example
   * ```ts
   * try {
   *   await adapter.quote(request);
   * } catch (error) {
   *   if (RampError.is(error)) console.error(error.code);
   * }
   * ```
   */
  public static is(value: unknown): value is RampError {
    return (
      value instanceof Error &&
      value.name === 'RampError' &&
      typeof (value as RampError).code === 'string'
    );
  }

  /**
   * Turn any caught value into a `RampError`.
   *
   * Use this at the outermost boundary of an adapter so that no raw error can
   * escape, whatever a transport or a provider SDK decides to throw.
   *
   * @param value - Anything caught.
   * @param fallback - The code to use when `value` is not already a `RampError`.
   * @returns A `RampError`, either `value` itself or a wrapper around it.
   *
   * @example
   * ```ts
   * try {
   *   return await this.priceViaSep38(request);
   * } catch (error) {
   *   throw RampError.from(error, 'PROVIDER_UNAVAILABLE');
   * }
   * ```
   */
  public static from(value: unknown, fallback: RampErrorCode = 'PROVIDER_UNAVAILABLE'): RampError {
    if (RampError.is(value)) return value;
    const message = value instanceof Error ? value.message : String(value);
    return new RampError(fallback, message, {
      retryable: fallback === 'PROVIDER_UNAVAILABLE' || fallback === 'RATE_LIMITED',
      cause: value,
    });
  }

  /**
   * A JSON-safe shape, for an HTTP error body or a log line.
   *
   * @returns The error's public fields.
   *
   * @example
   * ```ts
   * return context.json({ error: rampError.toJSON() }, 502);
   * ```
   */
  public toJSON(): {
    code: RampErrorCode;
    message: string;
    retryable: boolean;
    httpStatus?: number;
  } {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.httpStatus === undefined ? {} : { httpStatus: this.httpStatus }),
    };
  }
}
