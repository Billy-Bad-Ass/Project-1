import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { buildReportEmail, hostOf, redactEmail } from './resend';
import { isMissingObject } from './r2-ledger';

test('the report email attaches the report and addresses the right host', () => {
  const email = buildReportEmail({
    to: 'owner@paying-customer.com',
    siteUrl: 'https://www.paying-customer.com/',
    reportHtml: '<html>report</html>',
    from: 'BBA Network <audit@bbanetwork.org>',
  });

  assert.equal(email.to, 'owner@paying-customer.com');
  assert.match(email.subject, /paying-customer\.com/);
  assert.equal(email.attachments.length, 1);
  assert.match(email.attachments[0]!.filename, /paying-customer\.com\.html$/);
  // Base64, so the HTML survives the JSON body without escaping surprises.
  assert.equal(
    Buffer.from(email.attachments[0]!.content, 'base64').toString('utf8'),
    '<html>report</html>',
  );
});

test('a garbage site URL still yields a usable filename, not a crash', () => {
  assert.equal(hostOf('not a url at all'), 'not a url at all');
  assert.equal(hostOf('www.example.com/path'), 'example.com');
});

test('customer addresses are redacted for public logs', () => {
  // Scheduled-run logs on a public repository are public; an address in one
  // is a leak exactly like committing it.
  assert.equal(redactEmail('owner@paying-customer.com'), 'o***@paying-customer.com');
  assert.equal(redactEmail(null), '(no email)');
  assert.equal(redactEmail('nonsense'), '(malformed address)');
});

test('a missing ledger object is distinguished from an unreachable bucket', () => {
  // Load-bearing: a first run must see an empty ledger and proceed, but a
  // run that cannot reach R2 must stop — an unreadable ledger treated as
  // empty would re-email every order ever paid.
  assert.equal(isMissingObject('Failed to fetch ... - 404: Not Found'), true);
  assert.equal(isMissingObject('The specified key does not exist'), true);
  assert.equal(isMissingObject('Authentication error [code: 10000]'), false);
  assert.equal(isMissingObject('fetch failed: getaddrinfo ENOTFOUND'), false);
});
