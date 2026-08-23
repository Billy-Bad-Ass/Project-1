import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { hmacHex, timingSafeEqual } from './crypto';
import { asKv, FakeKV } from './fake-kv';
import worker, { type Env } from './index';
import { listOrders, listSuppressions } from './store';
import { unsubscribeToken, unsubscribeUrl, verifyUnsubscribeToken } from './tokens';

const BASE = 'https://bba.example';

function env(overrides: Partial<Env> = {}): { env: Env; fake: FakeKV } {
  const fake = new FakeKV();
  return {
    fake,
    env: {
      STORE: asKv(fake),
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
      UNSUBSCRIBE_SECRET: 'unsub_secret_value',
      API_TOKEN: 'pipeline_token',
      SENDER_BUSINESS: 'BBA Network',
      SENDER_EMAIL: 'hello@example.com',
      ...overrides,
    },
  };
}

function call(e: Env, path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(BASE + path, init), e);
}

// --- unsubscribe -----------------------------------------------------------

test('a link verifies for its own host and nothing else', async () => {
  const token = await unsubscribeToken('acme.com', 'secret');
  assert.equal(await verifyUnsubscribeToken('acme.com', token, 'secret'), true);
  assert.equal(await verifyUnsubscribeToken('other.com', token, 'secret'), false);
  assert.equal(await verifyUnsubscribeToken('acme.com', token, 'different'), false);
  assert.equal(await verifyUnsubscribeToken('acme.com', '', 'secret'), false);
});

test('the link normalises the host the same way the store does', async () => {
  const a = await unsubscribeToken('https://WWW.Acme.com/x', 'secret');
  const b = await unsubscribeToken('acme.com', 'secret');
  assert.equal(a, b);
  assert.equal(unsubscribeUrl(`${BASE}/`, 'https://www.Acme.com', a), `${BASE}/u/acme.com/${a}`);
});

test('OPENING the link does not unsubscribe anybody', async () => {
  // The single most consequential test here. Mail clients, spam filters and
  // link scanners fetch every URL in a message before a human sees it. If GET
  // acted, a large share of the list would be removed by software that merely
  // looked at the email — indistinguishable from people choosing to leave.
  const { env: e, fake } = env();
  const token = await unsubscribeToken('acme.com', e.UNSUBSCRIBE_SECRET);

  const response = await call(e, `/u/acme.com/${token}`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Yes, stop emailing me/);
  assert.equal((await listSuppressions(asKv(fake))).length, 0);
});

test('submitting the form does unsubscribe', async () => {
  const { env: e, fake } = env();
  const token = await unsubscribeToken('acme.com', e.UNSUBSCRIBE_SECRET);

  const response = await call(e, `/u/acme.com/${token}`, { method: 'POST' });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /off the list/i);

  const list = await listSuppressions(asKv(fake));
  assert.equal(list.length, 1);
  assert.equal(list[0]?.key, 'acme.com');
  assert.equal(list[0]?.reason, 'opted-out');
});

