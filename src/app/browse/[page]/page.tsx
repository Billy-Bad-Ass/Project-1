import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { indexableItems } from '@/lib/dataset';
import { canonical } from '@/lib/seo';
import { PAGE_SIZE, browseHref, pageCount, pageSlice } from '@/lib/pagination';
import { site } from '@config/site.config';
import Breadcrumbs from '@/components/Breadcrumbs';
import FixtureNotice from '@/components/FixtureNotice';
import ItemCard from '@/components/ItemCard';
import Pager from '@/components/Pager';

function sortedItems() {
  return [...indexableItems()].sort((a, b) => a.title.localeCompare(b.title));
}

/** Pages 2..N. Page 1 is served by /browse/ so there is no duplicate URL. */
export function generateStaticParams(): { page: string }[] {
  const total = pageCount(indexableItems().length, PAGE_SIZE);
  const params: { page: string }[] = [];
  for (let page = 2; page <= total; page += 1) params.push({ page: String(page) });
  return params;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ page: string }>;
}): Promise<Metadata> {
  const { page } = await params;
  const number = Number(page);
  return {
    title: `Browse everything — page ${number} | ${site.name}`,
    description: `Page ${number} of the full ${site.name} catalogue with current best prices.`,
    alternates: { canonical: canonical(browseHref(number)) },
  };
}

export default async function BrowsePage({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  const number = Number(page);
  const items = sortedItems();
  const total = pageCount(items.length, PAGE_SIZE);

  if (!Number.isInteger(number) || number < 2 || number > total) notFound();

  return (
    <article>
      <FixtureNotice />
      <Breadcrumbs
        trail={[
          { name: 'Home', path: '/' },
          { name: 'Browse', path: '/browse/' },
          { name: `Page ${number}`, path: browseHref(number) },
        ]}
      />
      <h1>Browse everything</h1>
      <p className="lede">
        Page {number} of {total}.
      </p>

      <ul className="grid">
        {pageSlice(items, number, PAGE_SIZE).map((item) => (
          <ItemCard key={item.id} item={item} />
        ))}
      </ul>

      <Pager current={number} total={total} hrefFor={browseHref} />
    </article>
  );
}
