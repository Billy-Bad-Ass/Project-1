import type { StripeOrder } from './stripe';

/**
 * The shared store, which exists to solve one specific problem.
 *
 * The suppression list — the people who asked never to be contacted again —
 * has until now been a local file. It cannot be committed, because this
 * repository is public and that list is other people's contact details, which
 * means scheduled jobs running in CI cannot see it. A scheduled job that
 * cannot check who opted out is a scheduled job that must not be allowed to
 * send, and that is what has been blocking automation.
 *
 * Here the list lives in one place that both a laptop and a CI runner can
 * reach, and still never enters git.
 */

export type SuppressionReason =
  | 'opted-out'
  | 'bounced'
  | 'complained'
  | 'already-contacted'
  | 'manual';

export interface SuppressionEntry {
  key: string;
  reason: SuppressionReason;
  at: string;
  note?: string;
}

const REASONS: readonly SuppressionReason[] = [
  'opted-out',
  'bounced',
  'complained',
  'already-contacted',
  'manual',
];

export function isReason(value: unknown): value is SuppressionReason {
  return typeof value === 'string' && (REASONS as readonly string[]).includes(value);
}

const SUPPRESSION_PREFIX = 'sup:';
const ORDER_PREFIX = 'order:';
const EVENT_PREFIX = 'evt:';

/** Thirty days is comfortably longer than Stripe will retry a single event. */
const EVENT_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * Normalises to the identity a suppression is recorded against: a bare host.
 *
 * Deliberately identical to `suppressionKey` in the audit package, because the
 * two must agree. Someone who opts out from `contact@acme.com` is opting out
 * on behalf of `acme.com`, and following up to `info@acme.com` because the
 * string differs is exactly the move that earns a complaint.
 */
export function suppressionKey(input: string): string {
  const trimmed = input.trim().toLowerCase();
  let host = trimmed;
  try {
    host = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    // Not a URL. Normalise what we were given instead.
  }
  return host.replace(/^www\./, '').replace(/\.$/, '');
}

/**
 * Records a suppression. Safe to call repeatedly.
 *
 * First write wins, matching the local file's append-only semantics: a later
 * `already-contacted` must never overwrite an earlier `opted-out`, or the
 * strongest signal on the list gets quietly downgraded by routine bookkeeping.
 *
 * The entry is stored in the key's metadata as well as its value. Metadata
 * comes back with `list()`, so exporting the whole list for CI is one call
 * rather than one call plus a `get` per entry.
 */
export async function addSuppression(
  kv: KVNamespace,
  target: string,
  reason: SuppressionReason,
  note?: string,
): Promise<{ entry: SuppressionEntry; created: boolean }> {
  const key = suppressionKey(target);
  if (key === '') throw new Error('empty suppression key');

  const existing = await kv.get(SUPPRESSION_PREFIX + key, 'json');
  if (existing && typeof existing === 'object') {
    return { entry: existing as SuppressionEntry, created: false };
  }

  const entry: SuppressionEntry = {
    key,
    reason,
    at: new Date().toISOString(),
    ...(note ? { note } : {}),
  };
  // No expiration, ever. Someone who asked to be left alone in March has not
  // consented by September, and a list that expires is not a suppression list.
  await kv.put(SUPPRESSION_PREFIX + key, JSON.stringify(entry), { metadata: entry });
  return { entry, created: true };
}

export async function isSuppressed(kv: KVNamespace, target: string): Promise<boolean> {
  const key = suppressionKey(target);
  if (key === '') return false;
  return (await kv.get(SUPPRESSION_PREFIX + key)) !== null;
}

/** The whole list, for CI to pull before it drafts anything. */
export async function listSuppressions(kv: KVNamespace): Promise<SuppressionEntry[]> {
  const entries: SuppressionEntry[] = [];
  let cursor: string | undefined;

  do {
    const page = await kv.list<SuppressionEntry>({ prefix: SUPPRESSION_PREFIX, cursor });
    for (const item of page.keys) {
      const metadata = item.metadata;
      if (metadata && typeof metadata === 'object' && typeof metadata.key === 'string') {
        entries.push(metadata);
      } else {
        // Written before metadata was stored, or truncated. The key name is
        // still authoritative for who is suppressed, and being on the list at
        // all is what matters — so reconstruct rather than drop the record.
        entries.push({
          key: item.name.slice(SUPPRESSION_PREFIX.length),
          reason: 'manual',
          at: new Date(0).toISOString(),
          note: 'recovered: entry metadata missing',
        });
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return entries;
}

/**
 * Records a paid order, exactly once.
 *
 * Stripe guarantees at-least-once delivery and will retry on any non-2xx, so
 * the same event genuinely does arrive twice. Without the event marker a retry
 * means a second report, and a customer who paid once being emailed twice is
 * the visible half of the problem; the invisible half is the ledger disagreeing
 * with Stripe about how many sales there were.
 */
export async function recordOrder(
  kv: KVNamespace,
  order: StripeOrder,
): Promise<{ stored: boolean }> {
  const seen = await kv.get(EVENT_PREFIX + order.eventId);
  if (seen !== null) return { stored: false };

  await kv.put(ORDER_PREFIX + order.sessionId, JSON.stringify(order), {
    metadata: { at: order.at, email: order.email, site: order.site },
  });
  await kv.put(EVENT_PREFIX + order.eventId, order.sessionId, {
    expirationTtl: EVENT_TTL_SECONDS,
  });
  return { stored: true };
}

export async function listOrders(kv: KVNamespace): Promise<StripeOrder[]> {
  const orders: StripeOrder[] = [];
  let cursor: string | undefined;

  do {
    const page = await kv.list({ prefix: ORDER_PREFIX, cursor });
    for (const item of page.keys) {
      const raw = await kv.get(item.name, 'json');
      if (raw && typeof raw === 'object') orders.push(raw as StripeOrder);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return orders;
}
