import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { listFiles } from '../lib/files.js';
import { updateFrontmatter } from '../lib/frontmatter.js';
import { projectSnapshot } from '../lib/project.js';
import { initializeProjectMemory } from '../lib/project-memory.js';
import {
  type AcceptanceOptions,
  assertTaskId,
  assertTaskMutable,
  type CheckpointOptions,
  defaultTaskId,
  type InitTaskOptions,
  isAcceptanceStatus,
  isCheckpointStatus,
  isTaskStatus,
  now,
  progressDocument,
  type TaskBaseOptions,
  taskSummary,
  updateProgressFrontmatter,
} from '../lib/task-model.js';
import { outputTask } from '../lib/task-output.js';
import {
  projectRoot,
  readTask,
  taskDirectory,
  taskPath,
  withTaskLock,
  writeTask,
  writeTaskWithProgress,
} from '../lib/task-store.js';
import type { Io, Runtime, TaskCheckpoint, TaskRecord, TaskSummary } from '../types.js';

export type { AcceptanceOptions, CheckpointOptions } from '../lib/task-model.js';

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
  if (!objective?.trim()) throw new Error('Task objective is required: --objective <text>');
  if (acceptance.length === 0)
    throw new Error('At least one acceptance criterion is required: --accept <text>');
  const root = projectRoot(project);
  const taskId = id || defaultTaskId(objective);
  assertTaskId(taskId);
  initializeProjectMemory(runtime, root);
  const criteria = acceptance.map((description) => description.trim());
  if (criteria.some((description) => !description)) {
    throw new Error('Acceptance criteria must not be empty');
  }
  return withTaskLock(root, taskId, () => {
    const path = taskPath(root, taskId);
    if (existsSync(path)) throw new Error(`Task already exists: ${taskId}`);
    const created = now();
    const snapshot = projectSnapshot(root);
    const task: TaskRecord = {
      schemaVersion: 1,
      id: taskId,
      objective: objective.trim(),
      status: 'in_progress',
      created,
      updated: created,
      projectRoot: root,
      nextAction,
      baseline: {
        branch: snapshot.branch,
        head: snapshot.head,
        dirty: snapshot.dirty,
      },
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
    );
    outputTask(taskSummary(task), json, io);
    return task;
  });
}

export function taskStatus(
  { project = process.cwd(), id, json = false }: TaskBaseOptions = {},
  io: Io = console,
): TaskRecord | TaskSummary[] {
  const root = projectRoot(project);
  if (id) {
    const task = readTask(root, id).value;
    outputTask(taskSummary(task), json, io);
    return task;
  }
  const working = join(root, '.agent-docs', 'working');
  if (!existsSync(working)) {
    outputTask([], json, io);
    return [];
  }
  const tasks = listFiles(working)
    .filter((path) => basename(path) === 'task.json')
    .map((path) => JSON.parse(readFileSync(path, 'utf8')) as TaskRecord)
    .map(taskSummary)
    .sort((a, b) => b.updated.localeCompare(a.updated));
  outputTask(tasks, json, io);
  return tasks;
}

function checkpointTaskAtRoot(
  root: string,
  id: string,
  { summary, nextAction, status, evidence = [], json = false }: CheckpointOptions,
  io: Io,
): TaskRecord {
  const normalizedSummary = summary?.trim() || '';
  const { path, value: task } = readTask(root, id);
  assertTaskMutable(task);
  const time = now();
  const checkpoint: TaskCheckpoint = { time, summary: normalizedSummary, evidence };
  if (nextAction !== undefined) checkpoint.nextAction = nextAction;
  task.checkpoints.push(checkpoint);
  task.updated = time;
  if (nextAction !== undefined) task.nextAction = nextAction;
  if (status) task.status = status;
  const progressPath = join(taskDirectory(root, id), 'progress.md');
  let progress = existsSync(progressPath)
    ? readFileSync(progressPath, 'utf8')
    : progressDocument(task, 'agent');
  progress = updateFrontmatter(progress, updateProgressFrontmatter(task, time));
  writeTaskWithProgress(
    path,
    task,
    progressPath,
    `${progress}## ${time}\n\n${normalizedSummary}\n\n`,
  );
  outputTask(taskSummary(task), json, io);
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
  if (!id) throw new Error('Task id is required: --id <id>');
  if (!summary?.trim()) throw new Error('Checkpoint summary is required: --summary <text>');
  if (status && !isTaskStatus(status)) throw new Error(`Invalid task status: ${status}`);
  if (status && !isCheckpointStatus(status)) {
    throw new Error(`Checkpoint cannot close a task; use task close --status ${status}`);
  }
  const root = projectRoot(project);
  return withTaskLock(root, id, () =>
    checkpointTaskAtRoot(root, id, { summary, nextAction, status, evidence, json }, io),
  );
}

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
  if (!id || !criterion)
    throw new Error('Task and criterion are required: --id <id> --criterion <id>');
  if (!status || !isAcceptanceStatus(status))
    throw new Error(`Invalid acceptance status: ${status}`);
  if (status === 'passed' && evidence.length === 0) {
    throw new Error('Passed acceptance requires evidence: --evidence <ref>');
  }
  const root = projectRoot(project);
  return withTaskLock(root, id, () => {
    const { path, value: task } = readTask(root, id);
    assertTaskMutable(task);
    const target = task.acceptance.find((item) => item.id === criterion);
    if (!target) throw new Error(`Acceptance criterion does not exist: ${criterion}`);
    target.status = status;
    target.evidence.push(...evidence);
    task.updated = now();
    writeTask(path, task);
    outputTask(taskSummary(task), json, io);
    return task;
  });
}

export function closeTask(options: CheckpointOptions = {}, io: Io = console): TaskRecord {
  const status = options.status || 'complete';
  if (!['complete', 'blocked', 'superseded'].includes(status)) {
    throw new Error(`Invalid closing status: ${status}`);
  }
  if (!options.id) throw new Error('Task id is required: --id <id>');
  if (!options.summary?.trim()) throw new Error('Checkpoint summary is required: --summary <text>');
  const root = projectRoot(options.project || process.cwd());
  return withTaskLock(root, options.id, () => {
    const task = readTask(root, options.id as string).value;
    assertTaskMutable(task);
    if (status === 'complete') {
      const incomplete = task.acceptance.filter((criterion) => criterion.status !== 'passed');
      if (incomplete.length > 0) {
        throw new Error(
          `Cannot complete task; acceptance is not passed: ${incomplete.map(({ id }) => id).join(', ')}`,
        );
      }
    }
    return checkpointTaskAtRoot(root, options.id as string, { ...options, status }, io);
  });
}
