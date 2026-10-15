import type { ChangeSummary, PreparePublicationResponse, PublishResponse } from '@shelf2kumo/contracts';
import QRCode from 'qrcode';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ApiRequestError, apiFetch } from '../api.ts';

const FIELD_LABELS: Record<string, string> = {
  name: '名前',
  description: '説明',
  category: 'カテゴリ',
  priceJpy: '価格',
  taxTreatment: '税区分',
  image: '写真',
  address: '住所',
  phone: '電話番号',
  hours: '営業時間',
  mapUrl: '地図',
};

type View =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'confirm'; prepared: PreparePublicationResponse; notice?: string }
  | { kind: 'publishing'; prepared: PreparePublicationResponse }
  | { kind: 'shared'; url: string; justPublished: boolean };

function Summary({ summary }: { summary: ChangeSummary }) {
  if (summary.firstPublication) {
    return (
      <div className="ws-summary">
        <p>初めての公開です。店舗情報・デザインと、次の商品 {summary.itemCount} 件が公開されます。</p>
        {summary.added.length > 0 && (
          <ul>
            {summary.added.slice(0, 12).map((name, index) => (
              <li key={`${name}-${index}`}>{name}</li>
            ))}
            {summary.added.length > 12 && <li>ほか {summary.added.length - 12} 件</li>}
          </ul>
        )}
      </div>
    );
  }
  if (summary.noChanges) return <p className="ws-summary">公開中の内容と同じです。変更はありません。</p>;
  return (
    <div className="ws-summary">
      {summary.added.length > 0 && (
        <p>
          <strong>追加：</strong>
          {summary.added.join('、')}
        </p>
      )}
      {summary.changed.length > 0 && (
        <p>
          <strong>変更：</strong>
          {summary.changed.map((change) => `${change.name}（${change.fields.map((f) => FIELD_LABELS[f] ?? f).join('・')}）`).join('、')}
        </p>
      )}
      {summary.removed.length > 0 && (
        <p>
          <strong>削除：</strong>
          {summary.removed.join('、')}
        </p>
      )}
      {summary.profileFields.length > 0 && (
        <p>
          <strong>店舗情報：</strong>
          {summary.profileFields.map((f) => FIELD_LABELS[f] ?? f).join('・')}
        </p>
      )}
      {summary.themeChanged && <p>デザインを変更</p>}
      {summary.orderChanged && <p>商品の並び順を変更</p>}
    </div>
  );
}

