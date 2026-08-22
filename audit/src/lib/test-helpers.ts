import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'node-html-parser';
import type { PageContext } from './types';

/** Build a PageContext from fixture HTML, without touching the network. */
export function pageFrom(
  html: string,
  overrides: Partial<PageContext> = {},
): PageContext {
  const doc = parse(html, { lowerCaseTagName: true, comment: false });
  const finalUrl = overrides.finalUrl ?? 'https://example.com/';
  const origin = new URL(finalUrl).origin;

  const links = doc.querySelectorAll('a[href]').map((a) => {
    const href = a.getAttribute('href') ?? '';
    let external = false;
    try {
      external = new URL(href, finalUrl).origin !== origin;
    } catch {
      external = false;
    }
    return { href, text: a.text.trim(), external };
  });

  return {
    url: finalUrl,
    finalUrl,
    status: 200,
    html,
    doc,
    headers: {},
    bytes: Buffer.byteLength(html, 'utf8'),
    loadMs: 200,
    links,
    robotsTxt: null,
    sitemapUrl: null,
    ...overrides,
  };
}

export function fixture(name: string): string {
  return readFileSync(join(process.cwd(), 'fixtures', name), 'utf8');
}
