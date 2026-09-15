/**
 * `GET /api/quotes` — the comparison endpoint.
 *
 * The rule that shapes this route: **one failing anchor must never fail the
 * request**. Adapter failures come back inside a `200` body, under `errors`, so
 * the UI can show that a provider was asked and did not answer rather than
 * silently dropping it from the comparison.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { RampError, decimal, type QuoteRequest } from '@slipwaykit/core';
import type { AppDeps, ApiErrorBody } from '../deps.js';
import { isMockAdapter } from '../services/registry.js';

const query = z.object({
  country: z.string().length(2).toUpperCase(),
  fiat: z.string().length(3).toUpperCase(),
  direction: z.enum(['deposit', 'withdraw']),
  // Rule 1: amounts arrive as strings and stay strings. Coercing to a number
  // here would undo the exactness the whole library is built to preserve.
  amount: z.string().refine(decimal.isDecimal, 'must be a decimal string, e.g. "100.50"'),
  method: z.enum(['bank_transfer', 'mobile_money', 'card', 'cash_pickup', 'ussd']),
  asset: z.string().default('USDC'),
  issuer: z.string().optional(),
});

/** One adapter's answer, as the API renders it. */
export interface QuoteView {
  /** Which adapter answered. */
  readonly adapterId: string;
  /** Its display name. */
  readonly adapterName: string;
  /** Whether this is an illustrative demo rate rather than a live anchor. */
  readonly isMock: boolean;
  /** Amount sold. */
  readonly sellAmount: string;
  /** Gross bought, before the fees listed below. */
  readonly buyAmount: string;
  /** What the recipient actually receives. Sort on this. */
  readonly landedAmount: string;
  /** Headline rate, before fees. */
  readonly rate: string;
  /** Every deduction between `buyAmount` and `landedAmount`. */
  readonly fees: readonly { kind: string; amount: string; currency: string; description?: string }[];
  /** Unix epoch milliseconds after which this must not be acted on. */
  readonly expiresAt: number;
  /** The anchor's own quote id, when it issued one. */
  readonly providerQuoteId?: string;
  /** How long the quote took. */
  readonly latencyMs: number;
}

/** One adapter's failure, as the API renders it. */
export interface QuoteErrorView {
  /** Which adapter failed. */
  readonly adapterId: string;
  /** Its display name. */
  readonly adapterName: string;
  /** Whether this is a demo adapter. */
  readonly isMock: boolean;
  /** A `RampErrorCode`. The UI translates this into plain language. */
  readonly code: string;
  /** A developer-facing explanation. */
  readonly message: string;
  /** Whether calling again later could plausibly succeed. */
  readonly retryable: boolean;
  /** How long it took to fail. */
  readonly latencyMs: number;
}

/**
 * Build the quotes route.
 *
 * @param deps - Registry and configuration.
 * @returns A Hono app to mount under `/api`.
 *
 * @example
 * ```ts
 * app.route('/api', createQuotesRoute(deps));
 * // GET /api/quotes?country=NG&fiat=NGN&direction=withdraw&amount=100&method=bank_transfer
 * ```
 */
export function createQuotesRoute(deps: AppDeps): Hono {
  const app = new Hono();

  app.get('/quotes', async (context) => {
    const parsed = query.safeParse(
      Object.fromEntries(new URL(context.req.url).searchParams.entries()),
    );

    if (!parsed.success) {
      const body: ApiErrorBody = {
        error: {
          code: 'INVALID_REQUEST',
          message: 'One or more query parameters are invalid.',
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      };
      return context.json(body, 400);
    }

    const input = parsed.data;
    const request: QuoteRequest = {
      country: input.country,
      fiat: input.fiat,
      asset: {
        code: input.asset,
        ...(input.issuer === undefined ? {} : { issuer: input.issuer }),
      },
      direction: input.direction,
      amount: input.amount,
      method: input.method,
    };

    const { quotes, errors } = await deps.registry.quoteAll(request);

    const quoteViews: QuoteView[] = quotes.map(({ quote, latencyMs }) => ({
      adapterId: quote.adapterId,
      adapterName: deps.registry.get(quote.adapterId)?.name ?? quote.adapterId,
      isMock: isMockAdapter(quote.adapterId),
      sellAmount: quote.sellAmount,
      buyAmount: quote.buyAmount,
      landedAmount: quote.landedAmount,
      rate: quote.rate,
      fees: quote.fees.map((fee) => ({
        kind: fee.kind,
        amount: fee.amount,
        currency: fee.currency,
        ...(fee.description === undefined ? {} : { description: fee.description }),
      })),
      expiresAt: quote.expiresAt,
      ...(quote.providerQuoteId === undefined ? {} : { providerQuoteId: quote.providerQuoteId }),
      latencyMs,
    }));

    const errorViews: QuoteErrorView[] = errors.map((failure) => ({
      adapterId: failure.adapterId,
      adapterName: failure.adapterName,
      isMock: isMockAdapter(failure.adapterId),
      code: failure.error.code,
      message: failure.error.message,
      retryable: failure.error.retryable,
      latencyMs: failure.latencyMs,
    }));

    // 200 even when every adapter failed. The caller asked "what can I get on
    // this corridor", and "nothing, and here is why from each" is an answer.
    return context.json({
      request,
      quotes: quoteViews,
      errors: errorViews,
      queriedAt: Date.now(),
    });
  });

  return app;
}

export { RampError };
