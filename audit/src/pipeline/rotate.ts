import { appendFile } from 'node:fs/promises';

import { AREAS, targetFor, TRADES } from '../outreach/rotation';

/**
 * Prints the town and trade this run should work on.
 *
 *   npm run rotate
 *
 * Writes to GITHUB_OUTPUT when running in Actions so the workflow can pass the
 * values to the discovery step, and to stdout always so a human can see what a
 * given day would do without triggering anything.
 */

async function main(): Promise<void> {
  const override = process.argv.includes('--date') ? process.argv[process.argv.indexOf('--date') + 1] : null;
  const now = override ? new Date(override) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error(`--date is not a date: ${String(override)}`);

  const target = targetFor(now);
  const line = `${target.what} in ${target.where}, ${target.country}`;

  process.stdout.write(`${now.toISOString().slice(0, 10)}  ->  ${line}\n`);
  process.stdout.write(`  rotation: ${AREAS.length} areas x ${TRADES.length} trades = ${AREAS.length * TRADES.length} days per cycle\n`);

  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    await appendFile(
      out,
      `what=${target.what}\nwhere=${target.where}\ncountry=${target.country}\nlabel=${line}\n`,
      'utf8',
    );
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`rotate failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
