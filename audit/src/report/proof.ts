import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ALL_RULES } from '../rules/index';
import { BRAND_ACCENT } from './brand';

/**
 * The two things a page with no customers can honestly show: what it checks,
 * and what other people said — once anyone has said anything.
 */

const CATEGORY_LABEL: Record<string, string> = {
  findability: 'Being found',
  conversion: 'Turning visitors into customers',
  trust: 'Trust and safety',
  speed: 'Speed',
  accessibility: 'Access for everyone',
  technical: 'Technical',
};

/** Order chosen by what a business owner cares about, not by rule count. */
const CATEGORY_ORDER = [
  'conversion',
  'findability',
  'trust',
  'speed',
  'accessibility',
  'technical',
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Every check, grouped, generated from the rules that actually run.
 *
 * Written from `ALL_RULES` rather than typed into the page, because a hand-kept
 * list is a promise that silently stops being true. The headline count comes
 * from the same array, so the page cannot claim twenty-two while running
 * nineteen.
 */
export function checksHtml(): string {
  const byCategory = new Map<string, string[]>();
  for (const rule of ALL_RULES) {
    const list = byCategory.get(rule.category) ?? [];
    list.push(rule.description);
    byCategory.set(rule.category, list);
  }

  const ordered = [
    ...CATEGORY_ORDER.filter((c) => byCategory.has(c)),
    ...[...byCategory.keys()].filter((c) => !CATEGORY_ORDER.includes(c)),
  ];

  const groups = ordered
    .map((category) => {
      const items = byCategory.get(category) ?? [];
      const rows = items
        .map((description) => `<li>${escapeHtml(description)}</li>`)
        .join('');
      return `
      <div class="check-group">
        <h3>${escapeHtml(CATEGORY_LABEL[category] ?? category)}
          <span class="check-count">${items.length}</span>
        </h3>
        <ul>${rows}</ul>
      </div>`;
    })
    .join('');

  return `<div class="checks-grid">${groups}</div>`;
}

/** The number quoted in the copy, from the same source as the list. */
export function ruleCount(): number {
  return ALL_RULES.length;
}

export interface Testimonial {
  quote: string;
  name: string;
  business: string;
}

/**
 * Reads real testimonials, if there are any.
 *
 * Returns an empty list when the file is absent or unreadable rather than
 * throwing, because the honest state of a new business is "no reviews yet" and
 * that must not be a build failure.
 */
export async function loadTestimonials(
  file = join(process.cwd(), 'web', 'testimonials.json'),
): Promise<Testimonial[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is Testimonial =>
        typeof t?.quote === 'string' &&
        t.quote.trim() !== '' &&
        typeof t?.name === 'string' &&
        typeof t?.business === 'string',
    );
  } catch {
    return [];
  }
}

/**
 * The social-proof block.
 *
 * With no testimonials it renders an offer instead of a quote. That is the one
 * honest move available: a page selling to strangers cannot invent praise, and
 * an empty "what our clients say" heading is worse than saying plainly that
 * you are new and pricing accordingly.
 *
 * The moment a real quote exists it takes over, and the offer disappears.
 */
export function testimonialsHtml(
  testimonials: Testimonial[],
  priceDisplay: string,
): string {
  if (testimonials.length === 0) {
    return `
    <section class="founding">
      <h2>No reviews yet — so here is the deal instead</h2>
      <p>
        This is new. Rather than show you testimonials that do not exist, here is
        what I will do for the first ten people who buy one:
      </p>
      <ul class="founding-terms">
        <li><strong>A free re-check once you have made the fixes.</strong> Send
        it back when the work is done and I will run the whole thing again so
        you can see what moved.</li>
        <li><strong>A call to walk you through it,</strong> free, whether or not
        you hire me afterwards.</li>
        <li><strong>${escapeHtml(priceDisplay)} stays the price for you</strong>
        on anything you buy later, even once it goes up.</li>
      </ul>
      <p class="founding-note">
        In exchange I will ask what you thought. If it was useful, a sentence I
        can quote here. If it was not, tell me why — that is worth more.
      </p>
    </section>`;
  }

  const cards = testimonials
    .map(
      (t) => `
      <figure class="quote">
        <blockquote>${escapeHtml(t.quote)}</blockquote>
        <figcaption>
          <strong>${escapeHtml(t.name)}</strong>
          <span>${escapeHtml(t.business)}</span>
        </figcaption>
      </figure>`,
    )
    .join('');

  return `
    <section class="proof">
      <h2>What people said</h2>
      <div class="quotes">${cards}</div>
    </section>`;
}

/** Styles for both blocks. Inlined into the page like the rest. */
export const PROOF_CSS = `
  .checks-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:26px;margin-top:8px}
  .check-group h3{font-size:14px;margin:0 0 10px;display:flex;align-items:center;gap:8px}
  .check-count{font-size:11px;font-weight:600;color:#fff;background:${BRAND_ACCENT};
    border-radius:99px;padding:1px 8px;font-variant-numeric:tabular-nums}
  .check-group ul{margin:0;padding-left:18px;font-size:14.5px;color:var(--muted)}
  .check-group li{margin-bottom:5px}

  .founding{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:30px 32px}
  .founding h2{margin-top:0}
  .founding-terms{list-style:none;padding:0;margin:20px 0}
  .founding-terms li{padding-left:28px;position:relative;margin-bottom:12px}
  .founding-terms li::before{content:"✓";position:absolute;left:0;color:var(--good);font-weight:700}
  .founding-note{color:var(--muted);font-size:15px;margin:0}

  .quotes{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px}
  .quote{margin:0;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:22px 24px}
  .quote blockquote{margin:0 0 14px;font-size:16px;line-height:1.6}
  .quote blockquote::before{content:"\\201C"}
  .quote blockquote::after{content:"\\201D"}
  .quote figcaption{font-size:14px;display:flex;flex-direction:column;gap:2px}
  .quote figcaption span{color:var(--muted)}

  .shot{margin:0;border-radius:12px;overflow:hidden;border:1px solid var(--line);
    box-shadow:0 18px 40px -24px rgba(18,22,31,.5)}
  .shot img{display:block;width:100%;height:auto}
  .shot figcaption{font-size:13px;color:var(--muted);padding:12px 16px;background:var(--panel);
    border-top:1px solid var(--line)}
`;
