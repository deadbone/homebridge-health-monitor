import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
  {
    ignores: ['dist/**', 'coverage/**', 'tools/**', 'eslint.config.js', 'vitest.config.ts'],
  },
);
