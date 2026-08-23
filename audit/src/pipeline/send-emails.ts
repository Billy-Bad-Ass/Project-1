import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loadEnv } from '../lib/env';
import { reportSlug } from '../lib/slug';
import type { SiteAudit } from '../lib/types';
import {
  complianceConfig,
  MissingComplianceConfig,
  type ComplianceConfig,
} from '../outreach/compliance';
import { draftFirstEmail } from '../outreach/draft';
import {
  accessToken,
  createDraft,
  gmailCredentials,
  MissingGmailCredentials,
  sendMessage,
  type Outgoing,
} from '../outreach/gmail';
import { qualify } from '../outreach/qualify';
import {
  loadSuppressedForSending,
  SuppressionUnavailable,
} from '../outreach/remote-suppression';
import { isSuppressed, suppress, suppressionKey } from '../outreach/suppression';
import { unsubscribeLinkFor } from '../outreach/unsubscribe';
import { sender } from '../report/config';

loadEnv();

/**
 * Puts the outreach into Gmail.
 *
 *   npm run send                 # writes Gmail drafts. Nothing leaves.
 *   npm run send -- --send --yes # actually sends
 *
 * Drafting is the default and sending needs two flags, because the two
 * outcomes are not symmetrical: a wrong draft is deleted in a second, and a
 * wrong send cannot be recalled from somebody else's inbox.
 *
 * Every guard here exists because the alternative is a specific, plausible
 * failure rather than a theoretical one:
 *
 *   - the opt-out list is re-checked immediately before each message, not just
 *     when the draft was written, because somebody can unsubscribe in between;
 *   - a business is recorded as contacted the moment its message is accepted,
 *     so a crash halfway through a batch cannot cause a second attempt at the
 *     ones already done;
 *   - the batch is capped, because the failure mode of a loop over a prospect
 *     list is not one bad email, it is two hundred.
 */

const OUT = join(process.cwd(), 'out');

function log(line = ''): void {
  process.stdout.write(`${line}\n`);
}

interface Args {
  send: boolean;
  yes: boolean;
  max: number;
  only: string | null;
}

function parseArgs(argv: string[]): Args {
  const value = (name: string): string | null => {
    const i = argv.indexOf(name);
    return i === -1 ? null : (argv[i + 1] ?? null);
  };
  const maxRaw = value('--max');
  const max = maxRaw === null ? 10 : Number(maxRaw);
  if (!Number.isInteger(max) || max < 1 || max > 50) {
    throw new Error('--max must be a whole number from 1 to 50');
  }
  return {
    send: argv.includes('--send'),
    yes: argv.includes('--yes'),
    max,
    only: value('--only'),
  };
}

interface Recipient {
  website: string;
  email: string | null;
  name: string;
}

/**
 * Addresses discovery already found.
 *
 * Only what the business published in OpenStreetMap. Guessing
 * `info@<domain>` would reach a real inbox often enough to feel clever and
 * bounce the rest, and bounces are what destroy a sending domain's reputation.
 */
async function recipients(): Promise<Map<string, Recipient>> {
  const byHost = new Map<string, Recipient>();
  try {
    const raw = JSON.parse(await readFile(join(OUT, 'prospects.json'), 'utf8')) as Recipient[];
    for (const entry of raw) {
      if (entry?.website) byHost.set(suppressionKey(entry.website), entry);
    }
  } catch {
    // Audits can exist without the discovery file, e.g. from a hand-written
    // list. Every recipient is then unknown, which the run reports rather than
    // treating as an empty prospect set.
  }
  return byHost;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let compliance: ComplianceConfig;
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

  let credentials;
  try {
    credentials = gmailCredentials();
  } catch (error) {
    if (error instanceof MissingGmailCredentials) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  if (args.send && !args.yes) {
    process.stderr.write(
      'Refusing to send without --yes.\n\n' +
        'Sending cannot be undone. Run without --send first: that writes the\n' +
        'same messages to Gmail drafts, where you can read them before\n' +
        'committing to anything.\n',
    );
    process.exitCode = 1;
    return;
  }

  let audits: SiteAudit[];
  try {
    audits = JSON.parse(await readFile(join(OUT, 'audits.json'), 'utf8')) as SiteAudit[];
  } catch {
    throw new Error('No out/audits.json. Run the audit first.');
  }

  let list;
  try {
    list = await loadSuppressedForSending();
  } catch (error) {
    if (error instanceof SuppressionUnavailable) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const { contact } = qualify(audits);
  const addresses = await recipients();

  const mode = args.send ? 'SEND' : 'draft';
  log(`${contact.length} qualified · mode: ${mode} · cap: ${args.max}`);
  log('');

  const token = await accessToken(credentials);

  let done = 0;
  let noAddress = 0;
  let blocked = 0;

  for (const { audit } of contact) {
    if (done >= args.max) {
      log(`\nStopped at the cap of ${args.max}. Run again to continue.`);
      break;
    }

    const host = suppressionKey(audit.finalUrl);
    if (args.only && host !== suppressionKey(args.only)) continue;

    // Re-checked here rather than trusted from drafting time: somebody can
    // unsubscribe between the two, and this is the last moment it can matter.
    if (isSuppressed(host, list.entries)) {
      blocked += 1;
      log(`  skip  ${host} — on the do-not-contact list`);
      continue;
    }

    const to = addresses.get(host)?.email ?? null;
    if (!to) {
      noAddress += 1;
      log(`  skip  ${host} — no published email address`);
      continue;
    }

    const draft = draftFirstEmail(audit, { compliance, email: to });
    if (!draft) {
      log(`  skip  ${host} — nothing worth opening on`);
      continue;
    }

    let attachment;
    try {
      attachment = {
        filename: `${reportSlug(audit.finalUrl)}.html`,
        mimeType: 'text/html' as const,
        content: await readFile(join(OUT, 'reports', `${reportSlug(audit.finalUrl)}.html`), 'utf8'),
      };
    } catch {
      // The body says "it's attached". Sending it without the attachment is
      // worse than not sending it.
      log(`  skip  ${host} — its report has not been generated (npm run report)`);
      continue;
    }

    const message: Outgoing = {
      to,
      from: sender.business ? `${sender.business} <${sender.email}>` : sender.email,
      subject: draft.subject,
      body: draft.body,
      attachments: [attachment],
      unsubscribeUrl: unsubscribeLinkFor(host),
    };

    const result = args.send
      ? await sendMessage(message, token)
      : await createDraft(message, token);

    // Recorded immediately, not at the end. A crash mid-batch must not leave
    // the already-contacted ones eligible for a second attempt.
    await suppress(host, 'already-contacted', {
      note: args.send ? `sent ${result.id}` : `drafted ${result.id}`,
    });

    done += 1;
    log(`  ${args.send ? 'sent ' : 'draft'} ${host} -> ${to}`);
  }

  log('');
  log(`${done} ${args.send ? 'sent' : 'drafted'} · ${noAddress} without an address · ${blocked} suppressed`);
  if (!args.send && done > 0) {
    log('');
    log('They are in your Gmail drafts. Read them, then send by hand — or');
    log('re-run with --send --yes once you trust them.');
  }
  if (noAddress > 0) {
    log('');
    log(`${noAddress} had no published email. Those are phone calls, not emails.`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`\nsend failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
