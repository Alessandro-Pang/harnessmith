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
      CODEBUDDY_CONFIG_DIR: join(root, 'codebuddy-home'),
      HARNESS_MEMORY_HOME: join(root, 'agent-docs'),
      HARNESS_PERSONAL_HOME: join(root, 'personal-harness'),
      HARNESS_REPOSITORY_ROOT: join(root, 'repos'),
      HARNESS_OWNER: 'workbuddy-test',
    },
  });
}

test('WorkBuddy install, status, restore, and uninstall use the effective CodeBuddy config dir', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-workbuddy-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const agentHome = join(root, 'codebuddy-home');
  const rules = join(agentHome, 'CODEBUDDY.md');
  mkdirSync(agentHome, { recursive: true });
  writeFileSync(rules, 'existing workbuddy rules');

  const dryRun = execute(root, ['install', '--agent', 'workbuddy', '--dry-run', '--json']);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  const dryPlan = JSON.parse(dryRun.stdout.trim().split('\n')[0]);
  assert.equal(dryPlan.adapter, 'workbuddy');
  assert.equal(dryPlan.home, join(realpathSync.native(root), 'codebuddy-home'));
  assert.equal(existsSync(join(agentHome, 'agent-harness')), false);
  assert.equal(readFileSync(rules, 'utf8'), 'existing workbuddy rules');

  const installed = execute(root, [
    'install',
    '--agent',
    'workbuddy',
    '--force',
    '--no-init-global',
    '--json',
  ]);
  assert.equal(installed.status, 0, installed.stderr);
  const installResult = JSON.parse(installed.stdout);
  assert.equal(installResult.results[0].adapter, 'workbuddy');
  assert.equal(installResult.results[0].home, join(realpathSync.native(root), 'codebuddy-home'));
  assert.match(readFileSync(rules, 'utf8'), /managed-by: harnessmith/);
  const backup = readdirSync(agentHome).find((name) => name.startsWith('CODEBUDDY.md.backup-'));
  assert.ok(backup);
  assert.equal(readFileSync(join(agentHome, backup), 'utf8'), 'existing workbuddy rules');

  const status = execute(root, ['status', '--agent', 'workbuddy', '--json']);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).outputs[0].status, 'managed');

  const upgraded = execute(root, ['install', '--agent', 'workbuddy', '--no-init-global', '--json']);
  assert.equal(upgraded.status, 0, upgraded.stderr);
  const restored = execute(root, ['restore', '--agent', 'workbuddy', '--json']);
  assert.equal(restored.status, 0, restored.stderr);
  assert.match(readFileSync(rules, 'utf8'), /managed-by: harnessmith/);

  const uninstalled = execute(root, ['uninstall', '--agent', 'workbuddy', '--json']);
  assert.equal(uninstalled.status, 0, uninstalled.stderr);
  assert.equal(readFileSync(rules, 'utf8'), 'existing workbuddy rules');
  assert.equal(existsSync(join(agentHome, 'agent-harness')), false);
  assert.equal(existsSync(join(agentHome, '.harnessmith', 'install.json')), false);
});

test('WorkBuddy aliases resolve to the workbuddy adapter', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-workbuddy-alias-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));

  for (const agent of ['codebuddy', 'codebuddy-code', '8']) {
    const dryRun = execute(root, ['install', '--agent', agent, '--dry-run', '--json']);
    assert.equal(dryRun.status, 0, `${agent}\n${dryRun.stderr}`);
    assert.equal(JSON.parse(dryRun.stdout.trim().split('\n')[0]).adapter, 'workbuddy');
  }
});

test('WorkBuddy is preflighted before another target is changed', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-workbuddy-lifecycle-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  execute(root, ['--agent', 'codex,workbuddy', '--no-init-global']);
  const codexRules = join(root, 'codex-home', 'AGENTS.md');
  const workbuddyRules = join(root, 'codebuddy-home', 'CODEBUDDY.md');
  writeFileSync(workbuddyRules, `${readFileSync(workbuddyRules, 'utf8')}\nuser edit\n`);

  const result = execute(root, ['uninstall', '--agent', 'codex,workbuddy']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /modified/);
  assert.ok(existsSync(codexRules));
  assert.ok(existsSync(join(root, 'codex-home', '.harnessmith', 'install.json')));
  assert.ok(existsSync(join(root, 'codebuddy-home', '.harnessmith', 'install.json')));
});
