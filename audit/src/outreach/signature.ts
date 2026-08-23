import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { BRAND_ACCENT, BRAND_INK } from '../report/brand';
import type { SenderConfig } from '../report/config';
import { complianceFooter, type ComplianceConfig } from './compliance';

/**
 * The email signature, with the logo.
 *
 * Written as a table with inline styles, because email clients are not
 * browsers: there is no external stylesheet, no flexbox, no grid, and a class
 * attribute is frequently discarded. Anything structural has to be a table
 * cell and anything visual has to be an inline style.
 *
 * The logo is a PNG rather than the SVG used everywhere else in this codebase.
 * Several major clients — Outlook among them — will not render SVG at all, and
 * a signature is the one place a broken image is most visible.
 */

const SIGNATURE_PNG = join(process.cwd(), 'brand', 'assets', 'png', 'bba-signature-light.png');

/** The lockup is 972×366. Displayed at 190px wide it stays sharp on retina. */
const LOGO_WIDTH = 190;
const LOGO_HEIGHT = 72;

export async function logoDataUri(file = SIGNATURE_PNG): Promise<string> {
  const bytes = await readFile(file);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface SignatureOptions {
  from: SenderConfig;
  compliance: ComplianceConfig;
  /** Base64 data URI. See the note in `buildSignaturePage` about Gmail. */
  logo: string;
}

/**
 * The signature block itself — this is what gets pasted into Gmail.
 */
export function signatureHtml({ from, compliance, logo }: SignatureOptions): string {
  const [, identity, stop] = complianceFooter(from, compliance);
  const name = from.name ? `${escapeHtml(from.name)}<br>` : '';

  return `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND_INK}">
  <tr>
    <td style="padding:0 0 10px 0">
      <img src="${logo}" width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}" alt="BBA Network" style="display:block;border:0;outline:none;text-decoration:none">
    </td>
  </tr>
  <tr>
    <td style="padding:0 0 8px 0;font-size:14px;line-height:1.5;color:${BRAND_INK}">
      ${name}<a href="mailto:${escapeHtml(from.email)}" style="color:${BRAND_ACCENT};text-decoration:none">${escapeHtml(from.email)}</a>
    </td>
  </tr>
  <tr>
    <td style="padding:8px 0 0 0;border-top:1px solid #E2E5EA;font-size:11.5px;line-height:1.6;color:#5A6472">
      ${escapeHtml(identity ?? '')}<br>
      ${escapeHtml(stop ?? '')}
    </td>
  </tr>
</table>`;
}

/**
 * A browser page wrapping the signature, with the instructions for installing
 * it.
 *
 * The copy-and-paste route exists because of a specific Gmail behaviour: Gmail
 * strips `data:` URI images out of *received* mail, so a signature that ships
 * one would show every recipient a broken image. Pasting the *rendered*
 * signature from a browser sidesteps that entirely — Gmail uploads the image
 * to its own servers and rewrites the `src` to a URL it will serve. The data
 * URI is a delivery mechanism for the clipboard, never the thing that ends up
 * in the sent email.
 */
export function buildSignaturePage(signature: string): string {
  return `<!doctype html>
<html lang="en-US">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Email signature</title>
<style>
  :root { --ink:#12161F; --soft:#5A6472; --rule:#E2E5EA; --accent:#2B5CE6; --bg:#FAFAF8; --card:#fff; }
  @media (prefers-color-scheme:dark){
    :root:not([data-theme="light"]){ --ink:#E8EBF0; --soft:#98A2B3; --rule:#252C38; --accent:#6A8DF0; --bg:#0B0F16; --card:#141922; }
  }
  :root[data-theme="dark"]{ --ink:#E8EBF0; --soft:#98A2B3; --rule:#252C38; --accent:#6A8DF0; --bg:#0B0F16; --card:#141922; }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
       font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  .wrap{max-width:660px;margin:0 auto;padding:34px 22px 70px}
  h1{font-size:22px;letter-spacing:-.02em;margin:0 0 6px}
  .lede{color:var(--soft);margin:0 0 26px}
  h2{font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:var(--soft);margin:30px 0 12px}
  ol{padding-left:20px;margin:0}
  li{margin-bottom:9px}
  li b{font-weight:600}
  /* Always white: this previews how the signature looks on an email ground,
     which is white in almost every client regardless of the reader's theme. */
  .preview{background:#fff;border:1px solid var(--rule);border-radius:10px;padding:24px}
  .note{background:var(--card);border-left:3px solid var(--accent);border-radius:0 8px 8px 0;
        padding:14px 18px;margin-top:26px;font-size:14px;color:var(--soft)}
  .note b{color:var(--ink)}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;
       background:var(--rule);padding:1.5px 5px;border-radius:4px;color:var(--ink)}
</style>
</head>
<body>
<div class="wrap">
  <h1>Email signature</h1>
  <p class="lede">Select the block below, copy it, and paste it into Gmail's signature box.</p>

  <div class="preview">
${signature}
  </div>

  <h2>Installing it</h2>
  <ol>
    <li>Select everything inside the white box above — <b>click just before the logo and drag to the end of the last line</b>.</li>
    <li>Copy.</li>
    <li>In Gmail: <b>Settings → See all settings → General → Signature → Create new</b>.</li>
    <li>Paste. The logo should appear. Gmail uploads it to its own servers at this point, which is what makes it show up for the people receiving your email.</li>
    <li>Under <b>Signature defaults</b>, set it for new emails and for replies.</li>
    <li>Save changes at the bottom of the page.</li>
  </ol>

  <div class="note">
    <p><b>Then set <code>AUDIT_SIGNATURE_IN_CLIENT=true</code> in <code>.env.local</code>.</b>
    Gmail appends this signature to everything you send, so without that setting
    each email carries the address and opt-out twice — once from the draft and
    once from Gmail.</p>
  </div>

  <div class="note">
    <p><b>Check it before trusting it.</b> Send one email to yourself and open it
    on a phone. If the logo shows as a broken image, the paste did not carry it
    across — use Gmail's own <b>Insert image</b> button to add the PNG from
    <code>brand/assets/png/</code>, then retype the text lines beneath it.</p>
  </div>
</div>
</body>
</html>`;
}
