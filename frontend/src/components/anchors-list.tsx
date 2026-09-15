'use client';

import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { AnchorView } from '@/lib/api';
import { countryName } from '@/lib/labels';
import { anchorsQuery } from '@/lib/queries';
import { AnchorHealthBadge } from './anchor-health-badge';
import { QueryErrorPanel } from './quote-explorer';

/**
 * Every anchor Slipway knows about, including the ones it cannot serve.
 *
 * Cards on a phone, a table from medium screens up. Each entry shows where it
 * came from and when it was checked.
 *
 * @example
 * ```tsx
 * <AnchorsList />
 * ```
 */
export function AnchorsList() {
  const query = useQuery(anchorsQuery());

  if (query.isPending) {
    return (
      <div className="space-y-3">
        <p className="sr-only" role="status">Loading anchors…</p>
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-28 w-full" />
        ))}
      </div>
    );
  }
  if (query.isError) return <QueryErrorPanel error={query.error} onRetry={() => void query.refetch()} />;

  const anchors = query.data.anchors;

  return (
    <>
      <ul className="space-y-3 md:hidden">
        {anchors.map((anchor) => (
          <li key={anchor.homeDomain} className="space-y-3 rounded-lg border bg-card p-4">
            <AnchorIdentity anchor={anchor} />
            <AnchorHealthBadge {...anchor} />
            <p className="text-sm">{coverage(anchor)}</p>
            <AnchorNotes anchor={anchor} />
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Known anchors, their health and the corridors they serve</caption>
          <thead className="border-b bg-muted">
            <tr>
              <th scope="col" className="p-3 font-medium">Anchor</th>
              <th scope="col" className="p-3 font-medium">Health</th>
              <th scope="col" className="p-3 font-medium">Corridors</th>
              <th scope="col" className="p-3 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {anchors.map((anchor) => (
              <tr key={anchor.homeDomain} className="border-b align-top last:border-0">
                <th scope="row" className="p-3 font-normal">
                  <AnchorIdentity anchor={anchor} />
                </th>
                <td className="p-3">
                  <AnchorHealthBadge {...anchor} />
                </td>
                <td className="p-3">{coverage(anchor)}</td>
                <td className="max-w-sm p-3">
                  <AnchorNotes anchor={anchor} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function coverage(anchor: AnchorView): string {
  return `${anchor.countries.map(countryName).join(', ')} · ${anchor.fiats.join(', ')}`;
}

function AnchorIdentity({ anchor }: { readonly anchor: AnchorView }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{anchor.name}</span>
        <Badge variant="outline">{anchor.protocol.toUpperCase()}</Badge>
      </div>
      <a
        href={`https://${anchor.homeDomain}/.well-known/stellar.toml`}
        className="inline-flex items-center gap-1 text-sm text-primary underline underline-offset-4"
        rel="noreferrer"
        target="_blank"
      >
        {anchor.homeDomain}
        <ExternalLink className="size-3" aria-hidden />
        <span className="sr-only">(stellar.toml, opens in a new tab)</span>
      </a>
    </div>
  );
}

function AnchorNotes({ anchor }: { readonly anchor: AnchorView }) {
  return (
    <div className="space-y-1 text-sm text-muted-foreground">
      {anchor.note && <p>{anchor.note}</p>}
      <p className="text-xs">Checked {anchor.checkedAt}</p>
    </div>
  );
}
