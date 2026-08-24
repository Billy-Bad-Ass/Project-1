import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { categoryList, findCategory } from '../discover/categories';
import { discoverProspects, type Prospect } from '../discover/overpass';

/**
 * Turn "dentists in Bristol" into a prospect list ready to audit.
 *
 *   npm run find -- --list
 *   npm run find -- --what dentist --where Bristol
 *   npm run find -- --what plumber --where Leeds --limit 40
 *
 * Writes out/prospects.txt, which feeds straight into `npm run audit`.
 */

const OUT = join(process.cwd(), 'out');
const log = (message: string) => process.stdout.write(`${message}\n`);

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i === -1 ? null : (argv[i + 1] ?? null);
  };

  if (argv.includes('--list')) return { listOnly: true as const };

  const what = get('--what');
  const where = get('--where');
  if (!what || !where) {
    throw new Error(
      'Need both --what and --where.\n\n' +
        '  npm run find -- --what dentist --where Bristol --country GB\n\n' +
        'Run `npm run find -- --list` for the business types.',
    );
  }

  const limitRaw = get('--limit');
  const limit = limitRaw === null ? 60 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 300) {
    throw new Error('--limit must be a whole number from 1 to 300');
  }

  return { listOnly: false as const, what, where, limit, country: get('--country') };
}

function toCsv(prospects: Prospect[]): string {
  const escape = (v: string | null) => {
    const s = v ?? '';
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [
    ['name', 'website', 'email', 'phone', 'street', 'town', 'postcode', 'osm'],
    ...prospects.map((p) => [
      p.name,
      p.website,
      p.email,
      p.phone,
      p.street,
      p.town,
      p.postcode,
      p.osmId,
    ]),
  ];
  return `${rows.map((r) => r.map(escape).join(',')).join('\n')}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.listOnly) {
    log('Business types you can search for:\n');
    log(categoryList());
    log('\n  npm run find -- --what dentist --where Bristol --country GB');
    log('\n  --country matters: place names repeat. "Bristol" alone can match Tennessee.');
    return;
  }

  const category = findCategory(args.what);
  if (!category) {
    throw new Error(
      `Unknown business type "${args.what}".\n\nAvailable:\n${categoryList()}`,
    );
  }

  const prospects = await discoverProspects({
    category: args.what,
    area: args.where,
    country: args.country ?? undefined,
    limit: args.limit,
    log,
  });

  if (prospects.length === 0) {
    process.exitCode = 1;
    return;
  }

  await mkdir(OUT, { recursive: true });

  const header = [
    `# ${category.label} in ${args.where}`,
    `# Found ${prospects.length} with a website, via OpenStreetMap.`,
    `# Feed this to: npm run audit -- --list out/prospects.txt`,
    '',
  ];
  await writeFile(
    join(OUT, 'prospects.txt'),
    `${[...header, ...prospects.map((p) => p.website)].join('\n')}\n`,
    'utf8',
  );

  // Names, phones and addresses are not needed to audit, but they are exactly
  // what you want in hand when someone replies.
  await writeFile(join(OUT, 'prospects.csv'), toCsv(prospects), 'utf8');
  await writeFile(join(OUT, 'prospects.json'), JSON.stringify(prospects, null, 2), 'utf8');

  log('');
  for (const p of prospects.slice(0, 8)) {
    log(`  ${p.name.slice(0, 34).padEnd(36)} ${p.website}`);
  }
  if (prospects.length > 8) log(`  ... and ${prospects.length - 8} more`);

  const withPhone = prospects.filter((p) => p.phone).length;
  const withEmail = prospects.filter((p) => p.email).length;
  log('');
  log(
    `  ${prospects.length} businesses · ${withEmail} with an email · ${withPhone} with a phone number`,
  );
  log('');
  log('  out/prospects.txt   ready to audit');
  log('  out/prospects.csv   names, phones and addresses for when they reply');
  log('');
  log('Next:  npm run audit -- --list out/prospects.txt');
}

main().catch((error: unknown) => {
  process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
