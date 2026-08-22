import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { pageFrom, fixture } from '../lib/test-helpers';
import { scoreFindings, sortFindings } from '../lib/audit';
import { ALL_RULES } from './index';
import type { Finding } from '../lib/types';

function runAll(html: string, overrides = {}): Finding[] {
  const page = pageFrom(html, overrides);
  return ALL_RULES.flatMap((rule) => rule.check(page));
}

const ids = (findings: Finding[]) => new Set(findings.map((f) => f.ruleId));

/* ---------------------------- the bad site ---------------------------- */

test('a neglected site produces the findings that matter', () => {
  const found = ids(runAll(fixture('terrible.html')));

  // The expensive ones, which are the reason to send the audit at all.
  assert.ok(found.has('mobile-viewport'), 'should catch missing viewport');
  assert.ok(found.has('indexability'), 'should catch noindex');
  assert.ok(found.has('title-tag'), 'should catch missing title');
  assert.ok(found.has('meta-description'), 'should catch missing description');
  assert.ok(found.has('heading-structure'), 'should catch missing h1');
  assert.ok(found.has('contact-method'), 'should catch unlinked phone number');
  assert.ok(found.has('image-alt'), 'should catch missing alt text');
  assert.ok(found.has('form-labels'), 'should catch unlabelled fields');
  assert.ok(found.has('html-lang'), 'should catch missing lang');
  assert.ok(found.has('script-count'), 'should catch render-blocking scripts');
  assert.ok(found.has('structured-data'), 'should catch absent structured data');
});

test('a phone number in text but not linked is reported as a mobile problem', () => {
  const findings = runAll(fixture('terrible.html'));
  const contact = findings.find((f) => f.ruleId === 'contact-method');
  assert.ok(contact);
  assert.match(contact.title, /tapped/i);
  assert.match(contact.evidence ?? '', /01234/);
});

/* ---------------------------- the good site ---------------------------- */

test('a well-built site produces no critical or high findings', () => {
  const findings = runAll(fixture('good.html'));
  const serious = findings.filter((f) => f.severity === 'critical' || f.severity === 'high');
  assert.deepEqual(
    serious.map((f) => `${f.ruleId}: ${f.title}`),
    [],
    'a good site should not be told it is broken',
  );
});

test('the good site is scored as healthy and as a poor sales lead', () => {
  const findings = runAll(fixture('good.html'));
  const { health, opportunity } = scoreFindings(findings);
  assert.ok(health >= 85, `expected a high health score, got ${health}`);
  assert.ok(opportunity <= 30, `expected a low opportunity score, got ${opportunity}`);
});

test('the neglected site is scored as unhealthy and as a strong sales lead', () => {
  const findings = runAll(fixture('terrible.html'));
  const { health, opportunity } = scoreFindings(findings);
  assert.ok(health <= 25, `expected a low health score, got ${health}`);
  assert.ok(opportunity >= 80, `expected a high opportunity score, got ${opportunity}`);
});

/* ---------------------------- specific rules ---------------------------- */

test('http pages are flagged as insecure, https ones are not', () => {
  const insecure = runAll('<html><body>hi</body></html>', {
    finalUrl: 'http://example.com/',
  });
  assert.ok(ids(insecure).has('https'));

  const secure = runAll('<html><body>hi</body></html>', {
    finalUrl: 'https://example.com/',
  });
  const httpsFinding = [...secure].find((f) => f.ruleId === 'https');
  assert.equal(httpsFinding, undefined);
});

test('zoom-blocking viewports are caught, correct ones are not', () => {
  const blocked = runAll(
    '<html><head><meta name="viewport" content="width=device-width, user-scalable=no"></head><body></body></html>',
  );
  const finding = [...blocked].find((f) => f.ruleId === 'mobile-viewport');
  assert.ok(finding);
  assert.match(finding.title, /zoom/i);

  const fine = runAll(
    '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>',
  );
  assert.equal([...fine].find((f) => f.ruleId === 'mobile-viewport'), undefined);
});

