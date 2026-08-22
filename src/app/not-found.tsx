import Link from 'next/link';

export default function NotFound() {
  return (
    <article className="prose">
      <h1>Page not found</h1>
      <p>
        That page does not exist. Titles come and go as stores delist them, so an old link may
        simply have expired.
      </p>
      <p>
        <Link href="/browse/">Browse everything</Link> or{' '}
        <Link href="/">start from the homepage</Link>.
      </p>
    </article>
  );
}
