import { IMAGE_REJECT_MESSAGES } from '@shelf2kumo/contracts';
import { useId, useRef, useState, type ChangeEvent } from 'react';
import { ApiRequestError } from '../api.ts';
import { PrepareUploadError } from '../images/prepareUpload.ts';
import { uploadPhoto, useRenditionUrl, useShopImages, type ImageWithId, type UploadStage } from '../images/images.ts';

const NOTICE_KEY = 's2k:photo-notice-v1';

const STAGE_LABELS: Record<UploadStage, string> = {
  preparing: '写真を準備しています…',
  uploading: 'アップロードしています…',
  processing: '写真を確認しています…',
};

function noticeAccepted(): boolean {
  try {
    return localStorage.getItem(NOTICE_KEY) === 'accepted';
  } catch {
    return false;
  }
}

function rememberNotice() {
  try {
    localStorage.setItem(NOTICE_KEY, 'accepted');
  } catch {
    // Private mode or blocked storage: the notice simply shows again next time.
  }
}

function Thumbnail({ image }: { image: ImageWithId }) {
  const url = useRenditionUrl(image.state === 'processed' ? image.renditionPath : null);
  if (image.state === 'rejected') {
    return (
      <li className="ws-photo ws-photo-rejected">
        <span>{IMAGE_REJECT_MESSAGES[image.rejectReason ?? 'corrupt']}</span>
      </li>
    );
  }
  if (image.state === 'allocated') {
    return (
      <li className="ws-photo ws-photo-pending">
        <span>処理中…</span>
      </li>
    );
  }
  return (
    <li className="ws-photo">
      {url ? <img src={url} alt="アップロードした写真" width={image.width ?? undefined} height={image.height ?? undefined} /> : <span>読み込み中…</span>}
    </li>
  );
}

export function PhotoSection({ shopId }: { shopId: string }) {
  const headingId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const images = useShopImages(shopId);
  const [showNotice, setShowNotice] = useState(false);
  const [stage, setStage] = useState<UploadStage | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  function choosePhoto() {
    setMessage(null);
    if (noticeAccepted()) inputRef.current?.click();
    else setShowNotice(true);
  }

  function acceptNotice() {
    rememberNotice();
    setShowNotice(false);
    inputRef.current?.click();
  }

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      await uploadPhoto(shopId, file, setStage);
      setMessage({ kind: 'success', text: '写真を保存しました。' });
    } catch (error) {
      const text =
        error instanceof PrepareUploadError || error instanceof ApiRequestError
          ? error.message
          : 'アップロードできませんでした。通信状況を確認して、もう一度お試しください。';
      setMessage({ kind: 'error', text });
    } finally {
      setStage(null);
    }
  }

  const visible = images.filter((image) => image.state !== 'allocated' || stage !== null);

  return (
    <section aria-labelledby={headingId} className="ws-photos">
      <h2 id={headingId} className="ws-panel-title">
        写真
      </h2>

      {showNotice ? (
        <div className="ws-notice-box" role="dialog" aria-labelledby={`${headingId}-notice`}>
          <p id={`${headingId}-notice`} className="ws-notice-title">
            写真の取り扱いについて
          </p>
          <ul>
            <li>写真は非公開で保存されます（保存先：米国のサーバー）。</li>
            <li>商品情報の読み取りのため、写真は外部の AI サービス（AMD 提供、中国のサーバー）に送信されます。</li>
            <li>人物や個人情報が写らないよう、商品だけを撮影してください。</li>
            <li>位置情報などの撮影データは保存前に削除されます。</li>
          </ul>
          <div className="ws-notice-actions">
            <button type="button" className="ws-button" onClick={() => setShowNotice(false)}>
              キャンセル
            </button>
            <button type="button" className="ws-button ws-button-primary" onClick={acceptNotice}>
              同意して写真を選ぶ
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="ws-button ws-button-primary" onClick={choosePhoto} disabled={stage !== null}>
          写真を追加
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={onFileChange} data-testid="photo-input" />

      {stage && (
        <p className="ws-muted ws-small" role="status" aria-live="polite">
          {STAGE_LABELS[stage]}
        </p>
      )}
      {message && (
        <p className={message.kind === 'error' ? 'ws-form-error' : 'ws-notice-success'} role={message.kind === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}

      {visible.length > 0 ? (
        <ul className="ws-photo-grid">
          {visible.map((image) => (
            <Thumbnail key={image.id} image={image} />
          ))}
        </ul>
      ) : (
        <p className="ws-muted ws-small">商品の写真を追加すると、ここに表示されます。商品の自動作成は次の開発段階で利用できます。</p>
      )}
    </section>
  );
}
