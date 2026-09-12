import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  test: {
    environment: 'node',
    include: [
      'packages/cli/src/__tests__/**/*.test.ts',
      'packages/harness/src/__tests__/**/*.test.ts',
      'evals/__tests__/**/*.test.ts',
    ],
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: [
        'packages/cli/src/**/*.ts',
        'packages/harness/src/**/*.ts',
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
        lines: 85,
        functions: 91,
        branches: 76,
        statements: 83,
        'packages/cli/src/**': {
          lines: 74,
          functions: 84,
          branches: 60,
          statements: 72,
        },
        'packages/cli/src/shared/safe-path.ts': {
          lines: 94,
          functions: 100,
          branches: 83,
          statements: 92,
        },
        'packages/cli/src/installation/install.ts': {
          lines: 72,
          functions: 91,
          branches: 60,
          statements: 72,
        },
        'packages/cli/src/installation/lifecycle-transaction.ts': {
          lines: 97,
          functions: 100,
          branches: 80,
          statements: 92,
        },
        'packages/cli/src/installation/operation-lock.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        // Floors track measured coverage with a small margin; the previous 54/39/31 let the Harness
        // runtime fall below the areas nested inside it.
        'packages/harness/src/**': {
          lines: 90,
          functions: 95,
          branches: 83,
          statements: 88,
        },
        'packages/harness/src/commands/**': {
          lines: 83,
          functions: 89,
          branches: 76,
          statements: 80,
        },
        'packages/harness/src/lib/**': {
          lines: 95,
          functions: 100,
          branches: 86,
          statements: 92,
        },
      },
    },
  },
});
