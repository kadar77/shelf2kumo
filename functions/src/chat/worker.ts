import { AmdError, ModelOutputError, type ChatContext, type PlanResult } from '@shelf2kumo/ai';
import { CHAT_LIMITS } from '@shelf2kumo/contracts';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { applyOps } from './apply.ts';
import { humanizeReply } from './humanize.ts';
import { ApplyConflict, isMutation, type AppliedRecord } from './ops.ts';
import { loadPlanningState, resolveProposal } from './resolve.ts';
import { actionData, actionsCol, message, messagesCol, proposedPreview } from './service.ts';

/** One planning attempt; `attempt` (1-based) lets the live planner fall back to the next model. */
export type Planner = (input: { context: ChatContext; text: string }, attempt: number) => Promise<PlanResult>;

export interface ChatWorkerDeps {
  db: Firestore;
  planner: Planner;
  /** Planning attempts per request (default 2); the live planner uses one per model in its chain. */
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string, data: Record<string, unknown>) => void;
}


const AI_DOWN = 'AI に接続できませんでした。時間をおいて再度お試しいただくか、カタログのフォームから編集してください。';
const AI_UNCLEAR = 'うまく理解できませんでした。言い方を変えてもう一度お試しいただくか、カタログのフォームから編集してください。';
const CONFLICT = '内容が更新されたため、変更を適用できませんでした。最新の状態でもう一度お試しください。';

/** Processes one queued chat request. Safe to call repeatedly: only the claimer proceeds. */
export async function runChatRequest(input: ChatWorkerDeps, shopId: string, requestId: string): Promise<'not_queued' | 'done'> {
  const deps = { sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)), log: () => undefined, ...input };
  const { db } = deps;
  const requestRef = db.doc(`shops/${shopId}/chatRequests/${requestId}`);

  const claimed = await db.runTransaction(async (tx) => {
    const request = await tx.get(requestRef);
    if (!request.exists || request.get('state') !== 'queued') return null;
    tx.update(requestRef, { state: 'running', startedAt: FieldValue.serverTimestamp() });
    return { ownerId: String(request.get('ownerId')), text: String(request.get('text') ?? '') };
  });
  if (!claimed) return 'not_queued';

  const finish = async (
    reply: string,
    outcome: string,
    extra: { clarification?: boolean; model?: string | null; meta?: Record<string, unknown>; failed?: boolean } = {},
  ) => {
    const batch = db.batch();
    batch.create(messagesCol(db, shopId).doc(), message('assistant', reply, requestId, { clarification: extra.clarification, model: extra.model ?? null }));
    batch.update(requestRef, { state: extra.failed ? 'failed' : 'succeeded', outcome, finishedAt: FieldValue.serverTimestamp(), ...(extra.meta ?? {}) });
    await batch.commit();
    return 'done' as const;
  };

  // Recent conversation (text only, bounded) as data; the current request is sent separately.
  const recent = await messagesCol(db, shopId).orderBy('createdAt', 'desc').limit(CHAT_LIMITS.contextMessages + 1).get();
  const recentMessages = recent.docs
    .filter((doc) => doc.get('requestId') !== requestId && typeof doc.get('text') === 'string' && doc.get('text') !== '')
    .slice(0, CHAT_LIMITS.contextMessages)
    .reverse()
    .map((doc) => ({ role: doc.get('role') as 'owner' | 'assistant', text: String(doc.get('text')).slice(0, 300) }));
  const state = await loadPlanningState(db, shopId, recentMessages);

  const maxAttempts = deps.maxAttempts ?? 2;
  let plan: PlanResult | null = null;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts && !plan; attempt += 1) {
    try {
      plan = await deps.planner({ context: state.context, text: claimed.text }, attempt);
    } catch (error) {
      lastError = error;
      const retryable = error instanceof ModelOutputError || (error instanceof AmdError && error.retryable);
      deps.log('chat planning attempt failed', {
        requestId,
        attempt,
        errorClass: error instanceof Error ? error.name : 'unknown',
        kind: (error as { kind?: string }).kind ?? null,
        status: (error as { status?: number }).status ?? null,
        retryable,
      });
      if (!retryable) break;
      if (attempt < maxAttempts) await deps.sleep(1_000);
    }
  }
  if (!plan) return finish(lastError instanceof ModelOutputError ? AI_UNCLEAR : AI_DOWN, 'ai_failed', { failed: true });

  const meta = {
    model: plan.completion.requestedModel,
    returnedModel: plan.completion.returnedModel,
    promptVersion: plan.promptVersion,
    latencyMs: plan.completion.latencyMs,
    totalTokens: plan.completion.usage.totalTokens ?? null,
  };
  deps.log('chat planned', { requestId, ...meta, actions: plan.proposal.actions.map((action) => action.type) });
  const proposal = { ...plan.proposal, message: humanizeReply(plan.proposal.message), clarification: plan.proposal.clarification ? humanizeReply(plan.proposal.clarification) : plan.proposal.clarification };

  if (proposal.clarification || proposal.actions.length === 0) {
    const reply = proposal.clarification && !proposal.message.includes(proposal.clarification) ? `${proposal.message}\n${proposal.clarification}` : proposal.message;
    return finish(reply, proposal.clarification ? 'clarification' : 'reply', { clarification: Boolean(proposal.clarification), model: meta.model, meta });
  }

  const resolution = resolveProposal(proposal, state, () => db.collection(`shops/${shopId}/items`).doc().id);
  if (resolution.kind === 'invalid') {
    return finish(`ご依頼を反映できませんでした（${resolution.reason}）。もう一度お試しいただくか、フォームから編集してください。`, 'rejected', {
      model: meta.model,
      meta,
    });
  }

  const themeNote = resolution.ops.some((op) => op.type === 'setTheme' && op.accentAdjusted) ? ' 読みやすさのため、色を少し調整しました。' : '';
  const names = new Map(state.context.items.map((item) => [state.refToItemId.get(item.ref) as string, item.name]));

  try {
    await db.runTransaction(async (tx) => {
      const actionIds: string[] = [];
      let reply = proposal.message + themeNote;
      if (resolution.policy === 'auto') {
        const records = await applyOps(tx, db, shopId, claimed.ownerId, resolution.ops);
        for (const record of records) {
          const ref = actionsCol(db, shopId).doc();
          actionIds.push(ref.id);
          tx.create(ref, actionData(record, 'applied', { requestId, actor: 'chat' }));
        }
      } else {
        for (const op of resolution.ops) {
          const ref = actionsCol(db, shopId).doc();
          actionIds.push(ref.id);
          const preview = proposedPreview(op, names);
          const record: AppliedRecord = { op, ...preview, before: null, after: null, afterRevision: null, undoable: isMutation(op) };
          tx.create(ref, actionData(record, 'proposed', { requestId, actor: 'chat' }));
        }
        reply += ' 内容を確認して「適用」を押すと反映されます。';
      }
      tx.create(messagesCol(db, shopId).doc(), message('assistant', reply, requestId, { actionIds, model: meta.model }));
      tx.update(requestRef, { state: 'succeeded', outcome: resolution.policy === 'auto' ? 'applied' : 'proposed', finishedAt: FieldValue.serverTimestamp(), ...meta });
    });
    return 'done';
  } catch (error) {
    if (error instanceof ApplyConflict) return finish(CONFLICT, 'conflict', { model: meta.model, meta });
    throw error;
  }
}
