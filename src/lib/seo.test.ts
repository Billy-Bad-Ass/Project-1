import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { normaliseBasePath } from '@config/site.config';

/**
 * basePath handling is the difference between a working deploy and a site
 * where every link and stylesheet 404s, and it is invisible locally — the
 * root-domain build looks identical. Hence these.
 */

test('an unset base path means a root domain', () => {
  assert.equal(normaliseBasePath(undefined), '');
  assert.equal(normaliseBasePath(''), '');
  assert.equal(normaliseBasePath('   '), '');
  // A lone slash is a root domain, not a sub-directory called "".
  assert.equal(normaliseBasePath('/'), '');
});

test('a missing leading slash is added', () => {
  assert.equal(normaliseBasePath('Project-1'), '/Project-1');
});

test('a trailing slash is removed so paths do not double up', () => {
  // Without this, canonical() would emit https://host/Project-1//browse/.
  assert.equal(normaliseBasePath('/Project-1/'), '/Project-1');
  assert.equal(normaliseBasePath('Project-1///'), '/Project-1');
});

test('a nested base path is preserved', () => {
  assert.equal(normaliseBasePath('/a/b'), '/a/b');
});
