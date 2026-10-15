import { defineConfig } from 'vitest/config';

// Emulator-backed suites share one Firestore emulator; run files sequentially.
export default defineConfig({
  test: {
    include: ['rules/**/*.test.ts', 'api/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
