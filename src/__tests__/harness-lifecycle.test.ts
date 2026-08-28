import assert from 'node:assert/strict';
import { type SpawnSyncOptionsWithStringEncoding, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onTestFinished, test } from 'vitest';

const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const installer = join(packageRoot, 'bin', 'harnessmith.mjs');

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

test('packaged Harness completes project memory and task lifecycle', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-harness-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  const agentHome = join(root, 'host');
  const memoryHome = join(root, 'memory');
  mkdirSync(project, { recursive: true });
  run('git', ['-C', project, 'init', '-q']);
  const env = {
    ...process.env,
    HOME: root,
    CODEX_HOME: agentHome,
    HARNESS_MEMORY_HOME: memoryHome,
  };
  run(process.execPath, [installer, '--agent', 'codex'], { cwd: root, env });
  const harness = join(agentHome, 'agent-harness', 'bin', 'harness.mjs');
  assert.ok(existsSync(join(memoryHome, 'README.md')));
  assert.ok(existsSync(join(memoryHome, 'profile.md')));
  assert.match(
    run(process.execPath, [harness, '--help'], { env }),
    /task\s+manage long-running task ledgers/,
  );

  run(process.execPath, [harness, 'init', 'project', project], { env });
  assert.equal(existsSync(join(project, '.gitignore')), false);
  assert.equal(existsSync(join(project, '.ignore')), false);
  assert.equal(readFileSync(join(project, '.agent-docs', '.gitignore'), 'utf8'), '*\n');
  assert.equal(readFileSync(join(project, '.agent-docs', '.ignore'), 'utf8'), '*\n');
  writeFileSync(join(project, 'verification.txt'), 'verification scope\n');
  run(
    process.execPath,
    [
      harness,
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
    ],
    { env },
  );
  run(
    process.execPath,
    [
      harness,
      'task',
      'checkpoint',
      '--project',
      project,
      '--id',
      'lifecycle',
      '--summary',
      'Checkpoint recorded',
    ],
    { env },
  );
  run(
    process.execPath,
    [
      harness,
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
    ],
    { env },
  );
  run(
    process.execPath,
    [
      harness,
      'task',
      'close',
      '--project',
      project,
      '--id',
      'lifecycle',
      '--summary',
      'Lifecycle complete',
    ],
    { env },
  );
  run(process.execPath, [harness, 'memory', 'check', project], { env });
  const validation = run(process.execPath, [harness, 'validate', '--project', project, '--json'], {
    env,
  });
  assert.equal(JSON.parse(validation).valid, true);

  const taskPath = join(project, '.agent-docs', 'working', 'lifecycle', 'task.json');
  const invalidTask = JSON.parse(readFileSync(taskPath, 'utf8'));
  invalidTask.acceptance[0].status = 'pending';
  writeFileSync(taskPath, `${JSON.stringify(invalidTask, null, 2)}\n`);
  const invalid = spawnSync(
    process.execPath,
    [harness, 'validate', '--project', project, '--json'],
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
