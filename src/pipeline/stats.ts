import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Dataset } from '../lib/sources/types';

/**
 * Dataset health report.
 *
 * Run after `data:build` to see what the site will actually publish before
 * spending a build on it. The numbers to watch are the suppression reasons: a
 * spike there usually means an upstream API changed shape, not that the
 * catalogue got worse.
 *
 *   npm run data:stats
 */

const DATASET = join(process.cwd(), 'data', 'datasets', 'dataset.json');

function bar(count: number, total: number, width = 32): string {
  if (total === 0) return '';
  return '█'.repeat(Math.max(0, Math.round((count / total) * width)));
}

async function main(): Promise<void> {
  const dataset = JSON.parse(await readFile(DATASET, 'utf8')) as Dataset;

  const indexable = dataset.items.filter((item) => item.offers.length > 0);
  const noindex = dataset.items.length - indexable.length;
  const enriched = dataset.items.filter((item) => item.enrichment).length;

  const withPrice = indexable.filter((item) => item.offers.some((offer) => offer.price !== null));
  const prices = withPrice
    .map((item) => Math.min(...item.offers.filter((o) => o.price !== null).map((o) => o.price!)))
    .sort((a, b) => a - b);

  const median = prices.length > 0 ? prices[Math.floor(prices.length / 2)]! : 0;
  const factCounts = dataset.items.map((item) => item.facts.length);
  const avgFacts =
    factCounts.length > 0 ? factCounts.reduce((a, b) => a + b, 0) / factCounts.length : 0;

  const out: string[] = [];
  out.push(`Source:        ${dataset.sourceId}${dataset.isFixture ? '  (SYNTHETIC FIXTURE DATA)' : ''}`);
  out.push(`Generated:     ${dataset.generatedAt}`);
  out.push('');
  out.push(`Pages total:   ${dataset.items.length}`);
  out.push(`  indexable:   ${indexable.length}`);
  out.push(`  noindex:     ${noindex}`);
  out.push(`  suppressed:  ${dataset.suppressed.length} (not built at all)`);
  out.push(`Collections:   ${dataset.collections.length}`);
  out.push(`Enriched:      ${enriched}`);
  out.push('');
  out.push(`Avg facts/page: ${avgFacts.toFixed(1)}`);
  out.push(`Median best price: $${median.toFixed(2)}`);
  out.push('');

  if (dataset.suppressed.length > 0) {
    const reasons = new Map<string, number>();
    for (const entry of dataset.suppressed) {
      for (const reason of entry.reasons) {
        const rule = reason.split(':')[0] ?? 'unknown';
        reasons.set(rule, (reasons.get(rule) ?? 0) + 1);
      }
    }
    out.push('Suppression reasons:');
    for (const [rule, count] of [...reasons].sort((a, b) => b[1] - a[1])) {
      out.push(`  ${rule.padEnd(18)} ${String(count).padStart(5)} ${bar(count, dataset.items.length)}`);
    }
    out.push('');
  }

  const offerCounts = new Map<number, number>();
  for (const item of dataset.items) {
    const bucket = Math.min(item.offers.length, 6);
    offerCounts.set(bucket, (offerCounts.get(bucket) ?? 0) + 1);
  }
  out.push('Offers per page:');
  for (const bucket of [...offerCounts.keys()].sort((a, b) => a - b)) {
    const label = bucket === 6 ? '6+' : String(bucket);
    const count = offerCounts.get(bucket)!;
    out.push(`  ${label.padStart(2)} store(s)  ${String(count).padStart(5)} ${bar(count, dataset.items.length)}`);
  }

  process.stdout.write(`${out.join('\n')}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`stats failed: ${String(error)}\n`);
  process.exitCode = 1;
});
