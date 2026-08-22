import Link from 'next/link';
import { allCollections, getDataset, indexableItems } from '@/lib/dataset';
import { bestOffer } from '@/lib/dataset';
import { collectionPath } from '@/lib/seo';
import { formatDate } from '@/lib/util';
import { site } from '@config/site.config';
import FixtureNotice from '@/components/FixtureNotice';
import ItemCard from '@/components/ItemCard';

export default function HomePage() {
  const dataset = getDataset();
  const items = indexableItems();
  const collections = allCollections();

  // Lead with the deepest discounts: it is the most useful ordering for a
  // visitor and the most link-worthy for anyone citing the page.
  const featured = [...items]
    .filter((item) => (bestOffer(item)?.discountPercent ?? 0) > 0)
    .sort((a, b) => (bestOffer(b)?.discountPercent ?? 0) - (bestOffer(a)?.discountPercent ?? 0))
    .slice(0, 12);

  return (
    <article>
      <FixtureNotice />
      <h1>{site.tagline}</h1>
      <p className="lede">{site.description}</p>

      <div className="stat-row">
        <div className="stat">
          <div className="value">{items.length.toLocaleString('en-US')}</div>
          <div className="label">Titles tracked</div>
        </div>
        <div className="stat">
          <div className="value">{collections.length}</div>
          <div className="label">Buying guides</div>
        </div>
        <div className="stat">
          <div className="value">{formatDate(dataset.generatedAt)}</div>
          <div className="label">Last refreshed</div>
        </div>
      </div>

      {featured.length > 0 && (
        <>
          <h2>Biggest discounts right now</h2>
          <ul className="grid">
            {featured.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </ul>
        </>
      )}

      {collections.length > 0 && (
        <>
          <h2>Buying guides</h2>
          <ul className="grid">
            {collections.map((collection) => (
              <li className="card" key={collection.slug}>
                <h3>
                  <Link href={collectionPath(collection)}>{collection.title}</Link>
                </h3>
                <p className="meta">{collection.itemIds.length} titles ranked</p>
              </li>
            ))}
          </ul>
        </>
      )}

      <p>
        <Link href="/browse/">Browse all {items.length.toLocaleString('en-US')} titles →</Link>
      </p>
    </article>
  );
}
