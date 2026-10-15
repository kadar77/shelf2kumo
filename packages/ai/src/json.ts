export type ModelOutputKind = 'empty' | 'truncated' | 'not_json' | 'schema_invalid';

/** The model answered, but not with usable JSON. Never repaired by guessing. */
export class ModelOutputError extends Error {
  readonly kind: ModelOutputKind;

  constructor(kind: ModelOutputKind, message: string) {
    super(message);
    this.name = 'ModelOutputError';
    this.kind = kind;
  }
}

const FENCE = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?```$/i;

/**
 * Strict JSON parse of model text: one enclosing code fence may be removed, nothing else. A
 * `length` finish reason means the output may be cut off and is rejected even if it parses.
 */
export function parseModelJson(content: string, finishReason: string | null): unknown {
  if (finishReason === 'length') throw new ModelOutputError('truncated', 'Model output was truncated');
  const trimmed = content.trim();
  if (trimmed === '') throw new ModelOutputError('empty', 'Model returned no content');
  const unfenced = FENCE.exec(trimmed)?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(unfenced);
  } catch {
    throw new ModelOutputError('not_json', 'Model output is not JSON');
  }
}
