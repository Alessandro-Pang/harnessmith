import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onTestFinished, test } from 'vitest';
import { resolveRuntimeIdentity } from '../../../../packages/harness/src/runtime.js';

const packageRoot = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), '..', '..');
const bundledSkill = join(packageRoot, 'template', 'skills', 'agent-harness');

test('bundled runtime identity accepts the package source and a canonical alias', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-runtime-alias-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const alias = join(root, 'package-alias');
  symlinkSync(packageRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');

  assert.deepEqual(resolveRuntimeIdentity(bundledSkill), {
    kind: 'standalone',
    source: 'source-tree',
  });
  assert.equal(
    resolveRuntimeIdentity(join(alias, 'template', 'skills', 'agent-harness')).kind,
    'standalone',
  );
  assert.equal(resolveRuntimeIdentity(join(packageRoot, 'packages', 'harness')).kind, 'standalone');
});

test('bundled runtime identity rejects copied or missing installation contexts outside the package', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-runtime-copy-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const copiedHarness = join(root, 'copied-host', 'skills', 'agent-harness');
  const recordedHub = join(root, 'recorded-hub');
  mkdirSync(copiedHarness, { recursive: true });

  assert.equal(resolveRuntimeIdentity(copiedHarness).kind, 'invalid');

  writeFileSync(
    join(copiedHarness, 'install-context.json'),
    JSON.stringify({
      version: 2,
      harnessHome: recordedHub,
      agentsHome: join(root, '.agents'),
      instructionFiles: [join(recordedHub, 'entry', 'AGENTS.md')],
      stateHome: join(recordedHub, 'state'),
      memoryHome: join(recordedHub, 'memory'),
      personalHome: join(recordedHub, 'rules'),
      repositoryRoot: join(root, 'repos'),
      owner: 'runtime-identity-test',
    }),
  );

  assert.equal(resolveRuntimeIdentity(copiedHarness).kind, 'invalid');
});
