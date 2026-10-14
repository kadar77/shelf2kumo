import type { StorefrontItem, StorefrontShop, StorefrontSnapshot } from '@shelf2kumo/contracts';
import { formatPrice, telHref } from './format.ts';
import type { StorefrontLinks } from './links.ts';

/*
 * Pure storefront components: props in, markup out. Rendered to static HTML by the storefront
 * function and rendered live by the workspace preview. No Firebase, workspace state or browser APIs.
 */

interface ViewProps {
  snapshot: StorefrontSnapshot;
  links: StorefrontLinks;
}

function DemoBanner() {
  return <p className="sf-demo-banner">これはデモ用のサンプル店舗です。実在のお店・商品ではありません。</p>;
}

function Header({ shop, links }: { shop: StorefrontShop; links: StorefrontLinks }) {
  return (
    <header className="sf-header">
      <div className="sf-container">
        <a className="sf-brand" href={links.shop(shop.slug)} data-sf-home="">
          {shop.name}
        </a>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="sf-footer">
      <div className="sf-container">Shelf2Kumo で作成</div>
    </footer>
  );
}

function ItemImage({ item, shop, links, eager = false }: { item: StorefrontItem; shop: StorefrontShop; links: StorefrontLinks; eager?: boolean }) {
  const src = item.image ? links.image(shop.slug, item.image) : null;
  if (!item.image || !src) {
    return (
      <div className="sf-media" aria-hidden="true">
        画像なし
      </div>
    );
  }
  return (
    <div className="sf-media">
      <img
        src={src}
        alt={item.image.alt || item.name}
        width={item.image.width}
        height={item.image.height}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
      />
    </div>
  );
}

function Price({ item }: { item: StorefrontItem }) {
  const unknown = item.priceJpy === null;
  return <p className={unknown ? 'sf-price sf-price-unknown' : 'sf-price'}>{formatPrice(item.priceJpy, item.taxTreatment)}</p>;
}

function ShopInfo({ shop }: { shop: StorefrontShop }) {
  const tel = shop.phone ? telHref(shop.phone) : null;
  if (!shop.hours && !shop.address && !shop.phone && !shop.mapUrl) return null;
  return (
    <section className="sf-section" aria-labelledby="sf-info-heading">
      <h2 id="sf-info-heading">店舗情報</h2>
      <dl className="sf-info">
        {shop.hours && (
          <>
            <dt>営業時間</dt>
            <dd>{shop.hours}</dd>
          </>
        )}
        {shop.address && (
          <>
            <dt>住所</dt>
            <dd>{shop.address}</dd>
          </>
        )}
        {shop.phone && (
          <>
            <dt>電話</dt>
            <dd>{tel ? <a href={tel}>{shop.phone}</a> : shop.phone}</dd>
          </>
        )}
        {shop.mapUrl && (
          <>
            <dt>地図</dt>
            <dd>
              <a href={shop.mapUrl} target="_blank" rel="noopener noreferrer">
                Google マップで開く
              </a>
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}

function ProductCard({ item, shop, links }: { item: StorefrontItem; shop: StorefrontShop; links: StorefrontLinks }) {
  return (
    <a className="sf-card" href={links.product(shop.slug, item.id)} data-sf-item={item.id}>
      <ItemImage item={item} shop={shop} links={links} />
      <div className="sf-card-body">
        {item.category && <p className="sf-category">{item.category}</p>}
        <h3>{item.name}</h3>
        <Price item={item} />
      </div>
    </a>
  );
}

export function ShopView({ snapshot, links }: ViewProps) {
  const { shop, items } = snapshot;
  return (
    <>
      {shop.isDemo && <DemoBanner />}
      <Header shop={shop} links={links} />
      <main className="sf-main sf-container">
        <section className="sf-intro">
          <h1>{shop.name}</h1>
          {shop.description && <p>{shop.description}</p>}
        </section>
        <section aria-labelledby="sf-products-heading">
          <h2 id="sf-products-heading">商品</h2>
          {items.length === 0 ? (
            <p className="sf-muted">現在掲載中の商品はありません。</p>
          ) : (
            <ul className="sf-grid">
              {items.map((item) => (
                <li key={item.id}>
                  <ProductCard item={item} shop={shop} links={links} />
                </li>
              ))}
            </ul>
          )}
        </section>
        <ShopInfo shop={shop} />
      </main>
      <Footer />
    </>
  );
}

export function ProductView({ snapshot, links, item }: ViewProps & { item: StorefrontItem }) {
  const { shop } = snapshot;
  return (
    <>
      {shop.isDemo && <DemoBanner />}
      <Header shop={shop} links={links} />
      <main className="sf-main sf-container">
        <a className="sf-back" href={links.shop(shop.slug)} data-sf-home="">
          ← {shop.name} の商品一覧
        </a>
        <article className="sf-product">
          <ItemImage item={item} shop={shop} links={links} eager />
          <div className="sf-product-details">
            {item.category && <p className="sf-category">{item.category}</p>}
            <h1>{item.name}</h1>
            <Price item={item} />
            {item.description && <p className="sf-description">{item.description}</p>}
          </div>
        </article>
        <ShopInfo shop={shop} />
      </main>
      <Footer />
    </>
  );
}

export function NotFoundView() {
  return (
    <main className="sf-main sf-container">
      <h1>ページが見つかりません</h1>
      <p className="sf-muted">URL が正しいかご確認ください。お店のページは公開が停止されている可能性があります。</p>
      <p>
        <a href="/">Shelf2Kumo トップへ</a>
      </p>
    </main>
  );
}
