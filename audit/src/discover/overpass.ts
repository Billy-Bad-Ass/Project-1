import { findCategory, type Category } from './categories';

/**
 * Finds real businesses via the OpenStreetMap Overpass API.
 *
 * Chosen because it is genuinely free — no key, no account, no card — and it
 * records the one field that makes a business auditable: its website. Google
 * Places and Yelp both want billing details for the same data.
 *
 * Overpass is volunteer-run infrastructure paid for by donations. This client
 * asks for one query per run, identifies itself, and caps what it requests.
 * Hammering it would get the whole approach blocked for everyone.
 */

export interface Prospect {
  name: string;
  website: string;
  phone: string | null;
  street: string | null;
  town: string | null;
  postcode: string | null;
  /** OSM element, for checking the source. */
  osmId: string;
}

export interface DiscoverOptions {
  category: string;
  /** Place name as OSM knows it: "Leeds", "Bristol", "Camden". */
  area: string;
  limit?: number;
  endpoint?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
}

const DEFAULT_ENDPOINT = 'https://overpass-api.de/api/interpreter';

/**
 * Build the Overpass QL query.
 *
 * `["website"]` is doing real work here: it filters server-side to businesses
 * that actually have one, so we neither download nor sift through the majority
 * that do not. Searching nodes, ways and relations because a business may be
 * mapped as a point or as a building outline.
 */
export function buildQuery(category: Category, area: string, limit: number): string {
  const safeArea = area.replace(/["\\]/g, '');
  const filters = category.tags
    .map((tag) => {
      const [key, value] = tag.split('=');
      return ['node', 'way', 'relation']
        .map((kind) => `  ${kind}["${key}"="${value}"]["website"](area.searchArea);`)
        .join('\n');
    })
    .join('\n');

  return `[out:json][timeout:60];
area["name"="${safeArea}"]["boundary"="administrative"]->.searchArea;
(
${filters}
);
out center ${limit};`;
}

function firstString(tags: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = tags[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

/**
 * Normalise a website value into something auditable.
 *
 * OSM website tags are entered by hand and are messy: bare domains, missing
 * schemes, "http://" on sites that moved to https years ago, and sometimes a
 * Facebook page instead of a website. Returns null for anything we cannot
 * usefully audit rather than passing junk down the pipeline.
 */
export function normaliseWebsite(raw: string | null): string | null {
  if (!raw) return null;
  let value = raw.trim().split(/[;,\s]/)[0] ?? '';
  if (value === '') return null;

  if (!/^https?:\/\//i.test(value)) {
    if (/^www\./i.test(value) || /^[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(value)) {
      value = `https://${value}`;
    } else {
      return null;
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  // A social page is not a website we can audit, and auditing one would
  // produce a report about Facebook's markup rather than the business.
  const SOCIAL = [
    'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com',
    'tiktok.com', 'youtube.com', 'wa.me', 'linktr.ee',
  ];
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (SOCIAL.some((s) => host === s || host.endsWith(`.${s}`))) return null;

  return parsed.toString();
}

interface OverpassElement {
  type: string;
  id: number;
  tags?: Record<string, unknown>;
}

export function parseElements(raw: unknown): Prospect[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const elements = (raw as { elements?: unknown }).elements;
  if (!Array.isArray(elements)) return [];

  const prospects: Prospect[] = [];
  const seenDomains = new Set<string>();

  for (const entry of elements) {
    const element = entry as OverpassElement;
    const tags = element.tags;
    if (!tags) continue;

    const website = normaliseWebsite(firstString(tags, 'website', 'contact:website', 'url'));
    const name = firstString(tags, 'name', 'operator');
    if (!website || !name) continue;

    // Chains map every branch separately. Auditing the same site twenty times
    // wastes the run and would send one owner twenty identical emails.
    const domain = new URL(website).hostname.replace(/^www\./, '').toLowerCase();
    if (seenDomains.has(domain)) continue;
    seenDomains.add(domain);

    prospects.push({
      name,
      website,
      phone: firstString(tags, 'phone', 'contact:phone'),
      street: firstString(tags, 'addr:street'),
      town: firstString(tags, 'addr:city', 'addr:town'),
      postcode: firstString(tags, 'addr:postcode'),
      osmId: `${element.type}/${element.id}`,
    });
  }

  return prospects;
}

export async function discoverProspects(options: DiscoverOptions): Promise<Prospect[]> {
  const category = findCategory(options.category);
  if (!category) {
    throw new Error(`Unknown business type "${options.category}". Run with --list to see the options.`);
  }

  const limit = Math.min(options.limit ?? 60, 300);
  const log = options.log ?? (() => {});
  const doFetch = options.fetchImpl ?? fetch;
  const query = buildQuery(category, options.area, limit);

  log(`Looking for ${category.label.toLowerCase()} in ${options.area}...`);

  const response = await doFetch(options.endpoint ?? DEFAULT_ENDPOINT, {
    method: 'POST',
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 90_000),
    headers: {
      'user-agent': 'SiteAuditBot/0.1 (business discovery; one query per run)',
      accept: 'application/json',
    },
  });

  if (response.status === 429 || response.status === 504) {
    throw new Error(
      `Overpass is rate limiting or busy (HTTP ${response.status}). It is free, volunteer-run ` +
        `infrastructure — wait a minute and try again rather than retrying in a loop.`,
    );
  }
  if (!response.ok) {
    throw new Error(`Overpass returned HTTP ${response.status}`);
  }

  const prospects = parseElements(await response.json());
  log(`  ${prospects.length} with a website worth auditing`);

  if (prospects.length === 0) {
    log('');
    log(`  Nothing found. Either "${options.area}" is not how OpenStreetMap names that area,`);
    log('  or that trade is thinly mapped there. Try the wider council or city name.');
  }

  return prospects;
}
