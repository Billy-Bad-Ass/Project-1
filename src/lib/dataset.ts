import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Collection, Dataset, SourceItem } from './sources/types';

/**
 * Build-time dataset access.
 *
 * Read once, synchronously, and memoised: every page in a static export asks
 * for this, and re-reading a multi-megabyte JSON file per page would dominate
 * build time. Nothing here touches the network.
 */

const DATASET_PATH = join(process.cwd(), 'data', 'datasets', 'dataset.json');

let cached: Dataset | null = null;

export function getDataset(): Dataset {
  if (cached) return cached;

  let raw: string;
  try {
    raw = readFileSync(DATASET_PATH, 'utf8');
  } catch {
    throw new Error(
      `No dataset at ${DATASET_PATH}.\n` +
        `Run \`npm run data:build -- --offline\` (fixtures) or \`npm run data:build\` (live) first.`,
    );
  }

  const parsed = JSON.parse(raw) as Dataset;
  if (!Array.isArray(parsed.items)) {
    throw new Error('Dataset is malformed: expected an "items" array.');
  }

  cached = parsed;
  return parsed;
}

/** Index built once, so per-page lookups are O(1) rather than a linear scan. */
let bySlugIndex: Map<string, SourceItem> | null = null;
let byIdIndex: Map<string, SourceItem> | null = null;

function indexes(): { bySlug: Map<string, SourceItem>; byId: Map<string, SourceItem> } {
  if (!bySlugIndex || !byIdIndex) {
    bySlugIndex = new Map();
    byIdIndex = new Map();
    for (const item of getDataset().items) {
      bySlugIndex.set(item.slug, item);
      byIdIndex.set(item.id, item);
    }
  }
  return { bySlug: bySlugIndex, byId: byIdIndex };
}

export function allItems(): SourceItem[] {
  return getDataset().items;
}

export function getItemBySlug(slug: string): SourceItem | null {
  return indexes().bySlug.get(slug) ?? null;
}

export function getItemsByIds(ids: readonly string[]): SourceItem[] {
  const { byId } = indexes();
  return ids.map((id) => byId.get(id)).filter((item): item is SourceItem => item !== undefined);
}

export function allCollections(): Collection[] {
  return getDataset().collections;
}

export function getCollectionBySlug(slug: string): Collection | null {
  return getDataset().collections.find((collection) => collection.slug === slug) ?? null;
}

/** An item is indexable only if it has somewhere to send the reader. */
export function isIndexable(item: SourceItem): boolean {
  return item.offers.length > 0;
}

export function indexableItems(): SourceItem[] {
  return allItems().filter(isIndexable);
}

/** Lowest priced offer, or null when nothing on the page is priced. */
export function bestOffer(item: SourceItem) {
  const priced = item.offers.filter((offer) => offer.price !== null);
  if (priced.length === 0) return item.offers[0] ?? null;
  return priced.reduce((best, offer) => (offer.price! < best.price! ? offer : best));
}

/**
 * Related items for internal linking. Programmatic sites live or die on crawl
 * depth: without these links, deep pages are reachable only from a hub and
 * many never get crawled at all.
 */
export function relatedItems(item: SourceItem, count = 6): SourceItem[] {
  const shared = new Set(item.categories);
  const scored = allItems()
    .filter((candidate) => candidate.id !== item.id && isIndexable(candidate))
    .map((candidate) => ({
      candidate,
      score: candidate.categories.filter((category) => shared.has(category)).length,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.candidate.title.localeCompare(b.candidate.title));

  const out = scored.slice(0, count).map((entry) => entry.candidate);

  // Pad with alphabetical neighbours so even a category-less item still links
  // outward and stays part of the crawlable graph.
  if (out.length < count) {
    const taken = new Set([item.id, ...out.map((entry) => entry.id)]);
    for (const candidate of indexableItems()) {
      if (out.length >= count) break;
      if (taken.has(candidate.id)) continue;
      out.push(candidate);
      taken.add(candidate.id);
    }
  }

  return out;
}
