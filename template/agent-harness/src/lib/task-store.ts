import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { ProjectSnapshot, TaskRecord } from '../types.js';
import { errorMessage } from '../types.js';
import { withExclusiveDirectoryLock } from './exclusive-lock.js';
import { atomicWrite, atomicWriteMany } from './files.js';
import { parseFrontmatter, updateFrontmatter } from './frontmatter.js';
import { withMemoryLock } from './memory-lock.js';
import { projectSnapshot, resolveProjectRoot } from './project.js';
import { assertSafePath } from './safe-path.js';
import { assertTaskId } from './task-model.js';
import { normalizeTaskRecord } from './task-record.js';

export function projectRoot(input: string): string {
  return resolveProjectRoot(input);
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
  return withExclusiveDirectoryLock(directory, `Task ${id}`, operation);
}

export function readTask(
  root: string,
  id: string,
): { path: string; value: TaskRecord; snapshot: ProjectSnapshot } {
  const path = taskPath(root, id);
  if (!existsSync(path)) throw new Error(`Task does not exist: ${id}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid task JSON ${path}: ${errorMessage(error)}`);
  }
  const value = normalizeTaskRecord(parsed, path);
  if (resolve(value.projectRoot) !== resolve(root)) {
    throw new Error(
      `Invalid task schema ${path}: projectRoot ${value.projectRoot} does not match ${root}`,
    );
  }
  return { path, value, snapshot: projectSnapshot(root) };
}

export function writeTask(path: string, task: TaskRecord): void {
  normalizeTaskRecord(task, path);
  withMemoryLock(join(task.projectRoot, '.agent-docs'), () => {
    atomicWrite(path, `${JSON.stringify(task, null, 2)}\n`);
  });
}

export function writeTaskWithProgress(
  taskFile: string,
  task: TaskRecord,
  progressFile: string,
  progress: string,
): void {
  normalizeTaskRecord(task, taskFile);
  const memoryRoot = join(task.projectRoot, '.agent-docs');
  const corePath = join(memoryRoot, 'core.md');
  withMemoryLock(memoryRoot, () => {
    let core = readFileSync(corePath, 'utf8');
    const reference = `memory:working/${task.id}/progress`;
    core = core
      .split(/\r?\n/)
      .filter((line) => !line.includes(reference))
      .join('\n');
    if (!core.endsWith('\n')) core += '\n';
    if (task.status !== 'complete' && task.status !== 'superseded') {
      const objective = task.objective.replace(/\s+/g, ' ').trim();
      const nextAction = task.nextAction.replace(/\s+/g, ' ').trim() || 'continue from task status';
      const entry = `- ${task.status} task ${task.id}: ${objective}; next: ${nextAction}; ${reference}`;
      core = core.includes('## Active Work\n')
        ? core.replace('## Active Work\n', `## Active Work\n\n${entry}\n`)
        : `${core}\n## Active Work\n\n${entry}\n`;
    }
    const coreMetadata = parseFrontmatter(core);
    const updated = [
      String(coreMetadata.get('created') || ''),
      String(coreMetadata.get('updated') || ''),
      task.updated.slice(0, 10),
    ]
      .sort()
      .at(-1);
    core = updateFrontmatter(core, { updated });
    atomicWriteMany([
      { path: taskFile, content: `${JSON.stringify(task, null, 2)}\n` },
      { path: progressFile, content: progress },
      { path: corePath, content: core },
    ]);
  });
}
