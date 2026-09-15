/**
 * A `fetch` built from recorded fixtures.
 *
 * Rule 7: the test suite must pass offline with no credentials. Every test in
 * this package injects one of these instead of the global `fetch`, so a test
 * that accidentally reaches the network fails with "no fixture" rather than
 * quietly depending on an anchor being up.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RampError } from '@slipwaykit/core';
import type { FetchLike } from '@slipwaykit/adapter-sep24';

/** How one recorded URL should answer. */
export interface Route {
  /** HTTP status. Defaults to 200. */
  readonly status?: number;
  /** A JSON body. Serialised for the response. */
  readonly body?: unknown;
  /** A raw text body, for `stellar.toml` and for non-JSON error pages. */
  readonly text?: string;
  /** Throw this instead of answering, to simulate a transport failure. */
  readonly throws?: unknown;
  /** Never answer, so the adapter's own AbortController has to fire. */
  readonly hang?: boolean;
}

/** A fixture-backed `fetch` plus the URLs it was asked for. */
export interface Harness {
  /** Pass this as `fetchImpl`. */
  readonly fetch: FetchLike;
  /** Every URL requested, in order. Assert on this to prove caching works. */
  readonly calls: string[];
}

/** Read a fixture file from `test/fixtures`. */
export function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
}

/** Read and parse a JSON fixture. */
export function json(name: string): unknown {
  return JSON.parse(fixture(name));
}

/**
 * Build a `fetch` that answers only the URLs it was given.
 *
 * Keys are matched as prefixes, longest first, so a route can be registered for
 * `https://host/sep38/price` and still match the query string the adapter
 * actually builds.
 *
 * @param routes - URL prefix to recorded response.
 * @returns The fetch and a log of what it was asked for.
 *
 * @example
 * ```ts
 * const harness = harnessFor({
 *   'https://ngn.example.com/.well-known/stellar.toml': { text: fixture('ngn-anchor.toml') },
 *   'https://ngn.example.com/sep24/info': { body: json('ngn-sep24-info.json') },
 * });
 * const adapter = new Sep24Adapter({ ..., fetchImpl: harness.fetch });
 * ```
 */
export function harnessFor(routes: Readonly<Record<string, Route>>): Harness {
  const calls: string[] = [];
  const keys = Object.keys(routes).sort((a, b) => b.length - a.length);

  const impl = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);

    const key = keys.find((candidate) => url.startsWith(candidate));
    if (key === undefined) {
      throw new TypeError(`fetch failed: no fixture registered for ${url}`);
    }
    const route = routes[key]!;

    if (route.throws !== undefined) throw route.throws;

    if (route.hang === true) {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    }

    const body = route.text ?? (route.body === undefined ? '' : JSON.stringify(route.body));
    return new Response(body, {
      status: route.status ?? 200,
      headers: { 'Content-Type': route.text === undefined ? 'application/json' : 'text/plain' },
    });
  };

  return { fetch: impl as FetchLike, calls };
}

/** The recorded SDF test anchor, wired up as a working adapter backend. */
export function testAnchorRoutes(): Record<string, Route> {
  return {
    'https://testanchor.stellar.org/.well-known/stellar.toml': {
      text: fixture('testanchor.stellar.org.toml'),
    },
    'https://testanchor.stellar.org/sep24/info': { body: json('testanchor-sep24-info.json') },
    'https://testanchor.stellar.org/sep38/price': {
      body: json('testanchor-sep38-price-usd.json'),
    },
  };
}

/** The synthetic Nigerian anchor, wired up as a working adapter backend. */
export function ngnAnchorRoutes(): Record<string, Route> {
  return {
    'https://ngn.example.com/.well-known/stellar.toml': { text: fixture('ngn-anchor.toml') },
    'https://ngn.example.com/sep24/info': { body: json('ngn-sep24-info.json') },
    'https://ngn.example.com/sep38/price': { body: json('ngn-sep38-price.json') },
    'https://ngn.example.com/sep24/transactions/withdraw/interactive': {
      body: json('sep24-interactive.json'),
    },
    'https://ngn.example.com/sep24/transactions/deposit/interactive': {
      body: json('sep24-interactive.json'),
    },
    'https://ngn.example.com/sep24/transaction': {
      body: json('sep24-transaction-pending-stellar.json'),
    },
    'https://ngn.example.com/sep12/customer': { body: json('sep12-customer-needs-info.json') },
  };
}

/**
 * Await a call that must fail, and return its `RampError`.
 *
 * Using `.catch()` inline widens the result to a union with the success type,
 * which makes every assertion on `error.code` a type error.
 *
 * @param promise - A call that is expected to reject.
 * @returns The `RampError` it rejected with.
 *
 * @example
 * ```ts
 * const error = await rejection(fetchAnchorToml('x', harness.fetch));
 * expect(error.code).toBe('PROVIDER_UNAVAILABLE');
 * ```
 */
export async function rejection(promise: Promise<unknown>): Promise<RampError> {
  try {
    await promise;
  } catch (error) {
    if (RampError.is(error)) return error;
    throw new Error(`Expected a RampError, got: ${String(error)}`);
  }
  throw new Error('Expected the call to reject, but it resolved.');
}
