import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { reportSlug } from './slug';

test('two pages on the same host get different report filenames', () => {
  // The bug this covers: keying on hostname alone silently overwrote one
  // report with another, while the run claimed both had been audited.
  const root = reportSlug('http://127.0.0.1:8099/');
  const sub = reportSlug('http://127.0.0.1:8099/good');
  assert.notEqual(root, sub);
});

test('www is stripped and a trailing slash does not change the name', () => {
  assert.equal(reportSlug('https://www.example.com/'), reportSlug('https://example.com'));
});

test('nested paths are flattened safely', () => {
  assert.equal(reportSlug('https://example.com/a/b/c'), 'example.com-a-b-c');
});

test('unsafe characters never reach the filesystem', () => {
  const slug = reportSlug('https://example.com/a?b=c#d');
  assert.doesNotMatch(slug, /[?#=/\\]/);
});

test('a malformed url still yields a usable filename', () => {
  const slug = reportSlug('not a url');
  assert.ok(slug.length > 0);
  assert.doesNotMatch(slug, /\s/);
});
