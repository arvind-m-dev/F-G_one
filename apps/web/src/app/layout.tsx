import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Suspense } from 'react';
import { NavigationProgress } from '@/components/navigation-progress';
import { Providers } from '@/components/providers';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });

// Absolute base for og:image and friends; Vercel provides the production host at build time.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000');
const description = 'The Futurist Global employee workspace — chat, people and HR in one place.';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: 'FG One', template: '%s · FG One' },
  description,
  applicationName: 'FG One',
  openGraph: { type: 'website', siteName: 'FG One', title: 'FG One', description, url: '/' },
  twitter: { card: 'summary_large_image', title: 'FG One', description },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: [{ color: '#eceef6', media: '(prefers-color-scheme: light)' }, { color: '#0b0d11', media: '(prefers-color-scheme: dark)' }] };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geist.variable} ${geistMono.variable}`}>
      <body>
        <Suspense>
          <NavigationProgress />
        </Suspense>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
