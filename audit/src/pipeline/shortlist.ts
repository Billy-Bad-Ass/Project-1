import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SiteAudit } from '../lib/types';
import { qualify, TIER_ADVICE } from '../outreach/qualify';

/**
 * The morning's answer to "who should I contact today".
 *
 *   npm run shortlist
 *
 * Written to the Actions job summary as well as a file, because a scheduled
 * run nobody opens is a scheduled run nobody benefits from. The summary is the
 * first thing shown on the run page.
 *
 * Findings are named but not quoted at length: this is a list to act on, not
 * the report. The report is generated locally when the email is written.
 */

const OUT = join(process.cwd(), 'out');

function escapePipes(text: string): string {
  return text.replace(/\|/g, '\\|');
}

async function main(): Promise<void> {
  const label = process.env.RUN_LABEL ?? 'this run';
  let audits: SiteAudit[];
  try {
    audits = JSON.parse(await readFile(join(OUT, 'audits.json'), 'utf8')) as SiteAudit[];
  } catch {
    throw new Error('No out/audits.json — the audit step did not run.');
  }

  const { contact, skipped } = qualify(audits);

  const lines: string[] = [
    `## ${contact.length} worth contacting — ${label}`,
    '',
  ];

  if (contact.length === 0) {
    lines.push('Nothing qualified. Either the town is already covered, or every site found was unreachable.');
  } else {
    lines.push('| # | Business | Score | Opens on | What to do |');
    lines.push('|---|---|---|---|---|');
    contact.forEach(({ audit, tier }, i) => {
      const host = audit.finalUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const opens = audit.findings[0]?.ruleId ?? '—';
      lines.push(
        `| ${i + 1} | ${escapePipes(host)} | ${audit.opportunityScore} | ${escapePipes(opens)} | ${escapePipes(TIER_ADVICE[tier])} |`,
      );
    });
  }

  if (skipped.length > 0) {
    const byReason = new Map<string, number>();
    for (const { why } of skipped) byReason.set(why.id, (byReason.get(why.id) ?? 0) + 1);
    lines.push('', `**Not contacting ${skipped.length}:** ` +
      [...byReason].map(([id, n]) => `${n} ${id}`).join(' · '));
  }

  lines.push(
    '',
    '_Nothing has been sent. Pull the audits locally and draft:_',
    '```',
    'git fetch origin live-data',
    'git show origin/live-data:audits-top.json > audit/out/audits.json',
    'cd audit && npm run report && npm run draft',
    '```',
  );

  const markdown = `${lines.join('\n')}\n`;
  await writeFile(join(OUT, 'shortlist.md'), markdown, 'utf8');

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) await appendFile(summary, markdown, 'utf8');

  process.stdout.write(markdown);
}

main().catch((error: unknown) => {
  process.stderr.write(`shortlist failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
