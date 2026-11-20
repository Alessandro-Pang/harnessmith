import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { runCli } from '../cli.js';
import { initGlobal } from '../commands/init.js';
import { createHealthReport } from '../lib/health/health.js';
import {
  assertRuntimeCanMutate,
  resolveRuntimeIdentity,
  verifyRuntimeIdentity,
} from '../runtime.js';
import { capturedIo, harnessRuntime, sourceHarnessRoot } from './helpers/harness.js';

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'harness-health-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function legacyInstallContext(harnessHome: string, root: string): string {
  return JSON.stringify({
    version: 2,
    harnessHome,
    agentsHome: join(root, 'agents'),
    instructionFiles: [join(harnessHome, 'entry', 'AGENTS.md')],
    stateHome: join(harnessHome, 'state'),
    memoryHome: join(root, 'memory'),
    personalHome: join(root, 'personal'),
    repositoryRoot: join(root, 'repositories'),
    owner: 'test-owner',
  });
}

test('runtime identity fails closed outside a verified package and no longer consumes install contexts', () => {
  const root = temporaryRoot();
  const missing = resolveRuntimeIdentity(root);
  assert.equal(missing.kind, 'invalid');
  assert.match(missing.reason, /No verified Harnessmith package structure/);

  writeFileSync(join(root, 'install-context.json'), '{invalid json\n');
  assert.equal(resolveRuntimeIdentity(root).kind, 'invalid');

  writeFileSync(join(root, 'install-context.json'), legacyInstallContext(root, root));
  assert.equal(resolveRuntimeIdentity(root).kind, 'invalid');
});

test('runtime identity accepts only a complete Harnessmith package skeleton', () => {
  const sourceRoot = temporaryRoot();
  const templateSkill = join(sourceRoot, 'template', 'skills', 'agent-harness');
  mkdirSync(templateSkill, { recursive: true });
  writeFileSync(join(sourceRoot, 'package.json'), '{"name":"harnessmith"}\n');
  const standalone = join(sourceRoot, 'packages', 'harness');
  mkdirSync(join(standalone, 'src'), { recursive: true });
  writeFileSync(join(standalone, 'src', 'runtime.ts'), '// source marker\n');

  assert.equal(resolveRuntimeIdentity(templateSkill).kind, 'invalid');
  writeFileSync(join(templateSkill, 'manifest.json'), '{"schemaVersion":3}\n');
  assert.deepEqual(resolveRuntimeIdentity(standalone), {
    kind: 'standalone',
    source: 'source-tree',
  });
  assert.deepEqual(resolveRuntimeIdentity(templateSkill), {
    kind: 'standalone',
    source: 'source-tree',
  });
});

test('runtime identity does not trust a copied source marker in a managed layout', () => {
  const root = temporaryRoot();
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'runtime.ts'), '// copied marker\n');

  assert.equal(resolveRuntimeIdentity(root).kind, 'invalid');
});

test('health refuses an unverified standalone identity outside the package', () => {
  const root = temporaryRoot();
  const managedRoot = join(root, 'host', 'skills', 'agent-harness');
  mkdirSync(managedRoot, { recursive: true });
  const runtime = harnessRuntime(root, {
    harnessRoot: managedRoot,
    hostAdapter: 'standalone',
    installedHarness: managedRoot,
    docsRoot: join(managedRoot, 'docs'),
  });

  const installation = createHealthReport(runtime).checks.find(({ id }) => id === 'installation');
  assert.equal(installation?.status, 'failed');
  assert.match(installation?.message ?? '', /runtime identity is not verifiable/i);
});

test('a persisted non-test adapter cannot bypass standalone verification', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root, { hostAdapter: 'hub' });

  const identity = verifyRuntimeIdentity(runtime);
  assert.equal(identity.valid, false);
  assert.throws(() => assertRuntimeCanMutate(runtime), /write commands are disabled/i);
});

