import type { Finding, Rule } from '../lib/types';

/**
 * Conversion: whether a visitor who wants to buy can actually reach you.
 *
 * These findings land hardest in a sales conversation, because the owner can
 * verify them on their own phone in ten seconds.
 */

const PHONE_PATTERN = /(\+?\d[\d\s().-]{7,}\d)/;

export const contactMethod: Rule = {
  id: 'contact-method',
  description: 'A visitor can find a way to make contact',
  category: 'conversion',
  check(page) {
    const findings: Finding[] = [];
    const text = page.doc.text;

    const telLinks = page.doc.querySelectorAll('a[href^="tel:"]');
    const mailLinks = page.doc.querySelectorAll('a[href^="mailto:"]');
    const forms = page.doc.querySelectorAll('form');
    const hasVisiblePhone = PHONE_PATTERN.test(text);

    if (telLinks.length === 0 && mailLinks.length === 0 && forms.length === 0) {
      findings.push({
        ruleId: 'contact-method',
        severity: 'critical',
        category: 'conversion',
        title: 'There is no way to get in touch from this page',
        detail: 'No phone link, no email link and no contact form were found.',
        impact:
          'A visitor ready to buy has to leave and find you elsewhere, and most simply go to a competitor instead. Every other improvement on this list is worth less while this is true.',
        fix: 'Add a clearly visible phone number and email near the top of the page, and a short contact form.',
      });
      return findings;
    }

    // A phone number printed as text but not linked is a specifically mobile problem.
    if (telLinks.length === 0 && hasVisiblePhone) {
      const match = text.match(PHONE_PATTERN);
      findings.push({
        ruleId: 'contact-method',
        severity: 'high',
        category: 'conversion',
        title: 'The phone number cannot be tapped on a phone',
        detail: 'A phone number appears on the page but is not a clickable tel: link.',
        impact:
          'Most visitors are on a phone. Tapping to call should be one action; instead they must memorise or copy the number, and a good share of them will not bother.',
        fix: 'Wrap the number in a link: <a href="tel:+441234567890">01234 567890</a>.',
        evidence: match?.[1]?.trim(),
      });
    }

    return findings;
  },
};

export const callToAction: Rule = {
  id: 'call-to-action',
  description: 'The page asks the visitor to do something',
  category: 'conversion',
  check(page) {
    const candidates = [
      ...page.doc.querySelectorAll('a'),
      ...page.doc.querySelectorAll('button'),
      ...page.doc.querySelectorAll('input[type="submit"]'),
    ];

    const ACTION_WORDS =
      /\b(call|contact|book|enquire|inquire|quote|buy|order|shop|get started|sign up|subscribe|request|schedule|appointment|apply|donate|register|checkout|add to (cart|basket))\b/i;

    const hasCta = candidates.some((el) => {
      const label =
        el.text.trim() ||
        el.getAttribute('value') ||
        el.getAttribute('aria-label') ||
        '';
      return ACTION_WORDS.test(label);
    });

    if (!hasCta) {
      return [
        {
          ruleId: 'call-to-action',
          severity: 'high',
          category: 'conversion',
          title: 'The page never asks the visitor to act',
          detail:
            'No button or link uses action wording such as "book", "get a quote", "contact us" or "buy".',
          impact:
            'Pages that describe a service without asking for the next step convert far worse than ones that do. Visitors rarely go looking for the way forward on their own.',
          fix: 'Add one prominent button with specific wording — "Get a free quote" beats "Learn more" — repeated once near the top and once at the bottom.',
        },
      ];
    }

    return [];
  },
};

export const socialPreview: Rule = {
  id: 'social-preview',
  description: 'Links to the site look right when shared',
  category: 'conversion',
  check(page) {
    const ogTitle = page.doc.querySelector('meta[property="og:title" i]');
    const ogImage = page.doc.querySelector('meta[property="og:image" i]');

    if (!ogTitle && !ogImage) {
      return [
        {
          ruleId: 'social-preview',
          severity: 'medium',
          category: 'conversion',
          title: 'Shared links show up bare on social media and WhatsApp',
          detail: 'The page has no Open Graph title or image.',
          impact:
            'When a customer shares your link, it appears as a naked URL with no picture. Word of mouth is your cheapest marketing, and this makes it look untrustworthy.',
          fix: 'Add og:title, og:description and a 1200x630 og:image so shared links show a proper preview card.',
        },
      ];
    }

    if (!ogImage) {
      return [
        {
          ruleId: 'social-preview',
          severity: 'low',
          category: 'conversion',
          title: 'Shared links have no preview image',
          detail: 'og:title is present but og:image is missing.',
          impact: 'Link previews without an image take up far less space in a feed and get noticed less.',
          fix: 'Add a 1200x630 og:image.',
        },
      ];
    }

    return [];
  },
};

export const conversionRules: Rule[] = [contactMethod, callToAction, socialPreview];