test('a one-click POST from a mail provider works with no form and no body', async () => {
  // RFC 8058: the provider POSTs the List-Unsubscribe URL itself. It sends a
  // form body the handler never reads, and expects a 2xx.
  const { env: e, fake } = env();
  const token = await unsubscribeToken('acme.com', e.UNSUBSCRIBE_SECRET);

  const response = await call(e, `/u/acme.com/${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click',
  });
  assert.equal(response.status, 200);
  assert.equal((await listSuppressions(asKv(fake))).length, 1);
});

test('unsubscribing twice is not an error and keeps the first record', async () => {
  const { env: e, fake } = env();
  const token = await unsubscribeToken('acme.com', e.UNSUBSCRIBE_SECRET);
  await call(e, `/u/acme.com/${token}`, { method: 'POST' });
  const second = await call(e, `/u/acme.com/${token}`, { method: 'POST' });

  assert.equal(second.status, 200);
  assert.equal((await listSuppressions(asKv(fake))).length, 1);
});

test('a forged token cannot unsubscribe someone else', async () => {
  const { env: e, fake } = env();
  const response = await call(e, '/u/acme.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', {
    method: 'POST',
  });
  assert.equal(response.status, 404);
  assert.equal((await listSuppressions(asKv(fake))).length, 0);
});

test("another host's valid token does not work", async () => {
  const { env: e, fake } = env();
  const token = await unsubscribeToken('other.com', e.UNSUBSCRIBE_SECRET);
  const response = await call(e, `/u/acme.com/${token}`, { method: 'POST' });
  assert.equal(response.status, 404);
  assert.equal((await listSuppressions(asKv(fake))).length, 0);
});

test('a bad link says the same thing whoever asks, and offers a route that works', async () => {
  // Answering differently for a host that is on the list would turn this page
  // into a way to ask whether we hold a record for any business.
  const { env: e } = env();
  const known = await call(e, '/u/acme.com/wrongtokenwrongtokenwrongtoken12');
  const unknown = await call(e, '/u/never-heard-of-it.com/wrongtokenwrongtokenwrongtoken12');

  assert.equal(known.status, unknown.status);
  const body = await known.text();
  assert.equal(body, await unknown.text());
  assert.match(body, /stop/);
  assert.match(body, /hello@example\.com/);
});

test('the unsubscribe pages ask not to be indexed', async () => {
  const { env: e } = env();
  const token = await unsubscribeToken('acme.com', e.UNSUBSCRIBE_SECRET);
  const body = await (await call(e, `/u/acme.com/${token}`)).text();
  assert.match(body, /noindex/);
});

test('a host with regex-ish characters is handled, not matched loosely', async () => {
  const { env: e, fake } = env();
  const token = await unsubscribeToken('a-b.co.uk', e.UNSUBSCRIBE_SECRET);
  await call(e, `/u/${encodeURIComponent('a-b.co.uk')}/${token}`, { method: 'POST' });
  assert.equal((await listSuppressions(asKv(fake)))[0]?.key, 'a-b.co.uk');
});

// --- stripe webhook --------------------------------------------------------

const EVENT = JSON.stringify({
  id: 'evt_live_1',
  type: 'checkout.session.completed',
  created: Math.floor(Date.now() / 1000),
  livemode: true,
  data: {
    object: {
      id: 'cs_live_1',
      customer_details: { email: 'buyer@example.com' },
      custom_fields: [{ key: 'website', text: { value: 'acme.com' } }],
      amount_total: 10000,
      currency: 'usd',
    },
  },
});

async function signed(payload: string, secret: string): Promise<HeadersInit> {
  const t = Math.floor(Date.now() / 1000);
  return { 'stripe-signature': `t=${t},v1=${await hmacHex(secret, `${t}.${payload}`)}` };
}

test('an unsigned webhook records nothing', async () => {
  // Without this, anyone who finds the URL can have a report written and sent
  // to an address of their choosing, for free.
  const { env: e, fake } = env();
  const response = await call(e, '/stripe/webhook', { method: 'POST', body: EVENT });
  assert.equal(response.status, 400);
  assert.equal((await listOrders(asKv(fake))).length, 0);
});

test('a signed webhook records the order', async () => {
  const { env: e, fake } = env();
  const response = await call(e, '/stripe/webhook', {
    method: 'POST',
    body: EVENT,
    headers: await signed(EVENT, e.STRIPE_WEBHOOK_SECRET),
  });
  assert.equal(response.status, 200);

  const orders = await listOrders(asKv(fake));
  assert.equal(orders.length, 1);
  assert.equal(orders[0]?.email, 'buyer@example.com');
  assert.equal(orders[0]?.site, 'acme.com');
});

test('a redelivery does not create a second order', async () => {
  const { env: e, fake } = env();
  const headers = await signed(EVENT, e.STRIPE_WEBHOOK_SECRET);
  await call(e, '/stripe/webhook', { method: 'POST', body: EVENT, headers });
  const again = await call(e, '/stripe/webhook', { method: 'POST', body: EVENT, headers });

  assert.equal(again.status, 200, 'a retry must still be acknowledged');
  assert.equal((await listOrders(asKv(fake))).length, 1);
});

test('an event we do not act on is acknowledged, not refused', async () => {
  // Any non-2xx tells Stripe the endpoint is broken and starts a retry cycle.
  // Refusing the events we ignore would manufacture an outage.
  const { env: e } = env();
  const payload = JSON.stringify({ id: 'evt_x', type: 'customer.created', data: { object: {} } });
  const response = await call(e, '/stripe/webhook', {
    method: 'POST',
    body: payload,
    headers: await signed(payload, e.STRIPE_WEBHOOK_SECRET),
  });
  assert.equal(response.status, 200);
});

test('a correctly signed body that is not JSON is a 400, not a crash', async () => {
  const { env: e } = env();
  const payload = 'not json at all';
  const response = await call(e, '/stripe/webhook', {
    method: 'POST',
    body: payload,
    headers: await signed(payload, e.STRIPE_WEBHOOK_SECRET),
  });
  assert.equal(response.status, 400);
});

test('the webhook refuses GET', async () => {
  const { env: e } = env();
  assert.equal((await call(e, '/stripe/webhook')).status, 405);
});

// --- pipeline api ----------------------------------------------------------

test('the suppression list is not readable without the token', async () => {
  const { env: e } = env();
  assert.equal((await call(e, '/api/suppression')).status, 401);
  assert.equal(
    (await call(e, '/api/suppression', { headers: { authorization: 'Bearer wrong' } })).status,
    401,
  );
});

test('an unset API token locks the endpoint rather than opening it', async () => {
  // The direction a missing secret must fail in. Open-by-default would publish
  // other people's contact details to anyone who guessed the path.
  const { env: e } = env({ API_TOKEN: '' });
  const response = await call(e, '/api/suppression', {
    headers: { authorization: 'Bearer ' },
  });
  assert.equal(response.status, 401);
});

test('the export is JSON Lines the pipeline can write straight to disk', async () => {
  const { env: e } = env();
  const auth = { authorization: `Bearer ${e.API_TOKEN}` };
  for (const host of ['a.com', 'b.com']) {
    await call(e, '/api/suppression', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ target: host, reason: 'opted-out' }),
    });
  }

  const body = await (await call(e, '/api/suppression', { headers: auth })).text();
  const lines = body.trimEnd().split('\n');
  assert.equal(lines.length, 2);
  for (const line of lines) {
    const entry = JSON.parse(line) as { key: string; reason: string; at: string };
    assert.ok(entry.key);
    assert.equal(entry.reason, 'opted-out');
    assert.ok(Date.parse(entry.at));
  }
});

test('an empty list is empty, not the string "undefined"', async () => {
  const { env: e } = env();
  const response = await call(e, '/api/suppression', {
    headers: { authorization: `Bearer ${e.API_TOKEN}` },
  });
  assert.equal(await response.text(), '');
});

test('an unknown reason is refused rather than stored', async () => {
  // Reasons are a closed set the drafter switches on. A free-text one would
  // read as "not opted out" wherever it is compared.
  const { env: e, fake } = env();
  const response = await call(e, '/api/suppression', {
    method: 'POST',
    headers: { authorization: `Bearer ${e.API_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ target: 'acme.com', reason: 'because-i-said-so' }),
  });
  assert.equal(response.status, 400);
  assert.equal((await listSuppressions(asKv(fake))).length, 0);
});

test('a write with no target is refused', async () => {
  const { env: e } = env();
  const response = await call(e, '/api/suppression', {
    method: 'POST',
    headers: { authorization: `Bearer ${e.API_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'manual' }),
  });
  assert.equal(response.status, 400);
});

test('orders need the token too', async () => {
  const { env: e } = env();
  assert.equal((await call(e, '/api/orders')).status, 401);
  const ok = await call(e, '/api/orders', { headers: { authorization: `Bearer ${e.API_TOKEN}` } });
  assert.equal(ok.status, 200);
});

// --- routing ---------------------------------------------------------------

test('health needs nothing and says so', async () => {
  const { env: e } = env();
  const response = await call(e, '/health');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test('a trailing slash is the same route', async () => {
  const { env: e } = env();
  assert.equal((await call(e, '/health/')).status, 200);
});

test('an unknown path is a 404', async () => {
  const { env: e } = env();
  assert.equal((await call(e, '/nope')).status, 404);
  assert.equal((await call(e, '/u/only-one-part')).status, 404);
});

test('constant-time comparison still gets the answer right', async () => {
  // Timing safety is worthless if it also breaks correctness.
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(timingSafeEqual('abc', 'ab'), false);
  assert.equal(timingSafeEqual('', ''), true);
});
