'use client';

import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { SnapshotView } from '@/lib/api';
import { formatAmount, formatRelative, shortHash } from '@/lib/format';

const EXPLORER = 'https://stellar.expert/explorer/testnet';
const PAGE = 10;

/**
 * The contract snapshots are written to.
 *
 * @example
 * ```ts
 * `${EXPLORER}/contract/${ATTESTATIONS_CONTRACT}`;
 * ```
 */
export const ATTESTATIONS_CONTRACT =
  process.env.NEXT_PUBLIC_SLIPWAY_ATTESTATIONS_CONTRACT ??
  'CBPHQB7YKLPLM7CZWCWUW6QQOBF77QMOTAHHO3PMP25AW4IXUMMSDFMT';

/** Props for {@link AttestationList}. */
export interface AttestationListProps {
  /** Snapshots, any order. Only those with attestations are listed. */
  readonly history: readonly SnapshotView[];
  /** Currency the landed amount is denominated in. */
  readonly currency: string;
}

/**
 * On-chain records of this corridor's snapshots, newest first, each linked to
 * its transaction and ledger on stellar.expert.
 *
 * A record with a transaction but no ledger was sent and never confirmed back
 * to Slipway. It is shown as unconfirmed rather than hidden: the explorer link
 * is how anyone can check whether it landed.
 *
 * @example
 * ```tsx
 * <AttestationList history={data.history} currency="NGN" />
 * ```
 */
export function AttestationList({ history, currency }: AttestationListProps) {
  const [visible, setVisible] = useState(PAGE);
  const records = history
    .flatMap((snapshot) => snapshot.attestations.map((proof) => ({ snapshot, proof })))
    .sort((a, b) => b.snapshot.createdAt - a.snapshot.createdAt);

  if (records.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No snapshot on this corridor has been attested on chain in this window. Attestation runs when the
        backend is configured with a service account.{' '}
        <a
          className="text-primary underline underline-offset-4"
          href={`${EXPLORER}/contract/${ATTESTATIONS_CONTRACT}`}
          target="_blank"
          rel="noreferrer"
        >
          View the contract<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y rounded-lg border bg-card">
        {records.slice(0, visible).map(({ snapshot, proof }) => (
          <li key={proof.txHash} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-medium">
                {snapshot.landedAmount === null ? 'No quote' : formatAmount(snapshot.landedAmount, currency)}
              </p>
              <p className="text-sm text-muted-foreground">
                {snapshot.adapterName} · {formatRelative(snapshot.createdAt)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              {proof.ledger === null ? (
                <Badge variant="warning">Unconfirmed</Badge>
              ) : (
                <a
                  className="inline-flex min-h-11 items-center gap-1 text-primary underline underline-offset-4 sm:min-h-0"
                  href={`${EXPLORER}/ledger/${proof.ledger}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Ledger {proof.ledger.toLocaleString('en')}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              )}
              <a
                className="inline-flex min-h-11 items-center gap-1 font-mono text-primary underline underline-offset-4 sm:min-h-0"
                href={`${EXPLORER}/tx/${proof.txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                {shortHash(proof.txHash)}
                <ExternalLink className="size-3" aria-hidden />
                <span className="sr-only"> transaction, opens in a new tab</span>
              </a>
            </div>
          </li>
        ))}
      </ul>
      {records.length > visible && (
        <Button variant="outline" size="sm" onClick={() => setVisible((n) => n + PAGE)}>
          Show {Math.min(PAGE, records.length - visible)} more
        </Button>
      )}
    </div>
  );
}
