import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { renderReport } from '../report/render';
import { EXAMPLE_AUDIT } from '../report/example';

const run = promisify(execFile);

/**
 * Renders the report to a PNG for the sales page.
 *
 *   npm run shots
 *
 * The strongest thing this page can show is the thing being sold, so the
 * screenshot is taken from the real template with the real stylesheet rather
 * than drawn as a mockup. A mockup drifts from the product the first time the
 * report changes, and then the page is quietly advertising something that no
 * longer arrives.
 *
 * Shot with headless Chromium directly. Playwright would pull a heavy
 * dependency into a package that deliberately runs on eighteen, and all that
 * is needed here is one screenshot of one local file.
 */

const CHROME =
  process.env.CHROME_BIN ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const OUT = join(process.cwd(), 'web', 'assets');
const log = (message: string) => process.stdout.write(`${message}\n`);

interface Shot {
  name: string;
  width: number;
  height: number;
}

const SHOTS: Shot[] = [
  // The cover and the first findings — what a buyer is actually paying for.
  { name: 'report-preview', width: 900, height: 1180 },
  // A phone-width crop, because most of these emails are opened on a phone.
  { name: 'report-mobile', width: 420, height: 760 },
];

async function main(): Promise<void> {
  const html = renderReport(EXAMPLE_AUDIT);
  const dir = await mkdtemp(join(tmpdir(), 'shots-'));
  const page = join(dir, 'report.html');
  await writeFile(page, html, 'utf8');

  await mkdir(OUT, { recursive: true });

  for (const shot of SHOTS) {
    const file = join(OUT, `${shot.name}.png`);
    await run(CHROME, [
      '--headless',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--force-device-scale-factor=2',
      `--window-size=${shot.width},${shot.height}`,
      `--screenshot=${file}`,
      `file://${page}`,
    ]);
    log(`  ${shot.name}.png  ${shot.width}x${shot.height}`);
  }

  log('');
  log(`Wrote ${SHOTS.length} screenshot(s) to web/assets/`);
  log('These ship with the site. Re-run whenever the report template changes.');
}

main().catch((error: unknown) => {
  process.stderr.write(`build-shots failed: ${String(error)}\n`);
  process.stderr.write(
    'Set CHROME_BIN if Chromium lives somewhere else on this machine.\n',
  );
  process.exitCode = 1;
});
