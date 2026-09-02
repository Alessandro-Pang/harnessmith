import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { readNpmPackageTarball } from '../../scripts/release/npm-tarball.js';
import { candidateArtifact } from './run-fixture.js';

const root = join(import.meta.dirname, '..', '..');

function fixture(): string {
  const path = mkdtempSync(join(tmpdir(), 'harnessmith-registry-verification-'));
  onTestFinished(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

function digest(algorithm: 'sha1' | 'sha256' | 'sha512', content: Buffer): string {
  return createHash(algorithm)
    .update(content)
    .digest(algorithm === 'sha512' ? 'base64' : 'hex');
}

function fakeNpm(directory: string, version: string): string {
  const bin = join(directory, 'bin');
  mkdirSync(bin, { recursive: true });
  const implementation = join(bin, 'fake-npm.mjs');
  writeFileSync(
    implementation,
    `#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const artifact = process.env.HARNESS_TEST_REGISTRY_ARTIFACT;
const log = process.env.HARNESS_TEST_REGISTRY_LOG;
const mode = process.env.HARNESS_TEST_REGISTRY_MODE;
const version = process.env.HARNESS_TEST_REGISTRY_VERSION;
writeFileSync(log, JSON.stringify(args) + '\\n', { flag: 'a' });

if (args[0] === 'view') {
  if (mode === 'unavailable') {
    console.error('E404 package version not found');
    process.exit(1);
  }
  const content = readFileSync(artifact);
  console.log(JSON.stringify({
    version: mode === 'bad-metadata' ? '9.9.9' : version,
    dist: {
      tarball: 'https://registry.npmjs.org/harnessmith/-/harnessmith-' + version + '.tgz',
      shasum: mode === 'bad-integrity' ? '0'.repeat(40) : createHash('sha1').update(content).digest('hex'),
      integrity: 'sha512-' + createHash('sha512').update(content).digest('base64'),
      attestations: {
        url: 'https://registry.npmjs.org/-/npm/v1/attestations/harnessmith@' + version,
        provenance: { predicateType: 'https://slsa.dev/provenance/v1' },
      },
    },
  }));
  process.exit(0);
}

if (args[0] === 'pack') {
  const destination = args[args.indexOf('--pack-destination') + 1];
  const filename = 'harnessmith-' + version + '.tgz';
  copyFileSync(artifact, join(destination, filename));
  console.log(JSON.stringify([{ filename }]));
  process.exit(0);
}

if (args[0] === 'install') {
  if (mode === 'runtime-failure') {
    console.error('isolated install failed');
    process.exit(1);
  }
  const prefix = args[args.indexOf('--prefix') + 1];
  const packageRoot = join(prefix, 'node_modules', 'harnessmith');
  mkdirSync(join(packageRoot, 'bin'), { recursive: true });
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: 'harnessmith', version }));
  writeFileSync(
    join(packageRoot, 'bin', 'harnessmith.mjs'),
    \`#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
if (args[0] === '--version') console.log('${version}');
else if (args[0] === 'capabilities') console.log(JSON.stringify({ version: 1, agents: ['codex'] }));
else if (args[0] === 'install' && args.includes('--dry-run')) console.log(JSON.stringify({ command: 'install', dryRun: true }));
else if (args[0] === 'install') {
  mkdirSync(join(process.env.CODEX_HOME, 'agent-harness', 'bin'), { recursive: true });
  mkdirSync(process.env.HARNESS_MEMORY_HOME, { recursive: true });
  mkdirSync(process.env.HARNESS_PERSONAL_HOME, { recursive: true });
  writeFileSync(join(process.env.CODEX_HOME, 'AGENTS.md'), 'managed');
  writeFileSync(join(process.env.HARNESS_MEMORY_HOME, 'README.md'), 'memory');
  writeFileSync(join(process.env.HARNESS_MEMORY_HOME, 'core.md'), 'core');
  writeFileSync(join(process.env.HARNESS_MEMORY_HOME, 'profile.md'), 'profile');
  writeFileSync(join(process.env.HARNESS_PERSONAL_HOME, 'AGENTS.md'), 'personal');
  writeFileSync(join(process.env.CODEX_HOME, 'agent-harness', 'bin', 'harness.mjs'), \\\`#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'doctor') console.log('Doctor passed');
else if (args[0] === 'health' && args.includes('--json')) console.log(JSON.stringify({ version: 1, healthy: true, checks: [] }));
else process.exitCode = 2;
\\\`);
  console.log(JSON.stringify({ command: 'install', adapter: 'codex' }));
} else process.exitCode = 2;
\`,
  );
  process.exit(0);
}

console.error('unsupported fake npm command: ' + args.join(' '));
process.exit(2);
`,
  );
  chmodSync(implementation, 0o755);
  const npm = join(bin, 'npm');
  writeFileSync(npm, `#!/bin/sh\nexec "${process.execPath}" "${implementation}" "$@"\n`);
  chmodSync(npm, 0o755);
  writeFileSync(join(bin, 'npm.cmd'), `@"${process.execPath}" "${implementation}" %*\r\n`);
  return bin;
}

test('registry verification validates metadata, downloaded bytes, and isolated smoke commands', () => {
  const directory = fixture();
  const tarball = readNpmPackageTarball(candidateArtifact);
  const manifest = JSON.parse(tarball.files.get('package.json')?.toString('utf8') ?? '{}') as {
    version: string;
  };
  const evidence = join(directory, 'registry-verification.json');
  const commandLog = join(directory, 'npm-commands.jsonl');
  const bin = fakeNpm(directory, manifest.version);
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      'scripts/release/registry-verify.ts',
      '--package',
      'harnessmith',
      '--version',
      manifest.version,
      '--expected-artifact',
      candidateArtifact,
      '--evidence-file',
      evidence,
      '--max-attempts',
      '3',
      '--retry-delay-ms',
      '1',
      '--require-provenance',
      '--json',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
        HARNESS_TEST_REGISTRY_ARTIFACT: candidateArtifact,
        HARNESS_TEST_REGISTRY_LOG: commandLog,
        HARNESS_TEST_REGISTRY_VERSION: manifest.version,
      },
    },
  );

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const report = JSON.parse(result.stdout) as {
    valid: boolean;
    artifact: { sha1: string; sha256: string; integrity: string };
    smoke: Record<string, boolean>;
  };
  const content = readFileSync(candidateArtifact);
  assert.equal(report.valid, true);
  assert.deepEqual(report.artifact, {
    sha1: digest('sha1', content),
    sha256: digest('sha256', content),
    integrity: `sha512-${digest('sha512', content)}`,
  });
  assert.deepEqual(report.smoke, {
    version: true,
    capabilities: true,
    dryRunNoWrite: true,
    install: true,
    doctor: true,
    health: true,
  });
  assert.deepEqual(JSON.parse(readFileSync(evidence, 'utf8')), report);
  const commands = readFileSync(commandLog, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as string[]);
  assert.equal(commands[0]?.[0], 'view');
  assert.equal(commands[1]?.[0], 'pack');
  assert.equal(commands[2]?.[0], 'install');
});

