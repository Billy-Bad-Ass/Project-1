import { loadEnv } from './env';

loadEnv();

/**
 * The locale every customer-facing date, number and currency is formatted in.
 *
 * This exists because a date is not a neutral string. `08/09/2026` is the 8th
 * of September to a British reader and the 9th of August to an American one,
 * and a report that tells a stranger their site was reviewed on the wrong day
 * undermines the one thing the document is selling, which is that someone
 * competent looked carefully.
 *
 * One setting, read in one place, so the report, the dashboard and the money
 * formatter cannot drift apart.
 */
export function locale(): string {
  return process.env.AUDIT_LOCALE?.trim() || 'en-US';
}

/** ISO 4217 code used to label money already received. Converts nothing. */
export function currencyCode(): string {
  return process.env.AUDIT_CURRENCY?.trim().toUpperCase() || 'USD';
}

/** A date a customer reads, in their conventions rather than ours. */
export function formatDate(value: string | number | Date): string {
  return new Date(value).toLocaleDateString(locale(), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** A short date for dense contexts, where the long month will not fit. */
export function formatShortDate(value: string | number | Date): string {
  return new Date(value).toLocaleDateString(locale());
}

/** Date and time, for a "generated at" stamp. */
export function formatDateTime(value: string | number | Date): string {
  return new Date(value).toLocaleString(locale());
}

/**
 * Money, in the configured currency.
 *
 * An unrecognised code degrades to `CODE 450` rather than throwing: a
 * mistyped setting should not take down the page that reports how the
 * business is doing.
 */
export function formatMoney(amount: number): string {
  const currency = currencyCode();
  try {
    return new Intl.NumberFormat(locale(), {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString(locale())}`;
  }
}
