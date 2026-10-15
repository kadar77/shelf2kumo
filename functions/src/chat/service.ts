import {
  CHAT_LIMITS,
  type ActionState,
  type FieldDiff,
  type ItemDoc,
  type SendChatRequest,
  type SendChatResponse,
  type ThemeTokens,
} from '@shelf2kumo/contracts';
import { FieldValue, type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { HttpError, notFound } from '../api/http.ts';
import type { ExtractionJobService } from '../extraction/jobs.ts';
import { usageRef } from '../extraction/usage.ts';
import { applyOps } from './apply.ts';
import { ApplyConflict, type AppliedRecord, type ResolvedOp } from './ops.ts';

export const messagesCol = (db: Firestore, shopId: string) => db.collection(`shops/${shopId}/conversations/main/messages`);
export const actionsCol = (db: Firestore, shopId: string) => db.collection(`shops/${shopId}/actions`);

export interface ChatService {
  send(ownerId: string, shopId: string, request: SendChatRequest): Promise<SendChatResponse>;
  applyAction(ownerId: string, shopId: string, actionId: string): Promise<void>;
  applyRequest(ownerId: string, shopId: string, requestId: string): Promise<void>;
  undo(ownerId: string, shopId: string, actionId: string): Promise<void>;
  clearHistory(ownerId: string, shopId: string): Promise<number>;
}

/** Action document fields shared by chat-applied, owner-applied and undo actions. */
export function actionData(
  record: Pick<AppliedRecord, 'op' | 'label' | 'diffs' | 'before' | 'after' | 'afterRevision' | 'undoable'>,
  state: ActionState,
  extra: { requestId: string | null; undoOf?: string | null; actor: 'chat' | 'owner' },
) {
  return {
    type: record.op.type === 'restoreItem' ? 'undo' : record.op.type,
    op: record.op,
    state,
    requestId: extra.requestId,
    label: record.label,
    diffs: record.diffs,
    before: record.before,
    after: record.after,
    afterRevision: record.afterRevision,
    undoable: record.undoable && state === 'applied',
    undoOf: extra.undoOf ?? null,
    error: null,
    actor: extra.actor,
    createdAt: FieldValue.serverTimestamp(),
    ...(state === 'applied' ? { appliedAt: FieldValue.serverTimestamp() } : {}),
  };
}

async function ownedShop(tx: Transaction | null, db: Firestore, shopId: string, ownerId: string) {
  const ref = db.doc(`shops/${shopId}`);
  const shop = tx ? await tx.get(ref) : await ref.get();
  if (!shop.exists || shop.get('ownerId') !== ownerId) throw notFound();
}

const conflict = (error: unknown) => (error instanceof ApplyConflict ? new HttpError(409, 'revision_conflict', error.message) : error);

/** Inverse of an applied operation, expecting the target unchanged since (spec §8 Undo). */
function inverseOf(data: FirebaseFirestore.DocumentData): ResolvedOp {
  const op = data.op as ResolvedOp;
  const before = (data.before ?? {}) as Record<string, unknown>;
  switch (op.type) {
    case 'updateProfile':
      return { type: 'updateProfile', changes: before, expectedRevision: Number(data.afterRevision) };
    case 'updateItem':
      return { type: 'updateItem', itemId: op.itemId, changes: before, expectedRevision: Number(data.afterRevision) };
    case 'createItem':
      return { type: 'removeItem', itemId: op.itemId, expectedRevision: Number(data.afterRevision) };
    case 'removeItem':
      return { type: 'restoreItem', itemId: op.itemId, item: before as unknown as ItemDoc };
    case 'reorderItems':
      return { type: 'reorderItems', itemIds: (before.order as string[]) ?? [], expectedOrder: op.itemIds };
    case 'setTheme':
      return { type: 'setTheme', tokens: before.tokens as ThemeTokens, expectedRevision: Number(data.afterRevision), accentAdjusted: false };
    default:
      throw new HttpError(409, 'conflict', 'この操作は元に戻せません。');
  }
}

export function firestoreChatService(db: Firestore, extractions: ExtractionJobService, now: () => number = Date.now): ChatService {
  async function applyProposed(ownerId: string, shopId: string, refs: DocumentReference[]) {
    try {
      await db.runTransaction(async (tx) => {
        const snapshots = await Promise.all(refs.map((ref) => tx.get(ref)));
        if (snapshots.some((snapshot) => !snapshot.exists)) throw notFound();
        if (snapshots.some((snapshot) => snapshot.get('state') !== 'proposed')) {
          throw new HttpError(409, 'conflict', 'この変更はすでに処理されています。');
        }
        const records = await applyOps(tx, db, shopId, ownerId, snapshots.map((snapshot) => snapshot.get('op') as ResolvedOp));
        snapshots.forEach((snapshot, index) => {
          const record = records[index] as AppliedRecord;
          tx.set(snapshot.ref, actionData(record, 'applied', { requestId: snapshot.get('requestId') ?? null, actor: 'owner' }));
        });
      });
    } catch (error) {
      throw conflict(error);
    }
  }

  return {
    async send(ownerId, shopId, request) {
      await ownedShop(null, db, shopId, ownerId);
      const requestRef = db.doc(`shops/${shopId}/chatRequests/${request.requestId}`);

      if (request.imageId) {
        // A photo in chat starts an extraction job; the job state is shown in the conversation.
        const existing = await requestRef.get();
        if (existing.exists) return { requestId: request.requestId, duplicate: true };
        const job = await extractions.create(ownerId, shopId, { imageId: request.imageId });
        await db.runTransaction(async (tx) => {
          if ((await tx.get(requestRef)).exists) return;
          tx.create(requestRef, { ownerId, kind: 'photo', state: 'succeeded', imageId: request.imageId, jobId: job.jobId, createdAt: FieldValue.serverTimestamp() });
          tx.create(messagesCol(db, shopId).doc(), message('owner', '', request.requestId, { imageId: request.imageId }));
          tx.create(
            messagesCol(db, shopId).doc(),
            message('assistant', '写真を受け取りました。商品情報を読み取っています（15〜30 秒ほど）。', request.requestId, { jobId: job.jobId }),
          );
        });
        return { requestId: request.requestId, duplicate: false };
      }

      return db.runTransaction(async (tx) => {
        const existing = await tx.get(requestRef);
        if (existing.exists) {
          if (existing.get('ownerId') !== ownerId) throw notFound();
          return { requestId: request.requestId, duplicate: true };
        }
        const usage = usageRef(db, ownerId, now());
        const used = Number((await tx.get(usage)).get('chatRequests') ?? 0);
        if (used >= CHAT_LIMITS.dailyRequests) {
          throw new HttpError(429, 'quota_exceeded', `本日のチャット回数の上限（${CHAT_LIMITS.dailyRequests} 回）に達しました。フォームから編集できます。`);
        }
        tx.set(usage, { ownerId, chatRequests: used + 1 }, { merge: true });
        tx.create(requestRef, { ownerId, kind: 'text', state: 'queued', text: request.text, createdAt: FieldValue.serverTimestamp() });
        tx.create(messagesCol(db, shopId).doc(), message('owner', request.text ?? '', request.requestId));
        return { requestId: request.requestId, duplicate: false };
      });
    },

    async applyAction(ownerId, shopId, actionId) {
      await ownedShop(null, db, shopId, ownerId);
      await applyProposed(ownerId, shopId, [actionsCol(db, shopId).doc(actionId)]);
    },

    async applyRequest(ownerId, shopId, requestId) {
      await ownedShop(null, db, shopId, ownerId);
      const proposed = await actionsCol(db, shopId).where('requestId', '==', requestId).where('state', '==', 'proposed').get();
      if (proposed.empty) throw new HttpError(409, 'conflict', '適用できる変更はありません。');
      await applyProposed(ownerId, shopId, proposed.docs.map((doc) => doc.ref));
    },

    async undo(ownerId, shopId, actionId) {
      await ownedShop(null, db, shopId, ownerId);
      const ref = actionsCol(db, shopId).doc(actionId);
      try {
        await db.runTransaction(async (tx) => {
          const action = await tx.get(ref);
          if (!action.exists) throw notFound();
          if (action.get('state') !== 'applied' || !action.get('undoable')) {
            throw new HttpError(409, 'conflict', 'この変更は元に戻せません。');
          }
          const inverse = inverseOf(action.data() as FirebaseFirestore.DocumentData);
          let records: AppliedRecord[];
          try {
            records = await applyOps(tx, db, shopId, ownerId, [inverse]);
          } catch (error) {
            if (error instanceof ApplyConflict) {
              throw new ApplyConflict('この変更のあとに別の変更があるため、元に戻せません。');
            }
            throw error;
          }
          const record = records[0] as AppliedRecord;
          tx.update(ref, { state: 'undone', undoable: false, undoneAt: FieldValue.serverTimestamp() });
          tx.create(actionsCol(db, shopId).doc(), {
            ...actionData({ ...record, undoable: false, label: `${action.get('label')}（元に戻す）` }, 'applied', {
              requestId: action.get('requestId') ?? null,
              undoOf: actionId,
              actor: 'owner',
            }),
            type: 'undo',
          });
        });
      } catch (error) {
        throw conflict(error);
      }
    },

    async clearHistory(ownerId, shopId) {
      await ownedShop(null, db, shopId, ownerId);
      // Messages are deleted; actions (change audit) and catalog data stay. Request texts are blanked.
      let removed = 0;
      for (;;) {
        const page = await messagesCol(db, shopId).limit(300).get();
        if (page.empty) break;
        const batch = db.batch();
        page.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        removed += page.size;
      }
      const requests = await db.collection(`shops/${shopId}/chatRequests`).where('kind', '==', 'text').get();
      for (let i = 0; i < requests.docs.length; i += 300) {
        const batch = db.batch();
        requests.docs.slice(i, i + 300).forEach((doc) => batch.update(doc.ref, { text: null }));
        await batch.commit();
      }
      return removed;
    },
  };
}

export function message(
  role: 'owner' | 'assistant',
  text: string,
  requestId: string | null,
  extra: { imageId?: string; jobId?: string; actionIds?: string[]; clarification?: boolean; model?: string | null } = {},
) {
  return {
    role,
    text,
    requestId,
    imageId: extra.imageId ?? null,
    jobId: extra.jobId ?? null,
    actionIds: extra.actionIds ?? [],
    clarification: extra.clarification ?? false,
    model: extra.model ?? null,
    createdAt: FieldValue.serverTimestamp(),
  };
}

/** Preview of a proposed (not yet applied) operation for the owner to review. */
export function proposedPreview(op: ResolvedOp, names: Map<string, string | null>): { label: string; diffs: FieldDiff[] } {
  switch (op.type) {
    case 'removeItem':
      return { label: names.get(op.itemId) ?? '商品', diffs: [] };
    case 'updateItem':
      return {
        label: names.get(op.itemId) ?? '商品',
        diffs: Object.entries(op.changes).map(([field, after]) => ({ field, before: null, after: (after ?? null) as FieldDiff['after'] })),
      };
    case 'createItem':
      return { label: op.fields.name ?? '新しい商品', diffs: [] };
    case 'updateProfile':
      return { label: '店舗情報', diffs: Object.entries(op.changes).map(([field, after]) => ({ field, before: null, after: after ?? null })) };
    case 'setTheme':
      return { label: 'テーマ', diffs: [] };
    case 'reorderItems':
      return { label: '並び順', diffs: [] };
    default:
      return { label: '', diffs: [] };
  }
}
