import { getDataset } from '@/lib/dataset';

/**
 * Shown on every page when the dataset came from committed fixtures.
 *
 * Sample prices are invented. Publishing them unlabelled would be presenting
 * fabricated commercial data as real, so the notice is not optional and is not
 * dismissible.
 */
export function FixtureNotice() {
  if (!getDataset().isFixture) return null;

  return (
    <div className="notice" role="status">
      <strong>Sample data — not real prices.</strong>
      This build uses synthetic fixtures so the site runs with no network access. Every title
      and price below is invented. Run <code>npm run data:build</code> without{' '}
      <code>--offline</code> to replace it with live data.
    </div>
  );
}

export default FixtureNotice;
