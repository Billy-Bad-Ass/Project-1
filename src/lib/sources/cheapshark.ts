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
  /** The store and deal this row came from — a usable offer in its own right. */
  storeID: string | null;
  dealID: string | null;
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
    storeID: toStringOrNull(raw.storeID),
    dealID: toStringOrNull(raw.dealID),
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

interface GameDetail {
  offers: Offer[];
  cheapestEver: { price: number; date: string } | null;
}

/**
 * The offer implied by the /deals row itself.
 *
 * A live run showed why this matters: bundle and edition SKUs
 * ("Civilization VI Anthology", "Watch_Dogs 2 Gold Edition") appear in /deals
 * with a real price and dealID, but /games returns no store listings for them.
 * Relying on /games alone left half the catalogue with zero offers and got
 * those pages de-indexed or suppressed — while a perfectly good offer was
 * sitting unused in the response that found them.
 */
function offerFromDealRow(row: DealRow, stores: StoreMap): Offer | null {
  if (!row.dealID || row.salePrice === null) return null;

  const store = row.storeID ? stores.get(row.storeID) : undefined;
  if (store && !store.active) return null;

  return {
    merchant: store?.name ?? (row.storeID ? `Store ${row.storeID}` : 'Unknown store'),
    url: `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(row.dealID)}`,
    price: row.salePrice,
    listPrice: row.normalPrice,
    currency: 'USD',
    discountPercent: discountPercent(row.normalPrice, row.salePrice),
    availability: 'in_stock',
  };
}

/** Merge offer lists, dropping duplicates of the same deal, cheapest first. */
function mergeOffers(...lists: Offer[][]): Offer[] {
  const byUrl = new Map<string, Offer>();
  for (const list of lists) {
    for (const offer of list) {
      // Same deal seen twice (once from /deals, once from /games) must not be
      // counted as two stores — "compared across N stores" would be a lie.
      if (!byUrl.has(offer.url)) byUrl.set(offer.url, offer);
    }
  }
  return [...byUrl.values()].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
}

/**
 * Turn one /games entry into offers plus its all-time low. That all-time low is
 * the fact this vertical is really built around — no single store page shows it.
 */
