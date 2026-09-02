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
      'src/cli.ts',
      'src/app/*.ts',
      'src/application/*.ts',
      'src/adapters/*.ts',
      'src/adoption/*.ts',
      'src/diagnostics/*.ts',
      'src/installation/*.ts',
      'src/portable-config/*.ts',
      'src/presentation/*.ts',
      'src/setup/*.ts',
      'src/shared/*.ts',
      'src/status/*.ts',
      'src/temporary-resources/*.ts',
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
    entry: { harness: 'template/agent-harness/src/cli.ts' },
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
