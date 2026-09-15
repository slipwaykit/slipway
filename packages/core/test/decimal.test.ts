import { describe, expect, it } from 'vitest';
import { RampError, decimal } from '@slipwaykit/core';

describe('decimal', () => {
  it('adds without binary floating point error', () => {
    expect(decimal.add('0.1', '0.2')).toBe('0.3');
    expect(decimal.add('1580.25', '0.75')).toBe('1581');
  });

  it('subtracts a fee from a gross amount exactly', () => {
    expect(decimal.sub('158000.00', '1500.00')).toBe('156500');
    expect(decimal.sub('0.3', '0.1')).toBe('0.2');
  });

  it('multiplies an amount by a rate at full precision', () => {
    expect(decimal.mul('100', '1580.25')).toBe('158025');
    expect(decimal.mul('0.1', '0.2')).toBe('0.02');
  });

  it('survives magnitudes that overflow a double', () => {
    // 2^53 + 1 is not representable as a JS number; it must survive here.
    expect(decimal.add('9007199254740992', '1')).toBe('9007199254740993');
  });

  it('divides with configurable precision, truncating toward zero', () => {
    expect(decimal.div('158025', '100')).toBe('1580.25');
    expect(decimal.div('1', '3', 4)).toBe('0.3333');
    expect(decimal.div('2', '3', 4)).toBe('0.6666');
  });

  it('refuses to divide by zero rather than returning Infinity', () => {
    expect(() => decimal.div('100', '0')).toThrow(RampError);
    expect(() => decimal.div('100', '0.00')).toThrow(/Division by zero/);
  });

  it('compares regardless of trailing zeros', () => {
    expect(decimal.cmp('5.0', '5')).toBe(0);
    expect(decimal.cmp('100', '99.999')).toBe(1);
    expect(decimal.cmp('-1', '0')).toBe(-1);
  });

  it('sums a fee list, and an empty list to zero', () => {
    expect(decimal.sum(['1500.00', '250.00', '12.50'])).toBe('1762.5');
    expect(decimal.sum([])).toBe('0');
  });

  it('rounds half away from zero and always emits the requested places', () => {
    expect(decimal.round('1580.255', 2)).toBe('1580.26');
    expect(decimal.round('1580.254', 2)).toBe('1580.25');
    expect(decimal.round('100', 2)).toBe('100.00');
    expect(decimal.round('-1.005', 2)).toBe('-1.01');
    expect(decimal.round('2.5', 0)).toBe('3');
  });

  it('treats negative zero as zero', () => {
    expect(decimal.normalise('-0.0')).toBe('0');
    expect(decimal.isNegative('-0.00')).toBe(false);
    expect(decimal.isNegative('-0.01')).toBe(true);
  });

  it('normalises away leading and trailing zeros', () => {
    expect(decimal.normalise('007.5000')).toBe('7.5');
    expect(decimal.normalise('0.000')).toBe('0');
  });

  it('rejects the string shapes that poison a calculation', () => {
    expect(decimal.isDecimal('1580.25')).toBe(true);
    expect(decimal.isDecimal('-0.5')).toBe(true);
    for (const bad of ['1,580.25', '1.58e3', '', '.', 'abc', 'NaN', 'Infinity', '1.2.3']) {
      expect(decimal.isDecimal(bad), bad).toBe(false);
      expect(() => decimal.add(bad, '1'), bad).toThrow(RampError);
    }
  });

  it('rejects a number where a decimal string is required', () => {
    // A number reaching a money boundary is exactly what rule 1 forbids.
    expect(decimal.isDecimal(100.5)).toBe(false);
  });
});
