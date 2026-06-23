import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import { globalIgnores } from 'eslint/config';

export default tseslint.config(
  globalIgnores([
    'dist',
    'node_modules',
    'src-tauri/target',
    '.claude',
    'scripts',
    '*.config.js',
    '*.config.ts',
    'public',
  ]),
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
        // Intentionally NO `project` here: type-aware linting is slow and the
        // working tree carries ~2000 `: any` today. Keep lint fast and syntactic.
      },
    },
    rules: {
      // Noisy-by-design today (~2000 `: any`, ~110 `as any`). Warn, don't block CI.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': 'warn',

      // Existing legacy debt: tracked as warnings now, ratcheted to error later.
      // `no-empty` here is the swallowed-catch debt (MAINT-ERRLOG); it gets a real
      // fix in the error-handling pass, after which this can become an error.
      '@typescript-eslint/no-unused-vars': 'warn',
      'no-empty': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',

      // Hard rules: these catch real bugs, keep them as errors.
      'react-hooks/rules-of-hooks': 'error',
      'no-debugger': 'error',
    },
  },
  // All jsx-a11y rules are advisory for now: warn instead of error.
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: Object.fromEntries(
      Object.keys(jsxA11y.flatConfigs.recommended.rules ?? {}).map((rule) => [rule, 'warn']),
    ),
  },
);
