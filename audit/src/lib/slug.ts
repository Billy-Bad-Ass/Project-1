/**
 * Filename for a site's report.
 *
 * Includes the path when it is not the root. Keying on hostname alone silently
 * overwrote one report with another whenever a list contained two pages from
 * the same domain — the run reported both as audited and only one file existed.
 */
export function reportSlug(url: string): string {
  let host = url;
  let path = '';

  try {
    const parsed = new URL(url);
    host = parsed.hostname.replace(/^www\./, '');
    path = parsed.pathname.replace(/\/+$/, '');
  } catch {
    return url.replace(/[^a-z0-9.-]/gi, '-').slice(0, 100);
  }

  const suffix = path === '' ? '' : `-${path.replace(/^\//, '').replace(/\//g, '-')}`;
  return `${host}${suffix}`.replace(/[^a-z0-9.-]/gi, '-').slice(0, 100);
}
