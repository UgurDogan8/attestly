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
      // data model invariant 4: same inputs -> same output, no clock reads
      // inside. new Date(isoString) (formatting an already-given timestamp)
      // stays legal — only the zero-argument, live-clock-reading forms are
      // banned (test plan §2.1).
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'src/domain is pure — no clock reads (data model invariant 4).',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            'src/domain is pure — no clock reads (data model invariant 4). new Date(isoString) is fine; new Date() with no arguments reads the system clock.',
        },
      ],
    },
  },
);