test('invalid runtime identity disables CLI write commands but keeps diagnostics available', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root, {
    hostAdapter: 'invalid-identity',
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

test('health passes the bundled standalone package contract without hub records', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root, {
    installedHarness: sourceHarnessRoot,
    docsRoot: join(sourceHarnessRoot, 'docs'),
  });
  mkdirSync(runtime.personalHome, { recursive: true });
  writeFileSync(join(runtime.personalHome, 'AGENTS.md'), '# personal\n');
  mkdirSync(join(runtime.harnessHome, '.harnessmith'), { recursive: true });
  writeFileSync(join(runtime.harnessHome, '.harnessmith', 'install.json'), '{legacy hub record}\n');

  const installation = createHealthReport(runtime).checks.find(({ id }) => id === 'installation');
  assert.equal(installation?.status, 'passed');
  assert.match(installation?.message ?? '', /standalone package contract/i);
});

test('health fails when the bundled CLI entry is missing from the package root', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root, {
    distributionRoot: join(root, 'empty-distribution'),
    installedHarness: sourceHarnessRoot,
    docsRoot: join(sourceHarnessRoot, 'docs'),
  });
  mkdirSync(runtime.personalHome, { recursive: true });
  writeFileSync(join(runtime.personalHome, 'AGENTS.md'), '# personal\n');

  const installation = createHealthReport(runtime).checks.find(({ id }) => id === 'installation');
  assert.equal(installation?.status, 'failed');
  assert.equal(
    installation?.details?.some((detail) => detail.endsWith(join('dist', 'harness.mjs'))),
    true,
  );
});

test('health fails when the skill manifest or personal rules are missing', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);

  const installation = createHealthReport(runtime).checks.find(({ id }) => id === 'installation');
  assert.equal(installation?.status, 'failed');
  assert.equal(
    installation?.details?.some((detail) => detail.endsWith('manifest.json')),
    true,
  );
  assert.equal(
    installation?.details?.some((detail) => detail.endsWith('AGENTS.md')),
    true,
  );
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

test('health reports an invalid installation manifest without throwing', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  mkdirSync(runtime.installedHarness, { recursive: true });
  mkdirSync(runtime.personalHome, { recursive: true });
  writeFileSync(join(runtime.personalHome, 'AGENTS.md'), '# personal\n');
  writeFileSync(join(runtime.installedHarness, 'manifest.json'), '{invalid json\n');

  const check = createHealthReport(runtime).checks.find(({ id }) => id === 'installation');

  assert.equal(check?.status, 'failed');
  assert.match(check?.message ?? '', /manifest is invalid/i);
});

test('health reports an incompatible installation schema', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  mkdirSync(runtime.installedHarness, { recursive: true });
  mkdirSync(runtime.personalHome, { recursive: true });
  writeFileSync(join(runtime.personalHome, 'AGENTS.md'), '# personal\n');
  writeFileSync(join(runtime.installedHarness, 'manifest.json'), '{}\n');

  const check = createHealthReport(runtime).checks.find(({ id }) => id === 'installation');

  assert.equal(check?.status, 'failed');
  assert.match(check?.message ?? '', /schema is incompatible/i);
});

test('health fails an otherwise valid memory root when an active document is unindexed', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  writeFileSync(
    join(runtime.memoryHome, 'unindexed.md'),
    [
      '---',
      'title: Unindexed memory',
      'description: Active memory omitted from the core index',
      'type: evidence-manifest',
      'memory-kind: working',
      'status: active',
      'owners: [test-owner]',
      'created: 2026-08-25',
      'updated: 2026-08-25',
      'expires: 2026-09-25',
      'project: global',
      'tags: [test]',
      'scope: []',
      'source-refs: []',
      'source-of-truth: false',
      'schema-version: 1',
      '---',
      '',
      'Unindexed fixture.',
    ].join('\n'),
  );

  const check = createHealthReport(runtime).checks.find(({ id }) => id === 'global-memory');

  assert.equal(check?.status, 'failed');
  assert.match(check?.message ?? '', /active memory document.*unindexed/i);
  assert.deepEqual(check?.details, ['unindexed.md']);
});
