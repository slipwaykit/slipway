/**
 * What every error code means, in plain language.
 *
 * This is the one place a code becomes words a person reads. It is exported as
 * a single map so it can be overridden for a different tone or replaced
 * wholesale for another language, without touching a component.
 */

import type { RampErrorCode } from '@slipwaykit/core';

/** Codes the API adds on top of the adapter vocabulary. */
export type ApiErrorCode = 'INVALID_REQUEST' | 'INTERNAL_ERROR' | 'NETWORK_ERROR';

/** Every code the interface may need to explain. */
export type DisplayErrorCode = RampErrorCode | ApiErrorCode;

/** How one code reads to a person. */
export interface ErrorMessage {
  /** A few words, used as a label. */
  readonly title: string;
  /** One or two sentences saying what happened and, where useful, what to do. */
  readonly description: string;
}

/**
 * The plain-language map.
 *
 * `satisfies` makes this exhaustive: adding a code to `RampErrorCode` in
 * `@slipwaykit/core` is a compile error here until it has words.
 *
 * @example
 * ```ts
 * ERROR_MESSAGES.QUOTE_INCOMPLETE.title; // "Wouldn't disclose its full fees"
 *
 * // Translate by replacing the map:
 * const yoruba = { ...ERROR_MESSAGES, PROVIDER_UNAVAILABLE: { title: '…', description: '…' } };
 * ```
 */
export const ERROR_MESSAGES = {
  UNSUPPORTED_ROUTE: {
    title: "Doesn't offer this route",
    description: "This provider doesn't serve this country, currency or payment method.",
  },
  AMOUNT_OUT_OF_BOUNDS: {
    title: 'Amount outside its limits',
    description: 'This provider has a minimum or maximum, and this amount falls outside it.',
  },
  QUOTE_INCOMPLETE: {
    title: "Wouldn't disclose its full fees",
    description:
      "It didn't publish enough to work out what the recipient would actually receive, so we don't show a number for it.",
  },
  QUOTE_EXPIRED: {
    title: 'Quote expired',
    description: 'Prices move. Refresh to get a current quote.',
  },
  AUTH_REQUIRED: {
    title: 'Needs you to sign in',
    description: 'This step needs a connected Stellar account.',
  },
  AUTH_INVALID: {
    title: 'Sign-in was rejected',
    description: 'The provider did not accept the sign-in. Try connecting again.',
  },
  KYC_REQUIRED: {
    title: 'Needs identity verification',
    description: 'This provider has to verify who you are before it will send money.',
  },
  NOT_FOUND: {
    title: 'Not found',
    description: "We couldn't find what you were looking for.",
  },
  RATE_LIMITED: {
    title: 'Busy right now',
    description: 'Too many requests in a short time. Try again in a minute.',
  },
  PROVIDER_UNAVAILABLE: {
    title: "Didn't answer",
    description: 'The provider could not be reached or timed out. This is often temporary.',
  },
  PROVIDER_REJECTED: {
    title: 'Refused the request',
    description: 'The provider understood the request and declined it.',
  },
  INVALID_REQUEST: {
    title: 'Check the details',
    description: 'Something in the request is not valid. Check the amount and options.',
  },
  INTERNAL_ERROR: {
    title: 'Something went wrong',
    description: 'The Slipway service hit an unexpected problem. Try again shortly.',
  },
  NETWORK_ERROR: {
    title: "Can't reach Slipway",
    description: 'Check your connection. If it is fine, the Slipway service may be down.',
  },
} as const satisfies Record<DisplayErrorCode, ErrorMessage>;

/**
 * Words for any code, including one the interface has never seen.
 *
 * A code from a newer backend must still render as something readable rather
 * than as `undefined`.
 *
 * @param code - A code from the API or an adapter.
 * @returns Its message, or a generic one.
 *
 * @example
 * ```ts
 * describeError('RATE_LIMITED').title; // 'Busy right now'
 * describeError('SOMETHING_NEW').title; // 'Something went wrong'
 * ```
 */
export function describeError(code: string): ErrorMessage {
  return code in ERROR_MESSAGES
    ? ERROR_MESSAGES[code as DisplayErrorCode]
    : ERROR_MESSAGES.INTERNAL_ERROR;
}
