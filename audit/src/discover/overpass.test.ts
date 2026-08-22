import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  buildAreaQuery,
  buildQuery,
  chooseArea,
  discoverProspects,
  normaliseWebsite,
  parseAreas,
  parseElements,
} from './overpass';
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
  const query = buildQuery(findCategory('dentist')!, 3600123456, 50);
  assert.match(query, /\["website"\]/);
  assert.match(query, /area\(3600123456\)/);
  assert.match(query, /amenity"="dentist/);
  assert.match(query, /out center 50;/);
});

test('nodes, ways and relations are all searched', () => {
  // A business may be mapped as a point or as a building outline.
  const query = buildQuery(findCategory('plumber')!, 3600000001, 10);
  for (const kind of ['node', 'way', 'relation']) {
    assert.ok(query.includes(`${kind}["craft"`), `missing ${kind}`);
  }
});

test('quotes in an area name cannot break out of the area query', () => {
  const query = buildAreaQuery('King"s Lynn');
  assert.doesNotMatch(query, /name"="King"s/);
});

test('an administrative prefix does not hide a place', () => {
  // The live failure: Bristol UK is "City of Bristol" in OpenStreetMap, so an
  // exact match returned fourteen American Bristols and none from Britain.
  const query = buildAreaQuery('Bristol');
  assert.match(query, /City of /);
  assert.match(query, /\^\(/, 'pattern should be anchored at the start');
  assert.match(query, /Bristol\$/, 'pattern should be anchored at the end');
});

test('anchoring stops a name matching a longer one', () => {
  // "Bristol" must not match "Bristol Township" or "New Bristol".
  const query = buildAreaQuery('Bristol');
  const pattern = query.match(/"name"~"([^"]+)"/)?.[1];
  assert.ok(pattern);
  const re = new RegExp(pattern, 'i');
  assert.ok(re.test('Bristol'));
  assert.ok(re.test('City of Bristol'));
  assert.ok(re.test('County of Bristol'));
  assert.ok(!re.test('Bristol Township'));
  assert.ok(!re.test('New Bristol'));
});

test('regex characters in a place name cannot alter the pattern', () => {
  const query = buildAreaQuery('St. Ives');
  const pattern = query.match(/"name"~"([^"]+)"/)?.[1];
  assert.ok(pattern);
  const re = new RegExp(pattern, 'i');
  assert.ok(re.test('St. Ives'));
  // The dot must be literal, not "any character".
  assert.ok(!re.test('StXIves'));
});

test('the area query asks relations for their centre point', () => {
  // Areas are derived objects with no coordinates; relations have them.
  const query = buildAreaQuery('Bristol');
  assert.match(query, /^rel\[/m);
  assert.match(query, /out center tags;/);
});

/* ------------- place names are not unique ------------- */

/** Bristol UK and Bristol Tennessee, four thousand miles apart. */
const BRISTOL_GB = { lat: 51.4545, lon: -2.5879 };
const BRISTOL_US = { lat: 36.5951, lon: -82.1887 };

const areaEl = (
  id: number,
  tags: Record<string, string>,
  center: { lat: number; lon: number } = BRISTOL_GB,
) => ({ id, tags, center });

test('country is derived from coordinates when tags do not carry it', () => {
  // The live failure: fifteen areas named Bristol came back and not one
  // declared its country. Coordinates always do.
  const areas = parseAreas({
    elements: [
      areaEl(57, { name: 'Bristol', admin_level: '6' }, BRISTOL_GB),
      areaEl(1234, { name: 'Bristol', admin_level: '8' }, BRISTOL_US),
    ],
  });
  assert.equal(areas.length, 2);
  assert.equal(areas[0]?.country, 'GB');
  assert.equal(areas[1]?.country, 'US');
});

test('a relation id becomes an Overpass area id', () => {
  const areas = parseAreas({ elements: [areaEl(57, { name: 'Bristol' })] });
  assert.equal(areas[0]?.id, 3_600_000_057);
});

test('a tagged country code is trusted over the coordinate guess', () => {
  const areas = parseAreas({
    elements: [areaEl(1, { name: 'Somewhere', 'ISO3166-1': 'FR' }, BRISTOL_GB)],
  });
  assert.equal(areas[0]?.country, 'FR');
});

test('a country filter picks the right one of several same-named places', () => {
  // The original live bug: "Bristol" resolved to Tennessee, and a whole
  // outreach batch would have gone to the wrong continent.
  const areas = parseAreas({
    elements: [
      areaEl(1234, { name: 'Bristol', admin_level: '8' }, BRISTOL_US),
      areaEl(57, { name: 'Bristol', admin_level: '6' }, BRISTOL_GB),
    ],
  });
  assert.equal(chooseArea(areas, 'GB')?.id, 3_600_000_057);
  assert.equal(chooseArea(areas, 'US')?.id, 3_600_001_234);
});

test('without a country the largest administrative area wins', () => {
  // A city boundary yields far more businesses than a parish inside it.
  const areas = parseAreas({
    elements: [
      areaEl(1, { name: 'Leeds', admin_level: '10' }),
      areaEl(2, { name: 'Leeds', admin_level: '6' }),
    ],
  });
  assert.equal(chooseArea(areas)?.id, 3_600_000_002);
});

test('a country with no match yields null rather than the wrong place', () => {
  const areas = parseAreas({
    elements: [areaEl(1, { name: 'Bristol' }, BRISTOL_US)],
  });
  assert.equal(chooseArea(areas, 'GB'), null);
});

test('an area with no coordinates does not crash the run', () => {
  const areas = parseAreas({ elements: [{ id: 1, tags: { name: 'Mystery' } }] });
  assert.equal(areas.length, 1);
  assert.equal(areas[0]?.country, null);
});

test('an unknown place name fails loudly instead of searching nowhere', async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ elements: [] }), { status: 200 })) as unknown as typeof fetch;

  await assert.rejects(
    () => discoverProspects({ category: 'dentist', area: 'Nowhereville', fetchImpl }),
    /no administrative area/i,
  );
});

test('the wrong-country case names the places it did find', async () => {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({ elements: [areaEl(1, { name: 'Bristol' }, BRISTOL_US)] }),
      { status: 200 },
    )) as unknown as typeof fetch;

  await assert.rejects(
    () => discoverProspects({ category: 'dentist', area: 'Bristol', country: 'GB', fetchImpl }),
    /none of them in country "GB"/i,
  );
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

test('a successful run resolves the area then finds businesses', async () => {
  let call = 0;
  const fetchImpl = (async () => {
    call += 1;
    const body =
      call === 1
        ? { elements: [{ id: 57, tags: { name: 'Leeds', admin_level: '6' }, center: { lat: 53.8, lon: -1.55 } }] }
        : { elements: [element(9, { name: 'Smile Dental', website: 'smile.co.uk' })] };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  const prospects = await discoverProspects({ category: 'dentist', area: 'Leeds', fetchImpl });
  assert.equal(call, 2, 'should resolve the area before searching');
  assert.equal(prospects.length, 1);
  assert.equal(prospects[0]?.website, 'https://smile.co.uk/');
});

test('an unknown business type fails with a usable message', async () => {
  await assert.rejects(
    () => discoverProspects({ category: 'astronaut', area: 'Leeds' }),
    /Unknown business type/,
  );
});
