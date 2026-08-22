import type { Collection, DataSource, FetchContext, Offer, SourceItem } from './types';
import { discountPercent, isRecord, slugify, toNumber, toStringOrNull, uniqueSlug } from '../util';

/**
 * CheapShark — live PC game prices across ~30 stores.
 *
 * Chosen as the reference vertical because it needs no API key, no signup and
 * no card, its data genuinely changes daily (so pages have a real reason to be
 * recrawled), and several of the stores it covers run open affiliate
 * programmes. Docs: https://apidocs.cheapshark.com/
 */

const API = 'https://www.cheapshark.com/api/1.0';
const PAGE_SIZE = 60; // API maximum.

/** Store id -> name, resolved once per run from /stores. */
type StoreMap = Map<string, { name: string; active: boolean }>;

interface DealRow {
  gameID: string;
  title: string;
  salePrice: number | null;
  normalPrice: number | null;
  thumb: string | null;
  metacriticScore: number | null;
  steamRatingPercent: number | null;
  steamRatingText: string | null;
  steamAppID: string | null;
  releaseDate: number | null;
  dealRating: number | null;
}

function parseDealRow(raw: unknown): DealRow | null {
  if (!isRecord(raw)) return null;
  const gameID = toStringOrNull(raw.gameID);
  const title = toStringOrNull(raw.title);
  if (!gameID || !title) return null;

  return {
    gameID,
    title,
    salePrice: toNumber(raw.salePrice),
    normalPrice: toNumber(raw.normalPrice),
    thumb: toStringOrNull(raw.thumb),
    // The API returns "0" for "no score", which is not the same as a real zero.
    metacriticScore: nonZero(toNumber(raw.metacriticScore)),
    steamRatingPercent: nonZero(toNumber(raw.steamRatingPercent)),
    steamRatingText: toStringOrNull(raw.steamRatingText),
    steamAppID: toStringOrNull(raw.steamAppID),
    releaseDate: nonZero(toNumber(raw.releaseDate)),
    dealRating: toNumber(raw.dealRating),
  };
}

function nonZero(value: number | null): number | null {
  return value === null || value === 0 ? null : value;
}

async function fetchStores(ctx: FetchContext): Promise<StoreMap> {
  const map: StoreMap = new Map();
  const raw = await ctx.get(`${API}/stores`);
  if (!Array.isArray(raw)) return map;
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = toStringOrNull(entry.storeID);
    const name = toStringOrNull(entry.storeName);
    if (!id || !name) continue;
    map.set(id, { name, active: entry.isActive === 1 || entry.isActive === true });
  }
  return map;
}

/** Walk /deals until we have `limit` distinct games or the API runs dry. */
async function fetchDealPages(ctx: FetchContext, limit: number): Promise<Map<string, DealRow>> {
  const byGame = new Map<string, DealRow>();
  const maxPages = Math.ceil(limit / PAGE_SIZE) + 4; // slack for duplicate games

  for (let page = 0; page < maxPages && byGame.size < limit; page += 1) {
    const url = `${API}/deals?pageNumber=${page}&pageSize=${PAGE_SIZE}&sortBy=Deal%20Rating&onSale=1`;
    const raw = await ctx.get(url);
    if (!Array.isArray(raw) || raw.length === 0) break;

    for (const entry of raw) {
      const row = parseDealRow(entry);
      // Keep the first (best-rated) deal row per game; later pages are worse.
      if (row && !byGame.has(row.gameID)) byGame.set(row.gameID, row);
    }
    ctx.log(`  deals page ${page}: ${byGame.size}/${limit} games`);
  }

  return byGame;
}

/**
 * /games?id= returns every store's current price for one game plus its
 * all-time low. That all-time low is the fact this vertical is really built
 * around — it is the thing a shopper cannot get from any single store page.
 */
