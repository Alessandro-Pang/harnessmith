import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { updateFrontmatter } from '../../lib/documentation/frontmatter.js';
import { listFiles } from '../../lib/filesystem/files.js';
import { assertSafePath } from '../../lib/filesystem/safe-path.js';
import { projectSnapshot } from '../../lib/project/project.js';
import { initializeProjectMemory } from '../../lib/project/project-memory.js';
import { assertNoHighConfidenceSecret } from '../../lib/security/secret-hygiene.js';
import { assertTaskCanComplete, captureTaskEvidence } from '../../lib/task/task-evidence.js';
import {
  assertPortableTaskId,
  assertTaskMutable,
  type CheckpointOptions,
  defaultTaskId,
  type InitTaskOptions,
  isCheckpointStatus,
  isTaskStatus,
  now,
  progressDocument,
  type TaskBaseOptions,
  taskSummary,
  updateProgressFrontmatter,
} from '../../lib/task/task-model.js';
import { outputTask } from '../../lib/task/task-output.js';
import {
  projectRoot,
  readTask,
  readTaskProgress,
  taskDirectory,
  taskPath,
  withTaskLock,
  writeTaskWithProgress,
} from '../../lib/task/task-store.js';
import type { Io, Runtime, TaskCheckpoint, TaskRecord, TaskSummary } from '../../types.js';

export type { CheckpointOptions } from '../../lib/task/task-model.js';

function assertSafeTaskRequest(subject: string, ...values: Array<string | string[] | undefined>) {
  assertNoHighConfidenceSecret(
    values.flatMap((value) => (Array.isArray(value) ? value : [value])),
    subject,
  );
}

export function initTask(
  runtime: Runtime,
  {
    project = process.cwd(),
    id,
    objective,
    acceptance = [],
    nextAction = '',
    json = false,
  }: InitTaskOptions = {},
  io: Io = console,
): TaskRecord {
  assertSafeTaskRequest(
    'Task initialization request',
    project,
    id,
    objective,
    nextAction,
    acceptance,
  );
  if (!objective?.trim()) throw new Error('Task objective is required: --objective <text>');
  if (acceptance.length === 0)
    throw new Error('At least one acceptance criterion is required: --accept <text>');
  const taskId = id || defaultTaskId(objective);
  assertPortableTaskId(taskId);
  const criteria = acceptance.map((description) => description.trim());
  if (criteria.some((description) => !description))
    throw new Error('Acceptance criteria must not be empty');
  const root = projectRoot(project);
  initializeProjectMemory(runtime, root);
  return withTaskLock(root, taskId, () => {
    const path = taskPath(root, taskId);
    if (existsSync(path)) throw new Error(`Task already exists: ${taskId}`);
    const created = now();
    const snapshot = projectSnapshot(root);
    const task: TaskRecord = {
      schemaVersion: 3,
      id: taskId,
      objective: objective.trim(),
      status: 'in_progress',
      created,
      updated: created,
      projectRoot: root,
      nextAction,
      baseline: { branch: snapshot.branch, head: snapshot.head, dirty: snapshot.dirty },
      acceptance: criteria.map((description, index) => ({
        id: `criterion-${index + 1}`,
        description,
        status: 'pending',
        evidence: [],
      })),
      checkpoints: [],
    };
    writeTaskWithProgress(
      path,
      task,
      join(taskDirectory(root, taskId), 'progress.md'),
      progressDocument(task, runtime.owner),
      io,
    );
    outputTask(taskSummary(task, snapshot), json, io);
    return task;
  });
}

export function taskStatus(
  { project = process.cwd(), id, json = false }: TaskBaseOptions = {},
  io: Io = console,
): TaskRecord | TaskSummary[] {
  assertSafeTaskRequest('Task status request', project, id);
  const root = projectRoot(project);
  if (id) {
    const { value: task, snapshot } = readTask(root, id);
    outputTask(taskSummary(task, snapshot), json, io);
    return task;
  }
  const working = join(root, '.agent-docs', 'working');
  if (!existsSync(working)) {
    outputTask([], json, io);
    return [];
  }
  const tasks = listFiles(working)
    .filter((path) => basename(path) === 'task.json')
    .map((path) => readTask(root, basename(dirname(path))))
    .map(({ value, snapshot }) => taskSummary(value, snapshot))
    .sort((a, b) => b.updated.localeCompare(a.updated));
  outputTask(tasks, json, io);
  return tasks;
}

