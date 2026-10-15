/** Persistent publication status and action. Publishing is wired up in Phase 5. */
export function PublishBar({ live }: { live: boolean }) {
  return (
    <div className="ws-publish">
      <span className="ws-status" role="status">
        {live ? '公開中' : '未公開'}
      </span>
      <button type="button" className="ws-button ws-button-primary" disabled title="公開機能は準備中です">
        公開する
      </button>
    </div>
  );
}
