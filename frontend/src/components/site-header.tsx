import Link from 'next/link';

/**
 * Site header with primary navigation.
 *
 * @example
 * ```tsx
 * <SiteHeader />
 * ```
 */
export function SiteHeader() {
  return (
    <header className="border-b bg-card">
      <nav
        aria-label="Primary"
        className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3"
      >
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Slipway
        </Link>
        <ul className="flex gap-1 text-sm">
          <li>
            <Link href="/" className="inline-flex min-h-11 items-center rounded-md px-3 hover:bg-secondary">
              Compare
            </Link>
          </li>
          <li>
            <Link href="/anchors" className="inline-flex min-h-11 items-center rounded-md px-3 hover:bg-secondary">
              Anchors
            </Link>
          </li>
        </ul>
      </nav>
    </header>
  );
}
