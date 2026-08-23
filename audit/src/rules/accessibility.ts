import type { Finding, Rule } from '../lib/types';

/**
 * Accessibility: whether everyone can use the site.
 *
 * Framed for a business owner in terms of customers excluded and legal
 * exposure, because "WCAG 2.1 AA" means nothing to them. Only checks that can
 * be made reliably from static HTML are included — contrast and keyboard
 * traps need a real browser, and claiming to have checked them would be false.
 */

export const imageAltText: Rule = {
  id: 'image-alt',
  description: 'Meaningful images have alternative text',
  category: 'accessibility',
  check(page) {
    const images = page.doc.querySelectorAll('img');
    if (images.length === 0) return [];

    const missing = images.filter((img) => img.getAttribute('alt') === undefined);
    if (missing.length === 0) return [];

    const share = missing.length / images.length;
    return [
      {
        ruleId: 'image-alt',
        severity: share > 0.5 ? 'medium' : 'low',
        category: 'accessibility',
        title: 'Images have no text alternative',
        detail: `${missing.length} of ${images.length} images have no alt attribute.`,
        impact:
          'Visitors using a screen reader hear nothing where these images are. It also removes the text Google uses to understand your images, and accessibility complaints against small business sites are increasingly common.',
        fix: 'Add alt text describing what each image shows. Purely decorative images should have alt="" so they are skipped rather than read out as a filename.',
        evidence: missing
          .slice(0, 3)
          .map((img) => img.getAttribute('src')?.split('/').pop() ?? '')
          .filter(Boolean)
          .join(' | '),
      },
    ];
  },
};

export const languageDeclared: Rule = {
  id: 'html-lang',
  description: 'The document declares its language',
  category: 'accessibility',
  check(page) {
    const html = page.doc.querySelector('html');
    const lang = html?.getAttribute('lang')?.trim();

    if (!lang) {
      return [
        {
          ruleId: 'html-lang',
          severity: 'low',
          category: 'accessibility',
          title: 'The page does not say what language it is in',
          detail: 'The <html> element has no lang attribute.',
          impact:
            'Screen readers pick a voice based on this. Without it, English can be read aloud with the wrong pronunciation rules, which makes it hard to follow. Browser translation prompts also rely on it.',
          fix: 'Set the language on the html element, e.g. <html lang="en-GB">.',
        },
      ];
    }
    return [];
  },
};

export const formLabels: Rule = {
  id: 'form-labels',
  description: 'Form fields have labels',
  category: 'accessibility',
  check(page) {
    const inputs = page.doc
      .querySelectorAll('input, select, textarea')
      .filter((el) => {
        const type = (el.getAttribute('type') ?? '').toLowerCase();
        return !['hidden', 'submit', 'button', 'image', 'reset'].includes(type);
      });

    if (inputs.length === 0) return [];

    const labelled = new Set(
      page.doc
        .querySelectorAll('label[for]')
        .map((l) => l.getAttribute('for'))
        .filter((v): v is string => Boolean(v)),
    );

    const unlabelled = inputs.filter((el) => {
      const id = el.getAttribute('id');
      if (id && labelled.has(id)) return false;
      if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return false;
      // A label wrapping the input is also valid.
      return el.closest('label') === null;
    });

    if (unlabelled.length > 0) {
      return [
        {
          ruleId: 'form-labels',
          severity: 'medium',
          category: 'accessibility',
          title: 'Form fields are unlabeled',
          detail: `${unlabelled.length} of ${inputs.length} form fields have no associated label.`,
          impact:
            'A screen reader announces these as just "edit text", so the visitor cannot tell which box wants their email and which wants their phone number. Placeholder text alone disappears as soon as they start typing, which affects everyone.',
          fix: 'Give each field a <label for="..."> matching the field id, or an aria-label where a visible label would not suit the design.',
        },
      ];
    }

    return [];
  },
};

export const accessibilityRules: Rule[] = [imageAltText, languageDeclared, formLabels];
