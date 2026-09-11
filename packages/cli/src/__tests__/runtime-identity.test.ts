import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onTestFinished, test } from 'vitest';
import { resolveRuntimeIdentity } from '../../../../packages/harness/src/runtime.js';

const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const cli = join(packageRoot, 'bin', 'harnessmith.mjs');

function installCodex(root: string): void {
  const result = spawnSync(process.execPath, [cli, '--agent', 'codex'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: root,
      CODEX_HOME: join(root, 'codex-home'),
      HARNESS_MEMORY_HOME: join(root, 'agent-docs'),
      HARNESS_PERSONAL_HOME: join(root, 'personal-harness'),
      HARNESS_REPOSITORY_ROOT: join(root, 'repos'),
      HARNESS_OWNER: 'runtime-identity-test',
    },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

test('managed runtime identity accepts a canonical alias to the recorded installation', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-runtime-alias-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  installCodex(root);
  const hub = join(root, '.agents', 'harnessmith');
  const alias = join(root, 'hub-alias');
  symlinkSync(hub, alias, process.platform === 'win32' ? 'junction' : 'dir');

  assert.equal(resolveRuntimeIdentity(join(alias, 'skills', 'agent-harness')).kind, 'managed');
  assert.equal(
    resolveRuntimeIdentity(join(root, '.agents', 'skills', 'agent-harness')).kind,
    'managed',
    'the ~/.agents/skills discovery link resolves to the hub',
  );
});

test('managed runtime identity rejects a context copied outside the recorded installation', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-runtime-copy-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  installCodex(root);
  const installedContext = readFileSync(
    join(root, '.agents', 'harnessmith', 'skills', 'agent-harness', 'install-context.json'),
    'utf8',
  );
  const copiedHarness = join(root, 'copied-host', 'skills', 'agent-harness');
  mkdirSync(copiedHarness, { recursive: true });
  writeFileSync(join(copiedHarness, 'install-context.json'), installedContext);

  assert.equal(resolveRuntimeIdentity(copiedHarness).kind, 'invalid');
});
