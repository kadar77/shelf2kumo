import { contrastRatio } from '@shelf2kumo/themes';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Workspace UI colors (not storefront themes): every text/background pair must meet WCAG AA.
const css = readFileSync(fileURLToPath(new URL('../src/workspace/workspace.css', import.meta.url)), 'utf8');
const token = (name: string) => {
  const match = new RegExp(`--ws-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!match?.[1]) throw new Error(`Missing --ws-${name}`);
  return match[1];
};

const PAIRS: Array<[string, string, string]> = [
  ['text on background', 'text', 'bg'],
  ['text on surface', 'text', 'surface'],
  ['muted on background', 'muted', 'bg'],
  ['muted on surface', 'muted', 'surface'],
  ['accent text on accent (primary buttons, owner bubbles)', 'accent-text', 'accent'],
  ['accent links on surface', 'accent', 'surface'],
  ['warning text on warning background', 'warn-text', 'warn-bg'],
  ['error text on error background', 'error', 'error-bg'],
  ['error text on surface', 'error', 'surface'],
  ['success text on success background', 'success-text', 'success-bg'],
];

describe('workspace colors (P6-4)', () => {
  it.each(PAIRS)('%s meets WCAG AA', (_label, fg, bg) => {
    expect(contrastRatio(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });
});
