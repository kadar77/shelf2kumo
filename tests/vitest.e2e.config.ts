import { defineConfig } from 'vitest/config';

// Browser release test; run inside `firebase emulators:exec` (pnpm test:e2e).
export default defineConfig({
  test: {
    include: ['e2e/**/*.test.ts'],
    testTimeout: 240_000,
    hookTimeout: 60_000,
  },
});
