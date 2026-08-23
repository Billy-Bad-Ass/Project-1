import { hmacBase64Url, timingSafeEqual } from './crypto';
import { suppressionKey } from './store';

/**
 * Unsubscribe links that carry their own proof.
 *
 * The alternative — generating a random token per recipient and storing it —
 * needs a write before every send and a lookup on every click. This needs
 * neither: the token is an HMAC of the host under a secret only the Worker
 * holds, so the link verifies itself.
 *
 * The property that matters is that the link cannot be guessed or enumerated.
 * A predictable one lets anyone unsubscribe any business, which sounds
 * harmless until you notice it also lets a competitor quietly remove every
 * prospect from your list.
 */

const VERSION = 'v1';

/** 32 base64url characters — 192 bits, far past anything worth guessing. */
const LENGTH = 32;

export async function unsubscribeToken(host: string, secret: string): Promise<string> {
  const key = suppressionKey(host);
  const digest = await hmacBase64Url(secret, `unsub:${VERSION}:${key}`);
  return digest.slice(0, LENGTH);
}

export async function verifyUnsubscribeToken(
  host: string,
  token: string,
  secret: string,
): Promise<boolean> {
  if (!secret || !token) return false;
  return timingSafeEqual(await unsubscribeToken(host, secret), token);
}

/**
 * The link that goes in the email.
 *
 * The host is in the path as well as the token because the Worker has to know
 * who is unsubscribing, and an HMAC is a one-way function — the token alone
 * says nothing about whom it is for.
 */
export function unsubscribeUrl(base: string, host: string, token: string): string {
  const key = suppressionKey(host);
  return `${base.replace(/\/+$/, '')}/u/${encodeURIComponent(key)}/${token}`;
}
