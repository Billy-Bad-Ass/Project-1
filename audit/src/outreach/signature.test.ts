import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { buildSignaturePage, signatureHtml } from './signature';
import { closing, signatureInClient } from './draft';
import type { ComplianceConfig } from './compliance';
import type { SenderConfig } from '../report/config';

const from: SenderConfig = {
  business: 'BBA Network',
  email: 'hello@example.com',
  offer: 'x',
  accent: '#2B5CE6',
};

const compliance: ComplianceConfig = {
  postalAddress: '1 Example St, Springfield, IL 62701',
  optOut: { kind: 'reply', instruction: 'Reply "stop" and I will never contact you again.' },
};

const logo = 'data:image/png;base64,AAAA';

function withFlag(value: string | undefined, run: () => void): void {
  const before = process.env.AUDIT_SIGNATURE_IN_CLIENT;
  if (value === undefined) delete process.env.AUDIT_SIGNATURE_IN_CLIENT;
  else process.env.AUDIT_SIGNATURE_IN_CLIENT = value;
  try {
    run();
  } finally {
    if (before === undefined) delete process.env.AUDIT_SIGNATURE_IN_CLIENT;
    else process.env.AUDIT_SIGNATURE_IN_CLIENT = before;
  }
}

test('the signature carries the logo, the address and the way out', () => {
  const html = signatureHtml({ from, compliance, logo });
  assert.match(html, /<img src="data:image\/png;base64,/);
  assert.match(html, /Springfield, IL 62701/);
  assert.match(html, /Reply &quot;stop&quot;|Reply "stop"/);
  assert.match(html, /hello@example\.com/);
});

test('the logo has alt text and fixed dimensions', () => {
  // A signature image with no alt text renders as an empty gap in every client
  // that blocks images by default, which is most of them on first contact.
  const html = signatureHtml({ from, compliance, logo });
  assert.match(html, /alt="BBA Network"/);
  assert.match(html, /width="190"/);
  assert.match(html, /height="72"/);
});

test('the markup is email-safe, not browser-CSS', () => {
  // Email clients discard class attributes and do not implement flexbox or
  // grid. Anything structural has to be a table and anything visual inline.
  const html = signatureHtml({ from, compliance, logo });
  assert.match(html, /<table/);
  assert.doesNotMatch(html, /class=/);
  assert.doesNotMatch(html, /display:\s*flex/);
  assert.doesNotMatch(html, /display:\s*grid/);
});

test('a personal name appears when set and is absent when not', () => {
  assert.doesNotMatch(signatureHtml({ from, compliance, logo }), /Sam/);
  assert.match(signatureHtml({ from: { ...from, name: 'Sam' }, compliance, logo }), /Sam/);
});

test('the flag is off unless explicitly true', () => {
  // Off by default on purpose: on by default would strip the footer from every
  // draft belonging to anyone who had not installed the signature yet.
  for (const value of [undefined, '', 'false', 'yes', '1', 'TRUE ']) {
    withFlag(value, () => {
      const expected = value?.trim().toLowerCase() === 'true';
      assert.equal(signatureInClient(), expected, `for ${JSON.stringify(value)}`);
    });
  }
});

test('the draft closing drops what the client will add, and keeps what it cannot', () => {
  withFlag('true', () => {
    const lines = closing(from, 'acme.com', compliance).join('\n');
    // The client supplies these.
    assert.doesNotMatch(lines, /Springfield, IL 62701/);
    assert.doesNotMatch(lines, /Reply "stop"/);
    // It cannot supply this: it names the specific recipient's site.
    assert.match(lines, /acme\.com/);
  });
});

test('with the flag off the draft carries everything itself', () => {
  withFlag(undefined, () => {
    const lines = closing(from, 'acme.com', compliance).join('\n');
    assert.match(lines, /Springfield, IL 62701/);
    assert.match(lines, /Reply "stop"/);
    assert.match(lines, /BBA Network/);
  });
});

test('the install page previews on white regardless of the reader theme', () => {
  // Email grounds are white almost everywhere, so a dark-mode preview would
  // show the signature on a surface it will never actually sit on.
  const page = buildSignaturePage(signatureHtml({ from, compliance, logo }));
  assert.match(page, /\.preview\{background:#fff/);
});

test('the install page is theme-aware in every other respect', () => {
  const page = buildSignaturePage('<table></table>');
  assert.match(page, /:root:not\(\[data-theme="light"\]\)/);
  assert.match(page, /:root\[data-theme="dark"\]/);
  assert.match(page, /background:var\(--bg\)/);
});
