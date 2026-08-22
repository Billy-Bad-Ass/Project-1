import { strict as assert } from 'node:assert';
import { createServer, type Server } from 'node:http';
import { test } from 'node:test';
import { HttpClient, PermanentHttpError } from './http';

/**
 * These run against a throwaway local server rather than a real API, so they
 * cost no quota and cannot flake on someone else's uptime.
 */

function listen(handler: Parameters<typeof createServer>[1]): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, server });
    });
  });
}

const close = (server: Server) =>
  new Promise<void>((resolve) => server.close(() => resolve()));

/**
 * Runs `body` and always tears the server down afterwards. Without the
 * `finally`, a failing assertion skips the close, the open handle keeps the
 * event loop alive, and the test run hangs rather than reporting the failure.
 */
async function withServer(
  handler: Parameters<typeof createServer>[1],
  body: (url: string) => Promise<void>,
): Promise<void> {
  const { url, server } = await listen(handler);
  const sockets: import('node:net').Socket[] = [];
  server.on('connection', (socket) => sockets.push(socket));
  try {
    await body(url);
  } finally {
    for (const socket of sockets) socket.destroy();
    await close(server);
  }
}

test('a hung connection times out instead of blocking forever', async () => {
  // The bug this covers: Node's fetch has no default timeout, so a server that
  // accepts the socket and never replies stalled an entire live run for 20
  // minutes before anyone noticed.
  await withServer(
    () => {
      /* deliberately never respond */
    },
    async (url) => {
      const client = new HttpClient({
        noCache: true,
        retries: 0,
        timeoutMs: 300,
        minIntervalMs: 0,
      });
      const started = Date.now();

      await assert.rejects(() => client.getJson(`${url}/hang`));

      const elapsed = Date.now() - started;
      assert.ok(elapsed < 5000, `expected a fast timeout, took ${elapsed}ms`);
      assert.equal(client.stats.timeouts, 1);
    },
  );
});

test('a transient 500 is retried and can then succeed', async () => {
  let calls = 0;
  await withServer(
    (_req, res) => {
      calls += 1;
      if (calls === 1) {
        res.writeHead(500);
        res.end('boom');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    },
    async (url) => {
      const client = new HttpClient({
        noCache: true,
        retries: 2,
        minIntervalMs: 0,
        timeoutMs: 2000,
      });
      const body = await client.getJson(`${url}/flaky`);

      assert.deepEqual(body, { ok: true });
      assert.equal(calls, 2);
      assert.equal(client.stats.retries, 1);
    },
  );
});

test('a 404 fails immediately rather than burning retries', async () => {
  let calls = 0;
  await withServer(
    (_req, res) => {
      calls += 1;
      res.writeHead(404);
      res.end('nope');
    },
    async (url) => {
      const client = new HttpClient({
        noCache: true,
        retries: 3,
        minIntervalMs: 0,
        timeoutMs: 2000,
      });
      await assert.rejects(() => client.getJson(`${url}/missing`), PermanentHttpError);

      // Retrying a permanent client error would just waste rate limit.
      assert.equal(calls, 1);
    },
  );
});

test('a repeat request is served from cache without hitting the network', async () => {
  let calls = 0;
  await withServer(
    (_req, res) => {
      calls += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ n: calls }));
    },
    async (url) => {
      const client = new HttpClient({ minIntervalMs: 0, timeoutMs: 2000 });
      // The port is already unique per run, so the cache key cannot collide
      // with a previous run's entry.
      const target = `${url}/cached`;

      const first = await client.getJson(target);
      const second = await client.getJson(target);

      assert.deepEqual(first, second);
      assert.equal(calls, 1, 'second request should have been served from disk cache');
      assert.equal(client.stats.hits, 1);
    },
  );
});

test('requests are spaced by the configured interval', async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    },
    async (url) => {
      const client = new HttpClient({ noCache: true, minIntervalMs: 150, timeoutMs: 2000 });
      const started = Date.now();
      await client.getJson(`${url}/a`);
      await client.getJson(`${url}/b`);
      await client.getJson(`${url}/c`);

      // Three requests at a 150ms floor cannot complete in under ~300ms.
      assert.ok(Date.now() - started >= 250, 'throttle did not space requests');
    },
  );
});
