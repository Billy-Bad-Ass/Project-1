import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { GUIDE, guideHtml } from './guide';
import { ALL_RULES } from '../rules/index';

test('every check that runs has a guide entry', () => {
  // A guide missing a check is read as "we do not look at that", on a page
  // that takes money for looking at exactly that.
  const missing = ALL_RULES.filter((r) => !GUIDE[r.id]).map((r) => r.id);
  assert.deepEqual(missing, [], `no guide entry for: ${missing.join(', ')}`);
});

test('no guide entry describes a check that no longer runs', () => {
  // The other direction, which is the one that rots silently: a rule gets
  // removed and the page keeps promising it.
  const ids = new Set(ALL_RULES.map((r) => r.id));
  const orphans = Object.keys(GUIDE).filter((id) => !ids.has(id));
  assert.deepEqual(orphans, [], `guide describes checks that do not exist: ${orphans.join(', ')}`);
});

test('every entry actually explains something', () => {
  for (const [id, entry] of Object.entries(GUIDE)) {
    assert.ok(entry.problem.length > 12, `${id}: problem too thin`);
    assert.ok(entry.means.length > 40, `${id}: does not say what it costs`);
    assert.ok(entry.fix.length > 25, `${id}: does not say what fixing means`);
  }
});

test('no entry leans on jargon the reader would have to look up', () => {
  // The whole product is "plain English". A guide that says "add a canonical
  // tag to resolve duplicate URI normalisation" fails at the one job it has.
  const jargon = /\b(canonical tag|meta tag|DOM|viewport meta|H1|alt attribute|JSON-LD|SSL|TLS|CDN|minif)/i;
  for (const [id, entry] of Object.entries(GUIDE)) {
    const prose = `${entry.problem} ${entry.means} ${entry.fix}`;
    assert.doesNotMatch(prose, jargon, `${id} uses jargon`);
  }
});

test('the rendered guide covers every category', () => {
  const html = guideHtml();
  for (const label of [
    'Turning visitors into customers',
    'Being found',
    'Trust and safety',
    'Speed',
    'Access for everyone',
    'Technical',
  ]) {
    assert.ok(html.includes(label), `missing group: ${label}`);
  }
});

test('the rendered guide contains one entry per check', () => {
  const html = guideHtml();
  const items = html.match(/<details class="g-item">/g) ?? [];
  assert.equal(items.length, ALL_RULES.length);
});

test('each entry shows effort and who can do it', () => {
  // The reason those columns exist: "add structured data" tells a practice
  // owner nothing about whether to phone their web person.
  const html = guideHtml();
  assert.equal((html.match(/class="g-effort/g) ?? []).length, ALL_RULES.length);
  assert.equal((html.match(/class="g-who"/g) ?? []).length, ALL_RULES.length);
});

test('guide text is escaped', () => {
  const html = guideHtml();
  assert.doesNotMatch(html, /<script/i);
});

test('the most expensive problem is in the first group', () => {
  // Ordering is a claim about what matters. Contact method was the single most
  // common finding across the live Fairfax run, and it is the one that costs a
  // booking directly, so it must not be buried under Technical.
  const html = guideHtml();
  const conversion = html.indexOf('Turning visitors into customers');
  const technical = html.indexOf('Technical');
  assert.ok(conversion >= 0 && conversion < technical);
  assert.ok(html.includes(GUIDE['contact-method']!.problem));
});
