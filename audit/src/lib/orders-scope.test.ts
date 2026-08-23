import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { fetchPaidOrders, UnscopedOrderQuery } from './orders';
import type Stripe from 'stripe';

/**
 * The Stripe account behind this business also sells a printable-guides
 * storefront. `checkout.sessions.list` with no filter returns those sales
 * too, and the step after this one emails every buyer a website audit.
 *
 * The stub records what params it was called with and returns nothing, so
 * these tests are about the query, not the results.
 */
function stubStripe(): { stripe: Stripe; calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  const stripe = {
    checkout: {
      sessions: {
        list(params: Record<string, unknown>) {
          calls.push(params);
          return { async *[Symbol.asyncIterator]() { /* no sessions */ } };
        },
      },
    },
  } as unknown as Stripe;
  return { stripe, calls };
}

function withoutEnv<T>(run: () => T): T {
  const before = process.env['STRIPE_PAYMENT_LINK_ID'];
  delete process.env['STRIPE_PAYMENT_LINK_ID'];
  try {
    return run();
  } finally {
    if (before !== undefined) process.env['STRIPE_PAYMENT_LINK_ID'] = before;
  }
}

test('an unscoped query is refused rather than run', async () => {
  const { stripe, calls } = stubStripe();
  await withoutEnv(async () => {
    await assert.rejects(() => fetchPaidOrders(stripe), UnscopedOrderQuery);
  });
  assert.equal(calls.length, 0, 'Stripe should not have been called at all');
});

test('the refusal names the setting that fixes it', async () => {
  const { stripe } = stubStripe();
  await withoutEnv(async () => {
    await assert.rejects(() => fetchPaidOrders(stripe), /STRIPE_PAYMENT_LINK_ID/);
  });
});

test('an explicit link scopes the query', async () => {
  const { stripe, calls } = stubStripe();
  await withoutEnv(() => fetchPaidOrders(stripe, { paymentLinkId: 'plink_audit' }));
  assert.equal(calls[0]?.['payment_link'], 'plink_audit');
});

test('the environment supplies the link when the caller does not', async () => {
  // check-orders calls this with no options at all, so the env has to work.
  const { stripe, calls } = stubStripe();
  const before = process.env['STRIPE_PAYMENT_LINK_ID'];
  process.env['STRIPE_PAYMENT_LINK_ID'] = 'plink_from_env';
  try {
    await fetchPaidOrders(stripe);
  } finally {
    if (before === undefined) delete process.env['STRIPE_PAYMENT_LINK_ID'];
    else process.env['STRIPE_PAYMENT_LINK_ID'] = before;
  }
  assert.equal(calls[0]?.['payment_link'], 'plink_from_env');
});

test('a blank setting counts as unset, not as a filter matching nothing', async () => {
  // '' would otherwise be passed to Stripe as a payment_link, and a filter
  // that matches nothing looks exactly like having made no sales.
  const { stripe } = stubStripe();
  const before = process.env['STRIPE_PAYMENT_LINK_ID'];
  process.env['STRIPE_PAYMENT_LINK_ID'] = '   ';
  try {
    await assert.rejects(() => fetchPaidOrders(stripe), UnscopedOrderQuery);
  } finally {
    if (before === undefined) delete process.env['STRIPE_PAYMENT_LINK_ID'];
    else process.env['STRIPE_PAYMENT_LINK_ID'] = before;
  }
});

test('every product can still be requested deliberately', async () => {
  const { stripe, calls } = stubStripe();
  await withoutEnv(() => fetchPaidOrders(stripe, { allowEveryProduct: true }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.['payment_link'], undefined);
});
