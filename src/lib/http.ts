import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Disk-backed, rate-limited HTTP client.
 *
 * Free API tiers are the binding constraint on this whole project, so every
 * request goes through here: responses are cached to disk by URL, and requests
 * are spaced by a minimum interval. Re-running the pipeline after a partial
 * failure replays from cache instead of re-spending quota.
 */

const CACHE_DIR = join(process.cwd(), 'data', 'cache');

export interface HttpOptions {
  /** Minimum milliseconds between two outbound requests. */
  minIntervalMs?: number;
  /**
   * Per-request timeout. Node's fetch has none, so without this a single
   * unresponsive connection stalls the whole pipeline indefinitely.
   */
  timeoutMs?: number;
  /** How long a cached response stays fresh. */
  ttlMs?: number;
  /** Retry attempts for transient failures (429/5xx/network). */
  retries?: number;
  /** Skip the cache entirely. */
  noCache?: boolean;
  log?: (message: string) => void;
}

interface CacheEntry {
  url: string;
  fetchedAt: number;
  status: number;
  body: unknown;
}

const DEFAULTS = {
  minIntervalMs: 300,
  ttlMs: 12 * 60 * 60 * 1000, // 12h: store prices move daily, not hourly.
  retries: 3,
  timeoutMs: 20_000,
};

function cachePath(url: string): string {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 32);
  return join(CACHE_DIR, `${hash}.json`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class HttpClient {
  private lastRequestAt = 0;
  private opts: Required<Omit<HttpOptions, 'log'>> & { log: (m: string) => void };

  /** Counters surfaced in the build report so quota use stays visible. */
  public stats = { hits: 0, misses: 0, retries: 0, errors: 0, timeouts: 0 };

  constructor(options: HttpOptions = {}) {
    this.opts = {
      minIntervalMs: options.minIntervalMs ?? DEFAULTS.minIntervalMs,
      ttlMs: options.ttlMs ?? DEFAULTS.ttlMs,
      retries: options.retries ?? DEFAULTS.retries,
      timeoutMs: options.timeoutMs ?? DEFAULTS.timeoutMs,
      noCache: options.noCache ?? false,
      log: options.log ?? (() => {}),
    };
  }

  private async readCache(url: string): Promise<CacheEntry | null> {
    if (this.opts.noCache) return null;
    try {
      const raw = await readFile(cachePath(url), 'utf8');
      const entry = JSON.parse(raw) as CacheEntry;
      if (Date.now() - entry.fetchedAt > this.opts.ttlMs) return null;
      return entry;
    } catch {
      return null;
    }
  }

  private async writeCache(entry: CacheEntry): Promise<void> {
    if (this.opts.noCache) return;
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cachePath(entry.url), JSON.stringify(entry), 'utf8');
  }

  /** Space requests out so we never burst a free-tier rate limit. */
  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < this.opts.minIntervalMs) {
      await sleep(this.opts.minIntervalMs - elapsed);
    }
    this.lastRequestAt = Date.now();
  }

  async getJson(url: string, init?: RequestInit): Promise<unknown> {
    const cached = await this.readCache(url);
    if (cached) {
      this.stats.hits += 1;
      return cached.body;
    }
    this.stats.misses += 1;

    let lastError: unknown = null;

    for (let attempt = 0; attempt <= this.opts.retries; attempt += 1) {
      if (attempt > 0) {
        this.stats.retries += 1;
        // Exponential backoff: 1s, 2s, 4s. 429s in particular need real waits.
        const backoff = 1000 * 2 ** (attempt - 1);
        this.opts.log(`  retry ${attempt}/${this.opts.retries} in ${backoff}ms — ${url}`);
        await sleep(backoff);
      }

      await this.throttle();

      try {
        const response = await fetch(url, {
          ...init,
          // Without this a hung connection blocks the run forever; a timed-out
          // request is retried like any other transient failure.
          signal: AbortSignal.timeout(this.opts.timeoutMs),
          headers: {
            accept: 'application/json',
            'user-agent': 'pseo-forge/0.1 (+https://github.com/)',
            ...(init?.headers ?? {}),
          },
        });

        // 4xx other than 429 are permanent — retrying just burns quota.
        if (!response.ok && response.status !== 429 && response.status < 500) {
          throw new PermanentHttpError(`HTTP ${response.status} for ${url}`, response.status);
        }
        if (!response.ok) {
          lastError = new Error(`HTTP ${response.status} for ${url}`);
          continue;
        }

        const body: unknown = await response.json();
        await this.writeCache({ url, fetchedAt: Date.now(), status: response.status, body });
        return body;
      } catch (error) {
        if (error instanceof PermanentHttpError) {
          this.stats.errors += 1;
          throw error;
        }
        if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
          this.stats.timeouts += 1;
          this.opts.log(`  timeout after ${this.opts.timeoutMs}ms — ${url}`);
        }
        lastError = error;
      }
    }

    this.stats.errors += 1;
    throw new Error(
      `Request failed after ${this.opts.retries} retries: ${url} — ${String(lastError)}`,
    );
  }
}

export class PermanentHttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'PermanentHttpError';
  }
}
