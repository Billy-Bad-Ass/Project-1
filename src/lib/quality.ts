import type { SourceItem } from './sources/types';

/**
 * Content quality gate.
 *
 * Search engines demote programmatically generated pages that carry no
 * information the user could not get elsewhere ("scaled content abuse"). The
 * defence is not clever wording, it is refusing to publish pages that are
 * genuinely empty. This module is that refusal, applied mechanically before
 * anything reaches the sitemap.
 *
 * Three outcomes:
 *   publish   - indexable, in the sitemap, linked from hubs
 *   noindex   - reachable by direct link, but `noindex` and absent from sitemap
 *   suppress  - not built at all
 */

export type Verdict = 'publish' | 'noindex' | 'suppress';

export interface QualityRule {
  id: string;
  /** Reason text shown in the build report when the rule fires. */
  describe: (item: SourceItem) => string;
  /** True when the item FAILS this rule. */
  fails: (item: SourceItem, ctx: QualityContext) => boolean;
  /** Outcome when the rule fails. */
  outcome: Exclude<Verdict, 'publish'>;
}

export interface QualityContext {
  /** Normalised summary -> number of items sharing it. */
  summaryFingerprints: Map<string, number>;
  minFacts: number;
  minSummaryChars: number;
}

export interface QualityResult {
  verdict: Verdict;
  reasons: string[];
}

export interface GateReport {
  published: SourceItem[];
  noindexed: SourceItem[];
  suppressed: { slug: string; title: string; reasons: string[] }[];
  /** Rule id -> how many items it fired on. */
  ruleHits: Record<string, number>;
}

/**
 * Collapse a summary to a fingerprint that ignores the numbers in it. Two
 * pages that differ only in their price are the same template, and a site made
 * of those is the exact pattern that gets demoted.
 */
export function fingerprint(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/[0-9][0-9.,]*/g, '#')
    .replace(/[^a-z# ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const RULES: QualityRule[] = [
  {
    id: 'missing-title',
    describe: () => 'title is empty or placeholder',
    fails: (item) => item.title.trim().length < 2 || /^(untitled|unknown|n\/a)$/i.test(item.title),
    outcome: 'suppress',
  },
  {
    id: 'thin-summary',
    describe: (item) => `summary is only ${item.summary.trim().length} characters`,
    fails: (item, ctx) => item.summary.trim().length < ctx.minSummaryChars,
    outcome: 'suppress',
  },
  {
    id: 'too-few-facts',
    describe: (item) => `only ${item.facts.length} data points on the page`,
    fails: (item, ctx) => item.facts.length < ctx.minFacts,
    outcome: 'suppress',
  },
  {
    id: 'no-offers',
    describe: () => 'no live offers, so the page cannot answer "where do I get this"',
    fails: (item) => item.offers.length === 0,
    outcome: 'noindex',
  },
  {
    id: 'duplicate-shape',
    // `describe` has no access to the context, so the shared count is resolved
    // in `evaluate` and passed through this closure-free message instead.
    describe: () => 'summary shares its structure with too many other pages',
    fails: (item, ctx) => sharedShapeCount(item, ctx) > DUPLICATE_SHAPE_LIMIT,
    outcome: 'noindex',
  },
];

/**
 * How many pages may share one summary shape before the shape stops counting
 * as distinguishing content. Set generously: a vertical legitimately reuses
 * sentence structure, it is *only* reusing it that is the problem.
 */
export const DUPLICATE_SHAPE_LIMIT = 25;

function sharedShapeCount(item: SourceItem, ctx: QualityContext): number {
  return ctx.summaryFingerprints.get(fingerprint(item.summary)) ?? 0;
}

export interface GateOptions {
  minFacts?: number;
  minSummaryChars?: number;
}

export function runQualityGate(items: SourceItem[], options: GateOptions = {}): GateReport {
  const ctx: QualityContext = {
    summaryFingerprints: new Map(),
    minFacts: options.minFacts ?? 4,
    minSummaryChars: options.minSummaryChars ?? 80,
  };

  for (const item of items) {
    const key = fingerprint(item.summary);
    ctx.summaryFingerprints.set(key, (ctx.summaryFingerprints.get(key) ?? 0) + 1);
  }

  const report: GateReport = {
    published: [],
    noindexed: [],
    suppressed: [],
    ruleHits: {},
  };

  for (const item of items) {
    const result = evaluate(item, ctx);
    for (const reason of result.reasons) {
      const ruleId = reason.split(':')[0] ?? 'unknown';
      report.ruleHits[ruleId] = (report.ruleHits[ruleId] ?? 0) + 1;
    }

    if (result.verdict === 'suppress') {
      report.suppressed.push({ slug: item.slug, title: item.title, reasons: result.reasons });
    } else if (result.verdict === 'noindex') {
      report.noindexed.push(item);
    } else {
      report.published.push(item);
    }
  }

  return report;
}

export function evaluate(item: SourceItem, ctx: QualityContext): QualityResult {
  const reasons: string[] = [];
  let verdict: Verdict = 'publish';

  for (const rule of RULES) {
    if (!rule.fails(item, ctx)) continue;
    reasons.push(`${rule.id}: ${rule.describe(item)}`);
    // suppress outranks noindex outranks publish
    if (rule.outcome === 'suppress') verdict = 'suppress';
    else if (verdict === 'publish') verdict = 'noindex';
  }

  return { verdict, reasons };
}
