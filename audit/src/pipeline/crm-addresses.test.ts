import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseCsv, planUpdates, siteKey } from './crm-addresses';

/**
 * The two ways this can silently do nothing: a CSV parsed into the wrong
 * columns, and a join key that never matches. Both report a cheerful zero
 * rather than an error, so both are tested against the real shapes.
 */

const CSV = `name,website,email,phone,street,town,postcode,osm
All Heart Dental Care,https://www.allheartdentalcare.com/,hello@example.com,+1 703 555 0101,1 Main St,Arlington,22201,node/1
Macalik DDS,https://macalikdds.com/,,+1 703 555 0102,2 Oak Ave,Fairfax,22030,node/2
"Britton, Brian DDS",https://www.drbrianbritton.com,office@example.com,,3 Elm Rd,Alexandria,22301,node/3
Del Ray Smiles,http://4delraysmiles.com/,smiles@example.com,+1 703 555 0104,4 Ash Ln,Alexandria,22305,node/4
Nowhere Dental,https://not-in-the-crm.example/,ghost@example.com,,5 Fir St,Reston,20190,node/5
`;

test('a quoted comma does not shift every later column', () => {
  const rows = parseCsv(CSV);
  assert.equal(rows.length, 5);
  const britton = rows[2];
  assert.ok(britton);
  assert.equal(britton.name, 'Britton, Brian DDS');
  assert.equal(britton.email, 'office@example.com');
  assert.equal(britton.phone, '');
});

test('a missing address stays missing rather than becoming the next field', () => {
  const macalik = parseCsv(CSV)[1];
  assert.ok(macalik);
  assert.equal(macalik.email, '');
  assert.equal(macalik.phone, '+1 703 555 0102');
});

test('every shape of the same host is one key', () => {
  const shapes = [
    'https://www.allheartdentalcare.com/',
    'http://allheartdentalcare.com',
    'https://ALLHEARTDENTALCARE.com/find-us/',
    'allheartdentalcare.com',
  ];
  for (const s of shapes) assert.equal(siteKey(s), 'allheartdentalcare.com');
  assert.equal(siteKey(null), '');
});

test('fills blanks, keeps what is there, and counts the rest', () => {
  const plan = planUpdates(parseCsv(CSV), [
    { id: 1, website: 'https://www.allheartdentalcare.com/', email: null },
    { id: 2, website: 'https://macalikdds.com/', email: null },
    { id: 3, website: 'https://www.drbrianbritton.com/', email: null },
    { id: 4, website: 'http://4delraysmiles.com/', email: 'already@there.com' },
  ]);
  assert.equal(plan.fill.length, 2);
  assert.deepEqual(
    plan.fill.map((f) => f.id).sort(),
    ['1', '3'],
  );
  assert.equal(plan.alreadyHad, 1, 'the row that already had one is left alone');
  assert.equal(plan.noMatch, 1, 'the business with no CRM row is counted, not written');
});

test('a row with no address is never counted as unmatched', () => {
  const plan = planUpdates(parseCsv(CSV), [
    { id: 2, website: 'https://macalikdds.com/', email: null },
  ]);
  assert.equal(plan.fill.length, 0, 'the only matching row has no address in the artifact');
  assert.equal(plan.noMatch, 4, 'the four rows that do have an address have no CRM row here');
});
