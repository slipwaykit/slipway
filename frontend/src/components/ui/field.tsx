import type * as React from 'react';
import { cn } from '@/lib/utils';

const control =
  'min-h-11 w-full rounded-md border border-input bg-card px-3 text-base text-foreground disabled:opacity-60';

/**
 * shadcn/ui Label.
 *
 * @example
 * ```tsx
 * <Label htmlFor="amount">Amount</Label>
 * ```
 */
export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return <label className={cn('text-sm font-medium', className)} {...props} />;
}

/**
 * shadcn/ui Input. 16px text so mobile browsers do not zoom on focus.
 *
 * @example
 * ```tsx
 * <Input id="amount" inputMode="decimal" />
 * ```
 */
export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input className={cn(control, className)} {...props} />;
}

/**
 * A styled native select.
 *
 * Deliberately native rather than a custom listbox: on low-end Android the
 * platform picker is faster, larger, and already works with TalkBack.
 *
 * @example
 * ```tsx
 * <NativeSelect id="method"><option value="bank_transfer">Bank transfer</option></NativeSelect>
 * ```
 */
export function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return <select className={cn(control, 'appearance-auto', className)} {...props} />;
}
