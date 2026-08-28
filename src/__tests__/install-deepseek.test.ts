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
      DSH_HOME: join(root, 'dsh-home'),
      HARNESS_MEMORY_HOME: join(root, 'agent-docs'),
      HARNESS_PERSONAL_HOME: join(root, 'personal-harness'),
      HARNESS_REPOSITORY_ROOT: join(root, 'repos'),
      HARNESS_OWNER: 'deepseek-test',
    },
  });
}

test('DeepSeek install, status, restore, and uninstall use the effective DSH home', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-deepseek-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const agentHome = join(root, 'dsh-home');
  const rules = join(agentHome, 'AGENTS.md');
  mkdirSync(agentHome, { recursive: true });
  writeFileSync(rules, 'existing deepseek rules');

  const dryRun = execute(root, ['install', '--agent', 'deepseek', '--dry-run', '--json']);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  const dryPlan = JSON.parse(dryRun.stdout.trim().split('\n')[0]);
  assert.equal(dryPlan.adapter, 'deepseek');
  assert.equal(dryPlan.home, join(realpathSync.native(root), 'dsh-home'));
  assert.equal(existsSync(join(agentHome, 'agent-harness')), false);
  assert.equal(readFileSync(rules, 'utf8'), 'existing deepseek rules');

  const installed = execute(root, [
    'install',
    '--agent',
    'deepseek',
    '--force',
    '--no-init-global',
    '--json',
  ]);
  assert.equal(installed.status, 0, installed.stderr);
  const installResult = JSON.parse(installed.stdout);
  assert.equal(installResult.results[0].adapter, 'deepseek');
  assert.equal(installResult.results[0].home, join(realpathSync.native(root), 'dsh-home'));
  assert.match(readFileSync(rules, 'utf8'), /managed-by: harnessmith/);
  const backup = readdirSync(agentHome).find((name) => name.startsWith('AGENTS.md.backup-'));
  assert.ok(backup);
  assert.equal(readFileSync(join(agentHome, backup), 'utf8'), 'existing deepseek rules');

  const status = execute(root, ['status', '--agent', 'deepseek', '--json']);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).outputs[0].status, 'managed');

  const restored = execute(root, ['restore', '--agent', 'deepseek', '--json']);
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(readFileSync(rules, 'utf8'), 'existing deepseek rules');
  assert.equal(existsSync(join(agentHome, 'agent-harness')), false);
  assert.equal(existsSync(join(agentHome, '.harnessmith', 'install.json')), false);

  const reinstalled = execute(root, [
    'install',
    '--agent',
    'deepseek',
    '--force',
    '--no-init-global',
    '--json',
  ]);
  assert.equal(reinstalled.status, 0, reinstalled.stderr);

  const uninstalled = execute(root, ['uninstall', '--agent', 'deepseek', '--json']);
  assert.equal(uninstalled.status, 0, uninstalled.stderr);
  assert.equal(readFileSync(rules, 'utf8'), 'existing deepseek rules');
  assert.equal(existsSync(join(agentHome, 'agent-harness')), false);
  assert.equal(existsSync(join(agentHome, '.harnessmith', 'install.json')), false);
});

test('DeepSeek aliases resolve to the deepseek adapter', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-deepseek-alias-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));

  for (const agent of ['dsh', 'deepseek-harness', '5']) {
    const dryRun = execute(root, ['install', '--agent', agent, '--dry-run', '--json']);
    assert.equal(dryRun.status, 0, `${agent}\n${dryRun.stderr}`);
    assert.equal(JSON.parse(dryRun.stdout.trim().split('\n')[0]).adapter, 'deepseek');
  }
});
