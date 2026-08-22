import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { runCli } from '../cli.js';
import { createHealthReport } from '../lib/health.js';
import {
  managedOutputWithinHome,
  resolveRuntimeIdentity,
  verifyRuntimeIdentity,
} from '../runtime.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'harness-health-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('runtime identity fails closed for missing or malformed managed context', () => {
  const root = temporaryRoot();
  assert.deepEqual(resolveRuntimeIdentity(root), {
    kind: 'invalid',
    reason: 'Installation context is missing and no verified standalone source tree exists',
  });

  writeFileSync(join(root, 'install-context.json'), '{invalid json\n');
  const malformed = resolveRuntimeIdentity(root);
  assert.equal(malformed.kind, 'invalid');
  assert.match(malformed.reason, /Installation context is invalid/);
});

test('runtime identity accepts only an explicit source tree or valid managed context', () => {
  const sourceRoot = temporaryRoot();
  const standalone = join(sourceRoot, 'template', 'agent-harness');
  mkdirSync(join(standalone, 'src'), { recursive: true });
  writeFileSync(join(sourceRoot, 'package.json'), '{"name":"harnessmith"}\n');
  writeFileSync(join(standalone, 'src', 'runtime.ts'), '// source marker\n');
  assert.deepEqual(resolveRuntimeIdentity(standalone), {
    kind: 'standalone',
    source: 'source-tree',
  });

  const managed = temporaryRoot();
  const harnessHome = join(managed, 'host');
  const harnessRoot = join(harnessHome, 'agent-harness');
  mkdirSync(harnessRoot, { recursive: true });
  writeFileSync(
    join(harnessRoot, 'install-context.json'),
    JSON.stringify({
      version: 1,
      adapter: 'test-host',
      harnessHome,
      instructionFiles: [join(harnessHome, 'AGENTS.md')],
      memoryHome: join(managed, 'memory'),
      personalHome: join(managed, 'personal'),
      repositoryRoot: join(managed, 'repositories'),
      owner: 'test-owner',
    }),
  );
  const identity = resolveRuntimeIdentity(harnessRoot);
  assert.equal(identity.kind, 'managed');
  assert.equal(identity.context.adapter, 'test-host');
});

test('runtime identity does not trust a copied source marker in a managed layout', () => {
  const root = temporaryRoot();
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'runtime.ts'), '// copied marker\n');

  assert.equal(resolveRuntimeIdentity(root).kind, 'invalid');
});

test('health refuses an unverified standalone identity in a managed layout', () => {
  const root = temporaryRoot();
  const managedRoot = join(root, 'host', 'agent-harness');
  mkdirSync(managedRoot, { recursive: true });
  const runtime = harnessRuntime(root, {
    harnessRoot: managedRoot,
    hostAdapter: 'standalone',
    installedHarness: managedRoot,
    docsRoot: join(managedRoot, 'docs'),
    identityOverride: undefined,
  });

  const installation = createHealthReport(runtime).checks.find(({ id }) => id === 'installation');
  assert.equal(installation?.status, 'failed');
  assert.match(installation?.message ?? '', /runtime identity is not verifiable/i);
});

test('a persisted test adapter cannot bypass managed installation verification', () => {
  const root = temporaryRoot();
  const harnessHome = join(root, 'host');
  const harnessRoot = join(harnessHome, 'agent-harness');
  const instruction = join(harnessHome, 'AGENTS.md');
  const memoryHome = join(root, 'memory');
  const personalHome = join(root, 'personal');
  const repositoryRoot = join(root, 'repositories');
  mkdirSync(join(harnessRoot, 'bin'), { recursive: true });
  mkdirSync(personalHome, { recursive: true });
  writeFileSync(instruction, '# rules\n');
  writeFileSync(join(personalHome, 'AGENTS.md'), '# personal\n');
  writeFileSync(join(harnessRoot, 'bin', 'harness.mjs'), '#!/usr/bin/env node\n');
  writeFileSync(
    join(harnessRoot, 'manifest.json'),
    JSON.stringify({ schemaVersion: 3, memorySchemaVersion: 1 }),
  );
  writeFileSync(
    join(harnessRoot, 'install-context.json'),
    JSON.stringify({
      version: 1,
      adapter: 'test',
      harnessHome,
      instructionFiles: [instruction],
      memoryHome,
      personalHome,
      repositoryRoot,
      owner: 'test-owner',
    }),
  );
  const runtime = harnessRuntime(root, {
    harnessRoot,
    distributionRoot: harnessHome,
    harnessHome,
    hostAdapter: 'test',
    instructionFiles: [instruction],
    installedHarness: harnessRoot,
    docsRoot: join(harnessRoot, 'docs'),
    memoryHome,
    personalHome,
    repositoryRoot,
    identityOverride: undefined,
  });

  assert.deepEqual(verifyRuntimeIdentity(runtime), { valid: true });
  const installation = createHealthReport(runtime).checks.find(({ id }) => id === 'installation');
  assert.equal(installation?.status, 'failed');
  assert.match(installation?.message ?? '', /record is missing/i);
});

