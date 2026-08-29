import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { discoverProspects, type Prospect } from '../discover/overpass';
import { writeProspects } from '../discover/prospect-file';
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

  let seen: string[] = [];
  try {
    seen = parseSeen(await readFile(seenFile, 'utf8'));
    log(`Ledger: ${seen.length} businesses already handled.`);
  } catch {
    log('No ledger yet — everything found will be new.');
  }

  // The whole record, not just the URL.
  //
  // This used to keep `p.website` and drop everything else, which quietly cost
  // two things: `npm run emails` had no prospects.json to fill in, and the
  // artifact this run uploads promises a prospects.csv that nothing ever
  // wrote. The names and phone numbers OpenStreetMap did supply were thrown
  // away at the same time.
  const found: Prospect[] = [];
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
        for (const p of prospects) found.push(p);
      } catch (error) {
        const why = error instanceof Error ? error.message.split('\n')[0] : String(error);
        log(`  ${trade.padEnd(13)} ${area.padEnd(14)} failed — ${why}`);
        failures.push(`${trade} in ${area}`);
      }
    }
  }

  const foundSites = found.map((p) => p.website);
  const { fresh, skipped } = excludeSeen(foundSites, seen);

  // excludeSeen also de-duplicates within the batch — OSM lists a chain once
  // per branch — so the records are selected by the URLs it kept rather than
  // filtered again here, which would let the two disagree.
  const freshSet = new Set(fresh);
  const freshProspects: Prospect[] = [];
  for (const p of found) {
    if (freshSet.delete(p.website)) freshProspects.push(p);
  }

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
  await writeProspects(freshProspects, [
    '# Region sweep',
    `# ${TRADES.join(', ')} across ${AREAS.length} areas`,
    `# ${freshProspects.length} new, ${freshProspects.filter((p) => p.email).length} with an email from OpenStreetMap.`,
    '',
  ]);
  await writeFile(
    seenFile,
    `# Businesses already discovered. One host per line.\n# Never pruned: a business dropped from here gets approached twice.\n${mergeSeen(seen, foundSites).join('\n')}\n`,
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