function checkpointTaskAtRoot(
  root: string,
  id: string,
  { summary, nextAction, status, evidence = [], json = false }: CheckpointOptions,
  io: Io,
  loaded?: ReturnType<typeof readTask>,
): TaskRecord {
  const normalizedSummary = summary?.trim() || '';
  const { path, value: task, snapshot } = loaded ?? readTask(root, id);
  assertTaskMutable(task);
  const time = now();
  const checkpoint: TaskCheckpoint = {
    time,
    summary: normalizedSummary,
    evidence: captureTaskEvidence(evidence, snapshot, time, task.id, null),
  };
  if (nextAction !== undefined) checkpoint.nextAction = nextAction;
  task.checkpoints.push(checkpoint);
  task.updated = time;
  if (nextAction !== undefined) task.nextAction = nextAction;
  if (status) task.status = status;
  const progressPath = join(taskDirectory(root, id), 'progress.md');
  assertSafePath(root, progressPath);
  let progress = existsSync(progressPath)
    ? readTaskProgress(root, progressPath)
    : progressDocument(task, 'agent');
  progress = updateFrontmatter(progress, updateProgressFrontmatter(task, time));
  writeTaskWithProgress(
    path,
    task,
    progressPath,
    `${progress}## ${time}\n\n${normalizedSummary}\n\n`,
    io,
  );
  outputTask(taskSummary(task, snapshot), json, io);
  return task;
}

export function checkpointTask(
  {
    project = process.cwd(),
    id,
    summary,
    nextAction,
    status,
    evidence = [],
    json = false,
  }: CheckpointOptions = {},
  io: Io = console,
): TaskRecord {
  assertSafeTaskRequest(
    'Task checkpoint request',
    project,
    id,
    summary,
    nextAction,
    status,
    evidence,
  );
  if (!id) throw new Error('Task id is required: --id <id>');
  if (!summary?.trim()) throw new Error('Checkpoint summary is required: --summary <text>');
  if (status && !isTaskStatus(status)) throw new Error(`Invalid task status: ${status}`);
  if (status && !isCheckpointStatus(status))
    throw new Error(`Checkpoint cannot close a task; use task close --status ${status}`);
  const root = projectRoot(project);
  return withTaskLock(root, id, () =>
    checkpointTaskAtRoot(root, id, { summary, nextAction, status, evidence, json }, io),
  );
}

export function closeTask(options: CheckpointOptions = {}, io: Io = console): TaskRecord {
  const status = options.status || 'complete';
  assertSafeTaskRequest(
    'Task closure request',
    options.project,
    options.id,
    options.summary,
    options.nextAction,
    status,
    options.evidence,
  );
  if (!['complete', 'blocked', 'superseded'].includes(status))
    throw new Error(`Invalid closing status: ${status}`);
  if (!options.id) throw new Error('Task id is required: --id <id>');
  if (!options.summary?.trim()) throw new Error('Checkpoint summary is required: --summary <text>');
  const nextAction = options.nextAction?.trim();
  if (status === 'blocked' && !nextAction)
    throw new Error('Blocked closure requires a next action: --next <text>');
  const root = projectRoot(options.project || process.cwd());
  return withTaskLock(root, options.id, () => {
    const loaded = readTask(root, options.id as string);
    const { value: task, snapshot } = loaded;
    assertTaskMutable(task);
    if (status === 'complete') assertTaskCanComplete(task, snapshot);
    return checkpointTaskAtRoot(
      root,
      options.id as string,
      { ...options, ...(nextAction !== undefined ? { nextAction } : {}), status },
      io,
      loaded,
    );
  });
}
