import { z } from 'zod';

export const DEFAULT_AMD_CHAT_COMPLETIONS_URL = 'https://developer.amd.com.cn/radeon/api/v1/chat/completions';
export const DEFAULT_AMD_MODEL = 'MiniCPM-V-4.7-35B-A3B';
export const DEFAULT_AMD_TIMEOUT_MS = 60_000;

const AmdConfigSchema = z.object({
  apiKey: z.string().min(1, 'AMD_API_KEY is not set'),
  url: z
    .url()
    .refine((value) => value.startsWith('https://'), 'AMD_CHAT_COMPLETIONS_URL must be https')
    .refine((value) => value.endsWith('/chat/completions'), 'AMD_CHAT_COMPLETIONS_URL must be the full endpoint'),
  model: z.string().min(1),
  timeoutMs: z.number().int().min(1000).max(120_000),
});

export type AmdConfig = z.infer<typeof AmdConfigSchema>;

/**
 * Chat completions URL from the hackathon-provided base URL (e.g. https://developer.amd.com.cn/radeon/api),
 * accepting bases with or without a trailing /v1.
 */
export function chatCompletionsUrlFromBase(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

/**
 * Reads adapter configuration from environment-like input. Throws without echoing secret values.
 * URL precedence: AMD_CHAT_COMPLETIONS_URL (exact) → AMD_BASE_URL (derived) → confirmed default.
 */
export function loadAmdConfig(env: Record<string, string | undefined>): AmdConfig {
  const result = AmdConfigSchema.safeParse({
    apiKey: env.AMD_API_KEY ?? '',
    url:
      env.AMD_CHAT_COMPLETIONS_URL ||
      (env.AMD_BASE_URL ? chatCompletionsUrlFromBase(env.AMD_BASE_URL) : DEFAULT_AMD_CHAT_COMPLETIONS_URL),
    model: env.AMD_MODEL || DEFAULT_AMD_MODEL,
    timeoutMs: env.AMD_REQUEST_TIMEOUT_MS ? Number(env.AMD_REQUEST_TIMEOUT_MS) : DEFAULT_AMD_TIMEOUT_MS,
  });
  if (!result.success) {
    const fields = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid AMD configuration (${fields.join('; ')})`);
  }
  return result.data;
}
