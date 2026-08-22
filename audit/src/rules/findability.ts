import type { Finding, Rule } from '../lib/types';

/**
 * Findability: whether search engines can understand and list the page.
 *
 * These are the findings that translate most directly into "you are invisible
 * to customers searching for you", which is the easiest thing for a business
 * owner to act on.
 */

export const titleTag: Rule = {
  id: 'title-tag',
  description: 'Page has a unique, usefully-length title tag',
  category: 'findability',
  check(page) {
    const findings: Finding[] = [];
    const title = page.doc.querySelector('title')?.text.trim() ?? '';

    if (title === '') {
      findings.push({
        ruleId: 'title-tag',
        severity: 'critical',
        category: 'findability',
        title: 'The page has no title',
        detail:
          'There is no <title> tag, so search engines and browser tabs have no name for this page.',
        impact:
          'Google shows the title as the clickable headline in search results. With none, it invents one from the page text, which is usually worse and sometimes wrong.',
        fix: 'Add a title of roughly 50-60 characters that names the business and what it does, e.g. "Riverside Dental — Emergency Dentist in Leeds".',
      });
      return findings;
    }

    if (title.length < 15) {
      findings.push({
        ruleId: 'title-tag',
        severity: 'high',
        category: 'findability',
        title: 'The page title is too short to be useful',
        detail: `The title is only ${title.length} characters: "${title}".`,
        impact:
          'A short title wastes the single most valuable piece of text on the page. Competitors using the full width describe their service and location, and get the click instead.',
        fix: 'Expand to roughly 50-60 characters covering what you do and where.',
        evidence: title,
      });
    } else if (title.length > 65) {
      findings.push({
        ruleId: 'title-tag',
        severity: 'low',
        category: 'findability',
        title: 'The page title will be cut off in search results',
        detail: `The title is ${title.length} characters, and Google truncates around 60.`,
        impact:
          'The end of the title is replaced with an ellipsis, so any wording placed there is not read by anyone.',
        fix: 'Shorten to about 60 characters, putting the most important words first.',
        evidence: title,
      });
    }

    return findings;
  },
};

export const metaDescription: Rule = {
  id: 'meta-description',
  description: 'Page has a meta description of a usable length',
  category: 'findability',
  check(page) {
    const meta = page.doc.querySelector('meta[name="description" i]');
    const content = meta?.getAttribute('content')?.trim() ?? '';

    if (content === '') {
      return [
        {
          ruleId: 'meta-description',
          severity: 'high',
          category: 'findability',
          title: 'No description for search results',
          detail: 'The page has no meta description tag.',
          impact:
            'This is the two-line sales pitch under your link on Google. Without it, Google scrapes an arbitrary sentence from the page — often a cookie notice or a menu — which costs clicks.',
          fix: 'Add a 140-155 character description that says what you offer and why to choose you, ending with a reason to click.',
        },
      ];
    }

    if (content.length < 70) {
      return [
        {
          ruleId: 'meta-description',
          severity: 'low',
          category: 'findability',
          title: 'The search description is very short',
          detail: `The description is ${content.length} characters, well under the ~155 available.`,
          impact: 'You are leaving most of your free advertising space on Google unused.',
          fix: 'Expand to 140-155 characters and include a reason to choose you over the next result.',
          evidence: content,
        },
      ];
    }

    return [];
  },
};

export const headingStructure: Rule = {
  id: 'heading-structure',
  description: 'Page has exactly one H1 that describes the page',
  category: 'findability',
  check(page) {
    const h1s = page.doc.querySelectorAll('h1');

    if (h1s.length === 0) {
      return [
        {
          ruleId: 'heading-structure',
          severity: 'medium',
          category: 'findability',
          title: 'The page has no main heading',
          detail: 'No <h1> element was found.',
          impact:
            'The main heading tells both visitors and search engines what the page is about in one line. Without one, both have to guess from the layout.',
          fix: 'Add a single H1 near the top stating the page’s purpose in plain words.',
        },
      ];
    }

    if (h1s.length > 2) {
      return [
        {
          ruleId: 'heading-structure',
          severity: 'low',
          category: 'findability',
          title: 'The page has several competing main headings',
          detail: `Found ${h1s.length} <h1> elements.`,
          impact:
            'When everything is the main heading, nothing is. It dilutes the signal about what this page is actually for.',
          fix: 'Keep one H1 and demote the rest to H2 or H3, which also improves how screen readers announce the page.',
          evidence: h1s.slice(0, 3).map((h) => h.text.trim().slice(0, 60)).join(' | '),
        },
      ];
    }

    return [];
  },
};

