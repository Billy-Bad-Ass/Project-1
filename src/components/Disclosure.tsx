import { site } from '@config/site.config';

/**
 * FTC-required affiliate disclosure.
 *
 * US rules require this to be clear, conspicuous and near the links it applies
 * to — not buried in a footer or a separate policy page. `OfferTable` renders
 * it automatically whenever it emits a monetised link, so a page cannot carry
 * a paid link without one.
 */
export function Disclosure({ networks }: { networks: string[] }) {
  if (networks.length === 0) return null;

  const list =
    networks.length === 1
      ? networks[0]
      : `${networks.slice(0, -1).join(', ')} and ${networks[networks.length - 1]}`;

  return (
    <p className="disclosure">
      <strong>Disclosure:</strong> {site.name} earns a commission if you buy through some of
      the links on this page ({list}). This never changes the price you pay, and it does not
      affect how stores are ranked here — listings are ordered by price alone.
    </p>
  );
}

export default Disclosure;
