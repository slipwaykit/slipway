import type { Metadata } from 'next';
import Link from 'next/link';
import { CorridorHistory } from '@/components/corridor-history';

interface Props {
  readonly params: Promise<{ id: string }>;
}

/** @example `generateMetadata({ params })` — called by Next.js. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: decodeURIComponent(id) };
}

/**
 * One corridor's landed-amount history and on-chain attestations.
 *
 * @example Rendered by Next.js at `/corridors/NG-NGN-USDC-withdraw`.
 */
export default async function CorridorPage({ params }: Props) {
  const { id } = await params;
  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-primary underline underline-offset-4">
        ← Back to the comparison
      </Link>
      <CorridorHistory id={decodeURIComponent(id)} />
    </div>
  );
}
