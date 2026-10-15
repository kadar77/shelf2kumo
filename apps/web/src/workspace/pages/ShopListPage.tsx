import { CreateShopRequest, type CreateShopResponse } from '@shelf2kumo/contracts';
import { signOut } from 'firebase/auth';
import { useId, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ApiRequestError, apiFetch } from '../api.ts';
import { useAuth } from '../auth/AuthProvider.tsx';
import { useMyShops } from '../data/shops.ts';
import { auth } from '../firebase.ts';

function CreateShopForm() {
  const id = useId();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = CreateShopRequest.safeParse({ name: name.trim() });
    if (!parsed.success) {
      setError('お店の名前を 1〜200 文字で入力してください。');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await apiFetch<CreateShopResponse>('POST', '/api/shops', parsed.data);
      navigate(`/app/shops/${created.shopId}`);
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'ショップを作成できませんでした。');
      setSubmitting(false);
    }
  }

  return (
    <form className="ws-form ws-create-shop" onSubmit={submit} noValidate>
      <div className="ws-field">
        <label htmlFor={id}>新しいお店の名前</label>
        <input id={id} type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder="例：器と道具 こもれび" />
      </div>
      {error && (
        <p className="ws-form-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="ws-button ws-button-primary" disabled={submitting}>
        {submitting ? '作成中…' : 'ショップを作成'}
      </button>
    </form>
  );
}

export function ShopListPage() {
  const { user } = useAuth();
  const location = useLocation();
  const shops = useMyShops(user?.uid ?? '');
  const welcome = (location.state as { welcome?: boolean } | null)?.welcome === true;

  return (
    <main className="ws-page">
      <div className="ws-page-header">
        <p className="ws-brand">Shelf2Kumo</p>
        <button type="button" className="ws-link-button" onClick={() => signOut(auth)}>
          ログアウト
        </button>
      </div>
      <h1>あなたのショップ</h1>
      {welcome && !user?.emailVerified && (
        <p className="ws-notice-success" role="status">
          登録ありがとうございます。確認メールを {user?.email} に送信しました。
        </p>
      )}

      {shops.status === 'loading' && (
        <p className="ws-muted" role="status">
          読み込み中…
        </p>
      )}
      {shops.status === 'error' && (
        <p className="ws-form-error" role="alert">
          {shops.message}
        </p>
      )}
      {shops.status === 'ready' && shops.data.length === 0 && (
        <p className="ws-muted">まだショップがありません。お店の名前を入力して作成しましょう。</p>
      )}
      {shops.status === 'ready' && shops.data.length > 0 && (
        <ul className="ws-shop-list">
          {shops.data.map((shop) => (
            <li key={shop.id}>
              <Link className="ws-shop-card" to={`/app/shops/${shop.id}`}>
                <span className="ws-shop-name">{shop.name}</span>
                <span className="ws-muted ws-small">{shop.liveReleaseId ? '公開中' : '未公開'}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <CreateShopForm />
    </main>
  );
}
