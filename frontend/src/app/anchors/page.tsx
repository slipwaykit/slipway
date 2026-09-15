import type { Metadata } from 'next';
import { AnchorsList } from '@/components/anchors-list';

export const metadata: Metadata = { title: 'Anchors' };

/**
 * Known anchors with health and corridors.
 *
 * @example Rendered by Next.js at `/anchors`.
 */
export default function AnchorsPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Anchors</h1>
        <p className="max-w-2xl text-muted-foreground">
          Every anchor here was checked by reading its own stellar.toml. Anchors Slipway cannot serve yet
          are listed too, with the reason.
        </p>
      </div>
      <AnchorsList />
    </div>
  );
}
