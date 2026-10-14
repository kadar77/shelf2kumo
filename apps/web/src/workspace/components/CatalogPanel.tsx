import type { StorefrontSnapshot } from '@shelf2kumo/contracts';
import { formatPrice } from '../../storefront/format.ts';

export function CatalogPanel({ snapshot }: { snapshot: StorefrontSnapshot }) {
  return (
    <div className="ws-panel-inner">
      <h2 className="ws-panel-title">カタログ（{snapshot.items.length}件）</h2>
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
    </div>
  );
}
