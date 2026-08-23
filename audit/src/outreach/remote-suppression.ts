import { loadEnv } from '../lib/env';
import {
  loadSuppressed,
  suppressionKey,
  type SuppressionEntry,
  type SuppressionReason,
} from './suppression';

loadEnv();

/**
 * The suppression list as CI can see it.
 *
 * The local file cannot be committed — this repository is public and the list
 * is other people's contact details — so a scheduled job has no way to read
 * it. A job that cannot check who opted out must not be allowed to send, and
 * that is what has kept outreach manual.
 *
 * The Worker holds the shared copy. This module is the client.
 */

export interface RemoteStore {
  base: string;
  token: string;
}

/** Raised when the shared list is configured but could not be read. */
export class SuppressionUnavailable extends Error {
  constructor(cause: string) {
    super(
      `Refusing to draft: the shared suppression list could not be read.\n\n` +
        `  ${cause}\n\n` +
        `Drafting against a stale list is how somebody who asked to be left\n` +
        `alone gets emailed again. Fix the connection, or unset\n` +
        `AUDIT_SUPPRESSION_API to fall back to the local file only.\n`,
    );
    this.name = 'SuppressionUnavailable';
  }
}

/** Ten seconds. Long enough for a cold Worker, short enough to not hang a run. */
const TIMEOUT_MS = 10_000;

export function remoteStore(): RemoteStore | null {
  const base = process.env.AUDIT_SUPPRESSION_API?.trim();
  const token = process.env.AUDIT_SUPPRESSION_TOKEN?.trim();
  if (!base || !token) return null;
  return { base: base.replace(/\/+$/, ''), token };
}

type Fetcher = typeof globalThis.fetch;

function parseEntries(text: string): Map<string, SuppressionEntry> {
  const entries = new Map<string, SuppressionEntry>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      const entry = JSON.parse(trimmed) as SuppressionEntry;
      if (typeof entry?.key === 'string' && entry.key !== '') {
        if (!entries.has(entry.key)) entries.set(entry.key, entry);
      }
    } catch {
      // Same rule as the local file: one damaged line costs one record.
    }
  }
  return entries;
}

function describeFetchError(error: unknown): string {
  if (!(error instanceof Error)) return 'the request failed';
  if (error.name === 'TimeoutError') return `timed out after ${TIMEOUT_MS / 1000}s`;
  const cause = (error as { cause?: unknown }).cause;
  const detail = cause instanceof Error ? cause.message : null;
  return detail ? `${error.message}: ${detail}` : error.message;
}

export async function pullSuppressed(
  store: RemoteStore,
  fetchImpl: Fetcher = globalThis.fetch,
): Promise<Map<string, SuppressionEntry>> {
  let response: Response;
  try {
    response = await fetchImpl(`${store.base}/api/suppression`, {
      headers: { authorization: `Bearer ${store.token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    // Node's fetch reports every network failure as the same three words and
    // hides what actually happened — DNS, TLS, refused, timed out — one level
    // down in `cause`. Unwrapping it is the difference between a message you
    // can act on and one you have to reproduce by hand.
    throw new SuppressionUnavailable(describeFetchError(error));
  }

  if (!response.ok) {
    // 401 is called out because it is the likely one and the least obvious:
    // a wrong token returns a perfectly well-formed empty-looking failure.
    throw new SuppressionUnavailable(
      response.status === 401
        ? 'the API rejected the token (401) — check AUDIT_SUPPRESSION_TOKEN'
        : `the API returned HTTP ${response.status}`,
    );
  }

  return parseEntries(await response.text());
}

export async function pushSuppression(
  store: RemoteStore,
  target: string,
  reason: SuppressionReason,
  note?: string,
  fetchImpl: Fetcher = globalThis.fetch,
): Promise<{ created: boolean }> {
  const response = await fetchImpl(`${store.base}/api/suppression`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${store.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ target, reason, ...(note ? { note } : {}) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new SuppressionUnavailable(`writing ${suppressionKey(target)} failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as { created?: unknown };
  return { created: body?.created === true };
}

export interface CombinedList {
  entries: Map<string, SuppressionEntry>;
  source: 'local' | 'local+shared';
  /** Present only when a shared list was read. */
  sharedCount?: number;
}

/**
 * The list to check before drafting anything.
 *
 * With no shared store configured this is the local file, unchanged — the
 * shared list is an upgrade, not a prerequisite, and requiring it would mean a
 * misconfigured Worker stops the business.
 *
 * With one configured it is both, and a shared list that cannot be read is a
 * hard stop rather than a warning. That asymmetry is the point: "configured
 * but unreachable" is exactly the state in which carrying on would look fine
 * and email people who opted out.
 */
export async function loadSuppressedForSending(
  options: { file?: string; fetchImpl?: Fetcher } = {},
): Promise<CombinedList> {
  const local = await loadSuppressed(options.file);
  const store = remoteStore();
  if (!store) return { entries: local, source: 'local' };

  const shared = await pullSuppressed(store, options.fetchImpl);

  // Union, with the earlier record winning on conflict — the same
  // first-write-wins rule the local file uses, so a later
  // 'already-contacted' never overwrites an earlier 'opted-out'.
  const merged = new Map(shared);
  for (const [key, entry] of local) {
    const existing = merged.get(key);
    if (!existing || Date.parse(entry.at) < Date.parse(existing.at)) merged.set(key, entry);
  }

  return { entries: merged, source: 'local+shared', sharedCount: shared.size };
}

/**
 * Copies anything the local file knows and the shared store does not.
 *
 * One-way on purpose. Pulling shared entries down into the append-only local
 * file would duplicate a record every run, and the file is the one thing here
 * with no deduplication on write.
 */
export async function pushLocalSuppressions(
  options: { file?: string; fetchImpl?: Fetcher } = {},
): Promise<{ pushed: number; alreadyThere: number; sharedTotal: number }> {
  const store = remoteStore();
  if (!store) throw new Error('AUDIT_SUPPRESSION_API and AUDIT_SUPPRESSION_TOKEN are not set.');

  const local = await loadSuppressed(options.file);
  const shared = await pullSuppressed(store, options.fetchImpl);

  let pushed = 0;
  let alreadyThere = 0;
  for (const [key, entry] of local) {
    if (shared.has(key)) {
      alreadyThere += 1;
      continue;
    }
    const result = await pushSuppression(
      store,
      key,
      entry.reason,
      entry.note,
      options.fetchImpl,
    );
    if (result.created) pushed += 1;
    else alreadyThere += 1;
  }

  return { pushed, alreadyThere, sharedTotal: shared.size + pushed };
}
