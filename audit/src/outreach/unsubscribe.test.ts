import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  UNSUBSCRIBE_VECTOR,
  unsubscribeBase,
  unsubscribeLinkFor,
  unsubscribeToken,
  unsubscribeUrl,
} from './unsubscribe';

/**
 * The same constant appears in `worker/src/tokens.test.ts`. If either
 * implementation drifts, one of the two suites goes red — rather than every
 * unsubscribe link in the wild quietly starting to 404, which is a failure
 * nobody would report because the people hitting it are people trying to get
 * away from us.
 */
const EXPECTED_TOKEN = 'YS_5IreFs9m6iT_vvnglSLtNUhSR5wHH';

function withEnv(values: Record<string, string | undefined>, run: () => void): void {
  const keys = ['AUDIT_UNSUBSCRIBE_BASE', 'AUDIT_UNSUBSCRIBE_SECRET'];
  const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const key of keys) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const key of keys) {
      const previous = before[key];
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  }
}

test('the token matches the vector the Worker also asserts', () => {
  assert.equal(
    unsubscribeToken(UNSUBSCRIBE_VECTOR.host, UNSUBSCRIBE_VECTOR.secret),
    EXPECTED_TOKEN,
  );
});

test('the token is over the normalised host, so every form of it agrees', () => {
  // The link in the email is built from whatever string the pipeline happens
  // to hold. If `www.` or a trailing slash changed the token, a link would
  // verify or not depending on which field it came from.
  const secret = 'secret';
  const canonical = unsubscribeToken('acme.com', secret);
  for (const form of ['https://www.acme.com/contact', 'WWW.Acme.com', 'acme.com.']) {
    assert.equal(unsubscribeToken(form, secret), canonical, form);
  }
});

test('different businesses get different tokens', () => {
  assert.notEqual(unsubscribeToken('a.com', 'secret'), unsubscribeToken('b.com', 'secret'));
});

test('a different secret gives a different token', () => {
  assert.notEqual(unsubscribeToken('a.com', 'one'), unsubscribeToken('a.com', 'two'));
});

test('the token is long enough not to be worth guessing', () => {
  // 32 base64url characters is 192 bits. Short enough to survive a mail
  // client wrapping the line, long enough that brute force is not a strategy.
  assert.equal(unsubscribeToken('a.com', 'secret').length, 32);
});

test('the url carries the host as well as the token', () => {
  // An HMAC is one-way: the token alone does not say who it is for, so the
  // Worker cannot know whom to suppress without this.
  const url = unsubscribeUrl('https://bba.example/', 'https://WWW.Acme.com/x', 'secret');
  assert.equal(url, `https://bba.example/u/acme.com/${unsubscribeToken('acme.com', 'secret')}`);
});

test('links are off unless both settings are present', () => {
  withEnv({ AUDIT_UNSUBSCRIBE_BASE: 'https://bba.example' }, () => {
    assert.equal(unsubscribeBase(), null);
    assert.equal(unsubscribeLinkFor('acme.com'), null);
  });
  withEnv({ AUDIT_UNSUBSCRIBE_SECRET: 'secret' }, () => {
    assert.equal(unsubscribeBase(), null);
  });
});

test('a plain-http base is refused', () => {
  // The link is the recipient's opt-out. Sending it over http means it can be
  // rewritten in transit, and an opt-out that can be rewritten is not one.
  withEnv({ AUDIT_UNSUBSCRIBE_BASE: 'http://bba.example', AUDIT_UNSUBSCRIBE_SECRET: 's' }, () => {
    assert.equal(unsubscribeBase(), null);
  });
});

test('with both set, a link is produced', () => {
  withEnv({ AUDIT_UNSUBSCRIBE_BASE: 'https://bba.example', AUDIT_UNSUBSCRIBE_SECRET: 's' }, () => {
    assert.equal(
      unsubscribeLinkFor('https://www.acme.com'),
      `https://bba.example/u/acme.com/${unsubscribeToken('acme.com', 's')}`,
    );
  });
});
