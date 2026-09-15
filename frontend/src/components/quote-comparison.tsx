'use client';

import { ChevronDown, CircleAlert, RefreshCw, Trophy } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { QuoteErrorView, QuotesResponse, QuoteView } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { formatAmount, formatRate } from '@/lib/format';
import { feeTotal, secondsLeft, shortfall, sortByLanded } from '@/lib/quotes';
import { useNow } from '@/lib/use-now';
import { cn } from '@/lib/utils';

/** Props for {@link QuoteComparison}. */
export interface QuoteComparisonProps {
  /** The comparison to render. */
  readonly data: QuotesResponse;
  /** Ask for fresh quotes. */
  readonly onRefresh: () => void;
  /** Whether a refresh is in flight. */
  readonly refreshing?: boolean;
}

/**
 * Every provider's answer for one route, ranked by what actually lands.
 *
 * Sorted by `landedAmount`, never by rate. The landed amount is the headline
 * figure; the rate and fee breakdown sit beneath it. Each quote counts down to
 * its expiry and cannot be selected once expired. Providers that did not quote
 * are shown in a muted section rather than hidden, so a person can see who was
 * asked and why they did not answer.
 *
 * The list is a native radio group, so arrow keys move between quotes and
 * screen readers announce position and selection without extra wiring.
 *
 * Render it with `key={data.queriedAt}` so a fresh comparison starts with no
 * selection rather than carrying one over to a quote that may no longer exist.
 *
 * @example
 * ```tsx
 * const { data, refetch, isFetching } = useQuery(quotesQuery(params));
 * if (data) return <QuoteComparison key={data.queriedAt} data={data} onRefresh={refetch} refreshing={isFetching} />;
 * ```
 */
export function QuoteComparison({ data, onRefresh, refreshing = false }: QuoteComparisonProps) {
  const now = useNow();
  const quotes = useMemo(() => sortByLanded(data.quotes), [data.quotes]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const groupName = useId();

  const withdraw = data.request.direction === 'withdraw';
  const sellCurrency = withdraw ? data.request.asset.code : data.request.fiat;
  const buyCurrency = withdraw ? data.request.fiat : data.request.asset.code;

  const best = quotes[0];
  const selected = quotes.find((quote) => quote.adapterId === selectedId);
  const allExpired = quotes.length > 0 && quotes.every((q) => secondsLeft(q.expiresAt, now) === 0);
  const selectedExpired = selected !== undefined && secondsLeft(selected.expiresAt, now) === 0;

  const announcement = allExpired
    ? 'All quotes have expired. Refresh for current prices.'
    : selectedExpired
      ? 'Your selected quote has expired. Refresh for current prices.'
      : `${quotes.length} ${quotes.length === 1 ? 'quote' : 'quotes'}, ${data.errors.length} ${data.errors.length === 1 ? 'provider' : 'providers'} did not quote.`;

  return (
    <div className="space-y-6">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Sending {formatAmount(data.request.amount, sellCurrency)}. Ranked by what the recipient receives.
        </p>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw className={cn(refreshing && 'animate-spin')} aria-hidden />
          {refreshing ? 'Refreshing' : 'Refresh quotes'}
        </Button>
      </div>

      {allExpired && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>These quotes have expired and can no longer be selected. Refresh for current prices.</span>
        </div>
      )}

      {quotes.length === 0 ? (
        <div className="rounded-lg border bg-card p-6">
          <h2 className="font-semibold">No provider could quote this route</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every provider was asked. Their reasons are listed below.
          </p>
        </div>
      ) : (
        <fieldset className="space-y-3">
          <legend className="mb-3 text-base font-semibold">
            {quotes.length} {quotes.length === 1 ? 'quote' : 'quotes'}
          </legend>
          {quotes.map((quote, index) => (
            <QuoteCard
              key={quote.adapterId}
              quote={quote}
              rank={index + 1}
              best={best}
              isBest={index === 0}
              groupName={groupName}
              selected={quote.adapterId === selectedId}
              onSelect={() => setSelectedId(quote.adapterId)}
              now={now}
              sellCurrency={sellCurrency}
              buyCurrency={buyCurrency}
            />
          ))}
        </fieldset>
      )}

      {selected && !selectedExpired && (
        <div className="rounded-lg border border-primary/40 bg-accent p-4 text-sm text-accent-foreground">
          <p className="font-medium">
            {selected.adapterName}: {formatAmount(selected.landedAmount, buyCurrency)} lands.
          </p>
          <p className="mt-1">
            Continuing needs a connected Stellar wallet. This demo is read-only, so it stops here.
          </p>
        </div>
      )}

      <FailedProviders errors={data.errors} />
    </div>
  );
}

