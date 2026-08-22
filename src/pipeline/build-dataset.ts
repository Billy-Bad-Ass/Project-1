import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { site } from '@config/site.config';
import { HttpClient } from '../lib/http';
import { runQualityGate } from '../lib/quality';
import { getSource } from '../lib/sources';
import type { Dataset, FetchContext, SourceItem } from '../lib/sources/types';

/**
 * Fetch -> normalise -> quality gate -> dataset on disk.
 *
 * Run this before `next build`. The site itself performs no network I/O; it
 * only reads the dataset this script produces, which keeps builds fast,
 * reproducible and independent of whether an upstream API is up.
 *
 *   npm run data:build -- --limit 500
 *   npm run data:build -- --source openlibrary
 *   npm run data:build -- --offline        (fixtures, no network)
 */

const OUT_DIR = join(process.cwd(), 'data', 'datasets');
const FIXTURE_DIR = join(process.cwd(), 'data', 'fixtures');

interface Args {
  source: string;
  limit: number;
  offline: boolean;
  noCache: boolean;
  minFacts: number;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | null => {
    const index = argv.indexOf(flag);
    if (index === -1) return null;
    return argv[index + 1] ?? null;
  };

  const limitRaw = get('--limit');
  const limit = limitRaw === null ? 300 : Number(limitRaw);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(`--limit must be a positive number, got "${limitRaw}"`);
  }

  const minFactsRaw = get('--min-facts');
  const minFacts = minFactsRaw === null ? 4 : Number(minFactsRaw);
  if (!Number.isFinite(minFacts) || minFacts < 0) {
    throw new Error(`--min-facts must be a non-negative number, got "${minFactsRaw}"`);
  }

  return {
    source: get('--source') ?? site.source,
    limit,
    offline: argv.includes('--offline'),
    noCache: argv.includes('--no-cache'),
    minFacts,
  };
}

const log = (message: string) => process.stdout.write(`${message}\n`);

/**
 * Offline mode reads a committed fixture instead of calling the network, so
 * `npm run build` works in CI, in a sandbox, or on a plane — and so the site
 * has something to render before you have chosen a niche.
 */
async function loadFixtures(sourceId: string): Promise<SourceItem[]> {
  const path = join(FIXTURE_DIR, `${sourceId}.json`);
  try {
    const raw = await readFile(path, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('fixture is not an array');
    return parsed as SourceItem[];
  } catch (error) {
    throw new Error(
      `No usable fixture at ${path} for source "${sourceId}". ` +
        `Run without --offline to fetch live data. (${String(error)})`,
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const source = getSource(args.source);

  log(`Source:  ${source.label} (${source.vertical})`);
  log(`Mode:    ${args.offline ? 'offline fixtures' : 'live fetch'}`);
  log(`Limit:   ${args.limit} items\n`);

  const missing = source.requiredEnv.filter((name) => !process.env[name]);
  if (!args.offline && missing.length > 0) {
    throw new Error(
      `Source "${source.id}" needs these environment variables: ${missing.join(', ')}`,
    );
  }

  const http = new HttpClient({ noCache: args.noCache, log });
  const ctx: FetchContext = {
    get: (url, init) => http.getJson(url, init),
    limit: args.limit,
    log,
  };

  const started = Date.now();
  const items = args.offline ? await loadFixtures(source.id) : await source.fetchAll(ctx);
  log(`\nFetched ${items.length} items in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (!args.offline) {
    log(
      `HTTP: ${http.stats.misses} requests, ${http.stats.hits} cache hits, ` +
        `${http.stats.retries} retries, ${http.stats.errors} errors`,
    );
  }

  log('\nRunning quality gate...');
  const gate = runQualityGate(items, { minFacts: args.minFacts });

  const publishable = [...gate.published, ...gate.noindexed];
  const collections = source.buildCollections(gate.published);

  // A collection must not point at an item that was suppressed, or the hub
  // would link into a 404 during static export.
  const liveIds = new Set(publishable.map((item) => item.id));
  const cleanedCollections = collections
    .map((collection) => ({
      ...collection,
      itemIds: collection.itemIds.filter((id) => liveIds.has(id)),
    }))
    .filter((collection) => collection.itemIds.length >= 8);

  const dataset: Dataset = {
    sourceId: source.id,
    generatedAt: new Date().toISOString(),
    attribution: source.attribution,
    items: publishable,
    collections: cleanedCollections,
    suppressed: gate.suppressed,
    isFixture: args.offline,
  };

  await mkdir(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, 'dataset.json');
  await writeFile(outPath, JSON.stringify(dataset, null, 2), 'utf8');

  log(`  published:  ${gate.published.length}`);
  log(`  noindexed:  ${gate.noindexed.length}`);
  log(`  suppressed: ${gate.suppressed.length}`);
  if (Object.keys(gate.ruleHits).length > 0) {
    log('  rule hits:');
    for (const [rule, count] of Object.entries(gate.ruleHits).sort((a, b) => b[1] - a[1])) {
      log(`    ${rule.padEnd(18)} ${count}`);
    }
  }
  log(`  collections: ${cleanedCollections.length}`);
  log(`\nWrote ${outPath}`);

  if (publishable.length === 0) {
    throw new Error('Every item failed the quality gate — refusing to write an empty site.');
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`\nbuild-dataset failed: ${String(error)}\n`);
  process.exitCode = 1;
});