/** URL, copy, QR code (with PNG download), open, and unpublish. */
export function ShareTools({ url, shopId, onUnpublished }: { url: string; shopId: string; onUnpublished: () => void }) {
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [qrPng, setQrPng] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then((svg) => {
      if (!cancelled) setQrSvg(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    });
    void QRCode.toDataURL(url, { margin: 2, width: 512, errorCorrectionLevel: 'M' }).then((png) => {
      if (!cancelled) setQrPng(png);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('コピーできませんでした。URL を長押しして選択してください。');
    }
  }

  async function unpublish() {
    setConfirmStop(false);
    try {
      await apiFetch('POST', `/api/shops/${shopId}/unpublish`, {});
      onUnpublished();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : '公開を停止できませんでした。');
    }
  }

  return (
    <div className="ws-share">
      <div className="ws-share-url">
        <input type="text" readOnly value={url} aria-label="公開ページの URL" onFocus={(event) => event.target.select()} />
        <button type="button" className="ws-button ws-button-small" onClick={() => void copy()}>
          {copied ? 'コピーしました' : 'コピー'}
        </button>
      </div>
      {qrSvg && <img className="ws-qr" src={qrSvg} alt={`公開ページの QR コード（${url}）`} width={180} height={180} />}
      <div className="ws-row-actions">
        <a className="ws-button ws-button-small" href={url} target="_blank" rel="noopener noreferrer">
          公開ページを開く
        </a>
        {qrPng && (
          <a className="ws-button ws-button-small" href={qrPng} download="shop-qr.png">
            QR コードを保存
          </a>
        )}
      </div>
      {error && (
        <p className="ws-form-error" role="alert">
          {error}
        </p>
      )}
      <div className="ws-row-actions ws-share-stop">
        {confirmStop ? (
          <>
            <span className="ws-small">公開を停止すると、ページは見られなくなります（約 1 分以内）。</span>
            <button type="button" className="ws-button ws-button-small" onClick={() => setConfirmStop(false)}>
              やめる
            </button>
            <button type="button" className="ws-button ws-button-small ws-button-danger" onClick={() => void unpublish()}>
              停止する
            </button>
          </>
        ) : (
          <button type="button" className="ws-link-button ws-small" onClick={() => setConfirmStop(true)}>
            公開を停止
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The single publication gate (spec §2): a change summary and one 公開する button. No preview visit
 * or per-item approval is required.
 */
export function PublishDialog({
  shopId,
  mode,
  liveUrl,
  onClose,
}: {
  shopId: string;
  mode: 'publish' | 'share';
  liveUrl: string | null;
  onClose: () => void;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<View>(mode === 'share' && liveUrl ? { kind: 'shared', url: liveUrl, justPublished: false } : { kind: 'loading' });

  const prepare = useCallback(
    async (notice?: string) => {
      setView({ kind: 'loading' });
      try {
        const prepared = await apiFetch<PreparePublicationResponse>('POST', `/api/shops/${shopId}/prepare-publication`, {});
        setView({ kind: 'confirm', prepared, notice });
      } catch (caught) {
        setView({ kind: 'error', message: caught instanceof ApiRequestError ? caught.message : '公開内容を確認できませんでした。' });
      }
    },
    [shopId],
  );

  useEffect(() => {
    if (mode === 'publish') void prepare();
  }, [mode, prepare]);

  const dialogRef = useRef<HTMLDivElement>(null);

  // Keyboard: focus moves into the dialog, Tab stays inside it, Escape closes, and focus returns
  // to the control that opened it.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, [tabindex]:not([tabindex="-1"])')];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  async function publish(prepared: PreparePublicationResponse) {
    setView({ kind: 'publishing', prepared });
    try {
      const result = await apiFetch<PublishResponse>('POST', `/api/shops/${shopId}/publish`, {
        confirmationId: prepared.confirmationId,
        snapshotHash: prepared.snapshotHash,
      });
      setView({ kind: 'shared', url: result.url, justPublished: true });
    } catch (caught) {
      if (caught instanceof ApiRequestError && (caught.code === 'revision_conflict' || caught.code === 'conflict')) {
        // Stale or expired confirmation: show the refreshed summary instead of publishing old content.
        await prepare(`${caught.message} 最新の内容を表示しています。`);
      } else {
        setView({ kind: 'error', message: caught instanceof ApiRequestError ? caught.message : '公開できませんでした。' });
      }
    }
  }

  return (
    <div className="ws-modal-backdrop" role="presentation" onClick={onClose}>
      <div ref={dialogRef} className="ws-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}>
        <div className="ws-modal-header">
          <h2 id={titleId}>{view.kind === 'shared' ? (view.justPublished ? '公開しました' : '公開中のページ') : 'この変更を公開しますか？'}</h2>
          <button ref={closeRef} type="button" className="ws-link-button" onClick={onClose} aria-label="閉じる">
            閉じる
          </button>
        </div>

        {view.kind === 'loading' && (
          <p className="ws-muted" role="status">
            公開内容を確認しています…
          </p>
        )}
        {view.kind === 'error' && (
          <>
            <p className="ws-form-error" role="alert">
              {view.message}
            </p>
            <div className="ws-notice-actions">
              <button type="button" className="ws-button" onClick={onClose}>
                編集を続ける
              </button>
            </div>
          </>
        )}
        {(view.kind === 'confirm' || view.kind === 'publishing') && (
          <>
            {view.kind === 'confirm' && view.notice && (
              <p className="ws-notice-warn" role="status">
                {view.notice}
              </p>
            )}
            <Summary summary={view.prepared.summary} />
            <p className="ws-muted ws-small">公開先：{view.prepared.url}</p>
            <p className="ws-muted ws-small">公開後、約 1 分以内にすべての人に反映されます。</p>
            <div className="ws-notice-actions">
              <button type="button" className="ws-button" onClick={onClose}>
                編集を続ける
              </button>
              <button
                type="button"
                className="ws-button ws-button-primary"
                disabled={view.kind === 'publishing' || (!view.prepared.summary.firstPublication && view.prepared.summary.noChanges)}
                onClick={() => view.kind === 'confirm' && void publish(view.prepared)}
              >
                {view.kind === 'publishing' ? '公開しています…' : '公開する'}
              </button>
            </div>
          </>
        )}
        {view.kind === 'shared' && (
          <>
            {view.justPublished && <p className="ws-notice-success">お店のページを公開しました。URL や QR コードで共有できます。</p>}
            <ShareTools url={view.url} shopId={shopId} onUnpublished={onClose} />
          </>
        )}
      </div>
    </div>
  );
}
