import type { SiteAudit } from '../lib/types';

/**
 * An example audit, used for the sales-page screenshot and nowhere else.
 *
 * The business is invented on purpose. The findings are the real ones the rules
 * produce most often — from the live Fairfax County run, `contact-method`,
 * `https` and image weight were the recurring three — so the picture is honest
 * about what a report looks like without putting a real practice's failing
 * website on a marketing page.
 *
 * Naming it EXAMPLE and keeping it in its own file is deliberate: fixture data
 * that sits next to real data eventually gets used as real data.
 */
export const EXAMPLE_AUDIT: SiteAudit = {
  url: 'https://example-dental.com/',
  finalUrl: 'https://example-dental.com/',
  fetchedAt: '2026-08-23T09:00:00.000Z',
  error: null,
  status: 200,
  loadMs: 4100,
  healthScore: 46,
  opportunityScore: 74,
  passed: ['favicon', 'title-present', 'lang-attribute', 'viewport-meta'],
  findings: [
    {
      ruleId: 'contact-method',
      severity: 'critical',
      category: 'conversion',
      title: 'No clickable phone number on the home page',
      detail:
        'The number appears as plain text in the footer. On a phone it cannot be tapped to call.',
      impact:
        'Most new-patient calls come from someone who wants to ring immediately. If they have to copy the number by hand, a good share give up and call the next practice instead.',
      fix: 'Wrap the number in a tel: link and move it into the header so it is visible without scrolling.',
      evidence: '<p>Call us on (703) 555-0142</p>',
    },
    {
      ruleId: 'https',
      severity: 'critical',
      category: 'trust',
      title: 'The site is not served over a secure connection',
      detail: 'The home page loads over http:// and does not redirect to https://.',
      impact:
        'Chrome shows a "Not secure" warning next to the address. Patients reading that before a first appointment draw the obvious conclusion.',
      fix: 'Enable HTTPS — most hosts now include a free certificate — and redirect all http traffic to it.',
    },
    {
      ruleId: 'image-weight',
      severity: 'high',
      category: 'speed',
      title: 'Photographs are far larger than they need to be',
      detail: 'Four images on the home page total 6.2 MB.',
      impact:
        'On a phone on mobile data the page takes several seconds to appear, and a good share of visitors leave before it does.',
      fix: 'Export each image at the size it is actually displayed and save as WebP. This usually cuts the weight by ninety per cent with no visible difference.',
      evidence: '/images/reception-desk.jpg — 2.4 MB',
    },
    {
      ruleId: 'meta-description',
      severity: 'medium',
      category: 'findability',
      title: 'Google is writing your search listing for you',
      detail: 'The home page has no meta description.',
      impact:
        'Google falls back to whatever text it finds first, which is often a cookie notice. That is the sentence people read before deciding whether to click.',
      fix: 'Write one sentence, about 150 characters, naming the practice, the area served and what makes it worth choosing.',
    },
    {
      ruleId: 'alt-text',
      severity: 'medium',
      category: 'accessibility',
      title: 'Images have no alternative text',
      detail: '7 of 9 images have no alt attribute.',
      impact:
        'Anyone using a screen reader hears nothing where the picture is, and search engines cannot tell what the images show.',
      fix: 'Describe each image in a few words. Decorative images should have an empty alt so they are skipped rather than read out.',
    },
  ],
};
