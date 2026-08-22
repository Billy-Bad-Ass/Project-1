import type { Finding, Rule } from '../lib/types';

/** Trust: whether the site looks safe and legitimate to a cautious visitor. */

export const httpsEnabled: Rule = {
  id: 'https',
  description: 'Site is served over HTTPS without mixed content',
  category: 'trust',
  check(page) {
    const findings: Finding[] = [];
    const isHttps = page.finalUrl.startsWith('https://');

    if (!isHttps) {
      findings.push({
        ruleId: 'https',
        severity: 'critical',
        category: 'trust',
        title: 'The site is not secure',
        detail: `The page is served over plain HTTP (${page.finalUrl}).`,
        impact:
          'Every major browser shows a "Not secure" warning in the address bar, and some block forms outright. Visitors who see that warning on a page asking for their details usually leave. Search engines also prefer secure sites.',
        fix: 'Install a TLS certificate — most hosts provide one free via Let\'s Encrypt — and redirect all HTTP traffic to HTTPS.',
      });
      return findings;
    }

    // Mixed content silently breaks images and scripts on a secure page.
    const insecure = [
      ...page.doc.querySelectorAll('img[src^="http://"]'),
      ...page.doc.querySelectorAll('script[src^="http://"]'),
      ...page.doc.querySelectorAll('link[href^="http://"]'),
    ];

    if (insecure.length > 0) {
      findings.push({
        ruleId: 'https',
        severity: 'high',
        category: 'trust',
        title: 'Parts of the secure page load insecurely',
        detail: `${insecure.length} resource(s) are loaded over plain HTTP on an HTTPS page.`,
        impact:
          'Browsers block these silently, so images may not appear and features may not work — and it can downgrade the padlock in the address bar.',
        fix: 'Change those URLs from http:// to https://, or to protocol-relative paths.',
        evidence: insecure
          .slice(0, 3)
          .map((el) => el.getAttribute('src') ?? el.getAttribute('href') ?? '')
          .join(' | '),
      });
    }

    return findings;
  },
};

export const privacyPolicy: Rule = {
  id: 'privacy-policy',
  description: 'Site links to a privacy policy when it collects data',
  category: 'trust',
  check(page) {
    const forms = page.doc.querySelectorAll('form');
    if (forms.length === 0) return [];

    const hasPolicyLink = page.links.some((l) =>
      /privacy|data.?protection|gdpr/i.test(`${l.href} ${l.text}`),
    );

    if (!hasPolicyLink) {
      return [
        {
          ruleId: 'privacy-policy',
          severity: 'medium',
          category: 'trust',
          title: 'A form collects details but no privacy policy is linked',
          detail: 'The page has a form but no link to a privacy policy.',
          impact:
            'Cautious visitors look for this before typing their details, and in the UK and EU collecting personal data without telling people how you use it is a legal exposure, not just a trust one.',
          fix: 'Publish a privacy policy page and link it from the footer and next to every form.',
        },
      ];
    }

    return [];
  },
};

export const trustRules: Rule[] = [httpsEnabled, privacyPolicy];