function parseGameDetail(raw: unknown, stores: StoreMap): GameDetail | null {
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

/**
 * How many game ids to request at once. /games accepts a comma-separated `ids`
 * list and returns a map keyed by id, which turns one request per game into one
 * per batch. Fetching 600 games individually is 600 round trips against a free
 * API that asks for reasonable use; batched it is 24.
 */
const DETAIL_BATCH_SIZE = 25;

/**
 * Fetch detail for many games, batched, falling back to single-id requests for
 * any batch the API does not answer in the expected shape. The fallback exists
 * because the batch and single forms return different envelopes, and an
 * upstream change to either should degrade rather than empty the catalogue.
 */
async function fetchGameDetails(
  ctx: FetchContext,
  gameIds: string[],
  stores: StoreMap,
): Promise<Map<string, GameDetail>> {
  const out = new Map<string, GameDetail>();

  for (let i = 0; i < gameIds.length; i += DETAIL_BATCH_SIZE) {
    const batch = gameIds.slice(i, i + DETAIL_BATCH_SIZE);

    let batched: unknown = null;
    try {
      batched = await ctx.get(`${API}/games?ids=${batch.map(encodeURIComponent).join(',')}`);
    } catch (error) {
      ctx.log(`  ! detail batch failed, falling back to single requests: ${String(error)}`);
    }

    let resolved = 0;
    if (isRecord(batched)) {
      for (const id of batch) {
        const detail = parseGameDetail(batched[id], stores);
        if (detail) {
          out.set(id, detail);
          resolved += 1;
        }
      }
    }

    // Anything the batch did not answer is retried individually so a single
    // unknown id cannot cost us the other 24.
    if (resolved < batch.length) {
      for (const id of batch) {
        if (out.has(id)) continue;
        try {
          const detail = parseGameDetail(await ctx.get(`${API}/games?id=${encodeURIComponent(id)}`), stores);
          if (detail) out.set(id, detail);
        } catch (error) {
          ctx.log(`  ! game ${id} failed: ${String(error)}`);
        }
      }
    }

    ctx.log(`  detail ${Math.min(i + DETAIL_BATCH_SIZE, gameIds.length)}/${gameIds.length}`);
  }

  return out;
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

    ctx.log(`Fetching detail for ${games.size} games in batches of ${DETAIL_BATCH_SIZE}...`);
    const details = await fetchGameDetails(ctx, [...games.keys()], stores);

    const items: SourceItem[] = [];
    const taken = new Set<string>();
    let missingDetail = 0;
    let withoutOffers = 0;

    for (const [gameID, row] of games) {
      const detail = details.get(gameID) ?? null;
      if (detail === null) missingDetail += 1;

      const seed = offerFromDealRow(row, stores);
      const offers = mergeOffers(detail?.offers ?? [], seed ? [seed] : []);
      if (offers.length === 0) withoutOffers += 1;
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
        summary: summariseGameDeal({
          title: row.title,
          normalPrice: row.normalPrice,
          offers,
          cheapestEver: detail?.cheapestEver ?? null,
        }),
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

    if (missingDetail > 0) {
      ctx.log(
        `  ${missingDetail} game(s) had no /games detail; ` +
          `their /deals offer was used instead`,
      );
    }
    if (withoutOffers > 0) {
      ctx.log(`  ${withoutOffers} game(s) ended with no offers and will be de-indexed`);
    }
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
 * Summary text built strictly from this item's own numbers.
 *
 * Each branch states a different fact rather than rewording the same one. That
 * matters: a live run whose pages all share one sentence shape is the scaled
 * content pattern search engines demote, and `measureDiversity` in
 * src/lib/quality.ts reports exactly that. Exported so the fixture generator
 * produces identical prose to production instead of keeping a second copy that
 * can drift.
 */
export function summariseGameDeal(params: {
  title: string;
  normalPrice: number | null;
  offers: Offer[];
  cheapestEver: { price: number; date: string } | null;
}): string {
  const { title, normalPrice, offers, cheapestEver } = params;
  const parts: string[] = [];

  const priced = offers.filter((offer) => offer.price !== null);
  const best = priced[0] ?? null;

  if (best === null) {
    parts.push(`${title} is not currently listed for sale at any store we track.`);
    if (normalPrice != null) {
      parts.push(`Its last known list price was $${normalPrice.toFixed(2)}.`);
    }
    if (cheapestEver) {
      parts.push(`The lowest price ever recorded for it was $${cheapestEver.price.toFixed(2)}.`);
    }
    parts.push('We will list stores again here as soon as one stocks it.');
    return parts.join(' ');
  }

  // How much the choice of store is worth to the reader is the single most
  // useful thing this page knows, so lead with it when the spread is real.
  const highest = priced[priced.length - 1]!.price!;
  const spread = highest - best.price!;

  if (priced.length > 1 && spread >= 5) {
    parts.push(
      `${title} ranges from $${best.price!.toFixed(2)} at ${best.merchant} to ` +
        `$${highest.toFixed(2)} across ${priced.length} stores, so where you buy it ` +
        `is worth $${spread.toFixed(2)}.`,
    );
  } else if (priced.length > 1) {
    parts.push(
      `${title} costs about the same everywhere right now, from $${best.price!.toFixed(2)} ` +
        `at ${best.merchant} across ${priced.length} stores.`,
    );
  } else {
    parts.push(`${title} is stocked by one store we track, ${best.merchant}, at $${best.price!.toFixed(2)}.`);
  }

  const discount = best.discountPercent ?? 0;
  if (discount >= 75) {
    parts.push(`It is heavily discounted, at ${discount}% off its $${(normalPrice ?? 0).toFixed(2)} list price.`);
  } else if (discount > 0) {
    parts.push(`That is ${discount}% below its $${(normalPrice ?? 0).toFixed(2)} list price.`);
  } else {
    parts.push('It is not discounted anywhere at the moment.');
  }

  if (cheapestEver) {
    const gap = best.price! - cheapestEver.price;
    if (gap <= 0) {
      parts.push('This matches the lowest price it has ever been.');
    } else if (gap < 1) {
      parts.push(`That is within $${gap.toFixed(2)} of its all-time low of $${cheapestEver.price.toFixed(2)}.`);
    } else {
      parts.push(
        `Its all-time low was $${cheapestEver.price.toFixed(2)}, so today is $${gap.toFixed(2)} ` +
          `above the best it has been — worth waiting if you are not in a hurry.`,
      );
    }
  }

  return parts.join(' ');
}

export default cheapsharkSource;
