import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { countryAt } from './countries';

test('the two Bristols land in different countries', () => {
  // This is the whole reason the module exists.
  assert.equal(countryAt(51.4545, -2.5879)?.code, 'GB');   // Bristol, England
  assert.equal(countryAt(36.5951, -82.1887)?.code, 'US');  // Bristol, Tennessee
});

test('overlapping boxes resolve to the more specific country', () => {
  // Ireland sits inside the generous UK box; the smaller claim should win.
  assert.equal(countryAt(53.3498, -6.2603)?.code, 'IE');   // Dublin
});

test('common places resolve correctly', () => {
  assert.equal(countryAt(53.8008, -1.5491)?.code, 'GB');   // Leeds
  assert.equal(countryAt(-33.8688, 151.2093)?.code, 'AU'); // Sydney
  assert.equal(countryAt(48.8566, 2.3522)?.code, 'FR');    // Paris
  assert.equal(countryAt(52.52, 13.405)?.code, 'DE');      // Berlin
});

test('somewhere unmapped yields null rather than a wrong guess', () => {
  assert.equal(countryAt(0, -140), null); // middle of the Pacific
});
