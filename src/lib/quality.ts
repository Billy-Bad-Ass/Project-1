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
 *
 * Alongside the verdict the gate reports template diversity, which gates
 * nothing but tells you whether the adapter is saying genuinely different
 * things about different items. See `measureDiversity`.
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
  /** Advisory only — see `measureDiversity`. */
  diversity: DiversityReport;
}

/**
 * Near-duplicate fingerprint: the summary with its numbers masked.
 *
 * Two pages whose prose is word-for-word identical apart from the figures are
 * near-duplicates of each other. Note what this does NOT detect: because the
 * item's own title and merchant names survive masking, every fingerprint stays
 * unique whenever the summary names the item. Detecting a shared *template*
 * needs `skeleton` below, which is a different question with a different
 * answer.
 */
export function fingerprint(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/[0-9][0-9.,]*/g, '#')
    .replace(/[^a-z# ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The sentence skeleton: the summary with every item-specific token removed —
 * numbers, the item's own title, and each of its fact values (merchant names,
 * authors, ratings). What remains is the phrasing the adapter would emit for
 * any item that took the same branch.
 *
 * This measures template diversity, and deliberately does NOT gate anything.
 * A price-comparison catalogue legitimately reuses phrasing across thousands
 * of pages — the value of such a page is its numbers, not novel prose, and
 * suppressing on shared structure would correctly describe no real site. What
 * a low diversity score means is that the adapter branches on too little, so
 * it is surfaced as a build-time warning for a human to judge.
 */
export function skeleton(item: SourceItem): string {
  let text = ` ${item.summary.toLowerCase()} `;

  const tokens = [item.title, ...item.facts.map((fact) => String(fact.value))]
    .map((token) => token.toLowerCase().trim())
    .filter((token) => token.length > 2)
    // Longest first, so removing a short token cannot break a longer one.
    .sort((a, b) => b.length - a.length);

  for (const token of tokens) {
    text = text.split(token).join(' ');
  }

  return text
    .replace(/[0-9][0-9.,]*/g, ' ')
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface DiversityReport {
  /** Distinct sentence skeletons across the dataset. */
  distinct: number;
  total: number;
  /** Share of pages covered by the single most common skeleton, 0-1. */
  concentration: number;
  /** True when the phrasing is repetitive enough to be worth a human look. */
  warn: boolean;
}

/** Concentration above this share of the catalogue is worth flagging. */
export const CONCENTRATION_WARN = 0.6;

export function measureDiversity(items: SourceItem[]): DiversityReport {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = skeleton(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const total = items.length;
  const largest = counts.size === 0 ? 0 : Math.max(...counts.values());
  const concentration = total === 0 ? 0 : largest / total;

  return {
    distinct: counts.size,
    total,
    concentration,
    warn: total >= 25 && concentration > CONCENTRATION_WARN,
  };
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
    id: 'near-duplicate',
    describe: () => 'summary is word-for-word identical to other pages apart from its figures',
    fails: (item, ctx) => sharedShapeCount(item, ctx) > DUPLICATE_SHAPE_LIMIT,
    outcome: 'noindex',
  },
];

/**
 * How many pages may share one masked summary before they stop counting as
 * distinct content. Reached only when the prose does not name the item, so in
 * practice this catches adapters emitting a constant string.
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
    // Filled in below, once we know which items survive. Measuring the input
    // instead would count suppressed pages that never reach the site, and give
    // a different number from `data:stats`, which reads the written dataset.
    diversity: { distinct: 0, total: 0, concentration: 0, warn: false },
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

  report.diversity = measureDiversity([...report.published, ...report.noindexed]);

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
