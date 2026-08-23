/**
 * An in-memory stand-in for KV, faithful in the two ways the code depends on.
 *
 * It stores metadata separately from the value, because `list()` returning
 * metadata is the whole reason the suppression export is one call rather than
 * one call per entry — a fake that folded them together would let a broken
 * export pass. And it honours `expirationTtl`, because the order ledger's
 * idempotency marker relies on expiry being a real thing that happens.
 */

interface Record_ {
  value: string;
  metadata?: unknown;
  expiresAt?: number;
}

export class FakeKV {
  private readonly data = new Map<string, Record_>();
  private now: number;

  constructor(now = Date.now()) {
    this.now = now;
  }

  /** Moves the clock so expiry can be tested without waiting for it. */
  advance(seconds: number): void {
    this.now += seconds * 1000;
  }

  private live(key: string): Record_ | undefined {
    const record = this.data.get(key);
    if (!record) return undefined;
    if (record.expiresAt !== undefined && record.expiresAt <= this.now) {
      this.data.delete(key);
      return undefined;
    }
    return record;
  }

  async get(key: string, type?: 'text' | 'json'): Promise<unknown> {
    const record = this.live(key);
    if (!record) return null;
    if (type === 'json') {
      try {
        return JSON.parse(record.value);
      } catch {
        return null;
      }
    }
    return record.value;
  }

  async put(
    key: string,
    value: string,
    options?: { metadata?: unknown; expirationTtl?: number },
  ): Promise<void> {
    this.data.set(key, {
      value,
      metadata: options?.metadata,
      ...(options?.expirationTtl !== undefined
        ? { expiresAt: this.now + options.expirationTtl * 1000 }
        : {}),
    });
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    keys: Array<{ name: string; metadata?: unknown }>;
    list_complete: boolean;
    cursor?: string;
  }> {
    const prefix = options?.prefix ?? '';
    const names = [...this.data.keys()].filter((name) => name.startsWith(prefix)).sort();

    const live = names.filter((name) => this.live(name) !== undefined);
    // Paginates for real, so a caller that ignores the cursor is caught by a
    // test rather than by a suppression list that silently stops at page one.
    const limit = options?.limit ?? 1000;
    const start = options?.cursor ? Number(options.cursor) : 0;
    const page = live.slice(start, start + limit);
    const end = start + page.length;

    return {
      keys: page.map((name) => ({ name, metadata: this.data.get(name)?.metadata })),
      list_complete: end >= live.length,
      ...(end < live.length ? { cursor: String(end) } : {}),
    };
  }

  /** Test-only: how many keys are stored, ignoring expiry. */
  get size(): number {
    return this.data.size;
  }
}

/** The fake satisfies the parts of KVNamespace this Worker uses. */
export function asKv(fake: FakeKV): KVNamespace {
  return fake as unknown as KVNamespace;
}
