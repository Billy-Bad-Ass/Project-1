import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { allCollections, getCollectionBySlug, getItemsByIds } from '@/lib/dataset';
import {
  breadcrumbLd,
  collectionLd,
  collectionMetadata,
  collectionPath,
  itemPath,
} from '@/lib/seo';
import { formatPrice } from '@/lib/util';
import Breadcrumbs from '@/components/Breadcrumbs';
import FixtureNotice from '@/components/FixtureNotice';
import JsonLd from '@/components/JsonLd';
import Link from 'next/link';
import { bestOffer } from '@/lib/dataset';

/**
 * Hub pages. These are what actually rank for head terms; the item pages rank
 * for long-tail ones and feed link equity upward through the breadcrumb.
 */
export function generateStaticParams(): { slug: string }[] {
  return allCollections().map((collection) => ({ slug: collection.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const collection = getCollectionBySlug(slug);
  if (!collection) return {};
  return collectionMetadata(collection, collection.itemIds.length);
}

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const collection = getCollectionBySlug(slug);
  if (!collection) notFound();

  const items = getItemsByIds(collection.itemIds);
  const trail = [
    { name: 'Home', path: '/' },
    { name: 'Guides', path: '/best/' },
    { name: collection.title, path: collectionPath(collection) },
  ];

  return (
    <article>
      <FixtureNotice />
      <Breadcrumbs trail={trail} />

      <h1>{collection.title}</h1>
      <p className="lede">{collection.description}</p>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col" className="num">#</th>
              <th scope="col">Title</th>
              <th scope="col" className="num">Best price</th>
              <th scope="col">Cheapest at</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const offer = bestOffer(item);
              return (
                <tr key={item.id}>
                  <td className="num">{index + 1}</td>
                  <th scope="row">
                    <Link href={itemPath(item)}>{item.title}</Link>
                  </th>
                  <td className="num">
                    {offer?.price != null ? (
                      <span className="price">{formatPrice(offer.price, offer.currency)}</span>
                    ) : (
                      <span className="updated">—</span>
                    )}
                  </td>
                  <td>{offer?.merchant ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="updated">
        Ranked by lowest price across every store tracked. Follow any title for its full store
        comparison and price history.
      </p>

      <JsonLd data={collectionLd(collection, items)} />
      <JsonLd data={breadcrumbLd(trail)} />
    </article>
  );
}
