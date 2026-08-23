import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { draftFirstEmail, draftFollowUp, pickSignal, signalSpread } from './draft';
import type { Finding, SiteAudit } from '../lib/types';
import type { ComplianceConfig } from './compliance';

/**
 * Injected so these tests need no environment. Production reads the real
 * settings and refuses outright when they are absent — see compliance.test.ts.
 */
const compliance: ComplianceConfig = {
  postalAddress: '1 Example St, Springfield, IL 62701',
  optOut: { kind: 'reply', instruction: 'Reply "stop" and I will not contact you again.' },
};

function finding(ruleId: string, over: Partial<Finding> = {}): Finding {
  return {
    ruleId,
    severity: over.severity ?? 'critical',
    category: over.category ?? 'technical',
    title: over.title ?? 'Something is wrong',
    detail: over.detail ?? 'detail',
    impact: over.impact ?? 'This costs you customers in a specific and explainable way.',
    fix: over.fix ?? 'Do the thing.',
  };
}

function audit(findings: Finding[], url = 'https://acme-plumbing.co.uk/'): SiteAudit {
  return {
    url, finalUrl: url, fetchedAt: '2026-08-22T00:00:00.000Z',
    error: null, status: 200, loadMs: 300,
    findings, passed: [], healthScore: 40, opportunityScore: 80,
  };
}

test('the opener is something the owner can verify themselves', () => {
  // A canonical-tag finding is "worse" by our scoring but unverifiable by a
  // non-technical reader, so the phone problem must lead.
  const signal = pickSignal(
    audit([finding('canonical-url'), finding('contact-method')]),
  );
  assert.equal(signal?.ruleId, 'contact-method');
});

test('the email opens with a checkable fact, not a claim about expertise', () => {
  const draft = draftFirstEmail(audit([finding('mobile-viewport')]), { compliance });
  assert.ok(draft);
  assert.match(draft.body, /on my phone/i);
  assert.match(draft.body, /acme-plumbing\.co\.uk/);
});

test('the subject line is concrete rather than a marketing headline', () => {
  const draft = draftFirstEmail(audit([finding('https')]), { compliance });
  assert.ok(draft);
  assert.match(draft.subject, /acme-plumbing\.co\.uk/);
  // Anything that reads like a campaign gets filtered before a human sees it.
  assert.doesNotMatch(draft.subject, /free|!|urgent|boost|grow your|\$|%/i);
});

test('the first email promises exactly one follow-up, which is what happens', () => {
  const draft = draftFirstEmail(audit([finding('contact-method')]), { compliance });
  // The old copy said "no follow-up sales pitch from me" while draftFollowUp()
  // sat in the same file. Send both and the first email was a lie to someone
  // who never asked to hear from you.
  assert.match(draft!.body, /one short follow-up and then leave you alone/i);
  assert.doesNotMatch(draft!.body, /no follow-up/i);
});

test('a site with nothing wrong produces no draft at all', () => {
  assert.equal(draftFirstEmail(audit([]), { compliance }), null);
  assert.equal(draftFollowUp(audit([]), { compliance }), null);
});

test('the follow-up threads onto the original subject', () => {
  const first = draftFirstEmail(audit([finding('https')]), { compliance });
  const second = draftFollowUp(audit([finding('https')]), { compliance });
  assert.equal(second!.subject, `Re: ${first!.subject}`);
  assert.equal(second!.step, 2);
});

test('the follow-up explicitly says it is the last one', () => {
  const draft = draftFollowUp(audit([finding('mobile-viewport')]), { compliance });
  assert.match(draft!.body, /won't chase it again/i);
});

test('the drafts name the specific site, never a generic placeholder', () => {
  const draft = draftFirstEmail(audit([finding('response-time')], 'https://bobsgarage.com/'), { compliance });
  assert.match(draft!.body, /bobsgarage\.com/);
  assert.doesNotMatch(draft!.body, /\{\{|\[NAME\]|your business name/i);
});

test('a known contact name is used, and its absence stays neutral', () => {
  const named = draftFirstEmail(audit([finding('https')]), { contactName: 'Sam', compliance });
  assert.match(named!.body, /^Hi Sam,/);

  const anon = draftFirstEmail(audit([finding('https')]), { compliance });
  assert.match(anon!.body, /^Hi,/);
});

test('signalSpread reveals when every draft opens identically', () => {
  // 200 emails opening the same way is a template, however true each copy is.
  const drafts = Array.from({ length: 12 }, (_, i) =>
    draftFirstEmail(audit([finding('mobile-viewport')], `https://site${i}.com/`), { compliance })!,
  );
  const spread = signalSpread(drafts);
  assert.equal(spread.length, 1);
  assert.equal(spread[0]!.count, 12);
});

test('varied findings produce varied openers', () => {
  const drafts = [
    draftFirstEmail(audit([finding('mobile-viewport')], 'https://a.com/'), { compliance })!,
    draftFirstEmail(audit([finding('https')], 'https://b.com/'), { compliance })!,
    draftFirstEmail(audit([finding('contact-method')], 'https://c.com/'), { compliance })!,
  ];
  const spread = signalSpread(drafts);
  assert.equal(spread.length, 3);
  const openers = new Set(drafts.map((d) => d.body.split('\n')[2]));
  assert.equal(openers.size, 3, 'each opener should be a different sentence');
});

test('the signal and its consequence are separate paragraphs', () => {
  // Run together they read as one dense block and get skimmed past.
  const draft = draftFirstEmail(audit([finding('mobile-viewport')]), { compliance });
  const lines = draft!.body.split('\n');
  const signalLine = lines.findIndex((l) => /on my phone/i.test(l));
  assert.ok(signalLine > 0);
  assert.equal(lines[signalLine + 1], '', 'a blank line must follow the opener');
});
