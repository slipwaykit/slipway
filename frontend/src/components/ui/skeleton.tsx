import type * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * shadcn/ui Skeleton. Hidden from assistive technology; pair it with a
 * visually hidden loading message.
 *
 * @example
 * ```tsx
 * <Skeleton className="h-6 w-32" />
 * ```
 */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}
