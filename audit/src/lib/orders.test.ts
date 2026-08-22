import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type Stripe from 'stripe';
import { customFieldValue, siteUrlFrom, toOrder } from './orders';

/**
 * These cover the ways a paid order can fail to become a delivered report.
 * Each one is a customer who has handed over money and is waiting.
 */

type Field = Stripe.Checkout.Session.CustomField;

const textField = (key: string, value: string): Field =>
  ({
    key,
    label: { type: 'custom', custom: key },
    type: 'text',
    text: { value, maximum_length: null, minimum_length: null, default_value: null },
    optional: false,
    dropdown: null,
    numeric: null,
  }) as unknown as Field;

const session = (fields: Field[], extra: Partial<Stripe.Checkout.Session> = {}) =>
  ({
    id: 'cs_test_123',
    custom_fields: fields,
    customer_details: { email: 'owner@example.com' },
    customer_email: null,
    amount_total: 9900,
    currency: 'gbp',
    created: 1_700_000_000,
    payment_status: 'paid',
    ...extra,
  }) as unknown as Stripe.Checkout.Session;

test('the website field is found by its key', () => {
  const url = siteUrlFrom(session([textField('website', 'https://acme.co.uk')]));
  assert.equal(url, 'https://acme.co.uk');
});

test('key matching tolerates spacing and capitalisation', () => {
  // The key is whatever the person setting up the Payment Link typed.
  for (const key of ['Website', 'website_address', 'siteURL', 'Site Url']) {
    const url = siteUrlFrom(session([textField(key, 'acme.co.uk')]));
    assert.equal(url, 'acme.co.uk', `failed for key "${key}"`);
  }
});

test('a mislabelled field still yields the address if it looks like one', () => {
  // Someone has paid. Losing their order because the field was named
  // "your_site_pls" would be the worst possible failure mode.
  const url = siteUrlFrom(session([textField('your_site_pls', 'acme.co.uk')]));
  assert.equal(url, 'acme.co.uk');
});

test('free text that is not an address is not mistaken for one', () => {
  const url = siteUrlFrom(session([textField('notes', 'please call me first')]));
  assert.equal(url, null);
});

test('an empty field is treated as missing, not as an empty address', () => {
  assert.equal(siteUrlFrom(session([textField('website', '   ')])), null);
});

test('a session with no custom fields at all yields null rather than throwing', () => {
  assert.equal(siteUrlFrom(session([])), null);
  const bare = { id: 'cs_1' } as unknown as Stripe.Checkout.Session;
  assert.equal(siteUrlFrom(bare), null);
});

test('the first genuine website field wins over later free text', () => {
  const url = siteUrlFrom(
    session([textField('notes', 'call me'), textField('website', 'acme.co.uk')]),
  );
  assert.equal(url, 'acme.co.uk');
});

test('an unknown field type yields null instead of leaking an object', () => {
  // Without this, "[object Object]" reaches a customer-facing report.
  const weird = { key: 'x', type: 'something_new' } as unknown as Field;
  assert.equal(customFieldValue(weird), null);
});

test('an order captures who paid, how much, and what to audit', () => {
  const order = toOrder(session([textField('website', 'https://acme.co.uk')]));
  assert.equal(order.sessionId, 'cs_test_123');
  assert.equal(order.siteUrl, 'https://acme.co.uk');
  assert.equal(order.email, 'owner@example.com');
  assert.equal(order.amountPaid, 9900);
  assert.equal(order.currency, 'gbp');
  assert.match(order.paidAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('email falls back to customer_email when customer_details is absent', () => {
  const order = toOrder(
    session([textField('website', 'a.com')], {
      customer_details: null,
      customer_email: 'fallback@example.com',
    }),
  );
  assert.equal(order.email, 'fallback@example.com');
});

test('every custom field is preserved so nothing the customer typed is lost', () => {
  const order = toOrder(
    session([textField('website', 'acme.co.uk'), textField('notes', 'urgent please')]),
  );
  assert.deepEqual(order.fields, { website: 'acme.co.uk', notes: 'urgent please' });
});
