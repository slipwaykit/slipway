/**
 * `GET /api/anchors` — who Slipway knows about and how they last behaved.
 *
 * Includes anchors Slipway cannot yet serve. An anchor listed with
 * `protocol: "sep6"` is one that exists and does not speak SEP-24, which is
 * more useful to a developer than pretending it is not there.
 */

import { Hono } from 'hono';
import { RampError } from '@slipwaykit/core';
import { anchors } from '../db/schema.js';
import type { AppDeps } from '../deps.js';
import { SEED_ANCHORS } from '../services/anchors.seed.js';
import { homeDomainOf } from '../services/registry.js';

/** One anchor, with its capability summary and health. */
export interface AnchorView {
  /** Home domain. */
  readonly homeDomain: string;
  /** Display name. */
  readonly name: string;
  /** What the domain advertises: `sep24`, `sep6` or `unknown`. */
  readonly protocol: string;
  /** Whether Slipway has an adapter that can serve it. */
  readonly usable: boolean;
  /** Countries this anchor is understood to serve. */
  readonly countries: readonly string[];
  /** Fiat currencies it is understood to serve. */
  readonly fiats: readonly string[];
  /** When it last answered, Unix epoch milliseconds, or null. */
  readonly lastSeenAt: number | null;
  /** The `RampErrorCode` of its most recent failure, or null. */
  readonly lastError: string | null;
  /** Where the entry came from. */
  readonly source: string;
  /** `YYYY-MM-DD` the home domain was last verified. */
  readonly checkedAt: string;
  /** Any caveat worth showing, such as why it is not usable. */
  readonly note?: string;
  /** What its live `/info` advertises, when it could be read. */
  readonly capabilities?: readonly {
    direction: string;
    assetCode: string;
    methods: readonly string[];
    minAmount?: string;
    maxAmount?: string;
    kycRequired: boolean;
  }[];
  /** Why the capability summary is missing, when it is. */
  readonly capabilityError?: string;
}

/**
 * The body of `GET /api/anchors`.
 *
 * @example
 * ```ts
 * const { anchors }: AnchorsResponse = await (await fetch(url)).json();
 * ```
 */
export interface AnchorsResponse {
  /** Every seeded anchor, usable or not. */
  readonly anchors: readonly AnchorView[];
}

/**
 * Build the anchors route.
 *
 * @param deps - Database and registry.
 * @returns A Hono app to mount under `/api`.
 *
 * @example
 * ```ts
 * app.route('/api', createAnchorsRoute(deps));
 * // GET /api/anchors
 * // GET /api/anchors?live=true   — also reads each anchor's /info
 * ```
 */
export function createAnchorsRoute(deps: AppDeps): Hono {
  const app = new Hono();

  app.get('/anchors', async (context) => {
    const rows = await deps.db.select().from(anchors);
    const health = new Map(rows.map((row) => [row.homeDomain, row]));

    // Reading every anchor's /info costs a round trip each, so it is opt-in.
    const live = new URL(context.req.url).searchParams.get('live') === 'true';
    const capabilities = live ? await readCapabilities(deps) : new Map();

    const views: AnchorView[] = SEED_ANCHORS.map((seed) => {
      const row = health.get(seed.homeDomain);
      const summary = capabilities.get(seed.homeDomain);

      return {
        homeDomain: seed.homeDomain,
        name: row?.name ?? seed.name,
        protocol: seed.protocol,
        usable: seed.protocol === 'sep24',
        countries: seed.countries,
        fiats: seed.fiats,
        lastSeenAt: row?.lastSeenAt ?? null,
        lastError: row?.lastError ?? null,
        source: seed.source,
        checkedAt: seed.checkedAt,
        ...(seed.note === undefined ? {} : { note: seed.note }),
        ...(summary?.capabilities === undefined ? {} : { capabilities: summary.capabilities }),
        ...(summary?.error === undefined ? {} : { capabilityError: summary.error }),
      };
    });

    const body: AnchorsResponse = { anchors: views };
    return context.json(body);
  });

  return app;
}

interface CapabilitySummary {
  capabilities?: AnchorView['capabilities'];
  error?: string;
}

/** Ask every SEP-24 adapter what it can do, tolerating the ones that cannot say. */
async function readCapabilities(deps: AppDeps): Promise<Map<string, CapabilitySummary>> {
  const summaries = new Map<string, CapabilitySummary>();

  const results = await deps.registry.capabilities();
  for (const entry of results) {
    const homeDomain = homeDomainOf(entry.adapterId);
    if (homeDomain === undefined) continue;
    const existing = summaries.get(homeDomain) ?? {};

    if (entry.error !== undefined) {
      summaries.set(homeDomain, {
        ...existing,
        error: RampError.is(entry.error) ? entry.error.code : 'PROVIDER_UNAVAILABLE',
      });
      continue;
    }

    summaries.set(homeDomain, {
      ...existing,
      capabilities: [
        ...(existing.capabilities ?? []),
        ...entry.capabilities.map((capability) => ({
          direction: capability.direction,
          assetCode: capability.asset.code,
          methods: capability.methods,
          ...(capability.minAmount === undefined ? {} : { minAmount: capability.minAmount }),
          ...(capability.maxAmount === undefined ? {} : { maxAmount: capability.maxAmount }),
          kycRequired: capability.kycRequired,
        })),
      ],
    });
  }

  return summaries;
}
