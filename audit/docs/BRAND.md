# BBA Network — brand

Everything the business produces uses one mark, one accent and one ink. This
file says where they live and what the rules are, so a future change happens in
one place instead of five.

## The files

`brand/assets/` holds the supplied kit — the source of truth for anything a
designer or a printer needs.

| Path | Use |
|---|---|
| `svg/bba-mark-color-for-light.svg` | The mark on a white or light surface |
| `svg/bba-mark-color-for-dark.svg` | The mark on a dark surface |
| `svg/bba-mark-black.svg`, `bba-mark-white.svg` | Single-colour, for print or stamping |
| `svg/bba-favicon.svg`, `bba-app-icon.svg` | Small sizes, reduced detail |
| `png/bba-signature-*.png` | Horizontal lockup, mark beside wordmark |
| `png/bba-logo-stacked-*.png` | Stacked lockup, mark above wordmark |
| `png/bba-avatar-round.png` | Social profile pictures |

## The colours

| Token | Hex | Where |
|---|---|---|
| Accent | `#2B5CE6` | The breakout line, links, buttons, emphasis |
| Ink | `#12161F` | Text, the mark on light surfaces, the report cover |
| Deep ink | `#0B0F16` | Favicon and app-icon backgrounds, dark-mode pages |
| Ink on dark | `#C7CCD6` | The mark's bars when it sits on a dark surface |
| Paper | `#FAFAF8` | The off-white inside the app icon |

There is exactly one accent. Green and red still appear — money earned, urgent
findings — but those are *semantic*, not brand: they mean a specific thing and
have to stay distinguishable from the accent. Do not repaint them blue for
consistency; consistency is not worth a dashboard where "earned" and "link"
look the same.

## Using it in code

Do not paste the SVG into a template. Import from `src/report/brand.ts`:

```ts
import { brandMark, brandSignature, BRAND_SIGNATURE_CSS } from './report/brand';

brandMark(26, 'dark')   // mark alone, 26px tall, bars lightened
brandSignature()        // mark + "BBA / NETWORK" wordmark
brandFaviconDataUri()   // for <link rel="icon">
```

The site templates in `web/` receive these as build-time tokens
(`BRAND_SIGNATURE`, `BRAND_CSS`, `BRAND_FAVICON`) which `build-web.ts`
substitutes. The build fails if a token survives into the output.

### Why the mark is inlined rather than linked

Reports get emailed as attachments, forwarded, saved to a desktop and opened
with no network. An `<img src>` would show a broken-image icon in exactly the
moment the document is meant to look credible. Everything is self-contained.

### Why the colour goes through a variable

The mark's ink is `var(--bba-mark, <ink for that surface>)`, not a plain inline
colour. The fallback means it renders correctly with no stylesheet at all. The
variable means a host page can override it.

Both halves are load-bearing:

- The **report's print styles** flip the cover from near-black to white. Bars
  baked to a light grey would print as almost nothing.
- The **dashboard and site have dark modes**. Bars baked to near-black would
  disappear on a dark page.

An inline `style="color:#..."` beats every stylesheet rule, so it would have
made both impossible. `src/report/brand.test.ts` guards this — it fails if an
unconditional inline colour reappears.

### Why the favicon is a different drawing

Four bars instead of eight, no breakout square, much heavier strokes. At 16px
the full mark's eight bars merge into a grey smudge and the square lands on a
single pixel. Shrinking a logo is not the same as designing a small one.

Its `#` characters are percent-encoded: a raw `#` terminates a URL, so an
unencoded data URI silently loses every colour after the first and renders as
an untinted box.

## Setting your own details

`AUDIT_SENDER_BUSINESS` is what appears on reports and the site footer. The
accent defaults to `#2B5CE6` — `AUDIT_ACCENT` only needs setting to override
it. Both live in `.env.local`, which is gitignored; see `.env.example`.
