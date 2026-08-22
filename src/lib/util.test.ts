import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { chunk, discountPercent, slugify, toNumber, uniqueSlug } from './util';

test('slugify normalises accents, punctuation and case', () => {
  assert.equal(slugify('Pokémon: Red & Blue'), 'pokemon-red-blue');
  assert.equal(slugify("Assassin's Creed"), 'assassins-creed');
  assert.equal(slugify('  Doom   Eternal  '), 'doom-eternal');
});

test('slugify never emits leading or trailing dashes', () => {
  assert.equal(slugify('!!! Hello !!!'), 'hello');
  assert.equal(slugify('---'), '');
});

test('slugify truncates without leaving a trailing dash', () => {
  const slug = slugify('a'.repeat(60) + ' ' + 'b'.repeat(60));
  assert.ok(slug.length <= 80);
  assert.doesNotMatch(slug, /-$/);
});

test('uniqueSlug disambiguates collisions deterministically', () => {
  const taken = new Set<string>();
  assert.equal(uniqueSlug('Doom', taken, 'a'), 'doom');
  assert.equal(uniqueSlug('Doom', taken, 'b'), 'doom-2');
  assert.equal(uniqueSlug('Doom', taken, 'c'), 'doom-3');
});

test('uniqueSlug falls back when a title slugifies to nothing', () => {
  const taken = new Set<string>();
  // A title of pure punctuation would otherwise produce an empty path segment.
  assert.equal(uniqueSlug('!!!', taken, 'game-42'), 'game-42');
});

test('discountPercent rejects nonsensical pairs rather than returning junk', () => {
  assert.equal(discountPercent(100, 75), 25);
  assert.equal(discountPercent(0, 0), null);       // no list price
  assert.equal(discountPercent(10, 20), null);     // sale above list
  assert.equal(discountPercent(null, 5), null);
});

test('toNumber accepts API strings but rejects junk', () => {
  assert.equal(toNumber('12.50'), 12.5);
  assert.equal(toNumber(3), 3);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber('abc'), null);
  assert.equal(toNumber(null), null);
  assert.equal(toNumber(Infinity), null);
});

test('chunk splits sitemaps without dropping or duplicating entries', () => {
  const urls = Array.from({ length: 12_003 }, (_, i) => `url-${i}`);
  const chunks = chunk(urls, 5000);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0]!.length, 5000);
  assert.equal(chunks[2]!.length, 2003);
  assert.equal(chunks.flat().length, urls.length);
  assert.deepEqual(chunks.flat(), urls);
});

test('chunk rejects a zero size instead of looping forever', () => {
  assert.throws(() => chunk([1, 2, 3], 0), /positive/);
});
