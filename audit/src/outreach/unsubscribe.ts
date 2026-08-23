import { createHmac } from 'node:crypto';

import { loadEnv } from '../lib/env';
import { suppressionKey } from './suppression';

loadEnv();

/**
 * The recipient's side of the opt-out link.
 *
 * This has to produce byte-identical tokens to `worker/src/tokens.ts`, which
 * verifies them. Two implementations of one algorithm is a drift risk, so both
 * packages test against the same hardcoded vector in `UNSUBSCRIBE_VECTOR`: if
 * either side ever changes, one of the two test suites fails rather than every
 * unsubscribe link silently 404ing.
 *
 * They are separate implementations on purpose — the Worker runs on Web Crypto
 * and this runs on Node's, and sharing code across the two packages would mean
 * the audit package's build had to satisfy the Workers runtime.
 */

const VERSION = 'v1';
const LENGTH = 32;

export function unsubscribeToken(host: string, secret: string): string {
  const key = suppressionKey(host);
  return createHmac('sha256', secret)
    .update(`unsub:${VERSION}:${key}`)
    .digest('base64url')
    .slice(0, LENGTH);
}

export function unsubscribeUrl(base: string, host: string, secret: string): string {
  const key = suppressionKey(host);
  return `${base.replace(/\/+$/, '')}/u/${encodeURIComponent(key)}/${unsubscribeToken(key, secret)}`;
}

/**
 * A frozen input/output pair, asserted by both packages.
 *
 * The values are arbitrary and the secret is not a real one. Its only job is
 * to be the same on both sides.
 */
export const UNSUBSCRIBE_VECTOR = {
  host: 'https://WWW.Example-Practice.com/contact',
  secret: 'vector-secret-do-not-use',
  key: 'example-practice.com',
} as const;

/**
 * The configured link base, if there is one.
 *
 * Absent, outreach falls back to the reply-based opt-out, which is still valid
 * and still works. The link is an improvement, not a prerequisite — gating
 * sending on it would mean a misconfigured Worker stops the business.
 */
export function unsubscribeBase(): { base: string; secret: string } | null {
  const base = process.env.AUDIT_UNSUBSCRIBE_BASE?.trim();
  const secret = process.env.AUDIT_UNSUBSCRIBE_SECRET?.trim();
  if (!base || !secret) return null;
  if (!/^https:\/\//i.test(base)) return null;
  return { base, secret };
}

/** The opt-out link for one business, or null when links are not configured. */
export function unsubscribeLinkFor(host: string): string | null {
  const config = unsubscribeBase();
  return config ? unsubscribeUrl(config.base, host, config.secret) : null;
}
