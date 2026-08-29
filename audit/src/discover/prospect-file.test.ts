import { strict as assert } from 'node:assert';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Prospect } from './overpass';
import { readProspects, toCsv, writeProspects } from './prospect-file';

const prospect = (over: Partial<Prospect> = {}): Prospect => ({
  name: 'All Heart Dental',
  website: 'https://www.allheartdentalcare.com/',
  email: 'info@allheartdentalcare.com',
  phone: '+1 703 555 0100',
  street: '1 Main St',
  town: 'Arlington',
  postcode: '22201',
  osmId: 'node/1',
  ...over,
});

test('the columns are in the order the dashboard expects', () => {
  // Two writers drifting by one column would not fail anything — it would file
  // every phone number under postcode, and nobody would notice until somebody
  // rang a postcode.
  const [header, row] = toCsv([prospect()]).trim().split('\n');
  assert.equal(header, 'name,website,email,phone,street,town,postcode,osm');
  assert.equal(
    row,
    'All Heart Dental,https://www.allheartdentalcare.com/,info@allheartdentalcare.com,' +
      '+1 703 555 0100,1 Main St,Arlington,22201,node/1',
  );
});

test('a comma in a business name does not shift every later column', () => {
  const row = toCsv([prospect({ name: 'Smith, Jones & Co' })]).trim().split('\n')[1];
  assert.match(row ?? '', /^"Smith, Jones & Co",/);
});

test('a quote in a name is escaped rather than closing the field', () => {
  const row = toCsv([prospect({ name: 'The "Best" Dentist' })]).trim().split('\n')[1];
  assert.match(row ?? '', /^"The ""Best"" Dentist",/);
});

test('a missing address is an empty column, not the word null', () => {
  const row = toCsv([prospect({ email: null, phone: null })]).trim().split('\n')[1];
  assert.equal(row?.split(',')[2], '');
  assert.ok(!row?.includes('null'));
});

test('what is written can be read back unchanged', () => {
  // find writes it, emails reads it, edits it and writes it again. A lossy
  // round trip would silently drop whatever the second pass did not know about.
  return mkdtemp(join(tmpdir(), 'prospects-')).then(async (dir) => {
    const original = [prospect(), prospect({ name: 'Macalik DDS', email: null })];
    // The explicit-directory form, so the test never writes into the repo's
    // own out/ the way a real run does.
    await writeProspects(original, ['# header'], dir);

    assert.deepEqual(await readProspects(dir), original);

    const txt = await readFile(join(dir, 'prospects.txt'), 'utf8');
    assert.equal(txt.split('\n')[0], '# header');
    assert.ok(txt.includes('https://www.allheartdentalcare.com/'));
  });
});
