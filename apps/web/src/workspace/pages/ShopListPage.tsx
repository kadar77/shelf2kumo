import { Link } from 'react-router';
import { fixtureShops } from '../fixtures.ts';

export function ShopListPage() {
  return (
    <main className="ws-page">
      <p className="ws-brand">Shelf2Kumo</p>
      <h1>あなたのショップ</h1>
      <ul className="ws-shop-list">
        {Object.entries(fixtureShops).map(([shopId, snapshot]) => (
          <li key={shopId}>
            <Link className="ws-shop-card" to={`/app/shops/${shopId}`}>
              <span className="ws-shop-name">{snapshot.shop.name}</span>
              <span className="ws-badge">デモデータ</span>
            </Link>
          </li>
        ))}
      </ul>
      <button type="button" className="ws-button" disabled aria-describedby="ws-create-note">
        新しいショップを作成
      </button>
      <p id="ws-create-note" className="ws-muted ws-small">
        ログインとショップ作成は次の開発段階で利用できるようになります。
      </p>
    </main>
  );
}