test('health reports managed digest budget failures instead of losing its report', () => {
  const root = temporaryRoot();
  const harnessHome = join(root, 'host');
  const harnessRoot = join(harnessHome, 'agent-harness');
  const instruction = join(harnessHome, 'AGENTS.md');
  const memoryHome = join(root, 'memory');
  const personalHome = join(root, 'personal');
  const repositoryRoot = join(root, 'repositories');
  mkdirSync(join(harnessRoot, 'bin'), { recursive: true });
  mkdirSync(join(harnessHome, '.harnessmith'), { recursive: true });
  mkdirSync(personalHome, { recursive: true });
  writeFileSync(instruction, '# rules\n');
  writeFileSync(join(personalHome, 'AGENTS.md'), '# personal\n');
  writeFileSync(join(harnessRoot, 'bin', 'harness.mjs'), '#!/usr/bin/env node\n');
  writeFileSync(
    join(harnessRoot, 'manifest.json'),
    JSON.stringify({ schemaVersion: 3, memorySchemaVersion: 1 }),
  );
  writeFileSync(
    join(harnessRoot, 'install-context.json'),
    JSON.stringify({
      version: 1,
      adapter: 'review-host',
      harnessHome,
      instructionFiles: [instruction],
      memoryHome,
      personalHome,
      repositoryRoot,
      owner: 'test-owner',
    }),
  );
  const oversized = join(harnessRoot, 'oversized.bin');
  writeFileSync(oversized, '');
  truncateSync(oversized, 129 * 1024 * 1024);
  writeFileSync(
    join(harnessHome, '.harnessmith', 'install.json'),
    JSON.stringify({
      schemaVersion: 1,
      adapter: 'review-host',
      outputs: [
        { path: instruction, checksum: 'invalid' },
        { path: harnessRoot, checksum: 'invalid' },
      ],
    }),
  );
  const runtime = harnessRuntime(root, {
    harnessRoot,
    distributionRoot: harnessHome,
    harnessHome,
    hostAdapter: 'review-host',
    instructionFiles: [instruction],
    installedHarness: harnessRoot,
    docsRoot: join(harnessRoot, 'docs'),
    memoryHome,
    personalHome,
    repositoryRoot,
    identityOverride: undefined,
  });

  const installation = createHealthReport(runtime).checks.find(({ id }) => id === 'installation');
  assert.equal(installation?.status, 'failed');
  assert.equal(
    installation?.details?.some((detail) =>
      /file byte budget exceeded.*oversized\.bin/i.test(detail),
    ),
    true,
  );
});

test('invalid runtime identity disables CLI write commands but keeps diagnostics available', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root, {
    hostAdapter: 'invalid-managed-context',
    identityOverride: undefined,
  });

  assert.throws(
    () => runCli(['init', 'global'], { runtime, io: capturedIo() }),
    /write commands are disabled/i,
  );
  assert.equal(existsSync(runtime.memoryHome), false);
  assert.throws(
    () =>
      runCli(
        [
          'task',
          'init',
          '--project',
          root,
          '--id',
          'blocked-write',
          '--objective',
          'must not write',
          '--accept',
          'no write',
        ],
        { runtime, io: capturedIo() },
      ),
    /write commands are disabled/i,
  );
  assert.equal(existsSync(join(root, '.agent-docs')), false);
  assert.equal(runCli(['health', '--json'], { runtime, io: capturedIo() }), 1);
});

test('health rejects empty global and project memory roots', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  mkdirSync(runtime.memoryHome, { recursive: true });
  const project = join(root, 'project');
  mkdirSync(join(project, '.agent-docs'), { recursive: true });

  const report = createHealthReport(runtime, project);
  const globalMemory = report.checks.find(({ id }) => id === 'global-memory');
  const projectMemory = report.checks.find(({ id }) => id === 'project-memory');
  assert.equal(globalMemory?.status, 'failed');
  assert.match(globalMemory?.message ?? '', /required memory entr/i);
  assert.equal(projectMemory?.status, 'failed');
  assert.match(projectMemory?.message ?? '', /required memory entr/i);
});

test('managed output containment fails closed for Windows cross-drive paths', () => {
  assert.equal(
    managedOutputWithinHome(String.raw`C:\Users\agent\.host`, String.raw`D:\escape\AGENTS.md`),
    false,
  );
  assert.equal(
    managedOutputWithinHome(
      String.raw`C:\Users\agent\.host`,
      String.raw`C:\Users\agent\.host\AGENTS.md`,
    ),
    true,
  );
});
