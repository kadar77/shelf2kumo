import { ChatProposal } from '@shelf2kumo/contracts';
import { chatCompletion, type ChatCompletionResult, type FetchLike } from './client.ts';
import type { AmdConfig } from './config.ts';
import { ModelOutputError, parseModelJson } from './json.ts';
import { CHAT_PROMPT_VERSION, CHAT_SYSTEM_PROMPT, chatUserMessage, type ChatContext } from './prompts/chat-v1.ts';

/** Strict parse of a chat proposal; invalid JSON or any unknown action rejects the whole proposal. */
export function parseChatProposal(content: string, finishReason: string | null): ChatProposal {
  const json = parseModelJson(content, finishReason);
  const parsed = ChatProposal.safeParse(json);
  if (!parsed.success) throw new ModelOutputError('schema_invalid', 'Model output does not match the chat proposal schema');
  return parsed.data;
}

export interface PlanResult {
  proposal: ChatProposal;
  promptVersion: string;
  completion: Omit<ChatCompletionResult, 'content'>;
}

/** One provider attempt to turn an owner's request into a validated proposal. */
export async function planChat(
  config: AmdConfig,
  request: { context: ChatContext; text: string; signal?: AbortSignal },
  fetchImpl?: FetchLike,
): Promise<PlanResult> {
  const completion = await chatCompletion(
    config,
    {
      signal: request.signal,
      messages: [
        { role: 'system', content: CHAT_SYSTEM_PROMPT },
        { role: 'user', content: chatUserMessage(request.context, request.text) },
      ],
    },
    fetchImpl,
  );
  const { content, ...rest } = completion;
  return { proposal: parseChatProposal(content, completion.finishReason), promptVersion: CHAT_PROMPT_VERSION, completion: rest };
}
