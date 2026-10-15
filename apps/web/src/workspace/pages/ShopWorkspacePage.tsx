import { draftItemsForSnapshot, toStorefrontSnapshot, type SnapshotImageInfo, type StorefrontImage } from '@shelf2kumo/contracts';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { CatalogPanel } from '../components/CatalogPanel.tsx';
import { ChatPanel } from '../components/ChatPanel.tsx';
import { PreviewPane } from '../components/PreviewPane.tsx';
import { PublishBar } from '../components/PublishBar.tsx';
import { LoadingScreen } from '../auth/AuthProvider.tsx';
import { useItems, useJobs } from '../data/catalog.ts';
import { useActions, useMessages, useTheme } from '../data/chat.ts';
import { useShop, type ShopWithId } from '../data/shops.ts';
import { useRenditionUrls, useShopImages } from '../images/images.ts';
import { NotFoundPage } from './NotFoundPage.tsx';

type Tab = 'chat' | 'catalog' | 'preview';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'chat', label: 'チャット' },
  { id: 'catalog', label: 'カタログ' },
  { id: 'preview', label: 'プレビュー' },
];

export function ShopWorkspacePage() {
  const { shopId = '' } = useParams();
  const shop = useShop(shopId);

  if (shop.status === 'loading') return <LoadingScreen />;
  if (shop.status === 'error') {
    return (
      <main className="ws-page">
        <p className="ws-form-error" role="alert">
          {shop.message}
        </p>
      </main>
    );
  }
  if (!shop.data) return <NotFoundPage />;
  return <Workspace shop={shop.data} />;
}

function Workspace({ shop }: { shop: ShopWithId }) {
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const items = useItems(shop.id);
  const images = useShopImages(shop.id);
  const jobs = useJobs(shop.id);
  const theme = useTheme(shop.id);
  const messages = useMessages(shop.id);
  const actions = useActions(shop.id);
  const [draftImageId, setDraftImageId] = useState<string | null | undefined>(undefined);

  const imagesById = useMemo(() => new Map(images.map((image) => [image.id, image])), [images]);
  const imageInfo = useMemo(() => {
    const info = new Map<string, SnapshotImageInfo>();
    for (const image of images) {
      if (image.state === 'processed' && image.contentHash && image.width && image.height) {
        info.set(image.id, { contentHash: image.contentHash, width: image.width, height: image.height });
      }
    }
    return info;
  }, [images]);

  // The preview uses the same mapping and saved theme that publishing will use.
  const snapshot = useMemo(
    () => toStorefrontSnapshot({ shop, items: draftItemsForSnapshot(items ?? [], imageInfo), theme: theme.tokens }),
    [shop, items, imageInfo, theme.tokens],
  );

  const handlers = {
    onShowPreview: () => setActiveTab('preview'),
    onOpenCatalog: (section: 'items' | 'theme' | 'profile' | 'new-item') => {
      setActiveTab('catalog');
      if (section === 'new-item') setDraftImageId(null);
      const target = section === 'new-item' ? 'items' : section;
      requestAnimationFrame(() => document.getElementById(`ws-section-${target}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    },
  };

  // Private renditions for the preview, keyed by content hash.
  const pathByHash = useMemo(() => {
    const map = new Map<string, string>();
    for (const image of images) if (image.contentHash && image.renditionPath) map.set(image.contentHash, image.renditionPath);
    return map;
  }, [images]);
  const previewPaths = snapshot.items.flatMap((item) => (item.image ? [pathByHash.get(item.image.contentHash) ?? ''] : [])).filter(Boolean);
  const urls = useRenditionUrls(previewPaths);
  const resolveImage = (image: StorefrontImage) => urls.get(pathByHash.get(image.contentHash) ?? '') ?? null;

  return (
    <div className="ws">
      <header className="ws-topbar">
        <Link className="ws-brand" to="/app">
          Shelf2Kumo
        </Link>
        <span className="ws-topbar-shop">{shop.name}</span>
        <div className="ws-topbar-publish">
          <PublishBar live={shop.liveReleaseId !== null} />
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
          <CatalogPanel
            shop={shop}
            items={items}
            images={images}
            imagesById={imagesById}
            jobs={jobs}
            theme={theme}
            draftImageId={draftImageId}
            onDraftChange={setDraftImageId}
          />
        </section>
        <section id="ws-panel-chat" role="tabpanel" aria-labelledby="ws-tab-chat" className="ws-panel ws-chat" data-active={activeTab === 'chat'}>
          <ChatPanel shopId={shop.id} messages={messages} actions={actions} jobs={jobs} items={items} imagesById={imagesById} handlers={handlers} />
        </section>
        <section
          id="ws-panel-preview"
          role="tabpanel"
          aria-labelledby="ws-tab-preview"
          className="ws-panel ws-preview"
          data-active={activeTab === 'preview'}
        >
          <PreviewPane snapshot={snapshot} resolveImage={resolveImage} />
        </section>
      </div>

      <div className="ws-mobile-publish">
        <PublishBar live={shop.liveReleaseId !== null} />
      </div>
    </div>
  );
}
