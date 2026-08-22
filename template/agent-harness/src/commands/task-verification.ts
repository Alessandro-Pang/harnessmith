import {
  assertTaskMutable,
  now,
  taskSummary,
  type VerifyAcceptanceOptions,
} from '../lib/task-model.js';
import { outputTask } from '../lib/task-output.js';
import { projectRoot, readTask, withTaskLock, writeTask } from '../lib/task-store.js';
import { mechanicallyVerifyEvidence } from '../lib/task-verification.js';
import type { Io, TaskRecord } from '../types.js';

export function verifyAcceptance(
  {
    project = process.cwd(),
    id,
    criterion,
    type,
    command,
    args = [],
    scope = [],
    file,
    timeoutMs,
    json = false,
  }: VerifyAcceptanceOptions = {},
  io: Io = console,
): TaskRecord {
  if (!id || !criterion) {
    throw new Error('Task and criterion are required: --id <id> --criterion <id>');
  }
  if (!type || !['command', 'test', 'file', 'diff'].includes(type)) {
    throw new Error(`Invalid mechanical evidence type: ${String(type)}`);
  }
  const root = projectRoot(project);
  return withTaskLock(root, id, () => {
    const { path, value: task } = readTask(root, id);
    assertTaskMutable(task);
    const target = task.acceptance.find((item) => item.id === criterion);
    if (!target) throw new Error(`Acceptance criterion does not exist: ${criterion}`);
    const time = now();
    const result = mechanicallyVerifyEvidence(
      root,
      { type, command, args, scope, file, timeoutMs },
      time,
      task.id,
      target.id,
    );
    target.status = result.passed ? 'passed' : 'failed';
    target.evidence.push(result.evidence);
    task.updated = time;
    writeTask(path, task);
    outputTask(taskSummary(task, result.snapshot), json, io);
    if (result.failure) throw new Error(`Task verification failed: ${result.failure}`);
    return task;
  });
}
