// Quick extraction check: runs the versioned extraction prompt on the evaluation manifest images and
// compares against ground truth. Makes ONE paid request per image. Manual only, never in tests.
// This is an operational smoke check, not the Workstream E evaluation (no repeats or statistics).
//
//   pnpm try:extraction                 all manifest images
//   pnpm try:extraction --only s1-hojicha-pouch
//
// Raw model text is written only to evaluation/results/ (gitignored).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AmdError,
  DEFAULT_AMD_MODEL,
  EXTRACTION_PROMPT_VERSION,
  ExtractionOutputError,
  chatCompletion,
  extractionMessages,
  loadAmdConfig,
  parseExtractionContent,
} from '../packages/ai/src/index.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const evaluation = join(root, 'evaluation');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;
const model = args.includes('--model') ? (args[args.indexOf('--model') + 1] as string) : DEFAULT_AMD_MODEL;

interface ManifestImage {
  id: string;
  path: string;
  mode: 'single' | 'shelf';
}
interface Truth {
  productCount: number;
  items: Array<{ name: string; priceJpy: number | null; taxTreatment: string }>;
}

const manifest = JSON.parse(await readFile(join(evaluation, 'manifest.json'), 'utf8')) as { images: ManifestImage[]; datasetVersion: string };
const truth = JSON.parse(await readFile(join(evaluation, 'ground-truth.json'), 'utf8')) as Record<string, Truth>;
const config = loadAmdConfig({ ...process.env, AMD_MODEL: model });

const rows: Record<string, unknown>[] = [];
for (const image of manifest.images.filter((candidate) => !only || candidate.id === only)) {
  const bytes = await readFile(join(evaluation, image.path)).catch(() => null);
  if (!bytes) {
    rows.push({ id: image.id, outcome: 'missing image (run pnpm eval:images)' });
    continue;
  }
  // MVP behavior is single mode for every photo; shelf images test the multi-product handling.
  const mode = 'single' as const;
  const expected = truth[image.id];
  try {
    const completion = await chatCompletion(config, { messages: extractionMessages({ imageBytes: bytes, mimeType: 'image/jpeg', mode }) });
    let row: Record<string, unknown> = {
      id: image.id,
      latencyMs: completion.latencyMs,
      tokens: completion.usage.totalTokens,
      finishReason: completion.finishReason,
      rawContent: completion.content,
    };
    try {
      const output = parseExtractionContent(completion.content, completion.finishReason);
      const first = output.items[0];
      const want = expected?.items[0];
      row = {
        ...row,
        outcome: 'parsed',
        productCountEstimate: output.productCountEstimate,
        expectedCount: expected?.productCount,
        name: first?.name ?? null,
        priceJpy: first?.priceJpy ?? null,
        taxTreatment: first?.taxTreatment ?? null,
        nameMatch: expected?.productCount === 1 ? first?.name === want?.name : undefined,
        priceMatch: expected?.productCount === 1 ? (first?.priceJpy ?? null) === want?.priceJpy : undefined,
        taxMatch: expected?.productCount === 1 ? first?.taxTreatment === want?.taxTreatment : undefined,
        multiProductDetected: expected && expected.productCount > 1 ? output.productCountEstimate > 1 : undefined,
      };
    } catch (error) {
      row = { ...row, outcome: `invalid output: ${error instanceof ExtractionOutputError ? error.kind : 'unknown'}` };
    }
    rows.push(row);
  } catch (error) {
    rows.push({ id: image.id, outcome: `request failed: ${error instanceof AmdError ? `${error.kind} ${error.message}` : 'unexpected'}` });
  }
}

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(evaluation, 'results');
await mkdir(outDir, { recursive: true });
await writeFile(
  join(outDir, `quick-${runId}.json`),
  JSON.stringify({ runId, model: config.model, promptVersion: EXTRACTION_PROMPT_VERSION, dataset: manifest.datasetVersion, rows }, null, 2),
);

for (const row of rows) {
  console.log(JSON.stringify({ ...row, rawContent: undefined }));
}
console.log(`Saved raw results to evaluation/results/quick-${runId}.json (model ${config.model}, ${EXTRACTION_PROMPT_VERSION}).`);
