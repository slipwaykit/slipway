/**
 * Ordering and expiry for a quote comparison.
 *
 * Kept free of React so it can be tested on its own.
 */

import { decimal } from '@slipwaykit/core';
import type { QuoteView } from './api';

/**
 * Sort quotes by landed amount, largest first. Never by rate.
 *
 * A provider can quote a better rate and take it all back in fees; ranking on
 * rate would put it first. Ties keep the order they arrived in.
 *
 * @param quotes - Quotes in any order.
 * @returns A new array, best landed amount first.
 *
 * @example
 * ```ts
 * sortByLanded(body.quotes)[0]; // what puts the most in the recipient's account
 * ```
 */
export function sortByLanded(quotes: readonly QuoteView[]): QuoteView[] {
  return [...quotes].sort((a, b) => decimal.cmp(b.landedAmount, a.landedAmount));
}

/**
 * Whole seconds until a quote expires, never negative.
 *
 * @param expiresAt - Unix epoch milliseconds.
 * @param now - The current time.
 * @returns Seconds remaining, `0` once expired.
 *
 * @example
 * ```ts
 * secondsLeft(quote.expiresAt, Date.now()); // 42
 * ```
 */
export function secondsLeft(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

/**
 * The total of a quote's fees, when they share one currency.
 *
 * @param quote - A quote.
 * @returns The total as a decimal string, or `undefined` when fees are in mixed currencies.
 *
 * @example
 * ```ts
 * feeTotal(quote); // '4006.25'
 * ```
 */
export function feeTotal(quote: QuoteView): string | undefined {
  const currencies = new Set(quote.fees.map((fee) => fee.currency));
  if (currencies.size > 1) return undefined;
  return decimal.sum(quote.fees.map((fee) => fee.amount));
}

/**
 * How much less a quote lands than the best one.
 *
 * @param quote - The quote to compare.
 * @param best - The best quote.
 * @returns A positive decimal string, or `undefined` for the best quote itself.
 *
 * @example
 * ```ts
 * shortfall(quotes[1], quotes[0]); // '639.75'
 * ```
 */
export function shortfall(quote: QuoteView, best: QuoteView): string | undefined {
  const gap = decimal.sub(best.landedAmount, quote.landedAmount);
  return decimal.cmp(gap, '0') > 0 ? gap : undefined;
}
