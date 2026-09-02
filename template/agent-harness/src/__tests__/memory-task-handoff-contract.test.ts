import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { captureHandoff, closeHandoff } from '../commands/memory/memory-autopilot.js';
import { initTask } from '../commands/task/task.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'harness-task-handoff-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(root, { recursive: true });
  execFileSync('git', ['-C', root, 'init', '-q']);
  return { project: root, runtime: harnessRuntime(root) };
}

test('task-bound handoff uses the task ledger as the only current next action', () => {
  const { project, runtime } = fixture();
  initTask(
    runtime,
    {
      project,
      id: 'quality-review',
      objective: 'Implement the quality review',
      acceptance: ['Focused tests pass'],
      nextAction: 'Run focused tests.',
    },
    capturedIo(),
  );
  const options = {
    session: 'quality-review-thread',
    taskId: 'quality-review',
    title: 'Quality review',
    objective: 'Implement the quality review.',
    completed: 'Started the implementation.',
    next: 'Use a different next action.',
    reason: 'phase' as const,
  };

  assert.throws(
    () => captureHandoff(runtime, project, options, capturedIo()),
    /handoff next must match task quality-review nextAction/i,
  );

  const result = captureHandoff(
    runtime,
    project,
    { ...options, next: 'Run focused tests.' },
    capturedIo(),
  );
  const handoff = readFileSync(result.path, 'utf8');
  assert.match(handoff, /^task-id: quality-review$/m);
  assert.match(handoff, /^source-refs:\n {2}- task:quality-review$/m);
  const core = readFileSync(join(project, '.agent-docs', 'core.md'), 'utf8');
  const recent = core.slice(core.indexOf('## Recent Handoffs'));
  assert.match(recent, /task: quality-review/);
  assert.doesNotMatch(recent, /next: Run focused tests/);
});

test('closing a handoff requires an explicit workstream outcome', () => {
  const { project, runtime } = fixture();
  captureHandoff(
    runtime,
    project,
    {
      session: 'explicit-close',
      title: 'Explicit close',
      objective: 'Require an end signal.',
      completed: 'Recovery state exists.',
      next: 'Wait for an explicit end signal.',
      reason: 'phase',
    },
    capturedIo(),
  );

  assert.throws(
    () => closeHandoff(runtime, project, { session: 'explicit-close' }, capturedIo()),
    /workstream outcome is required/i,
  );
  assert.equal(
    closeHandoff(
      runtime,
      project,
      { session: 'explicit-close', outcome: 'completed' },
      capturedIo(),
    ).action,
    'updated',
  );
});
