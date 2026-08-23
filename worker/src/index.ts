import { timingSafeEqual } from './crypto';
import { badLinkPage, confirmPage, donePage } from './pages';
import {
  addSuppression,
  isReason,
  listOrders,
  listSuppressions,
  suppressionKey,
} from './store';
import { orderFromEvent, verifyStripeSignature } from './stripe';
import { recordOrder } from './store';
import { verifyUnsubscribeToken } from './tokens';

export interface Env {
  STORE: KVNamespace;
  /** From the Stripe dashboard's webhook endpoint. `whsec_...`. */
  STRIPE_WEBHOOK_SECRET: string;
  /** Signs unsubscribe links. Any long random string; never leaves the Worker. */
  UNSUBSCRIBE_SECRET: string;
  /** Bearer token the pipeline uses to read and write the suppression list. */
  API_TOKEN: string;
  SENDER_BUSINESS?: string;
  SENDER_EMAIL?: string;
}

const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
} as const;

function business(env: Env): string {
  return env.SENDER_BUSINESS?.trim() || 'BBA Network';
}

function contact(env: Env): string | null {
  return env.SENDER_EMAIL?.trim() || null;
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: HTML_HEADERS });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * Bearer auth for the pipeline endpoints.
 *
 * Compared in constant time like everything else here. An empty configured
 * token is treated as "locked", not "open" — a missing secret must never be
 * the thing that publishes the suppression list to the internet.
 */
function authorised(request: Request, env: Env): boolean {
  const configured = env.API_TOKEN?.trim();
  if (!configured) return false;
  const header = request.headers.get('authorization') ?? '';
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return false;
  return timingSafeEqual(configured, header.slice(prefix.length).trim());
}

async function handleStripeWebhook(request: Request, env: Env): Promise<Response> {
  // The raw bytes, before any parsing. The signature is over exactly these,
  // so a round-trip through JSON.parse/stringify — which reorders keys and
  // drops whitespace — would reject every genuine webhook.
  const payload = await request.text();

  const verified = await verifyStripeSignature(
    payload,
    request.headers.get('stripe-signature'),
    env.STRIPE_WEBHOOK_SECRET,
    Math.floor(Date.now() / 1000),
  );
  if (!verified.ok) {
    // 400, not 500. Stripe retries 5xx, and retrying a forged request forever
    // is a way to be hammered by your own endpoint.
    return json({ error: 'signature verification failed' }, 400);
  }

  let event: unknown;
  try {
    event = JSON.parse(payload);
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }

  const order = orderFromEvent(event);
  // Every other event type is acknowledged rather than rejected. A non-2xx
  // tells Stripe the endpoint is broken and it starts retrying, so refusing
  // events we simply do not act on would manufacture an outage.
  if (!order) return json({ ok: true, ignored: true });

  const { stored } = await recordOrder(env.STORE, order);
  return json({ ok: true, sessionId: order.sessionId, stored });
}

async function handleUnsubscribe(
  request: Request,
  env: Env,
  rawHost: string,
  token: string,
): Promise<Response> {
  const host = suppressionKey(decodeURIComponent(rawHost));
  const valid = host !== '' && (await verifyUnsubscribeToken(host, token, env.UNSUBSCRIBE_SECRET));
  if (!valid) return html(badLinkPage(business(env), contact(env)), 404);

  if (request.method === 'GET') {
    // Shows a button. Deliberately does not act — see pages.ts.
    return html(confirmPage(business(env), host));
  }

  await addSuppression(env.STORE, host, 'opted-out', 'via unsubscribe link');
  return html(donePage(business(env), host, contact(env)));
}

async function handleSuppressionApi(request: Request, env: Env): Promise<Response> {
  if (!authorised(request, env)) return json({ error: 'unauthorised' }, 401);

  if (request.method === 'GET') {
    const entries = await listSuppressions(env.STORE);
    // JSON Lines, matching the local file byte for byte, so the pipeline can
    // write the response straight to disk as its cache with no reformatting.
    const body = entries.map((entry) => JSON.stringify(entry)).join('\n');
    return new Response(entries.length > 0 ? `${body}\n` : '', {
      headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }

  const record = payload as { target?: unknown; reason?: unknown; note?: unknown };
  const target = typeof record?.target === 'string' ? record.target : '';
  if (suppressionKey(target) === '') return json({ error: 'target required' }, 400);
  if (!isReason(record?.reason)) return json({ error: 'unknown reason' }, 400);

  const { entry, created } = await addSuppression(
    env.STORE,
    target,
    record.reason,
    typeof record.note === 'string' ? record.note : undefined,
  );
  return json({ ok: true, entry, created });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method.toUpperCase();

    if (path === '/health') return json({ ok: true });

    if (path === '/stripe/webhook') {
      if (method !== 'POST') return json({ error: 'method not allowed' }, 405);
      return handleStripeWebhook(request, env);
    }

    const unsubscribe = /^\/u\/([^/]+)\/([^/]+)$/.exec(path);
    if (unsubscribe) {
      if (method !== 'GET' && method !== 'POST') return json({ error: 'method not allowed' }, 405);
      return handleUnsubscribe(request, env, unsubscribe[1]!, unsubscribe[2]!);
    }

    if (path === '/api/suppression') {
      if (method !== 'GET' && method !== 'POST') return json({ error: 'method not allowed' }, 405);
      return handleSuppressionApi(request, env);
    }

    if (path === '/api/orders') {
      if (method !== 'GET') return json({ error: 'method not allowed' }, 405);
      if (!authorised(request, env)) return json({ error: 'unauthorised' }, 401);
      return json({ orders: await listOrders(env.STORE) });
    }

    return json({ error: 'not found' }, 404);
  },
} satisfies ExportedHandler<Env>;
