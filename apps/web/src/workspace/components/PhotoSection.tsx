import { IMAGE_REJECT_MESSAGES } from '@shelf2kumo/contracts';
import { useId, useRef, useState, type ChangeEvent } from 'react';
import { ApiRequestError } from '../api.ts';
import type { JobWithId } from '../data/catalog.ts';
import { PrepareUploadError } from '../images/prepareUpload.ts';
import { requestExtraction, uploadPhoto, useRenditionUrl, type ImageWithId, type UploadStage } from '../images/images.ts';

const NOTICE_KEY = 's2k:photo-notice-v1';
const MAX_ROWS = 8;

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

const messageOf = (error: unknown, fallback: string) =>
  error instanceof PrepareUploadError || error instanceof ApiRequestError ? error.message : fallback;

interface RowProps {
  image: ImageWithId;
  job: JobWithId | undefined;
  onManualAdd: (imageId: string) => void;
  onRetry: (image: ImageWithId, job: JobWithId) => void;
}

function JobStatus({ image, job, onManualAdd, onRetry }: RowProps) {
  const manual = (
    <button type="button" className="ws-link-button ws-small" onClick={() => onManualAdd(image.id)}>
      手動で追加
    </button>
  );
  if (image.state === 'rejected') return <p className="ws-row-text ws-error-text">{IMAGE_REJECT_MESSAGES[image.rejectReason ?? 'corrupt']}</p>;
  if (image.state === 'allocated') return <p className="ws-row-text">アップロード中…</p>;
  if (!job) {
    return (
      <div className="ws-row-text">
        <p>読み取りを開始していません。</p>
        <div className="ws-row-actions">
          <button type="button" className="ws-link-button ws-small" onClick={() => onRetry(image, { id: '' } as JobWithId)}>
            読み取る
          </button>
          {manual}
        </div>
      </div>
    );
  }
  if (job.state === 'queued') return <p className="ws-row-text">順番待ち…</p>;
  if (job.state === 'running') return <p className="ws-row-text">商品情報を読み取っています…（15〜30 秒ほど）</p>;
  if (job.state === 'failed') {
    return (
      <div className="ws-row-text">
        <p className="ws-error-text">{job.error?.message ?? '読み取れませんでした。'}</p>
        <div className="ws-row-actions">
          {job.error?.retryable && (
            <button type="button" className="ws-link-button ws-small" onClick={() => onRetry(image, job)}>
              もう一度読み取る
            </button>
          )}
          {manual}
        </div>
      </div>
    );
  }
  if (job.outcome === 'item_created') {
    return (
      <p className="ws-row-text ws-success-text">
        商品を追加しました{job.model === 'fixture' && <span className="ws-badge">フィクスチャ</span>}
      </p>
    );
  }
  const text =
    job.outcome === 'multiple_products'
      ? `複数の商品が写っています（約 ${job.productCountEstimate ?? 2} 点）。1 つの商品だけが写るように撮り直すか、手動で追加してください。`
      : '商品情報を読み取れませんでした。手動で追加できます。';
  return (
    <div className="ws-row-text">
      <p>{text}</p>
      <div className="ws-row-actions">{manual}</div>
    </div>
  );
}

function PhotoRow(props: RowProps) {
  const url = useRenditionUrl(props.image.state === 'processed' ? props.image.renditionPath : null);
  return (
    <li className="ws-photo-row">
      <div className="ws-photo-thumb">{url ? <img src={url} alt="アップロードした写真" /> : <span aria-hidden="true">…</span>}</div>
      <JobStatus {...props} />
    </li>
  );
}

export function PhotoSection({
  shopId,
  images,
  jobs,
  onManualAdd,
}: {
  shopId: string;
  images: ImageWithId[];
  jobs: JobWithId[];
  onManualAdd: (imageId: string) => void;
}) {
  const headingId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [showNotice, setShowNotice] = useState(false);
  const [stage, setStage] = useState<UploadStage | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  // Latest job per image (jobs are newest first).
  const jobByImage = new Map<string, JobWithId>();
  for (const job of jobs) if (!jobByImage.has(job.imageId)) jobByImage.set(job.imageId, job);

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

  async function startExtraction(imageId: string, retryOfJobId?: string) {
    try {
      await requestExtraction(shopId, imageId, retryOfJobId);
      return true;
    } catch (error) {
      setMessage({ kind: 'error', text: messageOf(error, '読み取りを開始できませんでした。手動で追加できます。') });
      return false;
    }
  }

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    let imageId: string;
    try {
      imageId = (await uploadPhoto(shopId, file, setStage)).imageId;
    } catch (error) {
      setMessage({ kind: 'error', text: messageOf(error, 'アップロードできませんでした。通信状況を確認して、もう一度お試しください。') });
      setStage(null);
      return;
    }
    setStage(null);
    if (await startExtraction(imageId)) {
      setMessage({ kind: 'success', text: '写真を保存しました。商品情報を読み取っています。' });
    }
  }

  const visible = images.filter((image) => image.state !== 'allocated' || stage !== null).slice(0, MAX_ROWS);

  return (
    <section aria-labelledby={headingId} className="ws-photos">
      <h2 id={headingId} className="ws-panel-title">
        写真から商品を追加
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
        <ul className="ws-photo-rows" aria-live="polite">
          {visible.map((image) => (
            <PhotoRow
              key={image.id}
              image={image}
              job={jobByImage.get(image.id)}
              onManualAdd={onManualAdd}
              onRetry={(target, job) => void startExtraction(target.id, job.id || undefined)}
            />
          ))}
        </ul>
      ) : (
        <p className="ws-muted ws-small">1 枚に 1 つの商品が写るように撮影してください。写真を追加すると、商品が自動で作成されます。</p>
      )}
    </section>
  );
}
