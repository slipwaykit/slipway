/**
 * The HTTP contract, for consumers of the API.
 *
 * Type-only: importing this pulls no runtime code into a bundle. The frontend
 * imports its response types from here, so a change to a route's shape is a
 * type error in the frontend rather than a silent `undefined` at runtime.
 *
 * @example
 * ```ts
 * import type { QuotesResponse } from '../../backend/src/api-types';
 * ```
 */

export type { ApiErrorBody } from './deps.js';
export type { AnchorsResponse, AnchorView } from './routes/anchors.js';
export type {
  CorridorsResponse,
  CorridorView,
  HistoryResponse,
  SnapshotView,
} from './routes/corridors.js';
export type { QuoteErrorView, QuotesResponse, QuoteView } from './routes/quotes.js';
