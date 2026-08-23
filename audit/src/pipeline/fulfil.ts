import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { auditSite } from '../lib/audit';
import { PageFetcher } from '../lib/fetch-page';
import { fetchPaidOrders, stripeClient, type Order } from '../lib/orders';
import { fulfilOrders, outstandingActions, type Ledger } from './fulfil-core';

/**
 * Turn paid Stripe orders into delivered reports.
 *
 *   npm run fulfil -- --dry-run     see what is waiting, touch nothing
 *   npm run fulfil                  audit every unfulfilled paid order
 *   npm run fulfil -- --session cs_x   re-run one order
 *
 * A local ledger records what has already been delivered, so running this
 * repeatedly is safe and cannot bill a customer's site twice or re-send work.
 * The ledger is the source of truth for "done", not Stripe, because Stripe
 * knows about payment and nothing about whether the report actually got made.
 */

const OUT = join(process.cwd(), 'out');
const LEDGER = join(OUT, 'fulfilled.json');

interface LedgerEntry {
  sessionId: string;
  siteUrl: string;
  email: string | null;
  reportFile: string;
  fulfilledAt: string;
  healthScore: number;
}

const log = (message: string) => process.stdout.write(`${message}\n`);

async function readLedger(): Promise<Record<string, LedgerEntry>> {
  try {
    return JSON.parse(await readFile(LEDGER, 'utf8')) as Record<string, LedgerEntry>;
  } catch {
    return {};
  }
}

async function writeLedger(ledger: Record<string, LedgerEntry>): Promise<void> {
  await mkdir(OUT, { recursive: true });
  await writeFile(LEDGER, JSON.stringify(ledger, null, 2), 'utf8');
}

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i === -1 ? null : (argv[i + 1] ?? null);
  };
  return {
    dryRun: argv.includes('--dry-run'),
    sessionId: get('--session'),
    paymentLinkId: get('--payment-link') ?? process.env.STRIPE_PAYMENT_LINK_ID ?? undefined,
    force: argv.includes('--force'),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const stripe = stripeClient();
  const ledger = await readLedger();

  const mode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_live') ? 'LIVE' : 'test';
  log(`Stripe mode: ${mode}\n`);

  log('Fetching paid orders...');
  let orders = await fetchPaidOrders(stripe, { paymentLinkId: args.paymentLinkId });

  if (args.sessionId) orders = orders.filter((o) => o.sessionId === args.sessionId);

  const pending = args.force ? orders : orders.filter((o) => !ledger[o.sessionId]);
  const alreadyDone = orders.length - pending.length;

  log(`  ${orders.length} paid order(s), ${alreadyDone} already delivered, ${pending.length} to do\n`);

  if (pending.length === 0) {
    log('Nothing to fulfil.');
    return;
  }

  // Orders with no usable address cannot be audited automatically. They are
  // reported loudly rather than skipped quietly — someone has paid, and a
  // silent skip turns that into a refund request a week later.
  const unusable = pending.filter((o) => !o.siteUrl);
  const workable = pending.filter((o) => o.siteUrl);

  if (unusable.length > 0) {
    log(`  ${unusable.length} paid order(s) have NO website address — contact these people:`);
    for (const order of unusable) {
      log(`    ${order.sessionId}  ${order.email ?? '(no email)'}  fields: ${JSON.stringify(order.fields)}`);
    }
    log('');
  }

  if (args.dryRun) {
    log('--dry-run: nothing fetched or written. Would audit:');
    for (const order of workable) log(`  ${order.siteUrl}  for ${order.email ?? '(no email)'}`);
    return;
  }

  const fetcher = new PageFetcher({ log });

  const result = await fulfilOrders(workable, ledger, {
    outDir: OUT,
    // A paying customer asked us to look at their own site, so robots.txt is
    // not a reason to refuse — unlike cold outreach, we are invited.
    audit: (url) => auditSite(url, { fetcher, respectRobots: false, log }),
    log,
  });
  await writeLedger(ledger);

  log('');
  log(`Delivered ${result.delivered.length} report(s).`);

  // Everything a person still owes someone who has paid, in one place. A run
  // that only logs successes leaves the failures to be remembered.
  const actions = outstandingActions(result);
  if (actions.length > 0) {
    log('');
    log('Still to do:');
    for (const action of actions) log(`  ${action}`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`\nfulfil failed: ${String(error)}\n`);
  process.exitCode = 1;
});
