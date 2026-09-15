import { Suspense } from 'react';
import { QuoteComparisonSkeleton } from '@/components/quote-comparison';
import { QuoteExplorer } from '@/components/quote-explorer';

/**
 * Home: pick a corridor, compare what lands.
 *
 * @example Rendered by Next.js at `/`.
 */
export default function HomePage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">What actually lands</h1>
        <p className="max-w-2xl text-muted-foreground">
          Every provider, ranked by the amount the recipient receives after every fee and spread — not by
          the rate they advertise.
        </p>
      </div>
      <Suspense fallback={<QuoteComparisonSkeleton />}>
        <QuoteExplorer />
      </Suspense>
    </div>
  );
}
