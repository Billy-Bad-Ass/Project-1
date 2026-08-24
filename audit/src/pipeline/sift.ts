import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { excludeSeen, mergeSeen, parseSeen } from '../outreach/rotation';

/**
 * Removes businesses an earlier run already handled, and updates the ledger.
 *
 *   npm run sift -- --seen path/to/seen-hosts.txt
 *
 * This is what stops a twice-daily job from re-auditing the same forty
 * practices forever. Without it every run produces a full-looking shortlist
 * containing nobody new, which is worse than an empty one: it looks like
 * progress.
 *
 * The ledger is written even when the run finds nothing fresh, so a town that
 * has been exhausted stays exhausted.
 */

const OUT = join(process.cwd(), 'out');

function log(line = ''): void {
  process.stdout.write(`${line}\n`);
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}

async function main(): Promise<void> {
  const seenFile = arg('--seen') ?? join(OUT, 'seen-hosts.txt');
  const listFile = arg('--list') ?? join(OUT, 'prospects.txt');

  const raw = await readFile(listFile, 'utf8');
  // The file is a comment header plus one website per line; the audit runner
  // reads it the same way, so the filtered file must keep that shape.
  const comments = raw.split('\n').filter((l) => l.startsWith('#'));
  const websites = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));

  let seen: string[] = [];
  try {
    seen = parseSeen(await readFile(seenFile, 'utf8'));
  } catch {
    log('No ledger yet — treating every business as new.');
  }

  const { fresh, skipped } = excludeSeen(websites, seen);

  log(`${websites.length} found · ${skipped} already seen · ${fresh.length} new`);

  await writeFile(listFile, `${[...comments, '', ...fresh].join('\n')}\n`, 'utf8');
  await writeFile(
    seenFile,
    `# Businesses already discovered. One host per line.\n# Never pruned: a business dropped from here gets approached twice.\n${mergeSeen(seen, websites).join('\n')}\n`,
    'utf8',
  );

  // Exit code, not just a message: the workflow uses it to skip the audit and
  // publish steps entirely rather than running them over an empty list and
  // producing an artifact that looks like a result.
  if (fresh.length === 0) {
    log('Nothing new here. The audit step should be skipped.');
    process.exitCode = 3;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`sift failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
