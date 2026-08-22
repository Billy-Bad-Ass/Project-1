import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { site } from '@config/site.config';
import { getDataset } from '../lib/dataset';
import { chunk } from '../lib/util';
import { browseHref, PAGE_SIZE, pageCount } from '../lib/pagination';

/**
 * Post-build sitemap generation.
 *
 * Written directly into ./out after `next build` rather than through the
 * framework's sitemap convention, because a catalogue this shape needs a real
 * sitemap *index* with chunked children, and needs to exclude noindex pages —
 * neither of which the convention gives us cleanly under static export.
 *
 * Rules enforced here:
 *   - only indexable pages are listed (a noindex URL in a sitemap is a
 *     contradictory signal and wastes crawl budget)
 *   - chunks stay under the 50,000-URL / 50MB limit
 *   - lastmod reflects real dataset time, not build time
 */

const OUT = join(process.cwd(), 'out');

interface UrlEntry {
  loc: string;
  lastmod: string;
  changefreq?: string;
  priority?: string;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function absolute(path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${site.url}${site.basePath}${clean.endsWith('/') ? clean : `${clean}/`}`;
}

function renderUrlset(entries: UrlEntry[]): string {
  const urls = entries
    .map((entry) => {
      const parts = [
        `    <loc>${escapeXml(entry.loc)}</loc>`,
        `    <lastmod>${entry.lastmod}</lastmod>`,
      ];
      if (entry.changefreq) parts.push(`    <changefreq>${entry.changefreq}</changefreq>`);
      if (entry.priority) parts.push(`    <priority>${entry.priority}</priority>`);
      return `  <url>\n${parts.join('\n')}\n  </url>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function renderIndex(files: { loc: string; lastmod: string }[]): string {
  const entries = files
    .map(
      (file) =>
        `  <sitemap>\n    <loc>${escapeXml(file.loc)}</loc>\n    <lastmod>${file.lastmod}</lastmod>\n  </sitemap>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>\n`;
}

async function main(): Promise<void> {
  const dataset = getDataset();
  const lastmod = dataset.generatedAt.slice(0, 10);

  // Only pages that are actually indexable. See src/lib/quality.ts.
  const indexable = dataset.items.filter((item) => item.offers.length > 0);

  const staticEntries: UrlEntry[] = [
    { loc: absolute('/'), lastmod, changefreq: 'daily', priority: '1.0' },
    { loc: absolute('/browse/'), lastmod, changefreq: 'daily', priority: '0.7' },
    { loc: absolute('/best/'), lastmod, changefreq: 'weekly', priority: '0.8' },
    { loc: absolute('/about/'), lastmod, changefreq: 'yearly', priority: '0.3' },
  ];

  const browsePages = pageCount(indexable.length, PAGE_SIZE);
  for (let page = 2; page <= browsePages; page += 1) {
    staticEntries.push({
      loc: absolute(browseHref(page)),
      lastmod,
      changefreq: 'daily',
      priority: '0.4',
    });
  }

  const collectionEntries: UrlEntry[] = dataset.collections.map((collection) => ({
    loc: absolute(`/best/${collection.slug}/`),
    lastmod,
    changefreq: 'daily',
    priority: '0.8',
  }));

  const itemEntries: UrlEntry[] = indexable.map((item) => ({
    loc: absolute(`/p/${item.slug}/`),
    lastmod: item.updatedAt.slice(0, 10),
    changefreq: 'daily',
    priority: '0.6',
  }));

  const all = [...staticEntries, ...collectionEntries, ...itemEntries];
  const chunks = chunk(all, Math.min(site.sitemapChunkSize, 50000));

  await mkdir(OUT, { recursive: true });

  const files: { loc: string; lastmod: string }[] = [];
  for (const [index, entries] of chunks.entries()) {
    const name = `sitemap-${index + 1}.xml`;
    await writeFile(join(OUT, name), renderUrlset(entries), 'utf8');
    files.push({ loc: `${site.url}${site.basePath}/${name}`, lastmod });
  }

  await writeFile(join(OUT, 'sitemap.xml'), renderIndex(files), 'utf8');

  process.stdout.write(
    `Sitemap: ${all.length} urls across ${files.length} chunk(s), index at out/sitemap.xml\n`,
  );

  const excluded = dataset.items.length - indexable.length;
  if (excluded > 0) {
    process.stdout.write(`  ${excluded} noindex page(s) deliberately excluded\n`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`sitemap generation failed: ${String(error)}\n`);
  process.exitCode = 1;
});
