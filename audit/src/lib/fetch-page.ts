import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'node-html-parser';
import type { PageContext } from './types';

/**
 * Page fetcher.
 *
 * Built on what the earlier live runs in this repo taught the hard way:
 * Node's fetch has no timeout (an unresponsive host stalled a run for eleven
 * minutes), unthrottled requests get you blocked, and anything worth fetching
 * is worth caching so a re-run costs nothing.
 *
 * This one also has an obligation the other client did not: it is pointed at
 * strangers' servers rather than a public API. So it identifies itself
 * honestly, obeys robots.txt, and requests one page per site by default.
 */

const CACHE_DIR = join(process.cwd(), '.cache');

export interface FetchOptions {
  timeoutMs?: number;
  minIntervalMs?: number;
  ttlMs?: number;
  noCache?: boolean;
  userAgent?: string;
  log?: (message: string) => void;
}

const DEFAULTS = {
  timeoutMs: 15_000,
  minIntervalMs: 1_000, // one request per second per run: polite to small hosts
  ttlMs: 24 * 60 * 60 * 1000,
  userAgent:
    'SiteAuditBot/0.1 (+website audit tool; respects robots.txt; contact via the report sender)',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CachedResponse {
  url: string;
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  loadMs: number;
  fetchedAt: number;
}

function cachePath(url: string): string {
  return join(CACHE_DIR, `${createHash('sha256').update(url).digest('hex').slice(0, 32)}.json`);
}

export class PageFetcher {
  private lastRequestAt = 0;
  private opts: Required<Omit<FetchOptions, 'log'>> & { log: (m: string) => void };
  public stats = { fetched: 0, cached: 0, failed: 0 };

  constructor(options: FetchOptions = {}) {
    this.opts = {
      timeoutMs: options.timeoutMs ?? DEFAULTS.timeoutMs,
      minIntervalMs: options.minIntervalMs ?? DEFAULTS.minIntervalMs,
      ttlMs: options.ttlMs ?? DEFAULTS.ttlMs,
      noCache: options.noCache ?? false,
      userAgent: options.userAgent ?? DEFAULTS.userAgent,
      log: options.log ?? (() => {}),
    };
  }

  private async throttle(): Promise<void> {
    const waited = Date.now() - this.lastRequestAt;
    if (waited < this.opts.minIntervalMs) await sleep(this.opts.minIntervalMs - waited);
    this.lastRequestAt = Date.now();
  }

  private async readCache(url: string): Promise<CachedResponse | null> {
    if (this.opts.noCache) return null;
    try {
      const entry = JSON.parse(await readFile(cachePath(url), 'utf8')) as CachedResponse;
      return Date.now() - entry.fetchedAt > this.opts.ttlMs ? null : entry;
    } catch {
      return null;
    }
  }

  /** Raw text fetch, used for the page itself and for robots.txt. */
  async fetchRaw(url: string): Promise<CachedResponse> {
    const cached = await this.readCache(url);
    if (cached) {
      this.stats.cached += 1;
      return cached;
    }

    await this.throttle();
    const started = Date.now();

    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(this.opts.timeoutMs),
      headers: {
        'user-agent': this.opts.userAgent,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      },
    });

    const body = await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    const entry: CachedResponse = {
      url,
      finalUrl: response.url || url,
      status: response.status,
      headers,
      body,
      loadMs: Date.now() - started,
      fetchedAt: Date.now(),
    };

    if (!this.opts.noCache) {
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(cachePath(url), JSON.stringify(entry), 'utf8');
    }

    this.stats.fetched += 1;
    return entry;
  }

  /**
   * robots.txt, best effort. A site that blocks us is skipped rather than
   * scanned anyway — the report is a sales document, and starting the
   * relationship by ignoring their stated wishes is a bad opening move.
   */
  async fetchRobots(origin: string): Promise<string | null> {
    try {
      const res = await this.fetchRaw(`${origin}/robots.txt`);
      return res.status === 200 ? res.body : null;
    } catch {
      return null;
    }
  }

  async fetchPage(url: string): Promise<PageContext> {
    const res = await this.fetchRaw(url);
    const doc = parse(res.body, {
      lowerCaseTagName: true,
      comment: false,
      blockTextElements: { script: true, noscript: false, style: true, pre: true },
    });

    const origin = new URL(res.finalUrl).origin;
    const robotsTxt = await this.fetchRobots(origin);

    const links = doc.querySelectorAll('a[href]').map((a) => {
      const href = a.getAttribute('href') ?? '';
      let external = false;
      try {
        external = new URL(href, res.finalUrl).origin !== origin;
      } catch {
        external = false;
      }
      return { href, text: a.text.trim().slice(0, 120), external };
    });

    return {
      url,
      finalUrl: res.finalUrl,
      status: res.status,
      html: res.body,
      doc,
      headers: res.headers,
      bytes: Buffer.byteLength(res.body, 'utf8'),
      loadMs: res.loadMs,
      links,
      robotsTxt,
      sitemapUrl: findSitemap(robotsTxt, origin),
    };
  }
}

function findSitemap(robotsTxt: string | null, origin: string): string | null {
  if (robotsTxt) {
    const match = robotsTxt.match(/^\s*sitemap:\s*(\S+)/im);
    if (match?.[1]) return match[1];
  }
  // Not proof it exists — a later rule verifies it rather than assuming.
  return `${origin}/sitemap.xml`;
}

/**
 * Whether robots.txt permits us to fetch `path`.
 *
 * Deliberately conservative: this understands the common Disallow/Allow forms
 * and, on anything it cannot parse confidently, allows the fetch only when no
 * rule mentioned the path at all.
 */
export function robotsAllows(robotsTxt: string | null, path: string, agent = '*'): boolean {
  if (!robotsTxt) return true;

  const lines = robotsTxt.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim());
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;

  for (const line of lines) {
    const [rawKey, ...rest] = line.split(':');
    if (!rawKey || rest.length === 0) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();

    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === 'disallow' || key === 'allow') && current) {
      current.rules.push({ allow: key === 'allow', path: value });
      lastWasAgent = false;
    }
  }

  const applicable =
    groups.find((g) => g.agents.includes(agent.toLowerCase())) ??
    groups.find((g) => g.agents.includes('*'));
  if (!applicable) return true;

  // Longest matching rule wins, which is what the major crawlers implement.
  let decision: boolean | null = null;
  let longest = -1;
  for (const rule of applicable.rules) {
    if (rule.path === '') continue; // "Disallow:" with no value means allow all
    if (path.startsWith(rule.path) && rule.path.length > longest) {
      longest = rule.path.length;
      decision = rule.allow;
    }
  }

  return decision ?? true;
}
