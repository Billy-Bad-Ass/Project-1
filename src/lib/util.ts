/** Small shared helpers. Kept dependency-free on purpose. */

/** URL-safe slug. Collisions are resolved by `uniqueSlug`. */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining accents
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

/**
 * Deterministic unique slug. Duplicate titles are common in catalogue data
 * (re-releases, regional editions), and a slug collision would silently drop
 * a page during static export, so disambiguate explicitly.
 */
export function uniqueSlug(base: string, taken: Set<string>, fallback: string): string {
  const root = slugify(base) || slugify(fallback) || 'item';
  if (!taken.has(root)) {
    taken.add(root);
    return root;
  }
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${root}-${n}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  const last = `${root}-${fallback}`;
  taken.add(last);
  return last;
}

/** Parse a possibly-string numeric field. Returns null for junk. */
export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function formatPrice(amount: number, currency = 'USD', locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(iso: string, locale = 'en-US'): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** Discount percent from list/sale pair, clamped and rounded. */
export function discountPercent(list: number | null, sale: number | null): number | null {
  if (list === null || sale === null || list <= 0 || sale < 0 || sale > list) return null;
  return Math.round(((list - sale) / list) * 100);
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new Error('chunk size must be positive');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Type guard for plain objects returned by untyped JSON APIs. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
