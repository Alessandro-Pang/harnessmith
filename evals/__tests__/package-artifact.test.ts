import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterAll, beforeAll, test } from 'vitest';
import { elementAt } from '../../packages/harness/src/__tests__/helpers/harness.js';
import { readNpmPackageTarball } from '../../scripts/release/npm-tarball.js';
import { verifyPackageSmoke } from '../../scripts/release/package-smoke.js';

const root = join(import.meta.dirname, '..', '..');
const packDirectory = mkdtempSync(join(tmpdir(), 'harnessmith-package-artifact-'));
let artifact = '';
let files: ReadonlyMap<string, Buffer>;

beforeAll(() => {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const staging = join(packDirectory, 'staging');
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    files: string[];
    scripts?: Record<string, string>;
  };
  mkdirSync(staging, { recursive: true });
  for (const path of manifest.files) {
    cpSync(join(root, path), join(staging, path), { recursive: true });
  }
  // npm pack runs prepare even with --ignore-scripts. Pack an isolated file set so
  // this test cannot rebuild dist while fingerprint tests consume it in parallel.
  delete manifest.scripts;
  writeFileSync(join(staging, 'package.json'), JSON.stringify(manifest, null, 2));
  const packed = spawnSync(
    npm,
    [
      'pack',
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      packDirectory,
      '--cache',
      join(packDirectory, 'npm-cache'),
    ],
    {
      cwd: staging,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        npm_config_audit: 'false',
        npm_config_fund: 'false',
        npm_config_update_notifier: 'false',
      },
    },
  );
  assert.equal(packed.status, 0, packed.stderr || packed.stdout);
  const records = JSON.parse(packed.stdout) as Array<{ filename: string }>;
  artifact = join(packDirectory, elementAt(records, 0).filename);
  files = readNpmPackageTarball(artifact).files;
});

afterAll(() => {
  rmSync(packDirectory, { recursive: true, force: true });
});

test('packed root entry has declarations and passes the clean TypeScript consumer smoke', () => {
  assert.ok(files.has('dist/cli.d.ts'), 'packed public CLI declaration is missing');
  assert.ok(files.has('dist/shared/types.d.ts'), 'generated RunContext declaration is missing');
  assert.match(
    files.get('dist/cli.d.ts')?.toString('utf8') ?? '',
    /from '\.\/shared\/types\.js'/,
    'public declarations must reference the generated source-of-truth types',
  );
  const result = verifyPackageSmoke(artifact);
  assert.deepEqual(result.exported, ['run']);
  assert.equal(result.globalBin, 'harnessmith');
  const harnessManifest = JSON.parse(
    files.get('template/skills/agent-harness/manifest.json')?.toString('utf8') ?? '{}',
  ) as { harnessVersion: string };
  assert.equal(result.runtimeVersion, harnessManifest.harnessVersion);
});

test('CLI and embedded Harness ship external sourcemaps and map a controlled exception to TS', () => {
  for (const path of ['dist/cli.js.map', 'dist/harness.mjs.map']) {
    assert.ok(files.has(path), `packed external sourcemap is missing: ${path}`);
    assert.ok(!readFileSync(join(root, path), 'utf8').includes('sourcesContent":null'));
  }
  const script = `
    import { run } from './dist/cli.js';
    let stack = '';
    try {
      await run(['__source_map_probe__'], { io: { log() {}, error() {} } });
    } catch (error) {
      stack = error instanceof Error ? error.stack ?? '' : '';
    }
    if (!stack) throw new Error('controlled CLI exception did not produce a stack');
    console.log(stack);
  `;
  const result = spawnSync(
    process.execPath,
    ['--enable-source-maps', '--input-type=module', '--eval', script],
    { cwd: root, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' } },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /cli\.ts:\d+:\d+/);
});

// A PATH-shimmed npm that records every invocation and fails, plus a black-hole
// registry/proxy: any default-path npm or registry access becomes a hard failure.
function npmTrapEnvironment(trapDirectory: string, logFile: string): NodeJS.ProcessEnv {
  mkdirSync(trapDirectory, { recursive: true });
  writeFileSync(
    join(trapDirectory, 'npm'),
    '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$NPM_TRAP_LOG"\nexit 1\n',
    { mode: 0o755 },
  );
  chmodSync(join(trapDirectory, 'npm'), 0o755);
  writeFileSync(
    join(trapDirectory, 'npm.cmd'),
    '@echo off\r\necho %* >> "%NPM_TRAP_LOG%"\r\nexit /b 1\r\n',
    { mode: 0o755 },
  );
  return {
    ...process.env,
    PATH: `${trapDirectory}${delimiter}${process.env.PATH ?? ''}`,
    NPM_TRAP_LOG: logFile,
    npm_config_registry: 'http://127.0.0.1:9/',
    HTTP_PROXY: 'http://127.0.0.1:9',
    HTTPS_PROXY: 'http://127.0.0.1:9',
    NO_PROXY: '',
    NODE_ENV: 'test',
  };
}

test('default package smoke is fully offline and never invokes npm or the registry', () => {
  const trapDirectory = join(packDirectory, 'npm-trap-offline');
  const logFile = join(packDirectory, 'npm-invocations-offline.log');
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      join(root, 'scripts', 'release', 'package-smoke.ts'),
      '--artifact',
      artifact,
    ],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 110_000,
      env: npmTrapEnvironment(trapDirectory, logFile),
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Package smoke passed for harnessmith@/);
  assert.equal(existsSync(logFile), false, 'the default smoke must not invoke npm');
}, 120_000);

test('explicit --online opt-in still attempts a real npm global install', () => {
  const trapDirectory = join(packDirectory, 'npm-trap-online');
  const logFile = join(packDirectory, 'npm-invocations-online.log');
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      join(root, 'scripts', 'release', 'package-smoke.ts'),
      '--artifact',
      artifact,
      '--online',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 110_000,
      env: npmTrapEnvironment(trapDirectory, logFile),
    },
  );
  assert.notEqual(result.status, 0, 'the trapped npm install must fail the online smoke');
  assert.ok(existsSync(logFile), 'the online opt-in must invoke npm');
  assert.match(result.stderr, /global installation failed/);
}, 120_000);
