import { strict as assert } from 'node:assert';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { checksHtml, loadTestimonials, ruleCount, testimonialsHtml } from './proof';
import { ALL_RULES } from '../rules/index';

test('the advertised count is the number of checks that actually run', () => {
  // The page used to say "22 things" as typed text. If a rule were removed the
  // claim would quietly become false, on a page taking money.
  assert.equal(ruleCount(), ALL_RULES.length);
});

test('every check appears in the list', () => {
  const html = checksHtml();
  for (const rule of ALL_RULES) {
    assert.ok(
      html.includes(rule.description.replace(/&/g, '&amp;').replace(/</g, '&lt;')),
      `missing: ${rule.description}`,
    );
  }
});

test('the counts on each group add up to the total', () => {
  const html = checksHtml();
  const counts = [...html.matchAll(/<span class="check-count">(\d+)<\/span>/g)].map((m) =>
    Number(m[1]),
  );
  assert.equal(
    counts.reduce((a, b) => a + b, 0),
    ALL_RULES.length,
  );
});

test('with no testimonials the page never implies it has any', () => {
  // The rule that matters most here: a page selling to strangers cannot invent
  // praise, and an empty "what our clients say" heading is worse than saying
  // plainly that the business is new.
  const html = testimonialsHtml([], '$100');
  assert.doesNotMatch(html, /<blockquote/);
  assert.doesNotMatch(html, /what people said/i);
  assert.match(html, /No reviews yet/i);
});

test('the empty state makes a concrete offer, not an excuse', () => {
  const html = testimonialsHtml([], '$100');
  assert.match(html, /free re-check/i);
  assert.match(html, /\$100/);
});

test('the founding offer promises no satisfaction refund', () => {
  // Removed deliberately: the sale is final once written work is delivered.
  // The offer must not quietly reintroduce the promise the policy withdrew.
  const html = testimonialsHtml([], '$100');
  assert.doesNotMatch(html, /refund/i);
  assert.doesNotMatch(html, /money back/i);
});

test('a real testimonial replaces the offer entirely', () => {
  const html = testimonialsHtml(
    [{ quote: 'Fixed the phone thing in an hour.', name: 'Sam', business: 'A Practice' }],
    '$100',
  );
  assert.match(html, /Fixed the phone thing/);
  assert.match(html, /Sam/);
  assert.doesNotMatch(html, /No reviews yet/i);
});

test('testimonial text is escaped', () => {
  const html = testimonialsHtml(
    [{ quote: '<script>alert(1)</script>', name: 'X', business: 'Y' }],
    '$100',
  );
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('a missing testimonials file is the honest empty state, not a crash', () => {
  // "No reviews yet" is the true state of a new business and must not be a
  // build failure.
  return loadTestimonials(join(tmpdir(), 'definitely-absent.json')).then((list) => {
    assert.deepEqual(list, []);
  });
});

test('malformed or half-filled entries are dropped rather than half-rendered', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proof-'));
  const file = join(dir, 'testimonials.json');
  await writeFile(
    file,
    JSON.stringify([
      { quote: 'Real one.', name: 'Sam', business: 'A Practice' },
      { quote: '', name: 'Blank', business: 'B' },
      { name: 'No quote', business: 'C' },
      'not an object',
    ]),
    'utf8',
  );
  const list = await loadTestimonials(file);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.quote, 'Real one.');
});

test('a corrupt file does not take the build down', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proof-'));
  const file = join(dir, 'testimonials.json');
  await writeFile(file, '{ not json', 'utf8');
  assert.deepEqual(await loadTestimonials(file), []);
});
