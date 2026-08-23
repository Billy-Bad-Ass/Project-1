import { findCategory, type Category } from './categories';
import { countryAt } from './countries';

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
  /**
   * From OSM's own tags, where the business published one.
   *
   * Not always present, and that is the point of collecting it: the businesses
   * that publish an email are the ones that can be contacted without a human
   * hunting through a contact page. The rest still need finding by hand.
   */
  email: string | null;
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
  /**
   * ISO country code to disambiguate. Place names repeat across countries —
   * "Bristol" alone matched Tennessee on a live run.
   */
  country?: string;
  limit?: number;
  endpoint?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
}

const DEFAULT_ENDPOINT = 'https://overpass-api.de/api/interpreter';

export interface AreaMatch {
  id: number;
  name: string;
  adminLevel: string | null;
  /** ISO country code where the area itself carries one. */
  country: string | null;
  /** Sub-country code such as GB-BST, where present. */
  region: string | null;
  /** A point inside the boundary, used to work out the country. */
  lat: number | null;
  lon: number | null;
  /**
   * Population, where the boundary carries it. The tie-breaker when two places
   * share a name *and* an administrative level — see `chooseArea`.
   */
  population: number | null;
  /** Human description for the log, e.g. "Bristol (GB, admin level 6)". */
  describe: string;
}

/**
 * Query to list every administrative area with a given name.
 *
 * Place names are not unique. A live run for "Bristol" returned a dentist in
 * Bristol, Tennessee — the query had matched whichever Bristol Overpass
 * happened to return first, and a whole outreach batch would have gone to the
 * wrong continent. Resolving the area explicitly, and saying out loud which
 * one was chosen, is the only way to make that visible.
 */
/** Regex-escape a place name so a stray character cannot alter the pattern. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Common administrative prefixes.
 *
 * Bristol UK is "City of Bristol" in OpenStreetMap, so an exact name match
 * found only the American Bristols — the live run returned fourteen of them
 * and not one from Britain. Councils, boroughs and counties all do this.
 */
const ADMIN_PREFIXES = [
  'City of', 'City and County of', 'Borough of', 'London Borough of',
  'Royal Borough of', 'Metropolitan Borough of', 'County Borough of',
  'County of', 'District of', 'Town of', 'Municipality of', 'Village of',
];

