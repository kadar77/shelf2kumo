import { CHAT_LIMITS, type FieldDiff, type SendChatResponse, type TaxTreatment } from '@shelf2kumo/contracts';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { formatPrice } from '../../storefront/format.ts';
import { ApiRequestError, apiFetch } from '../api.ts';
import type { ActionWithId, MessageWithId } from '../data/chat.ts';
import type { ItemWithId, JobWithId } from '../data/catalog.ts';
import { PrepareUploadError } from '../images/prepareUpload.ts';
import { uploadPhoto, useRenditionUrl, type ImageWithId } from '../images/images.ts';
import { noticeAccepted, PhotoNotice } from './PhotoSection.tsx';

const FIELD_LABELS: Record<string, string> = {
  name: '名前',
  description: '説明',
  category: 'カテゴリ',
  priceJpy: '価格',
  taxTreatment: '税区分',
  hours: '営業時間',
  address: '住所',
  phone: '電話番号',
};
const TAX_LABELS: Record<TaxTreatment, string> = { included: '税込', excluded: '税抜', unknown: '不明' };
const STATE_LABELS: Record<string, string> = { applied: '反映済み', proposed: '確認待ち', undone: '元に戻しました', rejected: '反映されませんでした' };
const PENDING_LIMIT_MS = 4 * 60_000;

function formatValue(field: string, value: FieldDiff['before']): string {
  if (value === null || value === '') return field === 'priceJpy' ? '価格はお問い合わせ' : '（なし）';
  if (field === 'priceJpy' && typeof value === 'number') return formatPrice(value, 'unknown');
  if (field === 'taxTreatment') return TAX_LABELS[value as TaxTreatment] ?? String(value);
  return String(value);
}

function actionTitle(action: ActionWithId): string {
  switch (action.type) {
    case 'removeItem':
      return `「${action.label}」を削除`;
    case 'createItem':
      return `「${action.label}」を追加`;
    case 'setTheme':
      return 'デザインを変更';
    case 'reorderItems':
      return '商品の並び順を変更';
    case 'updateProfile':
      return '店舗情報を変更';
    case 'undo':
      return action.label;
    default:
      return action.label;
  }
}

function newRequestId(): string {
  return `req-${crypto.randomUUID()}`;
}

interface Handlers {
  onPublish: () => void;
  onShowPreview: () => void;
  onOpenCatalog: (section: 'items' | 'theme' | 'profile' | 'new-item') => void;
}

function ActionCard({ action, shopId, onError, handlers }: { action: ActionWithId; shopId: string; onError: (text: string) => void } & { handlers: Handlers }) {
  const [busy, setBusy] = useState(false);
  async function run(path: string) {
    setBusy(true);
    try {
      await apiFetch('POST', path, {});
    } catch (error) {
      onError(error instanceof ApiRequestError ? error.message : '操作できませんでした。');
    } finally {
      setBusy(false);
    }
  }
  if (action.type === 'requestPreview') {
    return (
      <button type="button" className="ws-button ws-button-small" onClick={handlers.onShowPreview}>
        プレビューを見る
      </button>
    );
  }
  if (action.type === 'offerPublish') {
    return (
      <button type="button" className="ws-button ws-button-small ws-button-primary" onClick={handlers.onPublish}>
        公開内容を確認する
      </button>
    );
  }
  return (
    <div className="ws-action-card" data-state={action.state}>
      <div className="ws-action-head">
        <span className="ws-action-title">{actionTitle(action)}</span>
        <span className="ws-action-state">{STATE_LABELS[action.state] ?? action.state}</span>
      </div>
      {action.diffs.length > 0 && (
        <ul className="ws-diffs">
          {action.diffs.map((diff) => (
            <li key={diff.field}>
              {FIELD_LABELS[diff.field] ?? diff.field}：{action.state === 'proposed' ? '' : <del>{formatValue(diff.field, diff.before)}</del>}
              {action.state === 'proposed' ? '' : ' → '}
              <strong>{formatValue(diff.field, diff.after)}</strong>
            </li>
          ))}
        </ul>
      )}
      <div className="ws-row-actions">
        {action.state === 'proposed' && (
          <button type="button" className="ws-button ws-button-small ws-button-primary" disabled={busy} onClick={() => run(`/api/shops/${shopId}/actions/${action.id}/apply`)}>
            適用
          </button>
        )}
        {action.state === 'applied' && action.undoable && (
          <button type="button" className="ws-button ws-button-small" disabled={busy} onClick={() => run(`/api/shops/${shopId}/actions/${action.id}/undo`)}>
            元に戻す
          </button>
        )}
      </div>
    </div>
  );
}

