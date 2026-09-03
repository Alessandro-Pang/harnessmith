import { defineConfig } from 'tsup';

const compatibilityBanner = [
  "import { createRequire } from 'node:module';",
  "import { fileURLToPath as __fileURLToPath } from 'node:url';",
  "import { dirname as __pathDirname } from 'node:path';",
  'const require = createRequire(import.meta.url);',
  'const __filename = __fileURLToPath(import.meta.url);',
  'const __dirname = __pathDirname(__filename);',
].join(' ');

export default defineConfig([
  {
    entry: [
      'packages/cli/src/cli.ts',
      'packages/cli/src/app/*.ts',
      'packages/cli/src/application/*.ts',
      'packages/cli/src/adapters/*.ts',
      'packages/cli/src/adoption/*.ts',
      'packages/cli/src/diagnostics/*.ts',
      'packages/cli/src/installation/*.ts',
      'packages/cli/src/portable-config/*.ts',
      'packages/cli/src/presentation/*.ts',
      'packages/cli/src/setup/*.ts',
      'packages/cli/src/shared/*.ts',
      'packages/cli/src/status/*.ts',
      'packages/cli/src/temporary-resources/*.ts',
    ],
    outDir: 'dist',
    format: ['esm'],
    target: 'node24',
    platform: 'node',
    bundle: false,
    splitting: false,
    sourcemap: false,
    clean: true,
  },
  {
    entry: { harness: 'packages/harness/src/cli.ts' },
    outDir: 'template/agent-harness/dist',
    format: ['esm'],
    outExtension: () => ({ js: '.mjs' }),
    target: 'node24',
    platform: 'node',
    bundle: true,
    noExternal: [/.*/],
    splitting: false,
    sourcemap: false,
    minify: true,
    clean: true,
    banner: { js: compatibilityBanner },
  },
]);
