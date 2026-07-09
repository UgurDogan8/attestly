// @ts-check
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    ignores: ['node_modules', 'coverage', '**/*.js'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Invariant (docs/07 §9 #1): the domain layer is pure — no Forge imports,
    // no clock reads, no I/O — so it stays unit-testable without mocking the
    // platform (tech design §1 layering rule).
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@forge/*'],
              message: 'src/domain is pure business logic — no Forge imports (tech design §1).',
            },
          ],
        },
      ],
    },
  },
);
