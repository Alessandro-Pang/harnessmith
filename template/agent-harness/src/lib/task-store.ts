import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import lockfile from 'proper-lockfile';
import type { TaskRecord } from '../types.js';
import { errorMessage } from '../types.js';
import { atomicWrite, atomicWriteMany } from './files.js';
import { projectSnapshot } from './project.js';
import { assertSafePath } from './safe-path.js';
import { assertTaskId } from './task-model.js';

export function projectRoot(input: string): string {
  return projectSnapshot(input).root;
}

export function taskDirectory(root: string, id: string): string {
  assertTaskId(id);
  const working = resolve(root, '.agent-docs', 'working');
  const directory = resolve(working, id);
  if (!directory.startsWith(`${working}${sep}`))
    throw new Error(`Task escapes working root: ${id}`);
  assertSafePath(root, directory);
  return directory;
}

export function taskPath(root: string, id: string): string {
  return join(taskDirectory(root, id), 'task.json');
}

export function withTaskLock<T>(root: string, id: string, operation: () => T): T {
  const directory = taskDirectory(root, id);
  mkdirSync(directory, { recursive: true });
  let release: (() => void) | undefined;
  try {
    release = lockfile.lockSync(directory, { realpath: false, stale: 30_000, retries: 0 });
  } catch (error) {
    throw new Error(`Task is being updated by another process: ${id}`, { cause: error });
  }
  try {
    return operation();
  } finally {
    release();
  }
}

export function readTask(root: string, id: string): { path: string; value: TaskRecord } {
  const path = taskPath(root, id);
  if (!existsSync(path)) throw new Error(`Task does not exist: ${id}`);
  try {
    return { path, value: JSON.parse(readFileSync(path, 'utf8')) as TaskRecord };
  } catch (error) {
    throw new Error(`Invalid task JSON ${path}: ${errorMessage(error)}`);
  }
}

export function writeTask(path: string, task: TaskRecord): void {
  atomicWrite(path, `${JSON.stringify(task, null, 2)}\n`);
}

export function writeTaskWithProgress(
  taskFile: string,
  task: TaskRecord,
  progressFile: string,
  progress: string,
): void {
  atomicWriteMany([
    { path: taskFile, content: `${JSON.stringify(task, null, 2)}\n` },
    { path: progressFile, content: progress },
  ]);
}
