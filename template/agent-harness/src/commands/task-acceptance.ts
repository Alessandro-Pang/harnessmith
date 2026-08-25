import { assertNoHighConfidenceSecret } from '../lib/secret-hygiene.js';
import { captureTaskEvidence } from '../lib/task-evidence.js';
import {
  type AcceptanceOptions,
  assertTaskMutable,
  isAcceptanceStatus,
  now,
  taskSummary,
} from '../lib/task-model.js';
import { outputTask } from '../lib/task-output.js';
import { projectRoot, readTask, withTaskLock, writeTask } from '../lib/task-store.js';
import type { Io, TaskRecord } from '../types.js';

export function updateAcceptance(
  {
    project = process.cwd(),
    id,
    criterion,
    status,
    evidence = [],
    json = false,
  }: AcceptanceOptions = {},
  io: Io = console,
): TaskRecord {
  assertNoHighConfidenceSecret(
    [project, id, criterion, status, ...evidence],
    'Task acceptance request',
  );
  if (!id || !criterion) throw new Error('Task requires --id <id> and --criterion <id>');
  if (!status || !isAcceptanceStatus(status)) {
    throw new Error(`Invalid acceptance status: ${status}`);
  }
  if (status === 'passed') {
    throw new Error(
      'task accept cannot mark acceptance passed; use task verify for mechanical evidence',
    );
  }
  const root = projectRoot(project);
  return withTaskLock(root, id, () => {
    const { path, value: task, snapshot } = readTask(root, id);
    assertTaskMutable(task);
    const target = task.acceptance.find((item) => item.id === criterion);
    if (!target) throw new Error(`Acceptance criterion does not exist: ${criterion}`);
    const time = now();
    const capturedEvidence = captureTaskEvidence(evidence, snapshot, time, task.id, target.id);
    target.status = status;
    target.evidence.push(...capturedEvidence);
    task.updated = time;
    writeTask(path, task, io);
    outputTask(taskSummary(task, snapshot), json, io);
    return task;
  });
}
