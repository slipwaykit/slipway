/**
 * Rule 7, enforced rather than trusted.
 *
 * Replaces the global `fetch` for the whole suite. Every adapter takes a
 * `fetchImpl`, so a test that reaches this stub has forgotten to inject one and
 * would otherwise have depended on a live anchor being up. Failing loudly here
 * is the difference between a suite that passes offline and a suite that
 * happens to pass because the network was available.
 */

import { beforeAll } from 'vitest';

beforeAll(() => {
  globalThis.fetch = (async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    throw new Error(
      `Test suites must not use the network. Something called fetch("${url}") without ` +
        'injecting a fetchImpl. Record a fixture and pass it through the harness instead.',
    );
  }) as typeof fetch;
});
