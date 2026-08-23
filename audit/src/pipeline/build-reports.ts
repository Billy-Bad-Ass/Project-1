import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loadEnv } from '../lib/env';
import { reportSlug } from '../lib/slug';
import type { SiteAudit } from '../lib/types';
import { qualify } from '../outreach/qualify';
import { renderReport } from '../report/render';

loadEnv();

/**
 * Writes one HTML report per prospect worth contacting.
 *
 *   npm run report
 *
 * The `report` script has pointed at this filename since the beginning and the
 * file was never written, so `npm run report` failed with ERR_MODULE_NOT_FOUND.
 * Nothing noticed, because nothing else needs it — until you go to send the
 * outreach, every draft of which says "I put everything in a short report —
 * it's attached". Eleven emails promising an attachment that could not be
 * produced.
 *
 * Reports are generated for exactly the audits `qualify()` selects, which is
 * the same function the drafter uses. Generating for all of them instead would
 * leave reports lying around for businesses we decided not to contact — files
 * that could be sent by accident to someone we had a reason to leave alone.
 */

const OUT = join(process.cwd(), 'out');
const REPORTS = join(OUT, 'reports');

function log(line = ''): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<void> {
  let audits: SiteAudit[];
  try {
    audits = JSON.parse(await readFile(join(OUT, 'audits.json'), 'utf8')) as SiteAudit[];
  } catch {
    throw new Error('No out/audits.json. Run `npm run audit -- --list yourlist.txt` first.');
  }

  const { contact } = qualify(audits);
  if (contact.length === 0) {
    log('Nothing qualified, so there is nothing to report on.');
    return;
  }

  await mkdir(REPORTS, { recursive: true });

  for (const { audit, tier } of contact) {
    const slug = reportSlug(audit.finalUrl);
    const file = join(REPORTS, `${slug}.html`);
    await writeFile(file, renderReport(audit), 'utf8');
    log(`  reports/${slug}.html  · tier ${tier} · ${audit.findings.length} findings`);
  }

  log('');
  log(`Wrote ${contact.length} report(s) to out/reports/`);
  log('Each one is the attachment its draft in out/emails/ refers to.');
}

main().catch((error: unknown) => {
  process.stderr.write(
    `\nbuild-reports failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
