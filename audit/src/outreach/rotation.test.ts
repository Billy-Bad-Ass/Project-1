import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { AREAS, dayIndex, excludeSeen, mergeSeen, parseSeen, targetFor, TRADES } from './rotation';

test('both runs on the same day work the same town', () => {
  // The morning run finds the town's businesses; the afternoon run picks up
  // what it missed. Advancing between them would leave half of every town
  // unvisited and nobody would notice.
  const morning = targetFor(new Date('2026-08-24T05:30:00Z'));
  const evening = targetFor(new Date('2026-08-24T16:30:00Z'));
  assert.deepEqual(morning, evening);
});

test('consecutive days move to the next town', () => {
  const a = targetFor(new Date('2026-08-24T05:30:00Z'));
  const b = targetFor(new Date('2026-08-25T05:30:00Z'));
  assert.notEqual(a.where, b.where);
});

/** The first day of the rotation cycle containing `from`. */
function startOfPass(from: Date): Date {
  const offset = dayIndex(from) % AREAS.length;
  return new Date(from.getTime() - offset * 86_400_000);
}

test('a full pass covers every town before repeating one', () => {
  const start = new Date('2026-08-24T05:30:00Z');
  const seen = new Set<string>();
  for (let i = 0; i < AREAS.length; i += 1) {
    const day = new Date(start.getTime() + i * 86_400_000);
    seen.add(targetFor(day).where);
  }
  assert.equal(seen.size, AREAS.length);
});

test('the trade only advances after a whole pass of the towns', () => {
  // Otherwise the rotation interleaves trades and towns and a given trade
  // never gets a full sweep of the region.
  //
  // The pass starts where the cycle starts, not on an arbitrary date: both the
  // town index and the trade index derive from the absolute day number, so a
  // window opened mid-cycle legitimately crosses a boundary. Aligning here is
  // what makes the assertion about the rotation rather than about the date I
  // happened to pick.
  const start = startOfPass(new Date('2026-08-24T05:30:00Z'));
  const first = targetFor(start).what;
  for (let i = 1; i < AREAS.length; i += 1) {
    const day = new Date(start.getTime() + i * 86_400_000);
    assert.equal(targetFor(day).what, first, `day ${i} changed trade too early`);
  }
  const afterPass = targetFor(new Date(start.getTime() + AREAS.length * 86_400_000));
  assert.notEqual(afterPass.what, first);
});

test('rotation is a pure function of the day, so a retry repeats itself', () => {
  // A failed run re-run an hour later must retry the same target. Deriving the
  // target from stored state would skip a town on every failure.
  const a = targetFor(new Date('2026-08-24T00:00:01Z'));
  const b = targetFor(new Date('2026-08-24T23:59:59Z'));
  assert.deepEqual(a, b);
});

test('every rotation target is a real configured area and trade', () => {
  for (let i = 0; i < AREAS.length * TRADES.length * 2; i += 1) {
    const target = targetFor(new Date(1_800_000_000_000 + i * 86_400_000));
    assert.ok(AREAS.includes(target.where), target.where);
    assert.ok(TRADES.includes(target.what), target.what);
    assert.equal(target.country, 'US');
  }
});

test('an empty rotation list is an error, not a crash later', () => {
  assert.throws(() => targetFor(new Date(), [], TRADES));
  assert.throws(() => targetFor(new Date(), AREAS, []));
});

test('the day index advances exactly once per day', () => {
  const a = dayIndex(new Date('2026-08-24T00:00:00Z'));
  const b = dayIndex(new Date('2026-08-25T00:00:00Z'));
  assert.equal(b - a, 1);
});

// --- deduplication ---------------------------------------------------------

test('businesses seen on an earlier run are dropped', () => {
  // Without this the job re-audits the same sites every cycle: the artifact
  // looks busy, the shortlist looks full, and none of it is new.
  const { fresh, skipped } = excludeSeen(
    ['https://a.com', 'https://b.com', 'https://c.com'],
    ['a.com', 'c.com'],
  );
  assert.deepEqual(fresh, ['https://b.com']);
  assert.equal(skipped, 2);
});

test('a business is recognised however its address was written', () => {
  const { fresh } = excludeSeen(['https://WWW.Acme.com/contact'], ['acme.com']);
  assert.deepEqual(fresh, []);
});

test('a chain listed once per branch is audited once', () => {
  // OpenStreetMap returns a node per location, each carrying the same website.
  const { fresh, skipped } = excludeSeen(
    ['https://chain.com', 'https://www.chain.com/', 'https://chain.com/locations/2'],
    [],
  );
  assert.deepEqual(fresh, ['https://chain.com']);
  assert.equal(skipped, 2);
});

test('nothing seen means nothing dropped', () => {
  const { fresh, skipped } = excludeSeen(['https://a.com', 'https://b.com'], []);
  assert.equal(fresh.length, 2);
  assert.equal(skipped, 0);
});

test('unparseable entries are ignored rather than matching everything', () => {
  // An empty key would normalise to '' and, in a naive implementation, match
  // every candidate — silently emptying the run.
  const { fresh } = excludeSeen(['https://a.com', '   ', ''], ['']);
  assert.deepEqual(fresh, ['https://a.com']);
});

// --- the ledger ------------------------------------------------------------

test('the ledger file tolerates comments and blank lines', () => {
  assert.deepEqual(parseSeen('# header\n\nacme.com\n  b.com  \n'), ['acme.com', 'b.com']);
});

test('merging keeps everything and repeats nothing', () => {
  assert.deepEqual(mergeSeen(['b.com', 'a.com'], ['a.com', 'c.com']), [
    'a.com',
    'b.com',
    'c.com',
  ]);
});

test('the ledger is sorted, so its diff between runs is only what is new', () => {
  // A file that reshuffles every night has an unreadable history, and this one
  // is the record of who has already been approached.
  const merged = mergeSeen(['z.com', 'a.com'], ['m.com']);
  assert.deepEqual(merged, [...merged].sort());
});

test('a round trip through the file format is stable', () => {
  const merged = mergeSeen([], ['https://WWW.Acme.com/x', 'b.com']);
  assert.deepEqual(parseSeen(merged.join('\n')), merged);
});
