import { rmSync } from 'node:fs';
import { defineConfig } from 'tsup';

const compatibilityBanner = [
  "import { createRequire } from 'node:module';",
  "import { fileURLToPath as __fileURLToPath } from 'node:url';",
  "import { dirname as __pathDirname } from 'node:path';",
  'const require = createRequire(import.meta.url);',
  'const __filename = __fileURLToPath(import.meta.url);',
  'const __dirname = __pathDirname(__filename);',
].join(' ');

// tsup@8.5.1 runs array configs in parallel (Promise.all). With a shared outDir, one
// config's `clean: true` can delete the sibling config's finished output. Clean the
// shared directory exactly once here, at config load before any build starts, and
// keep per-config cleaning disabled.
const sharedOutDir = 'dist';
rmSync(sharedOutDir, { recursive: true, force: true });

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
      'packages/cli/src/runtime/*.ts',
      'packages/cli/src/setup/*.ts',
      'packages/cli/src/shared/*.ts',
      'packages/cli/src/status/*.ts',
      'packages/cli/src/temporary-resources/*.ts',
    ],
    outDir: sharedOutDir,
    format: ['esm'],
    target: 'node22',
    platform: 'node',
    bundle: false,
    splitting: false,
    sourcemap: true,
    clean: false,
  },
  {
    entry: { harness: 'packages/harness/src/cli.ts' },
    outDir: sharedOutDir,
    format: ['esm'],
    outExtension: () => ({ js: '.mjs' }),
    target: 'node22',
    platform: 'node',
    bundle: true,
    noExternal: [/.*/],
    splitting: false,
    sourcemap: true,
    minify: true,
    clean: false,
    banner: { js: compatibilityBanner },
  },
]);
