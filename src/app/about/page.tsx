import type { Metadata } from 'next';
import { getDataset } from '@/lib/dataset';
import { canonical } from '@/lib/seo';
import { formatDate } from '@/lib/util';
import { site } from '@config/site.config';
import Breadcrumbs from '@/components/Breadcrumbs';

export const metadata: Metadata = {
  title: `About & affiliate disclosure | ${site.name}`,
  description: `How ${site.name} sources its pricing data, how often it updates, and how the site makes money.`,
  alternates: { canonical: canonical('/about/') },
};

/**
 * Required reading for both search quality raters and the FTC. A site that
 * carries affiliate links needs a plainly worded page saying who runs it, where
 * the data comes from, and how it earns.
 */
export default function AboutPage() {
  const dataset = getDataset();

  return (
    <article className="prose">
      <Breadcrumbs trail={[{ name: 'Home', path: '/' }, { name: 'About', path: '/about/' }]} />
      <h1>About {site.name}</h1>

      <p>
        {site.name} compares prices for every title it tracks across all major stores, so you can
        see in one place what something actually costs today and whether it has been cheaper
        before.
      </p>

      <h2>Where the data comes from</h2>
      <p>
        Pricing and catalogue data comes from{' '}
        <a href={dataset.attribution.url} rel="noopener nofollow" target="_blank">
          {new URL(dataset.attribution.url).hostname}
        </a>
        . {dataset.attribution.text}. The dataset behind this build was generated on{' '}
        {formatDate(dataset.generatedAt)}.
      </p>
      <p>
        Prices move constantly and we rebuild on a schedule, not in real time. Always confirm the
        price on the store page before you buy — the figure shown here is what the store reported
        when we last refreshed.
      </p>

      <h2>How this site makes money</h2>
      <p>
        Some outbound store links are affiliate links. If you buy after following one,{' '}
        {site.operator} may receive a commission from that store at no additional cost to you.
      </p>
      <p>
        Commission never affects what is listed or how it is ordered. Store listings on every page
        are sorted by price, cheapest first, regardless of whether we earn anything from that
        store — several of the stores we rank first pay us nothing at all.
      </p>

      <h2>What we do not do</h2>
      <ul>
        <li>We do not accept payment for placement or for a better position in any ranking.</li>
        <li>We do not publish a page unless it has real data on it; thin entries are withheld.</li>
        <li>We do not invent review scores, prices, or availability.</li>
      </ul>

      <h2>Contact</h2>
      <p>
        Corrections and takedown requests: <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>.
      </p>
    </article>
  );
}
