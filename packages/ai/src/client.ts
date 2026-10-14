import { z } from 'zod';
import type { AmdConfig } from './config.ts';
import { AmdError, isRetryableStatus, parseRetryAfterMs } from './errors.ts';

export type TextPart = { type: 'text'; text: string };

/**
 * HYPOTHESIS (spec §8 vision gate): OpenAI-style image part carrying a base64 data URL.
 * Not confirmed AMD behavior; keep all image serialization in this module.
 */
export type ImageUrlPart = { type: 'image_url'; image_url: { url: string } };

export type ChatMessage =
  | { role: 'system' | 'assistant'; content: string }
  | { role: 'user'; content: string | Array<TextPart | ImageUrlPart> };

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  signal?: AbortSignal;
  /** Extra provider parameters are not sent; only `model` and `messages` are confirmed. */
}

export interface ChatCompletionUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ChatCompletionResult {
  content: string;
  finishReason: string | null;
  requestedModel: string;
  /** May carry a provider prefix such as `self-dploy/`; never required to equal requestedModel. */
  returnedModel: string | null;
  usage: ChatCompletionUsage;
  latencyMs: number;
  providerRequestId: string | null;
}

/** Confirmed fields only; everything else (cost, metadata) is optional and ignored. */
const ResponseSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string() }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .optional(),
});

export function imageDataUrlPart(bytes: Uint8Array, mimeType: 'image/jpeg' | 'image/png' | 'image/webp'): ImageUrlPart {
  return { type: 'image_url', image_url: { url: `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}` } };
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Safe diagnostic: the underlying system/undici error code (e.g. ECONNRESET), never a message or payload. */
function networkErrorCode(error: unknown): string {
  const cause = error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
  if (cause && typeof cause.code === 'string' && /^[A-Z0-9_]{2,40}$/.test(cause.code)) return cause.code;
  return error instanceof Error ? error.name : 'unknown';
}

export async function chatCompletion(
  config: AmdConfig,
  request: ChatCompletionRequest,
  fetchImpl: FetchLike = fetch,
): Promise<ChatCompletionResult> {
  const timeout = AbortSignal.timeout(config.timeoutMs);
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
  const started = performance.now();

  let response: Response;
  try {
    response = await fetchImpl(config.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: config.model, messages: request.messages }),
      signal,
    });
  } catch (error) {
    if (timeout.aborted) throw new AmdError('timeout', `Request timed out after ${config.timeoutMs} ms`, { retryable: true });
    if (request.signal?.aborted) throw new AmdError('aborted', 'Request aborted');
    throw new AmdError('network', `Network error: ${networkErrorCode(error)}`, { retryable: true });
  }

  const latencyMs = Math.round(performance.now() - started);

  if (!response.ok) {
    await response.body?.cancel();
    throw new AmdError('http', `HTTP ${response.status}`, {
      status: response.status,
      retryable: isRetryableStatus(response.status),
      retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
    });
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new AmdError('malformed', 'Response body is not JSON');
  }

  const parsed = ResponseSchema.safeParse(json);
  if (!parsed.success) throw new AmdError('malformed', 'Unexpected response shape');

  const choice = parsed.data.choices[0] as (typeof parsed.data.choices)[number];
  const usage = parsed.data.usage;
  return {
    content: choice.message.content,
    finishReason: choice.finish_reason ?? null,
    requestedModel: config.model,
    returnedModel: parsed.data.model ?? null,
    usage: {
      promptTokens: usage?.prompt_tokens,
      completionTokens: usage?.completion_tokens,
      totalTokens: usage?.total_tokens,
    },
    latencyMs,
    providerRequestId: response.headers.get('x-request-id'),
  };
}
