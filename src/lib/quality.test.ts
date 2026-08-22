import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  DUPLICATE_SHAPE_LIMIT,
  fingerprint,
  measureDiversity,
  runQualityGate,
  skeleton,
} from './quality';
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

/* ------------------------- template diversity ------------------------- */

test('skeleton strips the title and every fact value, leaving only phrasing', () => {
  const item = makeItem({
    title: 'Half-Life 2',
    summary: 'Half-Life 2 is cheapest at Steam for $2.49, compared across 4 stores.',
    facts: [
      { label: 'Cheapest store right now', value: 'Steam' },
      { label: 'Best current price', value: '$2.49' },
      { label: 'Stores compared', value: 4 },
      { label: 'Regular price', value: '$9.99' },
    ],
  });
  assert.equal(skeleton(item), 'is cheapest at for compared across stores');
});

test('two items phrased identically share a skeleton despite different values', () => {
  const a = makeItem({
    title: 'Doom',
    summary: 'Doom is cheapest at Steam for $2.49, compared across 4 stores.',
    facts: [
      { label: 'Cheapest store right now', value: 'Steam' },
      { label: 'Best current price', value: '$2.49' },
      { label: 'Stores compared', value: 4 },
      { label: 'Regular price', value: '$9.99' },
    ],
  });
  const b = makeItem({
    title: 'Quake',
    summary: 'Quake is cheapest at GOG for $11.00, compared across 9 stores.',
    facts: [
      { label: 'Cheapest store right now', value: 'GOG' },
      { label: 'Best current price', value: '$11.00' },
      { label: 'Stores compared', value: 9 },
      { label: 'Regular price', value: '$30.00' },
    ],
  });
  assert.equal(skeleton(a), skeleton(b));
});

test('diversity warns when one phrasing dominates a large catalogue', () => {
  // The real failure this was built for: 139 live Open Library pages that
  // differed only in their substituted values.
  const items = Array.from({ length: 40 }, (_, i) =>
    makeItem({
      id: `id-${i}`,
      slug: `slug-${i}`,
      title: `Book ${i}`,
      summary: `Book ${i} by Author ${i}, first published in ${1900 + i}. It runs about ${100 + i} pages.`,
      facts: [
        { label: 'Author', value: `Author ${i}` },
        { label: 'First published', value: 1900 + i },
        { label: 'Length', value: 100 + i },
        { label: 'ISBN', value: `978000000${i}` },
      ],
    }),
  );

  const report = measureDiversity(items);
  assert.equal(report.distinct, 1);
  assert.equal(report.concentration, 1);
  assert.equal(report.warn, true);
});

test('diversity does not warn when the adapter genuinely branches', () => {
  const items = Array.from({ length: 40 }, (_, i) =>
    makeItem({
      id: `id-${i}`,
      slug: `slug-${i}`,
      title: `Book ${i}`,
      summary:
        i % 3 === 0
          ? `Book ${i} is cheapest at Steam right now.`
          : i % 3 === 1
            ? `Book ${i} has not been listed by any store for months.`
            : `Book ${i} is at its lowest recorded price today.`,
      facts: [
        { label: 'A', value: `Author ${i}` },
        { label: 'B', value: 1900 + i },
        { label: 'C', value: 100 + i },
        { label: 'D', value: `x${i}` },
      ],
    }),
  );

  const report = measureDiversity(items);
  assert.equal(report.distinct, 3);
  assert.ok(report.concentration < 0.6);
  assert.equal(report.warn, false);
});

test('diversity does not warn on a catalogue too small to judge', () => {
  const items = Array.from({ length: 5 }, (_, i) =>
    makeItem({ id: `id-${i}`, slug: `slug-${i}`, summary: 'Identical phrasing throughout here.' }),
  );
  assert.equal(measureDiversity(items).warn, false);
});

/** Distinct words, so titles do not collide once digits are masked. */
const NAMES = [
  'Aurora', 'Basalt', 'Cinder', 'Dovetail', 'Ember', 'Fathom', 'Gossamer', 'Harrow',
  'Ivory', 'Juniper', 'Kestrel', 'Lantern', 'Marrow', 'Nocturne', 'Opal', 'Pallid',
  'Quarry', 'Rivet', 'Solace', 'Tally', 'Umber', 'Vellum', 'Willow', 'Xenon',
  'Yarrow', 'Zephyr', 'Alcove', 'Bramble', 'Cobalt', 'Drift', 'Elm', 'Fable',
  'Grotto', 'Hollow', 'Inlet', 'Jetty', 'Kiln', 'Loft', 'Mesa', 'Nook',
];

test('the gate reports diversity without gating on it', () => {
  // Fully templated phrasing, but each page has a distinct title, real facts
  // and a live offer, so all of them publish. Repetitive phrasing is a warning
  // for a human to act on, never a verdict the gate imposes by itself.
  const items = NAMES.map((name, i) =>
    makeItem({
      id: `id-${i}`,
      slug: `slug-${i}`,
      title: name,
      summary:
        `${name} by ${name} Studio, first published in ${1990 + i}. A typical playthrough ` +
        `runs about ${80 + i} hours according to player-submitted completion times.`,
      facts: [
        { label: 'Studio', value: `${name} Studio` },
        { label: 'Year', value: 1990 + i },
        { label: 'Hours', value: 80 + i },
        { label: 'Id', value: `g${i}` },
      ],
    }),
  );

  const report = runQualityGate(items);
  assert.equal(report.published.length, NAMES.length);
  assert.equal(report.noindexed.length, 0);
  assert.equal(report.diversity.warn, true);
});

test('near-duplicate titles differing only by a digit are caught', () => {
  // "Volume 1", "Volume 2"... collapse to one fingerprint once digits are
  // masked, which is exactly the near-duplicate case the rule is for.
  const items = Array.from({ length: DUPLICATE_SHAPE_LIMIT + 5 }, (_, i) =>
    makeItem({
      id: `id-${i}`,
      slug: `slug-${i}`,
      title: `Volume ${i}`,
      summary:
        `Volume ${i} is cheapest at Steam for $${i}.99, compared across ${i} stores. ` +
        `That is well below its usual list price at every retailer we track.`,
    }),
  );

  const report = runQualityGate(items);
  assert.equal(report.published.length, 0);
  assert.equal(report.noindexed.length, items.length);
});
