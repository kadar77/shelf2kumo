import { ExtractionOutput } from '@shelf2kumo/contracts';
import { chatCompletion, imageDataUrlPart, type ChatCompletionResult, type ChatMessage, type FetchLike } from './client.ts';
import type { AmdConfig } from './config.ts';
import {
  EXTRACTION_PROMPT_VERSION,
  EXTRACTION_USER_TEXT,
  extractionSystemPrompt,
  type ExtractionMode,
} from './prompts/extraction-v1.ts';

export type ExtractionFailureKind = 'empty' | 'truncated' | 'not_json' | 'schema_invalid';

/** The model answered, but not with a usable extraction. Never repaired by guessing. */
export class ExtractionOutputError extends Error {
  readonly kind: ExtractionFailureKind;

  constructor(kind: ExtractionFailureKind, message: string) {
    super(message);
    this.name = 'ExtractionOutputError';
    this.kind = kind;
  }
}

const FENCE = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?```$/i;

/**
 * Strict parse of the model's text: one enclosing code fence may be removed, nothing else.
 * A `length` finish reason means the JSON may be cut off and is rejected even if it parses.
 */
export function parseExtractionContent(content: string, finishReason: string | null): ExtractionOutput {
  if (finishReason === 'length') throw new ExtractionOutputError('truncated', 'Model output was truncated');

  const trimmed = content.trim();
  if (trimmed === '') throw new ExtractionOutputError('empty', 'Model returned no content');

  const unfenced = FENCE.exec(trimmed)?.[1]?.trim() ?? trimmed;
  let json: unknown;
  try {
    json = JSON.parse(unfenced);
  } catch {
    throw new ExtractionOutputError('not_json', 'Model output is not JSON');
  }

  const parsed = ExtractionOutput.safeParse(json);
  if (!parsed.success) throw new ExtractionOutputError('schema_invalid', 'Model output does not match the extraction schema');
  return parsed.data;
}

export interface ExtractRequest {
  imageBytes: Uint8Array;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  mode: ExtractionMode;
  signal?: AbortSignal;
}

export interface ExtractResult {
  output: ExtractionOutput;
  promptVersion: string;
  completion: Omit<ChatCompletionResult, 'content'>;
}

/** The exact messages sent for an extraction (shared with evaluation scripts). */
export function extractionMessages(request: Omit<ExtractRequest, 'signal'>): ChatMessage[] {
  return [
    { role: 'system', content: extractionSystemPrompt(request.mode) },
    {
      role: 'user',
      content: [{ type: 'text', text: EXTRACTION_USER_TEXT }, imageDataUrlPart(request.imageBytes, request.mimeType)],
    },
  ];
}

/** One provider attempt. Retries and quotas belong to the job layer (spec §8). */
export async function extract(config: AmdConfig, request: ExtractRequest, fetchImpl?: FetchLike): Promise<ExtractResult> {
  const completion = await chatCompletion(config, { signal: request.signal, messages: extractionMessages(request) }, fetchImpl);
  const { content, ...rest } = completion;
  return { output: parseExtractionContent(content, completion.finishReason), promptVersion: EXTRACTION_PROMPT_VERSION, completion: rest };
}
