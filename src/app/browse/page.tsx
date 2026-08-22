import type { Metadata } from 'next';
import { indexableItems } from '@/lib/dataset';
import { canonical } from '@/lib/seo';
import { PAGE_SIZE, browseHref, pageCount, pageSlice } from '@/lib/pagination';
import { site } from '@config/site.config';
import Breadcrumbs from '@/components/Breadcrumbs';
import FixtureNotice from '@/components/FixtureNotice';
import ItemCard from '@/components/ItemCard';
import Pager from '@/components/Pager';

export const metadata: Metadata = {
  title: `Browse everything | ${site.name}`,
  description: `The full ${site.name} catalogue with current best prices, sorted alphabetically.`,
  alternates: { canonical: canonical('/browse/') },
};

export default function BrowseIndex() {
  const items = [...indexableItems()].sort((a, b) => a.title.localeCompare(b.title));
  const total = pageCount(items.length, PAGE_SIZE);

  return (
    <article>
      <FixtureNotice />
      <Breadcrumbs trail={[{ name: 'Home', path: '/' }, { name: 'Browse', path: '/browse/' }]} />
      <h1>Browse everything</h1>
      <p className="lede">
        {items.length.toLocaleString('en-US')} titles with a verifiable price, sorted
        alphabetically.
      </p>

      <ul className="grid">
        {pageSlice(items, 1, PAGE_SIZE).map((item) => (
          <ItemCard key={item.id} item={item} />
        ))}
      </ul>

      <Pager current={1} total={total} hrefFor={browseHref} />
    </article>
  );
}