async function fetchGameDetail(
  ctx: FetchContext,
  gameID: string,
  stores: StoreMap,
): Promise<{ offers: Offer[]; cheapestEver: { price: number; date: string } | null } | null> {
  const raw = await ctx.get(`${API}/games?id=${encodeURIComponent(gameID)}`);
  if (!isRecord(raw)) return null;

  const offers: Offer[] = [];
  const deals = raw.deals;
  if (Array.isArray(deals)) {
    for (const deal of deals) {
      if (!isRecord(deal)) continue;
      const storeId = toStringOrNull(deal.storeID);
      const dealId = toStringOrNull(deal.dealID);
      const price = toNumber(deal.price);
      if (!storeId || !dealId || price === null) continue;

      const store = stores.get(storeId);
      if (store && !store.active) continue; // delisted store, dead link

      const retail = toNumber(deal.retailPrice);
      offers.push({
        merchant: store?.name ?? `Store ${storeId}`,
        // CheapShark's redirect resolves to the merchant's own product page and
        // is the access method its docs sanction, so we link through it.
        url: `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(dealId)}`,
        price,
        listPrice: retail,
        currency: 'USD',
        discountPercent: discountPercent(retail, price),
        availability: 'in_stock',
      });
    }
  }

  offers.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));

  let cheapestEver: { price: number; date: string } | null = null;
  const cheapest = raw.cheapestPriceEver;
  if (isRecord(cheapest)) {
    const price = toNumber(cheapest.price);
    const epoch = toNumber(cheapest.date);
    if (price !== null && epoch !== null && epoch > 0) {
      cheapestEver = { price, date: new Date(epoch * 1000).toISOString() };
    }
  }

  return { offers, cheapestEver };
}

/** Buckets that make useful hub pages and match real search phrasing. */
function priceBand(price: number | null): string | null {
  if (price === null) return null;
  if (price < 5) return 'Under $5';
  if (price < 10) return 'Under $10';
  if (price < 20) return 'Under $20';
  return null;
}

function ratingBand(metacritic: number | null): string | null {
  if (metacritic === null) return null;
  if (metacritic >= 90) return 'Critically Acclaimed';
  if (metacritic >= 80) return 'Highly Rated';
  return null;
}

export const cheapsharkSource: DataSource = {
  id: 'cheapshark',
  label: 'CheapShark game deals',
  vertical: 'PC game price comparison',
  requiredEnv: [],
  attribution: {
    text: 'Price data provided by CheapShark',
    url: 'https://www.cheapshark.com/',
  },

  async fetchAll(ctx: FetchContext): Promise<SourceItem[]> {
    ctx.log('Resolving store list...');
    const stores = await fetchStores(ctx);
    ctx.log(`  ${stores.size} stores`);

    ctx.log(`Collecting up to ${ctx.limit} games from /deals...`);
    const games = await fetchDealPages(ctx, ctx.limit);

    ctx.log(`Fetching per-game detail for ${games.size} games...`);
    const items: SourceItem[] = [];
    const taken = new Set<string>();
    let failures = 0;

    for (const [gameID, row] of games) {
      let detail: Awaited<ReturnType<typeof fetchGameDetail>> = null;
      try {
        detail = await fetchGameDetail(ctx, gameID, stores);
      } catch (error) {
        // One dead game must not abort a multi-thousand-item run.
        failures += 1;
        ctx.log(`  ! game ${gameID} failed: ${String(error)}`);
      }

      const offers = detail?.offers ?? [];
      const best = offers[0] ?? null;
      const facts = [];

      if (best?.price != null) {
        facts.push({ label: 'Best current price', value: `$${best.price.toFixed(2)}` });
        facts.push({ label: 'Cheapest store right now', value: best.merchant });
      } else {
        facts.push({
          label: 'Availability',
          value: 'Not currently sold by any tracked store',
        });
      }
      if (row.normalPrice != null) {
        facts.push({ label: 'Regular price', value: `$${row.normalPrice.toFixed(2)}` });
      }
      if (detail?.cheapestEver) {
        facts.push({
          label: 'All-time low',
          value: `$${detail.cheapestEver.price.toFixed(2)}`,
        });
      }
      if (offers.length > 0) {
        facts.push({ label: 'Stores compared', value: offers.length });
      }
      if (row.metacriticScore != null) {
        facts.push({ label: 'Metacritic', value: row.metacriticScore, unit: '/100' });
      }
      if (row.steamRatingPercent != null) {
        facts.push({ label: 'Steam user rating', value: row.steamRatingPercent, unit: '%' });
      }
      if (row.steamRatingText) {
        facts.push({ label: 'Steam review summary', value: row.steamRatingText });
      }
      if (row.releaseDate != null) {
        facts.push({
          label: 'Released',
          value: new Date(row.releaseDate * 1000).toISOString().slice(0, 10),
        });
      }

      const categories: string[] = [];
      const band = priceBand(best?.price ?? null);
      if (band) categories.push(band);
      const rating = ratingBand(row.metacriticScore);
      if (rating) categories.push(rating);
      if (best?.discountPercent != null && best.discountPercent >= 75) {
        categories.push('75% Off or More');
      }

      items.push({
        id: gameID,
        slug: uniqueSlug(row.title, taken, gameID),
        title: row.title,
        summary: buildSummary(row, offers, detail?.cheapestEver ?? null),
        facts,
        offers,
        categories,
        image: row.thumb ? { url: row.thumb, alt: `${row.title} cover art` } : null,
        updatedAt: new Date().toISOString(),
        extra: {
          cheapestEver: detail?.cheapestEver ?? null,
          steamAppID: row.steamAppID,
          metacriticScore: row.metacriticScore,
        },
        enrichment: null,
      });
    }

    if (failures > 0) ctx.log(`  ${failures} games failed and were kept without offers`);
    return items;
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
      // A hub with two entries is a thin page. Don't publish one.
      if (members.length < 8) continue;

      const ranked = [...members].sort(
        (a, b) => (a.offers[0]?.price ?? Infinity) - (b.offers[0]?.price ?? Infinity),
      );
      const top = ranked.slice(0, 50);

      collections.push({
        slug: slugify(category),
        title: `PC Games ${category}`,
        description:
          `${members.length} PC games currently matching "${category}", ranked by the ` +
          `lowest price we can find across every store we track. Prices refresh daily.`,
        itemIds: top.map((item) => item.id),
      });
    }

    return collections.sort((a, b) => a.slug.localeCompare(b.slug));
  },
};

