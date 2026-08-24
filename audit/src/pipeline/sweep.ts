import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { CATEGORIES } from '../discover/categories';
import { discoverProspects } from '../discover/overpass';
import { loadEnv } from '../lib/env';
import { AREAS, excludeSeen, mergeSeen, parseSeen, TRADES } from '../outreach/rotation';

loadEnv();

/**
 * Every town, every trade, one pass.
 *
 *   npm run sweep -- --seen ../seen-hosts.txt --limit 40
 *
 * The scheduled job works one town a day, which is the right shape for a
 * steady supply. This is the other thing you sometimes want: the whole region
 * at once, to see how large the market actually is.
 *
 * Two things it is careful about, both because the data is free and the
 * servers belong to other people:
 *
 * Overpass is a volunteer-run public API with no key and no bill. Forty-two
 * queries fired back to back is the behaviour that gets an IP range blocked
 * for everyone, so there is a deliberate pause between them. It makes the run
 * slower and that is the entire point.
 *
 * A failed area does not end the sweep. One town's name failing to resolve, or
 * one query timing out, should cost that town rather than the other thirteen.
 */

const OUT = join(process.cwd(), 'out');

/** Long enough to be a good neighbour on a free service. */
const PAUSE_MS = 4_000;

function log(line = ''): void {
  process.stdout.write(`${line}\n`);
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const limitRaw = arg('--limit');
  const limit = limitRaw === null ? 40 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new Error('--limit must be a whole number from 1 to 200');
  }
  const seenFile = arg('--seen') ?? join(OUT, 'seen-hosts.txt');

  // Checked before a single query goes out. An unknown category is not an
  // error at the Overpass layer — it just matches nothing — so without this
  // the run makes its full complement of requests, reports success, and
  // returns almost nothing. That is exactly what happened the first time.
  const ids = new Set(CATEGORIES.map((c) => c.id));
  const unknown = TRADES.filter((t) => !ids.has(t));
  if (unknown.length > 0) {
    throw new Error(
      `Not real categories: ${unknown.join(', ')}\n\n` +
        `An unknown category returns no results rather than failing, so this\n` +
        `would have been 42 queries and a cheerful empty answer.\n\n` +
        `Valid ids:\n  ${CATEGORIES.map((c) => c.id).join(', ')}\n`,
    );
  }

  let seen: string[] = [];
  try {
    seen = parseSeen(await readFile(seenFile, 'utf8'));
    log(`Ledger: ${seen.length} businesses already handled.`);
  } catch {
    log('No ledger yet — everything found will be new.');
  }

  const found: string[] = [];
  const failures: string[] = [];
  let queries = 0;

  for (const trade of TRADES) {
    for (const area of AREAS) {
      if (queries > 0) await wait(PAUSE_MS);
      queries += 1;

      try {
        const prospects = await discoverProspects({
          category: trade,
          area,
          country: 'US',
          limit,
          // Discovery's own commentary would bury the sweep's; one line per
          // area is what makes a 42-query run readable.
          log: () => {},
        });
        const withEmail = prospects.filter((p) => p.email).length;
        log(
          `  ${trade.padEnd(13)} ${area.padEnd(14)} ${String(prospects.length).padStart(3)} found · ${withEmail} with an email`,
        );
        for (const p of prospects) found.push(p.website);
      } catch (error) {
        const why = error instanceof Error ? error.message.split('\n')[0] : String(error);
        log(`  ${trade.padEnd(13)} ${area.padEnd(14)} failed — ${why}`);
        failures.push(`${trade} in ${area}`);
      }
    }
  }

  const { fresh, skipped } = excludeSeen(found, seen);

  log('');
  log(`${queries} queries · ${found.length} listings · ${skipped} duplicate or already handled`);
  log(`${fresh.length} new businesses to audit`);
  if (failures.length > 0) {
    // Named rather than summarised: a silently missing town looks identical to
    // a town with no dentists in it.
    log('');
    log(`${failures.length} area(s) failed and were skipped:`);
    for (const f of failures) log(`  ${f}`);
  }

  await mkdir(OUT, { recursive: true });
  await writeFile(
    join(OUT, 'prospects.txt'),
    `${['# Region sweep', `# ${TRADES.join(', ')} across ${AREAS.length} areas`, '', ...fresh].join('\n')}\n`,
    'utf8',
  );
  await writeFile(
    seenFile,
    `# Businesses already discovered. One host per line.\n# Never pruned: a business dropped from here gets approached twice.\n${mergeSeen(seen, found).join('\n')}\n`,
    'utf8',
  );

  if (fresh.length === 0) {
    log('');
    log('Nothing new anywhere. The region is covered.');
    process.exitCode = 3;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`\nsweep failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
