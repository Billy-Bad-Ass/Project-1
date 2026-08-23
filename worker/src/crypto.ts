/**
 * The two primitives everything else here depends on being right.
 *
 * Both are short enough to read in full, which is the point: a subtle mistake
 * in either one is not visible in any test that only checks the happy path.
 */

const encoder = new TextEncoder();

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/** HMAC-SHA256 of `message` under `secret`, lowercase hex. */
export async function hmacHex(secret: string, message: string): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(message));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** HMAC-SHA256 of `message` under `secret`, base64url, no padding. */
export async function hmacBase64Url(secret: string, message: string): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(message));
  let binary = '';
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Compares two strings without leaking, through timing, how much of the
 * candidate was correct.
 *
 * `a === b` on a secret returns as soon as it finds a differing byte, so the
 * time it takes reveals the length of the matching prefix. Given enough
 * attempts that is enough to reconstruct the value a byte at a time. Every
 * comparison in this Worker that involves a signature or a bearer token goes
 * through here.
 *
 * Length is deliberately compared first and in the clear. Length is not the
 * secret, and looping to the longer of the two would either read past the end
 * of the shorter string or need a branch that reintroduces the leak.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}
