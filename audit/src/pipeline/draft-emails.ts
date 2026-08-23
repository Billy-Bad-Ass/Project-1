import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { draftFirstEmail, draftFollowUp, signalSpread, type EmailDraft } from '../outreach/draft';
import { reportSlug } from '../lib/slug';
import type { SiteAudit } from '../lib/types';
import { complianceConfig, MissingComplianceConfig } from '../outreach/compliance';
import { loadSuppressed, partitionSuppressed } from '../outreach/suppression';

/**
 * Write an outreach draft for every audited site.
 *
 *   npm run draft                      drafts for everything audited
 *   npm run draft -- --min-opportunity 60   only the worthwhile ones
 *   npm run draft -- --follow-up       the single follow-up instead
 *
 * Writes files. Sends nothing, and has no ability to.
 */

const OUT = join(process.cwd(), 'out');

const log = (message: string) => process.stdout.write(`${message}\n`);

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i === -1 ? null : (argv[i + 1] ?? null);
  };
  const min = Number(get('--min-opportunity') ?? 40);
  if (!Number.isFinite(min) || min < 0 || min > 100) {
    throw new Error('--min-opportunity must be between 0 and 100');
  }
  return { minOpportunity: min, followUp: argv.includes('--follow-up') };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let audits: SiteAudit[];
  try {
    audits = JSON.parse(await readFile(join(OUT, 'audits.json'), 'utf8')) as SiteAudit[];
  } catch {
    throw new Error('No out/audits.json. Run `npm run audit -- --list yourlist.txt` first.');
  }

  const eligible = audits.filter(
    (a) => a.error === null && a.opportunityScore >= args.minOpportunity && a.findings.length > 0,
  );

  log(`${audits.length} audited, ${eligible.length} worth contacting (opportunity >= ${args.minOpportunity})\n`);

  if (eligible.length === 0) {
    log('Nothing to draft. Either lower --min-opportunity or scan more sites.');
    return;
  }

  const dir = join(OUT, args.followUp ? 'emails-followup' : 'emails');
  // Resolved once, before anything is written. Missing settings stop the whole
  // run with one clear message rather than throwing on the first audit.
  let compliance;
  try {
    compliance = complianceConfig();
  } catch (error) {
    if (error instanceof MissingComplianceConfig) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  // Checked before drafting, not before sending. A draft that should not exist
  // is a draft somebody eventually sends by accident.
  const suppressed = await loadSuppressed();
  const { allowed, blocked } = partitionSuppressed(
    eligible,
    (a: SiteAudit) => a.finalUrl,
    suppressed,
  );
  if (blocked.length > 0) {
    log(`Skipped ${blocked.length} suppressed business(es):`);
    for (const { item, entry } of blocked) {
      log(`  ${entry.key} — ${entry.reason}`);
    }
    log('');
  }

  await mkdir(dir, { recursive: true });

  const drafts: EmailDraft[] = [];
  const index: string[] = [
    `# Outreach drafts${args.followUp ? ' — follow-up' : ''}`,
    '',
    'Nothing here has been sent. Read each one, edit it, send it yourself.',
    '',
  ];

  for (const audit of allowed) {
    const draft = args.followUp
      ? draftFollowUp(audit, { compliance })
      : draftFirstEmail(audit, { compliance });
    if (!draft) continue;
    drafts.push(draft);

    const slug = reportSlug(audit.finalUrl);
    const file = `${slug}.txt`;
    await writeFile(
      join(dir, file),
      `To:      ${draft.to ?? '(find their email)'}\nSubject: ${draft.subject}\n\n${draft.body}\n`,
      'utf8',
    );

    index.push(`## ${slug}`);
    index.push('');
    index.push(`- Opportunity ${audit.opportunityScore}/100 · opens on \`${draft.signal}\``);
    index.push(`- Report to attach: \`reports/${slug}.html\``);
    index.push(`- Draft: \`${args.followUp ? 'emails-followup' : 'emails'}/${file}\``);
    index.push('');
  }

  await writeFile(join(OUT, args.followUp ? 'followups.md' : 'outreach-drafts.md'), `${index.join('\n')}\n`, 'utf8');

  log(`Wrote ${drafts.length} draft(s) to out/${args.followUp ? 'emails-followup' : 'emails'}/\n`);

  // A run where every draft opens the same way is a template, however true
  // each copy happens to be. Surface it rather than let it go out unnoticed.
  const spread = signalSpread(drafts);
  log('Opening signal spread:');
  for (const { signal, count } of spread) {
    const share = Math.round((count / drafts.length) * 100);
    log(`  ${signal.padEnd(18)} ${String(count).padStart(3)}  ${'█'.repeat(Math.round(share / 4))} ${share}%`);
  }

  const dominant = spread[0];
  if (dominant && drafts.length >= 10 && dominant.count / drafts.length > 0.7) {
    log('');
    log(`  WARNING: ${Math.round((dominant.count / drafts.length) * 100)}% of these open the same way.`);
    log('  They will read as a template even though each one is true.');
    log('  Send in smaller batches, or scan a more varied set of businesses.');
  }

  log('');
  log('Next: read out/outreach-drafts.md, edit each draft, attach its report, send it yourself.');
  log('Nothing was sent. This tool cannot send.');
}

main().catch((error: unknown) => {
  process.stderr.write(`\ndraft-emails failed: ${String(error)}\n`);
  process.exitCode = 1;
});
