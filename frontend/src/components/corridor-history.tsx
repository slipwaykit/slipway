'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { corridorLabel } from '@/lib/labels';
import { historyQuery } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { AttestationList } from './attestation-list';
import { CorridorChart } from './corridor-chart';
import { QueryErrorPanel } from './quote-explorer';

const WINDOWS = [
  { days: 1, label: '24 hours' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
] as const;

/**
 * One corridor's history: the window picker, the chart and the on-chain list.
 *
 * Changing the window keeps the previous render, dimmed, until the new data
 * arrives, so the page does not flash back to a skeleton.
 *
 * @example
 * ```tsx
 * <CorridorHistory id="NG-NGN-USDC-withdraw" />
 * ```
 */
export function CorridorHistory({ id }: { readonly id: string }) {
  const [days, setDays] = useState<number>(7);
  const query = useQuery({ ...historyQuery(id, days), placeholderData: keepPreviousData });

  if (query.isPending) {
    return (
      <div className="space-y-4">
        <p className="sr-only" role="status">Loading corridor history…</p>
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  if (query.isError) return <QueryErrorPanel error={query.error} onRetry={() => void query.refetch()} />;

  const { corridor, history } = query.data;
  const currency = corridor.direction === 'deposit' ? corridor.assetCode : corridor.fiat;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{corridorLabel(corridor)}</h1>
        <p className="text-muted-foreground">
          What landed, per provider, on every poll. Recorded every 15 minutes, failures included.
        </p>
      </div>

      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Time window</legend>
        {WINDOWS.map((window) => (
          <label
            key={window.days}
            className={cn(
              'inline-flex min-h-11 cursor-pointer items-center rounded-md border px-3 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring',
              days === window.days ? 'border-primary bg-accent font-medium text-accent-foreground' : 'bg-card',
            )}
          >
            <input
              type="radio"
              name="window"
              className="sr-only"
              checked={days === window.days}
              onChange={() => setDays(window.days)}
            />
            {window.label}
          </label>
        ))}
      </fieldset>

      <div aria-busy={query.isPlaceholderData} className={cn('space-y-10 transition-opacity', query.isPlaceholderData && 'opacity-60')}>
        <p aria-live="polite" className="sr-only">
          {query.isPlaceholderData ? 'Loading' : `${history.length} snapshots in the last ${days === 1 ? '24 hours' : `${days} days`}`}
        </p>
        <section aria-labelledby="chart-heading" className="space-y-3">
          <h2 id="chart-heading" className="text-lg font-semibold">
            Landed amount
          </h2>
          <CorridorChart history={history} currency={currency} />
        </section>

        <section aria-labelledby="attestations-heading" className="space-y-3">
          <h2 id="attestations-heading" className="text-lg font-semibold">
            On-chain attestations
          </h2>
          <AttestationList history={history} currency={currency} />
        </section>
      </div>
    </div>
  );
}
