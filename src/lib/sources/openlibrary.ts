import type { Collection, DataSource, FetchContext, Offer, SourceItem } from './types';
import { isRecord, slugify, toNumber, toStringOrNull, uniqueSlug } from '../util';

/**
 * Open Library — books, no API key, no rate-limit signup.
 *
 * Second vertical, included to keep the adapter contract honest: it has a
 * different shape from CheapShark (no native prices, offers are synthesised
 * from ISBNs) and it forced the `Offer.price: null` case to be handled
 * properly everywhere downstream.
 */

const API = 'https://openlibrary.org';

/** Seed queries define the catalogue. Edit these to retarget the site. */
const SUBJECTS = [
  'science_fiction',
  'fantasy',
  'mystery_and_detective_stories',
  'historical_fiction',
  'biography',
  'popular_science',
];

const FIELDS = [
  'key',
  'title',
  'author_name',
  'first_publish_year',
  'number_of_pages_median',
  'subject',
  'cover_i',
  'ratings_average',
  'ratings_count',
  'isbn',
  'language',
].join(',');

interface BookRow {
  key: string;
  title: string;
  authors: string[];
  firstPublishYear: number | null;
  pages: number | null;
  subjects: string[];
  coverId: number | null;
  ratingsAverage: number | null;
  ratingsCount: number | null;
  isbn13: string | null;
}

/** Prefer a 13-digit ISBN: it is what both retail affiliate programmes key on. */
function pickIsbn(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  const cleaned = raw
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.replace(/[^0-9Xx]/g, ''));
  return cleaned.find((v) => v.length === 13) ?? cleaned.find((v) => v.length === 10) ?? null;
}

function parseBook(raw: unknown): BookRow | null {
  if (!isRecord(raw)) return null;
  const key = toStringOrNull(raw.key);
  const title = toStringOrNull(raw.title);
  if (!key || !title) return null;

  const authors = Array.isArray(raw.author_name)
    ? raw.author_name.filter((v): v is string => typeof v === 'string').slice(0, 3)
    : [];

  const subjects = Array.isArray(raw.subject)
    ? raw.subject.filter((v): v is string => typeof v === 'string').slice(0, 8)
    : [];

  return {
    key,
    title,
    authors,
    firstPublishYear: toNumber(raw.first_publish_year),
    pages: toNumber(raw.number_of_pages_median),
    subjects,
    coverId: toNumber(raw.cover_i),
    ratingsAverage: toNumber(raw.ratings_average),
    ratingsCount: toNumber(raw.ratings_count),
    isbn13: pickIsbn(raw.isbn),
  };
}

/**
 * Books have no price in the upstream data, so offers carry `price: null`.
 * They are still monetisable — the affiliate layer decorates them and the
 * quality gate scores them on facts rather than on price.
 */
function buildOffers(isbn: string | null): Offer[] {
  if (!isbn) return [];
  return [
    {
      merchant: 'Bookshop.org',
      url: `https://bookshop.org/book/${isbn}`,
      price: null,
      currency: 'USD',
      availability: 'unknown',
    },
    {
      merchant: 'Amazon',
      url: `https://www.amazon.com/dp/${isbn}`,
      price: null,
      currency: 'USD',
      availability: 'unknown',
    },
  ];
}

