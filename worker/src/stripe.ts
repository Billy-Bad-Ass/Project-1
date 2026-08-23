import { hmacHex, timingSafeEqual } from './crypto';

/**
 * Verification of Stripe's webhook signature, done by hand.
 *
 * The Stripe SDK's `constructEvent` does this, but it is built for Node and
 * pulls in a runtime this Worker does not have. The algorithm is small and
 * fully specified, so it is implemented here rather than reaching for a
 * polyfill that would be a much larger thing to trust.
 *
 * What the signature is actually protecting: the webhook URL is public, and
 * the endpoint's whole job is to record that somebody paid. Without
 * verification, anyone who finds the URL can POST a fabricated
 * `checkout.session.completed` and be sent a report for free — or, worse, have
 * a report sent to an address of their choosing about a website of their
 * choosing.
 */

export type VerifyResult = { ok: true; timestamp: number } | { ok: false; reason: string };

interface ParsedHeader {
  timestamp: number;
  signatures: string[];
}

/**
 * `t=1699999999,v1=abc...,v1=def...`
 *
 * More than one `v1` is normal rather than suspicious: during a signing-secret
 * rotation Stripe signs with both, and rejecting the second one would mean the
 * endpoint breaks precisely when the secret is being rolled.
 */
function parseHeader(header: string): ParsedHeader | null {
  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const part of header.split(',')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name === 't') {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return null;
      timestamp = parsed;
    } else if (name === 'v1') {
      signatures.push(value);
    }
  }

  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

/**
 * @param payload the raw request body, exactly as received. Re-serialising the
 *   parsed JSON changes key order and whitespace, and the signature is over
 *   the bytes, so a round-trip through `JSON.parse`/`stringify` turns every
 *   genuine webhook into a rejected one.
 * @param nowSeconds injected rather than read from the clock so the tolerance
 *   window is testable.
 */
export async function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  nowSeconds: number,
  toleranceSeconds = 300,
): Promise<VerifyResult> {
  if (!secret) return { ok: false, reason: 'no signing secret configured' };
  if (!header) return { ok: false, reason: 'missing Stripe-Signature header' };

  const parsed = parseHeader(header);
  if (!parsed) return { ok: false, reason: 'malformed Stripe-Signature header' };

  // Checked before the HMAC, and it matters: a valid signature stays valid
  // forever, so without a window an attacker who captures one genuine webhook
  // can replay it indefinitely. Refunds and duplicate deliveries live here.
  const age = Math.abs(nowSeconds - parsed.timestamp);
  if (age > toleranceSeconds) {
    return { ok: false, reason: `timestamp outside tolerance (${age}s)` };
  }

  const expected = await hmacHex(secret, `${parsed.timestamp}.${payload}`);
  for (const candidate of parsed.signatures) {
    if (timingSafeEqual(expected, candidate)) return { ok: true, timestamp: parsed.timestamp };
  }
  return { ok: false, reason: 'no signature matched' };
}

export interface StripeOrder {
  /**
   * Whether this sale was confirmed to be the audit product.
   *
   * False means no product filter was configured, so the order was recorded
   * without knowing what was bought. That matters because a Stripe account
   * can carry more than one business, and `checkout.session.completed` fires
   * for all of them — this very account also serves a printable-guides
   * storefront. Fulfilment must refuse to act on an unmatched order rather
   * than send somebody a website audit they did not buy.
   */
  matchedProduct: boolean;
  eventId: string;
  sessionId: string;
  email: string | null;
  /** The website the customer asked us to review, if the Payment Link collects it. */
  site: string | null;
  amountTotal: number | null;
  currency: string | null;
  livemode: boolean;
  at: string;
}

interface StripeEventShape {
  id?: unknown;
  type?: unknown;
  livemode?: unknown;
  created?: unknown;
  data?: { object?: Record<string, unknown> };
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Pulls the order out of a `checkout.session.completed` event.
 *
 * Everything is read defensively. This runs on input from the network, and a
 * shape assumption that throws inside the handler becomes a 500, which Stripe
 * reads as "endpoint down" and retries — turning one malformed event into a
 * repeating one.
 */
export function orderFromEvent(
  event: unknown,
  expectedPaymentLink?: string,
): StripeOrder | null {
  const shape = event as StripeEventShape;
  if (str(shape?.type) !== 'checkout.session.completed') return null;

  const session = shape.data?.object;
  if (!session || typeof session !== 'object') return null;

  // Another product on the same Stripe account. Not an error and not ours —
  // acknowledged by the caller and dropped here.
  const link = str(session['payment_link']);
  const expected = expectedPaymentLink?.trim();
  if (expected && link !== expected) return null;

  const eventId = str(shape.id);
  const sessionId = str(session['id']);
  if (!eventId || !sessionId) return null;

  const details = session['customer_details'];
  const email =
    str(session['customer_email']) ??
    (details && typeof details === 'object'
      ? str((details as Record<string, unknown>)['email'])
      : null);

  const amount = session['amount_total'];
  const created = shape.created;

  return {
    matchedProduct: Boolean(expected) && link === expected,
    eventId,
    sessionId,
    email,
    site: siteFromSession(session),
    amountTotal: typeof amount === 'number' ? amount : null,
    currency: str(session['currency']),
    livemode: shape.livemode === true,
    at: new Date(typeof created === 'number' ? created * 1000 : Date.now()).toISOString(),
  };
}

/**
 * The website to review.
 *
 * A Payment Link can collect it three different ways depending on how it was
 * configured, and which one is in use is not something this endpoint should
 * have to know. All three are checked, most specific first. When none is
 * present the order is still recorded with a null site — an order we cannot
 * fulfil yet is a thing to chase, not a thing to drop on the floor.
 */
function siteFromSession(session: Record<string, unknown>): string | null {
  const fields = session['custom_fields'];
  if (Array.isArray(fields)) {
    for (const field of fields) {
      if (!field || typeof field !== 'object') continue;
      const record = field as Record<string, unknown>;
      const text = record['text'];
      const value =
        text && typeof text === 'object' ? str((text as Record<string, unknown>)['value']) : null;
      if (value) return value;
    }
  }

  const reference = str(session['client_reference_id']);
  if (reference) return reference;

  const metadata = session['metadata'];
  if (metadata && typeof metadata === 'object') {
    const record = metadata as Record<string, unknown>;
    return str(record['site']) ?? str(record['url']) ?? str(record['website']);
  }
  return null;
}
