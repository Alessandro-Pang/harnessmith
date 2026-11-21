import assert from 'node:assert/strict';
import { type SpawnSyncOptionsWithStringEncoding, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onTestFinished, test } from 'vitest';

const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const installer = join(packageRoot, '..', '..', 'bin', 'harnessmith.mjs');

function run(
  command: string,
  args: string[],
  options: Omit<SpawnSyncOptionsWithStringEncoding, 'encoding'> = {},
) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout;
}

function lifecycleEnv(root: string, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: root,
    CODEX_HOME: join(root, 'host'),
    HARNESS_OWNER: 'lifecycle-test',
  };
  delete env.HARNESS_HOME;
  delete env.HARNESS_STATE_HOME;
  delete env.HARNESS_MEMORY_HOME;
  delete env.HARNESS_PERSONAL_HOME;
  return { ...env, ...overrides };
}

test('packaged Harness completes project memory and task lifecycle', { timeout: 90_000 }, () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-harness-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  run('git', ['-C', project, 'init', '-q']);
  const env = lifecycleEnv(root);
  run(process.execPath, [installer, '--agent', 'codex'], { cwd: root, env });

  // User data defaults to ~/.harnessmith; no legacy hub is created or required.
  const userData = join(root, '.harnessmith');
  assert.ok(existsSync(join(userData, 'memory', 'README.md')));
  assert.ok(existsSync(join(userData, 'memory', 'profile.md')));
  assert.ok(existsSync(join(userData, 'rules', 'AGENTS.md')));
  assert.equal(existsSync(join(root, '.agents', 'harnessmith')), false);

  // The installed skill carries no Runtime: scripts/ and dist/ stay in the npm package.
  const skill = join(root, '.agents', 'skills', 'agent-harness');
  assert.ok(existsSync(join(skill, 'SKILL.md')));
  assert.ok(existsSync(join(skill, 'manifest.json')));
  assert.equal(existsSync(join(skill, 'scripts')), false);
  assert.equal(existsSync(join(skill, 'dist')), false);
  assert.equal(existsSync(join(skill, 'install-context.json')), false);

  // The global command dispatches Runtime commands to the same package's bundled Runtime;
  // no hub copy or skill script is involved.
  const harnessmith = (args: string[]) => run(process.execPath, [installer, ...args], { env });
  assert.match(harnessmith(['task', '--help']), /manage long-running task ledgers/);
  const version = JSON.parse(harnessmith(['version', '--json']));
  assert.equal(version.harnessVersion, '3.0.0');
  assert.equal(version.schemaVersion, 3);
  assert.equal(JSON.parse(harnessmith(['health', '--json'])).healthy, true);

  harnessmith(['init', 'project', project]);
  assert.equal(existsSync(join(project, '.gitignore')), false);
  assert.equal(existsSync(join(project, '.ignore')), false);
  assert.equal(readFileSync(join(project, '.agent-docs', '.gitignore'), 'utf8'), '*\n');
  assert.equal(readFileSync(join(project, '.agent-docs', '.ignore'), 'utf8'), '*\n');
  writeFileSync(join(project, 'verification.txt'), 'verification scope\n');
  harnessmith([
    'task',
    'init',
    '--project',
    project,
    '--id',
    'lifecycle',
    '--objective',
    'Exercise lifecycle',
    '--accept',
    'All commands pass',
  ]);
  harnessmith([
    'task',
    'checkpoint',
    '--project',
    project,
    '--id',
    'lifecycle',
    '--summary',
    'Checkpoint recorded',
  ]);
  harnessmith([
    'task',
    'verify',
    '--project',
    project,
    '--id',
    'lifecycle',
    '--criterion',
    'criterion-1',
    '--type',
    'test',
    '--command',
    process.execPath,
    '--arg',
    '-e',
    '--arg',
    'process.exit(0)',
    '--scope',
    'verification.txt',
  ]);
  harnessmith([
    'task',
    'close',
    '--project',
    project,
    '--id',
    'lifecycle',
    '--summary',
    'Lifecycle complete',
  ]);
  harnessmith(['memory', 'check', project]);
  const validation = harnessmith(['validate', '--project', project, '--json']);
  assert.equal(JSON.parse(validation).valid, true);

  const taskPath = join(project, '.agent-docs', 'working', 'lifecycle', 'task.json');
  const invalidTask = JSON.parse(readFileSync(taskPath, 'utf8'));
  invalidTask.acceptance[0].status = 'pending';
  writeFileSync(taskPath, `${JSON.stringify(invalidTask, null, 2)}\n`);
  const invalid = spawnSync(
    process.execPath,
    [installer, 'validate', '--project', project, '--json'],
    {
      encoding: 'utf8',
      env,
    },
  );
  assert.equal(invalid.status, 1, invalid.stderr || invalid.stdout);
  const invalidReport = JSON.parse(invalid.stdout) as {
    valid: boolean;
    checks: Array<{ id: string; status: string }>;
  };
  assert.equal(invalidReport.valid, false);
  assert.ok(
    invalidReport.checks.some(({ id, status }) => id === 'task-schema' && status === 'failed'),
  );
});

test('HARNESS_HOME relocates user data without a managed hub', { timeout: 90_000 }, () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-harness-home-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const userData = join(root, 'custom-data');
  const env = lifecycleEnv(root, { HARNESS_HOME: userData });
  run(process.execPath, [installer, '--agent', 'codex'], { cwd: root, env });

  assert.ok(existsSync(join(userData, 'memory', 'README.md')));
  assert.ok(existsSync(join(userData, 'memory', 'profile.md')));
  assert.ok(existsSync(join(userData, 'rules', 'AGENTS.md')));
  assert.equal(existsSync(join(root, '.harnessmith')), false);
  assert.equal(existsSync(join(root, '.agents', 'harnessmith')), false);

  const health = run(process.execPath, [installer, 'health', '--json'], { env });
  assert.equal(JSON.parse(health).healthy, true);
});
