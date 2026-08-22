import { countBySeverity } from '../lib/audit';
import { ALL_RULES } from '../rules/index';
import type { Finding, Severity, SiteAudit } from '../lib/types';
import { sender, type SenderConfig } from './config';

/**
 * Renders one audit as a self-contained HTML page.
 *
 * This is the document that decides whether anyone replies, so it is written
 * for a business owner rather than a developer: findings lead with what the
 * problem costs them, severity is expressed in plain words, and the passes are
 * shown too — a report that only lists failures reads like a scare tactic and
 * gets deleted.
 *
 * No external assets, so it renders identically from an email attachment, a
 * USB stick or a browser with no network. Print styles included: Ctrl-P gives
 * a clean PDF.
 */

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Urgent',
  high: 'Important',
  medium: 'Worth fixing',
  low: 'Minor',
};

const SEVERITY_BLURB: Record<Severity, string> = {
  critical: 'Costing you customers right now.',
  high: 'Having a real effect on results.',
  medium: 'Adds up over time.',
  low: 'Polish, once the rest is done.',
};

const CATEGORY_LABEL: Record<string, string> = {
  findability: 'Being found',
  conversion: 'Turning visitors into customers',
  trust: 'Trust and safety',
  speed: 'Speed',
  accessibility: 'Access for everyone',
  technical: 'Technical',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** A one-line verdict, so the reader knows where they stand immediately. */
function verdict(audit: SiteAudit): string {
  const counts = countBySeverity(audit.findings);
  if (counts.critical > 0) {
    return `We found ${counts.critical} issue${counts.critical === 1 ? '' : 's'} that ${counts.critical === 1 ? 'is' : 'are'} actively costing you enquiries, plus ${audit.findings.length - counts.critical} smaller ones.`;
  }
  if (counts.high > 0) {
    return `Nothing is badly broken, but ${counts.high} issue${counts.high === 1 ? '' : 's'} ${counts.high === 1 ? 'is' : 'are'} holding the site back from doing its job properly.`;
  }
  if (audit.findings.length > 0) {
    return `The site is in good shape. What we found is refinement rather than repair — ${audit.findings.length} smaller item${audit.findings.length === 1 ? '' : 's'} worth tidying.`;
  }
  return 'We could not fault it. Everything we check came back clean.';
}

function scoreColour(score: number): string {
  if (score >= 80) return '#15803d';
  if (score >= 55) return '#a16207';
  return '#b91c1c';
}

function findingCard(finding: Finding, index: number): string {
  return `
      <article class="finding sev-${finding.severity}">
        <header>
          <span class="num">${index}</span>
          <div>
            <h3>${escapeHtml(finding.title)}</h3>
            <p class="tags">
              <span class="pill pill-${finding.severity}">${SEVERITY_LABEL[finding.severity]}</span>
              <span class="cat">${escapeHtml(CATEGORY_LABEL[finding.category] ?? finding.category)}</span>
            </p>
          </div>
        </header>
        <div class="body">
          <p class="detail">${escapeHtml(finding.detail)}</p>
          <div class="block impact">
            <h4>Why it matters</h4>
            <p>${escapeHtml(finding.impact)}</p>
          </div>
          <div class="block fix">
            <h4>How to fix it</h4>
            <p>${escapeHtml(finding.fix)}</p>
          </div>
          ${
            finding.evidence
              ? `<p class="evidence"><span>Found on your site:</span> <code>${escapeHtml(
                  finding.evidence.slice(0, 200),
                )}</code></p>`
              : ''
          }
        </div>
      </article>`;
}

export function renderReport(audit: SiteAudit, from: SenderConfig = sender): string {
  const host = hostOf(audit.finalUrl);
  const counts = countBySeverity(audit.findings);
  const date = new Date(audit.fetchedAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const bySeverity: Severity[] = ['critical', 'high', 'medium', 'low'];
  let counter = 0;
  const sections = bySeverity
    .map((sev) => {
      const group = audit.findings.filter((f) => f.severity === sev);
      if (group.length === 0) return '';
      const cards = group.map((f) => findingCard(f, ++counter)).join('');
      return `
    <section class="group">
      <h2 class="group-head sev-${sev}">
        ${SEVERITY_LABEL[sev]}
        <span class="count">${group.length}</span>
      </h2>
      <p class="group-blurb">${SEVERITY_BLURB[sev]}</p>
      ${cards}
    </section>`;
    })
    .join('');

  const passedRules = ALL_RULES.filter((r) => audit.passed.includes(r.id));

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Website review — ${escapeHtml(host)}</title>
<style>
  :root {
    --accent: ${escapeHtml(from.accent)};
    --ink: #111827;
    --muted: #6b7280;
    --line: #e5e7eb;
    --bg: #ffffff;
    --panel: #f9fafb;
    --critical: #b91c1c;
    --high: #c2410c;
    --medium: #a16207;
    --low: #4b5563;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: var(--ink);
    background: #f3f4f6;
  }
  .sheet { max-width: 820px; margin: 0 auto; background: var(--bg); }
  .pad { padding: 0 48px; }

  header.cover { background: var(--ink); color: #fff; padding: 44px 48px 38px; }
  header.cover .eyebrow { text-transform: uppercase; letter-spacing: .12em; font-size: 11px; color: #9ca3af; margin: 0 0 10px; }
  header.cover h1 { margin: 0 0 6px; font-size: 30px; line-height: 1.15; letter-spacing: -.02em; }
  header.cover .site { color: var(--accent); font-weight: 600; }
  header.cover .meta { margin: 14px 0 0; color: #9ca3af; font-size: 13px; }

  .summary { display: flex; gap: 28px; align-items: center; padding: 32px 48px; border-bottom: 1px solid var(--line); }
  .score { flex: 0 0 auto; text-align: center; }
  .score .ring {
    width: 104px; height: 104px; border-radius: 50%;
    display: grid; place-items: center;
    border: 8px solid currentColor;
    font-size: 30px; font-weight: 700;
  }
  .score .label { font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); margin-top: 8px; }
  .verdict p { margin: 0 0 12px; font-size: 17px; }
  .tally { display: flex; gap: 8px; flex-wrap: wrap; margin: 0; padding: 0; list-style: none; }
  .tally li { font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 999px; background: var(--panel); border: 1px solid var(--line); }
  .tally li b { font-weight: 700; }

  section.group { padding: 30px 48px 6px; }
  .group-head { font-size: 13px; text-transform: uppercase; letter-spacing: .1em; margin: 0 0 2px; display: flex; align-items: center; gap: 10px; }
  .group-head .count { font-size: 11px; background: currentColor; color: #fff; border-radius: 999px; padding: 1px 8px; }
  .group-head.sev-critical { color: var(--critical); }
  .group-head.sev-high { color: var(--high); }
  .group-head.sev-medium { color: var(--medium); }
  .group-head.sev-low { color: var(--low); }
  .group-blurb { margin: 0 0 18px; color: var(--muted); font-size: 14px; }

  .finding { border: 1px solid var(--line); border-radius: 10px; margin-bottom: 16px; overflow: hidden; page-break-inside: avoid; }
  .finding header { display: flex; gap: 14px; padding: 16px 18px; background: var(--panel); border-bottom: 1px solid var(--line); }
  .finding .num { flex: 0 0 28px; height: 28px; border-radius: 50%; background: var(--ink); color: #fff; display: grid; place-items: center; font-size: 13px; font-weight: 700; }
  .finding h3 { margin: 0 0 6px; font-size: 17px; line-height: 1.3; }
  .tags { margin: 0; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .pill { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; padding: 2px 8px; border-radius: 4px; color: #fff; }
  .pill-critical { background: var(--critical); }
  .pill-high { background: var(--high); }
  .pill-medium { background: var(--medium); }
  .pill-low { background: var(--low); }
  .cat { font-size: 12px; color: var(--muted); }
  .finding .body { padding: 16px 18px; }
  .detail { margin: 0 0 14px; }
  .block { border-left: 3px solid var(--line); padding-left: 14px; margin-bottom: 12px; }
  .block.fix { border-left-color: var(--accent); }
  .block h4 { margin: 0 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
  .block p { margin: 0; }
  .evidence { margin: 12px 0 0; font-size: 13px; color: var(--muted); }
  .evidence code { background: var(--panel); border: 1px solid var(--line); border-radius: 4px; padding: 2px 6px; font-size: 12px; word-break: break-all; }

  .passed { padding: 26px 48px; background: var(--panel); border-top: 1px solid var(--line); }
  .passed h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); margin: 0 0 12px; }
  .passed ul { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 6px 20px; }
  .passed li { font-size: 14px; color: #374151; }
  .passed li::before { content: "✓"; color: #15803d; font-weight: 700; margin-right: 8px; }

  .next { padding: 32px 48px; border-top: 3px solid var(--accent); }
  .next h2 { margin: 0 0 10px; font-size: 20px; }
  .next .from { margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--line); font-size: 15px; }
  .next .from strong { display: block; font-size: 16px; }
  .next a { color: var(--accent); }

  footer.fine { padding: 20px 48px 34px; color: var(--muted); font-size: 12px; }

  @media print {
    body { background: #fff; }
    .sheet { max-width: none; }
    .finding { break-inside: avoid; }
    section.group { padding-left: 0; padding-right: 0; }
    .pad, header.cover, .summary, .passed, .next, footer.fine { padding-left: 0; padding-right: 0; }
    header.cover { background: #fff; color: var(--ink); border-bottom: 3px solid var(--ink); }
    header.cover .meta, header.cover .eyebrow { color: var(--muted); }
  }
  @media (max-width: 640px) {
    .pad, header.cover, .summary, section.group, .passed, .next, footer.fine { padding-left: 20px; padding-right: 20px; }
    .summary { flex-direction: column; align-items: flex-start; }
  }
</style>
</head>
<body>
<div class="sheet">

  <header class="cover">
    <p class="eyebrow">Website review</p>
    <h1><span class="site">${escapeHtml(host)}</span></h1>
    <p class="meta">Prepared by ${escapeHtml(from.business)} · ${escapeHtml(date)}</p>
  </header>

  <div class="summary">
    <div class="score" style="color:${scoreColour(audit.healthScore)}">
      <div class="ring">${audit.healthScore}</div>
      <div class="label">out of 100</div>
    </div>
    <div class="verdict">
      <p>${escapeHtml(verdict(audit))}</p>
      <ul class="tally">
        ${(['critical', 'high', 'medium', 'low'] as Severity[])
          .filter((s) => counts[s] > 0)
          .map((s) => `<li><b>${counts[s]}</b> ${SEVERITY_LABEL[s].toLowerCase()}</li>`)
          .join('')}
        <li><b>${audit.passed.length}</b> checks passed</li>
      </ul>
    </div>
  </div>

  ${sections}

  ${
    passedRules.length > 0
      ? `<section class="passed">
    <h2>What is already working</h2>
    <ul>${passedRules.map((r) => `<li>${escapeHtml(r.description)}</li>`).join('')}</ul>
  </section>`
      : ''
  }

  <section class="next">
    <h2>What I would do first</h2>
    <p>${escapeHtml(nextStep(audit))}</p>
    <p>${escapeHtml(from.offer)}</p>
    <div class="from">
      <strong>${escapeHtml(from.name)}</strong>
      ${escapeHtml(from.business)}<br>
      <a href="mailto:${escapeHtml(from.email)}">${escapeHtml(from.email)}</a>${
        from.phone ? ` · <a href="tel:${escapeHtml(from.phone.replace(/\s/g, ''))}">${escapeHtml(from.phone)}</a>` : ''
      }${from.website ? `<br><a href="${escapeHtml(from.website)}">${escapeHtml(from.website)}</a>` : ''}
    </div>
  </section>

  <footer class="fine">
    Checked ${escapeHtml(audit.finalUrl)} on ${escapeHtml(date)}. This review looks at the
    home page only, and at what can be measured from the page itself — it is a starting point,
    not a full technical audit. Findings about speed are indicators worth investigating rather
    than a full performance profile.
  </footer>

</div>
</body>
</html>`;
}

/** The single most valuable next action, chosen from the actual findings. */
function nextStep(audit: SiteAudit): string {
  const first = audit.findings[0];
  if (!first) {
    return 'Honestly, nothing urgent. The basics are covered, so effort is better spent on content and getting in front of more people than on the site itself.';
  }
  return `Start with "${first.title}". ${first.fix} That one change affects every visitor who lands on the site, so it pays back faster than anything else on this list.`;
}
