import { AmdError, CHAT_PROMPT_VERSION, ModelOutputError } from '@shelf2kumo/ai';
import type { ChatProposal } from '@shelf2kumo/contracts';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import type { Planner } from './worker.ts';

/**
 * FIXTURE chat planner for the Functions emulator only (never deployed; replies record model
 * "fixture"). Behavior per owner text is read from `emulatorFixtures/chat-{sha256(text)}`:
 *   { proposal?: ChatProposal, failures?: ('timeout'|'not_json')[] }
 */
export const chatFixtureKey = (text: string) => `chat-${createHash('sha256').update(text).digest('hex')}`;

export function fixturePlanner(db: Firestore): Planner {
  return async ({ text }) => {
    const ref = db.doc(`emulatorFixtures/${chatFixtureKey(text)}`);
    const fixture = (await ref.get()).data() ?? {};
    const calls = Number(fixture.calls ?? 0);
    await ref.set({ calls: FieldValue.increment(1) }, { merge: true });
    const failure = (fixture.failures as string[] | undefined)?.[calls];
    if (failure === 'timeout') throw new AmdError('timeout', 'Request timed out (fixture)', { retryable: true });
    if (failure === 'not_json') throw new ModelOutputError('not_json', 'Model output is not JSON (fixture)');
    const proposal = (fixture.proposal as ChatProposal | undefined) ?? { message: '【フィクスチャ】承知しました。', clarification: null, actions: [] };
    return {
      proposal,
      promptVersion: CHAT_PROMPT_VERSION,
      completion: { finishReason: 'stop', requestedModel: 'fixture', returnedModel: 'fixture', usage: {}, latencyMs: 50, providerRequestId: null },
    };
  };
}
