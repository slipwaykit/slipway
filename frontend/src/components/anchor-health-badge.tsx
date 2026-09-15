'use client';

import { CircleCheck, CircleDashed, CircleOff, CircleX } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { describeError } from '@/lib/errors';
import { formatRelative } from '@/lib/format';
import { useNow } from '@/lib/use-now';

/** Props for {@link AnchorHealthBadge}. */
export interface AnchorHealthBadgeProps {
  /** When the anchor last answered, or null. */
  readonly lastSeenAt: number | null;
  /** The code of its last reachability failure, or null. */
  readonly lastError: string | null;
  /** Whether Slipway has an adapter that can serve it. */
  readonly usable: boolean;
  /** What it speaks, e.g. `sep24` or `sep6`. */
  readonly protocol: string;
}

/**
 * How an anchor last behaved: answered, unreachable, never polled, or not
 * something Slipway can talk to yet.
 *
 * Icon and wording carry the state, not colour alone.
 *
 * @example
 * ```tsx
 * <AnchorHealthBadge lastSeenAt={anchor.lastSeenAt} lastError={anchor.lastError} usable={anchor.usable} protocol={anchor.protocol} />
 * ```
 */
export function AnchorHealthBadge({ lastSeenAt, lastError, usable, protocol }: AnchorHealthBadgeProps) {
  const now = useNow(30_000);

  if (!usable) {
    return (
      <span className="inline-flex flex-col gap-1">
        <Badge variant="outline">
          <CircleOff aria-hidden /> Not supported yet
        </Badge>
        <span className="text-xs text-muted-foreground">Speaks {protocol.toUpperCase()}, not SEP-24</span>
      </span>
    );
  }

  if (lastError !== null) {
    return (
      <span className="inline-flex flex-col gap-1">
        <Badge variant="destructive">
          <CircleX aria-hidden /> {describeError(lastError).title}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {lastSeenAt === null ? 'Never answered' : `Last answered ${formatRelative(lastSeenAt, now)}`}
        </span>
      </span>
    );
  }

  if (lastSeenAt !== null) {
    return (
      <Badge variant="success">
        <CircleCheck aria-hidden /> Answered {formatRelative(lastSeenAt, now)}
      </Badge>
    );
  }

  return (
    <Badge variant="secondary">
      <CircleDashed aria-hidden /> Not polled yet
    </Badge>
  );
}
