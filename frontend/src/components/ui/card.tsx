import type * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * shadcn/ui Card.
 *
 * @example
 * ```tsx
 * <Card><CardHeader><CardTitle>Anchors</CardTitle></CardHeader><CardContent>…</CardContent></Card>
 * ```
 */
export function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('rounded-lg border bg-card text-card-foreground shadow-xs', className)} {...props} />;
}

/** @example `<CardHeader>…</CardHeader>` */
export function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1 p-4 sm:p-6', className)} {...props} />;
}

/** @example `<CardTitle>Anchors</CardTitle>` */
export function CardTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return <h2 className={cn('text-base font-semibold leading-tight', className)} {...props} />;
}

/** @example `<CardDescription>Checked daily</CardDescription>` */
export function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

/** @example `<CardContent>…</CardContent>` */
export function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('p-4 pt-0 sm:p-6 sm:pt-0', className)} {...props} />;
}
