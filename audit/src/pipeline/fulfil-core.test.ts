import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { fulfilOrders, outstandingActions, type Ledger } from './fulfil-core';
import type { Order } from '../lib/orders';
import type { Finding, SiteAudit } from '../lib/types';

function order(over: Partial<Order> = {}): Order {
  return {
    sessionId: 'cs_test_a1b2c3d4e5f6',
    siteUrl: 'https://paying-customer.com/',
    email: 'owner@paying-customer.com',
    amountPaid: 10000,
    currency: 'usd',
    paidAt: '2026-08-23T10:00:00.000Z',
    fields: { website: 'https://paying-customer.com/' },
    ...over,
  };
}

const finding: Finding = {
  ruleId: 'contact-method',
  severity: 'critical',
  category: 'conversion',
  title: 'No contact method',
  detail: 'd',
  impact: 'i',
  fix: 'f',
};

function goodAudit(url: string): SiteAudit {
  return {
    url,
    finalUrl: url,
    fetchedAt: '2026-08-23T10:00:05.000Z',
    error: null,
    status: 200,
    loadMs: 300,
    findings: [finding],
    passed: [],
    healthScore: 55,
    opportunityScore: 70,
  };
}

async function workspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'fulfil-'));
}

test('a paid order produces a real report on disk and a ledger entry', async () => {
  const out = await workspace();
  const ledger: Ledger = {};

  const result = await fulfilOrders([order()], ledger, {
    outDir: out,
    audit: async (url) => goodAudit(url),
    now: () => '2026-08-23T10:00:10.000Z',
  });

  assert.equal(result.delivered.length, 1);

  // The report must actually exist and be a real report, not an empty file.
  const entry = result.delivered[0]!;
  const html = await readFile(join(out, entry.reportFile), 'utf8');
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /paying-customer\.com/);
  assert.match(html, /No contact method/);

  // And the ledger must know, or the next run bills the work twice.
  assert.equal(ledger['cs_test_a1b2c3d4e5f6']?.healthScore, 55);
  assert.equal(ledger['cs_test_a1b2c3d4e5f6']?.email, 'owner@paying-customer.com');
});

test('running twice does not deliver twice', async () => {
  // The whole reason the ledger exists. Stripe knows about payment and nothing
  // about whether a report was produced, so re-running must be safe.
  const out = await workspace();
  const ledger: Ledger = {};
  const opts = { outDir: out, audit: async (u: string) => goodAudit(u) };

  const first = await fulfilOrders([order()], ledger, opts);
  const second = await fulfilOrders([order()], ledger, opts);

  assert.equal(first.delivered.length, 1);
  assert.equal(second.delivered.length, 0);
  assert.equal(second.alreadyDone.length, 1);

  const files = await readdir(join(out, 'delivered'));
  assert.equal(files.length, 1, 'a second report file would mean duplicate work');
});

test('a paid order with no website address is surfaced, never dropped', async () => {
  const out = await workspace();
  const ledger: Ledger = {};

  const result = await fulfilOrders([order({ siteUrl: null })], ledger, {
    outDir: out,
    audit: async () => {
      throw new Error('must not audit an order with no address');
    },
  });

  assert.equal(result.unusable.length, 1);
  assert.equal(result.delivered.length, 0);
  // Crucially not in the ledger: it is not done.
  assert.equal(Object.keys(ledger).length, 0);
  assert.match(outstandingActions(result).join('\n'), /ASK o\*\*\*@paying-customer\.com/);
});

test('a site that cannot be read is never marked delivered', async () => {
  // Someone paid. Marking this done would lose the obligation entirely.
  const out = await workspace();
  const ledger: Ledger = {};

  const result = await fulfilOrders([order()], ledger, {
    outDir: out,
    audit: async (url) => ({
      ...goodAudit(url),
      error: 'unauditable: blocked by the site (HTTP 403)',
    }),
  });

  assert.equal(result.failed.length, 1);
  assert.equal(result.delivered.length, 0);
  assert.equal(Object.keys(ledger).length, 0);
  assert.match(result.failed[0]?.reason ?? '', /403/);
});

test('an audit that throws is caught and reported, not left to kill the run', async () => {
  const out = await workspace();
  const ledger: Ledger = {};
  let calls = 0;

  const result = await fulfilOrders(
    [order({ sessionId: 'cs_test_first' }), order({ sessionId: 'cs_test_second' })],
    ledger,
    {
      outDir: out,
      audit: async (url) => {
        calls += 1;
        if (calls === 1) throw new Error('socket hang up');
        return goodAudit(url);
      },
    },
  );

  // One customer's audit blew up; the other still got their report.
  assert.equal(result.failed.length, 1);
  assert.equal(result.delivered.length, 1);
  assert.match(result.failed[0]?.reason ?? '', /socket hang up/);
});

test('two customers submitting the same address get separate reports', async () => {
  // The report-slug collision already silently overwrote files once. Here it
  // would mean one paying customer receiving another's report.
  const out = await workspace();
  const ledger: Ledger = {};

  const result = await fulfilOrders(
    [
      order({ sessionId: 'cs_test_aaaaaaaa', email: 'first@x.com' }),
      order({ sessionId: 'cs_test_bbbbbbbb', email: 'second@y.com' }),
    ],
    ledger,
    { outDir: out, audit: async (u) => goodAudit(u) },
  );

  assert.equal(result.delivered.length, 2);
  const files = await readdir(join(out, 'delivered'));
  assert.equal(new Set(files).size, 2, 'the two reports must not share a filename');
});

test('every outcome produces a human action, so nothing is silently owed', async () => {
  const out = await workspace();
  const ledger: Ledger = {};

  const result = await fulfilOrders(
    [
      order({ sessionId: 'cs_test_ok' }),
      order({ sessionId: 'cs_test_noaddr', siteUrl: null }),
      order({ sessionId: 'cs_test_dead', siteUrl: 'https://dead.com/' }),
    ],
    ledger,
    {
      outDir: out,
      audit: async (url) =>
        url.includes('dead')
          ? { ...goodAudit(url), error: 'unauditable: server error (HTTP 500)' }
          : goodAudit(url),
    },
  );

  const actions = outstandingActions(result);
  assert.equal(actions.length, 3);
  assert.ok(actions.some((a) => a.startsWith('EMAIL')));
  assert.ok(actions.some((a) => a.startsWith('ASK')));
  assert.ok(actions.some((a) => a.startsWith('CONTACT')));
});

test('delivery says who to email, because fulfilment does not send', async () => {
  const out = await workspace();
  const ledger: Ledger = {};
  const result = await fulfilOrders([order()], ledger, {
    outDir: out,
    audit: async (u) => goodAudit(u),
  });
  assert.match(outstandingActions(result)[0] ?? '', /EMAIL the report to o\*\*\*@paying-customer\.com/);
});
