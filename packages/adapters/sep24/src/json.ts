/**
 * Narrowing helpers for JSON that arrived from an anchor.
 *
 * Nothing in a provider response is trustworthy enough to be typed as anything
 * but `unknown`. These helpers turn `unknown` into a known shape or into
 * `undefined`, so that a missing field becomes an omitted property rather than
 * a `NaN` that silently poisons a landed amount.
 *
 * Internal to the adapter; not part of the public API.
 */

/** Narrow to a plain object, rejecting arrays and `null`. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Narrow to a non-empty string. */
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Narrow to a boolean, treating anything else as absent. */
export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/** Narrow to an array of unknowns. */
export function asArray(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

/**
 * Expand exponent notation into a plain decimal string.
 *
 * `JSON.parse` turns a small anchor fee into a JS number, and `String(1e-7)` is
 * `'1e-7'`, which is not a decimal string Slipway will accept. This rewrites it
 * as `'0.0000001'` without going through a float again.
 */
function expandExponent(input: string): string | undefined {
  const match = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(input.trim());
  if (!match) return undefined;

  const sign = match[1] ?? '';
  const integer = match[2] ?? '0';
  const fraction = match[3] ?? '';
  const exponent = Number(match[4]);
  const digits = integer + fraction;
  const point = integer.length + exponent;

  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

/**
 * Turn an anchor's amount into a decimal string, or `undefined`.
 *
 * SEP-24 `/info` reports amounts as JSON numbers and SEP-38 reports them as
 * strings, so both have to be accepted at the edge. Everything downstream of
 * this function is a string (rule 1).
 *
 * `undefined` means "the anchor did not say", which is different from zero and
 * must stay different: an absent `min_amount` is not a minimum of nothing.
 */
export function asDecimalString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return undefined;
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return trimmed;
    return expandExponent(trimmed);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    const rendered = String(value);
    return rendered.includes('e') || rendered.includes('E')
      ? expandExponent(rendered)
      : rendered;
  }
  return undefined;
}
