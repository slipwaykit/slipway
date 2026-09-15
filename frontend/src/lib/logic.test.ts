import { describe, expect, it } from 'vitest';
import type { QuoteView } from './api';
import { ERROR_MESSAGES, describeError } from './errors';
import { formatAmount, formatRate, formatRelative, shortHash } from './format';
import { countryName, corridorLabel } from './labels';
import { feeTotal, secondsLeft, shortfall, sortByLanded } from './quotes';

function quote(overrides: Partial<QuoteView>): QuoteView {
  return {
    adapterId: 'mock:x',
    adapterName: 'X',
    isMock: true,
    sellAmount: '100',
    buyAmount: '158000',
    landedAmount: '158000',
    rate: '1580',
    fees: [],
    expiresAt: 1_000_000,
    latencyMs: 1,
    ...overrides,
  };
}

describe('sortByLanded', () => {
  it('ranks by what lands, never by the advertised rate', () => {
    const flashy = quote({ adapterId: 'flashy', rate: '1650', landedAmount: '155000' });
    const honest = quote({ adapterId: 'honest', rate: '1580', landedAmount: '157500' });

    expect(sortByLanded([flashy, honest]).map((q) => q.adapterId)).toEqual(['honest', 'flashy']);
  });

  it('compares decimal strings exactly, not as floats or as text', () => {
    // As text '9' > '10'; as floats these two differ in the 17th digit.
    const a = quote({ adapterId: 'a', landedAmount: '9.99' });
    const b = quote({ adapterId: 'b', landedAmount: '10' });
    const c = quote({ adapterId: 'c', landedAmount: '10.000000000000000001' });

    expect(sortByLanded([a, b, c]).map((q) => q.adapterId)).toEqual(['c', 'b', 'a']);
  });

  it('keeps arrival order for ties and does not mutate its input', () => {
    const input = [quote({ adapterId: 'first' }), quote({ adapterId: 'second' })];

    expect(sortByLanded(input).map((q) => q.adapterId)).toEqual(['first', 'second']);
    expect(input[0]?.adapterId).toBe('first');
  });
});

describe('expiry and shortfall', () => {
  it('counts whole seconds down and never goes negative', () => {
    expect(secondsLeft(10_000, 0)).toBe(10);
    expect(secondsLeft(10_000, 9_001)).toBe(1);
    expect(secondsLeft(10_000, 10_000)).toBe(0);
    expect(secondsLeft(10_000, 99_999)).toBe(0);
  });

  it('reports how much less than the best a quote lands', () => {
    const best = quote({ landedAmount: '157500' });

    expect(shortfall(quote({ landedAmount: '155000' }), best)).toBe('2500');
    expect(shortfall(best, best)).toBeUndefined();
  });

  it('totals fees in one currency and refuses to add mixed currencies', () => {
    expect(
      feeTotal(quote({ fees: [{ kind: 'spread', amount: '2000', currency: 'NGN' }, { kind: 'fixed', amount: '500.5', currency: 'NGN' }] })),
    ).toBe('2500.5');
    expect(
      feeTotal(quote({ fees: [{ kind: 'fixed', amount: '1', currency: 'USDC' }, { kind: 'fixed', amount: '500', currency: 'NGN' }] })),
    ).toBeUndefined();
  });
});

describe('formatAmount', () => {
  it('truncates rather than rounds, so a landed amount is never overstated', () => {
    expect(formatAmount('156243.756', 'NGN')).toBe('156,243.75 NGN');
    expect(formatAmount('0.999', 'NGN')).toBe('0.99 NGN');
  });

  it('gives fiat two places and assets up to seven', () => {
    expect(formatAmount('100', 'NGN')).toBe('100.00 NGN');
    expect(formatAmount('94.2857', 'USDC')).toBe('94.2857 USDC');
    expect(formatAmount('1.00000019', 'XLM')).toBe('1.0000001 XLM');
  });

  it('formats a large amount without float precision loss', () => {
    expect(formatAmount('9007199254740993.25', 'NGN')).toBe('9,007,199,254,740,993.25 NGN');
  });

  it('formats a rate as a sentence', () => {
    expect(formatRate('1602.5', 'USDC', 'NGN')).toBe('1 USDC = 1,602.50 NGN');
  });
});

describe('formatRelative and shortHash', () => {
  it('picks a sensible unit', () => {
    const now = 10_000_000;
    expect(formatRelative(now - 30_000, now)).toBe('30 seconds ago');
    expect(formatRelative(now - 180_000, now)).toBe('3 minutes ago');
    expect(formatRelative(now - 7_200_000, now)).toBe('2 hours ago');
  });

  it('keeps both ends of a hash', () => {
    expect(shortHash('cc93fbc70d0a35c57d53bff1f8c1e613fe9207f1dd8133a34311b2f4a5eb35b6')).toBe('cc93fb…35b6');
    expect(shortHash('short')).toBe('short');
  });
});

describe('ERROR_MESSAGES', () => {
  it('has words for every adapter and API code', () => {
    expect(Object.keys(ERROR_MESSAGES).sort()).toEqual(
      [
        'AMOUNT_OUT_OF_BOUNDS',
        'AUTH_INVALID',
        'AUTH_REQUIRED',
        'INTERNAL_ERROR',
        'INVALID_REQUEST',
        'KYC_REQUIRED',
        'NETWORK_ERROR',
        'NOT_FOUND',
        'PROVIDER_REJECTED',
        'PROVIDER_UNAVAILABLE',
        'QUOTE_EXPIRED',
        'QUOTE_INCOMPLETE',
        'RATE_LIMITED',
        'UNSUPPORTED_ROUTE',
      ].sort(),
    );
  });

  it('never leaks a raw code into the text a person reads', () => {
    for (const message of Object.values(ERROR_MESSAGES)) {
      expect(`${message.title} ${message.description}`).not.toMatch(/[A-Z]{2,}_[A-Z]/);
    }
  });

  it('renders an unknown code from a newer backend as something readable', () => {
    expect(describeError('SOMETHING_NEW')).toBe(ERROR_MESSAGES.INTERNAL_ERROR);
    expect(describeError('QUOTE_INCOMPLETE').title).toBe("Wouldn't disclose its full fees");
  });
});

describe('labels', () => {
  it('names countries and corridors in both directions', () => {
    expect(countryName('KE')).toBe('Kenya');
    expect(corridorLabel({ country: 'NG', fiat: 'NGN', assetCode: 'USDC', direction: 'withdraw' })).toBe('Nigeria · USDC → NGN');
    expect(corridorLabel({ country: 'NG', fiat: 'NGN', assetCode: 'USDC', direction: 'deposit' })).toBe('Nigeria · NGN → USDC');
  });
});
