import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { site } from '@config/site.config';

/**
 * Post-build integrity check.
 *
 * Catches the failure modes that are invisible until a crawler finds them:
 * internal links pointing at pages that were never generated, indexable pages
 * missing from the sitemap, and pages with no way in.
 *
 *   npm run verify
 *
 * basePath aware: when the site is served from a sub-directory, hrefs in the
 * HTML carry the prefix but files on disk do not, so the prefix is stripped
 * before comparing. Getting this wrong would either flag every link as broken
 * or, worse, silently pass a site whose links all 404.
 */

const OUT = join(process.cwd(), 'out');

async function walk(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(full)));
    else found.push(full);
  }
  return found;
}

function routeOf(file: string): string {
  const rel = relative(OUT, file).split(sep).join('/');
  if (rel === 'index.html') return '/';
  return `/${rel.replace(/index\.html$/, '')}`;
}

/** Strip the deployment sub-directory prefix from an in-page href. */
function stripBasePath(href: string): string | null {
  if (site.basePath === '') return href;
  if (href === site.basePath) return '/';
  if (href.startsWith(`${site.basePath}/`)) return href.slice(site.basePath.length);
  // An internal link without the prefix will 404 on the deployed site.
  return null;
}

async function main(): Promise<void> {
  try {
    await stat(OUT);
  } catch {
    throw new Error(`No build output at ${OUT}. Run \`npm run build\` first.`);
  }

  const files = await walk(OUT);
  const htmlFiles = files.filter((file) => file.endsWith('.html'));
  const routes = new Set(htmlFiles.map(routeOf));
  const assets = new Set(files.map((file) => `/${relative(OUT, file).split(sep).join('/')}`));

  const linkSources = new Map<string, string>();
  const missingPrefix = new Map<string, string>();
  const linked = new Set<string>();
  let noindexCount = 0;

  for (const file of htmlFiles) {
    const html = await readFile(file, 'utf8');
    if (/<meta name="robots" content="noindex/.test(html)) noindexCount += 1;

    for (const match of html.matchAll(/href="(\/[^"#?]*)"/g)) {
      const raw = match[1]!;
      const href = stripBasePath(raw);
      if (href === null) {
        // Missing the prefix entirely — it would 404 once deployed.
        missingPrefix.set(raw, routeOf(file));
        continue;
      }
      if (href.startsWith('/_next')) continue;
      linked.add(href);
      if (!linkSources.has(href)) linkSources.set(href, routeOf(file));
    }
  }

  const broken = [...linked].filter((href) => !routes.has(href) && !assets.has(href));

  // Sitemap coverage.
  const sitemapFiles = files.filter((file) => /sitemap-\d+\.xml$/.test(file));
  const sitemapUrls = new Set<string>();
  for (const file of sitemapFiles) {
    const xml = await readFile(file, 'utf8');
    for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      try {
        const path = new URL(match[1]!).pathname;
        sitemapUrls.add(stripBasePath(path) ?? path);
      } catch {
        /* ignore malformed loc */
      }
    }
  }

  const indexableRoutes: string[] = [];
  for (const file of htmlFiles) {
    const html = await readFile(file, 'utf8');
    if (/<meta name="robots" content="noindex/.test(html)) continue;
    const route = routeOf(file);
    if (route.startsWith('/_not-found') || route === '/404/') continue;
    indexableRoutes.push(route);
  }
  const missingFromSitemap = indexableRoutes.filter((route) => !sitemapUrls.has(route));
  const noindexInSitemap = [...sitemapUrls].filter(
    (url) => routes.has(url) && !indexableRoutes.includes(url),
  );

  const lines: string[] = [];
  lines.push(`Base path:              ${site.basePath === '' ? '(root domain)' : site.basePath}`);
  lines.push(`Pages built:            ${routes.size}`);
  lines.push(`  indexable:            ${indexableRoutes.length}`);
  lines.push(`  noindex:              ${noindexCount}`);
  lines.push(`Sitemap chunks:         ${sitemapFiles.length}`);
  lines.push(`Sitemap URLs:           ${sitemapUrls.size}`);
  lines.push('');

  let failed = false;

  if (broken.length > 0) {
    failed = true;
    lines.push(`FAIL  ${broken.length} broken internal link(s):`);
    for (const href of broken.slice(0, 20)) {
      lines.push(`        ${href}   (linked from ${linkSources.get(href)})`);
    }
  } else {
    lines.push('OK    no broken internal links');
  }

  if (missingPrefix.size > 0) {
    failed = true;
    lines.push(`FAIL  ${missingPrefix.size} link(s) missing the "${site.basePath}" prefix:`);
    for (const [href, source] of [...missingPrefix].slice(0, 20)) {
      lines.push(`        ${href}   (in ${source})`);
    }
  } else if (site.basePath !== '') {
    lines.push(`OK    every internal link carries the "${site.basePath}" prefix`);
  }

  if (missingFromSitemap.length > 0) {
    failed = true;
    lines.push(`FAIL  ${missingFromSitemap.length} indexable page(s) missing from the sitemap:`);
    for (const route of missingFromSitemap.slice(0, 20)) lines.push(`        ${route}`);
  } else {
    lines.push('OK    every indexable page is in the sitemap');
  }

  if (noindexInSitemap.length > 0) {
    failed = true;
    lines.push(`FAIL  ${noindexInSitemap.length} noindex page(s) listed in the sitemap:`);
    for (const route of noindexInSitemap.slice(0, 20)) lines.push(`        ${route}`);
  } else {
    lines.push('OK    no noindex page appears in the sitemap');
  }

  // Orphans are reported, not failed: noindex pages are orphaned on purpose so
  // that previously-indexed URLs keep resolving instead of 404ing.
  const orphans = [...routes].filter(
    (route) => route !== '/' && !linked.has(route) && !route.startsWith('/_not-found'),
  );
  lines.push(
    `INFO  ${orphans.length} orphan page(s) — expected to be the noindex set (${noindexCount})`,
  );

  process.stdout.write(`${lines.join('\n')}\n`);
  if (failed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`verify failed: ${String(error)}\n`);
  process.exitCode = 1;
});
