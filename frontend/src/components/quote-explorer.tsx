'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect } from '@/components/ui/field';
import { ApiError } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { corridorLabel, countryName, METHOD_LABELS, type MethodCode } from '@/lib/labels';
import { corridorsQuery, quotesQuery, type QuoteParams } from '@/lib/queries';
import { QuoteComparison, QuoteComparisonSkeleton } from './quote-comparison';

const DECIMAL = /^\d+(\.\d+)?$/;

const DEFAULTS: QuoteParams = {
  country: 'NG',
  fiat: 'NGN',
  direction: 'withdraw',
  amount: '100',
  method: 'bank_transfer',
};

/**
 * The corridor picker and the live comparison beneath it.
 *
 * The chosen route lives in the URL, so a comparison can be shared as a link
 * and the back button undoes a change. Selects apply at once; the amount waits
 * until typing pauses, so a person on metered data does not pay for a request
 * per keystroke.
 *
 * @example
 * ```tsx
 * <Suspense fallback={<QuoteComparisonSkeleton />}><QuoteExplorer /></Suspense>
 * ```
 */
export function QuoteExplorer() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const params: QuoteParams = {
    country: search.get('country') ?? DEFAULTS.country,
    fiat: search.get('fiat') ?? DEFAULTS.fiat,
    direction: search.get('direction') === 'deposit' ? 'deposit' : 'withdraw',
    amount: search.get('amount') ?? DEFAULTS.amount,
    method: search.get('method') ?? DEFAULTS.method,
  };

  const [amountDraft, setAmountDraft] = useState(params.amount);
  const amountValid = DECIMAL.test(amountDraft) && Number.parseFloat(amountDraft) > 0;

  const update = (next: Partial<QuoteParams>): void => {
    const merged = new URLSearchParams({ ...params, ...next });
    router.replace(`${pathname}?${merged.toString()}`, { scroll: false });
  };

  // Commit the amount once typing pauses.
  useEffect(() => {
    if (!amountValid || amountDraft === params.amount) return;
    const timer = setTimeout(() => update({ amount: amountDraft }), 600);
    return () => clearTimeout(timer);
    // `update` closes over params, which amountDraft already captures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountDraft, amountValid]);

  const corridors = useQuery(corridorsQuery());
  const countries = useMemo(() => {
    const byCountry = new Map<string, string>();
    for (const corridor of corridors.data?.corridors ?? []) byCountry.set(corridor.country, corridor.fiat);
    if (!byCountry.has(params.country)) byCountry.set(params.country, params.fiat);
    return [...byCountry.entries()].sort(([a], [b]) => countryName(a).localeCompare(countryName(b)));
  }, [corridors.data, params.country, params.fiat]);

  const matchingCorridor = corridors.data?.corridors.find(
    (corridor) =>
      corridor.country === params.country &&
      corridor.fiat === params.fiat &&
      corridor.direction === params.direction,
  );

  const quotes = useQuery({ ...quotesQuery(params), enabled: DECIMAL.test(params.amount) });

  return (
    <div className="space-y-8">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (amountValid) update({ amount: amountDraft });
        }}
        className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2 sm:p-6 lg:grid-cols-4"
        aria-label="Choose a route"
      >
        <div className="space-y-1.5">
          <Label htmlFor="country">Country</Label>
          <NativeSelect
            id="country"
            value={params.country}
            onChange={(event) => {
              const fiat = countries.find(([code]) => code === event.target.value)?.[1] ?? params.fiat;
              update({ country: event.target.value, fiat });
            }}
          >
            {countries.map(([code, fiat]) => (
              <option key={code} value={code}>
                {countryName(code)} ({fiat})
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="direction">I want to</Label>
          <NativeSelect
            id="direction"
            value={params.direction}
            onChange={(event) => update({ direction: event.target.value as QuoteParams['direction'] })}
          >
            <option value="withdraw">Cash out USDC to {params.fiat}</option>
            <option value="deposit">Buy USDC with {params.fiat}</option>
          </NativeSelect>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="amount">
            Amount to send ({params.direction === 'withdraw' ? 'USDC' : params.fiat})
          </Label>
          <Input
            id="amount"
            inputMode="decimal"
            autoComplete="off"
            value={amountDraft}
            onChange={(event) => setAmountDraft(event.target.value.trim())}
            aria-invalid={!amountValid}
            aria-describedby={amountValid ? undefined : 'amount-error'}
          />
          {!amountValid && (
            <p id="amount-error" className="text-sm text-destructive">
              Enter an amount like 100 or 250.50.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="method">Paid out by</Label>
          <NativeSelect id="method" value={params.method} onChange={(event) => update({ method: event.target.value })}>
            {(Object.keys(METHOD_LABELS) as MethodCode[]).map((code) => (
              <option key={code} value={code}>
                {METHOD_LABELS[code]}
              </option>
            ))}
          </NativeSelect>
        </div>
      </form>

      {matchingCorridor && (
        <p className="text-sm">
          <Link
            href={`/corridors/${encodeURIComponent(matchingCorridor.id)}`}
            className="text-primary underline underline-offset-4"
          >
            See how {corridorLabel(matchingCorridor)} has moved over time
          </Link>
        </p>
      )}

      <section aria-label="Quotes">
        {quotes.isPending ? (
          <QuoteComparisonSkeleton />
        ) : quotes.isError ? (
          <QueryErrorPanel error={quotes.error} onRetry={() => void quotes.refetch()} />
        ) : (
          <QuoteComparison
            key={quotes.data.queriedAt}
            data={quotes.data}
            onRefresh={() => void quotes.refetch()}
            refreshing={quotes.isFetching}
          />
        )}
      </section>
    </div>
  );
}

/**
 * A failed request, explained with the shared error map.
 *
 * @example
 * ```tsx
 * if (query.isError) return <QueryErrorPanel error={query.error} onRetry={query.refetch} />;
 * ```
 */
export function QueryErrorPanel({ error, onRetry }: { readonly error: Error; readonly onRetry: () => void }) {
  const message = describeError(error instanceof ApiError ? error.code : 'INTERNAL_ERROR');
  return (
    <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <h2 className="font-semibold text-destructive">{message.title}</h2>
      <p className="mt-1 text-sm">{message.description}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
