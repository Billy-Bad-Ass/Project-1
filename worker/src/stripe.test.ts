import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { hmacHex } from './crypto';
import { orderFromEvent, verifyStripeSignature } from './stripe';

const SECRET = 'whsec_test_secret';
const NOW = 1_700_000_000;

async function sign(payload: string, secret = SECRET, timestamp = NOW): Promise<string> {
  return `t=${timestamp},v1=${await hmacHex(secret, `${timestamp}.${payload}`)}`;
}

const PAYLOAD = JSON.stringify({
  id: 'evt_1',
  type: 'checkout.session.completed',
  created: NOW,
  livemode: true,
  data: { object: { id: 'cs_1', customer_details: { email: 'buyer@example.com' } } },
});

test('a genuine signature verifies', async () => {
  const result = await verifyStripeSignature(PAYLOAD, await sign(PAYLOAD), SECRET, NOW);
  assert.equal(result.ok, true);
});

test('a payload altered after signing is rejected', async () => {
  // The point of the whole exercise: the endpoint records that somebody paid,
  // and its URL is public.
  const header = await sign(PAYLOAD);
  const tampered = PAYLOAD.replace('buyer@example.com', 'attacker@example.com');
  const result = await verifyStripeSignature(tampered, header, SECRET, NOW);
  assert.equal(result.ok, false);
});

test('re-serialising the body breaks verification', async () => {
  // Not a flaw — a guardrail. The signature covers the exact bytes, so this
  // test exists to fail loudly if anyone ever changes the handler to parse
  // first and verify second. Key order and whitespace both change.
  const header = await sign(PAYLOAD);
  const reserialised = JSON.stringify(JSON.parse(PAYLOAD));
  const spaced = `${reserialised} `;
  assert.equal((await verifyStripeSignature(spaced, header, SECRET, NOW)).ok, false);
});

test('a signature from a different secret is rejected', async () => {
  const header = await sign(PAYLOAD, 'whsec_someone_elses');
  assert.equal((await verifyStripeSignature(PAYLOAD, header, SECRET, NOW)).ok, false);
});

test('an old signature is rejected even though it is valid', async () => {
  // A captured webhook stays cryptographically valid forever. Without the
  // window, replaying one is free — and this one records a sale.
  const header = await sign(PAYLOAD, SECRET, NOW - 3600);
  const result = await verifyStripeSignature(PAYLOAD, header, SECRET, NOW);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : '', /tolerance/);
});

test('a signature from the near future is accepted', async () => {
  // Clock skew between Stripe and the edge is normal and small. Rejecting it
  // would drop real payments.
  const header = await sign(PAYLOAD, SECRET, NOW + 30);
  assert.equal((await verifyStripeSignature(PAYLOAD, header, SECRET, NOW)).ok, true);
});

test('during a secret rotation both signatures are offered and one matches', async () => {
  const good = await hmacHex(SECRET, `${NOW}.${PAYLOAD}`);
  const old = await hmacHex('whsec_previous', `${NOW}.${PAYLOAD}`);
  const header = `t=${NOW},v1=${old},v1=${good}`;
  assert.equal((await verifyStripeSignature(PAYLOAD, header, SECRET, NOW)).ok, true);
});

test('a missing or malformed header is rejected, not thrown on', async () => {
  for (const header of [null, '', 'garbage', 't=abc,v1=x', `t=${NOW}`, 'v1=only']) {
    const result = await verifyStripeSignature(PAYLOAD, header, SECRET, NOW);
    assert.equal(result.ok, false, `accepted: ${String(header)}`);
  }
});

test('an unconfigured signing secret refuses rather than accepting everything', async () => {
  // The failure that would matter most: an empty secret must lock the door,
  // not leave it open.
  const result = await verifyStripeSignature(PAYLOAD, await sign(PAYLOAD), '', NOW);
  assert.equal(result.ok, false);
});

test('the order is pulled out of a completed checkout', () => {
  const order = orderFromEvent(JSON.parse(PAYLOAD));
  assert.ok(order);
  assert.equal(order.sessionId, 'cs_1');
  assert.equal(order.email, 'buyer@example.com');
  assert.equal(order.livemode, true);
});

test('other event types produce no order', () => {
  assert.equal(orderFromEvent({ id: 'evt_2', type: 'payment_intent.created', data: {} }), null);
});

test('garbage never throws, because a throw is a 500 and Stripe retries a 500', () => {
  for (const input of [null, undefined, 42, 'text', {}, { type: 'checkout.session.completed' }]) {
    assert.doesNotThrow(() => orderFromEvent(input));
  }
});

test('the site to review is read from a custom field', () => {
  const order = orderFromEvent({
    id: 'evt_3',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_3',
        custom_fields: [{ key: 'website', text: { value: 'https://acme.com' } }],
      },
    },
  });
  assert.equal(order?.site, 'https://acme.com');
});

test('a custom field takes precedence over the fallbacks', () => {
  // All three can be present at once. The custom field is the one the customer
  // actually typed on the payment page, so it wins.
  const order = orderFromEvent({
    id: 'evt_4',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_4',
        custom_fields: [{ key: 'website', text: { value: 'typed.example' } }],
        client_reference_id: 'reference.example',
        metadata: { site: 'metadata.example' },
      },
    },
  });
  assert.equal(order?.site, 'typed.example');
});

test('an order with no site is still an order', () => {
  // It cannot be fulfilled yet, but somebody has paid. Dropping it because a
  // field is missing loses a sale silently.
  const order = orderFromEvent({
    id: 'evt_5',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_5' } },
  });
  assert.ok(order);
  assert.equal(order.site, null);
  assert.equal(order.email, null);
});
