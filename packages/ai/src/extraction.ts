import { ExtractionOutput } from '@shelf2kumo/contracts';
import { chatCompletion, imageDataUrlPart, type ChatCompletionResult, type ChatMessage, type FetchLike } from './client.ts';
import { ModelOutputError, parseModelJson, type ModelOutputKind } from './json.ts';
import type { AmdConfig } from './config.ts';
import {
  EXTRACTION_PROMPT_VERSION,
  EXTRACTION_USER_TEXT,
  extractionSystemPrompt,
  type ExtractionMode,
} from './prompts/extraction-v1.ts';

export type ExtractionFailureKind = ModelOutputKind;

/** The model answered, but not with a usable extraction. Never repaired by guessing. */
export class ExtractionOutputError extends ModelOutputError {
  constructor(kind: ExtractionFailureKind, message: string) {
    super(kind, message);
    this.name = 'ExtractionOutputError';
  }
}

/**
 * Strict parse of the model's text: one enclosing code fence may be removed, nothing else.
 * A `length` finish reason means the JSON may be cut off and is rejected even if it parses.
 */
export function parseExtractionContent(content: string, finishReason: string | null): ExtractionOutput {
  let json: unknown;
  try {
    json = parseModelJson(content, finishReason);
  } catch (error) {
    if (error instanceof ModelOutputError) throw new ExtractionOutputError(error.kind, error.message);
    throw error;
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
