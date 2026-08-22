import { site, type AffiliateNetwork, type SiteConfig } from '@config/site.config';

/**
 * Affiliate link decoration.
 *
 * Two rules this module enforces so they cannot be forgotten per-page:
 *   1. A link is decorated only when monetisation is switched on AND the
 *      network actually has credentials. A half-configured network emits a
 *      clean link rather than a broken tracking one.
 *   2. Every decorated link is marked `rel="sponsored nofollow"`, which is what
 *      search engines require for paid links, and every page carrying one must
 *      render the disclosure (enforced by `OfferTable`).
 *
 * The config is a parameter rather than a hard import so the rules can be
 * tested against fixture credentials without touching the environment.
 */

export interface DecoratedLink {
  href: string;
  rel: string;
  /** Null when the link is not monetised. */
  network: string | null;
}

/** Only the parts of the site config this module needs. */
export type AffiliateConfig = Pick<SiteConfig, 'monetisationEnabled' | 'affiliates'>;

function hostMatches(hostname: string, patterns: string[]): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  return patterns.some((pattern) => {
    const target = pattern.toLowerCase().replace(/^www\./, '');
    return host === target || host.endsWith(`.${target}`);
  });
}

/** A network is usable only if every configured param has a non-empty value. */
function isConfigured(network: AffiliateNetwork): boolean {
  if (network.template) return true;
  const entries = Object.entries(network.params ?? {});
  if (entries.length === 0) return false;
  return entries.every(([, value]) => value.trim() !== '');
}

export function findNetwork(url: string, config: AffiliateConfig = site): AffiliateNetwork | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return config.affiliates.find((network) => hostMatches(parsed.hostname, network.hosts)) ?? null;
}

export function decorate(url: string, config: AffiliateConfig = site): DecoratedLink {
  const plain: DecoratedLink = { href: url, rel: 'nofollow noopener', network: null };

  if (!config.monetisationEnabled) return plain;

  const network = findNetwork(url, config);
  if (!network || !isConfigured(network)) return plain;

  if (network.template) {
    return {
      href: network.template.replace('{url}', encodeURIComponent(url)),
      rel: 'sponsored nofollow noopener',
      network: network.disclosureName ?? network.label,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return plain;
  }

  for (const [key, value] of Object.entries(network.params ?? {})) {
    if (value.trim() === '') continue;
    parsed.searchParams.set(key, value);
  }

  return {
    href: parsed.toString(),
    rel: 'sponsored nofollow noopener',
    network: network.disclosureName ?? network.label,
  };
}

/** Networks actually used on a page, for the disclosure text. */
export function networksUsed(urls: string[], config: AffiliateConfig = site): string[] {
  const names = new Set<string>();
  for (const url of urls) {
    const network = decorate(url, config).network;
    if (network) names.add(network);
  }
  return [...names].sort();
}