function JobLine({ job, items }: { job: JobWithId | undefined; items: ItemWithId[] | null }) {
  if (!job || job.state === 'queued') return <p className="ws-hint">順番待ち…</p>;
  if (job.state === 'running') return <p className="ws-hint">商品情報を読み取っています…</p>;
  if (job.state === 'failed') return <p className="ws-hint ws-error-text">{job.error?.message}</p>;
  if (job.outcome === 'item_created') {
    const item = items?.find((candidate) => candidate.id === job.itemId);
    return (
      <p className="ws-hint ws-success-text">
        「{item?.name ?? '商品'}」を追加しました{item ? `（${formatPrice(item.priceJpy, item.taxTreatment)}）` : ''}。
        {job.model === 'fixture' && <span className="ws-badge">フィクスチャ</span>}
      </p>
    );
  }
  if (job.outcome === 'multiple_products') return <p className="ws-hint">複数の商品が写っています（約 {job.productCountEstimate} 点）。1 つずつ撮影してください。</p>;
  return <p className="ws-hint">商品情報を読み取れませんでした。カタログから手動で追加できます。</p>;
}

function PhotoBubble({ image }: { image: ImageWithId | undefined }) {
  const url = useRenditionUrl(image?.state === 'processed' ? image.renditionPath : null);
  return <div className="ws-chat-photo">{url ? <img src={url} alt="送信した写真" /> : <span>写真</span>}</div>;
}

