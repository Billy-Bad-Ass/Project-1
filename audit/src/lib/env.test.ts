import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

/** Each test needs a fresh module, since loading is once-per-process. */
async function freshLoad(dir: string): Promise<void> {
  const mod = await import(`./env.ts?bust=${Math.random()}`);
  (mod as { loadEnv: (cwd?: string) => void }).loadEnv(dir);
}

function sandbox(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'envtest-'));
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(dir, name), contents, 'utf8');
  }
  return dir;
}

test('values are read from .env.local', async () => {
  const dir = sandbox({ '.env.local': 'ENVTEST_A=hello\n' });
  delete process.env.ENVTEST_A;
  await freshLoad(dir);
  assert.equal(process.env.ENVTEST_A, 'hello');
});

test('a real environment variable is never clobbered', async () => {
  // CI and one-off overrides must win over a file left on disk.
  const dir = sandbox({ '.env.local': 'ENVTEST_B=from-file\n' });
  process.env.ENVTEST_B = 'from-shell';
  await freshLoad(dir);
  assert.equal(process.env.ENVTEST_B, 'from-shell');
});

test('quotes people add out of habit are stripped', async () => {
  const dir = sandbox({ '.env.local': 'ENVTEST_C="quoted value"\nENVTEST_D=\'single\'\n' });
  delete process.env.ENVTEST_C;
  delete process.env.ENVTEST_D;
  await freshLoad(dir);
  assert.equal(process.env.ENVTEST_C, 'quoted value');
  assert.equal(process.env.ENVTEST_D, 'single');
});

test('comments and blank lines are ignored', async () => {
  const dir = sandbox({ '.env.local': '# a comment\n\nENVTEST_E=ok\n' });
  delete process.env.ENVTEST_E;
  await freshLoad(dir);
  assert.equal(process.env.ENVTEST_E, 'ok');
});

test('a value containing = survives intact', async () => {
  // Stripe keys and base64 values both contain them.
  const dir = sandbox({ '.env.local': 'ENVTEST_F=a=b=c\n' });
  delete process.env.ENVTEST_F;
  await freshLoad(dir);
  assert.equal(process.env.ENVTEST_F, 'a=b=c');
});

test('a missing file is not an error', async () => {
  const dir = sandbox({});
  await assert.doesNotReject(() => freshLoad(dir));
});