export const canonicalUrl: Rule = {
  id: 'canonical-url',
  description: 'Page declares a canonical URL',
  category: 'findability',
  check(page) {
    const canonical = page.doc.querySelector('link[rel="canonical" i]');
    if (!canonical?.getAttribute('href')) {
      return [
        {
          ruleId: 'canonical-url',
          severity: 'low',
          category: 'findability',
          title: 'No canonical URL is declared',
          detail: 'The page does not state which address is its official one.',
          impact:
            'If the same page is reachable at several addresses (with and without www, with tracking parameters), search engines may treat them as separate pages and split the ranking value between them.',
          fix: 'Add a <link rel="canonical"> pointing at the preferred address of each page.',
        },
      ];
    }
    return [];
  },
};

export const structuredData: Rule = {
  id: 'structured-data',
  description: 'Page includes structured data describing the business',
  category: 'findability',
  check(page) {
    const jsonLd = page.doc.querySelectorAll('script[type="application/ld+json"]');
    const microdata = page.doc.querySelectorAll('[itemscope]');

    if (jsonLd.length === 0 && microdata.length === 0) {
      return [
        {
          ruleId: 'structured-data',
          severity: 'medium',
          category: 'findability',
          title: 'Search engines are not told what kind of business this is',
          detail: 'The page contains no structured data (no JSON-LD or microdata).',
          impact:
            'Structured data is how opening hours, address, phone number, price and star ratings appear directly in search results. Competitors showing those take up more space and get more clicks for the same position.',
          fix: 'Add LocalBusiness or Organization JSON-LD with name, address, phone and opening hours. For products or services, add the matching type.',
        },
      ];
    }

    // Present but broken is worse than absent, because it silently does nothing.
    for (const block of jsonLd) {
      try {
        JSON.parse(block.text);
      } catch {
        return [
          {
            ruleId: 'structured-data',
            severity: 'medium',
            category: 'findability',
            title: 'The structured data on the page is invalid',
            detail: 'A JSON-LD block exists but does not parse, so it is ignored entirely.',
            impact:
              'Someone already paid for this to be added, and it is doing nothing. Broken markup cannot produce rich results.',
            fix: 'Fix the JSON syntax error and re-test in Google’s Rich Results Test.',
            evidence: block.text.trim().slice(0, 160),
          },
        ];
      }
    }

    return [];
  },
};

export const indexability: Rule = {
  id: 'indexability',
  description: 'Page is not accidentally blocked from search engines',
  category: 'findability',
  check(page) {
    const findings: Finding[] = [];
    const robotsMeta = page.doc
      .querySelector('meta[name="robots" i]')
      ?.getAttribute('content')
      ?.toLowerCase();

    if (robotsMeta?.includes('noindex')) {
      findings.push({
        ruleId: 'indexability',
        severity: 'critical',
        category: 'findability',
        title: 'This page tells Google not to list it',
        detail: `The page carries a robots meta tag of "${robotsMeta}".`,
        impact:
          'This single line removes the page from Google entirely. It is very often left behind accidentally after a site is built or redesigned, and it means no amount of marketing will make the page findable.',
        fix: 'Remove the noindex directive unless the page is genuinely meant to be private.',
        evidence: robotsMeta,
      });
    }

    if (page.robotsTxt && /^\s*disallow:\s*\/\s*$/im.test(page.robotsTxt)) {
      findings.push({
        ruleId: 'indexability',
        severity: 'critical',
        category: 'findability',
        title: 'The whole site is blocked from search engines',
        detail: 'robots.txt contains "Disallow: /", which asks crawlers to skip every page.',
        impact:
          'Nothing on the site can appear in search results while this is in place. It is a common leftover from a staging site going live.',
        fix: 'Remove the site-wide Disallow rule from robots.txt, keeping any specific paths you genuinely want excluded.',
      });
    }

    return findings;
  },
};

export const findabilityRules: Rule[] = [
  titleTag,
  metaDescription,
  headingStructure,
  canonicalUrl,
  structuredData,
  indexability,
];
