import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Dataset } from '../lib/sources/types';

/**
 * Prints a few complete items from the built dataset.
 *
 * Stats tell you the shape of a run; this tells you whether the content is
 * actually any good. Read it after the first live fetch of a new source —
 * a summary that reads like a template, or facts that are all null, shows up
 * here and nowhere else.
 *
 *   npm run data:sample -- 5
 */

const DATASET = join(process.cwd(), 'data', 'datasets', 'dataset.json');

async function main(): Promise<void> {
  const count = Number(process.argv[2] ?? 3);
  const dataset = JSON.parse(await readFile(DATASET, 'utf8')) as Dataset;

  const out: string[] = [];
  out.push(`Source ${dataset.sourceId}${dataset.isFixture ? '  [SYNTHETIC FIXTURES]' : '  [LIVE]'}`);
  out.push(`Generated ${dataset.generatedAt}`);
  out.push(`${'='.repeat(72)}`);

  // Sample across the dataset rather than the head, so we do not only ever
  // look at whatever the upstream API happens to rank first.
  const step = Math.max(1, Math.floor(dataset.items.length / count));

  for (let i = 0; i < count * step && i < dataset.items.length; i += step) {
    const item = dataset.items[i]!;
    out.push('');
    out.push(`### ${item.title}`);
    out.push(`slug:    /p/${item.slug}/`);
    out.push(`indexed: ${item.offers.length > 0 ? 'yes' : 'NO (noindex)'}`);
    out.push(`summary: ${item.summary}`);
    out.push(`categories: ${item.categories.join(', ') || '(none)'}`);
    out.push('facts:');
    for (const fact of item.facts) {
      out.push(`  - ${fact.label}: ${fact.value}${fact.unit ? ` ${fact.unit}` : ''}`);
    }
    out.push(`offers (${item.offers.length}):`);
    for (const offer of item.offers.slice(0, 6)) {
      const price = offer.price === null ? 'no price' : `$${offer.price.toFixed(2)}`;
      const discount = offer.discountPercent ? ` (-${offer.discountPercent}%)` : '';
      out.push(`  - ${offer.merchant.padEnd(20)} ${price}${discount}  ${offer.url}`);
    }
  }

  out.push('');
  out.push(`${'='.repeat(72)}`);
  out.push('Collections:');
  for (const collection of dataset.collections) {
    out.push(`  /best/${collection.slug}/  "${collection.title}"  ${collection.itemIds.length} items`);
  }

  if (dataset.suppressed.length > 0) {
    out.push('');
    out.push(`Suppressed (${dataset.suppressed.length}), first 10:`);
    for (const entry of dataset.suppressed.slice(0, 10)) {
      out.push(`  ${entry.title} — ${entry.reasons.join('; ')}`);
    }
  }

  process.stdout.write(`${out.join('\n')}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`sample failed: ${String(error)}\n`);
  process.exitCode = 1;
});
