import { AmdError, EXTRACTION_PROMPT_VERSION, ExtractionOutputError } from '@shelf2kumo/ai';
import type { ExtractionOutput } from '@shelf2kumo/contracts';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import type { Extractor } from './worker.ts';

/**
 * FIXTURE extractor for the Functions emulator only. Never used in deployed functions; jobs record
 * model "fixture" so results are distinguishable from live inference.
 *
 * Behavior per image is read from `emulatorFixtures/{renditionContentHash}`:
 *   { output?: ExtractionOutput, failures?: ('timeout'|'http_500'|'http_401'|'not_json')[], delayMs?: number }
 * Each call consumes the next listed failure; afterwards `output` (or the default) is returned.
 */
export const DEFAULT_FIXTURE_OUTPUT: ExtractionOutput = {
  schemaVersion: 1,
  items: [
    {
      name: '【フィクスチャ】テスト商品',
      description: null,
      category: null,
      priceJpy: null,
      taxTreatment: 'unknown',
      evidenceText: null,
      uncertainFields: ['priceJpy'],
    },
  ],
  productCountEstimate: 1,
  warnings: ['FIXTURE: emulator fixture output, not live inference'],
};

export function useExtractionFixtures(env: NodeJS.ProcessEnv): boolean {
  return env.FUNCTIONS_EMULATOR === 'true' && env.EXTRACTION_FIXTURES === 'true';
}

export function fixtureExtractor(db: Firestore): Extractor {
  return async (request) => {
    const hash = createHash('sha256').update(request.imageBytes).digest('hex');
    const ref = db.doc(`emulatorFixtures/${hash}`);
    const fixture = (await ref.get()).data() ?? {};
    const calls = Number(fixture.calls ?? 0);
    await ref.set({ calls: FieldValue.increment(1) }, { merge: true });

    const delayMs = Number(fixture.delayMs ?? 300);
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    const failure = (fixture.failures as string[] | undefined)?.[calls];
    if (failure === 'timeout') throw new AmdError('timeout', 'Request timed out (fixture)', { retryable: true });
    if (failure === 'http_500') throw new AmdError('http', 'HTTP 500', { status: 500, retryable: true });
    if (failure === 'http_401') throw new AmdError('http', 'HTTP 401', { status: 401, retryable: false });
    if (failure === 'not_json') throw new ExtractionOutputError('not_json', 'Model output is not JSON (fixture)');

    return {
      output: (fixture.output as ExtractionOutput | undefined) ?? DEFAULT_FIXTURE_OUTPUT,
      promptVersion: EXTRACTION_PROMPT_VERSION,
      completion: {
        finishReason: 'stop',
        requestedModel: 'fixture',
        returnedModel: 'fixture',
        usage: {},
        latencyMs: delayMs,
        providerRequestId: null,
      },
    };
  };
}
