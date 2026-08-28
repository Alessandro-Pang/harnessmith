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
      OPENCODE_CONFIG_DIR: join(root, 'opencode-home'),
      HARNESS_MEMORY_HOME: join(root, 'agent-docs'),
      HARNESS_PERSONAL_HOME: join(root, 'personal-harness'),
      HARNESS_REPOSITORY_ROOT: join(root, 'repos'),
      HARNESS_OWNER: 'opencode-test',
    },
  });
}

test('OpenCode install, status, and uninstall use the effective global config root', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-opencode-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const agentHome = join(root, 'opencode-home');
  const rules = join(agentHome, 'AGENTS.md');
  mkdirSync(agentHome, { recursive: true });
  writeFileSync(rules, 'existing opencode rules');

  const installed = execute(root, ['install', '--agent', 'opencode', '--force', '--json']);
  assert.equal(installed.status, 0, installed.stderr);
  const installResult = JSON.parse(installed.stdout);
  assert.equal(installResult.results[0].adapter, 'opencode');
  assert.equal(installResult.results[0].home, join(realpathSync.native(root), 'opencode-home'));
  assert.match(readFileSync(rules, 'utf8'), /managed-by: harnessmith/);
  const backup = readdirSync(agentHome).find((name) => name.startsWith('AGENTS.md.backup-'));
  assert.ok(backup);
  assert.equal(readFileSync(join(agentHome, backup), 'utf8'), 'existing opencode rules');

  const status = execute(root, ['status', '--agent', 'opencode', '--json']);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).outputs[0].status, 'managed');

  const uninstalled = execute(root, ['uninstall', '--agent', 'opencode', '--json']);
  assert.equal(uninstalled.status, 0, uninstalled.stderr);
  assert.equal(readFileSync(rules, 'utf8'), 'existing opencode rules');
  assert.equal(existsSync(join(agentHome, 'agent-harness')), false);
  assert.equal(existsSync(join(agentHome, '.harnessmith', 'install.json')), false);
});
