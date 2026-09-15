'use client';

import { useEffect, useState } from 'react';

/**
 * The current time, updated on an interval while the component is mounted.
 *
 * @param intervalMs - How often to tick. Defaults to one second.
 * @returns Unix epoch milliseconds.
 *
 * @example
 * ```tsx
 * const now = useNow();
 * const left = secondsLeft(quote.expiresAt, now);
 * ```
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
