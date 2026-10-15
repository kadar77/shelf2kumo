// Compares chat-planning models on evaluation/chat-cases.json with the versioned chat prompt.
// Makes ONE paid request per case per model. Manual only, never in tests.
//
//   pnpm try:chat --models MiniCPM-V-4.7-35B-A3B,DeepSeek-V4.1-Flash
//
// Raw model text is written only to evaluation/results/ (gitignored).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AmdError,
  CHAT_PROMPT_VERSION,
  CHAT_SYSTEM_PROMPT,
  ModelOutputError,
  chatCompletion,
  chatUserMessage,
  loadAmdConfig,
  parseChatProposal,
  type ChatContext,
} from '../packages/ai/src/index.ts';
import type { ChatProposal, ProposedAction } from '../packages/contracts/src/index.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const models = (args.includes('--models') ? args[args.indexOf('--models') + 1] : 'MiniCPM-V-4.7-35B-A3B')?.split(',') ?? [];
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;

interface ExpectedAction {
  type: string;
  item?: string;
  palette?: string;
  changes?: Record<string, unknown>;
  fields?: Record<string, unknown>;
  changesContain?: Record<string, string[]>;
}
interface Case {
  id: string;
  request: string;
  expect: { actions?: ExpectedAction[]; noActions?: boolean; clarification?: boolean; forbid?: string[] };
}

const dataset = JSON.parse(await readFile(join(root, 'evaluation/chat-cases.json'), 'utf8')) as {
  datasetVersion: string;
  context: ChatContext;
  cases: Case[];
};

function matches(actual: ProposedAction, expected: ExpectedAction): boolean {
  if (actual.type !== expected.type) return false;
  const record = actual as unknown as Record<string, unknown>;
  if (expected.item && record.item !== expected.item) return false;
  if (expected.palette && record.palette !== expected.palette) return false;
  const values = (record.changes ?? record.fields ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(expected.changes ?? expected.fields ?? {})) if (values[key] !== value) return false;
  for (const [key, parts] of Object.entries(expected.changesContain ?? {})) {
    const text = String(values[key] ?? '');
    if (!parts.every((part) => text.includes(part))) return false;
  }
  return true;
}

function score(proposal: ChatProposal, expectation: Case['expect']): string[] {
  const problems: string[] = [];
  for (const expected of expectation.actions ?? []) {
    if (!proposal.actions.some((action) => matches(action, expected))) problems.push(`missing ${expected.type}`);
  }
  if (expectation.noActions && proposal.actions.length > 0) problems.push(`unexpected actions: ${proposal.actions.map((a) => a.type).join(',')}`);
  if (expectation.clarification && !proposal.clarification) problems.push('no clarification');
  for (const type of expectation.forbid ?? []) if (proposal.actions.some((a) => a.type === type)) problems.push(`forbidden ${type}`);
  return problems;
}

const report: Record<string, unknown>[] = [];
for (const model of models) {
  const config = loadAmdConfig({ ...process.env, AMD_MODEL: model });
  let valid = 0;
  let passed = 0;
  const latencies: number[] = [];
  for (const testCase of dataset.cases.filter((c) => !only || c.id === only)) {
    const row: Record<string, unknown> = { model, case: testCase.id };
    try {
      const completion = await chatCompletion(config, {
        messages: [
          { role: 'system', content: CHAT_SYSTEM_PROMPT },
          { role: 'user', content: chatUserMessage(dataset.context, testCase.request) },
        ],
      });
      latencies.push(completion.latencyMs);
      row.latencyMs = completion.latencyMs;
      row.rawContent = completion.content;
      try {
        const proposal = parseChatProposal(completion.content, completion.finishReason);
        valid += 1;
        const problems = score(proposal, testCase.expect);
        if (problems.length === 0) passed += 1;
        Object.assign(row, { outcome: problems.length === 0 ? 'pass' : 'fail', problems, actions: proposal.actions, clarification: proposal.clarification ?? null });
      } catch (error) {
        row.outcome = `invalid: ${error instanceof ModelOutputError ? error.kind : 'unknown'}`;
      }
    } catch (error) {
      row.outcome = `request failed: ${error instanceof AmdError ? `${error.kind} ${error.message}` : 'unexpected'}`;
    }
    report.push(row);
    console.log(JSON.stringify({ ...row, rawContent: undefined, actions: (row.actions as ProposedAction[] | undefined)?.map((a) => a.type) }));
  }
  const total = dataset.cases.filter((c) => !only || c.id === only).length;
  const sorted = [...latencies].sort((a, b) => a - b);
  const summary = {
    model,
    summary: true,
    validJson: `${valid}/${total}`,
    passed: `${passed}/${total}`,
    medianLatencyMs: sorted[Math.floor(sorted.length / 2)] ?? null,
    maxLatencyMs: sorted.at(-1) ?? null,
  };
  report.push(summary);
  console.log(JSON.stringify(summary));
}

const runId = new Date().toISOString().replace(/[:.]/g, '-');
await mkdir(join(root, 'evaluation/results'), { recursive: true });
await writeFile(
  join(root, `evaluation/results/chat-${runId}.json`),
  JSON.stringify({ runId, promptVersion: CHAT_PROMPT_VERSION, dataset: dataset.datasetVersion, report }, null, 2),
);
console.log(`Saved to evaluation/results/chat-${runId}.json (${CHAT_PROMPT_VERSION}).`);
