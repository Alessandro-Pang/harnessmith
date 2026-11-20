import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, test } from 'vitest';
import { elementAt } from '../../packages/harness/src/__tests__/helpers/harness.js';

const root = join(import.meta.dirname, '..', '..');
const configPath = join(root, 'config', 'tsup.config.ts');
const tsupCli = join(root, 'node_modules', 'tsup', 'dist', 'cli-default.js');
const sandboxes: string[] = [];

// tsup resolves entries and outDir against the process cwd, so an isolated cwd with
// symlinked sources reproduces the real build without touching the repository dist.
function makeSandbox(): string {
  const sandbox = mkdtempSync(join(tmpdir(), 'harnessmith-build-output-'));
  sandboxes.push(sandbox);
  symlinkSync(join(root, 'node_modules'), join(sandbox, 'node_modules'), 'junction');
  symlinkSync(join(root, 'packages'), join(sandbox, 'packages'), 'junction');
  writeFileSync(
    join(sandbox, 'package.json'),
    `${JSON.stringify({ name: 'harnessmith-build-sandbox', private: true, type: 'module' })}\n`,
  );
  return sandbox;
}

afterAll(() => {
  for (const sandbox of sandboxes) rmSync(sandbox, { recursive: true, force: true });
});

test('shared tsup outDir is cleaned once before the parallel configs, never per config', () => {
  const sandbox = makeSandbox();
  mkdirSync(join(sandbox, 'dist'), { recursive: true });
  writeFileSync(join(sandbox, 'dist', 'stale-sentinel.txt'), 'stale output');
  const script = `
    const config = (await import(${JSON.stringify(pathToFileURL(configPath).href)})).default;
    const entries = Array.isArray(config) ? config : [config];
    console.log(JSON.stringify(entries.map((entry) => ({ outDir: entry.outDir, clean: entry.clean ?? false }))));
  `;
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', script],
    { cwd: sandbox, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' } },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const entries = JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '[]') as Array<{
    outDir: string;
    clean: boolean | string[];
  }>;
  assert.equal(entries.length, 2, 'the build must keep the CLI and Runtime configs');
  assert.equal(
    elementAt(entries, 0).outDir,
    elementAt(entries, 1).outDir,
    'both configs share one outDir',
  );
  // tsup@8.5.1 runs array configs through Promise.all; a per-config clean can delete
  // the sibling config's finished output, so no shared-outDir config may clean itself.
  for (const entry of entries) {
    assert.notEqual(entry.clean, true, 'a parallel config must not clean the shared outDir');
  }
  assert.equal(
    existsSync(join(sandbox, 'dist', 'stale-sentinel.txt')),
    false,
    'loading the config must clean the shared outDir once, before any build starts',
  );
});

test('repeated isolated builds keep every expected CLI and Runtime artifact', () => {
  const sandbox = makeSandbox();
  const expectedFiles = [
    'dist/cli.js',
    'dist/cli.js.map',
    'dist/harness.mjs',
    'dist/harness.mjs.map',
    'dist/shared/types.js',
    'dist/shared/errors.js',
  ];
  const expectedDirectories = [
    'app',
    'application',
    'adapters',
    'adoption',
    'diagnostics',
    'installation',
    'portable-config',
    'presentation',
    'runtime',
    'setup',
    'shared',
    'status',
    'temporary-resources',
  ];
  for (let run = 1; run <= 3; run += 1) {
    mkdirSync(join(sandbox, 'dist'), { recursive: true });
    writeFileSync(join(sandbox, 'dist', `stale-${run}.txt`), 'stale output');
    const result = spawnSync(process.execPath, [tsupCli, '--config', configPath], {
      cwd: sandbox,
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test' },
    });
    assert.equal(result.status, 0, `build run ${run} failed: ${result.stderr || result.stdout}`);
    for (const path of expectedFiles) {
      assert.ok(existsSync(join(sandbox, path)), `build run ${run} is missing ${path}`);
    }
    for (const directory of expectedDirectories) {
      assert.ok(
        existsSync(join(sandbox, 'dist', directory)),
        `build run ${run} is missing dist/${directory}`,
      );
    }
    assert.equal(
      existsSync(join(sandbox, 'dist', `stale-${run}.txt`)),
      false,
      `build run ${run} must start from a cleaned shared outDir`,
    );
    const runtime = readFileSync(join(sandbox, 'dist', 'harness.mjs'), 'utf8');
    assert.ok(
      runtime.startsWith("import { createRequire } from 'node:module';"),
      `build run ${run} lost the bundled Runtime compatibility banner`,
    );
    assert.ok(runtime.length > 100_000, `build run ${run} produced a truncated Runtime bundle`);
  }
});
