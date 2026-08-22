import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { cheapsharkSource } from './cheapshark';
import { openLibrarySource } from './openlibrary';
import type { FetchContext } from './types';

/**
 * Adapter parsing tests.
 *
 * These drive each adapter with responses shaped like the real API's, so the
 * normalisation logic is covered without network access and without spending
 * rate-limited quota. They assert the defensive behaviour that matters:
 * junk fields are dropped rather than propagated as fake facts.
 */

function makeCtx(routes: Record<string, unknown>, limit = 10): FetchContext {
  return {
    limit,
    log: () => {},
    get: async (url: string) => {
      const key = Object.keys(routes).find((prefix) => url.includes(prefix));
      if (!key) throw new Error(`unexpected request: ${url}`);
      return routes[key];
    },
  };
}

/* ---------------------------- CheapShark ---------------------------- */

const STORES = [
  { storeID: '1', storeName: 'Steam', isActive: 1 },
  { storeID: '7', storeName: 'GOG', isActive: 1 },
  { storeID: '99', storeName: 'Dead Store', isActive: 0 },
];

const DEALS = [
  {
    gameID: '612',
    title: 'Test Game',
    salePrice: '4.99',
    normalPrice: '19.99',
    thumb: 'https://example.com/t.jpg',
    // "0" is the API's way of saying "no score" — it must not become a real 0.
    metacriticScore: '0',
    steamRatingPercent: '92',
    steamRatingText: 'Very Positive',
    steamAppID: '220',
    releaseDate: 1300000000,
  },
];

const GAME_DETAIL = {
  info: { title: 'Test Game' },
  deals: [
    { storeID: '1', dealID: 'abc', price: '4.99', retailPrice: '19.99' },
    { storeID: '7', dealID: 'def', price: '3.49', retailPrice: '19.99' },
    // Delisted store: must be dropped so we never emit a dead link.
    { storeID: '99', dealID: 'ghi', price: '1.00', retailPrice: '19.99' },
  ],
  cheapestPriceEver: { price: '2.99', date: 1600000000 },
};

test('cheapshark normalises deals, drops inactive stores and sorts by price', async () => {
  const ctx = makeCtx({ '/stores': STORES, '/deals': DEALS, '/games?id=': GAME_DETAIL });
  const items = await cheapsharkSource.fetchAll(ctx);

  assert.equal(items.length, 1);
  const item = items[0]!;
  assert.equal(item.title, 'Test Game');
  assert.equal(item.slug, 'test-game');

  // Inactive store removed, remaining offers sorted cheapest first.
  assert.equal(item.offers.length, 2);
  assert.equal(item.offers[0]!.merchant, 'GOG');
  assert.equal(item.offers[0]!.price, 3.49);
  assert.equal(item.offers[1]!.merchant, 'Steam');
  assert.ok(item.offers.every((offer) => offer.merchant !== 'Dead Store'));
});

test('cheapshark treats a zero metacritic score as absent, not as a real zero', async () => {
  const ctx = makeCtx({ '/stores': STORES, '/deals': DEALS, '/games?id=': GAME_DETAIL });
  const [item] = await cheapsharkSource.fetchAll(ctx);
  assert.equal(
    item!.facts.find((fact) => fact.label === 'Metacritic'),
    undefined,
  );
  assert.equal(item!.extra?.['metacriticScore'], null);
});

test('cheapshark computes discount from list and sale price', async () => {
  const ctx = makeCtx({ '/stores': STORES, '/deals': DEALS, '/games?id=': GAME_DETAIL });
  const [item] = await cheapsharkSource.fetchAll(ctx);
  // 3.49 off a 19.99 list is an 83% saving.
  assert.equal(item!.offers[0]!.discountPercent, 83);
});

test('cheapshark survives a failing game-detail request without losing the item', async () => {
  const ctx: FetchContext = {
    limit: 10,
    log: () => {},
    get: async (url: string) => {
      if (url.includes('/stores')) return STORES;
      if (url.includes('/deals')) return DEALS;
      throw new Error('upstream 500');
    },
  };

  const items = await cheapsharkSource.fetchAll(ctx);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.offers.length, 0);
  // Still carries real information, so the page is kept and noindexed.
  assert.ok(items[0]!.summary.includes('not currently listed'));
  assert.ok(items[0]!.facts.some((fact) => fact.label === 'Availability'));
});

test('cheapshark withholds hub pages that would be too thin', async () => {
  const items = Array.from({ length: 3 }, (_, i) => ({
    id: String(i),
    slug: `s-${i}`,
    title: `T${i}`,
    summary: 'x',
    facts: [],
    offers: [],
    categories: ['Under $5'],
    image: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    enrichment: null,
  }));
  // Three members is below the eight-member floor.
  assert.equal(cheapsharkSource.buildCollections(items).length, 0);
});

/* ---------------------------- Open Library ---------------------------- */

const SEARCH = {
  docs: [
    {
      key: '/works/OL1W',
      title: 'A Test Novel',
      author_name: ['Jane Author'],
      first_publish_year: 1998,
      number_of_pages_median: 320,
      subject: ['Fiction', 'Space'],
      cover_i: 12345,
      ratings_average: 4.21,
      ratings_count: 1500,
      isbn: ['0140449132', '9780140449136'],
    },
  ],
};

test('openlibrary prefers a 13-digit ISBN for affiliate links', async () => {
  const ctx = makeCtx({ '/search.json': SEARCH }, 1);
  const items = await openLibrarySource.fetchAll(ctx);

  assert.equal(items.length, 1);
  const item = items[0]!;
  assert.ok(item.offers.length > 0);
  for (const offer of item.offers) {
    assert.match(offer.url, /9780140449136/);
  }
});

test('openlibrary emits unpriced offers rather than inventing prices', async () => {
  const ctx = makeCtx({ '/search.json': SEARCH }, 1);
  const [item] = await openLibrarySource.fetchAll(ctx);
  assert.ok(item!.offers.every((offer) => offer.price === null));
});

test('openlibrary skips records missing a title or key', async () => {
  const ctx = makeCtx({ '/search.json': { docs: [{ title: 'No key' }, { key: '/works/X' }] } }, 5);
  const items = await openLibrarySource.fetchAll(ctx);
  assert.equal(items.length, 0);
});

test('openlibrary builds facts only from fields that are present', async () => {
  const sparse = { docs: [{ key: '/works/OL2W', title: 'Sparse Book' }] };
  const ctx = makeCtx({ '/search.json': sparse }, 1);
  const [item] = await openLibrarySource.fetchAll(ctx);
  assert.equal(item!.facts.length, 0);
  assert.equal(item!.offers.length, 0); // no ISBN, so nothing to link to
});
