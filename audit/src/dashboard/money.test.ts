import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { rows, type Snapshot } from './collect';
import { renderDashboard } from './render';

/**
 * A real Snapshot with no casts.
 *
 * Revenue reaches the dashboard through a contact's `paid` field, so that is
 * where the amount has to go. An earlier version of this test faked the shape
 * with `as unknown as Snapshot`; it compiled and then threw inside `funnel()`,
 * which is the whole argument against casting a fixture into place.
 */
function snapshotWith(revenue: number): Snapshot {
  return {
    generatedAt: '2026-08-23T12:00:00.000Z',
    prospects: [],
    audits: [],
    contacts: {
      'acme.co.uk': {
        host: 'acme.co.uk',
        sentAt: '2026-08-20',
        outcome: 'client',
        paid: revenue,
      },
    },
    orders: [],
    missing: [],
  };
}

function render(revenue: number): string {
  const snapshot = snapshotWith(revenue);
  return renderDashboard(snapshot, rows(snapshot));
}

function withCurrency(code: string | undefined, run: () => void): void {
  const before = process.env.AUDIT_CURRENCY;
  if (code === undefined) delete process.env.AUDIT_CURRENCY;
  else process.env.AUDIT_CURRENCY = code;
  try {
    run();
  } finally {
    if (before === undefined) delete process.env.AUDIT_CURRENCY;
    else process.env.AUDIT_CURRENCY = before;
  }
}

test('revenue is shown in the configured currency', () => {
  withCurrency('USD', () => assert.match(render(450), /\$450/));
  withCurrency('GBP', () => assert.match(render(450), /£450/));
});

test('a pound sign is never assumed', () => {
  // The old formatter hardcoded £, so a dollar sale rendered as £450 — the
  // number stayed right and the symbol lied, which is the worst shape of that
  // bug because nothing looks broken.
  withCurrency('USD', () => assert.doesNotMatch(render(450), /£/));
});

test('an unknown currency code degrades instead of taking the page down', () => {
  withCurrency('NOTACURRENCY', () => {
    assert.doesNotThrow(() => render(10));
    assert.match(render(10), /NOTACURRENCY/);
  });
});

test('no currency configured still renders', () => {
  withCurrency(undefined, () => assert.doesNotThrow(() => render(10)));
});
