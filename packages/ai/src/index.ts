if (typeof (globalThis as { window?: unknown }).window !== 'undefined') {
  throw new Error('@shelf2kumo/ai is server-only and must not be bundled for the browser.');
}

export * from './client.ts';
export * from './config.ts';
export * from './errors.ts';
export * from './extraction.ts';
export * from './prompts/extraction-v1.ts';
