import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { renderReport } from '../report/render';
import { EXAMPLE_AUDIT } from '../report/example';
import { CARD_H, socialCardHtml } from '../report/social-card';
import { cropTopLeft, regionHasContent } from '../lib/png';
import { ruleCount } from '../report/proof';

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

/**
 * What the card prints in its corner. The bare host, not the full origin —
 * "https://" in a graphic is noise, and the point is to look like an address
 * somebody could type.
 *
 * Null before a domain exists, and the corner is then left empty rather than
 * filled with a placeholder. This image is the first thing a stranger sees of
 * the business; a fake address on it is worse than no address.
 */
function domainLabel(): string | null {
  const origin = process.env.SITE_ORIGIN?.trim();
  if (!origin) return null;
  try {
    return new URL(origin).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

const CARD_W = 1200;

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

/**
 * @param scale device pixel ratio. The report shots use 2 so they stay sharp
 *   when the page displays them at half size. The social card must not: a
 *   scale factor divides the CSS viewport, so at 2 a fixed 1200x630 card is
 *   laid out inside a 600x315 window and overflows it — which silently pushed
 *   the footer line out of the captured frame. 1200x630 is also exactly the
 *   size every platform crops a link preview to, so 1:1 is what it wants.
 */
async function shoot(
  page: string,
  file: string,
  width: number,
  height: number,
  scale = 2,
): Promise<void> {
  await run(CHROME, [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--force-device-scale-factor=${scale}`,
    `--window-size=${width},${height}`,
    `--screenshot=${file}`,
    `file://${page}`,
  ]);
}

async function main(): Promise<void> {
  const html = renderReport(EXAMPLE_AUDIT);
  const dir = await mkdtemp(join(tmpdir(), 'shots-'));
  const page = join(dir, 'report.html');
  await writeFile(page, html, 'utf8');

  await mkdir(OUT, { recursive: true });

  for (const shot of SHOTS) {
    const file = join(OUT, `${shot.name}.png`);
    await shoot(page, file, shot.width, shot.height);
    log(`  ${shot.name}.png  ${shot.width}x${shot.height}`);
  }

  // The link-preview card. Its text carries the price and the check count, so
  // it is generated here from the same sources the page uses rather than typed
  // into an image — an exported PNG is the copy that stops matching first.
  const cardPage = join(dir, 'card.html');
  await writeFile(
    cardPage,
    socialCardHtml(process.env.PRICE_DISPLAY ?? '$100', domainLabel(), ruleCount()),
    'utf8',
  );

  // Captured with headroom and cropped, rather than captured at its own size.
  // Chromium writes an image the full height of --window-size but paints only
  // the layout viewport, which is shorter — ask for exactly 1200x630 and the
  // bottom of the card comes back as blank background, with no error anywhere.
  const cardFile = join(OUT, 'social-card.png');
  const raw = join(dir, 'card-raw.png');
  await shoot(cardPage, raw, CARD_W, CARD_H + 220, 1);
  const cropped = cropTopLeft(await readFile(raw), CARD_W, CARD_H);
  await writeFile(cardFile, cropped);

  // The failure this guards against does not throw: the image is the right
  // size, the headline is there, and the price and domain are simply missing.
  const footBand = { x: 60, y: CARD_H - 110, width: CARD_W - 120, height: 90 };
  if (!regionHasContent(cropped, footBand)) {
    throw new Error(
      'The social card rendered with an empty footer band — the price and domain\n' +
        'line did not paint. Check the capture height in shoot() against CARD_H.',
    );
  }
  log(`  social-card.png  ${CARD_W}x${CARD_H}`);

  log('');
  log(`Wrote ${SHOTS.length + 1} image(s) to web/assets/`);
  log('These ship with the site. Re-run whenever the report template changes.');
}

main().catch((error: unknown) => {
  process.stderr.write(`build-shots failed: ${String(error)}\n`);
  process.stderr.write(
    'Set CHROME_BIN if Chromium lives somewhere else on this machine.\n',
  );
  process.exitCode = 1;
});
