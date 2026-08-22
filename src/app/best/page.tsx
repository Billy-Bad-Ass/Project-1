import type { Metadata } from 'next';
import Link from 'next/link';
import { allCollections, getItemsByIds } from '@/lib/dataset';
import { canonical, collectionPath } from '@/lib/seo';
import { site } from '@config/site.config';
import Breadcrumbs from '@/components/Breadcrumbs';
import FixtureNotice from '@/components/FixtureNotice';

export const metadata: Metadata = {
  title: `Buying guides | ${site.name}`,
  description: `Every ranked guide on ${site.name}, each built from live pricing across all tracked stores.`,
  alternates: { canonical: canonical('/best/') },
};

export default function GuidesIndex() {
  const collections = allCollections();

  return (
    <article>
      <FixtureNotice />
      <Breadcrumbs
        trail={[
          { name: 'Home', path: '/' },
          { name: 'Guides', path: '/best/' },
        ]}
      />
      <h1>Buying guides</h1>
      <p className="lede">
        {collections.length} ranked guides, each rebuilt from live store prices every time the
        dataset refreshes.
      </p>

      <ul className="grid">
        {collections.map((collection) => (
          <li className="card" key={collection.slug}>
            <h3>
              <Link href={collectionPath(collection)}>{collection.title}</Link>
            </h3>
            <p className="meta">{getItemsByIds(collection.itemIds).length} titles ranked</p>
          </li>
        ))}
      </ul>
    </article>
  );
}
