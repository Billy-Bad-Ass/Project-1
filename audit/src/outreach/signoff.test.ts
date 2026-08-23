import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { signOff } from './draft';
import type { SenderConfig } from '../report/config';

const base: SenderConfig = {
  business: 'BBA Network',
  email: 'hello@example.com',
  offer: 'x',
  accent: '#2B5CE6',
};

test('a business trading under its own name signs once, not twice', () => {
  assert.deepEqual(signOff(base), ['BBA Network', 'hello@example.com']);
});

test('a personal name is added above the business', () => {
  assert.deepEqual(signOff({ ...base, name: 'Sam' }), [
    'Sam',
    'BBA Network',
    'hello@example.com',
  ]);
});

test('an absent name leaves no blank line', () => {
  // A blank line in a sign-off is where a placeholder used to be, and it looks
  // exactly like a mail-merge that failed.
  assert.ok(signOff(base).every((line) => line.trim() !== ''));
});

test('a name identical to the business is not repeated', () => {
  assert.deepEqual(signOff({ ...base, name: 'BBA Network' }), [
    'BBA Network',
    'hello@example.com',
  ]);
});

test('the email address is always last', () => {
  for (const from of [base, { ...base, name: 'Sam' }]) {
    assert.equal(signOff(from).at(-1), 'hello@example.com');
  }
});
