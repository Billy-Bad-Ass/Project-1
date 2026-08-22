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

/* ----- unset repo variables arrive as empty strings, not undefined ----- */

test('an empty base path is treated as unset', () => {
  // CI passes an unconfigured repository variable as '', so the fallback has
  // to trigger on empty, not just on undefined.
  assert.equal(normaliseBasePath(''), '');
});

test('readEnv treats empty and whitespace values as unset', async () => {
  const { readEnv } = await import('@config/site.config');

  process.env.PSEO_TEST_VAR = '';
  assert.equal(readEnv('PSEO_TEST_VAR'), undefined);

  process.env.PSEO_TEST_VAR = '   ';
  assert.equal(readEnv('PSEO_TEST_VAR'), undefined);

  process.env.PSEO_TEST_VAR = ' cheapshark ';
  assert.equal(readEnv('PSEO_TEST_VAR'), 'cheapshark');

  delete process.env.PSEO_TEST_VAR;
  assert.equal(readEnv('PSEO_TEST_VAR'), undefined);
});