export function buildAreaQuery(area: string): string {
  const name = escapeRegex(area.trim()).replace(/["\\]/g, '');
  const prefixes = ADMIN_PREFIXES.map((p) => `${p} `).join('|');
  // Anchored on both ends so "Bristol" cannot match "Bristol Township" or
  // "New Bristol" — a loose match would quietly search the wrong place, which
  // is the failure mode this whole area-resolution step exists to prevent.
  const pattern = `^(${prefixes})?${name}$`;

  // Relations, not areas: an area is a derived object with no coordinates, and
  // coordinates are the only reliable way to tell fifteen Bristols apart.
  return `[out:json][timeout:30];
rel["name"~"${pattern}",i]["boundary"="administrative"];
out center tags;`;
}

export function parseAreas(raw: unknown): AreaMatch[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const elements = (raw as { elements?: unknown }).elements;
  if (!Array.isArray(elements)) return [];

  const areas: AreaMatch[] = [];
  for (const entry of elements) {
    const element = entry as {
      id?: number;
      tags?: Record<string, unknown>;
      center?: { lat?: number; lon?: number };
      lat?: number;
      lon?: number;
    };
    if (typeof element.id !== 'number' || !element.tags) continue;
    const tags = element.tags;

    const lat = element.center?.lat ?? element.lat;
    const lon = element.center?.lon ?? element.lon;

    // Tagged codes are trusted when present; they simply usually are not.
    const tagged =
      firstString(tags, 'ISO3166-1', 'ISO3166-1:alpha2') ??
      (firstString(tags, 'ISO3166-2')?.split('-')[0] ?? null);

    const located =
      typeof lat === 'number' && typeof lon === 'number' ? countryAt(lat, lon) : null;

    const country = tagged ?? located?.code ?? null;
    const name = firstString(tags, 'name') ?? '(unnamed)';
    const adminLevel = firstString(tags, 'admin_level');

    const populationTag = firstString(tags, 'population');
    const parsedPopulation = populationTag ? Number(populationTag.replace(/[^0-9]/g, '')) : NaN;
    const population = Number.isFinite(parsedPopulation) && parsedPopulation > 0 ? parsedPopulation : null;

    const parts = [country ?? 'country unknown'];
    if (adminLevel) parts.push(`admin level ${adminLevel}`);
    // Shown because admin level alone does not separate a Virginia independent
    // city from the county beside it — population is what tells them apart.
    if (population) parts.push(`pop. ${population.toLocaleString('en-US')}`);

    areas.push({
      // Overpass area ids are the relation id offset by 3.6 billion.
      id: 3_600_000_000 + element.id,
      name,
      adminLevel,
      country,
      region: firstString(tags, 'ISO3166-2'),
      lat: typeof lat === 'number' ? lat : null,
      lon: typeof lon === 'number' ? lon : null,
      population,
      describe: `${name} (${parts.join(', ')})`,
    });
  }

  return areas;
}

/**
 * Choose which of several same-named areas to search.
 *
 * Prefers an explicit country, then the largest administrative unit — a city
 * boundary yields far more businesses than a parish inside it.
 *
 * Admin level alone is not enough. In Virginia an independent city is a
 * county-equivalent, so the City of Fairfax and Fairfax County are both
 * admin level 6: a live run for "Fairfax" searched the city of 24,000 and
 * returned 2 dentists, where the county of 1.1 million returned 43. Where the
 * level ties, the larger population wins.
 */
export function chooseArea(areas: AreaMatch[], country?: string): AreaMatch | null {
  if (areas.length === 0) return null;

  const wanted = country?.trim().toUpperCase();
  const pool = wanted ? areas.filter((a) => a.country?.toUpperCase() === wanted) : areas;

  if (pool.length === 0) return null;

  return [...pool].sort((a, b) => {
    // Lower admin_level is a larger area. Unknown levels sort last.
    const levelA = a.adminLevel ? Number(a.adminLevel) : 99;
    const levelB = b.adminLevel ? Number(b.adminLevel) : 99;
    if (levelA !== levelB) return levelA - levelB;

    // Same level: the more populous place is the one someone naming a region
    // almost always means. An unknown population sorts last rather than first,
    // so a well-described small place never beats a well-described large one.
    return (b.population ?? -1) - (a.population ?? -1);
  })[0]!;
}

/**
 * Build the business query against an already-resolved area id.
 *
 * `["website"]` is doing real work here: it filters server-side to businesses
 * that actually have one, so we neither download nor sift through the majority
 * that do not. Searching nodes, ways and relations because a business may be
 * mapped as a point or as a building outline.
 */
export function buildQuery(category: Category, areaId: number, limit: number): string {
  const filters = category.tags
    .map((tag) => {
      const [key, value] = tag.split('=');
      return ['node', 'way', 'relation']
        .map((kind) => `  ${kind}["${key}"="${value}"]["website"](area.searchArea);`)
        .join('\n');
    })
    .join('\n');

  return `[out:json][timeout:60];
area(${areaId})->.searchArea;
(
${filters}
);
out center ${limit};`;
}

/**
 * An address only if it plausibly is one.
 *
 * OSM tags are typed by hand and this field arrives with `mailto:` prefixes,
 * two addresses separated by a semicolon, and occasionally a phone number.
 * A malformed address does not bounce — it is rejected by the API at send
 * time, which fails the whole batch rather than skipping one recipient.
 */
export function normaliseEmail(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(/[;,]/)[0] ?? '';
  const cleaned = first.trim().replace(/^mailto:/i, '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleaned)) return null;
  return cleaned.toLowerCase();
}

function firstString(tags: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = tags[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

/**
 * Domains that are never the business's own website.
 *
 * Two kinds, both useless as prospects for the same reason: a report about
 * them would be a report about somebody else's markup. A social page is
 * obvious. Directories are subtler and were only caught by a live run — an OSM
 * entry for a Bristol dentist pointed at an NHS listing page, and the draft
 * email opened by telling the dentist that nhs.uk was returning an error.
 */
const NOT_THEIR_SITE = [
  // Social
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com',
  'tiktok.com', 'youtube.com', 'wa.me', 'linktr.ee', 'pinterest.com',
  // Public sector and health directories
  'nhs.uk', 'gov.uk', 'find-and-update.company-information.service.gov.uk',
  // Trade and review directories
  'yell.com', 'yelp.com', 'yelp.co.uk', 'checkatrade.com', 'trustpilot.com',
  'thomsonlocal.com', 'freeindex.co.uk', 'ratedpeople.com', 'mybuilder.com',
  'bark.com', 'trustatrader.com', 'which.co.uk',
  // Booking and marketplace platforms
  'booking.com', 'tripadvisor.com', 'tripadvisor.co.uk', 'opentable.com',
  'justeat.co.uk', 'deliveroo.co.uk', 'ubereats.com', 'treatwell.co.uk',
  'fresha.com', 'doctolib.fr', 'zocdoc.com',
  // Site builders' default hosts: a parked or unfinished presence
  'wixsite.com', 'weebly.com', 'squarespace.com', 'business.site',
  'godaddysites.com', 'wordpress.com', 'blogspot.com',
];

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

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (NOT_THEIR_SITE.some((s) => host === s || host.endsWith(`.${s}`))) return null;

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
      email: normaliseEmail(firstString(tags, 'email', 'contact:email')),
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
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;

  const post = async (query: string): Promise<unknown> => {
    const response = await doFetch(endpoint, {
      method: 'POST',
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 90_000),
      headers: {
        'user-agent': 'SiteAuditBot/0.1 (business discovery; two queries per run)',
        accept: 'application/json',
      },
    });

    if (response.status === 429 || response.status === 504) {
      throw new Error(
        `Overpass is rate limiting or busy (HTTP ${response.status}). It is free, volunteer-run ` +
          `infrastructure — wait a minute and try again rather than retrying in a loop.`,
      );
    }
    if (!response.ok) throw new Error(`Overpass returned HTTP ${response.status}`);
    return response.json();
  };

  // Resolve the place first. Skipping this once sent a batch of UK outreach to
  // a dentist in Bristol, Tennessee.
  log(`Resolving "${options.area}"...`);
  const areas = parseAreas(await post(buildAreaQuery(options.area)));

  if (areas.length === 0) {
    throw new Error(
      `OpenStreetMap has no administrative area called "${options.area}".\n` +
        `Try the town, city or council name as it appears on a map.`,
    );
  }

  const chosen = chooseArea(areas, options.country);
  if (!chosen) {
    const seen = areas.map((a) => `  ${a.describe}`).join('\n');
    throw new Error(
      `Found "${options.area}", but none of them in country "${options.country}".\n` +
        `Areas with that name:\n${seen}`,
    );
  }

  if (areas.length > 1) {
    log(`  ${areas.length} places share that name. Using ${chosen.describe}.`);
    // Name the runners-up. "Using Fairfax" told us nothing when the choice was
    // between a city of 24,000 and the county of 1.1 million around it.
    const others = areas.filter((a) => a.id !== chosen.id).slice(0, 4);
    for (const other of others) log(`    also matched: ${other.describe}`);
    if (areas.length - 1 > others.length) {
      log(`    ...and ${areas.length - 1 - others.length} more`);
    }
    if (!options.country) {
      log('  Not the one you meant? Pass --country GB (or US, IE, ...) to pin it down.');
    }
  } else {
    log(`  ${chosen.describe}`);
  }

  log(`Looking for ${category.label.toLowerCase()} there...`);
  const prospects = parseElements(await post(buildQuery(category, chosen.id, limit)));
  log(`  ${prospects.length} with a website worth auditing`);

  if (prospects.length === 0) {
    log('');
    log(`  Nothing found. That trade may be thinly mapped in ${chosen.name},`);
    log('  or the area is smaller than you expect. Try the wider council or city name.');
  }

  return prospects;
}
