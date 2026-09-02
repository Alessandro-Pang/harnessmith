import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/__tests__/**/*.test.ts',
      'template/agent-harness/src/__tests__/**/*.test.ts',
      'evals/__tests__/**/*.test.ts',
    ],
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: [
        'src/**/*.ts',
        'template/agent-harness/src/**/*.ts',
        'scripts/release/npm-tarball.ts',
        'scripts/preflight/preflight-docs.ts',
        'scripts/preflight/preflight-git.ts',
        'scripts/release/release-attestation.ts',
        'scripts/release/release-finalize.ts',
        'scripts/release/release-publish.ts',
        'scripts/release/release-state.ts',
        'scripts/release/release-version.ts',
      ],
      exclude: ['**/__tests__/**'],
      reporter: ['text', 'json-summary'],
      thresholds: {
        lines: 68,
        functions: 72,
        branches: 55,
        statements: 67,
        'src/**': {
          lines: 64,
          functions: 73,
          branches: 50,
          statements: 64,
        },
        'src/shared/safe-path.ts': {
          lines: 94,
          functions: 100,
          branches: 83,
          statements: 92,
        },
        'src/installation/install.ts': {
          lines: 72,
          functions: 91,
          branches: 60,
          statements: 72,
        },
        'src/installation/lifecycle-transaction.ts': {
          lines: 97,
          functions: 100,
          branches: 80,
          statements: 92,
        },
        'src/installation/operation-lock.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        'template/agent-harness/src/**': {
          lines: 54,
          functions: 39,
          branches: 31,
          statements: 55,
        },
        'template/agent-harness/src/commands/**': {
          lines: 72,
          functions: 85,
          branches: 63,
          statements: 71,
        },
        'template/agent-harness/src/lib/**': {
          lines: 95,
          functions: 100,
          branches: 80,
          statements: 90,
        },
      },
    },
  },
});
