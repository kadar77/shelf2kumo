export function ChatPanel() {
  return (
    <div className="ws-chat-layout">
      <ol className="ws-messages" aria-live="polite" aria-label="会話">
        <li className="ws-message ws-message-assistant">
          こんにちは！お店について教えてください。商品の写真を送ると、自動で商品ページの下書きを作成します。
        </li>
      </ol>
      <p className="ws-notice">チャットでの編集は次の開発段階で利用できます。写真の追加と商品の編集は「カタログ」からできます。</p>
      <form className="ws-composer" onSubmit={(event) => event.preventDefault()}>
        <label htmlFor="ws-composer-input" className="ws-visually-hidden">
          メッセージ
        </label>
        <textarea id="ws-composer-input" rows={2} placeholder="例：ほうじ茶の価格を 800 円に変更して" disabled />
        <div className="ws-composer-actions">
          <button type="button" className="ws-button" disabled>
            写真を追加
          </button>
          <button type="submit" className="ws-button ws-button-primary" disabled>
            送信
          </button>
        </div>
      </form>
    </div>
  );
}
