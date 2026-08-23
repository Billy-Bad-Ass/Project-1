import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collect, funnel, rows } from '../dashboard/collect';
import { renderDashboard } from '../dashboard/render';

/**
 * Build the pipeline dashboard from whatever the other commands have produced.
 *
 *   npm run dashboard
 *
 * Reads only. It never writes to the pipeline's own files, so running it can
 * never damage the state it is reporting on.
 */

const OUT = join(process.cwd(), 'out');
const log = (message: string) => process.stdout.write(`${message}\n`);

async function main(): Promise<void> {
  const snapshot = await collect();
  const table = rows(snapshot);
  const f = funnel(snapshot);

  await mkdir(OUT, { recursive: true });
  const file = join(OUT, 'dashboard.html');
  await writeFile(file, renderDashboard(snapshot, table), 'utf8');

  log(`found ${f.found} · audited ${f.audited} · worth contacting ${f.worthContacting}`);
  log(`emailed ${f.contacted} · replied ${f.replied} · paying ${f.clients} · earned ${f.revenue}`);

  const waiting = table.filter((r) => r.stage === 'replied');
  if (waiting.length > 0) {
    log('');
    log('Waiting on you:');
    for (const r of waiting) log(`  ${r.name ?? r.host}`);
  }

  if (snapshot.missing.includes('contacts.json')) {
    log('');
    log('No contacts.json yet — that is the file where you record who you');
    log('emailed and who replied. Nothing else can know that. Format:');
    log('  [{ "host": "acme.co.uk", "sentAt": "2026-08-22", "outcome": "client", "paid": 450 }]');
  }

  log('');
  log(`  ${file}`);
}

main().catch((error: unknown) => {
  process.stderr.write(`\ndashboard failed: ${String(error)}\n`);
  process.exitCode = 1;
});
