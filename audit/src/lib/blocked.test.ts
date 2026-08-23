import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { blockedReason } from './audit';

test('a refusal aimed at bots is not a broken website', () => {
  // Live run, Fairfax County: four dental practices answered 403 in 117-252ms.
  // That is a WAF, not an outage — the sites render fine in a browser. Because
  // no content came back, every content rule failed, health fell to 10-16, and
  // all four sorted to the TOP of the outreach list. The first four emails this
  // business would ever send would have told working practices they were down.
  for (const status of [401, 403, 429]) {
    assert.ok(blockedReason(status, 120), `HTTP ${status} must be unauditable`);
  }
});

test('a single server error is not enough to claim a site is down', () => {
  assert.ok(blockedReason(500, 554));
  assert.ok(blockedReason(503, 200));
});

test('a 404 homepage is a real finding and still reported', () => {
  // This one is checkable by the owner in seconds, so it stays.
  assert.equal(blockedReason(404, 300), null);
});

test('healthy responses are auditable', () => {
  for (const status of [200, 201, 204, 301, 302]) {
    assert.equal(blockedReason(status, 400), null);
  }
});

test('an unknown status is not treated as blocked', () => {
  // A fetch failure is recorded as an error elsewhere; it must not also be
  // reclassified here, or the reason reported would be the wrong one.
  assert.equal(blockedReason(null, null), null);
});

test('the reason names the status, so a skip can be explained', () => {
  assert.match(blockedReason(403, 100) ?? '', /403/);
  assert.match(blockedReason(500, 100) ?? '', /500/);
});
