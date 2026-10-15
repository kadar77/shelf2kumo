import { AmdError, chatCompletion, type AmdConfig } from '@shelf2kumo/ai';

/**
 * One text request to AMD from wherever this code runs (spec P0-4: reachability from the deployed
 * region). Returns sanitized evidence only: no key, headers, provider metadata or content beyond a
 * short preview.
 */
export async function amdReachabilityCheck(config: AmdConfig, region: string): Promise<Record<string, unknown>> {
  const startedAt = new Date().toISOString();
  try {
    const result = await chatCompletion(config, {
      messages: [{ role: 'user', content: '日本語で一文だけ挨拶してください。' }],
    });
    return {
      outcome: 'passed',
      region,
      startedAt,
      endpointHost: new URL(config.url).host,
      requestedModel: result.requestedModel,
      returnedModel: result.returnedModel,
      finishReason: result.finishReason,
      latencyMs: result.latencyMs,
      contentPreview: result.content.slice(0, 80),
    };
  } catch (error) {
    return {
      outcome: 'failed',
      region,
      startedAt,
      ...(error instanceof AmdError
        ? { kind: error.kind, status: error.status ?? null, detail: error.message }
        : { kind: 'unexpected', name: error instanceof Error ? error.name : 'unknown' }),
    };
  }
}
