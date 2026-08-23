import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { unsubscribeToken } from './tokens';

/**
 * The other half of a cross-package agreement.
 *
 * `audit/src/outreach/unsubscribe.ts` mints these links with Node's crypto;
 * this Worker verifies them with Web Crypto. Two implementations of one
 * algorithm drift, and the drift is invisible: links would simply start
 * returning "that link did not work" to people trying to get away from us,
 * which is the last failure anyone would report.
 *
 * So both packages assert the same frozen input and output. If either side
 * changes, one of the two suites goes red on the next commit.
 *
 * The constant below must stay identical to `EXPECTED_TOKEN` in
 * `audit/src/outreach/unsubscribe.test.ts`.
 */
const VECTOR = {
  host: 'https://WWW.Example-Practice.com/contact',
  secret: 'vector-secret-do-not-use',
  token: 'YS_5IreFs9m6iT_vvnglSLtNUhSR5wHH',
} as const;

test('the shared vector still produces the shared token', async () => {
  assert.equal(await unsubscribeToken(VECTOR.host, VECTOR.secret), VECTOR.token);
});

test('the bare host and the full URL agree, as the audit package assumes', async () => {
  assert.equal(
    await unsubscribeToken('example-practice.com', VECTOR.secret),
    await unsubscribeToken(VECTOR.host, VECTOR.secret),
  );
});