/**
 * Summary text built strictly from this item's own numbers. No template with
 * interchangeable adjectives — that is exactly the "scaled content" pattern
 * search engines demote.
 */
function buildSummary(
  row: DealRow,
  offers: Offer[],
  cheapestEver: { price: number; date: string } | null,
): string {
  const parts: string[] = [];
  const best = offers[0];

  if (best?.price != null && offers.length > 1) {
    parts.push(
      `${row.title} is cheapest at ${best.merchant} for $${best.price.toFixed(2)}, ` +
        `compared across ${offers.length} stores.`,
    );
  } else if (best?.price != null) {
    parts.push(`${row.title} is currently $${best.price.toFixed(2)} at ${best.merchant}.`);
  } else {
    // No live offer, but the historical figures are still real information, so
    // the page is kept and merely de-indexed rather than thrown away.
    parts.push(`${row.title} is not currently listed for sale at any store we track.`);
    if (row.normalPrice != null) {
      parts.push(`Its last known list price was $${row.normalPrice.toFixed(2)}.`);
    }
    if (cheapestEver) {
      parts.push(
        `The lowest price ever recorded for it was $${cheapestEver.price.toFixed(2)}.`,
      );
    }
    parts.push('We will list stores again here as soon as one stocks it.');
  }

  if (best?.discountPercent != null && best.discountPercent > 0) {
    parts.push(`That is ${best.discountPercent}% below its $${(row.normalPrice ?? 0).toFixed(2)} list price.`);
  }

  if (cheapestEver && best?.price != null) {
    if (best.price <= cheapestEver.price) {
      parts.push('This matches the lowest price it has ever been.');
    } else {
      const gap = best.price - cheapestEver.price;
      parts.push(
        `Its all-time low was $${cheapestEver.price.toFixed(2)}, so today is $${gap.toFixed(2)} above the best it has been.`,
      );
    }
  }

  return parts.join(' ');
}

export default cheapsharkSource;
