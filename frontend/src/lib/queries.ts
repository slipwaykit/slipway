/**
 * Every query the interface makes, in one place.
 *
 * Defined with `queryOptions` so the key, the fetcher and the caching policy
 * travel together and a component cannot pair a key with the wrong fetcher.
 */

import { queryOptions } from '@tanstack/react-query';
import {
  apiGet,
  type AnchorsResponse,
  type CorridorsResponse,
  type HistoryResponse,
  type QuotesResponse,
} from './api';

/** What the quote picker asks for. */
export interface QuoteParams {
  readonly country: string;
  readonly fiat: string;
  readonly direction: 'deposit' | 'withdraw';
  /** A decimal string, exactly as typed. */
  readonly amount: string;
  readonly method: string;
}

/**
 * A live comparison.
 *
 * Not refetched on window focus: silently reshuffling a list someone is
 * reading, or swapping the quote they were about to pick, is worse than a
 * quote that visibly expires and asks to be refreshed.
 *
 * @param params - The route to price.
 * @returns Query options for `useQuery`.
 *
 * @example
 * ```ts
 * const { data } = useQuery(quotesQuery({ country: 'NG', fiat: 'NGN', direction: 'withdraw', amount: '100', method: 'bank_transfer' }));
 * ```
 */
export function quotesQuery(params: QuoteParams) {
  const search = new URLSearchParams({ ...params });
  return queryOptions({
    queryKey: ['quotes', params],
    queryFn: ({ signal }) => apiGet<QuotesResponse>(`/api/quotes?${search.toString()}`, signal),
    staleTime: 0,
    gcTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

/**
 * Known anchors and their health.
 *
 * @returns Query options for `useQuery`.
 *
 * @example
 * ```ts
 * const { data } = useQuery(anchorsQuery());
 * ```
 */
export function anchorsQuery() {
  return queryOptions({
    queryKey: ['anchors'],
    queryFn: ({ signal }) => apiGet<AnchorsResponse>('/api/anchors', signal),
    staleTime: 60_000,
  });
}

/**
 * Supported corridors.
 *
 * @returns Query options for `useQuery`.
 *
 * @example
 * ```ts
 * const { data } = useQuery(corridorsQuery());
 * ```
 */
export function corridorsQuery() {
  return queryOptions({
    queryKey: ['corridors'],
    queryFn: ({ signal }) => apiGet<CorridorsResponse>('/api/corridors', signal),
    staleTime: 5 * 60_000,
  });
}

/**
 * One corridor's recorded history.
 *
 * @param id - Corridor id, e.g. `NG-NGN-USDC-withdraw`.
 * @param days - Window, 1 to 365.
 * @returns Query options for `useQuery`.
 *
 * @example
 * ```ts
 * const { data } = useQuery(historyQuery('NG-NGN-USDC-withdraw', 7));
 * ```
 */
export function historyQuery(id: string, days: number) {
  return queryOptions({
    queryKey: ['history', id, days],
    queryFn: ({ signal }) =>
      apiGet<HistoryResponse>(`/api/corridors/${encodeURIComponent(id)}/history?days=${days}`, signal),
    staleTime: 60_000,
  });
}
