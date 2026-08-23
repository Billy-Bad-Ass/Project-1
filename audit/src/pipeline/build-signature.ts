import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { complianceConfig, MissingComplianceConfig } from '../outreach/compliance';
import { buildSignaturePage, logoDataUri, signatureHtml } from '../outreach/signature';
import { sender } from '../report/config';

/**
 * Builds the email signature you paste into Gmail.
 *
 *   npm run signature      writes out/signature.html
 *
 * The signature carries the postal address and opt-out, so it needs the same
 * settings the drafter does — and refuses for the same reason.
 */

const OUT = join(process.cwd(), 'out');
const log = (message: string) => process.stdout.write(`${message}\n`);

async function main(): Promise<void> {
  let compliance;
  try {
    compliance = complianceConfig();
  } catch (error) {
    if (error instanceof MissingComplianceConfig) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const logo = await logoDataUri();
  const signature = signatureHtml({ from: sender, compliance, logo });

  await mkdir(OUT, { recursive: true });
  const file = join(OUT, 'signature.html');
  await writeFile(file, buildSignaturePage(signature), 'utf8');

  log(`Wrote ${file}`);
  log('');
  log('Open it in a browser, copy the block, paste it into Gmail:');
  log('  Settings → See all settings → General → Signature → Create new');
  log('');
  log('Then set AUDIT_SIGNATURE_IN_CLIENT=true in .env.local, or every email');
  log('will carry the address and opt-out twice.');
}

main().catch((error: unknown) => {
  process.stderr.write(`build-signature failed: ${String(error)}\n`);
  process.exitCode = 1;
});
