import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { accessToken, buildMime, createDraft, sendMessage, type Outgoing } from './gmail';

const BASE: Outgoing = {
  to: 'reception@acme-dental.com',
  from: 'BBA Network <hello@example.com>',
  subject: "acme-dental.com is showing a \"not secure\" warning",
  body: 'Hi,\n\nOne line about the site.\n',
};

function decode(raw: string): string {
  return Buffer.from(raw, 'base64url').toString('utf8');
}

test('a plain message is not multipart', () => {
  // A multipart message with one part is legal and renders as an empty
  // attachment in some clients. The no-attachment case is the common one.
  const mime = buildMime(BASE);
  assert.match(mime, /Content-Type: text\/plain; charset="UTF-8"/);
  assert.doesNotMatch(mime, /multipart/);
  assert.match(mime, /One line about the site\./);
});

test('headers and body are separated by a blank line', () => {
  // Get this wrong and the whole message renders as headers, or the subject
  // appears in the body. It is the one structural rule of RFC 5322.
  const mime = buildMime(BASE);
  const [head, ...rest] = mime.split('\r\n\r\n');
  assert.match(head!, /^From: /m);
  assert.ok(rest.join('\r\n\r\n').startsWith('Hi,'));
});

test('a non-ASCII subject is encoded rather than sent raw', () => {
  // A raw 8-bit byte in a header is invalid: it is either rejected outright or
  // shown to the recipient as mojibake, on the first line they read.
  const mime = buildMime({ ...BASE, subject: 'Café Dental — your site' });
  assert.doesNotMatch(mime, /Subject: Café/);
  assert.match(mime, /Subject: =\?UTF-8\?B\?/);
});

test('an ASCII subject is left alone', () => {
  assert.match(buildMime(BASE).split('\r\n').find((l) => l.startsWith('Subject:'))!, /not secure/);
});

test('an attachment produces a multipart message that closes properly', () => {
  // An unterminated boundary means the attachment silently does not arrive —
  // and every draft in this pipeline says "it's attached".
  const mime = buildMime({
    ...BASE,
    attachments: [{ filename: 'report.html', mimeType: 'text/html', content: '<h1>Report</h1>' }],
  });

  const boundary = /boundary="([^"]+)"/.exec(mime)?.[1];
  assert.ok(boundary, 'no boundary declared');
  assert.equal(mime.split(`--${boundary}`).length - 1, 3, 'expected two parts and a closing marker');
  assert.ok(mime.trimEnd().endsWith(`--${boundary}--`), 'multipart not closed');
  assert.match(mime, /Content-Disposition: attachment; filename="report\.html"/);
  assert.match(mime, /Content-Transfer-Encoding: base64/);
});

test('the attachment survives a round trip', () => {
  const content = '<h1>Report</h1><p>' + 'x'.repeat(300) + '</p>';
  const mime = buildMime({
    ...BASE,
    attachments: [{ filename: 'r.html', mimeType: 'text/html', content }],
  });
  const encoded = mime.split('\r\n\r\n').pop()!.replace(/\r\n--.*$/s, '').trim();
  assert.equal(Buffer.from(encoded.replace(/\r\n/g, ''), 'base64').toString('utf8'), content);
});

test('base64 lines stay within the length a mail server will accept', () => {
  // A single enormous line is rejected or truncated by some servers, which
  // corrupts the attachment rather than failing the send.
  const mime = buildMime({
    ...BASE,
    attachments: [{ filename: 'r.html', mimeType: 'text/html', content: 'y'.repeat(5000) }],
  });
  for (const line of mime.split('\r\n')) assert.ok(line.length <= 998, `line too long: ${line.length}`);
});

test('one-click unsubscribe needs both headers or neither', () => {
  // List-Unsubscribe alone only gives the provider a link to display; the
  // -Post header is what makes their own button work in place.
  const withUrl = buildMime({ ...BASE, unsubscribeUrl: 'https://x.example/u/acme.com/tok' });
  assert.match(withUrl, /^List-Unsubscribe: <https:\/\/x\.example\/u\/acme\.com\/tok>$/m);
  assert.match(withUrl, /^List-Unsubscribe-Post: List-Unsubscribe=One-Click$/m);

  const without = buildMime(BASE);
  assert.doesNotMatch(without, /List-Unsubscribe/);
});

test('a null unsubscribe url adds no headers', () => {
  assert.doesNotMatch(buildMime({ ...BASE, unsubscribeUrl: null }), /List-Unsubscribe/);
});

// --- transport -------------------------------------------------------------

test('a draft goes to the drafts endpoint and a send does not', async () => {
  // The whole safety story rests on these being different calls. A draft that
  // quietly used messages/send would be irreversible.
  const calls: string[] = [];
  const spy = (async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ id: 'x1' }));
  }) as unknown as typeof globalThis.fetch;

  await createDraft(BASE, 'token', spy);
  await sendMessage(BASE, 'token', spy);

  assert.match(calls[0]!, /\/drafts$/);
  assert.match(calls[1]!, /\/messages\/send$/);
});

test('a draft wraps the raw message, a send does not', async () => {
  // Gmail rejects the wrong shape for each endpoint, and the error it returns
  // does not say which way round it wanted them.
  const bodies: string[] = [];
  const spy = (async (_url: string, init?: RequestInit) => {
    bodies.push(String(init?.body));
    return new Response(JSON.stringify({ id: 'x' }));
  }) as unknown as typeof globalThis.fetch;

  await createDraft(BASE, 'token', spy);
  await sendMessage(BASE, 'token', spy);

  const draft = JSON.parse(bodies[0]!) as { message?: { raw?: string } };
  const send = JSON.parse(bodies[1]!) as { raw?: string };
  assert.ok(draft.message?.raw, 'draft must nest raw under message');
  assert.ok(send.raw, 'send must put raw at the top level');
  assert.match(decode(draft.message.raw), /^From: /);
});

test('the bearer token is sent', async () => {
  let auth: string | null = null;
  const spy = (async (_url: string, init?: RequestInit) => {
    auth = new Headers(init?.headers).get('authorization');
    return new Response(JSON.stringify({ id: 'x' }));
  }) as unknown as typeof globalThis.fetch;

  await createDraft(BASE, 'tok123', spy);
  assert.equal(auth, 'Bearer tok123');
});

test('a rejected refresh token says what Google said', async () => {
  // invalid_grant is the common failure — a revoked token — and the status
  // code alone gives no clue which of the three settings is wrong.
  const spy = (async () =>
    new Response('{"error":"invalid_grant"}', { status: 400 })) as unknown as typeof globalThis.fetch;

  await assert.rejects(
    () => accessToken({ clientId: 'a', clientSecret: 'b', refreshToken: 'c' }, spy),
    /invalid_grant/,
  );
});

test('an API failure is surfaced, not swallowed', async () => {
  const spy = (async () =>
    new Response('quota exceeded', { status: 429 })) as unknown as typeof globalThis.fetch;
  await assert.rejects(() => sendMessage(BASE, 'tok', spy), /429/);
});

test('the refresh exchange asks for the right grant', async () => {
  let body = '';
  const spy = (async (_url: string, init?: RequestInit) => {
    body = String(init?.body);
    return new Response(JSON.stringify({ access_token: 'at' }));
  }) as unknown as typeof globalThis.fetch;

  const token = await accessToken({ clientId: 'id', clientSecret: 'sec', refreshToken: 'rt' }, spy);
  assert.equal(token, 'at');
  assert.match(body, /grant_type=refresh_token/);
  assert.match(body, /refresh_token=rt/);
});
