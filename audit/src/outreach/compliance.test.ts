import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  complianceConfig,
  complianceFooter,
  complianceReady,
  MissingComplianceConfig,
  provenanceLine,
  type ComplianceConfig,
} from './compliance';
import { draftFirstEmail } from './draft';
import type { Finding, SiteAudit } from '../lib/types';
import type { SenderConfig } from '../report/config';

// AUDIT_SIGNATURE_IN_CLIENT belongs here even though it is not a compliance
// setting: it decides whether the footer is rendered into the body at all.
// Left uncleared, these tests inherit whatever the operator has in .env.local
// — green in CI, red on the machine where the drafts are actually written.
const KEYS = [
  'AUDIT_POSTAL_ADDRESS',
  'AUDIT_OPT_OUT_URL',
  'AUDIT_OPT_OUT_REPLY',
  'AUDIT_SIGNATURE_IN_CLIENT',
] as const;

function withEnv(values: Partial<Record<(typeof KEYS)[number], string>>, run: () => void): void {
  const before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const key of KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  try {
    run();
  } finally {
    for (const key of KEYS) {
      const previous = before[key];
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  }
}

const from: SenderConfig = {
  business: 'BBA Network',
  email: 'hello@example.com',
  offer: 'x',
  accent: '#2B5CE6',
};

const compliance: ComplianceConfig = {
  postalAddress: '1 Example St, Springfield, IL 62701',
  optOut: { kind: 'reply', instruction: 'Reply "stop" and I will not contact you again.' },
};

test('a missing postal address is refused, not defaulted', () => {
  // The address must be a real place that receives mail. Inventing one turns
  // an omission into a misrepresentation, which is strictly worse.
  withEnv({ AUDIT_OPT_OUT_REPLY: 'Reply stop.' }, () => {
    assert.throws(() => complianceConfig(), MissingComplianceConfig);
    assert.equal(complianceReady(), false);
  });
});

test('a missing opt-out is refused', () => {
  withEnv({ AUDIT_POSTAL_ADDRESS: '1 Example St' }, () => {
    assert.throws(() => complianceConfig(), MissingComplianceConfig);
  });
});

test('the error names every missing setting at once', () => {
  withEnv({}, () => {
    try {
      complianceConfig();
      assert.fail('expected a refusal');
    } catch (error) {
      const message = (error as Error).message;
      assert.match(message, /AUDIT_POSTAL_ADDRESS/);
      assert.match(message, /AUDIT_OPT_OUT/);
    }
  });
});

test('either opt-out method satisfies the requirement', () => {
  withEnv({ AUDIT_POSTAL_ADDRESS: '1 Example St', AUDIT_OPT_OUT_REPLY: 'Reply stop.' }, () => {
    assert.equal(complianceConfig().optOut.kind, 'reply');
  });
  withEnv(
    { AUDIT_POSTAL_ADDRESS: '1 Example St', AUDIT_OPT_OUT_URL: 'https://example.com/stop' },
    () => {
      assert.equal(complianceConfig().optOut.kind, 'url');
    },
  );
});

test('an empty string is treated as unset', () => {
  // `?? 'default'` does not fall back on '', and a blank env var is the most
  // common way a required setting silently goes missing.
  withEnv({ AUDIT_POSTAL_ADDRESS: '   ', AUDIT_OPT_OUT_REPLY: 'Reply stop.' }, () => {
    assert.throws(() => complianceConfig(), MissingComplianceConfig);
  });
});

test('the footer carries the sender, the address and the way out', () => {
  const footer = complianceFooter(from, compliance).join('\n');
  assert.match(footer, /BBA Network/);
  assert.match(footer, /Springfield, IL 62701/);
  assert.match(footer, /Reply "stop"/);
});

test('a URL opt-out is rendered as a usable link', () => {
  const footer = complianceFooter(from, {
    ...compliance,
    optOut: { kind: 'url', url: 'https://example.com/stop' },
  }).join('\n');
  assert.match(footer, /https:\/\/example\.com\/stop/);
});

test('the provenance line answers "how did you get my address"', () => {
  assert.match(provenanceLine('acme.com'), /acme\.com/);
  assert.match(provenanceLine('acme.com'), /listed publicly/i);
});

test('no draft exists at all without compliance settings', () => {
  // Refusing at draft time rather than send time is the whole point: a draft
  // that exists is a draft somebody eventually sends.
  const finding: Finding = {
    ruleId: 'https',
    severity: 'critical',
    category: 'trust',
    title: 'No HTTPS',
    detail: 'detail',
    impact: 'impact',
    fix: 'fix',
  };
  const audit: SiteAudit = {
    url: 'https://acme.com/',
    finalUrl: 'https://acme.com/',
    fetchedAt: '2026-08-23T00:00:00.000Z',
    error: null,
    status: 200,
    loadMs: 300,
    findings: [finding],
    passed: [],
    healthScore: 40,
    opportunityScore: 80,
  };

  withEnv({}, () => {
    assert.throws(() => draftFirstEmail(audit), MissingComplianceConfig);
  });
});

test('a real draft carries the footer', () => {
  const finding: Finding = {
    ruleId: 'https',
    severity: 'critical',
    category: 'trust',
    title: 'No HTTPS',
    detail: 'detail',
    impact: 'impact',
    fix: 'fix',
  };
  const audit: SiteAudit = {
    url: 'https://acme.com/',
    finalUrl: 'https://acme.com/',
    fetchedAt: '2026-08-23T00:00:00.000Z',
    error: null,
    status: 200,
    loadMs: 300,
    findings: [finding],
    passed: [],
    healthScore: 40,
    opportunityScore: 80,
  };

  withEnv({ AUDIT_SIGNATURE_IN_CLIENT: 'false' }, () => {
    const draft = draftFirstEmail(audit, { from, compliance });
    assert.ok(draft);
    assert.match(draft.body, /Springfield, IL 62701/);
    assert.match(draft.body, /Reply "stop"/);
    assert.match(draft.body, /listed publicly/i);
  });
});

test('with the signature in the client, the body drops the footer but never the provenance', () => {
  // The address and opt-out come from the Gmail signature in this mode, so
  // repeating them in the body would print them twice. The provenance line is
  // not part of the signature — it explains why this particular stranger is
  // being emailed — so it has to survive.
  const finding: Finding = {
    ruleId: 'https',
    severity: 'critical',
    category: 'trust',
    title: 'No HTTPS',
    detail: 'detail',
    impact: 'impact',
    fix: 'fix',
  };
  const audit: SiteAudit = {
    url: 'https://acme.com/',
    finalUrl: 'https://acme.com/',
    fetchedAt: '2026-08-23T00:00:00.000Z',
    error: null,
    status: 200,
    loadMs: 300,
    findings: [finding],
    passed: [],
    healthScore: 40,
    opportunityScore: 80,
  };

  withEnv({ AUDIT_SIGNATURE_IN_CLIENT: 'true' }, () => {
    const draft = draftFirstEmail(audit, { from, compliance });
    assert.ok(draft);
    assert.doesNotMatch(draft.body, /Springfield, IL 62701/);
    assert.match(draft.body, /listed publicly/i);
  });
});
