import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bestContactEmail, contactPageUrl, type ContactEmail } from '../discover/contact-email';
import { normaliseEmail, type Prospect } from '../discover/overpass';
import { OUT_DIR, readProspects, writeProspects } from '../discover/prospect-file';
import { PageFetcher, robotsAllows } from '../lib/fetch-page';

/**
 * Fills in the missing contact addresses, from the pages the audit already read.
 *
 *   npm run emails
 *   npm run emails -- --recheck        also re-look at prospects that have one
 *   npm run emails -- --no-contact-page   homepage only, one request per site
 *
 * Why this step exists: OpenStreetMap carried an address for none of the eight
 * businesses the first Northern Virginia sweep found. Discovery, auditing,
 * scoring and drafting all ran green and produced nothing anyone could send,
 * and the fix sat behind a 30-day artifact expiry and a human with a terminal.
 * The addresses were on the businesses' own homepages the whole time.
 *
 * It runs after `npm run audit` on purpose. The fetcher caches every page for
 * 24 hours, so the homepage this reads is the one the audit already downloaded
 * — no second request, no extra load on anyone's server, and the whole step
 * usually costs no network at all.
 */

const log = (message: string) => process.stdout.write(`${message}\n`);

interface Args {
  recheck: boolean;
  followContactPage: boolean;
  concurrency: number;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i === -1 ? null : (argv[i + 1] ?? null);
  };

  const raw = get('--concurrency');
  const concurrency = raw === null ? 2 : Number(raw);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error('--concurrency must be a whole number from 1 to 8');
  }

  return {
    recheck: argv.includes('--recheck'),
    followContactPage: !argv.includes('--no-contact-page'),
    concurrency,
  };
}

type Outcome =
  | { kind: 'kept'; prospect: Prospect }
  | { kind: 'found'; prospect: Prospect; email: ContactEmail; where: 'homepage' | 'contact page' }
  | { kind: 'none'; prospect: Prospect; reason: string };

async function findFor(
  prospect: Prospect,
  fetcher: PageFetcher,
  args: Args,
): Promise<Outcome> {
  if (prospect.email && !args.recheck) return { kind: 'kept', prospect };

  let home;
  try {
    home = await fetcher.fetchRaw(prospect.website);
  } catch (error) {
    return {
      kind: 'none',
      prospect,
      reason: `could not be read (${error instanceof Error ? error.message : String(error)})`,
    };
  }

  // The same conservative reading the audit uses: a site that refuses the
  // scanner is working fine for humans, and we learn nothing from the refusal.
  if (home.status === 401 || home.status === 403 || home.status === 429) {
    return { kind: 'none', prospect, reason: `the site blocks automated visitors (HTTP ${home.status})` };
  }
  if (home.status >= 400) {
    return { kind: 'none', prospect, reason: `HTTP ${home.status}` };
  }

  const homepage = { finalUrl: home.finalUrl, html: home.body };
  const fromHome = bestContactEmail(homepage);
  if (fromHome) return { kind: 'found', prospect, email: fromHome, where: 'homepage' };

  if (!args.followContactPage) {
    return { kind: 'none', prospect, reason: 'nothing on the homepage' };
  }

  const next = contactPageUrl(homepage);
  if (!next) return { kind: 'none', prospect, reason: 'no address, and no contact page to try' };

  // The second request is the only one this step ever adds, and it is still
  // subject to the site's own robots.txt. A business that has asked crawlers
  // to stay out of /contact is not a business to start a relationship with by
  // ignoring that.
  let origin: string;
  try {
    origin = new URL(next).origin;
  } catch {
    return { kind: 'none', prospect, reason: 'no address, and no contact page to try' };
  }

  const robots = await fetcher.fetchRobots(origin);
  if (!robotsAllows(robots, new URL(next).pathname)) {
    return { kind: 'none', prospect, reason: 'robots.txt asks us not to read the contact page' };
  }

  try {
    const contact = await fetcher.fetchRaw(next);
    if (contact.status >= 400) {
      return { kind: 'none', prospect, reason: `contact page answered HTTP ${contact.status}` };
    }
    const fromContact = bestContactEmail({ finalUrl: contact.finalUrl, html: contact.body });
    return fromContact
      ? { kind: 'found', prospect, email: fromContact, where: 'contact page' }
      : { kind: 'none', prospect, reason: 'no address on the homepage or the contact page' };
  } catch (error) {
    return {
      kind: 'none',
      prospect,
      reason: `contact page could not be read (${error instanceof Error ? error.message : String(error)})`,
    };
  }
}

