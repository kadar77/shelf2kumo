import type { StorefrontSnapshot } from '@shelf2kumo/contracts';
import { formatPrice } from '../../storefront/format.ts';
import type { ShopWithId } from '../data/shops.ts';
import { PhotoSection } from './PhotoSection.tsx';
import { ShopProfileForm } from './ShopProfileForm.tsx';

export function CatalogPanel({ shop, snapshot }: { shop: ShopWithId; snapshot: StorefrontSnapshot }) {
  return (
    <div className="ws-panel-inner ws-catalog-inner">
      <PhotoSection shopId={shop.id} />

      <ShopProfileForm key={shop.id} shop={shop} />

      <section aria-labelledby="ws-items-title">
        <h2 id="ws-items-title" className="ws-panel-title">
          商品（{snapshot.items.length}件）
        </h2>
        {snapshot.items.length === 0 ? (
          <p className="ws-muted ws-small">商品はまだありません。</p>
        ) : (
          <ul className="ws-catalog-list">
            {snapshot.items.map((item) => (
              <li key={item.id} className="ws-catalog-item">
                <span className="ws-catalog-name">{item.name}</span>
                <span className={item.priceJpy === null ? 'ws-catalog-price ws-flag' : 'ws-catalog-price'}>
                  {formatPrice(item.priceJpy, item.taxTreatment)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
