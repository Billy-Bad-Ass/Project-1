import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { auditSite, countBySeverity, normaliseUrl } from '../lib/audit';
import { PageFetcher } from '../lib/fetch-page';
import { reportSlug } from '../lib/slug';
import { renderReport } from '../report/render';
import { rankLeads, renderOutreachCsv, renderOutreachMarkdown } from '../report/leads';
import type { SiteAudit } from '../lib/types';

/**
 * Audit a list of sites, write a report for each, and produce a ranked
 * outreach list.
 *
 *   npm run audit -- --list prospects.txt
 *   npm run audit -- --site example.com
 *   npm run audit -- --list prospects.txt --concurrency 3 --no-cache
 *
 * The input list is one site per line; blank lines and lines starting with #
 * are ignored, so you can annotate it.
 */

const OUT = join(process.cwd(), 'out');

interface Args {
  sites: string[];
  listFile: string | null;
  concurrency: number;
  noCache: boolean;
  respectRobots: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i === -1 ? null : (argv[i + 1] ?? null);
  };

  const concurrencyRaw = get('--concurrency');
  const concurrency = concurrencyRaw === null ? 2 : Number(concurrencyRaw);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error('--concurrency must be a whole number from 1 to 8');
  }

  const single = get('--site');
  return {
    sites: single ? [single] : [],
    listFile: get('--list'),
    concurrency,
    noCache: argv.includes('--no-cache'),
    // Present so a site owner auditing their own property can opt out; the
    // default stays polite because most runs are against strangers.
    respectRobots: !argv.includes('--ignore-robots'),
  };
}

async function readList(path: string): Promise<string[]> {
  const raw = await readFile(path, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

const log = (message: string) => process.stdout.write(`${message}\n`);

/** Run tasks with a fixed number in flight, preserving input order. */
async function pool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const targets = [
    ...args.sites,
    ...(args.listFile ? await readList(args.listFile) : []),
  ].map(normaliseUrl);

  if (targets.length === 0) {
    throw new Error(
      'Nothing to audit. Pass --site example.com or --list prospects.txt',
    );
  }

  log(`Auditing ${targets.length} site(s), ${args.concurrency} at a time\n`);

  const fetcher = new PageFetcher({ noCache: args.noCache, log });
  const started = Date.now();

  const audits = await pool(targets, args.concurrency, async (url, index) => {
    const audit = await auditSite(url, {
      fetcher,
      respectRobots: args.respectRobots,
      log,
    });

    const counts = countBySeverity(audit.findings);
    const position = `${String(index + 1).padStart(3)}/${targets.length}`;
    if (audit.error) {
      log(`${position}  ${reportSlug(url).padEnd(34)} skipped — ${audit.error}`);
    } else {
      log(
        `${position}  ${reportSlug(url).padEnd(34)} health ${String(audit.healthScore).padStart(3)}` +
          `  opportunity ${String(audit.opportunityScore).padStart(3)}` +
          `  (${counts.critical} urgent, ${counts.high} important)`,
      );
    }
    return audit;
  });

  await mkdir(join(OUT, 'reports'), { recursive: true });

  const usable = audits.filter((a) => a.error === null);
  for (const audit of usable) {
    await writeFile(
      join(OUT, 'reports', `${reportSlug(audit.finalUrl)}.html`),
      renderReport(audit),
      'utf8',
    );
  }

  const leads = rankLeads(usable);
  await writeFile(join(OUT, 'leads.md'), renderOutreachMarkdown(leads), 'utf8');
  await writeFile(join(OUT, 'leads.csv'), renderOutreachCsv(leads), 'utf8');
  await writeFile(join(OUT, 'audits.json'), JSON.stringify(audits, null, 2), 'utf8');

  summarise(audits, Date.now() - started, fetcher);
}

function summarise(audits: SiteAudit[], elapsedMs: number, fetcher: PageFetcher): void {
  const usable = audits.filter((a) => a.error === null);
  const failed = audits.length - usable.length;

  log('');
  log(`Done in ${(elapsedMs / 1000).toFixed(1)}s`);
  log(`  audited:   ${usable.length}`);
  if (failed > 0) log(`  skipped:   ${failed} (unreachable or robots.txt disallowed)`);
  log(`  requests:  ${fetcher.stats.fetched} fetched, ${fetcher.stats.cached} from cache`);

  if (usable.length > 0) {
    const strong = usable.filter((a) => a.opportunityScore >= 60).length;
    const healthy = usable.filter((a) => a.healthScore >= 80).length;
    log(`  strong leads (opportunity 60+): ${strong}`);
    log(`  already healthy (nothing to sell): ${healthy}`);
  }

  log('');
  log(`  reports:   out/reports/*.html`);
  log(`  outreach:  out/leads.md and out/leads.csv`);
}

main().catch((error: unknown) => {
  process.stderr.write(`\naudit failed: ${String(error)}\n`);
  process.exitCode = 1;
});
