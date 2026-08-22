/**
 * The single file you edit to point this engine at a different niche,
 * domain, or set of affiliate accounts. Everything else reads from here.
 */

export interface AffiliateNetwork {
  /** Human label shown in the UI. */
  label: string;
  /**
   * Hostnames this network covers. A destination URL is decorated only if
   * its hostname matches one of these (suffix match, so `store.com` also
   * matches `www.store.com`).
   */
  hosts: string[];
  /** Query parameters appended to outgoing links, e.g. `{ tag: 'mysite-20' }`. */
  params?: Record<string, string>;
  /**
   * Optional wrapper. `{url}` is replaced with the URL-encoded destination.
   * Use for networks that route through their own redirector.
   */
  template?: string;
  /** Shown in the per-page disclosure when this network is used. */
  disclosureName?: string;
}

export interface SiteConfig {
  name: string;
  tagline: string;
  /** Absolute origin, no trailing slash. Used for canonicals and sitemaps. */
  url: string;
  /**
   * Sub-directory the site is served from, e.g. `/my-repo` on GitHub Pages
   * project sites. Empty for a root domain, which is what you want for a real
   * site. Must start with `/` and not end with one.
   */
  basePath: string;
  description: string;
  locale: string;
  /** Which adapter in src/lib/sources drives the site. */
  source: string;
  /** Owner name used in the FTC disclosure and copyright line. */
  operator: string;
  contactEmail: string;
  affiliates: AffiliateNetwork[];
  /**
   * Set false until you actually hold affiliate accounts. When false, outgoing
   * links stay clean and undecorated but the site still builds and ranks.
   */
  monetisationEnabled: boolean;
  /** Pages per sitemap chunk. Google's hard limit is 50,000. */
  sitemapChunkSize: number;
}

/**
 * Read an environment variable, treating empty and whitespace-only as unset.
 *
 * `??` is not enough here. CI passes an unset repository variable through as
 * an empty string rather than omitting it, so `process.env.X ?? 'default'`
 * yields '' and the default never applies — which failed the very first deploy
 * at the dataset step with `Unknown source ""`.
 */
function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

/**
 * A malformed basePath breaks every link and asset on the deployed site while
 * building perfectly locally, so normalise rather than trust the environment.
 */
export { env as readEnv };

export function normaliseBasePath(raw: string | undefined): string {
  const value = (raw ?? '').trim();
  if (value === '' || value === '/') return '';
  const withLeading = value.startsWith('/') ? value : `/${value}`;
  return withLeading.replace(/\/+$/, '');
}

export const site: SiteConfig = {
  name: 'Deal Ledger',
  tagline: 'Live game prices across every major PC store',
  url: (env('SITE_URL') ?? 'https://example.com').replace(/\/+$/, ''),
  basePath: normaliseBasePath(env('BASE_PATH')),
  description:
    'Track current and historical prices for PC games across Steam, GOG, Humble, Fanatical and more. Updated daily from live store data.',
  locale: 'en-US',
  source: env('SITE_SOURCE') ?? 'cheapshark',
  operator: 'Deal Ledger',
  contactEmail: 'hello@example.com',
  monetisationEnabled: env('AFFILIATES_ENABLED') === 'true',
  sitemapChunkSize: 5000,

  affiliates: [
    // Fill these in once you are accepted into each programme, then set
    // AFFILIATES_ENABLED=true. Until then links are emitted undecorated.
    {
      label: 'Fanatical',
      hosts: ['fanatical.com'],
      params: { ref: env('AFF_FANATICAL') ?? '' },
      disclosureName: 'Fanatical',
    },
    {
      label: 'Green Man Gaming',
      hosts: ['greenmangaming.com'],
      params: { gmgpt: env('AFF_GMG') ?? '' },
      disclosureName: 'Green Man Gaming',
    },
    {
      label: 'Humble Bundle',
      hosts: ['humblebundle.com'],
      params: { partner: env('AFF_HUMBLE') ?? '' },
      disclosureName: 'Humble Bundle',
    },
  ],
};

export default site;
