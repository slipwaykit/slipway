/**
 * Exact decimal arithmetic on money strings.
 *
 * Every function here takes decimal strings and returns a decimal string.
 * Internally values are held as a scaled `bigint`, so `add('0.1', '0.2')` is
 * `'0.3'` and not `'0.30000000000000004'`. Rate maths on a 1580 NGN/USD
 * corridor multiplies a small error by a large number, which is exactly the
 * situation binary floating point handles worst.
 */

import { RampError } from './errors.js';

/** A value scaled by a power of ten: `units / 10n ** BigInt(scale)`. */
interface Scaled {
  readonly units: bigint;
  readonly scale: number;
}

/** Decimal places carried through a division before the result is trimmed. */
const DIVISION_PRECISION = 30;

const DECIMAL_PATTERN = /^-?(?:\d+)(?:\.\d+)?$/;

function fail(value: string): never {
  throw new RampError('QUOTE_INCOMPLETE', `Not a decimal string: ${JSON.stringify(value)}`);
}

function parse(value: string): Scaled {
  if (typeof value !== 'string') fail(String(value));
  const trimmed = value.trim();
  if (trimmed === '' || !DECIMAL_PATTERN.test(trimmed)) fail(value);

  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const dot = unsigned.indexOf('.');
  const digits = dot === -1 ? unsigned : unsigned.slice(0, dot) + unsigned.slice(dot + 1);
  const scale = dot === -1 ? 0 : unsigned.length - dot - 1;
  const units = BigInt(digits);
  return { units: negative ? -units : units, scale };
}

function rescale(value: Scaled, scale: number): Scaled {
  if (scale === value.scale) return value;
  if (scale < value.scale) throw new Error('rescale only widens');
  return { units: value.units * 10n ** BigInt(scale - value.scale), scale };
}

function align(a: Scaled, b: Scaled): readonly [Scaled, Scaled] {
  const scale = Math.max(a.scale, b.scale);
  return [rescale(a, scale), rescale(b, scale)];
}

function render({ units, scale }: Scaled): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = scale === 0 ? '' : digits.slice(digits.length - scale).replace(/0+$/, '');
  const body = fraction === '' ? whole : `${whole}.${fraction}`;
  return negative && /[1-9]/.test(digits) ? `-${body}` : body;
}

/**
 * Whether a string is a well-formed decimal Slipway will accept.
 *
 * Rejects exponent notation, thousands separators, a bare `.` and the empty
 * string, all of which are ways a provider response can quietly poison a
 * calculation.
 *
 * @param value - The candidate string.
 * @returns Whether it parses as a decimal.
 *
 * @example
 * ```ts
 * isDecimal('1580.25');  // true
 * isDecimal('1,580.25'); // false
 * isDecimal('1.58e3');   // false
 * ```
 */
export function isDecimal(value: unknown): value is string {
  return typeof value === 'string' && DECIMAL_PATTERN.test(value.trim());
}

/**
 * Add two decimal strings exactly.
 *
 * @param a - Left operand.
 * @param b - Right operand.
 * @returns The sum.
 *
 * @example
 * ```ts
 * add('0.1', '0.2');  // '0.3'
 * ```
 */
export function add(a: string, b: string): string {
  const [x, y] = align(parse(a), parse(b));
  return render({ units: x.units + y.units, scale: x.scale });
}

/**
 * Subtract one decimal string from another exactly.
 *
 * @param a - The value to subtract from.
 * @param b - The value to subtract.
 * @returns The difference.
 *
 * @example
 * ```ts
 * sub('158000.00', '1500.00');  // '156500'
 * ```
 */
export function sub(a: string, b: string): string {
  const [x, y] = align(parse(a), parse(b));
  return render({ units: x.units - y.units, scale: x.scale });
}

/**
 * Multiply two decimal strings exactly.
 *
 * @param a - Left operand.
 * @param b - Right operand.
 * @returns The product, at the sum of the operands' scales.
 *
 * @example
 * ```ts
 * mul('100', '1580.25');  // '158025'
 * ```
 */
export function mul(a: string, b: string): string {
  const x = parse(a);
  const y = parse(b);
  return render({ units: x.units * y.units, scale: x.scale + y.scale });
}

