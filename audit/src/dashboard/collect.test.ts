import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { funnel, rows, type Snapshot } from './collect';
import type { Finding, SiteAudit } from '../lib/types';
import { qualify } from '../outreach/qualify';

function audit(url: string, opportunity = 70): SiteAudit {
  return {
    url, finalUrl: url, fetchedAt: '2026-08-22T00:00:00.000Z',
    error: null, status: 200, loadMs: 200,
    findings: [], passed: [], healthScore: 50, opportunityScore: opportunity,
  };
}

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    generatedAt: '2026-08-22T00:00:00.000Z',
    prospects: [], audits: [], contacts: {}, orders: [], missing: [],
    ...over,
  };
}

test('a contact on a unique hostname is matched', () => {
  const result = rows(
    snapshot({
      audits: [audit('https://acme.co.uk/')],
      contacts: { 'acme.co.uk': { host: 'acme.co.uk', sentAt: '2026-08-20' } },
    }),
  );
  assert.equal(result[0]?.stage, 'sent');
});

test('a bare hostname claims the homepage, not every page on that domain', () => {
  // Two pages of one domain previously both claimed the same reply — the same
  // collision that silently overwrote report files. A homepage's identity is
  // its bare hostname, so typing that resolves to the homepage specifically.
  const result = rows(
    snapshot({
      audits: [audit('http://host.test/'), audit('http://host.test/two')],
      contacts: { 'host.test': { host: 'host.test', repliedAt: '2026-08-21' } },
    }),
  );

  const replied = result.filter((r) => r.stage === 'replied');
  assert.equal(replied.length, 1, 'exactly one row should claim the reply');
  assert.equal(replied[0]?.url, 'http://host.test/');
});

test('a hostname matching no homepage is applied to no one', () => {
  // Only sub-pages were audited, so there is no unambiguous owner. Applying
  // the reply to several businesses would misreport who actually answered.
  const result = rows(
    snapshot({
      audits: [audit('http://host.test/one'), audit('http://host.test/two')],
      contacts: { 'host.test': { host: 'host.test', repliedAt: '2026-08-21' } },
    }),
  );
  assert.deepEqual(result.map((r) => r.stage), ['audited', 'audited']);
});

test('a host-plus-path key resolves the ambiguous case', () => {
  const result = rows(
    snapshot({
      audits: [audit('http://host.test/'), audit('http://host.test/two')],
      contacts: { 'host.test-two': { host: 'host.test-two', repliedAt: '2026-08-21' } },
    }),
  );
  const replied = result.filter((r) => r.stage === 'replied');
  assert.equal(replied.length, 1);
  assert.match(replied[0]!.url, /\/two$/);
});

test('business names come from the matching prospect, not a same-host neighbour', () => {
  const result = rows(
    snapshot({
      audits: [audit('http://host.test/'), audit('http://host.test/two')],
      prospects: [
        { name: 'First Ltd', website: 'http://host.test/', phone: null,
        email: null, street: null, town: null, postcode: null, osmId: 'node/1' },
        { name: 'Second Ltd', website: 'http://host.test/two', phone: null,
        email: null, street: null, town: null, postcode: null, osmId: 'node/2' },
      ],
    }),
  );
  const names = result.map((r) => r.name).sort();
  assert.deepEqual(names, ['First Ltd', 'Second Ltd']);
});

test('rows needing a decision sort above untouched ones', () => {
  const result = rows(
    snapshot({
      audits: [audit('https://a.com/', 90), audit('https://b.com/', 20)],
      contacts: { 'b.com': { host: 'b.com', repliedAt: '2026-08-21' } },
    }),
  );
  // b replied and outranks a despite a much lower opportunity score.
  assert.equal(result[0]?.host, 'b.com');
});

test('revenue counts service payments and delivered orders separately', () => {
  const f = funnel(
    snapshot({
      contacts: { 'a.com': { host: 'a.com', outcome: 'client', paid: 450 } },
      orders: [
        { sessionId: 'cs_1', siteUrl: 'https://b.com', email: null, reportFile: 'x.html', fulfilledAt: '2026-08-22', healthScore: 40 },
      ],
    }),
  );
  assert.equal(f.revenue, 450);
  assert.equal(f.clients, 2, 'one service client plus one paid order');
});

test('an empty pipeline reports zeroes rather than throwing', () => {
  const f = funnel(snapshot());
  assert.deepEqual(
    [f.found, f.audited, f.contacted, f.replied, f.clients, f.revenue],
    [0, 0, 0, 0, 0, 0],
  );
  assert.deepEqual(rows(snapshot()), []);
});

/** Like `audit`, but with a finding — qualification drops audits that have none. */
function auditWithFinding(url: string, over: Partial<SiteAudit> = {}): SiteAudit {
  const finding: Finding = {
    ruleId: 'contact-method',
    severity: 'critical',
    category: 'conversion',
    title: 'No contact method',
    detail: 'd',
    impact: 'i',
    fix: 'f',
  };
  return { ...audit(url, 90), findings: [finding], ...over };
}

test('the dashboard and the drafter agree on who is worth contacting', () => {
  // These had drifted: the dashboard counted opportunity >= 40 and reported 15
  // while the drafter, applying disqualifiers, wrote 11 drafts. A dashboard
  // whose whole purpose is to be the single view of the pipeline cannot carry
  // its own definition of the funnel.
  const audits = [
    auditWithFinding('https://good.com/'),
    auditWithFinding('https://blocked.com/', { status: 403, loadMs: 120, opportunityScore: 99 }),
    auditWithFinding('https://chain.com/locations/x/', { opportunityScore: 95 }),
    auditWithFinding('https://dull.com/', { opportunityScore: 5 }),
  ];
  const f = funnel(snapshot({ audits }));

  assert.equal(f.audited, 4);
  assert.equal(f.worthContacting, 1, 'only good.com survives qualification');
  assert.equal(f.worthContacting, qualify(audits).contact.length);
});
