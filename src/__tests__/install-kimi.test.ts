import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onTestFinished, test } from 'vitest';

const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const cli = join(packageRoot, 'bin', 'harnessmith.mjs');

function execute(root: string, args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: root,
      CODEX_HOME: join(root, 'codex-home'),
      KIMI_CODE_HOME: join(root, 'kimi-home'),
      HARNESS_MEMORY_HOME: join(root, 'agent-docs'),
      HARNESS_PERSONAL_HOME: join(root, 'personal-harness'),
      HARNESS_REPOSITORY_ROOT: join(root, 'repos'),
      HARNESS_OWNER: 'kimi-test',
    },
  });
}

test('Kimi Code CLI install, status, restore, and uninstall use the effective data root', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-kimi-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const agentHome = join(root, 'kimi-home');
  const rules = join(agentHome, 'AGENTS.md');
  mkdirSync(agentHome, { recursive: true });
  writeFileSync(rules, 'existing Kimi Code CLI rules');

  const installed = execute(root, ['install', '--agent', 'kimi', '--force', '--json']);
  assert.equal(installed.status, 0, installed.stderr);
  const installResult = JSON.parse(installed.stdout);
  assert.equal(installResult.results[0].adapter, 'kimi');
  assert.equal(installResult.results[0].home, join(realpathSync.native(root), 'kimi-home'));
  assert.match(readFileSync(rules, 'utf8'), /managed-by: harnessmith/);
  const backup = readdirSync(agentHome).find((name) => name.startsWith('AGENTS.md.backup-'));
  assert.ok(backup);
  assert.equal(readFileSync(join(agentHome, backup), 'utf8'), 'existing Kimi Code CLI rules');

  const status = execute(root, ['status', '--agent', 'kimi', '--json']);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).outputs[0].status, 'managed');

  const upgraded = execute(root, ['install', '--agent', 'kimi', '--json']);
  assert.equal(upgraded.status, 0, upgraded.stderr);
  const restored = execute(root, ['restore', '--agent', 'kimi', '--json']);
  assert.equal(restored.status, 0, restored.stderr);
  assert.match(readFileSync(rules, 'utf8'), /managed-by: harnessmith/);

  const uninstalled = execute(root, ['uninstall', '--agent', 'kimi', '--json']);
  assert.equal(uninstalled.status, 0, uninstalled.stderr);
  assert.equal(readFileSync(rules, 'utf8'), 'existing Kimi Code CLI rules');
  assert.equal(existsSync(join(agentHome, 'agent-harness')), false);
  assert.equal(existsSync(join(agentHome, '.harnessmith', 'install.json')), false);
});

test('Kimi Code CLI is preflighted before another target is changed', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-kimi-lifecycle-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  execute(root, ['--agent', 'codex,kimi']);
  const codexRules = join(root, 'codex-home', 'AGENTS.md');
  const kimiRules = join(root, 'kimi-home', 'AGENTS.md');
  writeFileSync(kimiRules, `${readFileSync(kimiRules, 'utf8')}\nuser edit\n`);

  const result = execute(root, ['uninstall', '--agent', 'codex,kimi']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /modified/);
  assert.ok(existsSync(codexRules));
  assert.ok(existsSync(join(root, 'codex-home', '.harnessmith', 'install.json')));
  assert.ok(existsSync(join(root, 'kimi-home', '.harnessmith', 'install.json')));
});
