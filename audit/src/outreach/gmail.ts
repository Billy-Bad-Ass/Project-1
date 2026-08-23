import { loadEnv } from '../lib/env';

loadEnv();

/**
 * Gmail, as a credential this repository holds rather than a connector
 * somebody has to authorise in a chat client.
 *
 * The distinction matters: a connector is an account-level OAuth grant that
 * exists only inside the tool that asked for it. It cannot be used by a
 * scheduled job, and no agent can grant one to itself. A refresh token in
 * .env.local works everywhere the pipeline runs, including CI.
 *
 * Two modes, and the default is the safe one. `createDraft` puts the message
 * in the Gmail drafts folder, where a human still has to press send.
 * `sendMessage` sends. Everything the drafting pipeline knows about
 * compliance and opt-outs applies to both, but only one of them is
 * irreversible.
 */

export interface GmailCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export class MissingGmailCredentials extends Error {
  constructor(missing: string[]) {
    super(
      `Gmail is not configured.\n\nMissing:\n${missing.map((m) => `  ${m}`).join('\n')}\n\n` +
        `These are a Google Cloud OAuth client and a refresh token for the\n` +
        `account that sends the mail — not a Claude connector. See\n` +
        `docs/SENDING.md for how to obtain them once.\n`,
    );
    this.name = 'MissingGmailCredentials';
  }
}

export function gmailCredentials(): GmailCredentials {
  const clientId = process.env.GMAIL_CLIENT_ID?.trim();
  const clientSecret = process.env.GMAIL_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN?.trim();

  const missing: string[] = [];
  if (!clientId) missing.push('GMAIL_CLIENT_ID');
  if (!clientSecret) missing.push('GMAIL_CLIENT_SECRET');
  if (!refreshToken) missing.push('GMAIL_REFRESH_TOKEN');
  if (missing.length > 0) throw new MissingGmailCredentials(missing);

  return { clientId: clientId!, clientSecret: clientSecret!, refreshToken: refreshToken! };
}

export function gmailReady(): boolean {
  try {
    gmailCredentials();
    return true;
  } catch {
    return false;
  }
}

type Fetcher = typeof globalThis.fetch;

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TIMEOUT_MS = 20_000;

export async function accessToken(
  credentials: GmailCredentials,
  fetchImpl: Fetcher = globalThis.fetch,
): Promise<string> {
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    // The body carries Google's own reason — invalid_grant when the token has
    // been revoked, which is the common one and says nothing useful without it.
    const detail = await response.text().catch(() => '');
    throw new Error(`Gmail rejected the refresh token (HTTP ${response.status}): ${detail.slice(0, 200)}`);
  }

  const body = (await response.json()) as { access_token?: unknown };
  if (typeof body.access_token !== 'string') throw new Error('Gmail returned no access token');
  return body.access_token;
}

export interface Attachment {
  filename: string;
  /** Only what this pipeline actually attaches. */
  mimeType: 'text/html' | 'application/pdf';
  content: string;
}

export interface Outgoing {
  to: string;
  from: string;
  subject: string;
  body: string;
  attachments?: Attachment[];
  /** RFC 8058 one-click unsubscribe. */
  unsubscribeUrl?: string | null;
}

/**
 * Encodes a header value that may contain non-ASCII characters.
 *
 * A business name with an accent in it produces a raw 8-bit byte in a header,
 * which is invalid and is either rejected or silently mangled into mojibake in
 * the recipient's client. RFC 2047 is the encoding that avoids that.
 */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function base64Url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * Builds the RFC 5322 message.
 *
 * Multipart only when there is something to attach: a multipart message with a
 * single part is legal but renders as an empty attachment in some clients, and
 * the plain case is by far the common one.
 */
export function buildMime(message: Outgoing): string {
  const headers = [
    `From: ${encodeHeader(message.from)}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    'MIME-Version: 1.0',
  ];

  if (message.unsubscribeUrl) {
    // Both headers, or neither. List-Unsubscribe alone gives the provider a
    // link to show; the -Post header is what makes their own unsubscribe
    // button work without the recipient leaving the inbox.
    headers.push(`List-Unsubscribe: <${message.unsubscribeUrl}>`);
    headers.push('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
  }

  const attachments = message.attachments ?? [];
  if (attachments.length === 0) {
    return [...headers, 'Content-Type: text/plain; charset="UTF-8"', '', message.body].join('\r\n');
  }

  const boundary = `bba_${base64Url(String(message.subject.length)).slice(0, 8)}_${attachments.length}`;
  const parts: string[] = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    message.body,
  ];

  for (const file of attachments) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${file.mimeType}; name="${file.filename}"`,
      `Content-Disposition: attachment; filename="${file.filename}"`,
      'Content-Transfer-Encoding: base64',
      '',
      // Wrapped at 76 characters: base64 in a mail body has a line-length
      // limit, and some servers reject or truncate a single enormous line.
      (Buffer.from(file.content, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n'),
    );
  }

  parts.push(`--${boundary}--`, '');
  return parts.join('\r\n');
}

async function call(
  path: string,
  raw: string,
  token: string,
  fetchImpl: Fetcher,
): Promise<{ id: string }> {
  const isDraft = path.includes('drafts');
  const response = await fetchImpl(`${API}/${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(isDraft ? { message: { raw } } : { raw }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Gmail ${path} failed (HTTP ${response.status}): ${detail.slice(0, 300)}`);
  }
  const body = (await response.json()) as { id?: unknown };
  return { id: typeof body.id === 'string' ? body.id : '(no id)' };
}

/** Puts the message in Gmail's drafts folder. Nothing leaves the account. */
export async function createDraft(
  message: Outgoing,
  token: string,
  fetchImpl: Fetcher = globalThis.fetch,
): Promise<{ id: string }> {
  return call('drafts', base64Url(buildMime(message)), token, fetchImpl);
}

/** Sends. There is no undo. */
export async function sendMessage(
  message: Outgoing,
  token: string,
  fetchImpl: Fetcher = globalThis.fetch,
): Promise<{ id: string }> {
  return call('messages/send', base64Url(buildMime(message)), token, fetchImpl);
}
