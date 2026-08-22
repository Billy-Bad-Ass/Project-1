import type { Finding, Rule } from '../lib/types';

/**
 * Speed: whether the page arrives before the visitor gives up.
 *
 * Measured from the HTML document alone, so these are signals rather than a
 * full performance profile. Each one is stated as what it is — an indicator
 * worth investigating — rather than dressed up as a Core Web Vitals score we
 * did not actually measure.
 */

export const documentWeight: Rule = {
  id: 'document-weight',
  description: 'The HTML document itself is not unreasonably large',
  category: 'speed',
  check(page) {
    const kb = Math.round(page.bytes / 1024);
    if (kb > 400) {
      return [
        {
          ruleId: 'document-weight',
          severity: 'medium',
          category: 'speed',
          title: 'The page code is unusually heavy',
          detail: `The HTML alone is ${kb} KB before any images, scripts or fonts load.`,
          impact:
            'On a phone on mobile data this delays the moment anything appears. Visitors routinely abandon a page that shows nothing for a few seconds.',
          fix: 'Look for large inline styles or scripts embedded in the page and move them to cached external files; remove unused page-builder markup.',
          evidence: `${kb} KB`,
        },
      ];
    }
    return [];
  },
};

export const responseTime: Rule = {
  id: 'response-time',
  description: 'The server responds promptly',
  category: 'speed',
  check(page) {
    if (page.loadMs > 2500) {
      return [
        {
          ruleId: 'response-time',
          severity: 'high',
          category: 'speed',
          title: 'The server is slow to respond',
          detail: `The page took ${(page.loadMs / 1000).toFixed(1)} seconds to return its HTML.`,
          impact:
            'This is the delay before the browser can even begin drawing. It is felt on every single page view, and it is usually a hosting or database problem rather than a design one.',
          fix: 'Check hosting plan and server response time, enable page caching, and confirm the site is not doing heavy database work on every request.',
          evidence: `${page.loadMs} ms`,
        },
      ];
    }
    if (page.loadMs > 1200) {
      return [
        {
          ruleId: 'response-time',
          severity: 'low',
          category: 'speed',
          title: 'Server response time could be better',
          detail: `The page took ${(page.loadMs / 1000).toFixed(1)} seconds to return its HTML.`,
          impact: 'Not alarming, but it is a fixed cost paid on every page view by every visitor.',
          fix: 'Enable full-page caching, and use a CDN if visitors are geographically spread.',
          evidence: `${page.loadMs} ms`,
        },
      ];
    }
    return [];
  },
};

export const imageSizing: Rule = {
  id: 'image-sizing',
  description: 'Images declare dimensions and defer offscreen loading',
  category: 'speed',
  check(page) {
    const findings: Finding[] = [];
    const images = page.doc.querySelectorAll('img');
    if (images.length === 0) return findings;

    const missingDims = images.filter(
      (img) => !img.getAttribute('width') || !img.getAttribute('height'),
    );

    if (missingDims.length > 0 && missingDims.length >= images.length / 2) {
      findings.push({
        ruleId: 'image-sizing',
        severity: 'medium',
        category: 'speed',
        title: 'The page jumps around while it loads',
        detail: `${missingDims.length} of ${images.length} images do not declare their width and height.`,
        impact:
          'The browser cannot reserve space, so content shifts as each image arrives. This is the effect where someone goes to tap a button and it moves — it is measured by Google and it frustrates visitors.',
        fix: 'Add width and height attributes to every <img>. The values only need the correct ratio, not the display size.',
      });
    }

    const notLazy = images.filter((img) => img.getAttribute('loading') !== 'lazy');
    if (images.length > 10 && notLazy.length > images.length * 0.8) {
      findings.push({
        ruleId: 'image-sizing',
        severity: 'low',
        category: 'speed',
        title: 'All images download immediately, even ones far down the page',
        detail: `${images.length} images on the page and ${notLazy.length} load eagerly.`,
        impact:
          'Bandwidth is spent on images the visitor may never scroll to, delaying the ones they can actually see.',
        fix: 'Add loading="lazy" to images below the fold, leaving the top-most image eager.',
      });
    }

    return findings;
  },
};

export const scriptCount: Rule = {
  id: 'script-count',
  description: 'The page does not load an excessive number of scripts',
  category: 'speed',
  check(page) {
    const scripts = page.doc.querySelectorAll('script[src]');
    const blocking = scripts.filter(
      (s) => !s.hasAttribute('async') && !s.hasAttribute('defer'),
    );

    if (blocking.length >= 8) {
      return [
        {
          ruleId: 'script-count',
          severity: 'medium',
          category: 'speed',
          title: 'Many scripts block the page from displaying',
          detail: `${blocking.length} of ${scripts.length} external scripts load without async or defer.`,
          impact:
            'Each one pauses the page while it downloads and runs, so the visitor stares at a blank or half-drawn screen for longer. Tracking and chat widgets are the usual culprits.',
          fix: 'Add defer to scripts that are not needed immediately, and audit whether every third-party widget still earns its place.',
          evidence: `${blocking.length} render-blocking scripts`,
        },
      ];
    }
    return [];
  },
};

export const speedRules: Rule[] = [documentWeight, responseTime, imageSizing, scriptCount];
