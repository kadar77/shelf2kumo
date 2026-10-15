import type { ItemField } from '@shelf2kumo/contracts';
import { useId, useState } from 'react';
import { formatPrice } from '../../storefront/format.ts';
import { ApiRequestError, apiFetch } from '../api.ts';
import type { ItemWithId } from '../data/catalog.ts';
import { useRenditionUrl, type ImageWithId } from '../images/images.ts';
import { ItemEditor } from './ItemEditor.tsx';

const FIELD_LABELS: Record<ItemField, string> = {
  name: '商品名',
  description: '説明',
  category: 'カテゴリ',
  priceJpy: '価格',
  taxTreatment: '税区分',
};

function ItemThumb({ image }: { image: ImageWithId | undefined }) {
  const url = useRenditionUrl(image?.state === 'processed' ? image.renditionPath : null);
  return <div className="ws-photo-thumb">{url ? <img src={url} alt="" /> : <span aria-hidden="true">画像なし</span>}</div>;
}

interface Props {
  shopId: string;
  items: ItemWithId[] | null;
  imagesById: Map<string, ImageWithId>;
  /** undefined: no new-item form; null: new item without photo; string: new item for that photo. */
  draftImageId: string | null | undefined;
  onDraftDone: () => void;
  onStartDraft: () => void;
}

export function ItemList({ shopId, items, imagesById, draftImageId, onDraftDone, onStartDraft }: Props) {
  const headingId = useId();
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof ApiRequestError ? error.message : '操作できませんでした。もう一度お試しください。');
    }
  }

  function move(index: number, offset: -1 | 1) {
    if (!items) return;
    const ids = items.map((item) => item.id);
    const target = index + offset;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target] as string, ids[index] as string];
    void run(() => apiFetch('POST', `/api/shops/${shopId}/items/reorder`, { itemIds: ids }));
  }

  const missingNames = items?.filter((item) => !item.name).length ?? 0;

  return (
    <section aria-labelledby={headingId} className="ws-items">
      <div className="ws-section-header">
        <h2 id={headingId} className="ws-panel-title">
          商品（{items?.length ?? 0}件）
        </h2>
        {draftImageId === undefined && (
          <button type="button" className="ws-button ws-button-small" onClick={onStartDraft}>
            手動で追加
          </button>
        )}
      </div>
      <p className="ws-muted ws-small">保存した内容は「公開する」まで公開ページに反映されません。</p>
      {missingNames > 0 && (
        <p className="ws-notice-warn" role="status">
          商品名が未入力の商品が {missingNames} 件あります。公開する前に入力するか削除してください。
        </p>
      )}
      {message && (
        <p className="ws-form-error" role="alert">
          {message}
        </p>
      )}

      {draftImageId !== undefined && (
        <div className="ws-item-card">
          <p className="ws-notice-title">新しい商品</p>
          <ItemEditor shopId={shopId} item={null} imageId={draftImageId} onDone={onDraftDone} />
        </div>
      )}

      {items === null ? (
        <p className="ws-muted ws-small" role="status">
          読み込み中…
        </p>
      ) : items.length === 0 ? (
        <p className="ws-muted ws-small">商品はまだありません。写真を追加するか、手動で追加してください。</p>
      ) : (
        <ol className="ws-item-list">
          {items.map((item, index) => (
            <li key={item.id} className="ws-item-card">
              <div className="ws-item-summary">
                <ItemThumb image={item.imageId ? imagesById.get(item.imageId) : undefined} />
                <div className="ws-item-text">
                  <p className={item.name ? 'ws-catalog-name' : 'ws-catalog-name ws-error-text'}>{item.name ?? '商品名が未入力です'}</p>
                  <p className={item.priceJpy === null ? 'ws-catalog-price ws-flag' : 'ws-catalog-price'}>
                    {formatPrice(item.priceJpy, item.taxTreatment)}
                  </p>
                  {item.uncertainFields.length > 0 && (
                    <p className="ws-hint">確認してください：{item.uncertainFields.map((field) => FIELD_LABELS[field]).join('・')}</p>
                  )}
                </div>
              </div>

              {editing === item.id ? (
                <ItemEditor shopId={shopId} item={item} onDone={() => setEditing(null)} />
              ) : confirmDelete === item.id ? (
                <div className="ws-row-actions">
                  <span className="ws-small">この商品を削除しますか？</span>
                  <button type="button" className="ws-button ws-button-small" onClick={() => setConfirmDelete(null)}>
                    やめる
                  </button>
                  <button
                    type="button"
                    className="ws-button ws-button-small ws-button-danger"
                    onClick={() => {
                      setConfirmDelete(null);
                      void run(() => apiFetch('DELETE', `/api/shops/${shopId}/items/${item.id}`, {}));
                    }}
                  >
                    削除する
                  </button>
                </div>
              ) : (
                <div className="ws-row-actions">
                  <button type="button" className="ws-button ws-button-small" onClick={() => setEditing(item.id)}>
                    編集
                  </button>
                  <button type="button" className="ws-button ws-button-small" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`${item.name ?? '商品'}を上へ移動`}>
                    ↑
                  </button>
                  <button
                    type="button"
                    className="ws-button ws-button-small"
                    onClick={() => move(index, 1)}
                    disabled={index === items.length - 1}
                    aria-label={`${item.name ?? '商品'}を下へ移動`}
                  >
                    ↓
                  </button>
                  <button type="button" className="ws-button ws-button-small" onClick={() => setConfirmDelete(item.id)}>
                    削除
                  </button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
