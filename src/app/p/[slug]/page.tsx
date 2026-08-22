import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { allCollections, allItems, bestOffer, getItemBySlug, relatedItems } from '@/lib/dataset';
import { breadcrumbLd, faqLd, itemLd, itemMetadata, itemPath } from '@/lib/seo';
import { formatDate, slugify } from '@/lib/util';
import Breadcrumbs from '@/components/Breadcrumbs';
import FactTable from '@/components/FactTable';
import FixtureNotice from '@/components/FixtureNotice';
import ItemCard from '@/components/ItemCard';
import JsonLd from '@/components/JsonLd';
import OfferTable from '@/components/OfferTable';

/** One static page per item. This is the bulk of the site. */
export function generateStaticParams(): { slug: string }[] {
  return allItems().map((item) => ({ slug: item.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const item = getItemBySlug(slug);
  if (!item) return {};
  return itemMetadata(item);
}

export default async function ItemPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const item = getItemBySlug(slug);
  if (!item) notFound();

  const offer = bestOffer(item);
  const related = relatedItems(item);

  // Only link categories that actually became a hub page. A category with too
  // few members is never built, and linking it would emit a dead internal link.
  const liveHubs = new Set(allCollections().map((collection) => collection.slug));
  const linkedCategories = item.categories
    .map((name) => ({ name, slug: slugify(name) }))
    .filter((category) => liveHubs.has(category.slug));
  const trail = [
    { name: 'Home', path: '/' },
    { name: 'Browse', path: '/browse/' },
    { name: item.title, path: itemPath(item) },
  ];

  return (
    <article>
      <FixtureNotice />
      <Breadcrumbs trail={trail} />

      <h1>{item.title}</h1>
      <p className="lede">{item.summary}</p>

      {offer?.price != null && (
        <div className="stat-row">
          <div className="stat">
            <div className="value">${offer.price.toFixed(2)}</div>
            <div className="label">Best price</div>
          </div>
          <div className="stat">
            <div className="value">{offer.merchant}</div>
            <div className="label">Cheapest store</div>
          </div>
          <div className="stat">
            <div className="value">{item.offers.length}</div>
            <div className="label">Stores compared</div>
          </div>
        </div>
      )}

      <h2>Where to buy {item.title}</h2>
      <OfferTable offers={item.offers} itemTitle={item.title} />

      {item.facts.length > 0 && (
        <>
          <h2>Details</h2>
          <FactTable facts={item.facts} />
        </>
      )}

      {item.enrichment && (
        <>
          <h2>What reviewers say</h2>
          <blockquote className="prose">
            <p>{item.enrichment.excerpt}</p>
            <p className="updated">
              Excerpt from{' '}
              <a href={item.enrichment.sourceUrl} rel="noopener nofollow" target="_blank">
                {new URL(item.enrichment.sourceUrl).hostname}
              </a>
              , retrieved {formatDate(item.enrichment.fetchedAt)}.
            </p>
          </blockquote>
        </>
      )}

      {linkedCategories.length > 0 && (
        <p className="updated">
          Also in:{' '}
          {linkedCategories.map((category, index) => (
            <span key={category.slug}>
              {index > 0 && ' · '}
              <Link href={`/best/${category.slug}/`}>{category.name}</Link>
            </span>
          ))}
        </p>
      )}

      <p className="updated">Price data last refreshed {formatDate(item.updatedAt)}.</p>

      {related.length > 0 && (
        <>
          <h2>Related</h2>
          <ul className="grid">
            {related.map((entry) => (
              <ItemCard key={entry.id} item={entry} />
            ))}
          </ul>
        </>
      )}

      <JsonLd data={itemLd(item)} />
      <JsonLd data={breadcrumbLd(trail)} />
      <JsonLd data={faqLd(item)} />
    </article>
  );
}
