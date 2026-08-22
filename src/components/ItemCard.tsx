import Link from 'next/link';
import { bestOffer } from '@/lib/dataset';
import { itemPath } from '@/lib/seo';
import { formatPrice } from '@/lib/util';
import type { SourceItem } from '@/lib/sources/types';

export function ItemCard({ item }: { item: SourceItem }) {
  const offer = bestOffer(item);

  return (
    <li className="card">
      <h3>
        <Link href={itemPath(item)}>{item.title}</Link>
      </h3>
      {item.categories.length > 0 && <p className="meta">{item.categories.join(' · ')}</p>}
      <p className="card-price">
        {offer?.price != null ? (
          <>
            <span className="price">{formatPrice(offer.price, offer.currency)}</span>{' '}
            <span className="meta">at {offer.merchant}</span>
          </>
        ) : (
          <span className="meta">Price unavailable</span>
        )}
      </p>
    </li>
  );
}

export default ItemCard;
