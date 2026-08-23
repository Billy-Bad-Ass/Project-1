import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * The list of people who must never be contacted again.
 *
 * Append-only, and stored as JSON Lines rather than a JSON array, for one
 * reason: a truncated or half-written array is unparseable, and the failure
 * mode of an unparseable suppression list is emailing everyone on it. With
 * JSONL a damaged final line costs one record, and every earlier record still
 * reads. The file is the kind that must degrade rather than break.
 *
 * Entries are never removed. Someone who asked to be left alone in March has
 * not consented by September, and a list you can quietly prune is not a
 * suppression list.
 */

export type SuppressionReason =
  | 'opted-out'
  | 'bounced'
  | 'complained'
  | 'already-contacted'
  | 'manual';

export interface SuppressionEntry {
  /** Bare hostname, lowercased, no `www.` — see `suppressionKey`. */
  key: string;
  reason: SuppressionReason;
  at: string;
  note?: string;
}

const FILE = join(process.cwd(), 'out', 'suppressed.jsonl');

/**
 * The identity a suppression is recorded against.
 *
 * A host, not a URL and not an email address. Someone who opts out from
 * `contact@acme.com` is opting out on behalf of `acme.com`, and following up
 * to `info@acme.com` because the string differs is exactly the move that earns
 * a complaint. Normalising here means `https://WWW.Acme.com/contact` and
 * `acme.com` are the same business, which they are.
 */
export function suppressionKey(input: string): string {
  const trimmed = input.trim().toLowerCase();
  let host = trimmed;
  try {
    host = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    // Not a URL. Fall through and normalise what we were given.
  }
  return host.replace(/^www\./, '').replace(/\.$/, '');
}

/** Reads the list. A missing file is an empty list, not an error. */
export async function loadSuppressed(file = FILE): Promise<Map<string, SuppressionEntry>> {
  const entries = new Map<string, SuppressionEntry>();
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return entries;
  }

  for (const line of raw.split('\n')) {
    const text = line.trim();
    if (text === '') continue;
    try {
      const entry = JSON.parse(text) as SuppressionEntry;
      if (typeof entry?.key === 'string' && entry.key !== '') {
        // First write wins: the earliest reason is the true one, and a later
        // 'already-contacted' must not overwrite an 'opted-out'.
        if (!entries.has(entry.key)) entries.set(entry.key, entry);
      }
    } catch {
      // One damaged line must not cost the rest of the list.
    }
  }
  return entries;
}

/** Adds an entry. Safe to call repeatedly; the earliest reason is preserved. */
export async function suppress(
  target: string,
  reason: SuppressionReason,
  options: { note?: string; at?: string; file?: string } = {},
): Promise<SuppressionEntry> {
  const file = options.file ?? FILE;
  const entry: SuppressionEntry = {
    key: suppressionKey(target),
    reason,
    at: options.at ?? new Date().toISOString(),
    ...(options.note ? { note: options.note } : {}),
  };
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8');
  return entry;
}

/**
 * Whether this business is off-limits.
 *
 * Call before drafting, not before sending. A draft that should not exist is a
 * draft somebody eventually sends by accident, and the whole point of the list
 * is that no human has to remember.
 */
export function isSuppressed(
  target: string,
  suppressed: Map<string, SuppressionEntry>,
): boolean {
  return suppressed.has(suppressionKey(target));
}

/** Splits candidates into those that may be contacted and those that may not. */
export function partitionSuppressed<T>(
  items: T[],
  hostOf: (item: T) => string,
  suppressed: Map<string, SuppressionEntry>,
): { allowed: T[]; blocked: Array<{ item: T; entry: SuppressionEntry }> } {
  const allowed: T[] = [];
  const blocked: Array<{ item: T; entry: SuppressionEntry }> = [];
  for (const item of items) {
    const entry = suppressed.get(suppressionKey(hostOf(item)));
    if (entry) blocked.push({ item, entry });
    else allowed.push(item);
  }
  return { allowed, blocked };
}
