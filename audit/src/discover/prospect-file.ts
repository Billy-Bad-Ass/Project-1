import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Prospect } from './overpass';

/**
 * Reading and writing the prospect files, in one place.
 *
 * There is exactly one definition of the CSV columns here because that CSV is
 * what a human downloads and pastes into the dashboard. Two writers drifting
 * apart by one column would not fail anything — it would silently file every
 * phone number under `postcode`, and nobody would notice until somebody rang
 * a postcode.
 */

export const OUT_DIR = join(process.cwd(), 'out');

const COLUMNS = ['name', 'website', 'email', 'phone', 'street', 'town', 'postcode', 'osm'] as const;

export function toCsv(prospects: Prospect[]): string {
  const escape = (v: string | null) => {
    const s = v ?? '';
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [
    [...COLUMNS],
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

/** The audit input: one website per line, with a readable header. */
export function toSiteList(prospects: Prospect[], header: string[]): string {
  return `${[...header, ...prospects.map((p) => p.website)].join('\n')}\n`;
}

export async function readProspects(dir = OUT_DIR): Promise<Prospect[]> {
  const raw = await readFile(join(dir, 'prospects.json'), 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('out/prospects.json is not a list');
  return parsed as Prospect[];
}

/** Writes all three views of the same list, so they can never disagree. */
export async function writeProspects(
  prospects: Prospect[],
  header: string[],
  dir = OUT_DIR,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await Promise.all([
    writeFile(join(dir, 'prospects.txt'), toSiteList(prospects, header), 'utf8'),
    writeFile(join(dir, 'prospects.csv'), toCsv(prospects), 'utf8'),
    writeFile(join(dir, 'prospects.json'), JSON.stringify(prospects, null, 2), 'utf8'),
  ]);
}
