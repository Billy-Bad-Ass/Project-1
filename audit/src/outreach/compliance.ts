import { loadEnv } from '../lib/env';
import type { SenderConfig } from '../report/config';

loadEnv();

/**
 * The footer every commercial email has to carry, and the check that refuses
 * to draft one without it.
 *
 * US commercial email (CAN-SPAM) requires three things this module supplies:
 * an accurate identification of who is sending, a **valid physical postal
 * address**, and a clear, working way to opt out. Nothing here is optional and
 * nothing here is decorative.
 *
 * The postal address is the part that cannot be generated. It has to be a real
 * place that receives mail — a street address, a registered agent, or a PO box
 * or private mailbox obtained for the purpose. A made-up one is worse than
 * none, because it converts an omission into a misrepresentation.
 *
 * This module deliberately refuses rather than degrades. An email drafted
 * without a footer is an email that eventually gets sent without one, and the
 * failure is invisible to whoever sends it.
 */

export interface ComplianceConfig {
  /** A real address that receives mail. Required. */
  postalAddress: string;
  /** How someone stops hearing from you. Required. */
  optOut: OptOutMethod;
}

export type OptOutMethod =
  | { kind: 'reply'; instruction: string }
  | { kind: 'url'; url: string };

export class MissingComplianceConfig extends Error {
  constructor(missing: string[]) {
    super(
      `Refusing to draft an email that cannot lawfully be sent.\n\n` +
        `Missing:\n${missing.map((m) => `  ${m}`).join('\n')}\n\n` +
        `US commercial email must identify the sender, give a valid physical\n` +
        `postal address, and offer a working way to opt out. Set these in\n` +
        `.env.local — see .env.example.\n`,
    );
    this.name = 'MissingComplianceConfig';
  }
}

/**
 * Reads the compliance settings, or throws describing exactly what is absent.
 *
 * Callers that merely want to know whether outreach is possible should use
 * `complianceReady()` rather than catching this.
 */
export function complianceConfig(): ComplianceConfig {
  const address = process.env.AUDIT_POSTAL_ADDRESS?.trim();
  const optOutUrl = process.env.AUDIT_OPT_OUT_URL?.trim();
  const optOutReply = process.env.AUDIT_OPT_OUT_REPLY?.trim();

  const missing: string[] = [];
  if (!address) {
    missing.push(
      'AUDIT_POSTAL_ADDRESS  — a real address that receives mail. Required by law; cannot be invented.',
    );
  }
  if (!optOutUrl && !optOutReply) {
    missing.push(
      'AUDIT_OPT_OUT_URL or AUDIT_OPT_OUT_REPLY — how someone stops hearing from you.',
    );
  }
  if (missing.length > 0) throw new MissingComplianceConfig(missing);

  const optOut: OptOutMethod = optOutUrl
    ? { kind: 'url', url: optOutUrl }
    : { kind: 'reply', instruction: optOutReply! };

  return { postalAddress: address!, optOut };
}

/** Whether outreach is possible at all, without throwing. */
export function complianceReady(): boolean {
  try {
    complianceConfig();
    return true;
  } catch {
    return false;
  }
}

/**
 * The footer lines.
 *
 * Kept plain and short. A dense legal block at the bottom of a two-paragraph
 * email reads as bulk mail, which is precisely the impression the rest of the
 * message is working against — so this says the required things in the fewest
 * words that still say them.
 */
export function complianceFooter(
  from: SenderConfig,
  config: ComplianceConfig = complianceConfig(),
): string[] {
  const who = from.business || from.name || from.email;
  const stop =
    config.optOut.kind === 'url'
      ? `To stop hearing from me, use this link: ${config.optOut.url}`
      : config.optOut.instruction;

  return ['—', `${who} · ${config.postalAddress}`, stop];
}

/**
 * A single line naming why this address was contacted.
 *
 * Not legally required, and included anyway: the most common reaction to an
 * unexpected email is wondering how they got your address, and an unanswered
 * version of that question is what turns curiosity into a spam report.
 */
export function provenanceLine(host: string): string {
  return (
    `You're getting this because ${host} is listed publicly as a local business ` +
    `and I ran a free check on the site.`
  );
}
