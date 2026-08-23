import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  BRAND_ACCENT,
  BRAND_INK,
  BRAND_INK_ON_DARK,
  BRAND_SIGNATURE_CSS,
  brandMark,
  brandSignature,
} from './brand';

test('the mark keeps the accent identical on light and dark surfaces', () => {
  // The bars change with the surface; the breakout line and its terminating
  // square are the recognisable part and must not shift.
  for (const svg of [brandMark(30, 'light'), brandMark(30, 'dark')]) {
    assert.equal(
      svg.match(new RegExp(BRAND_ACCENT, 'gi'))?.length,
      2,
      'expected the accent on both the breakout line and the square',
    );
  }
});

test('the dark variant lightens the bars', () => {
  assert.match(brandMark(30, 'dark'), new RegExp(BRAND_INK_ON_DARK, 'i'));
  assert.match(brandMark(30, 'light'), new RegExp(BRAND_INK, 'i'));
});

test('the mark renders correctly with no stylesheet at all', () => {
  // Reports get forwarded and reopened from disk. If the colour only ever
  // arrived via CSS, a detached document would draw an invisible logo.
  assert.match(brandMark(30, 'light'), /color:var\(--bba-mark,#12161F\)/i);
});

test('a host page can override the mark colour', () => {
  // Regression guard: a bare inline `color:` would win over every stylesheet
  // rule, so print styles and dark mode could not darken or lighten the bars.
  // Both are live cases, and both would ship a near-invisible logo.
  const svg = brandMark(30, 'light');
  assert.match(svg, /var\(--bba-mark,/, 'mark colour must go through a variable');
  assert.doesNotMatch(
    svg,
    /style="color:#/,
    'an unconditional inline colour cannot be themed',
  );
});

test('the signature carries no inline colours', () => {
  // Same reason as above, for the wordmark half of the lockup.
  for (const surface of ['light', 'dark'] as const) {
    assert.doesNotMatch(brandSignature(surface), /style="color:#/);
  }
});

test('the signature themes itself through the dark modifier', () => {
  assert.match(brandSignature('dark'), /bba-sig--dark/);
  assert.doesNotMatch(brandSignature('light'), /bba-sig--dark/);
  assert.match(BRAND_SIGNATURE_CSS, /\.bba-sig--dark\s*\{[^}]*--bba-mark:/);
});

test('every colour the CSS depends on has a fallback', () => {
  // A var() with no fallback resolves to nothing and the text renders black on
  // black, which is worse than an unbranded page.
  const vars = BRAND_SIGNATURE_CSS.match(/var\(--bba-[a-z]+[^)]*\)/g) ?? [];
  assert.ok(vars.length > 0, 'expected the stylesheet to use the brand variables');
  for (const usage of vars) {
    assert.match(usage, /,/, `${usage} needs a fallback value`);
  }
});

test('the mark keeps the logo aspect ratio at any height', () => {
  for (const height of [16, 26, 30, 64]) {
    const svg = brandMark(height);
    const width = Number(svg.match(/width="(\d+)"/)?.[1]);
    assert.equal(width, Math.round((height * 114) / 64));
  }
});

test('the wordmark reads BBA NETWORK', () => {
  const sig = brandSignature();
  assert.match(sig, />BBA</);
  assert.match(sig, />NETWORK</);
});

test('the mark is labelled for screen readers', () => {
  assert.match(brandMark(30), /role="img"/);
  assert.match(brandMark(30), /aria-label="BBA Network"/);
});
