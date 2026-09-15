import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/site-header';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Slipway — what actually lands', template: '%s · Slipway' },
  description:
    'Compare fiat on and off ramps on Stellar by the amount the recipient actually receives, after every fee and spread.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#fafafa' };

/**
 * Root layout.
 *
 * @example Rendered by Next.js for every route.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <SiteHeader />
        <Providers>
          <main id="main" className="mx-auto max-w-5xl px-4 py-6 sm:py-10">
            {children}
          </main>
        </Providers>
        <footer className="mx-auto max-w-5xl px-4 pb-10 text-sm text-muted-foreground">
          Read-only demo on Stellar testnet. Rates marked <strong>Demo rate</strong> are illustrative and
          are not offers from a real provider.
        </footer>
      </body>
    </html>
  );
}
