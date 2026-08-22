import type { Metadata } from 'next';
import Link from 'next/link';
import { site } from '@config/site.config';
import { getDataset } from '@/lib/dataset';
import { canonical, websiteLd } from '@/lib/seo';
import JsonLd from '@/components/JsonLd';
import '@/styles/globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.name} — ${site.tagline}`,
    template: `%s`,
  },
  description: site.description,
  alternates: { canonical: canonical('/') },
  // Ownership verification for Search Console and Bing Webmaster Tools. Next
  // omits the tag entirely when the token is undefined, so an unconfigured
  // site emits nothing rather than an empty meta tag.
  verification: {
    ...(site.verification.google ? { google: site.verification.google } : {}),
    ...(site.verification.yandex ? { yandex: site.verification.yandex } : {}),
    ...(site.verification.bing ? { other: { 'msvalidate.01': site.verification.bing } } : {}),
  },
  openGraph: {
    siteName: site.name,
    locale: site.locale.replace('-', '_'),
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const dataset = getDataset();

  return (
    <html lang={site.locale.split('-')[0]}>
      <body>
        <header className="site-header">
          <div className="wrap inner">
            <Link className="brand" href="/">
              {site.name}
              <small>{site.tagline}</small>
            </Link>
            <nav className="site-nav" aria-label="Main">
              <Link href="/browse/">Browse all</Link>
              <Link href="/best/">Guides</Link>
              <Link href="/about/">About</Link>
            </nav>
          </div>
        </header>

        <main>
          <div className="wrap">{children}</div>
        </main>

        <footer className="site-footer">
          <div className="wrap">
            <p>
              {dataset.attribution.text}{' '}
              <a href={dataset.attribution.url} rel="noopener nofollow" target="_blank">
                {new URL(dataset.attribution.url).hostname}
              </a>
              . Prices change constantly; always confirm on the store page before buying.
            </p>
            <p>
              © {new Date(dataset.generatedAt).getUTCFullYear()} {site.operator} ·{' '}
              <Link href="/about/">About &amp; disclosure</Link>
            </p>
          </div>
        </footer>

        <JsonLd data={websiteLd()} />
      </body>
    </html>
  );
}
