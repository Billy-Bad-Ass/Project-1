import { strict as assert } from 'node:assert';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  isSuppressed,
  loadSuppressed,
  partitionSuppressed,
  suppress,
  suppressionKey,
} from './suppression';

async function tempFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'suppress-'));
  return join(dir, 'suppressed.jsonl');
}

test('the same business is one identity however it is written', () => {
  // Someone who opts out from https://WWW.Acme.com/contact has not left the
  // door open for a follow-up to acme.com.
  const forms = [
    'acme.com',
    'ACME.com',
    'www.acme.com',
    'https://acme.com',
    'https://www.acme.com/contact',
    '  https://WWW.Acme.com/  ',
    'acme.com.',
  ];
  const keys = new Set(forms.map(suppressionKey));
  assert.equal(keys.size, 1, `expected one identity, got ${[...keys].join(', ')}`);
  assert.equal([...keys][0], 'acme.com');
});

test('different businesses stay different', () => {
  assert.notEqual(suppressionKey('acme.com'), suppressionKey('acme.co.uk'));
  assert.notEqual(suppressionKey('shop.acme.com'), suppressionKey('acme.com'));
});

test('a missing file is an empty list, not a crash', async () => {
  const entries = await loadSuppressed(join(tmpdir(), 'definitely-not-here.jsonl'));
  assert.equal(entries.size, 0);
});

test('a suppressed business is blocked on the next run', async () => {
  const file = await tempFile();
  await suppress('https://www.acme.com/contact', 'opted-out', { file });

  const entries = await loadSuppressed(file);
  assert.ok(isSuppressed('acme.com', entries));
  assert.ok(isSuppressed('http://ACME.com/quote', entries));
  assert.ok(!isSuppressed('other.com', entries));
});

test('one damaged line does not cost the whole list', async () => {
  // JSONL was chosen over a JSON array for exactly this: an unparseable
  // suppression list would otherwise mean emailing everyone on it.
  const file = await tempFile();
  await writeFile(
    file,
    [
      JSON.stringify({ key: 'first.com', reason: 'opted-out', at: '2026-01-01' }),
      '{"key": "truncated.com", "reason": "opt',
      JSON.stringify({ key: 'third.com', reason: 'complained', at: '2026-01-02' }),
      '',
    ].join('\n'),
    'utf8',
  );

  const entries = await loadSuppressed(file);
  assert.ok(entries.has('first.com'));
  assert.ok(entries.has('third.com'));
  assert.equal(entries.size, 2);
});

test('an opt-out is never downgraded by a later record', async () => {
  // Re-running discovery must not rewrite "this person asked me to stop" into
  // the softer "already contacted".
  const file = await tempFile();
  await suppress('acme.com', 'opted-out', { file, at: '2026-01-01T00:00:00.000Z' });
  await suppress('acme.com', 'already-contacted', { file, at: '2026-06-01T00:00:00.000Z' });

  const entries = await loadSuppressed(file);
  assert.equal(entries.get('acme.com')?.reason, 'opted-out');
});

test('entries are appended, never rewritten', async () => {
  const file = await tempFile();
  await suppress('one.com', 'opted-out', { file });
  await suppress('two.com', 'bounced', { file });

  const entries = await loadSuppressed(file);
  assert.deepEqual([...entries.keys()].sort(), ['one.com', 'two.com']);
});

test('partitioning keeps the blocked ones with their reason', async () => {
  const file = await tempFile();
  await suppress('blocked.com', 'complained', { file });
  const entries = await loadSuppressed(file);

  const prospects = [
    { site: 'https://allowed.com/' },
    { site: 'https://www.blocked.com/' },
    { site: 'https://also-allowed.com/' },
  ];
  const { allowed, blocked } = partitionSuppressed(prospects, (p) => p.site, entries);

  assert.equal(allowed.length, 2);
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0]?.entry.reason, 'complained');
});

test('a note survives the round trip', async () => {
  const file = await tempFile();
  await suppress('acme.com', 'manual', { file, note: 'Asked by phone on 3 Aug' });
  const entries = await loadSuppressed(file);
  assert.equal(entries.get('acme.com')?.note, 'Asked by phone on 3 Aug');
});
