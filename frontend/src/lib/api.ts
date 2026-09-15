/**
 * The only way the browser gets data: the Slipway backend.
 *
 * No component calls an anchor. Anchors do not send CORS headers, and even if
 * they did, reaching them from a phone on a slow network with a 10 second
 * timeout each would make the comparison unusable.
 */

import type { ApiErrorBody } from '../../../backend/src/api-types';
import type { DisplayErrorCode } from './errors';

export type {
  AnchorsResponse,
  AnchorView,
  CorridorsResponse,
  CorridorView,
  HistoryResponse,
  QuoteErrorView,
  QuotesResponse,
  QuoteView,
  SnapshotView,
} from '../../../backend/src/api-types';

/**
 * The backend's base URL.
 *
 * @example
 * ```ts
 * `${API_URL}/api/anchors`; // 'http://localhost:8787/api/anchors'
 * ```
 */
export const API_URL = (process.env.NEXT_PUBLIC_SLIPWAY_API_URL ?? 'http://localhost:8787').replace(
  /\/+$/,
  '',
);

/**
 * A failed call to the backend, carrying a code the interface can explain.
 *
 * @example
 * ```ts
 * if (error instanceof ApiError) describeError(error.code).title;
 * ```
 */
export class ApiError extends Error {
  /** A code with an entry in `ERROR_MESSAGES`, or one from a newer backend. */
  public readonly code: DisplayErrorCode | (string & {});
  /** HTTP status, or `0` when the backend could not be reached. */
  public readonly status: number;

  /**
   * @param code - What went wrong.
   * @param message - A developer-facing explanation.
   * @param status - HTTP status, `0` for a network failure.
   *
   * @example
   * ```ts
   * new ApiError('NETWORK_ERROR', 'fetch failed', 0);
   * ```
   */
  public constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/**
 * GET a backend path and return its JSON body.
 *
 * @param path - Path beginning `/api/`.
 * @param signal - Aborts the request when TanStack Query cancels it.
 * @returns The parsed body.
 * @throws An `ApiError`, always, for any failure.
 *
 * @example
 * ```ts
 * const body = await apiGet<AnchorsResponse>('/api/anchors');
 * ```
 */
export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      headers: { Accept: 'application/json' },
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('NETWORK_ERROR', error instanceof Error ? error.message : String(error), 0);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as ApiErrorBody | undefined;
    throw new ApiError(
      body?.error.code ?? (response.status >= 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST'),
      body?.error.message ?? `HTTP ${response.status}`,
      response.status,
    );
  }
  return (await response.json()) as T;
}
