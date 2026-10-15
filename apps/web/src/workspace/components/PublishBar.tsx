import type { ShopWithId } from '../data/shops.ts';

/** Persistent publication status and action (spec §9 Merchant UX). */
export function PublishBar({ shop, onPublish, onShare }: { shop: ShopWithId; onPublish: () => void; onShare: () => void }) {
  const live = shop.liveReleaseId !== null;
  const pending = !live || shop.contentRevision !== shop.publishedRevision;
  const status = live ? (pending ? '未公開の変更あり' : '公開中') : '未公開';
  return (
    <div className="ws-publish">
      {live ? (
        <button type="button" className="ws-link-button ws-small" onClick={onShare}>
          {status}・共有
        </button>
      ) : (
        <span className="ws-status" role="status">
          {status}
        </span>
      )}
      <button type="button" className="ws-button ws-button-primary" onClick={onPublish} disabled={!pending}>
        公開する
      </button>
    </div>
  );
}