export const openLibrarySource: DataSource = {
  id: 'openlibrary',
  label: 'Open Library books',
  vertical: 'book discovery and price comparison',
  requiredEnv: [],
  attribution: {
    text: 'Bibliographic data from Open Library',
    url: 'https://openlibrary.org/developers/api',
  },

  async fetchAll(ctx: FetchContext): Promise<SourceItem[]> {
    const items: SourceItem[] = [];
    const taken = new Set<string>();
    const seen = new Set<string>();
    const perSubject = Math.max(1, Math.ceil(ctx.limit / SUBJECTS.length));

    for (const subject of SUBJECTS) {
      if (items.length >= ctx.limit) break;
      ctx.log(`Fetching subject "${subject}" (up to ${perSubject})...`);

      // Open Library caps `limit` at 100 per request, so page through.
      for (let offset = 0; offset < perSubject; offset += 100) {
        const pageSize = Math.min(100, perSubject - offset);
        const url =
          `${API}/search.json?subject=${encodeURIComponent(subject)}` +
          `&limit=${pageSize}&offset=${offset}&fields=${FIELDS}&sort=rating`;

        let raw: unknown;
        try {
          raw = await ctx.get(url);
        } catch (error) {
          ctx.log(`  ! subject ${subject} offset ${offset} failed: ${String(error)}`);
          break;
        }

        const docs = isRecord(raw) && Array.isArray(raw.docs) ? raw.docs : [];
        if (docs.length === 0) break;

        for (const doc of docs) {
          const book = parseBook(doc);
          if (!book || seen.has(book.key)) continue;
          seen.add(book.key);

          const facts = [];
          if (book.authors.length > 0) {
            facts.push({ label: 'Author', value: book.authors.join(', ') });
          }
          if (book.firstPublishYear != null) {
            facts.push({ label: 'First published', value: book.firstPublishYear });
          }
          if (book.pages != null) {
            facts.push({ label: 'Length', value: book.pages, unit: 'pages' });
          }
          if (book.ratingsAverage != null) {
            facts.push({
              label: 'Reader rating',
              value: book.ratingsAverage.toFixed(2),
              unit: '/5',
            });
          }
          if (book.ratingsCount != null) {
            facts.push({ label: 'Ratings counted', value: book.ratingsCount });
          }
          if (book.isbn13) facts.push({ label: 'ISBN', value: book.isbn13 });

          items.push({
            id: book.key,
            slug: uniqueSlug(
              book.authors[0] ? `${book.title}-${book.authors[0]}` : book.title,
              taken,
              book.key.replace(/\W+/g, ''),
            ),
            title: book.title,
            summary: buildSummary(book),
            facts,
            offers: buildOffers(book.isbn13),
            categories: [humanSubject(subject)],
            image: book.coverId
              ? {
                  url: `https://covers.openlibrary.org/b/id/${book.coverId}-L.jpg`,
                  alt: `Cover of ${book.title}`,
                }
              : null,
            updatedAt: new Date().toISOString(),
            extra: { openLibraryKey: book.key, subjects: book.subjects },
            enrichment: null,
          });
        }
      }
    }

    return items.slice(0, ctx.limit);
  },

  buildCollections(items: SourceItem[]): Collection[] {
    const byCategory = new Map<string, SourceItem[]>();
    for (const item of items) {
      for (const category of item.categories) {
        const bucket = byCategory.get(category);
        if (bucket) bucket.push(item);
        else byCategory.set(category, [item]);
      }
    }

    const collections: Collection[] = [];
    for (const [category, members] of byCategory) {
      if (members.length < 8) continue;
      const ranked = [...members].sort((a, b) => {
        const ratingA = Number(a.facts.find((f) => f.label === 'Reader rating')?.value ?? 0);
        const ratingB = Number(b.facts.find((f) => f.label === 'Reader rating')?.value ?? 0);
        return ratingB - ratingA;
      });

      collections.push({
        slug: slugify(category),
        title: `Best ${category} Books`,
        description:
          `${members.length} ${category.toLowerCase()} books ranked by aggregate reader ` +
          `rating, with page counts, publication years and where to buy each one.`,
        itemIds: ranked.slice(0, 50).map((item) => item.id),
      });
    }

    return collections.sort((a, b) => a.slug.localeCompare(b.slug));
  },
};

function humanSubject(subject: string): string {
  return subject
    .split('_')
    .map((word) => (word === 'and' ? 'and' : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

function buildSummary(book: BookRow): string {
  const parts: string[] = [];
  const byline = book.authors.length > 0 ? ` by ${book.authors.join(' and ')}` : '';
  const year = book.firstPublishYear != null ? `, first published in ${book.firstPublishYear}` : '';
  parts.push(`${book.title}${byline}${year}.`);

  if (book.ratingsAverage != null && book.ratingsCount != null) {
    parts.push(
      `It holds an average of ${book.ratingsAverage.toFixed(2)} out of 5 across ` +
        `${book.ratingsCount.toLocaleString('en-US')} reader ratings.`,
    );
  }
  if (book.pages != null) {
    parts.push(`Typical editions run about ${book.pages} pages.`);
  }

  return parts.join(' ');
}

export default openLibrarySource;