/**
 * Divide one decimal string by another, truncating toward zero.
 *
 * Carries 30 decimal places internally, then trims trailing zeros. Throws
 * rather than returning `Infinity` when the divisor is zero, because a rate of
 * `Infinity` displayed to a user is worse than a failed quote.
 *
 * @param a - Dividend.
 * @param b - Divisor.
 * @param places - Decimal places to keep. Defaults to 30.
 * @returns The quotient.
 * @throws A `RampError` with `QUOTE_INCOMPLETE` when `b` is zero.
 *
 * @example
 * ```ts
 * div('158025', '100');  // '1580.25'
 * div('1', '3', 4);      // '0.3333'
 * ```
 */
export function div(a: string, b: string, places: number = DIVISION_PRECISION): string {
  const x = parse(a);
  const y = parse(b);
  if (y.units === 0n) {
    throw new RampError('QUOTE_INCOMPLETE', 'Division by zero while pricing a quote.');
  }
  const shift = places + y.scale - x.scale;
  const numerator = shift >= 0 ? x.units * 10n ** BigInt(shift) : x.units;
  const denominator = shift >= 0 ? y.units : y.units * 10n ** BigInt(-shift);
  return render({ units: numerator / denominator, scale: places });
}

/**
 * Compare two decimal strings.
 *
 * @param a - Left operand.
 * @param b - Right operand.
 * @returns `-1` when `a < b`, `0` when equal, `1` when `a > b`.
 *
 * @example
 * ```ts
 * cmp('100', '99.999');   //  1
 * cmp('5.0', '5');        //  0
 * ```
 */
export function cmp(a: string, b: string): -1 | 0 | 1 {
  const [x, y] = align(parse(a), parse(b));
  if (x.units < y.units) return -1;
  if (x.units > y.units) return 1;
  return 0;
}

/**
 * Add a list of decimal strings exactly.
 *
 * @param values - The values to total. An empty list totals to `'0'`.
 * @returns The sum.
 *
 * @example
 * ```ts
 * sum(['1500.00', '250.00', '12.50']);  // '1762.5'
 * ```
 */
export function sum(values: readonly string[]): string {
  return values.reduce((total, value) => add(total, value), '0');
}

/**
 * Whether a decimal string is negative.
 *
 * @param value - The value to test.
 * @returns Whether it is below zero.
 *
 * @example
 * ```ts
 * isNegative('-0.01');  // true
 * isNegative('-0.00');  // false
 * ```
 */
export function isNegative(value: string): boolean {
  return parse(value).units < 0n;
}

/**
 * Round a decimal string to a fixed number of places, half away from zero.
 *
 * Unlike `Number.prototype.toFixed` this is exact at any magnitude and always
 * emits exactly `places` decimals, which is what a currency display wants.
 *
 * @param value - The value to round.
 * @param places - Decimal places to keep. Must not be negative.
 * @returns The rounded value, with exactly `places` decimals.
 *
 * @example
 * ```ts
 * round('1580.255', 2);  // '1580.26'
 * round('100', 2);       // '100.00'
 * ```
 */
export function round(value: string, places: number): string {
  const parsed = parse(value);
  if (places < 0 || !Number.isInteger(places)) {
    throw new RampError('QUOTE_INCOMPLETE', `Invalid rounding precision: ${places}`);
  }
  let units: bigint;
  if (places >= parsed.scale) {
    units = rescale(parsed, places).units;
  } else {
    const divisor = 10n ** BigInt(parsed.scale - places);
    const negative = parsed.units < 0n;
    const magnitude = negative ? -parsed.units : parsed.units;
    const quotient = magnitude / divisor;
    const remainder = magnitude % divisor;
    const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;
    units = negative ? -rounded : rounded;
  }
  const digits = (units < 0n ? -units : units).toString().padStart(places + 1, '0');
  const whole = digits.slice(0, digits.length - places);
  const fraction = places === 0 ? '' : `.${digits.slice(digits.length - places)}`;
  return `${units < 0n ? '-' : ''}${whole}${fraction}`;
}

/**
 * Normalise a decimal string to its canonical form.
 *
 * Strips leading zeros, trailing fractional zeros and a negative sign on zero,
 * so that values from different providers compare as equal strings.
 *
 * @param value - The value to normalise.
 * @returns The canonical form.
 *
 * @example
 * ```ts
 * normalise('007.5000');  // '7.5'
 * normalise('-0.0');      // '0'
 * ```
 */
export function normalise(value: string): string {
  return render(parse(value));
}
