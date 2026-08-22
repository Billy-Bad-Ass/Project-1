import type { Metadata } from 'next';
import { site } from '@config/site.config';
import type { Collection, SourceItem } from './sources/types';
import { bestOffer } from './dataset';

/**
 * Metadata and structured data.
 *
 * Structured data is the highest-leverage thing a programmatic site can emit:
 * it is how a page becomes eligible for price/rating rich results, which is
 * most of the click-through advantage over the merchant pages it competes
 * with. Everything here is built from real item data — a schema field with no
 * backing fact is omitted rather than faked, because invented structured data
 * is a manual-action risk.
 */

export function canonical(path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${site.url}${clean === '/' ? '/' : clean.endsWith('/') ? clean : `${clean}/`}`;
}

export function itemPath(item: SourceItem): string {
  return `/p/${item.slug}/`;
}

export function collectionPath(collection: Collection): string {
  return `/best/${collection.slug}/`;
}

/** Trim to a length search engines will actually display. */
function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function itemMetadata(item: SourceItem): Metadata {
  const offer = bestOffer(item);
  const priceSuffix =
    offer?.price != null ? ` — from $${offer.price.toFixed(2)}` : '';

  const title = truncate(`${item.title}${priceSuffix} | ${site.name}`, 60);
  const description = truncate(item.summary, 155);
  const url = canonical(itemPath(item));
  const indexable = item.offers.length > 0;

  return {
    title,
    description,
    alternates: { canonical: url },
    // Pages with nothing to offer stay reachable but out of the index; see
    // src/lib/quality.ts for why this matters.
    robots: indexable ? undefined : { index: false, follow: true },
    openGraph: {
      title,
      description,
      url,
      type: 'website',
      siteName: site.name,
      images: item.image ? [{ url: item.image.url, alt: item.image.alt }] : undefined,
    },
    twitter: {
      card: item.image ? 'summary_large_image' : 'summary',
      title,
      description,
    },
  };
}

export function collectionMetadata(collection: Collection, itemCount: number): Metadata {
  const title = truncate(`${collection.title} | ${site.name}`, 60);
  const description = truncate(collection.description, 155);
  const url = canonical(collectionPath(collection));

  return {
    title,
    description,
    alternates: { canonical: url },
    robots: itemCount >= 8 ? undefined : { index: false, follow: true },
    openGraph: { title, description, url, type: 'website', siteName: site.name },
  };
}

/* ------------------------------------------------------------------ */
/* JSON-LD                                                             */
/* ------------------------------------------------------------------ */

type Json = Record<string, unknown>;

export function breadcrumbLd(trail: { name: string; path: string }[]): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: canonical(crumb.path),
    })),
  };
}

/**
 * Product + AggregateOffer. Emitted only when the item is genuinely priced;
 * an unpriced item gets a plain Thing so we never claim an offer that the page
 * does not actually show.
 */
export function itemLd(item: SourceItem): Json {
  const priced = item.offers.filter((offer) => offer.price !== null);
  const url = canonical(itemPath(item));

  const base: Json = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: item.title,
    description: item.summary,
    url,
    ...(item.image ? { image: item.image.url } : {}),
  };

  const metacritic = item.extra?.['metacriticScore'];
  if (typeof metacritic === 'number' && metacritic > 0) {
    base.review = {
      '@type': 'Review',
      reviewRating: {
        '@type': 'Rating',
        ratingValue: metacritic,
        bestRating: 100,
        worstRating: 0,
      },
      author: { '@type': 'Organization', name: 'Metacritic' },
    };
  }

  if (priced.length === 0) return base;

  const prices = priced.map((offer) => offer.price!);
  const currency = priced[0]!.currency;

  base.offers = {
    '@type': 'AggregateOffer',
    offerCount: priced.length,
    lowPrice: Math.min(...prices).toFixed(2),
    highPrice: Math.max(...prices).toFixed(2),
    priceCurrency: currency,
    offers: priced.slice(0, 10).map((offer) => ({
      '@type': 'Offer',
      price: offer.price!.toFixed(2),
      priceCurrency: offer.currency,
      availability:
        offer.availability === 'out_of_stock'
          ? 'https://schema.org/OutOfStock'
          : 'https://schema.org/InStock',
      seller: { '@type': 'Organization', name: offer.merchant },
      url,
    })),
  };

  return base;
}

export function collectionLd(collection: Collection, items: SourceItem[]): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: collection.title,
    description: collection.description,
    url: canonical(collectionPath(collection)),
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.title,
      url: canonical(itemPath(item)),
    })),
  };
}

/**
 * FAQ built from the item's own numbers. Only questions the page genuinely
 * answers are emitted — an FAQ block whose answers are not visible on the page
 * violates the structured data guidelines.
 */
export function faqLd(item: SourceItem): Json | null {
  const offer = bestOffer(item);
  if (!offer || offer.price === null) return null;

  const questions: { q: string; a: string }[] = [
    {
      q: `What is the cheapest place to buy ${item.title}?`,
      a: `${offer.merchant} currently has the lowest price at $${offer.price.toFixed(2)}${
        item.offers.length > 1 ? `, out of ${item.offers.length} stores compared.` : '.'
      }`,
    },
  ];

  const cheapestEver = item.extra?.['cheapestEver'];
  if (
    typeof cheapestEver === 'object' &&
    cheapestEver !== null &&
    'price' in cheapestEver &&
    typeof (cheapestEver as { price: unknown }).price === 'number'
  ) {
    const low = (cheapestEver as { price: number }).price;
    questions.push({
      q: `Has ${item.title} ever been cheaper?`,
      a:
        offer.price <= low
          ? `No — $${offer.price.toFixed(2)} matches the lowest price recorded for ${item.title}.`
          : `Yes. Its lowest recorded price is $${low.toFixed(2)}, which is $${(
              offer.price - low
            ).toFixed(2)} below today's best price.`,
    });
  }

  if (questions.length < 2) return null;

  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: questions.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}

export function websiteLd(): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: site.name,
    description: site.description,
    url: canonical('/'),
  };
}
