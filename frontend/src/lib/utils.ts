import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Join class names, letting later Tailwind utilities override earlier ones.
 *
 * @param inputs - Class names, conditionals, arrays.
 * @returns One class string.
 *
 * @example
 * ```ts
 * cn('px-2 text-sm', isActive && 'bg-primary', 'px-4'); // 'text-sm bg-primary px-4'
 * ```
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
