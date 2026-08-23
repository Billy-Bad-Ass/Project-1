import { loadEnv } from '../lib/env';
import {
  loadSuppressedForSending,
  pushLocalSuppressions,
  remoteStore,
  SuppressionUnavailable,
} from '../outreach/remote-suppression';
import { suppress, type SuppressionReason } from '../outreach/suppression';

loadEnv();

/**
 * Moves opt-outs between the local file and the shared store.
 *
 *   npm run suppress -- --status
 *   npm run suppress -- --push
 *   npm run suppress -- acme.com "asked by reply"
 *
 * Adding one by hand writes it to both, in that order — local first, because
 * the local file is the copy that cannot fail, and a record that exists
 * nowhere because the network was down is the failure this whole list exists
 * to prevent.
 */

function log(line = ''): void {
  process.stdout.write(`${line}\n`);
}

interface Args {
  push: boolean;
  status: boolean;
  target: string | null;
  note: string | null;
  reason: SuppressionReason;
}

function parseArgs(argv: string[]): Args {
  const rest: string[] = [];
  let reason: SuppressionReason = 'opted-out';
  let push = false;
  let status = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--push') push = true;
    else if (arg === '--status') status = true;
    else if (arg === '--reason') {
      const value = argv[i + 1];
      if (value) {
        reason = value as SuppressionReason;
        i += 1;
      }
    } else if (arg !== undefined && !arg.startsWith('--')) rest.push(arg);
  }

  return { push, status, target: rest[0] ?? null, note: rest[1] ?? null, reason };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const store = remoteStore();

  if (args.status || (!args.push && !args.target)) {
    log(store ? `Shared store: ${store.base}` : 'Shared store: not configured (local file only)');
    try {
      const list = await loadSuppressedForSending();
      log(`Suppressed:   ${list.entries.size} business(es) [${list.source}]`);
      for (const entry of [...list.entries.values()].slice(0, 20)) {
        log(`  ${entry.key} — ${entry.reason} (${entry.at.slice(0, 10)})`);
      }
      if (list.entries.size > 20) log(`  … and ${list.entries.size - 20} more`);
    } catch (error) {
      if (error instanceof SuppressionUnavailable) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
        return;
      }
      throw error;
    }
    if (!args.push && !args.target) {
      log('');
      log('  --push            copy local entries the shared store is missing');
      log('  <host> [note]     add one, to both');
    }
    if (!args.push) return;
  }

  if (args.target) {
    // Local first. If the network write fails the record still exists, and the
    // next --push will carry it up.
    const entry = await suppress(args.target, args.reason, {
      ...(args.note ? { note: args.note } : {}),
    });
    log(`Recorded locally: ${entry.key} — ${entry.reason}`);
    if (!store) {
      log('No shared store configured, so that is the only copy.');
      return;
    }
  }

  if (!store) {
    process.stderr.write(
      'AUDIT_SUPPRESSION_API and AUDIT_SUPPRESSION_TOKEN are not set, so there is\n' +
        'nothing to push to. Set them in .env.local.\n',
    );
    process.exitCode = 1;
    return;
  }

  try {
    const result = await pushLocalSuppressions();
    log(`Pushed ${result.pushed}, already there ${result.alreadyThere}.`);
    log(`Shared store now holds ${result.sharedTotal}.`);
  } catch (error) {
    if (error instanceof SuppressionUnavailable) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`\nsuppress failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
