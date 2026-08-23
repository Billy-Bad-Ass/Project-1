import { countBySeverity } from '../lib/audit';
import type { Finding, SiteAudit } from '../lib/types';
import { sender, type SenderConfig } from '../report/config';
import {
  complianceConfig,
  complianceFooter,
  optOutLine,
  provenanceLine,
  type ComplianceConfig,
} from './compliance';
import { unsubscribeLinkFor } from './unsubscribe';

/**
 * Drafts outreach email from a site's real findings.
 *
 * Built on one idea worth stating plainly: outreach triggered by a specific,
 * verifiable signal converts far better than untriggered cold email. The audit
 * engine is a signal generator — a broken phone link is a fact the owner can
 * check on their own handset in ten seconds — so every draft leads with that
 * fact and nothing else.
 *
 * What this deliberately does NOT do is send. See `docs/OUTREACH.md`.
 */

export interface EmailDraft {
  to: string | null;
  subject: string;
  body: string;
  /** Which finding the opener is built on, for review. */
  signal: string;
  /** Step in the sequence: 1 is first contact. */
  step: number;
}

export interface DraftOptions {
  from?: SenderConfig;
  /**
   * Injectable so tests need no environment. Omitted in production, where
   * the real settings are read and their absence is a hard failure.
   */
  compliance?: ComplianceConfig;
  /** Their name if you know it. Without it the greeting stays neutral. */
  contactName?: string | null;
  email?: string | null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * The one finding to lead with.
 *
 * Prefers findings the owner can verify themselves without technical
 * knowledge. A missing canonical tag may be more "severe" by our scoring, but
 * an unverifiable claim opens with the reader taking our word for it — which
 * is exactly what every other cold email asks them to do.
 */
const SELF_EVIDENT = new Set([
  'mobile-viewport',
  'https',
  'contact-method',
  'http-status',
  'response-time',
  'call-to-action',
  'social-preview',
]);

export function pickSignal(audit: SiteAudit): Finding | null {
  const verifiable = audit.findings.filter((f) => SELF_EVIDENT.has(f.ruleId));
  return verifiable[0] ?? audit.findings[0] ?? null;
}

/** One sentence the reader can check for themselves, in their words. */
function signalSentence(finding: Finding, host: string): string {
  switch (finding.ruleId) {
    case 'mobile-viewport':
      return `I had a look at ${host} on my phone and the desktop layout is being shrunk down, so the text needs pinching to read.`;
    case 'https':
      return `When I opened ${host}, my browser showed a "Not secure" warning next to the address.`;
    case 'contact-method':
      return `I couldn't find a way to get in touch from the ${host} home page — no clickable number, no email, no form.`;
    case 'response-time':
      return `${host} took a few seconds before anything started loading, which is long enough that people give up.`;
    case 'http-status':
      return `${host} is returning an error page rather than the site.`;
    case 'call-to-action':
      return `${host} explains what you do, but never actually asks the visitor to get in touch or book anything.`;
    case 'social-preview':
      return `When someone shares a link to ${host} on WhatsApp or Facebook, it shows up as a bare address with no picture.`;
    default:
      return `While looking at ${host} I noticed: ${finding.title.toLowerCase()}.`;
  }
}

/**
 * The lines that close an email.
 *
 * The personal name is optional — a business can trade under its name alone —
 * so this drops the line rather than leaving a blank one, and never prints the
 * same identity twice when the two happen to match.
 *
 */
export function signOff(from: SenderConfig): string[] {
  const lines: string[] = [];
  if (from.name) lines.push(from.name);
  if (from.business && from.business !== from.name) lines.push(from.business);
  lines.push(from.email);
  return lines;
}

/**
 * Everything below the last sentence: who sent this, why they have your
 * address, and how to make it stop.
 *
 * Resolving the compliance settings here rather than at send time is
 * deliberate. An email that cannot lawfully be sent should never come into
 * existence as a draft, because a draft that exists is a draft somebody
 * eventually sends.
 */
export function closing(
  from: SenderConfig,
  host: string,
  compliance: ComplianceConfig = complianceConfig(),
): string[] {
  // A per-recipient opt-out link, when one is configured, replaces the generic
  // instruction. It is strictly better for the recipient — one click rather
  // than composing a reply and hoping somebody reads it.
  const link = unsubscribeLinkFor(host);
  const config: ComplianceConfig = link
    ? { ...compliance, optOut: { kind: 'url', url: link } }
    : compliance;

  // When the mail client appends a signature carrying the same identity and
  // opt-out, repeating them here puts the address in the email twice.
  //
  // Two things survive that branch regardless. The provenance line is specific
  // to this recipient, and the unsubscribe link is specific to this recipient,
  // so a fixed signature cannot express either — dropping the link here would
  // silently downgrade every email to the reply-only opt-out.
  if (signatureInClient()) {
    return link ? [provenanceLine(host), '', optOutLine(config.optOut)] : [provenanceLine(host)];
  }

  return [
    ...signOff(from),
    '',
    provenanceLine(host),
    ...complianceFooter(from, config),
  ];
}

/**
 * Whether the mail client supplies the signature.
 *
 * Defaults to false, and deliberately so. If this were on by default, a draft
 * would omit the footer for anyone who had not yet installed the signature —
 * and the resulting email would be missing the two things it is legally
 * required to carry, with nothing anywhere to indicate that.
 *
 * Wrong in the default direction costs a duplicated address. Wrong in the
 * other direction costs a complaint.
 */
export function signatureInClient(): boolean {
  return process.env.AUDIT_SIGNATURE_IN_CLIENT?.trim().toLowerCase() === 'true';
}

export function draftFirstEmail(audit: SiteAudit, options: DraftOptions = {}): EmailDraft | null {
  const from = options.from ?? sender;
  const host = hostOf(audit.finalUrl);
  const signal = pickSignal(audit);
  if (!signal) return null;

  const counts = countBySeverity(audit.findings);
  const serious = counts.critical + counts.high;
  const greeting = options.contactName ? `Hi ${options.contactName},` : 'Hi,';

  // Subject lines stay concrete and lowercase-ish: anything that reads like a
  // marketing headline gets filtered before a human sees it.
  const subject = subjectFor(signal, host);

  const others =
    serious > 1
      ? `\n\nThere ${serious - 1 === 1 ? 'is' : 'are'} ${serious - 1} other ${serious - 1 === 1 ? 'thing' : 'things'} in the same vein. I put everything in a short report — it's attached, and it says what each one is costing you and how to fix it.`
      : `\n\nI wrote up what I found in a short report — it's attached, and it says how to fix it.`;

  const body = [
    greeting,
    '',
    signalSentence(signal, host),
    '',
    signal.impact,
    '',
    others.trim(),
    '',
    "There's nothing to buy here. If it's useful, use it — your own developer can action the whole list. If you'd rather someone just did it, that's what I do, and I'm happy to talk.",
    '',
    "Either way, I'll send one short follow-up and then leave you alone.",
    '',
    ...closing(from, host, options.compliance),
  ].join('\n');

  return { to: options.email ?? null, subject, body, signal: signal.ruleId, step: 1 };
}

function subjectFor(signal: Finding, host: string): string {
  switch (signal.ruleId) {
    case 'mobile-viewport':
      return `${host} on a phone`;
    case 'https':
      return `${host} is showing a "not secure" warning`;
    case 'contact-method':
      return `Couldn't find a phone number on ${host}`;
    case 'response-time':
      return `${host} is loading slowly`;
    case 'http-status':
      return `${host} is showing an error`;
    case 'call-to-action':
      return `A small thing about ${host}`;
    default:
      return `Something I noticed on ${host}`;
  }
}

/**
 * A single follow-up, sent only if they never replied.
 *
 * One, not five. A sequence that keeps arriving after silence is the thing
 * that gets a sending domain reported, and the report has already been sent —
 * there is nothing left to say that adds value.
 */
export function draftFollowUp(audit: SiteAudit, options: DraftOptions = {}): EmailDraft | null {
  const from = options.from ?? sender;
  const host = hostOf(audit.finalUrl);
  const signal = pickSignal(audit);
  if (!signal) return null;

  const body = [
    options.contactName ? `Hi ${options.contactName},` : 'Hi,',
    '',
    `I sent over a short report on ${host} last week — mainly about ${signal.title.toLowerCase()}.`,
    '',
    "Worth a look whether or not you want anything from me; the fixes are all written out. If it's not relevant, no problem at all and I won't chase it again.",
    '',
    ...closing(from, host, options.compliance),
  ].join('\n');

  return {
    to: options.email ?? null,
    subject: `Re: ${subjectFor(signal, host)}`,
    body,
    signal: signal.ruleId,
    step: 2,
  };
}

/**
 * How many drafts share an opening signal.
 *
 * Two hundred emails that all open with the same sentence is a template, and
 * it reads like one however true each copy is. Same lesson the content side of
 * this repo learned: vary because the data varies, not by swapping synonyms.
 */
export function signalSpread(drafts: EmailDraft[]): { signal: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const draft of drafts) counts.set(draft.signal, (counts.get(draft.signal) ?? 0) + 1);
  return [...counts]
    .map(([signal, count]) => ({ signal, count }))
    .sort((a, b) => b.count - a.count);
}