export function ChatPanel({
  shopId,
  messages,
  actions,
  jobs,
  items,
  imagesById,
  handlers,
}: {
  shopId: string;
  messages: MessageWithId[] | null;
  actions: Map<string, ActionWithId>;
  jobs: JobWithId[];
  items: ItemWithId[] | null;
  imagesById: Map<string, ImageWithId>;
  handlers: Handlers;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNotice, setShowNotice] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const jobsById = new Map(jobs.map((job) => [job.id, job]));

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: 'end' });
  }, [messages?.length]);

  const answered = new Set((messages ?? []).filter((m) => m.role === 'assistant').map((m) => m.requestId));
  const pending = (messages ?? []).some(
    (m) => m.role === 'owner' && m.requestId && !answered.has(m.requestId) && (m.createdAtMs === null || Date.now() - m.createdAtMs < PENDING_LIMIT_MS),
  );

  async function send(body: Record<string, unknown>) {
    setError(null);
    setSending(true);
    try {
      await apiFetch<SendChatResponse>('POST', `/api/shops/${shopId}/chat`, { requestId: newRequestId(), ...body });
      return true;
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : '送信できませんでした。');
      return false;
    } finally {
      setSending(false);
    }
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    if (await send({ text: trimmed })) setText('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit();
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setSending(true);
    setError(null);
    try {
      const { imageId } = await uploadPhoto(shopId, file, () => undefined);
      await send({ imageId });
    } catch (caught) {
      setError(caught instanceof PrepareUploadError || caught instanceof ApiRequestError ? caught.message : '写真を送信できませんでした。');
      setSending(false);
    }
  }

  function choosePhoto() {
    if (noticeAccepted()) fileRef.current?.click();
    else setShowNotice(true);
  }

  async function clearHistory() {
    setConfirmClear(false);
    try {
      await apiFetch('DELETE', `/api/shops/${shopId}/conversation`, {});
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : '履歴を消去できませんでした。');
    }
  }

  return (
    <div className="ws-chat-layout">
      <ol className="ws-messages" aria-live="polite" aria-label="会話" ref={listRef}>
        <li className="ws-message ws-message-assistant">
          こんにちは！商品の写真を送るか、「ほうじ茶を800円にして」「営業時間は11時〜18時」「もっと温かい雰囲気に」のように話しかけてください。変更は下書きとして保存され、「公開する」まで公開ページには反映されません。
        </li>
        {(messages ?? []).map((message) => (
          <li key={message.id} className={message.role === 'owner' ? 'ws-message ws-message-owner' : 'ws-message ws-message-assistant'}>
            {message.imageId && <PhotoBubble image={imagesById.get(message.imageId)} />}
            {message.text && <p className={message.clarification ? 'ws-message-text ws-clarification' : 'ws-message-text'}>{message.text}</p>}
            {message.model === 'fixture' && <span className="ws-badge">フィクスチャ</span>}
            {message.jobId && <JobLine job={jobsById.get(message.jobId)} items={items} />}
            {message.actionIds.length > 0 && (
              <div className="ws-action-list">
                {message.actionIds.map((id) => {
                  const action = actions.get(id);
                  return action ? <ActionCard key={id} action={action} shopId={shopId} onError={setError} handlers={handlers} /> : null;
                })}
                {message.actionIds.filter((id) => actions.get(id)?.state === 'proposed').length > 1 && message.requestId && (
                  <button
                    type="button"
                    className="ws-button ws-button-small ws-button-primary"
                    onClick={() =>
                      apiFetch('POST', `/api/shops/${shopId}/chat/${message.requestId}/apply`, {}).catch((caught) =>
                        setError(caught instanceof ApiRequestError ? caught.message : '適用できませんでした。'),
                      )
                    }
                  >
                    すべて適用
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
        {pending && (
          <li className="ws-message ws-message-assistant ws-typing" role="status">
            考えています…
          </li>
        )}
      </ol>

      {showNotice && (
        <div className="ws-chat-notice">
          <PhotoNotice
            onCancel={() => setShowNotice(false)}
            onAccept={() => {
              setShowNotice(false);
              fileRef.current?.click();
            }}
          />
        </div>
      )}

      <div className="ws-chips" role="group" aria-label="よく使う操作">
        <button type="button" className="ws-chip" onClick={() => handlers.onOpenCatalog('theme')}>
          デザインを変える
        </button>
        <button type="button" className="ws-chip" onClick={() => handlers.onOpenCatalog('profile')}>
          営業時間・店舗情報
        </button>
        <button type="button" className="ws-chip" onClick={() => handlers.onOpenCatalog('new-item')}>
          商品を手動で追加
        </button>
        <button type="button" className="ws-chip" onClick={handlers.onShowPreview}>
          プレビュー
        </button>
      </div>

      {error && (
        <p className="ws-form-error ws-chat-error" role="alert">
          {error}
        </p>
      )}

      <form className="ws-composer" onSubmit={submit}>
        <label htmlFor="ws-composer-input" className="ws-visually-hidden">
          メッセージ
        </label>
        <textarea
          id="ws-composer-input"
          rows={2}
          maxLength={CHAT_LIMITS.maxMessageLength}
          placeholder="例：ほうじ茶の価格を 800 円に変更して"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={sending}
        />
        <div className="ws-composer-actions">
          <div className="ws-row-actions">
            <button type="button" className="ws-button" onClick={choosePhoto} disabled={sending}>
              写真を送る
            </button>
            {confirmClear ? (
              <>
                <button type="button" className="ws-link-button ws-small" onClick={() => void clearHistory()}>
                  消去する
                </button>
                <button type="button" className="ws-link-button ws-small" onClick={() => setConfirmClear(false)}>
                  やめる
                </button>
              </>
            ) : (
              <button type="button" className="ws-link-button ws-small" onClick={() => setConfirmClear(true)}>
                履歴を消去
              </button>
            )}
          </div>
          <button type="submit" className="ws-button ws-button-primary" disabled={sending || !text.trim()}>
            送信
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} data-testid="chat-photo-input" />
      </form>
    </div>
  );
}
