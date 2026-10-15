import type { ActionState, ActionSummary, ChatMessageDoc, FieldDiff, ThemeTokens } from '@shelf2kumo/contracts';
import { PRESETS } from '@shelf2kumo/themes';
import { collection, doc, limit, limitToLast, onSnapshot, orderBy, query, type Timestamp } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../firestore.ts';

export type MessageWithId = ChatMessageDoc & { id: string; createdAtMs: number | null };
export type ActionWithId = ActionSummary & { id: string };

/** Live conversation (oldest first, last 100 messages). */
export function useMessages(shopId: string): MessageWithId[] | null {
  const [messages, setMessages] = useState<MessageWithId[] | null>(null);
  useEffect(
    () =>
      onSnapshot(query(collection(db, 'shops', shopId, 'conversations', 'main', 'messages'), orderBy('createdAt'), limitToLast(100)), (snapshot) =>
        setMessages(
          snapshot.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              role: data.role === 'owner' ? 'owner' : 'assistant',
              text: String(data.text ?? ''),
              requestId: typeof data.requestId === 'string' ? data.requestId : null,
              imageId: typeof data.imageId === 'string' ? data.imageId : null,
              jobId: typeof data.jobId === 'string' ? data.jobId : null,
              actionIds: Array.isArray(data.actionIds) ? data.actionIds.map(String) : [],
              clarification: data.clarification === true,
              model: typeof data.model === 'string' ? data.model : null,
              createdAtMs: (data.createdAt as Timestamp | null)?.toMillis() ?? null,
            };
          }),
        ),
      ),
    [shopId],
  );
  return messages;
}

/** Live recent actions keyed by ID, for the action cards in assistant messages. */
export function useActions(shopId: string): Map<string, ActionWithId> {
  const [actions, setActions] = useState<Map<string, ActionWithId>>(new Map());
  useEffect(
    () =>
      onSnapshot(query(collection(db, 'shops', shopId, 'actions'), orderBy('createdAt', 'desc'), limit(300)), (snapshot) =>
        setActions(
          new Map(
            snapshot.docs.map((d) => {
              const data = d.data();
              return [
                d.id,
                {
                  id: d.id,
                  type: data.type,
                  state: data.state as ActionState,
                  requestId: typeof data.requestId === 'string' ? data.requestId : null,
                  label: String(data.label ?? ''),
                  diffs: Array.isArray(data.diffs) ? (data.diffs as FieldDiff[]) : [],
                  undoable: data.undoable === true,
                  undoOf: typeof data.undoOf === 'string' ? data.undoOf : null,
                  error: typeof data.error === 'string' ? data.error : null,
                },
              ];
            }),
          ),
        ),
      ),
    [shopId],
  );
  return actions;
}

export interface SavedTheme {
  tokens: ThemeTokens;
  revision: number;
}

/** Live saved theme (draft); the Modern preset until the owner changes it. */
export function useTheme(shopId: string): SavedTheme {
  const [theme, setTheme] = useState<SavedTheme>({ tokens: PRESETS.modern, revision: 0 });
  useEffect(
    () =>
      onSnapshot(doc(db, 'shops', shopId, 'theme', 'current'), (snapshot) => {
        const data = snapshot.data();
        setTheme(data ? { tokens: data.tokens as ThemeTokens, revision: Number(data.revision ?? 0) } : { tokens: PRESETS.modern, revision: 0 });
      }),
    [shopId],
  );
  return theme;
}
