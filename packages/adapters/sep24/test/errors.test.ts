import { describe, expect, it, vi } from 'vitest';
import type { RampErrorCode } from '@slipwaykit/core';
import { REQUEST_TIMEOUT_MS, mapHttpError, requestJson } from '@slipwaykit/adapter-sep24';
import { harnessFor, json, rejection } from './harness.js';

const url = 'https://ngn.example.com/sep24/info';

/** Every row of the error mapping table in the build specification. */
const TABLE: readonly (readonly [number, RampErrorCode, boolean])[] = [
  [400, 'PROVIDER_REJECTED', false],
  [401, 'AUTH_INVALID', false],
  [403, 'AUTH_INVALID', false],
  [404, 'NOT_FOUND', false],
  [429, 'RATE_LIMITED', true],
  [500, 'PROVIDER_UNAVAILABLE', true],
  [502, 'PROVIDER_UNAVAILABLE', true],
  [503, 'PROVIDER_UNAVAILABLE', true],
];

describe('mapHttpError', () => {
  it.each(TABLE)('maps HTTP %i to %s (retryable: %s)', (status, code, retryable) => {
    const error = mapHttpError(status, { error: 'nope' }, 'GET /info');

    expect(error.code).toBe(code);
    expect(error.retryable).toBe(retryable);
    expect(error.httpStatus).toBe(status);
  });

  it('separates a SEP-12 403 from a SEP-10 403', () => {
    const kyc = mapHttpError(403, { type: 'customer_info_status', status: 'NEEDS_INFO' }, 'x');
    const auth = mapHttpError(403, { error: 'forbidden' }, 'x');

    expect(kyc.code).toBe('KYC_REQUIRED');
    expect(auth.code).toBe('AUTH_INVALID');
  });

  it('treats a 403 carrying a fields object as a KYC requirement', () => {
    const error = mapHttpError(403, { fields: { first_name: { type: 'string' } } }, 'x');

    expect(error.code).toBe('KYC_REQUIRED');
  });

  it('carries the provider message into the error text', () => {
    const error = mapHttpError(400, { error: 'amount below minimum' }, 'SEP-38 GET /price');

    expect(error.message).toContain('SEP-38 GET /price');
    expect(error.message).toContain('amount below minimum');
  });

  it('reads a provider message from error, message or detail', () => {
    expect(mapHttpError(400, { message: 'mm' }, 'x').message).toContain('mm');
    expect(mapHttpError(400, { detail: 'dd' }, 'x').message).toContain('dd');
  });

  it('always attaches the raw body as providerDetail', () => {
    const body = { error: 'nope', trace: 'abc-123' };

    expect(mapHttpError(400, body, 'x').providerDetail).toEqual(body);
    expect(mapHttpError(500, '<html>502 Bad Gateway</html>', 'x').providerDetail).toBe(
      '<html>502 Bad Gateway</html>',
    );
  });

  it('maps the recorded 403 from the live SDF test anchor', () => {
    const error = mapHttpError(403, json('testanchor-sep24-forbidden.json'), 'GET /transaction');

    expect(error.code).toBe('AUTH_INVALID');
    expect(error.message).toContain('forbidden');
  });

  it('maps the recorded 400 the SDF test anchor returns for context=sep24', () => {
    // Recorded 2026-09-15: testanchor.stellar.org supports only sep6 and sep31
    // contexts on SEP-38, so a correct SEP-24 request gets a 400 from it.
    const error = mapHttpError(
      400,
      json('testanchor-sep38-price-unsupported-context.json'),
      'SEP-38 GET /price',
    );

    expect(error.code).toBe('PROVIDER_REJECTED');
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('Unsupported context');
  });

  it('maps an unusual 4xx to PROVIDER_REJECTED rather than letting it through', () => {
    expect(mapHttpError(418, { error: 'teapot' }, 'x').code).toBe('PROVIDER_REJECTED');
  });
});

describe('requestJson', () => {
  it('returns a parsed body on success', async () => {
    const harness = harnessFor({ [url]: { body: { deposit: {} } } });

    const body = await requestJson({ url, context: 'GET /info', fetchImpl: harness.fetch });

    expect(body).toEqual({ deposit: {} });
  });

  it('sends a bearer token only when one was supplied', async () => {
    const seen: (string | null)[] = [];
    const recording = (async (input: string | URL | Request, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get('authorization'));
      void input;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    await requestJson({ url, context: 'x', fetchImpl: recording, token: 'jwt-abc' });
    await requestJson({ url, context: 'x', fetchImpl: recording });

    expect(seen).toEqual(['Bearer jwt-abc', null]);
  });

  it('maps a transport failure to a retryable PROVIDER_UNAVAILABLE', async () => {
    const harness = harnessFor({ [url]: { throws: new TypeError('ECONNREFUSED') } });

    await expect(
      requestJson({ url, context: 'GET /info', fetchImpl: harness.fetch }),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retryable: true });
  });

  it('never lets a thrown string escape as a raw value', async () => {
    const harness = harnessFor({ [url]: { throws: 'something went wrong' } });

    const error = await rejection(
      requestJson({ url, context: 'GET /info', fetchImpl: harness.fetch }),
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retryable: true });
  });

  it('aborts a hanging anchor after the 10 second timeout', async () => {
    vi.useFakeTimers();
    try {
      const harness = harnessFor({ [url]: { hang: true } });
      const pending = requestJson({ url, context: 'GET /info', fetchImpl: harness.fetch });
      // Assert on the rejection before advancing, so the rejection is never
      // unhandled between the timer firing and the assertion attaching.
      const assertion = expect(pending).rejects.toMatchObject({
        code: 'PROVIDER_UNAVAILABLE',
        retryable: true,
        message: expect.stringContaining(`timed out after ${REQUEST_TIMEOUT_MS}ms`),
      });

      // The adapter's own AbortController is what has to fire here.
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a non-JSON error page as evidence instead of throwing on the parse', async () => {
    const harness = harnessFor({ [url]: { status: 502, text: '<html>Bad Gateway</html>' } });

    const error = await rejection(
      requestJson({ url, context: 'GET /info', fetchImpl: harness.fetch }),
    );

    expect(error.providerDetail).toBe('<html>Bad Gateway</html>');
  });
});
