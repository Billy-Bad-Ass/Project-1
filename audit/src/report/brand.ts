/**
 * BBA Network brand constants and marks.
 *
 * The marks are inlined as SVG strings rather than referenced as files because
 * every artefact this produces has to survive being detached from the machine
 * that made it: a report arrives as an email attachment, gets forwarded, gets
 * opened from a USB stick with no network. A `<img src>` would show a broken
 * icon in exactly the moment the document is meant to look credible.
 *
 * Geometry comes from brand/assets/svg — the lens of stacked bars with the
 * accent line breaking out to the right and terminating in a square. Kept in
 * sync by hand; the source files are committed alongside for anyone who needs
 * a raster or a different lockup.
 */

/** Near-black used for the ink of the mark and for dark surfaces. */
export const BRAND_INK = '#12161F';

/** Darker still — the app icon and favicon background. */
export const BRAND_INK_DEEP = '#0B0F16';

/** The one accent. Used for the breakout line, links and emphasis. */
export const BRAND_ACCENT = '#2B5CE6';

/** Bar colour when the mark sits on a dark surface. */
export const BRAND_INK_ON_DARK = '#C7CCD6';

/** Off-white used inside the app icon, warmer than pure white. */
export const BRAND_PAPER = '#FAFAF8';

const BARS: ReadonlyArray<readonly [number, number, number]> = [
  [33.2, 54.8, 20],
  [22.6, 65.4, 27],
  [17.5, 70.5, 34],
  [14.8, 73.2, 41],
  [14.8, 73.2, 55],
  [17.5, 70.5, 62],
  [22.6, 65.4, 69],
  [33.2, 54.8, 76],
];

/**
 * The mark on its own, sized to `height` and coloured for the surface it sits
 * on. `surface: 'dark'` lightens the bars; the accent line is the same on both
 * because it is the one element that must not shift.
 *
 * The bars are drawn in `currentColor`, and the surface choice is applied as
 * `color: var(--bba-mark, <that surface's ink>)`. The fallback keeps the mark
 * correct with no stylesheet at all — it has to be, since these documents get
 * forwarded and reopened anywhere — while an ancestor setting `--bba-mark`
 * overrides it.
 *
 * A plain inline `color` would not have been overridable: inline styles beat
 * stylesheet rules, so a dark-mode dashboard or a print rule that flips the
 * cover to white could not have darkened the bars back. Both of those are real
 * cases here, and both would have shipped a near-invisible logo.
 */
export function brandMark(height: number, surface: 'light' | 'dark' = 'light'): string {
  const ink = surface === 'dark' ? BRAND_INK_ON_DARK : BRAND_INK;
  const width = Math.round((height * 114) / 64);
  const bars = BARS.map(
    ([x1, x2, y]) => `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/>`,
  ).join('');
  return (
    `<svg width="${width}" height="${height}" viewBox="12 16 114 64" fill="none" ` +
    `style="color:var(--bba-mark,${ink})" xmlns="http://www.w3.org/2000/svg" ` +
    `role="img" aria-label="BBA Network">` +
    `<g stroke="currentColor" stroke-width="3.4">${bars}</g>` +
    `<line x1="14" y1="48" x2="112" y2="48" stroke="${BRAND_ACCENT}" stroke-width="3.4"/>` +
    `<rect x="116" y="44" width="8" height="8" fill="${BRAND_ACCENT}"/>` +
    `</svg>`
  );
}

/**
 * The favicon as a `data:` URI, ready for `<link rel="icon" href="...">`.
 *
 * A simplified mark: four bars and the accent line, no breakout square. At
 * 16px the full lockup collapses into grey mush, and the square would land on
 * a single pixel. The heavier strokes and the deep background are what make it
 * legible in a tab strip.
 *
 * Left un-encoded except for the characters that would terminate the attribute
 * or break URL parsing — `#` in particular ends the URL and would silently
 * strip every colour.
 */
export function brandFaviconDataUri(): string {
  const bars = [
    [30, 66, 24],
    [21, 75, 36],
    [21, 75, 60],
    [30, 66, 72],
  ]
    .map(([x1, x2, y]) => `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/>`)
    .join('');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none">` +
    `<rect width="96" height="96" fill="${BRAND_INK_DEEP}"/>` +
    `<g stroke="${BRAND_PAPER}" stroke-width="8">${bars}</g>` +
    `<line x1="18" y1="48" x2="78" y2="48" stroke="${BRAND_ACCENT}" stroke-width="8"/>` +
    `</svg>`;
  const encoded = svg
    .replace(/#/g, '%23')
    .replace(/"/g, "'")
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E');
  return `data:image/svg+xml,${encoded}`;
}

/**
 * Mark plus wordmark, laid out horizontally — the signature lockup.
 *
 * The wordmark is live text rather than outlines so it stays selectable and
 * scales cleanly, and because a system font stack cannot fail to load.
 */
export function brandSignature(surface: 'light' | 'dark' = 'light'): string {
  const modifier = surface === 'dark' ? ' bba-sig--dark' : '';
  return (
    `<span class="bba-sig${modifier}">${brandMark(30, surface)}` +
    `<span class="bba-word">` +
    `<span class="bba-name">BBA</span>` +
    `<span class="bba-sub">NETWORK</span>` +
    `</span></span>`
  );
}

/**
 * Styles the signature lockup needs. Inline these next to it.
 *
 * Colours resolve through `--bba-*` custom properties so a host page can theme
 * the whole lockup — mark included — by setting three variables.
 */
export const BRAND_SIGNATURE_CSS = `
.bba-sig { display: inline-flex; align-items: center; gap: 12px; }
.bba-sig svg { display: block; }
.bba-word { display: flex; flex-direction: column; line-height: 1; }
.bba-name { font-weight: 800; font-size: 19px; letter-spacing: -.01em;
            color: var(--bba-name, ${BRAND_INK}); }
.bba-sub { font-size: 9.5px; letter-spacing: .34em; margin-top: 3px;
           color: var(--bba-sub, #5A6472); }
.bba-sig--dark { --bba-mark: ${BRAND_INK_ON_DARK}; --bba-name: #FFFFFF;
                 --bba-sub: ${BRAND_INK_ON_DARK}; }
`;
