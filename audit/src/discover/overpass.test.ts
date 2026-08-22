import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildQuery, discoverProspects, normaliseWebsite, parseElements } from './overpass';
import { findCategory } from './categories';

/* ---------------------- messy real-world website tags ---------------------- */

test('a bare domain becomes an auditable https url', () => {
  assert.equal(normaliseWebsite('acmeplumbing.co.uk'), 'https://acmeplumbing.co.uk/');
  assert.equal(normaliseWebsite('www.acmeplumbing.co.uk'), 'https://www.acmeplumbing.co.uk/');
});

test('an explicit scheme is respected', () => {
  assert.equal(normaliseWebsite('http://old-site.com/'), 'http://old-site.com/');
});

test('a social page is rejected rather than audited', () => {
  // Auditing one produces a report about Facebook's markup, not the business.
  for (const url of [
    'https://facebook.com/acmeplumbing',
    'https://www.instagram.com/acme',
    'https://linktr.ee/acme',
    'https://wa.me/441234567890',
  ]) {
    assert.equal(normaliseWebsite(url), null, `should reject ${url}`);
  }
});

test('a lookalike domain is not mistaken for a social site', () => {
  assert.notEqual(normaliseWebsite('https://facebook-marketing-agency.co.uk'), null);
});

test('multiple values in one tag take the first', () => {
  // OSM tags are hand-entered; semicolons and commas both appear.
  assert.equal(normaliseWebsite('acme.co.uk; old.acme.co.uk'), 'https://acme.co.uk/');
});

test('junk yields null instead of a broken audit target', () => {
  for (const junk of ['', '   ', 'n/a', null]) {
    assert.equal(normaliseWebsite(junk as string | null), null, `should reject "${junk}"`);
  }
});

/* ---------------------------- parsing results ---------------------------- */

const element = (id: number, tags: Record<string, string>) => ({ type: 'node', id, tags });

test('name, website, phone and address are extracted', () => {
  const prospects = parseElements({
    elements: [
      element(1, {
        name: 'Acme Plumbing',
        website: 'acmeplumbing.co.uk',
        phone: '0113 200 0000',
        'addr:street': '1 High Street',
        'addr:city': 'Leeds',
        'addr:postcode': 'LS1 1AA',
      }),
    ],
  });

  assert.equal(prospects.length, 1);
  const p = prospects[0]!;
  assert.equal(p.name, 'Acme Plumbing');
  assert.equal(p.website, 'https://acmeplumbing.co.uk/');
  assert.equal(p.phone, '0113 200 0000');
  assert.equal(p.town, 'Leeds');
  assert.equal(p.osmId, 'node/1');
});

test('a chain mapped as many branches is audited once', () => {
  // Twenty branches of one chain would otherwise mean twenty identical audits
  // and twenty identical emails to the same owner.
  const prospects = parseElements({
    elements: [
      element(1, { name: 'BigChain Leeds', website: 'https://bigchain.co.uk' }),
      element(2, { name: 'BigChain Bradford', website: 'https://www.bigchain.co.uk/bradford' }),
      element(3, { name: 'BigChain York', website: 'http://bigchain.co.uk/york' }),
      element(4, { name: 'Independent Ltd', website: 'https://independent.co.uk' }),
    ],
  });

  assert.equal(prospects.length, 2);
  assert.deepEqual(prospects.map((p) => p.name), ['BigChain Leeds', 'Independent Ltd']);
});

test('entries without a name or a usable website are dropped', () => {
  const prospects = parseElements({
    elements: [
      element(1, { website: 'https://noname.com' }),
      element(2, { name: 'No Website Ltd' }),
      element(3, { name: 'Social Only', website: 'https://facebook.com/x' }),
      element(4, { name: 'Good One', website: 'https://good.co.uk' }),
    ],
  });
  assert.deepEqual(prospects.map((p) => p.name), ['Good One']);
});

test('a malformed response yields an empty list rather than throwing', () => {
  assert.deepEqual(parseElements(null), []);
  assert.deepEqual(parseElements({}), []);
  assert.deepEqual(parseElements({ elements: 'nope' }), []);
});

test('contact: prefixed tags are read as fallbacks', () => {
  const prospects = parseElements({
    elements: [element(1, { name: 'Acme', 'contact:website': 'acme.com', 'contact:phone': '123' })],
  });
  assert.equal(prospects[0]?.website, 'https://acme.com/');
  assert.equal(prospects[0]?.phone, '123');
});

/* ---------------------------- query building ---------------------------- */

test('the query filters server-side to businesses that have a website', () => {
  // Without this we download the majority that have none and discard them.
  const query = buildQuery(findCategory('dentist')!, 'Bristol', 50);
  assert.match(query, /\["website"\]/);
  assert.match(query, /"name"="Bristol"/);
  assert.match(query, /amenity"="dentist/);
  assert.match(query, /out center 50;/);
});

test('nodes, ways and relations are all searched', () => {
  // A business may be mapped as a point or as a building outline.
  const query = buildQuery(findCategory('plumber')!, 'Leeds', 10);
  for (const kind of ['node', 'way', 'relation']) {
    assert.match(query, new RegExp(`${kind}\\["craft"\\]?`.replace('\\]?', '')), `missing ${kind}`);
  }
});

test('quotes in an area name cannot break out of the query', () => {
  const query = buildQuery(findCategory('cafe')!, 'King"s Lynn', 10);
  assert.doesNotMatch(query, /name"="King"s/);
});

/* ---------------------------- category lookup ---------------------------- */

test('plurals and labels both resolve', () => {
  assert.equal(findCategory('dentists')?.id, 'dentist');
  assert.equal(findCategory('Dentist')?.id, 'dentist');
  assert.equal(findCategory('plumbers')?.id, 'plumber');
  assert.equal(findCategory('nonsense-trade'), null);
});

/* ---------------------------- network behaviour ---------------------------- */

test('rate limiting explains itself instead of retrying blindly', async () => {
  const fetchImpl = (async () =>
    new Response('', { status: 429 })) as unknown as typeof fetch;

  await assert.rejects(
    () => discoverProspects({ category: 'dentist', area: 'Leeds', fetchImpl }),
    /rate limiting|busy/i,
  );
});

test('a successful response becomes prospects', async () => {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({ elements: [element(9, { name: 'Smile Dental', website: 'smile.co.uk' })] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch;

  const prospects = await discoverProspects({ category: 'dentist', area: 'Leeds', fetchImpl });
  assert.equal(prospects.length, 1);
  assert.equal(prospects[0]?.website, 'https://smile.co.uk/');
});

test('an unknown business type fails with a usable message', async () => {
  await assert.rejects(
    () => discoverProspects({ category: 'astronaut', area: 'Leeds' }),
    /Unknown business type/,
  );
});
