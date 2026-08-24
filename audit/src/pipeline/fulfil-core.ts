import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { redactEmail } from '../lib/resend';
import { reportSlug } from '../lib/slug';
import { renderReport } from '../report/render';
import type { Order } from '../lib/orders';
import type { SiteAudit } from '../lib/types';

/**
 * What happens after someone pays.
 *
 * Split out of the CLI so it can be exercised without Stripe and without the
 * network. This is the only path in the system that can take money and then
 * fail, and until now it had no test at all — the failure would have arrived
 * as a refund request rather than as a red build.
 */

export interface LedgerEntry {
  sessionId: string;
  siteUrl: string;
  email: string | null;
  reportFile: string;
  fulfilledAt: string;
  healthScore: number;
  /** When the report was emailed to the customer, or null if a human must. */
  emailedAt?: string | null;
  /** Resend's message id, for tracing a "never arrived" complaint. */
  emailId?: string | null;
  /** Where the report was archived in R2 — never in the public repository. */
  archivedTo?: string | null;
}

export type Ledger = Record<string, LedgerEntry>;

export interface FulfilResult {
  delivered: LedgerEntry[];
  /** Paid, but no website address was given. Someone must be emailed. */
  unusable: Order[];
  /** Paid and addressed, but the site could not be read. Never marked done. */
  failed: Array<{ order: Order; reason: string }>;
  /** Already in the ledger, so untouched. */
  alreadyDone: Order[];
}

export interface FulfilOptions {
  outDir: string;
  audit: (url: string) => Promise<SiteAudit>;
  now?: () => string;
  log?: (message: string) => void;
}

/**
 * Delivers every paid order that has not been delivered already.
 *
 * The ledger is the source of truth for "done", not Stripe: Stripe knows about
 * payment and nothing about whether a report was actually produced. It is
 * written after each order rather than at the end, so an interruption halfway
 * through cannot lose the record of work that was genuinely completed and
 * cause it to be redone.
 */
export async function fulfilOrders(
  orders: Order[],
  ledger: Ledger,
  options: FulfilOptions,
): Promise<FulfilResult> {
  const { outDir, audit } = options;
  const now = options.now ?? (() => new Date().toISOString());
  const log = options.log ?? (() => {});

  const result: FulfilResult = {
    delivered: [],
    unusable: [],
    failed: [],
    alreadyDone: [],
  };

  for (const order of orders) {
    if (ledger[order.sessionId]) {
      result.alreadyDone.push(order);
      continue;
    }
    // Reported rather than skipped quietly: someone has paid, and silence here
    // becomes a refund request a week later.
    if (!order.siteUrl) {
      result.unusable.push(order);
      continue;
    }

    let audited: SiteAudit;
    try {
      audited = await audit(order.siteUrl);
    } catch (error) {
      result.failed.push({
        order,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (audited.error) {
      result.failed.push({ order, reason: audited.error });
      continue;
    }

    await mkdir(join(outDir, 'delivered'), { recursive: true });

    // The session id makes the filename unique even when two customers submit
    // the same address, which the report-slug collision bug proved will happen.
    const file = `delivered/${reportSlug(audited.finalUrl)}-${order.sessionId.slice(-8)}.html`;
    await writeFile(join(outDir, file), renderReport(audited), 'utf8');

    const entry: LedgerEntry = {
      sessionId: order.sessionId,
      siteUrl: order.siteUrl,
      email: order.email,
      reportFile: file,
      fulfilledAt: now(),
      healthScore: audited.healthScore,
    };
    ledger[order.sessionId] = entry;
    result.delivered.push(entry);
    log(`  ${order.siteUrl} -> ${file}`);
  }

  return result;
}

/**
 * What a human still has to do after a run.
 *
 * Fulfilment writes a report; it does not send one. Anything that needs a
 * person is returned as a line rather than logged and forgotten, so the caller
 * can put it somewhere that gets read.
 */
export function outstandingActions(result: FulfilResult): string[] {
  const actions: string[] = [];

  // Addresses are redacted: this runs on a schedule in a public repository,
  // where the Actions log is as public as a commit. The session id is enough
  // to find the full address in Stripe.
  for (const entry of result.delivered) {
    actions.push(
      `EMAIL the report to ${redactEmail(entry.email)} — out/${entry.reportFile}`,
    );
  }
  for (const order of result.unusable) {
    actions.push(
      `ASK ${redactEmail(order.email)} for their website address — order ${order.sessionId}`,
    );
  }
  for (const { order, reason } of result.failed) {
    actions.push(
      `CONTACT ${redactEmail(order.email)}: ${order.siteUrl} could not be read (${reason}). ` +
        `They have paid and are not marked delivered.`,
    );
  }
  return actions;
}
