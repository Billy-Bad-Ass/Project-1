import { suppressionKey } from './suppression';

/**
 * Which town and trade a scheduled run should work on.
 *
 * A scheduled job that always asks for dentists in Fairfax rediscovers the
 * same forty businesses twice a day forever. Rotation is what turns a cron
 * entry into a supply of new prospects.
 *
 * Deterministic rather than random, and derived from the calendar rather than
 * from stored state: the same day always produces the same target, so a re-run
 * after a failure repeats the run it was retrying instead of skipping ahead and
 * quietly leaving a town unvisited.
 */

export interface Target {
  what: string;
  where: string;
  country: string;
}

/**
 * Northern Virginia, ordered roughly by how many independent practices each
 * has. Every one is a distinct OpenStreetMap area — the list deliberately
 * avoids "Fairfax County", which collides with the city of Fairfax at the same
 * admin level and is the ambiguity that sent an earlier run to Tennessee.
 */
export const AREAS: readonly string[] = [
  'Fairfax',
  'Arlington',
  'Alexandria',
  'Reston',
  'Vienna',
  'Herndon',
  'Falls Church',
  'McLean',
  'Annandale',
  'Springfield',
  'Centreville',
  'Chantilly',
  'Burke',
  'Manassas',
];

/**
 * Trades that plausibly have a website, money, and nobody in-house to fix it.
 *
 * Deliberately short. Widening the trade list before the first sale would be
 * guessing at which market responds; the town list is the axis worth rotating
 * until there is evidence.
 */
/**
 * The trades worked, as the *canonical category ids* from `discover/categories`.
 *
 * They were English words once — 'veterinarian' and 'law-firm' — and neither
 * resolved. Every scheduled run landing on one died at the first step with
 * "Unknown business type", which is 28 days out of every 42. Nothing caught it
 * because the only test asserted the rotation returned something from this
 * list, which it faithfully did.
 *
 * The ids belong here rather than prose. `rotation.test.ts` now resolves every
 * one of them against the real category list, so a trade that does not exist
 * fails a test rather than a Tuesday.
 */
export const TRADES: readonly string[] = ['dentist', 'vet', 'solicitor'];

/**
 * Days since the epoch, from a date. The unit of rotation.
 *
 * Two runs on the same day get the same target on purpose — the morning run
 * finds the town's businesses, and the afternoon one finds anything the
 * morning missed rather than starting somewhere unrelated.
 */
export function dayIndex(now: Date): number {
  return Math.floor(now.getTime() / 86_400_000);
}

export function targetFor(now: Date, areas = AREAS, trades = TRADES): Target {
  if (areas.length === 0 || trades.length === 0) {
    throw new Error('rotation needs at least one area and one trade');
  }
  const day = dayIndex(now);
  // The trade advances only after a full pass of the towns, so each trade gets
  // the whole region before the next one starts.
  return {
    what: trades[Math.floor(day / areas.length) % trades.length]!,
    where: areas[day % areas.length]!,
    country: 'US',
  };
}

/**
 * Drops websites already seen on an earlier run.
 *
 * Without this the job re-audits the same businesses every cycle: the artifact
 * looks busy, the shortlist looks full, and none of it is new. Matching is on
 * the normalised host, the same identity the suppression list uses, so
 * `https://www.acme.com/` and `acme.com` are recognised as one business.
 */
export function excludeSeen(
  websites: readonly string[],
  seen: Iterable<string>,
): { fresh: string[]; skipped: number } {
  const known = new Set<string>();
  for (const entry of seen) {
    const key = suppressionKey(entry);
    if (key !== '') known.add(key);
  }

  const fresh: string[] = [];
  let skipped = 0;
  // Deduplicates within the batch too: OpenStreetMap lists chains once per
  // branch, and each branch carries the same website.
  const inBatch = new Set<string>();

  for (const site of websites) {
    const key = suppressionKey(site);
    if (key === '') continue;
    if (known.has(key) || inBatch.has(key)) {
      skipped += 1;
      continue;
    }
    inBatch.add(key);
    fresh.push(site);
  }

  return { fresh, skipped };
}

/** Parses a seen-hosts file: one host per line, `#` comments allowed. */
export function parseSeen(contents: string): string[] {
  return contents
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => suppressionKey(line))
    .filter((key) => key !== '');
}

/**
 * The updated ledger: everything previously seen plus this run's hosts.
 *
 * Sorted and de-duplicated so the file's diff between runs is the new entries
 * and nothing else — a ledger that reshuffles every night is one nobody can
 * read the history of.
 */
export function mergeSeen(previous: Iterable<string>, added: Iterable<string>): string[] {
  const all = new Set<string>();
  for (const group of [previous, added]) {
    for (const entry of group) {
      const key = suppressionKey(entry);
      if (key !== '') all.add(key);
    }
  }
  return [...all].sort();
}
