import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <main className="ws-page">
      <h1>ページが見つかりません</h1>
      <p className="ws-muted">URL が正しいかご確認ください。</p>
      <p>
        <Link to="/app">ショップ一覧へ戻る</Link>
      </p>
    </main>
  );
}
