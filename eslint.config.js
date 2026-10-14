import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const nodeGlobals = {
  console: 'readonly',
  process: 'readonly',
  URL: 'readonly',
};

export default defineConfig(
  {
    ignores: ['**/node_modules/**', '**/dist/**', 'functions/deploy/**', 'coverage/**'],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: { globals: nodeGlobals },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // The AMD adapter holds the API key path and must never reach a browser bundle.
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@shelf2kumo/ai', '@shelf2kumo/ai/*'], message: 'packages/ai is server-only.' }] },
      ],
    },
  },
  {
    // Storefront components render on the server and in the workspace preview: keep them pure.
    files: ['apps/web/src/storefront/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@shelf2kumo/ai', '@shelf2kumo/ai/*'], message: 'packages/ai is server-only.' },
            { group: ['firebase', 'firebase/*'], message: 'Storefront components must not depend on Firebase.' },
            { group: ['**/workspace/**', '../workspace'], message: 'Storefront components must not import workspace code.' },
          ],
        },
      ],
    },
  },
);