test('registry verification reports bounded propagation failure with a stable code', () => {
  const directory = fixture();
  const tarball = readNpmPackageTarball(candidateArtifact);
  const manifest = JSON.parse(tarball.files.get('package.json')?.toString('utf8') ?? '{}') as {
    version: string;
  };
  const evidence = join(directory, 'registry-verification.json');
  const commandLog = join(directory, 'npm-commands.jsonl');
  const bin = fakeNpm(directory, manifest.version);
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      'scripts/release/registry-verify.ts',
      '--package',
      'harnessmith',
      '--version',
      manifest.version,
      '--expected-artifact',
      candidateArtifact,
      '--evidence-file',
      evidence,
      '--max-attempts',
      '2',
      '--retry-delay-ms',
      '1',
      '--require-provenance',
      '--json',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
        HARNESS_TEST_REGISTRY_ARTIFACT: candidateArtifact,
        HARNESS_TEST_REGISTRY_LOG: commandLog,
        HARNESS_TEST_REGISTRY_MODE: 'unavailable',
        HARNESS_TEST_REGISTRY_VERSION: manifest.version,
      },
    },
  );

  assert.equal(result.status, 1);
  const report = JSON.parse(readFileSync(evidence, 'utf8')) as {
    valid: boolean;
    error: { code: string };
    registry: { attempts: number };
    recoveryPath: string;
  };
  assert.equal(report.valid, false);
  assert.equal(report.error.code, 'REGISTRY_PROPAGATION_TIMEOUT');
  assert.equal(report.registry.attempts, 2);
  assert.match(result.stderr, /REGISTRY_PROPAGATION_TIMEOUT/);
  rmSync(report.recoveryPath, { recursive: true, force: true });
});

for (const [mode, expectedCode] of [
  ['bad-metadata', 'REGISTRY_METADATA_MISMATCH'],
  ['bad-integrity', 'REGISTRY_INTEGRITY_MISMATCH'],
  ['runtime-failure', 'REGISTRY_RUNTIME_FAILURE'],
] as const) {
  test(`registry verification classifies ${mode} without exposing command output`, () => {
    const directory = fixture();
    const tarball = readNpmPackageTarball(candidateArtifact);
    const manifest = JSON.parse(tarball.files.get('package.json')?.toString('utf8') ?? '{}') as {
      version: string;
    };
    const evidence = join(directory, 'registry-verification.json');
    const commandLog = join(directory, 'npm-commands.jsonl');
    const bin = fakeNpm(directory, manifest.version);
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        'scripts/release/registry-verify.ts',
        '--package',
        'harnessmith',
        '--version',
        manifest.version,
        '--expected-artifact',
        candidateArtifact,
        '--evidence-file',
        evidence,
        '--max-attempts',
        '1',
        '--retry-delay-ms',
        '0',
        '--require-provenance',
        '--json',
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
          HARNESS_TEST_REGISTRY_ARTIFACT: candidateArtifact,
          HARNESS_TEST_REGISTRY_LOG: commandLog,
          HARNESS_TEST_REGISTRY_MODE: mode,
          HARNESS_TEST_REGISTRY_VERSION: manifest.version,
        },
      },
    );

    assert.equal(result.status, 1);
    const report = JSON.parse(readFileSync(evidence, 'utf8')) as {
      error: { code: string; message: string };
      registry: { attempts: number };
      recoveryPath: string;
    };
    assert.equal(report.error.code, expectedCode);
    assert.equal(report.registry.attempts, 1);
    assert.doesNotMatch(JSON.stringify(report), /isolated install failed/);
    rmSync(report.recoveryPath, { recursive: true, force: true });
  });
}
