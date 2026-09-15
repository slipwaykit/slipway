import { describe, expect, it } from 'vitest';
import { RampError } from '@slipwaykit/core';

describe('RampError', () => {
  it('defaults to not retryable', () => {
    expect(new RampError('UNSUPPORTED_ROUTE', 'no').retryable).toBe(false);
  });

  it('carries the provider body verbatim', () => {
    const body = { error: 'anchor down', code: 7 };
    const error = new RampError('PROVIDER_UNAVAILABLE', 'down', {
      retryable: true,
      providerDetail: body,
      httpStatus: 503,
    });
    expect(error.providerDetail).toEqual(body);
    expect(error.httpStatus).toBe(503);
    expect(error.retryable).toBe(true);
  });

  it('recognises its own instances structurally', () => {
    expect(RampError.is(new RampError('NOT_FOUND', 'x'))).toBe(true);
    expect(RampError.is(new Error('x'))).toBe(false);
    expect(RampError.is('NOT_FOUND')).toBe(false);
    expect(RampError.is(undefined)).toBe(false);
  });

  it('passes an existing RampError through `from` untouched', () => {
    const original = new RampError('KYC_REQUIRED', 'verify first');
    expect(RampError.from(original)).toBe(original);
  });

  it('wraps a raw throw so nothing else escapes an adapter', () => {
    const wrapped = RampError.from(new TypeError('fetch failed'));
    expect(wrapped.code).toBe('PROVIDER_UNAVAILABLE');
    expect(wrapped.retryable).toBe(true);
    expect(wrapped.message).toBe('fetch failed');
    expect(wrapped.cause).toBeInstanceOf(TypeError);
  });

  it('wraps a thrown string, which is the ugliest thing a provider SDK does', () => {
    const wrapped = RampError.from('boom', 'PROVIDER_REJECTED');
    expect(wrapped.code).toBe('PROVIDER_REJECTED');
    expect(wrapped.retryable).toBe(false);
    expect(wrapped.message).toBe('boom');
  });

  it('serialises to a JSON-safe body without leaking the provider detail', () => {
    const error = new RampError('RATE_LIMITED', 'slow down', {
      retryable: true,
      httpStatus: 429,
      providerDetail: { secret: 'do-not-ship' },
    });
    const json = error.toJSON();
    expect(json).toEqual({
      code: 'RATE_LIMITED',
      message: 'slow down',
      retryable: true,
      httpStatus: 429,
    });
    expect(JSON.stringify(json)).not.toContain('do-not-ship');
  });

  it('is catchable as an Error with a useful name', () => {
    try {
      throw new RampError('QUOTE_INCOMPLETE', 'cannot compute landed amount');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).name).toBe('RampError');
    }
  });
});
