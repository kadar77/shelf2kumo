import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { CatalogPanel } from '../components/CatalogPanel.tsx';
import { ChatPanel } from '../components/ChatPanel.tsx';
import { PreviewPane } from '../components/PreviewPane.tsx';
import { PublishBar } from '../components/PublishBar.tsx';
import { fixtureShops } from '../fixtures.ts';
import { NotFoundPage } from './NotFoundPage.tsx';

type Tab = 'chat' | 'catalog' | 'preview';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'chat', label: 'チャット' },
  { id: 'catalog', label: 'カタログ' },
  { id: 'preview', label: 'プレビュー' },
];

export function ShopWorkspacePage() {
  const { shopId = '' } = useParams();
  const snapshot = fixtureShops[shopId];
  const [activeTab, setActiveTab] = useState<Tab>('chat');

  if (!snapshot) return <NotFoundPage />;

  return (
    <div className="ws">
      <header className="ws-topbar">
        <Link className="ws-brand" to="/app">
          Shelf2Kumo
        </Link>
        <span className="ws-topbar-shop">{snapshot.shop.name}</span>
        <span className="ws-badge">デモデータ</span>
        <div className="ws-topbar-publish">
          <PublishBar />
        </div>
      </header>

      <div className="ws-tabs" role="tablist" aria-label="表示切り替え">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`ws-tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`ws-panel-${tab.id}`}
            className="ws-tab"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="ws-body">
        <section
          id="ws-panel-catalog"
          role="tabpanel"
          aria-labelledby="ws-tab-catalog"
          className="ws-panel ws-catalog"
          data-active={activeTab === 'catalog'}
        >
          <CatalogPanel snapshot={snapshot} />
        </section>
        <section
          id="ws-panel-chat"
          role="tabpanel"
          aria-labelledby="ws-tab-chat"
          className="ws-panel ws-chat"
          data-active={activeTab === 'chat'}
        >
          <ChatPanel />
        </section>
        <section
          id="ws-panel-preview"
          role="tabpanel"
          aria-labelledby="ws-tab-preview"
          className="ws-panel ws-preview"
          data-active={activeTab === 'preview'}
        >
          <PreviewPane snapshot={snapshot} />
        </section>
      </div>

      <div className="ws-mobile-publish">
        <PublishBar />
      </div>
    </div>
  );
}
