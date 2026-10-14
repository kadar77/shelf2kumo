// Manual AMD connectivity check (spec §10 P0-4 / P0-5). Makes ONE paid provider request.
// Never part of automated tests.
//
//   pnpm smoke:amd                                   text request
//   pnpm smoke:amd --image path/to.jpg --consented   vision compatibility gate (hypothesized payload)
//   pnpm smoke:amd --model <name>                    try another model explicitly
//
// The model is the spec default unless --model is given; a shell AMD_MODEL is deliberately ignored
// so gate evidence always names the model under test.
// Prints sanitized evidence only: no key, headers, provider metadata or image bytes.
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import {
  AmdError,
  DEFAULT_AMD_MODEL,
  chatCompletion,
  imageDataUrlPart,
  loadAmdConfig,
  type ChatMessage,
} from '../packages/ai/src/index.ts';

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
const imagePath = flag('--image');
const model = flag('--model') ?? DEFAULT_AMD_MODEL;

const MIME: Record<string, 'image/jpeg' | 'image/png' | 'image/webp'> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

async function buildMessages(): Promise<{ mode: 'text' | 'image'; messages: ChatMessage[] }> {
  if (!imagePath) {
    return { mode: 'text', messages: [{ role: 'user', content: '日本語で一文だけ挨拶してください。' }] };
  }
  if (!args.includes('--consented')) {
    throw new Error('Image requests require --consented: confirm the image owner agreed to sending it to the AMD service.');
  }
  const mimeType = MIME[extname(imagePath).toLowerCase()];
  if (!mimeType) throw new Error('Supported image types: .jpg, .jpeg, .png, .webp');
  const bytes = await readFile(imagePath);
  return {
    mode: 'image',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'この画像に写っている商品名を日本語で一つだけ答えてください。読めない場合は「不明」と答えてください。' },
          imageDataUrlPart(bytes, mimeType),
        ],
      },
    ],
  };
}

const config = loadAmdConfig({ ...process.env, AMD_MODEL: model });
const { mode, messages } = await buildMessages();
const startedAt = new Date().toISOString();

try {
  const result = await chatCompletion(config, { messages });
  console.log(
    JSON.stringify(
      {
        outcome: 'passed',
        mode,
        startedAt,
        endpointHost: new URL(config.url).host,
        requestedModel: result.requestedModel,
        returnedModel: result.returnedModel,
        finishReason: result.finishReason,
        latencyMs: result.latencyMs,
        usage: result.usage,
        providerRequestId: result.providerRequestId,
        contentPreview: result.content.slice(0, 200),
      },
      null,
      2,
    ),
  );
} catch (error) {
  const details =
    error instanceof AmdError
      ? { kind: error.kind, status: error.status ?? null, retryable: error.retryable, detail: error.message }
      : { kind: 'unexpected', name: error instanceof Error ? error.name : 'unknown' };
  console.log(JSON.stringify({ outcome: 'failed', mode, startedAt, ...details }, null, 2));
  process.exitCode = 1;
}
