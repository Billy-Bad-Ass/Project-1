import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isRecord, toStringOrNull } from '../lib/util';
import type { Dataset, Enrichment, SourceItem } from '../lib/sources/types';

/**
 * Optional editorial enrichment via Firecrawl.
 *
 * Firecrawl's free tier is a small one-off credit grant, not a monthly refill,
 * so this script is built around never wasting a credit:
 *
 *   - every result is cached permanently (no TTL) and re-used across runs
 *   - a hard `--budget` cap stops the run before it overspends
 *   - `--dry-run` prints the plan and its cost without spending anything
 *   - items are enriched in priority order, so if the budget runs out it runs
 *     out on the least valuable pages
 *
 * Enrichment is genuinely optional: the site builds and ranks without it. It
 * exists to add a short, attributed excerpt to the highest-traffic pages.
 *
 *   npm run data:enrich -- --limit 50 --budget 120
 *   npm run data:enrich -- --dry-run
 */

const DATASET = join(process.cwd(), 'data', 'datasets', 'dataset.json');
const CACHE = join(process.cwd(), 'data', 'cache', 'enrichment.json');
const API = process.env.FIRECRAWL_API_URL ?? 'https://api.firecrawl.dev/v1';

/** Firecrawl bills roughly per operation; we plan with 1 credit per call. */
const CREDITS_PER_SEARCH = 1;
const CREDITS_PER_SCRAPE = 1;

interface Args {
  limit: number;
  budget: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | null => {
    const index = argv.indexOf(flag);
    return index === -1 ? null : (argv[index + 1] ?? null);
  };

  const limit = Number(get('--limit') ?? 25);
  const budget = Number(get('--budget') ?? 100);
  if (!Number.isFinite(limit) || limit <= 0) throw new Error('--limit must be positive');
  if (!Number.isFinite(budget) || budget <= 0) throw new Error('--budget must be positive');

  return { limit, budget, dryRun: argv.includes('--dry-run') };
}

const log = (message: string) => process.stdout.write(`${message}\n`);

type Cache = Record<string, Enrichment | { failed: true; at: string }>;

async function loadCache(): Promise<Cache> {
  try {
    return JSON.parse(await readFile(CACHE, 'utf8')) as Cache;
  } catch {
    return {};
  }
}

async function saveCache(cache: Cache): Promise<void> {
  await mkdir(join(process.cwd(), 'data', 'cache'), { recursive: true });
  await writeFile(CACHE, JSON.stringify(cache, null, 2), 'utf8');
}

async function firecrawl(path: string, body: unknown, key: string): Promise<unknown> {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Firecrawl ${path} returned ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.json();
}

/** First organic result for a review-intent query, or null. */
async function findReviewUrl(item: SourceItem, key: string): Promise<string | null> {
  const result = await firecrawl(
    '/search',
    { query: `${item.title} review`, limit: 3 },
    key,
  );

  if (!isRecord(result)) return null;
  const data = result.data;
  if (!Array.isArray(data)) return null;

  for (const entry of data) {
    if (!isRecord(entry)) continue;
    const url = toStringOrNull(entry.url);
    if (url) return url;
  }
  return null;
}

