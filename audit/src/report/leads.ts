import { countBySeverity } from '../lib/audit';
import { reportSlug } from '../lib/slug';
import type { SiteAudit } from '../lib/types';

/**
 * The outreach side of the tool.
 *
 * The report is what the prospect reads. This is what you read: who to contact
 * first, and the one specific sentence that gets a reply. Generic outreach
 * ("I noticed some SEO issues") is ignored; naming a problem the owner can
 * verify on their own phone in ten seconds is not.
 */

export interface Lead {
  host: string;
  url: string;
  opportunityScore: number;
  healthScore: number;
  critical: number;
    high: number;
  totalFindings: number;
  /** The single most compelling thing to open with. */
  hook: string;
  /** Report filename for this site. */
  reportFile: string;
}

/**
 * Sorted best-first. Ties break toward the healthier site, because an owner
 * whose site is merely imperfect is likelier to have a budget than one whose
 * site is entirely abandoned.
 */
export function rankLeads(audits: SiteAudit[]): Lead[] {
  return audits
    .filter((a) => a.error === null && a.findings.length > 0)
    .map((audit) => {
      const counts = countBySeverity(audit.findings);
      return {
        host: hostOf(audit.finalUrl),
        url: audit.finalUrl,
        opportunityScore: audit.opportunityScore,
        healthScore: audit.healthScore,
        critical: counts.critical,
        high: counts.high,
        totalFindings: audit.findings.length,
        hook: buildHook(audit),
        reportFile: `reports/${reportSlug(audit.finalUrl)}.html`,
      };
    })
    .sort(
      (a, b) =>
        b.opportunityScore - a.opportunityScore || b.healthScore - a.healthScore,
    );
}

/**
 * The opening line, built from the site's worst actual finding.
 *
 * Deliberately states the problem and its consequence, and stops there. No
 * pitch: the report is the pitch, and an opener that sells before it has shown
 * anything reads like every other cold email.
 */
function buildHook(audit: SiteAudit): string {
  const worst = audit.findings[0];
  if (!worst) return 'No significant issues found.';

  const host = hostOf(audit.finalUrl);
  switch (worst.ruleId) {
    case 'mobile-viewport':
      return `${host} isn't set up for phones — on mobile the desktop layout is shrunk down and the text is unreadable without zooming.`;
    case 'indexability':
      return `${host} is currently telling Google not to list it. That's usually left over by accident after a redesign.`;
    case 'https':
      return `${host} loads over an insecure connection, so browsers show a "Not secure" warning next to the address.`;
    case 'contact-method':
      return `${host} has no clickable way to get in touch from the home page.`;
    case 'http-status':
      return `${host} is returning an error instead of the page.`;
    case 'title-tag':
      return `${host} has no page title, so Google is inventing the headline shown in search results.`;
    case 'response-time':
      return `${host} takes ${((audit.loadMs ?? 0) / 1000).toFixed(1)} seconds just to start loading.`;
    default:
      return `${host}: ${lowerFirst(worst.title)} — ${lowerFirst(firstSentence(worst.impact))}`;
  }
}

function firstSentence(text: string): string {
  const match = text.match(/^[^.]+\./);
  return (match?.[0] ?? text).trim();
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function renderOutreachMarkdown(leads: Lead[]): string {
  const lines: string[] = [];
  lines.push('# Outreach list');
  lines.push('');
  lines.push(
    `${leads.length} prospect${leads.length === 1 ? '' : 's'} with fixable problems, best first.`,
  );
  lines.push('');
  lines.push(
    'Opportunity is how much billable work is sitting there. Health is how good ' +
      'their site is. Work down from the top, and send the matching report as the ' +
      'attachment — the report is the pitch, so the email only needs the hook and an offer to talk.',
  );
  lines.push('');

  for (const [index, lead] of leads.entries()) {
    lines.push(`## ${index + 1}. ${lead.host}`);
    lines.push('');
    lines.push(
      `- **Opportunity** ${lead.opportunityScore}/100 · **Health** ${lead.healthScore}/100`,
    );
    lines.push(
      `- ${lead.critical} urgent, ${lead.high} important, ${lead.totalFindings} total`,
    );
    lines.push(`- Site: ${lead.url}`);
    lines.push(`- Report: \`${lead.reportFile}\``);
    lines.push('');
    lines.push(`**Opening line:** ${lead.hook}`);
    lines.push('');
  }

  if (leads.length === 0) {
    lines.push('_Nothing found. Either the list was empty or every site checked out clean._');
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

export function renderOutreachCsv(leads: Lead[]): string {
  const escape = (value: string | number): string => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const rows = [
    ['host', 'url', 'opportunity', 'health', 'critical', 'high', 'total_findings', 'hook', 'report'],
    ...leads.map((l) => [
      l.host,
      l.url,
      l.opportunityScore,
      l.healthScore,
      l.critical,
      l.high,
      l.totalFindings,
      l.hook,
      l.reportFile,
    ]),
  ];

  return `${rows.map((r) => r.map(escape).join(',')).join('\n')}\n`;
}
