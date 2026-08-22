import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DUPLICATE_SHAPE_LIMIT, fingerprint, runQualityGate } from './quality';
import type { SourceItem } from './sources/types';

function makeItem(overrides: Partial<SourceItem> = {}): SourceItem {
  return {
    id: overrides.id ?? 'id-1',
    slug: overrides.slug ?? 'slug-1',
    title: overrides.title ?? 'Half-Life 2',
    summary:
      overrides.summary ??
      'Half-Life 2 is cheapest at Steam for $2.49, compared across 4 stores. That is 75% below its $9.99 list price.',
    facts: overrides.facts ?? [
      { label: 'Best current price', value: '$2.49' },
      { label: 'Regular price', value: '$9.99' },
      { label: 'All-time low', value: '$0.98' },
      { label: 'Stores compared', value: 4 },
    ],
    offers: overrides.offers ?? [
      { merchant: 'Steam', url: 'https://store.steampowered.com/app/220', price: 2.49, currency: 'USD' },
    ],
    categories: overrides.categories ?? ['Under $5'],
    image: overrides.image ?? null,
    updatedAt: overrides.updatedAt ?? '2026-08-22T00:00:00.000Z',
    extra: overrides.extra,
    enrichment: overrides.enrichment ?? null,
  };
}

test('a complete item is published', () => {
  const report = runQualityGate([makeItem()]);
  assert.equal(report.published.length, 1);
  assert.equal(report.suppressed.length, 0);
  assert.equal(report.noindexed.length, 0);
});

test('an item with too few facts is suppressed, not published', () => {
  const report = runQualityGate([makeItem({ facts: [{ label: 'Only', value: 1 }] })]);
  assert.equal(report.published.length, 0);
  assert.equal(report.suppressed.length, 1);
  assert.match(report.suppressed[0]!.reasons.join(), /too-few-facts/);
});

test('a thin summary is suppressed', () => {
  const report = runQualityGate([makeItem({ summary: 'Too short.' })]);
  assert.equal(report.suppressed.length, 1);
  assert.match(report.suppressed[0]!.reasons.join(), /thin-summary/);
});

test('an item with no offers is noindexed rather than dropped', () => {
  const report = runQualityGate([makeItem({ offers: [] })]);
  assert.equal(report.published.length, 0);
  assert.equal(report.noindexed.length, 1);
  assert.equal(report.suppressed.length, 0);
});

test('fingerprint ignores numbers so templated pages collide', () => {
  const a = fingerprint('Doom is cheapest at Steam for $2.49, compared across 4 stores.');
  const b = fingerprint('Doom is cheapest at Steam for $19.99, compared across 12 stores.');
  assert.equal(a, b);
});

test('templated pages beyond the duplicate limit are noindexed', () => {
  // Same sentence shape, differing only in numbers: exactly the pattern the
  // rule exists to catch.
  const items = Array.from({ length: DUPLICATE_SHAPE_LIMIT + 5 }, (_, i) =>
    makeItem({
      id: `id-${i}`,
      slug: `slug-${i}`,
      summary: `Game ${i} is cheapest at Steam for $${i}.99, compared across ${i} stores. That is 50% below its $99.99 list price.`,
    }),
  );
  const report = runQualityGate(items);
  assert.equal(report.published.length, 0);
  assert.equal(report.noindexed.length, items.length);
});

test('genuinely varied summaries under the limit all publish', () => {
  const items = Array.from({ length: DUPLICATE_SHAPE_LIMIT + 5 }, (_, i) =>
    makeItem({
      id: `id-${i}`,
      slug: `slug-${i}`,
      summary:
        i % 2 === 0
          ? `Game ${i} is cheapest at Steam for $${i}.99, compared across ${i} stores. That is well below list price.`
          : `Game ${i} has no active store listing we can price right now, though it previously sold for $${i}.99 at retail outlets.`,
    }),
  );
  const report = runQualityGate(items);
  assert.equal(report.noindexed.length, 0);
  assert.equal(report.published.length, items.length);
});

test('suppression takes precedence over noindex', () => {
  const report = runQualityGate([makeItem({ facts: [], offers: [] })]);
  assert.equal(report.suppressed.length, 1);
  assert.equal(report.noindexed.length, 0);
});
