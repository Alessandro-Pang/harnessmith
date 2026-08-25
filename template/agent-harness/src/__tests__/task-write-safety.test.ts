import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { checkpointTask, initTask } from '../commands/task.js';
import { updateAcceptance } from '../commands/task-acceptance.js';
import { writeTask, writeTaskWithProgress } from '../lib/task-store.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function projectFixture(): { project: string; runtime: ReturnType<typeof harnessRuntime> } {
  const project = mkdtempSync(join(tmpdir(), 'harness-task-write-safety-'));
  onTestFinished(() => rmSync(project, { recursive: true, force: true }));
  execFileSync('git', ['-C', project, 'init', '-q']);
  return { project, runtime: harnessRuntime(project) };
}

test('acceptance updates refuse an invalid memory root without changing the task ledger', () => {
  const { project, runtime } = projectFixture();
  const created = initTask(
    runtime,
    {
      project,
      id: 'preflight-before-accept',
      objective: 'Keep task writes inside a valid memory root',
      acceptance: ['Safe'],
    },
    capturedIo(),
  );
  const path = join(project, '.agent-docs', 'working', created.id, 'task.json');
  const before = readFileSync(path, 'utf8');
  writeFileSync(join(project, '.agent-docs', 'invalid.md'), 'missing frontmatter\n');

  assert.throws(
    () =>
      updateAcceptance(
        {
          project,
          id: created.id,
          criterion: 'criterion-1',
          status: 'inconclusive',
        },
        capturedIo(),
      ),
    /memory preflight failed/i,
  );
  assert.equal(readFileSync(path, 'utf8'), before);
});

test('acceptance updates reject a task ledger that would exceed its validation budget', () => {
  const { project, runtime } = projectFixture();
  const created = initTask(
    runtime,
    {
      project,
      id: 'bounded-task-write',
      objective: 'Bound task ledger writes',
      acceptance: ['Safe'],
    },
    capturedIo(),
  );
  const path = join(project, '.agent-docs', 'working', created.id, 'task.json');
  const before = readFileSync(path, 'utf8');
  const evidence = JSON.stringify({
    type: 'observation',
    tool: 'human',
    result: 'A'.repeat(1024 * 1024),
  });

  assert.throws(
    () =>
      updateAcceptance(
        {
          project,
          id: created.id,
          criterion: 'criterion-1',
          status: 'inconclusive',
          evidence: [evidence],
        },
        capturedIo(),
      ),
    /task ledger byte budget exceeded/i,
  );
  assert.equal(readFileSync(path, 'utf8'), before);
});

test('writeTask refuses a non-canonical ledger target', () => {
  const { project, runtime } = projectFixture();
  const created = initTask(
    runtime,
    {
      project,
      id: 'canonical-task-path',
      objective: 'Keep task identity aligned with its path',
      acceptance: ['Safe'],
    },
    capturedIo(),
  );
  const forged = join(project, '.agent-docs', 'forged-task.json');

  assert.throws(() => writeTask(forged, created, capturedIo()), /canonical path/i);
  assert.equal(existsSync(forged), false);
});

test('coordinated task writes require canonical task and progress paths', () => {
  const { project, runtime } = projectFixture();
  const created = initTask(
    runtime,
    {
      project,
      id: 'canonical-coordinated-paths',
      objective: 'Keep coordinated task paths aligned',
      acceptance: ['Safe'],
    },
    capturedIo(),
  );
  const taskFile = join(project, '.agent-docs', 'working', created.id, 'task.json');
  const progressFile = join(project, '.agent-docs', 'working', created.id, 'progress.md');
  const taskBefore = readFileSync(taskFile, 'utf8');
  const progressBefore = readFileSync(progressFile, 'utf8');
  const forgedTask = join(project, '.agent-docs', 'orphan-task.json');
  const forgedProgress = join(project, '.agent-docs', 'orphan-progress.md');

  assert.throws(
    () => writeTaskWithProgress(forgedTask, created, progressFile, progressBefore, capturedIo()),
    /task ledger must use its canonical path/i,
  );
  assert.throws(
    () => writeTaskWithProgress(taskFile, created, forgedProgress, progressBefore, capturedIo()),
    /task progress must use its canonical path/i,
  );
  assert.equal(readFileSync(taskFile, 'utf8'), taskBefore);
  assert.equal(readFileSync(progressFile, 'utf8'), progressBefore);
  assert.equal(existsSync(forgedTask), false);
  assert.equal(existsSync(forgedProgress), false);
});

test('checkpoint refuses an invalid memory root without changing coordinated task files', () => {
  const { project, runtime } = projectFixture();
  const created = initTask(
    runtime,
    {
      project,
      id: 'preflight-before-checkpoint',
      objective: 'Preflight coordinated task writes',
      acceptance: ['Safe'],
    },
    capturedIo(),
  );
  const taskFile = join(project, '.agent-docs', 'working', created.id, 'task.json');
  const progressFile = join(project, '.agent-docs', 'working', created.id, 'progress.md');
  const taskBefore = readFileSync(taskFile, 'utf8');
  const progressBefore = readFileSync(progressFile, 'utf8');
  writeFileSync(join(project, '.agent-docs', 'invalid-checkpoint.md'), 'missing frontmatter\n');

  assert.throws(
    () =>
      checkpointTask(
        { project, id: created.id, summary: 'This must not be persisted.' },
        capturedIo(),
      ),
    /memory preflight failed/i,
  );
  assert.equal(readFileSync(taskFile, 'utf8'), taskBefore);
  assert.equal(readFileSync(progressFile, 'utf8'), progressBefore);
});

test('invalid task initialization is side-effect free before project memory exists', () => {
  const { project, runtime } = projectFixture();

  assert.throws(
    () =>
      initTask(
        runtime,
        { project, id: 'invalid-empty-criterion', objective: 'Validate first', acceptance: [''] },
        capturedIo(),
      ),
    /acceptance criteria must not be empty/i,
  );
  assert.equal(existsSync(join(project, '.agent-docs')), false);
});
