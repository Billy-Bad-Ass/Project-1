import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { auditSite } from '../lib/audit';
import { PageFetcher } from '../lib/fetch-page';
import { fetchPaidOrders, stripeClient, type Order } from '../lib/orders';
import { reportSlug } from '../lib/slug';
import { renderReport } from '../report/render';

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

  await mkdir(join(OUT, 'delivered'), { recursive: true });
  const fetcher = new PageFetcher({ log });
  let delivered = 0;

  for (const order of workable) {
    log(`Auditing ${order.siteUrl} ...`);

    // A paying customer asked us to look at their own site, so robots.txt is
    // not a reason to refuse — unlike the cold-outreach path, we are invited.
    const audit = await auditSite(order.siteUrl!, {
      fetcher,
      respectRobots: false,
      log,
    });

    if (audit.error) {
      log(`  ! could not reach it: ${audit.error}`);
      log(`    ${order.email ?? 'customer'} needs an email — do not mark this delivered.`);
      continue;
    }

    const file = `delivered/${reportSlug(audit.finalUrl)}-${order.sessionId.slice(-8)}.html`;
    await writeFile(join(OUT, file), renderReport(audit), 'utf8');

    ledger[order.sessionId] = {
      sessionId: order.sessionId,
      siteUrl: order.siteUrl!,
      email: order.email,
      reportFile: file,
      fulfilledAt: new Date().toISOString(),
      healthScore: audit.healthScore,
    };
    await writeLedger(ledger);

    delivered += 1;
    log(`  health ${audit.healthScore}/100, ${audit.findings.length} findings -> out/${file}`);
  }

  log('');
  log(`Delivered ${delivered} report(s).`);
  if (delivered > 0) {
    log('');
    log('Send each file to its customer. Emails to write:');
    for (const order of workable) {
      const entry = ledger[order.sessionId];
      if (entry) log(`  ${entry.email ?? '(no email on file)'}  <- out/${entry.reportFile}`);
    }
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`\nfulfil failed: ${String(error)}\n`);
  process.exitCode = 1;
});
