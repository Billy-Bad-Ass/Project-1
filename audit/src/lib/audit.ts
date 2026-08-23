import { ALL_RULES } from '../rules/index';
import { PageFetcher, robotsAllows } from './fetch-page';
import {
  SEVERITY_ORDER,
  SEVERITY_WEIGHT,
  type Finding,
  type Rule,
  type Severity,
  type SiteAudit,
} from './types';

/**
 * Runs every rule against one site and scores the result.
 *
 * Two scores, because they answer different questions:
 *
 *   healthScore      how good is this site (shown to the business owner)
 *   opportunityScore how much billable work is sitting here (shown to you)
 *
 * They are deliberately near-inverses. A site with nothing wrong is a great
 * site and a terrible sales lead, and the tool should say both plainly rather
 * than inventing problems to justify a pitch.
 */

export interface AuditOptions {
  fetcher?: PageFetcher;
  rules?: Rule[];
  /** Skip sites whose robots.txt asks us not to fetch the page. */
  respectRobots?: boolean;
  log?: (message: string) => void;
}

export function scoreFindings(findings: Finding[]): { health: number; opportunity: number } {
  const penalty = findings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0);

  // Decays smoothly rather than subtracting linearly to zero. A linear scale
  // bottomed out at 0/100 on any thoroughly neglected site, which reads as a
  // broken gauge rather than a measurement — and telling a prospect their site
  // scores zero invites them to dismiss the whole report instead of fixing
  // anything. The curve keeps the differences between bad sites visible.
  const health = Math.max(1, Math.round(100 * Math.exp(-penalty / 28)));

  // Opportunity rises with fixable problems but flattens out: past a point,
  // more breakage signals a business that will not pay rather than a bigger
  // job, so a wall of findings should not outrank a solid mid-sized prospect.
  const opportunity = Math.min(100, Math.round(100 * (1 - Math.exp(-penalty / 14))));

  return { health, opportunity };
}

/** Sort by severity first, then by the rule ordering in the registry. */
export function sortFindings(findings: Finding[]): Finding[] {
  const ruleOrder = new Map(ALL_RULES.map((r, i) => [r.id, i]));
  return [...findings].sort((a, b) => {
    const bySeverity =
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
    if (bySeverity !== 0) return bySeverity;
    return (ruleOrder.get(a.ruleId) ?? 999) - (ruleOrder.get(b.ruleId) ?? 999);
  });
}

/**
 * Why a response cannot be audited, or null if it can.
 *
 * Deliberately conservative: it is far cheaper to drop a real prospect than to
 * tell a stranger their working website is down. Anything we could not read is
 * treated as unknown rather than broken.
 */
export function blockedReason(status: number | null, loadMs: number | null): string | null {
  if (status === null) return null;

  // Refusals aimed at automated clients. The site is almost certainly fine for
  // a human, and a WAF answers in milliseconds because nothing was rendered.
  if (status === 401 || status === 403 || status === 429) {
    return `blocked by the site (HTTP ${status})`;
  }

  // A server error might be genuine, but one sample is not evidence enough to
  // put "your site is down" in front of a business owner.
  if (status >= 500) return `server error on our one request (HTTP ${status})`;

  // 404 on a homepage is a real, checkable problem worth reporting.
  return null;
}

export async function auditSite(url: string, options: AuditOptions = {}): Promise<SiteAudit> {
  const fetcher = options.fetcher ?? new PageFetcher();
  const rules = options.rules ?? ALL_RULES;
  const log = options.log ?? (() => {});
  const respectRobots = options.respectRobots ?? true;

  const normalised = normaliseUrl(url);
  const base: SiteAudit = {
    url: normalised,
    finalUrl: normalised,
    fetchedAt: new Date().toISOString(),
    error: null,
    status: null,
    loadMs: null,
    findings: [],
    passed: [],
    healthScore: 0,
    opportunityScore: 0,
  };

  let page;
  try {
    page = await fetcher.fetchPage(normalised);
  } catch (error) {
    fetcher.stats.failed += 1;
    return {
      ...base,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (respectRobots) {
    const path = new URL(page.finalUrl).pathname;
    if (!robotsAllows(page.robotsTxt, path)) {
      log(`  skipped (robots.txt disallows): ${normalised}`);
      return { ...base, error: 'skipped: robots.txt disallows crawling this page' };
    }
  }

  // A page we could not actually read tells us nothing about the site.
  //
  // This matters more than it sounds. When a server refuses the scanner, every
  // content rule fails for want of content, health collapses to single digits,
  // and the site sorts to the very top of the outreach list — so the businesses
  // most likely to be fine are the ones we would email first, telling them
  // their site is broken when it works perfectly in a browser.
  //
  // A fast 403 is the signature of a bot filter, not an outage.
  const blocked = blockedReason(page.status, page.loadMs);
  if (blocked) {
    log(`  skipped (${blocked}): ${normalised}`);
    return { ...base, status: page.status, loadMs: page.loadMs, error: `unauditable: ${blocked}` };
  }

  const findings: Finding[] = [];
  const passed: string[] = [];

  for (const rule of rules) {
    try {
      const result = rule.check(page);
      if (result.length === 0) passed.push(rule.id);
      else findings.push(...result);
    } catch (error) {
      // A rule throwing on unusual markup must not lose the other 21 results.
      log(`  ! rule ${rule.id} threw: ${String(error)}`);
    }
  }

  const sorted = sortFindings(findings);
  const { health, opportunity } = scoreFindings(sorted);

  return {
    url: normalised,
    finalUrl: page.finalUrl,
    fetchedAt: new Date().toISOString(),
    error: null,
    status: page.status,
    loadMs: page.loadMs,
    findings: sorted,
    passed,
    healthScore: health,
    opportunityScore: opportunity,
  };
}

/** Accepts "example.com" as readily as a full URL, since lead lists are messy. */
export function normaliseUrl(input: string): string {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, '')}`;
}

/** Counts for every severity, always present, so callers need no guards. */
export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return counts;
}
