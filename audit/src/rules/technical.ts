import type { Finding, Rule } from '../lib/types';

/** Technical: things that are simply broken or missing. */

export const mobileViewport: Rule = {
  id: 'mobile-viewport',
  description: 'Page declares a mobile viewport',
  category: 'technical',
  check(page) {
    const viewport = page.doc.querySelector('meta[name="viewport" i]');
    const content = viewport?.getAttribute('content') ?? '';

    if (!viewport) {
      return [
        {
          ruleId: 'mobile-viewport',
          severity: 'critical',
          category: 'technical',
          title: 'The site is not built for phones',
          detail: 'The page has no viewport meta tag.',
          impact:
            'On a phone the browser renders the desktop layout shrunk down, so text is unreadable until the visitor pinches and zooms. Most people leave instead. Since the majority of local searches happen on a phone, this is usually the single most expensive problem on a site.',
          fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> and check the layout reflows properly at phone width.',
        },
      ];
    }

    if (/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\.0)?\b/i.test(content)) {
      return [
        {
          ruleId: 'mobile-viewport',
          severity: 'medium',
          category: 'technical',
          title: 'Visitors are prevented from zooming in',
          detail: `The viewport tag disables zoom: "${content}".`,
          impact:
            'Anyone who needs to enlarge small text — which is a large share of over-50s customers — simply cannot. It is a common accessibility complaint and there is rarely a good reason for it.',
          fix: 'Remove user-scalable=no and maximum-scale from the viewport tag.',
          evidence: content,
        },
      ];
    }

    return [];
  },
};

export const httpStatus: Rule = {
  id: 'http-status',
  description: 'Page returns a successful status code',
  category: 'technical',
  check(page) {
    if (page.status >= 500) {
      return [
        {
          ruleId: 'http-status',
          severity: 'critical',
          category: 'technical',
          title: 'The page returns a server error',
          detail: `The server responded with HTTP ${page.status}.`,
          impact: 'Visitors and search engines both see an error instead of the page.',
          fix: 'Check server and application logs for the cause; this needs fixing before anything else on this report matters.',
        },
      ];
    }
    if (page.status >= 400) {
      return [
        {
          ruleId: 'http-status',
          severity: 'critical',
          category: 'technical',
          title: 'The page is missing or refused',
          detail: `The server responded with HTTP ${page.status}.`,
          impact: 'Anyone following this link reaches an error page.',
          fix: 'Restore the page, or redirect the address to the page that replaced it.',
        },
      ];
    }
    return [];
  },
};

export const faviconPresent: Rule = {
  id: 'favicon',
  description: 'Site has a favicon',
  category: 'technical',
  check(page) {
    const icon = page.doc.querySelector(
      'link[rel="icon" i], link[rel="shortcut icon" i], link[rel="apple-touch-icon" i]',
    );
    if (!icon) {
      return [
        {
          ruleId: 'favicon',
          severity: 'low',
          category: 'technical',
          title: 'No icon shows in the browser tab',
          detail: 'The page declares no favicon.',
          impact:
            'Your tab and bookmark show a blank page icon while competitors show their logo. Small, but it is a visible signal of an unmaintained site.',
          fix: 'Add a favicon and reference it with <link rel="icon">.',
        },
      ];
    }
    return [];
  },
};

export const sitemapDeclared: Rule = {
  id: 'sitemap',
  description: 'robots.txt points at a sitemap',
  category: 'technical',
  check(page) {
    if (!page.robotsTxt) {
      return [
        {
          ruleId: 'sitemap',
          severity: 'low',
          category: 'technical',
          title: 'No robots.txt file',
          detail: 'The site has no robots.txt at its root.',
          impact:
            'Not damaging on its own, but it is where you tell search engines where your sitemap is, which helps them find every page rather than only the ones they stumble across.',
          fix: 'Add a robots.txt containing at minimum a Sitemap: line pointing at your sitemap.xml.',
        },
      ];
    }

    if (!/^\s*sitemap:/im.test(page.robotsTxt)) {
      return [
        {
          ruleId: 'sitemap',
          severity: 'low',
          category: 'technical',
          title: 'robots.txt does not mention a sitemap',
          detail: 'A robots.txt exists but contains no Sitemap: line.',
          impact:
            'Search engines have to discover your pages by following links. A sitemap lists them explicitly, which matters most for pages that are not linked prominently.',
          fix: 'Add "Sitemap: https://yourdomain.com/sitemap.xml" to robots.txt.',
        },
      ];
    }

    return [];
  },
};

export const technicalRules: Rule[] = [
  mobileViewport,
  httpStatus,
  faviconPresent,
  sitemapDeclared,
];