/** Pull a short, quotable excerpt. We store an excerpt and always attribute it. */
async function scrapeExcerpt(url: string, key: string): Promise<string | null> {
  const result = await firecrawl(
    '/scrape',
    { url, formats: ['markdown'], onlyMainContent: true },
    key,
  );

  if (!isRecord(result)) return null;
  const data = isRecord(result.data) ? result.data : null;
  const markdown = data ? toStringOrNull(data.markdown) : null;
  if (!markdown) return null;

  // First substantial paragraph: skip headings, images and nav crumbs.
  const paragraph = markdown
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .find(
      (block) =>
        block.length > 120 &&
        !block.startsWith('#') &&
        !block.startsWith('!') &&
        !block.startsWith('|') &&
        !block.startsWith('*') &&
        !block.startsWith('-'),
    );

  if (!paragraph) return null;

  // Keep it short: this is a quoted excerpt with a link, not a copy of the page.
  const clean = paragraph.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
  return clean.length > 400 ? `${clean.slice(0, 397).trimEnd()}…` : clean;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const key = process.env.FIRECRAWL_API_KEY;

  if (!key && !args.dryRun) {
    throw new Error(
      'FIRECRAWL_API_KEY is not set. Get a free key at https://firecrawl.dev, ' +
        'or run with --dry-run to preview the plan without spending credits.',
    );
  }

  const dataset = JSON.parse(await readFile(DATASET, 'utf8')) as Dataset;
  const cache = await loadCache();

  // Priority: pages that can actually earn. Most offers first, then deepest
  // discount — if the budget runs out, it runs out on the least valuable pages.
  const candidates = dataset.items
    .filter((item) => item.offers.length > 0)
    .sort((a, b) => {
      const offersDelta = b.offers.length - a.offers.length;
      if (offersDelta !== 0) return offersDelta;
      return (b.offers[0]?.discountPercent ?? 0) - (a.offers[0]?.discountPercent ?? 0);
    });

  const todo = candidates.filter((item) => !cache[item.id]).slice(0, args.limit);
  const alreadyCached = candidates.filter((item) => cache[item.id]).length;
  const perItem = CREDITS_PER_SEARCH + CREDITS_PER_SCRAPE;
  const affordable = Math.min(todo.length, Math.floor(args.budget / perItem));

  log(`Candidates:      ${candidates.length}`);
  log(`Already cached:  ${alreadyCached} (free, will be reused)`);
  log(`Queued this run: ${todo.length}`);
  log(`Budget:          ${args.budget} credits (~${perItem}/item → ${affordable} items)`);

  if (args.dryRun) {
    log('\n--dry-run: no credits spent. Would enrich:');
    for (const item of todo.slice(0, affordable)) log(`  ${item.title}`);
    return;
  }

  let spent = 0;
  let enriched = 0;
  let failed = 0;

  for (const item of todo.slice(0, affordable)) {
    if (spent + perItem > args.budget) {
      log(`\nBudget reached (${spent}/${args.budget}). Stopping.`);
      break;
    }

    try {
      const url = await findReviewUrl(item, key!);
      spent += CREDITS_PER_SEARCH;
      if (!url) {
        cache[item.id] = { failed: true, at: new Date().toISOString() };
        failed += 1;
        continue;
      }

      const excerpt = await scrapeExcerpt(url, key!);
      spent += CREDITS_PER_SCRAPE;

      if (!excerpt) {
        cache[item.id] = { failed: true, at: new Date().toISOString() };
        failed += 1;
        continue;
      }

      cache[item.id] = { sourceUrl: url, excerpt, fetchedAt: new Date().toISOString() };
      enriched += 1;
      log(`  ✓ ${item.title}`);
    } catch (error) {
      // Persist progress on failure so a crash never loses paid-for results.
      failed += 1;
      log(`  ! ${item.title}: ${String(error)}`);
      await saveCache(cache);
    }
  }

  await saveCache(cache);

  // Merge cached enrichment into the dataset the site reads.
  let attached = 0;
  for (const item of dataset.items) {
    const entry = cache[item.id];
    if (entry && !('failed' in entry)) {
      item.enrichment = entry;
      attached += 1;
    }
  }
  await writeFile(DATASET, JSON.stringify(dataset, null, 2), 'utf8');

  log(`\nEnriched ${enriched}, failed ${failed}, credits spent ~${spent}`);
  log(`Dataset now carries ${attached} enriched page(s).`);
}

main().catch((error: unknown) => {
  process.stderr.write(`\nenrich-firecrawl failed: ${String(error)}\n`);
  process.exitCode = 1;
});
