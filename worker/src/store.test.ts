import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { asKv, FakeKV } from './fake-kv';
import {
  addSuppression,
  isSuppressed,
  listOrders,
  listSuppressions,
  recordOrder,
  suppressionKey,
} from './store';
import type { StripeOrder } from './stripe';

function store(): { fake: FakeKV; kv: KVNamespace } {
  const fake = new FakeKV();
  return { fake, kv: asKv(fake) };
}

test('the key is the business, not the string it arrived as', () => {
  const forms = [
    'https://WWW.Acme.com/contact',
    'www.acme.com',
    'ACME.COM',
    'acme.com.',
    '  https://acme.com  ',
  ];
  for (const form of forms) {
    assert.equal(suppressionKey(form), 'acme.com', form);
  }
});

test('an opt-out is not downgraded by later bookkeeping', async () => {
  // The failure this prevents: a nightly job records 'already-contacted'
  // against everyone it looked at, quietly overwriting the strongest signal on
  // the list with the weakest.
  const { kv } = store();
  await addSuppression(kv, 'acme.com', 'opted-out', 'asked by reply');
  const second = await addSuppression(kv, 'www.ACME.com', 'already-contacted');

  assert.equal(second.created, false);
  assert.equal(second.entry.reason, 'opted-out');

  const all = await listSuppressions(kv);
  assert.equal(all.length, 1);
  assert.equal(all[0]?.reason, 'opted-out');
});

test('suppression is checked against the normalised host', async () => {
  const { kv } = store();
  await addSuppression(kv, 'https://www.acme.com/contact', 'opted-out');
  assert.equal(await isSuppressed(kv, 'acme.com'), true);
  assert.equal(await isSuppressed(kv, 'https://ACME.com/'), true);
  assert.equal(await isSuppressed(kv, 'other.com'), false);
});

test('an empty target is refused rather than stored as a wildcard', async () => {
  // A blank key would match nothing on read but would sit in the list looking
  // like a record. Worse, a bug that normalises to empty would silently write
  // one every run.
  const { kv } = store();
  await assert.rejects(() => addSuppression(kv, '   ', 'manual'));
});

test('the whole list comes back across pages', async () => {
  // The export is one `list()` loop; a caller that ignored the cursor would
  // return the first page and look correct on a small list.
  const { fake, kv } = store();
  for (let i = 0; i < 25; i += 1) await addSuppression(kv, `site-${i}.com`, 'opted-out');

  const paged = await fake.list({ prefix: 'sup:', limit: 10 });
  assert.equal(paged.list_complete, false, 'fixture should span pages');

  const all = await listSuppressions(kv);
  assert.equal(all.length, 25);
});

test('a suppression never expires', async () => {
  const { fake, kv } = store();
  await addSuppression(kv, 'acme.com', 'opted-out');
  fake.advance(60 * 60 * 24 * 365 * 5);
  assert.equal(await isSuppressed(kv, 'acme.com'), true);
});

test('an entry whose metadata is missing is recovered, not dropped', async () => {
  // Being on the list is the fact that matters. Losing a record because its
  // metadata is unreadable would mean emailing someone who opted out.
  const { fake, kv } = store();
  await fake.put('sup:acme.com', JSON.stringify({ key: 'acme.com' }));

  const all = await listSuppressions(kv);
  assert.equal(all.length, 1);
  assert.equal(all[0]?.key, 'acme.com');
});

const ORDER: StripeOrder = {
  eventId: 'evt_1',
  sessionId: 'cs_1',
  email: 'buyer@example.com',
  site: 'acme.com',
  amountTotal: 10000,
  currency: 'usd',
  livemode: true,
  at: '2026-08-23T00:00:00.000Z',
};

test('a redelivered event does not become a second order', async () => {
  // Stripe delivers at least once and retries on any non-2xx, so this is the
  // normal case rather than the edge case. Twice means two reports and a
  // ledger that disagrees with Stripe about how many sales there were.
  const { kv } = store();
  assert.equal((await recordOrder(kv, ORDER)).stored, true);
  assert.equal((await recordOrder(kv, ORDER)).stored, false);
  assert.equal((await listOrders(kv)).length, 1);
});

test('a different event for the same session is still deduplicated by session key', async () => {
  const { kv } = store();
  await recordOrder(kv, ORDER);
  await recordOrder(kv, { ...ORDER, eventId: 'evt_2' });
  assert.equal((await listOrders(kv)).length, 1);
});

test('two genuine orders both land', async () => {
  const { kv } = store();
  await recordOrder(kv, ORDER);
  await recordOrder(kv, { ...ORDER, eventId: 'evt_9', sessionId: 'cs_9' });
  assert.equal((await listOrders(kv)).length, 2);
});

test('orders and suppressions do not read each other', async () => {
  // They share one namespace, separated only by key prefix. A prefix mistake
  // would put orders into the suppression export, which is the list that gets
  // handed to the drafter.
  const { kv } = store();
  await recordOrder(kv, ORDER);
  await addSuppression(kv, 'other.com', 'opted-out');

  assert.equal((await listSuppressions(kv)).length, 1);
  assert.equal((await listOrders(kv)).length, 1);
  assert.equal((await listSuppressions(kv))[0]?.key, 'other.com');
});
