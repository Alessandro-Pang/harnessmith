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
      PI_CODING_AGENT_DIR: join(root, 'pi-home'),
      HARNESS_MEMORY_HOME: join(root, 'agent-docs'),
      HARNESS_PERSONAL_HOME: join(root, 'personal-harness'),
      HARNESS_REPOSITORY_ROOT: join(root, 'repos'),
      HARNESS_OWNER: 'pi-test',
    },
  });
}

test('Pi install, status, restore, and uninstall use the effective Pi home', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-pi-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const agentHome = join(root, 'pi-home');
  const rules = join(agentHome, 'AGENTS.md');
  mkdirSync(agentHome, { recursive: true });
  writeFileSync(rules, 'existing pi rules');

  const dryRun = execute(root, ['install', '--agent', 'pi', '--dry-run', '--json']);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  const dryPlan = JSON.parse(dryRun.stdout.trim().split('\n')[0]);
  assert.equal(dryPlan.adapter, 'pi');
  assert.equal(dryPlan.home, join(realpathSync.native(root), 'pi-home'));
  assert.equal(existsSync(join(agentHome, 'agent-harness')), false);
  assert.equal(readFileSync(rules, 'utf8'), 'existing pi rules');

  const installed = execute(root, [
    'install',
    '--agent',
    'pi',
    '--force',
    '--no-init-global',
    '--json',
  ]);
  assert.equal(installed.status, 0, installed.stderr);
  const installResult = JSON.parse(installed.stdout);
  assert.equal(installResult.results[0].adapter, 'pi');
  assert.equal(installResult.results[0].home, join(realpathSync.native(root), 'pi-home'));
  assert.match(readFileSync(rules, 'utf8'), /managed-by: harnessmith/);
  const backup = readdirSync(agentHome).find((name) => name.startsWith('AGENTS.md.backup-'));
  assert.ok(backup);
  assert.equal(readFileSync(join(agentHome, backup), 'utf8'), 'existing pi rules');

  const status = execute(root, ['status', '--agent', 'pi', '--json']);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).outputs[0].status, 'managed');

  const upgraded = execute(root, ['install', '--agent', 'pi', '--no-init-global', '--json']);
  assert.equal(upgraded.status, 0, upgraded.stderr);
  const restored = execute(root, ['restore', '--agent', 'pi', '--json']);
  assert.equal(restored.status, 0, restored.stderr);
  assert.match(readFileSync(rules, 'utf8'), /managed-by: harnessmith/);

  const uninstalled = execute(root, ['uninstall', '--agent', 'pi', '--json']);
  assert.equal(uninstalled.status, 0, uninstalled.stderr);
  assert.equal(readFileSync(rules, 'utf8'), 'existing pi rules');
  assert.equal(existsSync(join(agentHome, 'agent-harness')), false);
  assert.equal(existsSync(join(agentHome, '.harnessmith', 'install.json')), false);
});

test('Pi aliases resolve to the pi adapter', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-pi-alias-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));

  for (const agent of ['pi-agent', '7']) {
    const dryRun = execute(root, ['install', '--agent', agent, '--dry-run', '--json']);
    assert.equal(dryRun.status, 0, `${agent}\n${dryRun.stderr}`);
    assert.equal(JSON.parse(dryRun.stdout.trim().split('\n')[0]).adapter, 'pi');
  }
});

test('Pi is preflighted before another target is changed', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-pi-lifecycle-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  execute(root, ['--agent', 'codex,pi', '--no-init-global']);
  const codexRules = join(root, 'codex-home', 'AGENTS.md');
  const piRules = join(root, 'pi-home', 'AGENTS.md');
  writeFileSync(piRules, `${readFileSync(piRules, 'utf8')}\nuser edit\n`);

  const result = execute(root, ['uninstall', '--agent', 'codex,pi']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /modified/);
  assert.ok(existsSync(codexRules));
  assert.ok(existsSync(join(root, 'codex-home', '.harnessmith', 'install.json')));
  assert.ok(existsSync(join(root, 'pi-home', '.harnessmith', 'install.json')));
});
