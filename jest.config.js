/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/frontend/**',
    '!src/testUtils/**',
    '!src/**/*.test.{ts,tsx}',
  ],
  // domain/ is the pure, audit-grade logic (docs/05 §5) — near-total coverage
  // is cheap and load-bearing; the rest of the backend gets a lower, still
  // meaningful floor. Frontend (UI Kit) is excluded from the gate — it is
  // covered by the manual E2E checklist (docs/07 §7.3), not Jest.
  coverageThreshold: {
    global: {
      branches: 80,
      lines: 80,
    },
    './src/domain/**/*.ts': {
      branches: 95,
      lines: 95,
    },
  },
};
