import { describe, expect, it, vi } from 'vitest';
import { AmdError, chatCompletion, loadAmdConfig, type FetchLike } from '../src/index.ts';

const config = loadAmdConfig({ AMD_API_KEY: 'test-key', AMD_REQUEST_TIMEOUT_MS: '2000' });

/**
 * FIXTURE: shape of the user-supplied successful response (spec §8): content "Hello!",
 * finish_reason "stop", usage counters, a provider-prefixed model and optional extra metadata.
 */
const sampleResponse = {
  id: 'chatcmpl-fixture',
  object: 'chat.completion',
  model: 'self-dploy/MiniCPM-V-4.7-35B-A3B',
  choices: [{ index: 0, message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
  cost: { amount: 0.0001 },
  metadata: { org: 'redacted' },
};

function respond(body: unknown, init: ResponseInit = {}): FetchLike {
  return async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
      ...init,
    });
}

const messages = [{ role: 'user' as const, content: 'Say hello in one sentence.' }];

describe('loadAmdConfig', () => {
  it('defaults to the confirmed endpoint and model', () => {
    expect(config.url).toBe('https://developer.amd.com.cn/radeon/api/v1/chat/completions');
    expect(config.model).toBe('MiniCPM-V-4.7-35B-A3B');
  });

  it('fails without a key and never echoes values', () => {
    expect(() => loadAmdConfig({})).toThrow(/AMD_API_KEY is not set/);
  });

  it('rejects a base URL without the full path', () => {
    expect(() => loadAmdConfig({ AMD_API_KEY: 'k', AMD_CHAT_COMPLETIONS_URL: 'https://x.example/v1' })).toThrow();
  });
});

describe('chatCompletion', () => {
  it('reads the confirmed response shape including a prefixed model identity', async () => {
    const result = await chatCompletion(config, { messages }, respond(sampleResponse));
    expect(result.content).toBe('Hello!');
    expect(result.finishReason).toBe('stop');
    expect(result.requestedModel).toBe('MiniCPM-V-4.7-35B-A3B');
    expect(result.returnedModel).toBe('self-dploy/MiniCPM-V-4.7-35B-A3B');
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 3, totalTokens: 15 });
  });

  it('sends only model and messages with bearer auth', async () => {
    const fetchSpy = vi.fn(respond(sampleResponse));
    await chatCompletion(config, { messages }, fetchSpy);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(config.url);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    expect(JSON.parse(init.body as string)).toEqual({ model: 'MiniCPM-V-4.7-35B-A3B', messages });
  });

  it('treats non-JSON bodies as malformed', async () => {
    await expect(chatCompletion(config, { messages }, respond('<html>oops</html>'))).rejects.toMatchObject({
      kind: 'malformed',
    });
  });

  it('treats empty choices as malformed', async () => {
    await expect(chatCompletion(config, { messages }, respond({ choices: [] }))).rejects.toMatchObject({
      kind: 'malformed',
    });
  });

  it('marks 429 retryable with Retry-After and 401 not retryable', async () => {
    const limited = chatCompletion(config, { messages }, respond('{}', { status: 429, headers: { 'retry-after': '3' } }));
    await expect(limited).rejects.toMatchObject({ kind: 'http', status: 429, retryable: true, retryAfterMs: 3000 });

    const unauthorized = chatCompletion(config, { messages }, respond('{}', { status: 401 }));
    await expect(unauthorized).rejects.toMatchObject({ kind: 'http', status: 401, retryable: false });
  });

  it('reports timeouts as retryable without leaking request data', async () => {
    const fast = loadAmdConfig({ AMD_API_KEY: 'secret-value', AMD_REQUEST_TIMEOUT_MS: '1000' });
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const error = await chatCompletion(fast, { messages }, hang).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AmdError);
    expect(error).toMatchObject({ kind: 'timeout', retryable: true });
    expect(String((error as Error).message)).not.toContain('secret-value');
  });
});
