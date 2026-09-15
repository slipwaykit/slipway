/**
 * Display formatting for amounts and times.
 *
 * Amounts arrive as decimal strings and are formatted as strings:
 * `Intl.NumberFormat` accepts a decimal string directly, so a naira amount is
 * never round-tripped through a float on its way to the screen.
 */

/**
 * Whether a code is a fiat currency, which gets two decimal places.
 * Stellar asset codes such as `USDC` keep up to seven.
 */
function isFiat(code: string): boolean {
  return /^[A-Z]{3}$/.test(code) && code !== 'XLM';
}

/**
 * Format a decimal string for display, with its currency code.
 *
 * Rounds **toward zero**. Showing a landed amount a kobo higher than what
 * actually lands would be a small lie, and this project exists to stop those.
 *
 * @param amount - A decimal string, e.g. `'156243.756'`.
 * @param currency - A fiat or asset code.
 * @returns e.g. `'156,243.75 NGN'`.
 *
 * @example
 * ```ts
 * formatAmount('156243.756', 'NGN'); // '156,243.75 NGN'
 * formatAmount('94.2857', 'USDC');   // '94.2857 USDC'
 * ```
 */
export function formatAmount(amount: string, currency: string): string {
  const fiat = isFiat(currency);
  const formatter = new Intl.NumberFormat('en', {
    minimumFractionDigits: fiat ? 2 : 0,
    maximumFractionDigits: fiat ? 2 : 7,
    roundingMode: 'trunc',
  });
  return `${formatter.format(amount as Intl.StringNumericLiteral)} ${currency}`;
}

/**
 * Format a rate, e.g. `1 USDC = 1,602.50 NGN`.
 *
 * @param rate - Buy units per sell unit, as a decimal string.
 * @param sell - The sell currency.
 * @param buy - The buy currency.
 * @returns A readable rate.
 *
 * @example
 * ```ts
 * formatRate('1602.5', 'USDC', 'NGN'); // '1 USDC = 1,602.50 NGN'
 * ```
 */
export function formatRate(rate: string, sell: string, buy: string): string {
  return `1 ${sell} = ${formatAmount(rate, buy)}`;
}

/**
 * How long ago something happened, in words.
 *
 * @param timestamp - Unix epoch milliseconds.
 * @param now - The current time, injectable for tests.
 * @returns e.g. `'3 minutes ago'`.
 *
 * @example
 * ```ts
 * formatRelative(Date.now() - 180_000); // '3 minutes ago'
 * ```
 */
export function formatRelative(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.round((timestamp - now) / 1000);
  const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const abs = Math.abs(seconds);
  if (abs < 60) return format.format(seconds, 'second');
  if (abs < 3600) return format.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return format.format(Math.round(seconds / 3600), 'hour');
  return format.format(Math.round(seconds / 86_400), 'day');
}

/**
 * Shorten a hash for display, keeping both ends recognisable.
 *
 * @param hash - A transaction hash.
 * @returns e.g. `'cc93fb…35b6'`.
 *
 * @example
 * ```ts
 * shortHash('cc93fbc70d0a35c57d53bff1f8c1e613fe9207f1dd8133a34311b2f4a5eb35b6'); // 'cc93fb…35b6'
 * ```
 */
export function shortHash(hash: string): string {
  return hash.length <= 12 ? hash : `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}
