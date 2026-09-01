import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onTestFinished, test } from 'vitest';

const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const cli = join(packageRoot, 'bin', 'harnessmith.mjs');

function fixture(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  const git = spawnSync('git', ['-C', project, 'init', '-q'], { encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
  return { root, project };
}

function execute(
  root: string,
  project: string,
  args: string[],
  envOverrides: NodeJS.ProcessEnv = {},
) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: root,
      CODEX_HOME: join(root, 'codex-home'),
      HARNESS_MEMORY_HOME: join(root, 'agent-docs'),
      HARNESS_PERSONAL_HOME: join(root, 'personal-harness'),
      HARNESS_REPOSITORY_ROOT: root,
      HARNESS_OWNER: 'setup-test',
      SETUP_TEST_PROJECT: project,
      ...envOverrides,
    },
  });
}

test('setup dry-run explains global and project plans without writing', () => {
  const { root, project } = fixture('harnessmith-setup-preview-');
  const result = execute(root, project, [
    'setup',
    '--agent',
    'codex,cursor',
    '--project',
    project,
    '--dry-run',
    '--json',
  ]);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.command, 'setup');
  assert.equal(report.phase, 'preview');
  assert.equal(report.requiresConfirmation, true);
  assert.equal(report.adapters[0].capabilities.scope, 'global');
  assert.equal(report.adapters[1].capabilities.scope, 'project');
  assert.ok(
    report.adapters.every(({ outputs }: { outputs: Array<{ state: string }> }) =>
      outputs.every(({ state }) => state === 'missing'),
    ),
  );
  assert.deepEqual(Object.keys(report.stateDefinitions), [
    'managed',
    'unmanaged',
    'modified',
    'unsupported',
    'host-dependent',
  ]);
  assert.equal(report.hostBehavior.status, 'not-verified');
  assert.match(report.recovery.restore, /restore/);
  assert.equal(existsSync(join(root, 'codex-home')), false);
  assert.equal(existsSync(join(project, '.cursor')), false);
});

test('setup installs and verifies global and project adapters without claiming Host behavior', () => {
  const { root, project } = fixture('harnessmith-setup-install-');
  const result = execute(root, project, [
    'setup',
    '--agent',
    'codex,cursor',
    '--project',
    project,
    '--yes',
    '--json',
  ]);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.phase, 'complete');
  assert.equal(report.result, 'installed-and-healthy');
  assert.equal(report.hostBehavior.status, 'not-verified');
  assert.match(report.minimalExample.prompt, /read-only|只读/i);
  assert.deepEqual(
    report.verification.map(({ adapter, ownership, runtimeHealth }: Record<string, string>) => ({
      adapter,
      ownership,
      runtimeHealth,
    })),
    [
      { adapter: 'codex', ownership: 'managed', runtimeHealth: 'passed' },
      { adapter: 'cursor', ownership: 'managed', runtimeHealth: 'passed' },
    ],
  );
  assert.ok(existsSync(join(root, 'codex-home', '.harnessmith', 'install.json')));
  assert.ok(existsSync(join(project, '.cursor', '.harnessmith', 'install.json')));
});

test('setup requires explicit non-interactive confirmation', () => {
  const { root, project } = fixture('harnessmith-setup-confirm-');
  const result = execute(root, project, ['setup', '--agent', 'codex', '--json']);

  assert.equal(result.status, 2);
  const error = JSON.parse(result.stderr).error;
  assert.equal(error.code, 'CLI_USAGE');
  assert.match(error.message, /--yes|dry-run/i);
  assert.equal(existsSync(join(root, 'codex-home')), false);
});

test('setup distinguishes unmanaged and modified conflicts and refuses both by default', () => {
  const unmanaged = fixture('harnessmith-setup-unmanaged-');
  const unmanagedHome = join(unmanaged.root, 'codex-home');
  mkdirSync(unmanagedHome, { recursive: true });
  writeFileSync(join(unmanagedHome, 'AGENTS.md'), 'unmanaged rules\n');
  const unmanagedResult = execute(unmanaged.root, unmanaged.project, [
    'setup',
    '--agent',
    'codex',
    '--yes',
    '--json',
  ]);
  assert.equal(unmanagedResult.status, 3);
  assert.match(JSON.parse(unmanagedResult.stderr).error.message, /unmanaged.*--force/i);
  assert.equal(readFileSync(join(unmanagedHome, 'AGENTS.md'), 'utf8'), 'unmanaged rules\n');

  const modified = fixture('harnessmith-setup-modified-');
  const installed = execute(modified.root, modified.project, [
    'install',
    '--agent',
    'codex',
    '--yes',
    '--json',
  ]);
  assert.equal(installed.status, 0, installed.stderr);
  const modifiedRules = join(modified.root, 'codex-home', 'AGENTS.md');
  writeFileSync(modifiedRules, `${readFileSync(modifiedRules, 'utf8')}\nuser edit\n`);
  const modifiedResult = execute(modified.root, modified.project, [
    'setup',
    '--agent',
    'codex',
    '--yes',
    '--json',
  ]);
  assert.equal(modifiedResult.status, 3);
  assert.match(JSON.parse(modifiedResult.stderr).error.message, /modified.*--force/i);
  assert.match(readFileSync(modifiedRules, 'utf8'), /user edit/);
});

test('setup reports recovery guidance and rolls back an initialization failure', () => {
  const { root, project } = fixture('harnessmith-setup-rollback-');
  const blockedMemoryHome = join(root, 'blocked-memory-home');
  writeFileSync(blockedMemoryHome, 'not a directory\n');

  const result = execute(root, project, ['setup', '--agent', 'codex', '--yes', '--json'], {
    HARNESS_MEMORY_HOME: blockedMemoryHome,
  });

  assert.equal(result.status, 1);
  const error = JSON.parse(result.stderr).error;
  assert.equal(error.code, 'INTERNAL_ERROR');
  assert.match(error.message, /attempted rollback/i);
  assert.match(error.message, /setup --dry-run.*status.*restore/i);
  assert.equal(existsSync(join(root, 'codex-home', '.harnessmith', 'install.json')), false);
  assert.equal(existsSync(join(root, 'codex-home', 'AGENTS.md')), false);
  assert.equal(readFileSync(blockedMemoryHome, 'utf8'), 'not a directory\n');
});
