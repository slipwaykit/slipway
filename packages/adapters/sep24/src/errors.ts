/**
 * The single place an anchor's HTTP response becomes a {@link RampError}.
 *
 * Every request the adapter makes goes through {@link requestJson}, so there is
 * no path by which a raw `fetch` rejection, a provider error envelope or a
 * thrown string can escape the adapter (rule 3).
 */

import { RampError, type RampErrorCode } from '@slipwaykit/core';
import { asRecord, asString } from './json.js';

/**
 * How long any single anchor request may take before it is abandoned.
 *
 * Ten seconds. A comparison across five anchors is only as fast as its slowest
 * member, and a user staring at a spinner is better served by "this anchor did
 * not answer" than by an unbounded wait.
 */
export const REQUEST_TIMEOUT_MS = 10_000;

/** Anything that can serve as `fetch`. Injected so tests never touch a network. */
export type FetchLike = typeof fetch;

/**
 * Pull the most useful human-readable message out of an anchor error body.
 *
 * SEP-24, SEP-38 and SEP-12 all use `error`; some anchors use `message` or
 * `detail` instead.
 */
function providerMessage(body: unknown): string | undefined {
  const record = asRecord(body);
  if (!record) return typeof body === 'string' && body.length > 0 ? body.slice(0, 500) : undefined;
  return (
    asString(record['error']) ?? asString(record['message']) ?? asString(record['detail'])
  );
}

/**
 * Whether a 403 body is SEP-12 telling us the customer needs verification
 * rather than SEP-10 telling us the token is bad.
 *
 * A SEP-24 anchor answers a 403 in two quite different situations, and
 * conflating them sends a verified user back to re-authenticate for no reason.
 */
function isCustomerInfoBody(body: unknown): boolean {
  const record = asRecord(body);
  if (!record) return false;
  const type = asString(record['type']);
  if (type === 'customer_info_status' || type === 'non_interactive_customer_info_needed') {
    return true;
  }
  if (type === 'interactive_customer_info_needed') return true;
  return asRecord(record['fields']) !== undefined;
}

/**
 * Map an HTTP status and body onto a {@link RampError}.
 *
 * The raw body is always attached as `providerDetail`, because the only thing
 * worse than an anchor failing is an anchor failing without evidence.
 *
 * @param status - The HTTP status the anchor returned.
 * @param body - The parsed response body, or the raw text when it was not JSON.
 * @param context - What was being attempted, for the error message.
 * @returns The mapped error.
 *
 * @example
 * ```ts
 * throw mapHttpError(429, { error: 'slow down' }, 'GET /info');
 * // RampError { code: 'RATE_LIMITED', retryable: true, httpStatus: 429 }
 * ```
 */
export function mapHttpError(status: number, body: unknown, context: string): RampError {
  const detail = providerMessage(body);
  const suffix = detail === undefined ? '' : `: ${detail}`;

  const build = (code: RampErrorCode, message: string, retryable = false): RampError =>
    new RampError(code, message, { retryable, providerDetail: body, httpStatus: status });

  if (status === 403 && isCustomerInfoBody(body)) {
    return build('KYC_REQUIRED', `${context} needs identity verification first${suffix}`);
  }
  if (status === 401 || status === 403) {
    return build('AUTH_INVALID', `${context} was rejected by the anchor's SEP-10 check${suffix}`);
  }
  if (status === 404) {
    return build('NOT_FOUND', `${context} does not exist at this anchor${suffix}`);
  }
  if (status === 429) {
    return build('RATE_LIMITED', `${context} was rate limited by the anchor${suffix}`, true);
  }
  if (status >= 500) {
    return build('PROVIDER_UNAVAILABLE', `${context} failed: anchor returned ${status}${suffix}`, true);
  }
  if (status === 400) {
    return build('PROVIDER_REJECTED', `${context} was refused by the anchor${suffix}`);
  }
  // Every other 4xx is the anchor understanding us and declining.
  return build('PROVIDER_REJECTED', `${context} failed with HTTP ${status}${suffix}`);
}

/**
 * Turn a transport-level failure into a retryable {@link RampError}.
 *
 * A DNS failure, a reset connection and a timeout are all the same thing from
 * the caller's point of view: this anchor did not answer, try it again later.
 */
export function mapTransportError(error: unknown, context: string, timedOut: boolean): RampError {
  if (RampError.is(error)) return error;
  const reason = timedOut
    ? `timed out after ${REQUEST_TIMEOUT_MS}ms`
    : error instanceof Error
      ? error.message
      : String(error);
  return new RampError('PROVIDER_UNAVAILABLE', `${context} failed: ${reason}`, {
    retryable: true,
    cause: error,
  });
}

/** What {@link requestJson} needs in order to make one call. */
export interface RequestOptions {
  /** Absolute URL to call. */
  readonly url: string;
  /** What is being attempted, used in error messages, e.g. `GET /info`. */
  readonly context: string;
  /** The `fetch` implementation to use. */
  readonly fetchImpl: FetchLike;
  /** HTTP method. Defaults to `GET`. */
  readonly method?: 'GET' | 'POST';
  /** A bearer token to send, when the endpoint is authenticated. */
  readonly token?: string;
  /** A JSON body to send. Implies `Content-Type: application/json`. */
  readonly body?: unknown;
  /** Parse the response as text rather than JSON. Used for `stellar.toml`. */
  readonly as?: 'json' | 'text';
}

/**
 * Make one request to an anchor and return its parsed body, or throw a
 * {@link RampError}.
 *
 * Applies a 10 second `AbortController` timeout to every call, maps every
 * non-2xx status through {@link mapHttpError}, and maps every transport failure
 * through {@link mapTransportError}. Nothing else escapes.
 *
 * @param options - The request to make.
 * @returns The parsed body, typed as `unknown` for the caller to narrow.
 * @throws A `RampError`, always.
 *
 * @example
 * ```ts
 * const info = await requestJson({
 *   url: 'https://testanchor.stellar.org/sep24/info',
 *   context: 'GET /info',
 *   fetchImpl: fetch,
 * });
 * ```
 */
export async function requestJson(options: RequestOptions): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.token !== undefined) headers['Authorization'] = `Bearer ${options.token}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    const response = await options.fetchImpl(options.url, {
      method: options.method ?? 'GET',
      headers,
      signal: controller.signal,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });

    const text = await response.text();
    const parsed = options.as === 'text' ? text : safeParse(text);

    if (!response.ok) {
      throw mapHttpError(response.status, parsed, options.context);
    }
    return parsed;
  } catch (error) {
    throw mapTransportError(error, options.context, timedOut);
  } finally {
    clearTimeout(timer);
  }
}

/** Parse JSON, falling back to the raw text so an HTML error page is still evidence. */
function safeParse(text: string): unknown {
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
