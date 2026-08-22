import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { summariseGameDeal } from '../lib/sources/cheapshark';
import { discountPercent, slugify } from '../lib/util';
import type { Offer, SourceItem } from '../lib/sources/types';

/**
 * Generates the committed offline fixture.
 *
 * Every title here is invented. The fixture exists so `npm run build` works
 * with no network and so the quality gate, hub generation and sitemap chunking
 * are exercised at realistic scale — not to stand in for real market data.
 * Datasets built from it are flagged `isFixture` and the site says so on every
 * page.
 *
 *   npx tsx src/pipeline/make-fixtures.ts
 */

const OUT = join(process.cwd(), 'data', 'fixtures');

/** Deterministic PRNG so regenerating the fixture produces no diff noise. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PREFIX = [
  'Chrono', 'Nebula', 'Iron', 'Hollow', 'Crimson', 'Silent', 'Vector', 'Ashen',
  'Lucid', 'Umbral', 'Tidal', 'Fractal', 'Gilded', 'Quiet', 'Sable', 'Ember',
  'Halcyon', 'Verdant', 'Obsidian', 'Astral',
];
const NOUN = [
  'Drift', 'Foundry', 'Covenant', 'Reverie', 'Circuit', 'Bastion', 'Expanse',
  'Requiem', 'Harbour', 'Cascade', 'Machina', 'Threshold', 'Vigil', 'Anthem',
  'Paradox', 'Sanctum', 'Odyssey', 'Lament', 'Signal', 'Meridian',
];
const SUFFIX = ['', '', '', '', ' II', ' Remastered', ': Director’s Cut', ' Redux'];

const STORES = [
  'Steam', 'GOG', 'Humble Store', 'Fanatical', 'Green Man Gaming',
  'Epic Games Store', 'GamersGate', 'WinGameStore',
];

const STORE_HOSTS: Record<string, string> = {
  Steam: 'store.steampowered.com',
  GOG: 'www.gog.com',
  'Humble Store': 'www.humblebundle.com',
  Fanatical: 'www.fanatical.com',
  'Green Man Gaming': 'www.greenmangaming.com',
  'Epic Games Store': 'store.epicgames.com',
  GamersGate: 'www.gamersgate.com',
  WinGameStore: 'www.wingamestore.com',
};

function priceBand(price: number | null): string | null {
  if (price === null) return null;
  if (price < 5) return 'Under $5';
  if (price < 10) return 'Under $10';
  if (price < 20) return 'Under $20';
  return null;
}

function generate(count: number): SourceItem[] {
  const random = mulberry32(20260822);
  const items: SourceItem[] = [];
  const usedTitles = new Set<string>();
  const now = new Date('2026-08-22T00:00:00.000Z').toISOString();

  let guard = 0;
  while (items.length < count && guard < count * 40) {
    guard += 1;

    const title =
      `${PREFIX[Math.floor(random() * PREFIX.length)]} ` +
      `${NOUN[Math.floor(random() * NOUN.length)]}` +
      `${SUFFIX[Math.floor(random() * SUFFIX.length)]}`;
    if (usedTitles.has(title)) continue;
    usedTitles.add(title);

    const index = items.length;
    const normalPrice = Math.round((5 + random() * 55) * 100) / 100;
    const storeCount = 1 + Math.floor(random() * 6);

    // A small share of titles are delisted everywhere. Real catalogues always
    // contain these, and they are what exercises the noindex path end to end.
    const delisted = random() < 0.03;

    const offers: Offer[] = [];
    for (let s = 0; s < (delisted ? 0 : storeCount); s += 1) {
      const merchant = STORES[(index + s * 3) % STORES.length]!;
      const sale = Math.round(normalPrice * (0.15 + random() * 0.85) * 100) / 100;
      offers.push({
        merchant,
        url: `https://${STORE_HOSTS[merchant]}/product/${slugify(title)}-${index}`,
        price: sale,
        listPrice: normalPrice,
        currency: 'USD',
        discountPercent: discountPercent(normalPrice, sale),
        availability: 'in_stock',
      });
    }
    offers.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));

    const best = offers[0] ?? null;
    const cheapestEver =
      random() > 0.25
        ? {
            price:
              Math.round((best?.price ?? normalPrice) * (0.5 + random() * 0.5) * 100) / 100,
            date: new Date(Date.UTC(2024 + Math.floor(random() * 2), Math.floor(random() * 12), 1 + Math.floor(random() * 27))).toISOString(),
          }
        : null;

    const metacritic = random() > 0.35 ? 55 + Math.floor(random() * 45) : null;
    const steamRating = random() > 0.4 ? 50 + Math.floor(random() * 50) : null;

    const facts: SourceItem['facts'] = [
      { label: 'Regular price', value: `$${normalPrice.toFixed(2)}` },
      { label: 'Stores compared', value: offers.length },
    ];
    if (best) {
      facts.unshift(
        { label: 'Best current price', value: `$${best.price!.toFixed(2)}` },
        { label: 'Cheapest store right now', value: best.merchant },
      );
    } else {
      facts.unshift({ label: 'Availability', value: 'Not currently sold by any tracked store' });
    }
    if (cheapestEver) facts.push({ label: 'All-time low', value: `$${cheapestEver.price.toFixed(2)}` });
    if (metacritic !== null) facts.push({ label: 'Metacritic', value: metacritic, unit: '/100' });
    if (steamRating !== null) facts.push({ label: 'Steam user rating', value: steamRating, unit: '%' });

    const categories: string[] = [];
    const band = priceBand(best?.price ?? null);
    if (band) categories.push(band);
    if (metacritic !== null && metacritic >= 90) categories.push('Critically Acclaimed');
    else if (metacritic !== null && metacritic >= 80) categories.push('Highly Rated');
    if ((best?.discountPercent ?? 0) >= 75) categories.push('75% Off or More');

    items.push({
      id: `fixture-${index}`,
      slug: `${slugify(title)}`,
      title,
      summary: summariseGameDeal({ title, normalPrice, offers, cheapestEver }),
      facts,
      offers,
      categories,
      image: null,
      updatedAt: now,
      extra: { cheapestEver, metacriticScore: metacritic, synthetic: true },
      enrichment: null,
    });
  }

  return items;
}

async function main(): Promise<void> {
  const count = Number(process.argv[2] ?? 400);
  const items = generate(count);
  await mkdir(OUT, { recursive: true });
  const path = join(OUT, 'cheapshark.json');
  await writeFile(path, JSON.stringify(items, null, 2), 'utf8');
  process.stdout.write(`Wrote ${items.length} synthetic fixture items to ${path}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`make-fixtures failed: ${String(error)}\n`);
  process.exitCode = 1;
});
