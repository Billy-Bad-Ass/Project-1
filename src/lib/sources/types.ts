/**
 * The contract every niche adapter implements. Swapping niches means writing
 * one new file that satisfies `DataSource` — the site, SEO layer, quality gate
 * and affiliate system are all niche-agnostic and need no changes.
 */

/** A purchasable/actionable destination. This is what gets monetised. */
export interface Offer {
  /** Merchant name as shown to the user, e.g. "Steam". */
  merchant: string;
  /** Raw destination URL, before affiliate decoration. */
  url: string;
  /** Numeric price in `currency`. Null when the merchant exposes no price. */
  price: number | null;
  /** List price before discount, used to render savings. */
  listPrice?: number | null;
  currency: string;
  /** 0-100. Derived, not trusted from the source. */
  discountPercent?: number | null;
  availability?: 'in_stock' | 'out_of_stock' | 'unknown';
}

/** A single fact rendered into the on-page specification table. */
export interface Fact {
  label: string;
  value: string | number;
  /** Optional unit suffix, e.g. "min" or "MB". */
  unit?: string;
}

/**
 * One item = one programmatic page. Adapters normalise their upstream API
 * into this shape; nothing downstream knows what the upstream API looked like.
 */
export interface SourceItem {
  /** Stable upstream identifier. Used for cache keys and dedupe. */
  id: string;
  /** URL path segment. Must be unique across the dataset. */
  slug: string;
  title: string;
  /** One or two sentences of genuinely item-specific text. */
  summary: string;
  facts: Fact[];
  offers: Offer[];
  /** Hub pages are generated from these. */
  categories: string[];
  image?: { url: string; alt: string } | null;
  /** ISO 8601. Drives `dateModified` and sitemap lastmod. */
  updatedAt: string;
  /**
   * Free-form extras an adapter wants on the page but that do not fit the
   * common shape (e.g. a price history series). Rendered by the adapter's
   * own optional detail component, ignored otherwise.
   */
  extra?: Record<string, unknown>;
  /** Populated by the optional Firecrawl enrichment pass. */
  enrichment?: Enrichment | null;
}

export interface Enrichment {
  sourceUrl: string;
  /** Short editorial excerpt, attributed and linked on the page. */
  excerpt: string;
  fetchedAt: string;
}

/** A hub/listicle page: "Best X", "Cheapest Y under $10". */
export interface Collection {
  slug: string;
  title: string;
  /** Item-specific intro text, not boilerplate. */
  description: string;
  /** Ordered item ids. */
  itemIds: string[];
}

export interface FetchContext {
  /** Cache-aware fetch. Adapters must use this, never global fetch. */
  get: (url: string, init?: RequestInit) => Promise<unknown>;
  /** Hard cap on items, honoured to keep free-tier usage bounded. */
  limit: number;
  log: (message: string) => void;
}

export interface DataSource {
  /** Matches `site.source`. */
  id: string;
  label: string;
  /** Human description of the vertical, used in generated docs. */
  vertical: string;
  /** Env var names required for live fetching. Empty means no key needed. */
  requiredEnv: string[];
  /** Attribution line the licence of the upstream API obliges us to show. */
  attribution: { text: string; url: string };
  fetchAll(ctx: FetchContext): Promise<SourceItem[]>;
  /** Derive hub pages from the fetched items. */
  buildCollections(items: SourceItem[]): Collection[];
}

/** What `npm run data:build` writes to disk and the site reads at build time. */
export interface Dataset {
  sourceId: string;
  generatedAt: string;
  attribution: { text: string; url: string };
  items: SourceItem[];
  collections: Collection[];
  /** Populated by the quality gate. */
  suppressed: { slug: string; title: string; reasons: string[] }[];
  /**
   * True when the dataset came from committed fixtures rather than a live
   * fetch. The site renders a visible notice in this mode so synthetic sample
   * prices can never be mistaken for real ones.
   */
  isFixture: boolean;
}
