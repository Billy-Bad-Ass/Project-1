import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { decorate, findNetwork, networksUsed, type AffiliateConfig } from './affiliate';

/** Fanatical is fully configured; Green Man Gaming deliberately is not. */
const config: AffiliateConfig = {
  monetisationEnabled: true,
  affiliates: [
    {
      label: 'Fanatical',
      hosts: ['fanatical.com'],
      params: { ref: 'my-ref-id' },
      disclosureName: 'Fanatical',
    },
    {
      label: 'Green Man Gaming',
      hosts: ['greenmangaming.com'],
      params: { gmgpt: '' },
    },
    {
      label: 'Redirector Network',
      hosts: ['examplestore.com'],
      template: 'https://track.example.net/go?u={url}',
      disclosureName: 'Example Network',
    },
  ],
};

const disabled: AffiliateConfig = { ...config, monetisationEnabled: false };

test('a configured network gets its tracking param and a sponsored rel', () => {
  const link = decorate('https://www.fanatical.com/en/game/doom', config);
  assert.match(link.href, /ref=my-ref-id/);
  assert.match(link.rel, /sponsored/);
  assert.equal(link.network, 'Fanatical');
});

test('an unconfigured network emits a clean link, not a broken tracking one', () => {
  const link = decorate('https://www.greenmangaming.com/games/doom/', config);
  assert.equal(link.href, 'https://www.greenmangaming.com/games/doom/');
  assert.equal(link.network, null);
  assert.doesNotMatch(link.rel, /sponsored/);
});

test('an unrelated host is left alone', () => {
  const link = decorate('https://store.steampowered.com/app/379720/', config);
  assert.equal(link.href, 'https://store.steampowered.com/app/379720/');
  assert.equal(link.network, null);
});

test('monetisation disabled leaves every link undecorated', () => {
  const link = decorate('https://www.fanatical.com/en/game/doom', disabled);
  assert.equal(link.href, 'https://www.fanatical.com/en/game/doom');
  assert.equal(link.network, null);
});

test('subdomains of a configured host still match', () => {
  assert.notEqual(findNetwork('https://checkout.fanatical.com/cart', config), null);
});

test('a lookalike host does not match', () => {
  assert.equal(findNetwork('https://notfanatical.com/x', config), null);
});

test('a malformed url degrades to a plain link instead of throwing', () => {
  const link = decorate('not-a-url', config);
  assert.equal(link.href, 'not-a-url');
  assert.equal(link.network, null);
});

test('existing query parameters are preserved when decorating', () => {
  const link = decorate('https://www.fanatical.com/en/game/doom?utm_source=x', config);
  assert.match(link.href, /utm_source=x/);
  assert.match(link.href, /ref=my-ref-id/);
});

test('template networks wrap and url-encode the destination', () => {
  const link = decorate('https://examplestore.com/p/1?a=b', config);
  assert.equal(link.href, 'https://track.example.net/go?u=https%3A%2F%2Fexamplestore.com%2Fp%2F1%3Fa%3Db');
  assert.equal(link.network, 'Example Network');
});

test('networksUsed lists only genuinely monetised destinations', () => {
  const used = networksUsed(
    [
      'https://www.fanatical.com/en/game/doom',
      'https://store.steampowered.com/app/1',
      'https://www.greenmangaming.com/games/doom/',
      'https://examplestore.com/p/1',
    ],
    config,
  );
  assert.deepEqual(used, ['Example Network', 'Fanatical']);
});
