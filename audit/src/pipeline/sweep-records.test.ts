import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Prospect } from '../discover/overpass';
import { excludeSeen } from '../outreach/rotation';

/**
 * The sweep used to keep `p.website` and drop the rest of each record.
 *
 * Nothing failed loudly. `npm run emails` had no prospects.json to fill in and
 * killed a nine-minute run; the artifact promised a prospects.csv that nothing
 * ever wrote; and the names and phone numbers OpenStreetMap did supply were
 * thrown away. These tests pin the selection step that keeps the records and
 * the surviving URLs in agreement.
 */

const prospect = (website: string, over: Partial<Prospect> = {}): Prospect => ({
  name: website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''),
  website,
  email: null,
  phone: null,
  street: null,
  town: null,
  postcode: null,
  osmId: 'node/1',
  ...over,
});

/** The selection sweep.ts performs, isolated so it can be tested directly. */
function selectFresh(found: Prospect[], seen: string[]): Prospect[] {
  const { fresh } = excludeSeen(
    found.map((p) => p.website),
    seen,
  );
  const freshSet = new Set(fresh);
  const out: Prospect[] = [];
  for (const p of found) {
    if (freshSet.delete(p.website)) out.push(p);
  }
  return out;
}

test('a record survives discovery with its name, phone and email intact', () => {
  const found = [
    prospect('https://newdentist.com/', {
      name: 'New Dentist',
      phone: '+1 703 555 0100',
      email: 'info@newdentist.com',
    }),
  ];
  const [kept] = selectFresh(found, []);
  assert.equal(kept?.name, 'New Dentist');
  assert.equal(kept?.phone, '+1 703 555 0100');
  assert.equal(kept?.email, 'info@newdentist.com');
});

test('a business already on the ledger is dropped, record and all', () => {
  const found = [prospect('https://www.seen.com/'), prospect('https://fresh.com/')];
  const kept = selectFresh(found, ['seen.com']);
  assert.deepEqual(
    kept.map((p) => p.website),
    ['https://fresh.com/'],
  );
});

test('a chain listed once per branch yields one record, not one per branch', () => {
  // OSM lists a chain once per location and every branch carries the same
  // website. Selecting by a Set the URL is deleted from is what stops the
  // second branch re-adding the same record.
  const found = [
    prospect('https://chain.com/', { name: 'Chain — Arlington' }),
    prospect('https://chain.com/', { name: 'Chain — Herndon' }),
    prospect('https://solo.com/'),
  ];
  const kept = selectFresh(found, []);
  assert.equal(kept.length, 2);
  assert.deepEqual(
    kept.map((p) => p.website),
    ['https://chain.com/', 'https://solo.com/'],
  );
});

test('the records kept and the URLs kept never disagree', () => {
  const found = [
    prospect('https://a.com/'),
    prospect('https://www.b.com/'),
    prospect('https://a.com/'),
    prospect('https://c.com/'),
  ];
  const seen = ['c.com'];
  const { fresh } = excludeSeen(
    found.map((p) => p.website),
    seen,
  );
  const kept = selectFresh(found, seen);
  assert.deepEqual(kept.map((p) => p.website), fresh);
});
