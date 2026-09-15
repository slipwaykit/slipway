/**
 * Human names for codes the API speaks in.
 */

/**
 * Payment methods, as a person would say them.
 *
 * @example
 * ```ts
 * METHOD_LABELS.mobile_money; // 'Mobile money'
 * ```
 */
export const METHOD_LABELS = {
  bank_transfer: 'Bank transfer',
  mobile_money: 'Mobile money',
  card: 'Card',
  cash_pickup: 'Cash pickup',
  ussd: 'USSD',
} as const;

/** A payment method code. */
export type MethodCode = keyof typeof METHOD_LABELS;

const regions = new Intl.DisplayNames(['en'], { type: 'region' });

/**
 * A country's name from its ISO code.
 *
 * @param code - ISO 3166-1 alpha-2.
 * @returns e.g. `'Nigeria'`, or the code itself if unknown.
 *
 * @example
 * ```ts
 * countryName('KE'); // 'Kenya'
 * ```
 */
export function countryName(code: string): string {
  try {
    return regions.of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * A corridor id as a readable phrase.
 *
 * @param corridor - Corridor fields.
 * @returns e.g. `'Nigeria · USDC → NGN'`.
 *
 * @example
 * ```ts
 * corridorLabel({ country: 'NG', fiat: 'NGN', assetCode: 'USDC', direction: 'withdraw' }); // 'Nigeria · USDC → NGN'
 * ```
 */
export function corridorLabel(corridor: {
  country: string;
  fiat: string;
  assetCode: string;
  direction: string;
}): string {
  const [from, to] =
    corridor.direction === 'deposit'
      ? [corridor.fiat, corridor.assetCode]
      : [corridor.assetCode, corridor.fiat];
  return `${countryName(corridor.country)} · ${from} → ${to}`;
}
