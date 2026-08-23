import { strict as assert } from 'node:assert';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  loadSuppressedForSending,
  pullSuppressed,
  pushLocalSuppressions,
  SuppressionUnavailable,
} from './remote-suppression';

const KEYS = ['AUDIT_SUPPRESSION_API', 'AUDIT_SUPPRESSION_TOKEN'];

async function withEnv<T>(
  values: Record<string, string | undefined>,
  run: () => Promise<T>,
): Promise<T> {
  const before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const key of KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const key of KEYS) {
      const previous = before[key];
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  }
}

const CONFIGURED = {
  AUDIT_SUPPRESSION_API: 'https://bba.example',
  AUDIT_SUPPRESSION_TOKEN: 'token',
};

function jsonl(entries: Array<Record<string, unknown>>): string {
  return entries.map((entry) => JSON.stringify(entry)).join('\n');
}

function respondWith(body: string, status = 200): typeof globalThis.fetch {
  return (async () => new Response(body, { status })) as unknown as typeof globalThis.fetch;
}

async function localFile(lines: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sup-'));
  const file = join(dir, 'suppressed.jsonl');
  await writeFile(file, lines, 'utf8');
  return file;
}

test('with no shared store configured, the local file is the whole list', async () => {
  // The shared list is an upgrade, not a prerequisite. Requiring it would mean
  // a misconfigured Worker stops the business.
  const file = await localFile(jsonl([{ key: 'a.com', reason: 'opted-out', at: '2026-01-01T00:00:00.000Z' }]));
  const result = await withEnv({}, () => loadSuppressedForSending({ file }));

  assert.equal(result.source, 'local');
  assert.equal(result.entries.size, 1);
});

test('a shared store that cannot be reached stops the run', async () => {
  // The most important behaviour in this file. "Configured but unreachable" is
  // exactly the state where carrying on looks fine and emails people who
  // opted out — so it is a hard stop, not a warning.
  const file = await localFile('');
  const failing = (async () => {
    throw new Error('connect ECONNREFUSED');
  }) as unknown as typeof globalThis.fetch;

  await assert.rejects(
    () => withEnv(CONFIGURED, () => loadSuppressedForSending({ file, fetchImpl: failing })),
    SuppressionUnavailable,
  );
});

test('a rejected token stops the run and says which setting is wrong', async () => {
  // A 401 arrives as a perfectly well-formed response. Without this it would
  // read as "the shared list is empty", which is the worst possible reading.
  const file = await localFile('');
  await assert.rejects(
    () =>
      withEnv(CONFIGURED, () =>
        loadSuppressedForSending({ file, fetchImpl: respondWith('', 401) }),
      ),
    (error: Error) => {
      assert.ok(error instanceof SuppressionUnavailable);
      assert.match(error.message, /AUDIT_SUPPRESSION_TOKEN/);
      return true;
    },
  );
});

test('a server error stops the run too', async () => {
  const file = await localFile('');
  await assert.rejects(
    () =>
      withEnv(CONFIGURED, () =>
        loadSuppressedForSending({ file, fetchImpl: respondWith('', 500) }),
      ),
    SuppressionUnavailable,
  );
});

test('both lists are honoured, not just whichever is larger', async () => {
  const file = await localFile(
    jsonl([{ key: 'local-only.com', reason: 'opted-out', at: '2026-01-01T00:00:00.000Z' }]),
  );
  const shared = jsonl([{ key: 'shared-only.com', reason: 'opted-out', at: '2026-02-01T00:00:00.000Z' }]);

  const result = await withEnv(CONFIGURED, () =>
    loadSuppressedForSending({ file, fetchImpl: respondWith(shared) }),
  );

  assert.equal(result.source, 'local+shared');
  assert.equal(result.entries.size, 2);
  assert.ok(result.entries.has('local-only.com'));
  assert.ok(result.entries.has('shared-only.com'));
});

test('on a conflict the earlier record wins', async () => {
  // Same first-write-wins rule the local file uses. A later
  // 'already-contacted' must never overwrite an earlier 'opted-out'.
  const file = await localFile(
    jsonl([{ key: 'a.com', reason: 'opted-out', at: '2026-01-01T00:00:00.000Z' }]),
  );
  const shared = jsonl([{ key: 'a.com', reason: 'already-contacted', at: '2026-06-01T00:00:00.000Z' }]);

  const result = await withEnv(CONFIGURED, () =>
    loadSuppressedForSending({ file, fetchImpl: respondWith(shared) }),
  );

  assert.equal(result.entries.size, 1);
  assert.equal(result.entries.get('a.com')?.reason, 'opted-out');
});

test('an empty shared list is a valid answer, not a failure', async () => {
  const file = await localFile('');
  const result = await withEnv(CONFIGURED, () =>
    loadSuppressedForSending({ file, fetchImpl: respondWith('') }),
  );
  assert.equal(result.source, 'local+shared');
  assert.equal(result.entries.size, 0);
});

test('a damaged line in the shared response costs one record, not the list', async () => {
  const file = await localFile('');
  const body = `${JSON.stringify({ key: 'a.com', reason: 'opted-out', at: '2026-01-01T00:00:00.000Z' })}\n{ truncated\n${JSON.stringify({ key: 'b.com', reason: 'opted-out', at: '2026-01-02T00:00:00.000Z' })}\n`;

  const result = await withEnv(CONFIGURED, () =>
    loadSuppressedForSending({ file, fetchImpl: respondWith(body) }),
  );
  assert.equal(result.entries.size, 2);
});

test('the request carries the bearer token', async () => {
  let seen: string | null = null;
  const spy = (async (_url: string, init?: RequestInit) => {
    seen = new Headers(init?.headers).get('authorization');
    return new Response('');
  }) as unknown as typeof globalThis.fetch;

  await pullSuppressed({ base: 'https://bba.example', token: 'abc' }, spy);
  assert.equal(seen, 'Bearer abc');
});

test('sync pushes only what the shared store is missing', async () => {
  const file = await localFile(
    jsonl([
      { key: 'already.com', reason: 'opted-out', at: '2026-01-01T00:00:00.000Z' },
      { key: 'new.com', reason: 'opted-out', at: '2026-01-02T00:00:00.000Z' },
    ]),
  );
  const posted: string[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    if ((init?.method ?? 'GET') === 'GET') {
      return new Response(
        jsonl([{ key: 'already.com', reason: 'opted-out', at: '2026-01-01T00:00:00.000Z' }]),
      );
    }
    posted.push(String(init?.body));
    return new Response(JSON.stringify({ ok: true, created: true }));
  }) as unknown as typeof globalThis.fetch;

  const result = await withEnv(CONFIGURED, () => pushLocalSuppressions({ file, fetchImpl: impl }));

  assert.equal(result.pushed, 1);
  assert.equal(result.alreadyThere, 1);
  assert.equal(posted.length, 1);
  assert.match(posted[0] ?? '', /new\.com/);
});

test('sync without configuration says so rather than doing nothing quietly', async () => {
  const file = await localFile('');
  await assert.rejects(
    () => withEnv({}, () => pushLocalSuppressions({ file })),
    /AUDIT_SUPPRESSION_API/,
  );
});
