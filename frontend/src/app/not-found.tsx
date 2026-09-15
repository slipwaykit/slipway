import Link from 'next/link';

/**
 * 404 page.
 *
 * @example Rendered by Next.js for unknown routes.
 */
export default function NotFound() {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">There is nothing at this address.</p>
      <Link href="/" className="text-primary underline underline-offset-4">
        Back to the comparison
      </Link>
    </div>
  );
}