/** Run tasks with a fixed number in flight, preserving input order. */
async function pool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function renderReport(outcomes: Outcome[]): string {
  const found = outcomes.filter((o): o is Extract<Outcome, { kind: 'found' }> => o.kind === 'found');
  const none = outcomes.filter((o): o is Extract<Outcome, { kind: 'none' }> => o.kind === 'none');
  const kept = outcomes.filter((o) => o.kind === 'kept');

  const lines = [
    '# Contact addresses',
    '',
    `${found.length} found · ${kept.length} already had one · ${none.length} still without`,
    '',
  ];

  if (found.length > 0) {
    lines.push('## Found', '', '| Business | Address | Where | Why this one |', '|---|---|---|---|');
    for (const o of found) {
      lines.push(
        `| ${o.prospect.name} | ${o.email.email} | ${o.where} | ${o.email.why} |`,
      );
    }
    lines.push('');
  }

  if (none.length > 0) {
    // Named rather than counted: "3 without an address" is not actionable, and
    // a reason per business is what tells you which are worth a manual look.
    lines.push('## Still without an address', '', '| Business | Website | Why not |', '|---|---|---|');
    for (const o of none) {
      lines.push(`| ${o.prospect.name} | ${o.prospect.website} | ${o.reason} |`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let prospects: Prospect[];
  try {
    prospects = await readProspects();
  } catch {
    throw new Error(
      'No out/prospects.json to work from.\n\n' +
        '  npm run find -- --what dentist --where Arlington --country US\n' +
        '  npm run audit -- --list out/prospects.txt\n' +
        '  npm run emails\n',
    );
  }

  const todo = prospects.filter((p) => args.recheck || !p.email).length;
  log(`${prospects.length} prospects, ${todo} to look at\n`);

  if (todo === 0) {
    log('Every prospect already has an address. Nothing to do.');
    return;
  }

  const fetcher = new PageFetcher({ log: () => {} });
  const outcomes = await pool(prospects, args.concurrency, (p) => findFor(p, fetcher, args));

  const enriched = outcomes.map((o) => {
    if (o.kind !== 'found') return o.prospect;
    // Through the same normaliser the OSM tags go through, so an address found
    // on a page and one published in OSM cannot be stored in two shapes.
    const email = normaliseEmail(o.email.email);
    return email ? { ...o.prospect, email } : o.prospect;
  });

  const withEmail = enriched.filter((p) => p.email).length;
  const header = [
    `# ${enriched.length} prospects, ${withEmail} with a contact address.`,
    `# Addresses filled in by: npm run emails`,
    '',
  ];
  await writeProspects(enriched, header);
  await writeFile(join(OUT_DIR, 'contact-emails.md'), renderReport(outcomes), 'utf8');

  for (const o of outcomes) {
    if (o.kind === 'found') {
      log(`  + ${o.prospect.name.slice(0, 32).padEnd(34)} ${o.email.email}  (${o.where})`);
    }
  }
  for (const o of outcomes) {
    if (o.kind === 'none') {
      log(`  - ${o.prospect.name.slice(0, 32).padEnd(34)} ${o.reason}`);
    }
  }

  const gained = outcomes.filter((o) => o.kind === 'found').length;
  log('');
  log(`  ${gained} addresses found · ${withEmail} of ${enriched.length} prospects now contactable`);
  log(`  requests: ${fetcher.stats.fetched} fetched, ${fetcher.stats.cached} from cache`);
  log('');
  log('  out/prospects.csv   updated, with the addresses filled in');
  log('  out/contact-emails.md   what was found, and why each one was chosen');
}

main().catch((error: unknown) => {
  process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
