import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { onTestFinished, test } from 'vitest';
import { memoryCheck } from '../commands/memory.js';
import {
  checkpointTask,
  closeTask,
  initTask,
  taskStatus,
  updateAcceptance,
} from '../commands/task.js';
import { verifyAcceptance } from '../commands/task-verification.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function projectFixture(): { project: string; runtime: ReturnType<typeof harnessRuntime> } {
  const root = mkdtempSync(join(tmpdir(), 'harness-task-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['-C', root, 'init', '-q']);
  return { project: root, runtime: harnessRuntime(root) };
}

function testEvidence(command = 'pnpm run test:harness', exitCode = 0): string {
  return JSON.stringify({ type: 'test', command, exitCode });
}

test('task initialization validates required fields and creates a queryable ledger', () => {
  const { project, runtime } = projectFixture();
  assert.throws(
    () => initTask(runtime, { project, acceptance: ['done'] }),
    /objective is required/,
  );
  assert.throws(() => initTask(runtime, { project, objective: 'Work' }), /acceptance criterion/);
  assert.throws(
    () => initTask(runtime, { project, id: '../escape', objective: 'Work', acceptance: ['done'] }),
    /Invalid task id/,
  );

  const task = initTask(
    runtime,
    {
      project,
      id: 'quality-gates',
      objective: 'Add quality gates',
      acceptance: ['Tests pass', 'Docs validate'],
      nextAction: 'Run tests',
    },
    capturedIo(),
  );
  assert.equal(task.status, 'in_progress');
  assert.equal(task.acceptance.length, 2);
  const progress = readFileSync(
    join(project, '.agent-docs', 'working', task.id, 'progress.md'),
    'utf8',
  );
  const core = readFileSync(join(project, '.agent-docs', 'core.md'), 'utf8');
  assert.match(progress, /^expires: \d{4}-\d{2}-\d{2}$/m);
  assert.match(core, /memory:working\/quality-gates\/progress/);
  assert.doesNotThrow(() => memoryCheck(runtime, project, capturedIo()));
  const current = taskStatus({ project, id: task.id }, capturedIo());
  assert.equal(Array.isArray(current), false);
  assert.equal(Array.isArray(current) ? undefined : current.id, task.id);
  const summaries = taskStatus({ project, json: true }, capturedIo());
  assert.ok(Array.isArray(summaries));
  assert.equal(summaries.length, 1);
  assert.throws(
    () => initTask(runtime, { project, id: task.id, objective: 'Again', acceptance: ['done'] }),
    /already exists/,
  );
});

test('task state transitions require valid statuses and acceptance evidence', () => {
  const { project, runtime } = projectFixture();
  initTask(
    runtime,
    { project, id: 'lifecycle', objective: 'Exercise lifecycle', acceptance: ['Verified'] },
    capturedIo(),
  );
  assert.throws(
    () => checkpointTask({ project, id: 'lifecycle', summary: 'x', status: 'invalid' as never }),
    /Invalid task status/,
  );
  assert.throws(
    () => checkpointTask({ project, id: 'lifecycle', summary: 'bypass', status: 'complete' }),
    /cannot close a task/,
  );
  const checkpointed = checkpointTask(
    {
      project,
      id: 'lifecycle',
      summary: 'Implementation complete',
      nextAction: 'Verify',
      evidence: [testEvidence('pnpm run test:unit')],
    },
    capturedIo(),
  );
  assert.equal(checkpointed.checkpoints.length, 1);
  assert.equal(checkpointed.nextAction, 'Verify');
  assert.throws(
    () => closeTask({ project, id: 'lifecycle', summary: 'Done' }),
    /acceptance is not passed/,
  );
  assert.throws(
    () =>
      updateAcceptance({
        project,
        id: 'lifecycle',
        criterion: 'criterion-1',
        status: 'passed',
      }),
    /cannot mark acceptance passed.*task verify/i,
  );
  assert.throws(
    () =>
      updateAcceptance({
        project,
        id: 'lifecycle',
        criterion: 'missing',
        status: 'failed',
      }),
    /does not exist/,
  );
  const accepted = verifyAcceptance(
    {
      project,
      id: 'lifecycle',
      criterion: 'criterion-1',
      type: 'test',
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
      scope: ['.gitignore'],
    },
    capturedIo(),
  );
  assert.equal(accepted.acceptance[0].status, 'passed');
  const proof = accepted.acceptance[0].evidence[0];
  assert.equal(proof.type, 'test');
  assert.equal(proof.producer, 'harness');
  assert.equal(proof.recordedAt, accepted.updated);
  assert.equal(proof.cwd, accepted.projectRoot);
  const closed = closeTask(
    { project, id: 'lifecycle', summary: 'All criteria verified' },
    capturedIo(),
  );
  assert.equal(closed.status, 'complete');
  assert.doesNotMatch(
    readFileSync(join(project, '.agent-docs', 'core.md'), 'utf8'),
    /memory:working\/lifecycle\/progress/,
  );
  assert.throws(
    () => checkpointTask({ project, id: 'lifecycle', summary: 'late write' }),
    /already closed/,
  );
  assert.throws(
    () =>
      updateAcceptance({
        project,
        id: 'lifecycle',
        criterion: 'criterion-1',
        status: 'failed',
      }),
    /already closed/,
  );
});

test('blocked and superseded closures do not pretend acceptance passed', () => {
  const { project, runtime } = projectFixture();
  initTask(
    runtime,
    { project, id: 'blocked', objective: 'Blocked work', acceptance: ['External input'] },
    capturedIo(),
  );
  assert.throws(
    () => closeTask({ project, id: 'blocked', summary: 'Waiting for access', status: 'blocked' }),
    /Blocked closure requires a next action/,
  );
  const blocked = closeTask(
    {
      project,
      id: 'blocked',
      summary: 'Waiting for access',
      status: 'blocked',
      nextAction: 'Obtain access and resume the task',
    },
    capturedIo(),
  );
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.nextAction, 'Obtain access and resume the task');
  assert.equal(blocked.acceptance[0].status, 'pending');
  assert.throws(
    () => closeTask({ project, id: 'blocked', summary: 'Invalid', status: 'in_progress' }),
    /Invalid closing status/,
  );
});

