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

/** The batch form returns a map keyed by game id. */
const GAME_BATCH = { '612': GAME_DETAIL };

test('cheapshark normalises deals, drops inactive stores and sorts by price', async () => {
  const ctx = makeCtx({ '/stores': STORES, '/deals': DEALS, '/games?ids=': GAME_BATCH });
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
  const ctx = makeCtx({ '/stores': STORES, '/deals': DEALS, '/games?ids=': GAME_BATCH });
  const [item] = await cheapsharkSource.fetchAll(ctx);
  assert.equal(
    item!.facts.find((fact) => fact.label === 'Metacritic'),
    undefined,
  );
  assert.equal(item!.extra?.['metacriticScore'], null);
});

test('cheapshark computes discount from list and sale price', async () => {
  const ctx = makeCtx({ '/stores': STORES, '/deals': DEALS, '/games?ids=': GAME_BATCH });
  const [item] = await cheapsharkSource.fetchAll(ctx);
  // 3.49 off a 19.99 list is an 83% saving.
  assert.equal(item!.offers[0]!.discountPercent, 83);
});

test('cheapshark batches detail requests instead of one call per game', async () => {
  const urls: string[] = [];
  const many = Array.from({ length: 30 }, (_, i) => ({ ...DEALS[0]!, gameID: `g${i}`, title: `Game ${i}` }));
  const batch: Record<string, unknown> = {};
  for (let i = 0; i < 30; i += 1) batch[`g${i}`] = GAME_DETAIL;

  const ctx: FetchContext = {
    limit: 30,
    log: () => {},
    get: async (url: string) => {
      urls.push(url);
      if (url.includes('/stores')) return STORES;
      if (url.includes('/deals')) return many;
      if (url.includes('/games?ids=')) return batch;
      throw new Error(`unexpected ${url}`);
    },
  };

  const items = await cheapsharkSource.fetchAll(ctx);
  assert.equal(items.length, 30);

  // 30 games at a batch size of 25 is two detail calls, not thirty.
  const detailCalls = urls.filter((url) => url.includes('/games?')).length;
  assert.equal(detailCalls, 2);
});

test('cheapshark falls back to single-id requests when a batch is unusable', async () => {
  const urls: string[] = [];
  const ctx: FetchContext = {
    limit: 10,
    log: () => {},
    get: async (url: string) => {
      urls.push(url);
      if (url.includes('/stores')) return STORES;
      if (url.includes('/deals')) return DEALS;
      // Batch form returns something unexpected; single form still works.
      if (url.includes('/games?ids=')) return 'not-an-object';
      if (url.includes('/games?id=')) return GAME_DETAIL;
      throw new Error(`unexpected ${url}`);
    },
  };

  const items = await cheapsharkSource.fetchAll(ctx);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.offers.length, 2); // recovered via the fallback
  assert.ok(urls.some((url) => url.includes('/games?id=612')));
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

/* ------- regressions found by running against the live API ------- */

/** A bundle SKU: present in /deals with a real price, absent from /games. */
const BUNDLE_DEAL = [
  {
    gameID: '999',
    title: 'Watch_Dogs 2 Gold Edition',
    storeID: '1',
    dealID: 'bundle-deal-id',
    salePrice: '12.49',
    normalPrice: '69.99',
    metacriticScore: '82',
    steamRatingPercent: '88',
    steamRatingText: 'Very Positive',
    releaseDate: 1480000000,
  },
];

test('a bundle absent from /games still gets the offer /deals already gave us', async () => {
  // The live failure this covers: 64 of 129 pages came back with zero offers
  // because /games returns no listings for edition and anthology SKUs, even
  // though /deals had just handed us a valid price and dealID for each.
  const ctx = makeCtx({
    '/stores': STORES,
    '/deals': BUNDLE_DEAL,
    // /games answers, but with no deals for this id.
    '/games?ids=': { '999': { info: {}, deals: [], cheapestPriceEver: null } },
  });

  const items = await cheapsharkSource.fetchAll(ctx);
  assert.equal(items.length, 1);

  const item = items[0]!;
  assert.equal(item.offers.length, 1);
  assert.equal(item.offers[0]!.merchant, 'Steam');
  assert.equal(item.offers[0]!.price, 12.49);
  assert.equal(item.offers[0]!.discountPercent, 82);

  // Which means it is indexable rather than suppressed as an empty page.
  assert.ok(item.facts.some((fact) => fact.label === 'Best current price'));
  assert.ok(item.summary.includes('12.49'));
});

test('the seeded offer is not double-counted when /games returns the same deal', async () => {
  // "compared across N stores" must not inflate because one deal arrived twice.
  const ctx = makeCtx({
    '/stores': STORES,
    '/deals': [{ ...DEALS[0]!, storeID: '1', dealID: 'abc' }],
    '/games?ids=': { '612': GAME_DETAIL },
  });

  const items = await cheapsharkSource.fetchAll(ctx);
  const item = items[0]!;

  // GAME_DETAIL has deals abc + def (+ one delisted). The seed reuses abc.
  assert.equal(item.offers.length, 2);
  const urls = new Set(item.offers.map((offer) => offer.url));
  assert.equal(urls.size, item.offers.length, 'duplicate deal urls present');
  assert.equal(item.facts.find((f) => f.label === 'Stores compared')?.value, 2);
});

test('a delisted store is not resurrected through the seeded offer', async () => {
  const ctx = makeCtx({
    '/stores': STORES,
    '/deals': [{ ...BUNDLE_DEAL[0]!, storeID: '99' }], // store 99 is inactive
    '/games?ids=': { '999': { deals: [], cheapestPriceEver: null } },
  });

  const items = await cheapsharkSource.fetchAll(ctx);
  assert.equal(items[0]!.offers.length, 0);
});
