import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { fetchPaidOrders, stripeClient } from '../lib/orders';
import { formatDateTime, formatMoney } from '../lib/locale';
import type { Ledger } from './fulfil-core';

/**
 * Answers one question: does anyone need a report right now?
 *
 *   npm run orders
 *
 * This exists because the site promises delivery within one working day and
 * fulfilment is something a person has to run. Without a way to ask "has
 * anyone paid", that promise depends on remembering to check — and the first
 * time it is forgotten it costs a refund and a bad first customer.
 *
 * Read-only. It fetches nothing, writes nothing, and audits nobody's site. Its
 * exit code is the useful part: 0 when there is nothing to do, 10 when
 * somebody has paid and is waiting. That makes it usable from a scheduler,
 * a shell prompt, or a phone shortcut without parsing any output.
 */

const OUT = join(process.cwd(), 'out');
const LEDGER = join(OUT, 'fulfilled.json');

/** Exit code when a paid order is waiting. Distinct from 1, which means broken. */
export const WAITING_EXIT_CODE = 10;

const log = (message: string) => process.stdout.write(`${message}\n`);

async function readLedger(): Promise<Ledger> {
  try {
    return JSON.parse(await readFile(LEDGER, 'utf8')) as Ledger;
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY;
  const mode = key?.startsWith('sk_live') ? 'LIVE' : 'test';

  const orders = await fetchPaidOrders(stripeClient());
  const ledger = await readLedger();
  const waiting = orders.filter((o) => !ledger[o.sessionId]);

  if (waiting.length === 0) {
    log(`Nothing waiting. ${orders.length} paid order(s) total, all delivered. (${mode} mode)`);
    return;
  }

  const total = waiting.reduce((sum, o) => sum + (o.amountPaid ?? 0) / 100, 0);

  log('');
  log(`${waiting.length} PAID ORDER(S) WAITING — ${formatMoney(total)} (${mode} mode)`);
  log('');
  for (const order of waiting) {
    log(`  ${order.email ?? '(no email)'}`);
    log(`    site:  ${order.siteUrl ?? '!! no website address given — ask them'}`);
    log(`    paid:  ${formatDateTime(order.paidAt)}`);
    log('');
  }
  log('Run `npm run fulfil` to produce the reports, then email them.');

  // Distinct from a crash, so a scheduler can tell "work waiting" from "broken".
  process.exitCode = WAITING_EXIT_CODE;
}

main().catch((error: unknown) => {
  process.stderr.write(`check-orders failed: ${String(error)}\n`);
  process.exitCode = 1;
});
