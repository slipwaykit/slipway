import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Button styles, shared with links that should look like buttons.
 *
 * @example
 * ```tsx
 * <a className={buttonVariants({ variant: 'outline' })} href="/anchors">Anchors</a>
 * ```
 */
export const buttonVariants = cva(
  'inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-60 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border border-input bg-card hover:bg-secondary',
        ghost: 'hover:bg-secondary',
        link: 'min-h-0 px-0 text-primary underline-offset-4 hover:underline',
      },
      size: { default: '', sm: 'min-h-9 px-3 text-xs' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

/**
 * shadcn/ui Button. Touch targets are at least 44px tall.
 *
 * @example
 * ```tsx
 * <Button onClick={refetch}>Refresh quotes</Button>
 * ```
 */
export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot.Root : 'button';
  // Default to type="button" so a button never submits a surrounding form by accident.
  return (
    <Component
      {...(asChild ? {} : { type: 'button' as const })}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
