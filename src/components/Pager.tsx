import Link from 'next/link';

/**
 * Paginated navigation for the browse index.
 *
 * Prev/next links are real anchors rather than JS controls so crawlers can walk
 * the whole catalogue from /browse/ without executing anything.
 */
export function Pager({
  current,
  total,
  hrefFor,
}: {
  current: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  if (total <= 1) return null;

  return (
    <nav className="pager" aria-label="Pagination">
      {current > 1 ? (
        <Link href={hrefFor(current - 1)} rel="prev">
          ← Previous
        </Link>
      ) : (
        <span>← Previous</span>
      )}
      <span>
        Page {current} of {total}
      </span>
      {current < total ? (
        <Link href={hrefFor(current + 1)} rel="next">
          Next →
        </Link>
      ) : (
        <span>Next →</span>
      )}
    </nav>
  );
}

export default Pager;
