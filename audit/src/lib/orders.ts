import Stripe from 'stripe';

/**
 * Turning a Stripe payment into an order this tool can fulfil.
 *
 * The architecture is deliberately serverless: a Payment Link collects the
 * customer's website address as a custom field, and fulfilment polls Stripe
 * for completed sessions. No webhook endpoint means nothing to host, nothing
 * to keep online, and no signing secret to leak — which matters when the whole
 * operation has to run for nothing.
 *
 * The trade is that fulfilment is a command you run rather than something that
 * happens the instant they pay. For a service with a human turnaround anyway,
 * that costs nothing real.
 */

export interface Order {
  sessionId: string;
  /** The website the customer asked us to audit. */
  siteUrl: string | null;
  email: string | null;
  amountPaid: number | null;
  currency: string | null;
  paidAt: string;
  /** Anything else they typed, keyed by custom field key. */
  fields: Record<string, string>;
}

/** The custom field key the Payment Link must use for the website address. */
export const SITE_FIELD_KEYS = ['website', 'websiteaddress', 'siteurl', 'url', 'site'];

export function stripeClient(apiKey = process.env.STRIPE_SECRET_KEY): Stripe {
  if (!apiKey || apiKey.trim() === '') {
    throw new Error(
      'STRIPE_SECRET_KEY is not set. Use your test key (sk_test_...) until you have taken a real payment.',
    );
  }
  return new Stripe(apiKey.trim());
}

/**
 * Read the value out of a Checkout custom field.
 *
 * Written defensively on purpose: the field carries its value under a
 * different property per field type, and an unrecognised type must yield null
 * rather than "[object Object]" landing in a customer-facing report.
 */
export function customFieldValue(field: Stripe.Checkout.Session.CustomField): string | null {
  switch (field.type) {
    case 'text':
      return field.text?.value ?? null;
    case 'numeric':
      return field.numeric?.value ?? null;
    case 'dropdown':
      return field.dropdown?.value ?? null;
    default:
      return null;
  }
}

/** Pull the site to audit out of a session, tolerating how the field was named. */
export function siteUrlFrom(session: Stripe.Checkout.Session): string | null {
  const fields = session.custom_fields ?? [];

  for (const field of fields) {
    const key = field.key.toLowerCase().replace(/[^a-z]/g, '');
    if (SITE_FIELD_KEYS.includes(key)) {
      const value = customFieldValue(field);
      if (value && value.trim() !== '') return value.trim();
    }
  }

  // Fall back to any field whose value looks like a web address, so a
  // mislabelled field does not silently cost us a paying customer's order.
  for (const field of fields) {
    const value = customFieldValue(field)?.trim();
    if (value && /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(value)) return value;
  }

  return null;
}

export function toOrder(session: Stripe.Checkout.Session): Order {
  const fields: Record<string, string> = {};
  for (const field of session.custom_fields ?? []) {
    const value = customFieldValue(field);
    if (value !== null) fields[field.key] = value;
  }

  return {
    sessionId: session.id,
    siteUrl: siteUrlFrom(session),
    email: session.customer_details?.email ?? session.customer_email ?? null,
    amountPaid: session.amount_total,
    currency: session.currency,
    paidAt: new Date((session.created ?? 0) * 1000).toISOString(),
    fields,
  };
}

/** Raised when a query would sweep in products this business does not sell. */
export class UnscopedOrderQuery extends Error {
  constructor() {
    super(
      `Refusing to list orders without a payment link to scope them to.\n\n` +
        `A Stripe account can carry more than one business, and this one does:\n` +
        `the printable-guides storefront sells through the same account. An\n` +
        `unscoped query returns those sales too, and the next step after this\n` +
        `one emails every buyer a website audit they did not order.\n\n` +
        `Set STRIPE_PAYMENT_LINK_ID to the audit product's link (plink_...),\n` +
        `or pass allowEveryProduct: true if you genuinely mean every sale.\n`,
    );
    this.name = 'UnscopedOrderQuery';
  }
}

/**
 * Every paid, completed Checkout Session for the audit product.
 *
 * Filters on payment_status rather than status: a session can be "complete"
 * while payment is still pending for slower methods like bank debits, and
 * delivering work before the money clears is how you end up doing it free.
 *
 * Scoping to one payment link is required rather than optional. It was
 * optional, and that was only safe while the Stripe account sold exactly one
 * thing — an assumption nothing enforced and nothing announced when it stopped
 * being true.
 */
export async function fetchPaidOrders(
  stripe: Stripe,
  options: { paymentLinkId?: string; limit?: number; allowEveryProduct?: boolean } = {},
): Promise<Order[]> {
  const linkId = options.paymentLinkId?.trim() || process.env.STRIPE_PAYMENT_LINK_ID?.trim();
  if (!linkId && !options.allowEveryProduct) throw new UnscopedOrderQuery();

  const orders: Order[] = [];
  const params: Stripe.Checkout.SessionListParams = {
    limit: 100,
    expand: ['data.customer_details'],
  };
  if (linkId) params.payment_link = linkId;

  const max = options.limit ?? 200;

  for await (const session of stripe.checkout.sessions.list(params)) {
    if (session.payment_status !== 'paid') continue;
    orders.push(toOrder(session));
    if (orders.length >= max) break;
  }

  return orders;
}
