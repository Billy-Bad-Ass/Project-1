import { decorate, networksUsed } from '@/lib/affiliate';
import { formatPrice } from '@/lib/util';
import type { Offer } from '@/lib/sources/types';
import Disclosure from './Disclosure';

/**
 * The monetised surface of the site.
 *
 * Offers are always ordered by price, never by commission — that ordering is
 * what the disclosure promises the reader, and breaking it would make the
 * disclosure a false statement.
 */
export function OfferTable({ offers, itemTitle }: { offers: Offer[]; itemTitle: string }) {
  if (offers.length === 0) {
    return (
      <p className="updated">
        No store currently lists {itemTitle} at a price we can verify. This page is excluded
        from search indexing until one does.
      </p>
    );
  }

  const sorted = [...offers].sort((a, b) => {
    if (a.price === null && b.price === null) return a.merchant.localeCompare(b.merchant);
    if (a.price === null) return 1;
    if (b.price === null) return -1;
    return a.price - b.price;
  });

  const networks = networksUsed(sorted.map((offer) => offer.url));

  return (
    <>
      <Disclosure networks={networks} />
      <div className="table-scroll">
        <table>
          <caption className="visually-hidden">Where to buy {itemTitle}, cheapest first</caption>
          <thead>
            <tr>
              <th scope="col">Store</th>
              <th scope="col" className="num">Price</th>
              <th scope="col" className="num">Saving</th>
              <th scope="col"><span className="visually-hidden">Link</span></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((offer, index) => {
              const link = decorate(offer.url);
              return (
                <tr key={`${offer.merchant}-${index}`}>
                  <th scope="row">{offer.merchant}</th>
                  <td className="num">
                    {offer.price === null ? (
                      <span className="updated">Check store</span>
                    ) : (
                      <>
                        <span className="price">{formatPrice(offer.price, offer.currency)}</span>
                        {offer.listPrice != null && offer.listPrice > offer.price && (
                          <span className="price-was">
                            {formatPrice(offer.listPrice, offer.currency)}
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="num">
                    {offer.discountPercent ? (
                      <span className="badge">-{offer.discountPercent}%</span>
                    ) : (
                      <span className="updated">—</span>
                    )}
                  </td>
                  <td className="num">
                    <a className="btn" href={link.href} rel={link.rel} target="_blank">
                      View<span className="visually-hidden"> {itemTitle} at {offer.merchant}</span>
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default OfferTable;
