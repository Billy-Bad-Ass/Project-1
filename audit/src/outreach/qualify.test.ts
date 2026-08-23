import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { disqualify, qualify, TIER_ADVICE } from './qualify';
import type { Finding, SiteAudit } from '../lib/types';

const finding: Finding = {
  ruleId: 'contact-method',
  severity: 'critical',
  category: 'conversion',
  title: 'No contact method',
  detail: 'd',
  impact: 'i',
  fix: 'f',
};

function audit(over: Partial<SiteAudit> = {}): SiteAudit {
  return {
    url: 'https://acme-dental.com/',
    finalUrl: 'https://acme-dental.com/',
    fetchedAt: '2026-08-23T00:00:00.000Z',
    error: null,
    status: 200,
    loadMs: 300,
    findings: [finding],
    passed: [],
    healthScore: 40,
    opportunityScore: 80,
    ...over,
  };
}

test('a site we could not read is never contacted', () => {
  const why = disqualify(audit({ error: 'unauditable: blocked by the site (HTTP 403)' }));
  assert.equal(why?.id, 'unauditable');
  // The "unauditable:" prefix is plumbing; the reason shown should read plainly.
  assert.doesNotMatch(why?.reason ?? '', /^unauditable:/);
  assert.match(why?.reason ?? '', /403/);
});

test('a branch page of a multi-site group is skipped', () => {
  // From the live run: ismileva.com/find-a-locations/fairfax/ scored 96 health
  // because a corporate template is competently built, and a branch cannot
  // commission the work anyway.
  const paths = [
    'https://ismileva.com/find-a-locations/fairfax/',
    'https://big.com/locations/reston/',
    'https://big.com/location/reston/',
    'https://big.com/offices/vienna/',
    'https://big.com/practices/herndon/',
  ];
  for (const finalUrl of paths) {
    assert.equal(disqualify(audit({ finalUrl }))?.id, 'chain-location', finalUrl);
  }
});

test('an ordinary page is not mistaken for a branch page', () => {
  for (const finalUrl of [
    'https://acme-dental.com/',
    'https://acme-dental.com/about/',
    'https://acme-dental.com/allocations/',
  ]) {
    assert.equal(disqualify(audit({ finalUrl })), null, finalUrl);
  }
});

test('a healthy site with nothing to fix is not a prospect', () => {
  assert.equal(disqualify(audit({ findings: [] }))?.id, 'no-findings');
  assert.equal(disqualify(audit({ opportunityScore: 12 }))?.id, 'nothing-to-sell');
});

test('the ICP actually excludes people', () => {
  // The point of the change: a filter that removes nobody is a sorted list,
  // not a qualification step.
  const audits = [
    audit({ finalUrl: 'https://a.com/', opportunityScore: 90 }),
    audit({ finalUrl: 'https://b.com/find-a-locations/x/', opportunityScore: 95 }),
    audit({ finalUrl: 'https://c.com/', error: 'unauditable: blocked by the site (HTTP 403)' }),
    audit({ finalUrl: 'https://d.com/', opportunityScore: 10 }),
  ];
  const { contact, skipped } = qualify(audits);
  assert.equal(contact.length, 1);
  assert.equal(skipped.length, 3);
  assert.deepEqual(
    skipped.map((s) => s.why.id).sort(),
    ['chain-location', 'nothing-to-sell', 'unauditable'],
  );
});

test('tiers are assigned by opportunity, best first', () => {
  const audits = Array.from({ length: 12 }, (_, i) =>
    audit({ finalUrl: `https://s${i}.com/`, opportunityScore: 100 - i * 5 }),
  );
  const { contact } = qualify(audits);

  assert.deepEqual(
    contact.slice(0, 3).map((c) => c.tier),
    [1, 1, 1],
  );
  assert.equal(contact[0]?.audit.opportunityScore, 100);
  assert.equal(contact[3]?.tier, 2);
  assert.equal(contact[9]?.tier, 2);
  assert.equal(contact[10]?.tier, 3);
});

test('tier sizes are configurable', () => {
  const audits = Array.from({ length: 6 }, (_, i) =>
    audit({ finalUrl: `https://s${i}.com/`, opportunityScore: 90 - i }),
  );
  const { contact } = qualify(audits, { tier1: 1, tier2: 2 });
  assert.deepEqual(
    contact.map((c) => c.tier),
    [1, 2, 2, 3, 3, 3],
  );
});

test('a short list does not crash the tiering', () => {
  const { contact } = qualify([audit()]);
  assert.equal(contact.length, 1);
  assert.equal(contact[0]?.tier, 1);
});

test('every tier tells the reader what to do with it', () => {
  for (const tier of [1, 2, 3] as const) {
    assert.ok(TIER_ADVICE[tier].length > 10);
  }
  // Tier 1 must ask for human work; that is the whole point of tiering.
  assert.match(TIER_ADVICE[1], /hand/i);
  assert.match(TIER_ADVICE[3], /as drafted/i);
});

test('a stale audit that predates the fetch-time rule is still caught', () => {
  // Regression guard for what actually happened: audits stored before the
  // fetch-time check arrived with error null and a full set of findings
  // generated from a page that was never read. Qualification must re-derive
  // this from the raw status rather than trusting `error` to be populated.
  const stale = audit({
    error: null,
    status: 403,
    loadMs: 120,
    opportunityScore: 99,
    healthScore: 10,
  });
  assert.equal(disqualify(stale)?.id, 'unauditable');
  assert.match(disqualify(stale)?.reason ?? '', /403/);
});

test('the four blocked Fairfax sites do not reach a draft', () => {
  const live = [
    audit({ finalUrl: 'https://www.herndonfamilydental.com/', status: 403, loadMs: 252, opportunityScore: 99 }),
    audit({ finalUrl: 'https://totaldentalarts.com/', status: 500, loadMs: 554, opportunityScore: 98 }),
    audit({ finalUrl: 'https://www.karauorthodontics.com/', status: 403, loadMs: 117, opportunityScore: 98 }),
    audit({ finalUrl: 'https://www.restonheightsdentist.com/', status: 403, loadMs: 217, opportunityScore: 97 }),
    audit({ finalUrl: 'https://centrevilledentalassociates.com/', status: 200, loadMs: 400, opportunityScore: 89 }),
  ];
  const { contact, skipped } = qualify(live);
  assert.equal(contact.length, 1);
  assert.equal(contact[0]?.audit.finalUrl, 'https://centrevilledentalassociates.com/');
  assert.equal(skipped.length, 4);
  assert.ok(skipped.every((s) => s.why.id === 'unauditable'));
});