interface QuoteCardProps {
  readonly quote: QuoteView;
  readonly rank: number;
  readonly best: QuoteView | undefined;
  readonly isBest: boolean;
  readonly groupName: string;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly now: number;
  readonly sellCurrency: string;
  readonly buyCurrency: string;
}

function QuoteCard({
  quote,
  rank,
  best,
  isBest,
  groupName,
  selected,
  onSelect,
  now,
  sellCurrency,
  buyCurrency,
}: QuoteCardProps) {
  const [open, setOpen] = useState(false);
  const inputId = useId();
  const feesId = useId();
  const left = secondsLeft(quote.expiresAt, now);
  const expired = left === 0;
  const gap = best === undefined || isBest ? undefined : shortfall(quote, best);
  const fees = feeTotal(quote);

  return (
    <div
      className={cn(
        'rounded-lg border bg-card transition-colors',
        selected && !expired && 'border-primary ring-2 ring-primary/30',
        expired && 'bg-muted',
      )}
    >
      <label
        htmlFor={inputId}
        className={cn('flex gap-3 p-4', expired ? 'cursor-not-allowed' : 'cursor-pointer')}
      >
        <input
          id={inputId}
          type="radio"
          name={groupName}
          value={quote.adapterId}
          checked={selected}
          onChange={onSelect}
          disabled={expired}
          aria-describedby={`${inputId}-meta`}
          className="mt-1.5 size-5 shrink-0 accent-primary"
        />
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              <span className="sr-only">Rank {rank}: </span>
              {quote.adapterName}
            </span>
            {isBest && (
              <Badge variant="success">
                <Trophy aria-hidden /> Most lands
              </Badge>
            )}
            {quote.isMock && <Badge variant="warning">Demo rate</Badge>}
          </span>

          <span className="block">
            <span className="block text-2xl font-semibold tracking-tight sm:text-3xl">
              {formatAmount(quote.landedAmount, buyCurrency)}
            </span>
            <span className="text-sm text-muted-foreground">
              lands{gap === undefined ? '' : ` · ${formatAmount(gap, buyCurrency)} less than the best`}
            </span>
          </span>

          <span id={`${inputId}-meta`} className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>{formatRate(quote.rate, sellCurrency, buyCurrency)} before fees</span>
            <span role="timer" className={cn(expired && 'font-medium text-destructive')}>
              {expired ? 'Expired' : `Valid ${formatCountdown(left)}`}
            </span>
          </span>
        </span>
      </label>

      <div className="border-t px-4 py-1">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={feesId}
          className="flex min-h-11 w-full items-center justify-between gap-2 text-sm"
        >
          <span>
            {quote.fees.length === 0
              ? 'No fees disclosed beyond the rate'
              : fees === undefined
                ? `${quote.fees.length} fees`
                : `Fees ${formatAmount(fees, buyCurrency)}`}
          </span>
          {quote.fees.length > 0 && (
            <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
          )}
        </button>
        {open && quote.fees.length > 0 && (
          <dl id={feesId} className="space-y-2 pb-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Gross at headline rate</dt>
              <dd className="text-right">{formatAmount(quote.buyAmount, buyCurrency)}</dd>
            </div>
            {quote.fees.map((fee, index) => (
              <div key={index} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">
                  {FEE_LABELS[fee.kind] ?? 'Fee'}
                  {fee.description ? <span className="block text-xs">{fee.description}</span> : null}
                </dt>
                <dd className="shrink-0 text-right">−{formatAmount(fee.amount, fee.currency)}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-4 border-t pt-2 font-medium">
              <dt>Lands</dt>
              <dd className="text-right">{formatAmount(quote.landedAmount, buyCurrency)}</dd>
            </div>
          </dl>
        )}
      </div>
    </div>
  );
}

const FEE_LABELS: Record<string, string> = {
  fixed: 'Flat fee',
  percent: 'Percentage fee',
  spread: 'Spread',
  network: 'Network fee',
  provider: 'Provider fee',
};

function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Providers that were asked and did not quote.
 *
 * Real failures are listed one by one. "Doesn't offer this route" is grouped,
 * because on any given corridor most providers legitimately don't serve it,
 * and fourteen identical rows would bury the one outage that matters. The group
 * still expands to every name: nothing is hidden, only collapsed.
 */
function FailedProviders({ errors }: { readonly errors: readonly QuoteErrorView[] }) {
  const [showUnsupported, setShowUnsupported] = useState(false);
  const listId = useId();
  if (errors.length === 0) return null;

  const unsupported = errors.filter((error) => error.code === 'UNSUPPORTED_ROUTE');
  const unsupportedNames = [...new Set(unsupported.map((error) => error.adapterName))];

  // One anchor serving three corridors fails three times for one reason. Say it
  // once, with a count, rather than repeating the same paragraph.
  const grouped = new Map<string, { error: QuoteErrorView; count: number }>();
  for (const error of errors) {
    if (error.code === 'UNSUPPORTED_ROUTE') continue;
    const key = `${error.adapterName}|${error.code}`;
    const entry = grouped.get(key);
    if (entry) entry.count += 1;
    else grouped.set(key, { error, count: 1 });
  }
  const failures = [...grouped.values()];

  return (
    <section aria-labelledby={`${listId}-heading`} className="rounded-lg border border-dashed bg-muted p-4">
      <h2 id={`${listId}-heading`} className="text-base font-semibold">
        Asked, but didn’t quote
      </h2>
      <ul className="mt-3 space-y-3 text-sm">
        {failures.map(({ error, count }) => {
          const message = describeError(error.code);
          return (
            <li key={`${error.adapterName}|${error.code}`} className="text-muted-foreground">
              <span className="font-medium text-foreground">{error.adapterName}</span>
              {error.isMock && <span> (demo)</span>}
              {count > 1 && <span> · {count} corridors</span>}
              <span className="block">
                <span className="font-medium">{message.title}.</span> {message.description}
                {error.retryable && ' Worth trying again later.'}
              </span>
            </li>
          );
        })}
        {unsupported.length > 0 && (
          <li className="text-muted-foreground">
            <button
              type="button"
              onClick={() => setShowUnsupported((value) => !value)}
              aria-expanded={showUnsupported}
              aria-controls={listId}
              className="flex min-h-11 items-center gap-2 text-left"
            >
              <ChevronDown className={cn('size-4 shrink-0 transition-transform', showUnsupported && 'rotate-180')} aria-hidden />
              <span>
                <span className="font-medium text-foreground">
                  {unsupportedNames.length} {unsupportedNames.length === 1 ? 'provider doesn’t' : 'providers don’t'} offer this route
                </span>
              </span>
            </button>
            {showUnsupported && (
              <ul id={listId} className="ml-6 list-disc space-y-1">
                {unsupportedNames.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            )}
          </li>
        )}
      </ul>
    </section>
  );
}

/**
 * Loading placeholder shaped like the comparison, so the layout does not jump.
 *
 * @example
 * ```tsx
 * if (isPending) return <QuoteComparisonSkeleton />;
 * ```
 */
export function QuoteComparisonSkeleton() {
  return (
    <div className="space-y-3">
      <p className="sr-only" role="status">
        Asking every provider for a quote…
      </p>
      {[0, 1, 2].map((key) => (
        <div key={key} className="space-y-3 rounded-lg border bg-card p-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
      ))}
    </div>
  );
}
