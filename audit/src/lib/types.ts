/**
 * The audit engine's core contract.
 *
 * A rule looks at one fetched page and reports problems. The value of this
 * tool is not the number of problems it can name — anyone can print a
 * checklist — it is that every finding is (a) real, (b) explained in terms of
 * what it costs the business, and (c) fixable by the person sending the audit.
 * A finding that fails any of those three is noise that makes the whole report
 * less credible, so rules are held to it.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type Category =
  | 'findability'   // can search engines understand and list this page
  | 'conversion'    // does the page let a visitor actually become a customer
  | 'trust'         // does the site look safe and legitimate
  | 'speed'         // does the page load before the visitor leaves
  | 'accessibility' // can everyone use it, including on a phone or a screen reader
  | 'technical';    // things that are simply broken

export interface Finding {
  ruleId: string;
  severity: Severity;
  category: Category;
  /** Short, human title. Shown as the finding headline. */
  title: string;
  /** What is wrong, in the client's language, not a developer's. */
  detail: string;
  /**
   * Why the business should care, in terms of customers or money. If a rule
   * cannot express this, it is a nitpick and should not be a rule.
   */
  impact: string;
  /** Concretely what to do. This is the thing being sold. */
  fix: string;
  /** Optional supporting evidence pulled from the page. */
  evidence?: string;
}

/** A page after fetching and parsing, handed to every rule. */
export interface PageContext {
  url: string;
  /** Final URL after redirects. */
  finalUrl: string;
  status: number;
  /** Raw HTML. */
  html: string;
  /** Parsed document. */
  doc: import('node-html-parser').HTMLElement;
  /** Lowercased response headers. */
  headers: Record<string, string>;
  /** Bytes of the HTML document itself. */
  bytes: number;
  /** Wall-clock milliseconds for the request. */
  loadMs: number;
  /** Same-origin and external links found on the page. */
  links: { href: string; text: string; external: boolean }[];
  /** Whether /robots.txt could be fetched, and its body. */
  robotsTxt: string | null;
  /** Whether a sitemap was discoverable. */
  sitemapUrl: string | null;
}

export interface Rule {
  id: string;
  /** One line describing what this checks, used in docs and the report legend. */
  description: string;
  category: Category;
  /**
   * Returns every problem found. An empty array means the page passed, which
   * is reported too — a clean bill of health on some checks is what makes the
   * failures credible.
   */
  check(page: PageContext): Finding[];
}

/** One audited site. */
export interface SiteAudit {
  url: string;
  finalUrl: string;
  fetchedAt: string;
  /** Null when the site could not be fetched at all. */
  error: string | null;
  status: number | null;
  loadMs: number | null;
  findings: Finding[];
  /** Rule ids that ran and found nothing — the passes. */
  passed: string[];
  /** 0-100. Higher is a healthier site. */
  healthScore: number;
  /** 0-100. Higher means a better sales prospect. */
  opportunityScore: number;
}

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 10,
  high: 6,
  medium: 3,
  low: 1,
};

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];