test('task initialization rejects blank acceptance criteria', () => {
  const { project, runtime } = projectFixture();
  assert.throws(
    () => initTask(runtime, { project, objective: 'Work', acceptance: ['  '] }),
    /must not be empty/,
  );
});

test('concurrent task updates fail instead of overwriting progress', () => {
  const { project, runtime } = projectFixture();
  initTask(
    runtime,
    { project, id: 'locked', objective: 'Serialize updates', acceptance: ['No lost writes'] },
    capturedIo(),
  );
  const release = lockfile.lockSync(join(project, '.agent-docs', 'working', 'locked'), {
    realpath: false,
  });
  try {
    assert.throws(
      () => checkpointTask({ project, id: 'locked', summary: 'competing update' }),
      /another process/,
    );
  } finally {
    release();
  }
});

test('failed progress writes do not commit a task checkpoint', () => {
  const { project, runtime } = projectFixture();
  initTask(
    runtime,
    {
      project,
      id: 'atomic',
      objective: 'Keep task state consistent',
      acceptance: ['No partial write'],
    },
    capturedIo(),
  );
  const directory = join(project, '.agent-docs', 'working', 'atomic');
  const taskPath = join(directory, 'task.json');
  const progressPath = join(directory, 'progress.md');
  const before = readFileSync(taskPath, 'utf8');
  renameSync(progressPath, join(directory, 'progress.original.md'));
  mkdirSync(progressPath);

  assert.throws(
    () => checkpointTask({ project, id: 'atomic', summary: 'must roll back' }, capturedIo()),
    /EISDIR|directory/i,
  );
  assert.equal(readFileSync(taskPath, 'utf8'), before);
});
