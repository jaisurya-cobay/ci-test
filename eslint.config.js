import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  {
    ignores: ['node_modules/**', 'coverage/**'],
  },

  js.configs.recommended,

  // Server-side source: Node globals, ESM.
  {
    files: ['src/**/*.js', '*.config.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_|^next$' }],
      'no-console': 'off',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  // Tests: Node globals plus the Jest globals, which are injected rather than
  // imported.
  {
    files: ['src/tests/**/*.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
    },
  },

  // Browser UI: no Node globals here, and it is loaded as a module.
  {
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: globals.browser,
    },
  },

  // Must stay last: turns off stylistic rules that would fight Prettier.
  prettier,
];
