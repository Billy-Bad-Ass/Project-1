import { BRAND_ACCENT, BRAND_INK_DEEP, BRAND_INK_ON_DARK, brandSignature } from './brand';

/**
 * The picture that appears when somebody pastes the link somewhere.
 *
 * Worth having because of how this business actually spreads: a cold email
 * lands, the recipient forwards it to a partner or drops it in a group chat,
 * and what shows up there is either a card that looks like a business or a
 * bare grey URL. The second one reads like something to be careful of, which
 * is the opposite of what a stranger asking for $100 needs.
 *
 * Rendered from the brand module rather than drawn as an image, so it cannot
 * drift from the logo the way an exported PNG in a folder does.
 *
 * 1200x630 is the size every platform crops from.
 */
/**
 * The height that is actually painted.
 *
 * Exported so the build crops to exactly this and can check the footer landed
 * inside it, rather than shipping a card with the price silently missing.
 */
export const CARD_H = 630;

export function socialCardHtml(price: string, domain: string | null, ruleCount: number): string {
  return `<!doctype html>
<html lang="en-US">
<head>
<meta charset="utf-8">
<style>
  *{box-sizing:border-box;margin:0}
  /* Everything inside the card is absolutely positioned.
   *
   * Nothing here uses flexbox, and that is not a style preference.
   *
   * The flex version laid out perfectly in a tall window and silently dropped
   * the footer line whenever the window matched the card's height — the last
   * flex item absorbed a shortfall that came from the browser, not the design.
   * Fixed offsets from a fixed box cannot be renegotiated by anything.
   *
   * The other half of that fix lives in build-shots: headless Chromium paints
   * only the layout viewport, which is shorter than --window-size, so the card
   * is captured in a window with headroom and cropped back down. */
  body{background:${BRAND_INK_DEEP}}
  .card{
    position:relative;overflow:hidden;
    width:1200px;height:${CARD_H}px;
    background:${BRAND_INK_DEEP};
    color:#fff;
    font:16px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  }
  /* One accent shape, off the right edge. Enough to stop the card reading as
     a plain slab of text at thumbnail size, without competing with the words. */
  .glow{
    position:absolute;right:-180px;top:-180px;width:620px;height:620px;border-radius:50%;
    background:radial-gradient(circle,${BRAND_ACCENT}33 0%,transparent 70%);
  }
  .top{position:absolute;top:56px;left:72px;z-index:1}
  .bba-sig{--bba-mark:${BRAND_INK_ON_DARK};--bba-name:#fff;--bba-sub:#98A2B3;
           display:inline-flex;align-items:center;gap:11px;
           font:600 21px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
           letter-spacing:.14em}
  .bba-name{color:var(--bba-name)}
  .bba-sub{color:var(--bba-sub);font-weight:400}
  h1{
    position:absolute;left:72px;top:238px;z-index:1;
    font-size:62px;line-height:1.08;letter-spacing:-.03em;font-weight:700;
    max-width:19ch;
  }
  h1 em{font-style:normal;color:${BRAND_ACCENT}}
  .foot{position:absolute;left:72px;right:72px;bottom:52px;z-index:1;
        font-size:23px;color:#98A2B3}
  .price{color:#fff;font-weight:700}
  .price span{color:#98A2B3;font-weight:400;font-size:21px}
  .domain{position:absolute;right:0;bottom:0}
</style>
</head>
<body>
<div class="card">
  <div class="glow"></div>
  <div class="top">${brandSignature()}</div>
  <h1>Find what's quietly <em>costing you customers</em>.</h1>
  <div class="foot">
    <span class="price">${escapeText(price)} <span>· ${ruleCount} checks · one working day</span></span>
    ${domain ? `<span class="domain">${escapeText(domain)}</span>` : ''}
  </div>
</div>
</body>
</html>`;
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