test('invalid structured data is reported differently from absent structured data', () => {
  const broken = runAll(
    '<html><head><script type="application/ld+json">{not json}</script></head><body></body></html>',
  );
  const finding = [...broken].find((f) => f.ruleId === 'structured-data');
  assert.ok(finding);
  assert.match(finding.title, /invalid/i);
});

test('a label wrapping an input counts as labelled', () => {
  const findings = runAll(
    '<html><body><form><label>Email <input type="text" name="e"></label></form></body></html>',
  );
  assert.equal([...findings].find((f) => f.ruleId === 'form-labels'), undefined);
});

test('a decorative image with empty alt is not reported as missing alt', () => {
  const findings = runAll('<html><body><img src="/a.png" alt=""></body></html>');
  assert.equal([...findings].find((f) => f.ruleId === 'image-alt'), undefined);
});

test('a slow server response is reported with the measured time', () => {
  const findings = runAll('<html><body></body></html>', { loadMs: 4200 });
  const finding = [...findings].find((f) => f.ruleId === 'response-time');
  assert.ok(finding);
  assert.equal(finding.severity, 'high');
  assert.match(finding.detail, /4\.2 seconds/);
});

test('a site-wide robots.txt block is treated as critical', () => {
  const findings = runAll('<html><body></body></html>', {
    robotsTxt: 'User-agent: *\nDisallow: /',
  });
  const finding = [...findings].find(
    (f) => f.ruleId === 'indexability' && /whole site/i.test(f.title),
  );
  assert.ok(finding);
  assert.equal(finding.severity, 'critical');
});

/* ---------------------------- contract ---------------------------- */

test('every finding explains its business impact and a concrete fix', () => {
  // The rule that keeps this tool from degrading into a checklist printer.
  const findings = [...runAll(fixture('terrible.html')), ...runAll(fixture('good.html'))];
  assert.ok(findings.length > 0);

  for (const f of findings) {
    assert.ok(f.impact.length > 40, `${f.ruleId} has no real impact statement`);
    assert.ok(f.fix.length > 20, `${f.ruleId} has no actionable fix`);
    assert.ok(f.title.length > 0, `${f.ruleId} has no title`);
    assert.ok(!/[A-Z]{4,}/.test(f.title), `${f.ruleId} title shouts jargon: ${f.title}`);
  }
});

test('findings sort by severity, worst first', () => {
  const sorted = sortFindings(runAll(fixture('terrible.html')));
  const order = ['critical', 'high', 'medium', 'low'];
  let last = -1;
  for (const f of sorted) {
    const idx = order.indexOf(f.severity);
    assert.ok(idx >= last, 'findings are out of severity order');
    last = idx;
  }
});

test('rule ids are unique', () => {
  const seen = new Set<string>();
  for (const rule of ALL_RULES) {
    assert.ok(!seen.has(rule.id), `duplicate rule id: ${rule.id}`);
    seen.add(rule.id);
  }
});

test('the health score degrades smoothly instead of snapping to zero', () => {
  // A linear scale hit exactly 0 on any neglected site, which reads as a
  // broken gauge. Distinct levels of bad must stay distinguishable.
  const clean = scoreFindings([]).health;
  const oneLow = scoreFindings([mkFinding('low')]).health;
  const oneCritical = scoreFindings([mkFinding('critical')]).health;
  const many = scoreFindings(Array.from({ length: 12 }, () => mkFinding('critical'))).health;

  assert.equal(clean, 100);
  assert.ok(oneLow > oneCritical, 'a low finding should cost less than a critical one');
  assert.ok(oneCritical > many, 'twelve criticals should score worse than one');
  assert.ok(many >= 1, 'the score should never bottom out at zero');
});

function mkFinding(severity: 'critical' | 'high' | 'medium' | 'low'): Finding {
  return {
    ruleId: 'x',
    severity,
    category: 'technical',
    title: 't',
    detail: 'd',
    impact: 'i',
    fix: 'f',
  };
}
