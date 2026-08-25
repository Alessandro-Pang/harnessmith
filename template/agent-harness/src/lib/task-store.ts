import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { Io, ProjectSnapshot, TaskRecord } from '../types.js';
import { errorMessage } from '../types.js';
import { readBoundedRegularFile } from './bounded-file.js';
import { withExclusiveDirectoryLock } from './exclusive-lock.js';
import { parseFrontmatter } from './frontmatter.js';
import { escapeCoreLabel, removeCoreReference, upsertCoreReference } from './memory-core.js';
import { withMemoryLock } from './memory-lock.js';
import { maximumMemoryDocumentBytes, readMemoryDocument } from './memory-path.js';
import { validateMemoryPreflight } from './memory-preflight.js';
import { writeValidated } from './memory-write.js';
import { projectSnapshot, resolveProjectRoot } from './project.js';
import { assertSafePath, canonicalPath, sameCanonicalPath, sameExistingPath } from './safe-path.js';
import {
  assertNoHighConfidenceSecret,
  assertNoHighConfidenceSecretInValue,
  containsHighConfidenceSecret,
} from './secret-hygiene.js';
import { assertTaskId } from './task-model.js';
import { normalizeTaskRecord } from './task-record.js';

export function projectRoot(input: string): string {
  return resolveProjectRoot(input);
}

export function taskDirectory(root: string, id: string): string {
  assertTaskId(id);
  assertNoHighConfidenceSecret([id], 'Task id');
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

function readTaskArtifact(root: string, path: string, subject: string): string {
  try {
    assertSafePath(root, path);
    const content = readBoundedRegularFile(path, {
      maxBytes: maximumMemoryDocumentBytes,
      subject,
    }).content;
    assertNoHighConfidenceSecret([content], subject);
    return content;
  } catch (error) {
    const message = errorMessage(error);
    if (containsHighConfidenceSecret(message)) {
      throw new Error(`${subject} read failed: diagnostic redacted`);
    }
    throw error;
  }
}

export function readTaskProgress(root: string, path: string): string {
  return readTaskArtifact(root, path, 'Task progress');
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
  assertSafePath(root, path);
  if (!existsSync(path)) throw new Error(`Task does not exist: ${id}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readTaskArtifact(root, path, 'Task ledger'));
  } catch (error) {
    const message = errorMessage(error);
    if (!message.startsWith('Task ledger') && !/symbolic link|exceeds .* bytes/i.test(message)) {
      throw new Error('Invalid task JSON');
    }
    throw error;
  }
  assertNoHighConfidenceSecretInValue(parsed, 'Task ledger');
  const value = normalizeTaskRecord(parsed, path);
  const activeRoot = canonicalPath(root);
  if (!sameExistingPath(value.projectRoot, activeRoot)) {
    throw new Error(
      `Invalid task schema ${path}: projectRoot ${value.projectRoot} does not match ${root}`,
    );
  }
  value.projectRoot = activeRoot;
  return { path, value, snapshot: projectSnapshot(activeRoot) };
}

const maximumTaskRecordBytes = 1024 * 1024;

export function writeTask(path: string, task: TaskRecord, io: Io = console): void {
  normalizeTaskRecord(task, path);
  assertNoHighConfidenceSecretInValue(task, 'Task ledger');
  const canonicalTaskPath = taskPath(task.projectRoot, task.id);
  if (!sameCanonicalPath(path, canonicalTaskPath)) {
    throw new Error(`Task ledger must use its canonical path: ${canonicalTaskPath}`);
  }
  const content = `${JSON.stringify(task, null, 2)}\n`;
  if (Buffer.byteLength(content) > maximumTaskRecordBytes) {
    throw new Error(`Task ledger byte budget exceeded: ${maximumTaskRecordBytes}`);
  }
  const memoryRoot = join(task.projectRoot, '.agent-docs');
  withMemoryLock(memoryRoot, () => {
    assertSafePath(task.projectRoot, path);
    validateMemoryPreflight(memoryRoot, 'project');
    writeValidated(memoryRoot, [{ path, content }], io, { rootKind: 'project' });
  });
}

export function writeTaskWithProgress(
  taskFile: string,
  task: TaskRecord,
  progressFile: string,
  progress: string,
  io: Io = console,
): void {
  normalizeTaskRecord(task, taskFile);
  assertNoHighConfidenceSecretInValue(task, 'Task ledger');
  assertNoHighConfidenceSecret([progress], 'Task progress');
  const canonicalTaskFile = taskPath(task.projectRoot, task.id);
  const canonicalProgressFile = join(taskDirectory(task.projectRoot, task.id), 'progress.md');
  if (!sameCanonicalPath(taskFile, canonicalTaskFile)) {
    throw new Error(`Task ledger must use its canonical path: ${canonicalTaskFile}`);
  }
  if (!sameCanonicalPath(progressFile, canonicalProgressFile)) {
    throw new Error(`Task progress must use its canonical path: ${canonicalProgressFile}`);
  }
  const taskContent = `${JSON.stringify(task, null, 2)}\n`;
  if (Buffer.byteLength(taskContent) > maximumTaskRecordBytes) {
    throw new Error(`Task ledger byte budget exceeded: ${maximumTaskRecordBytes}`);
  }
  if (Buffer.byteLength(progress) > maximumMemoryDocumentBytes) {
    throw new Error(`Task progress byte budget exceeded: ${maximumMemoryDocumentBytes}`);
  }
  const memoryRoot = join(task.projectRoot, '.agent-docs');
  const corePath = join(memoryRoot, 'core.md');
  withMemoryLock(memoryRoot, () => {
    validateMemoryPreflight(memoryRoot, 'project');
    let core = readMemoryDocument(corePath);
    const reference = `memory:working/${task.id}/progress`;
    const coreMetadata = parseFrontmatter(core);
    const updated =
      [
        String(coreMetadata.get('created') || ''),
        String(coreMetadata.get('updated') || ''),
        task.updated.slice(0, 10),
      ]
        .sort()
        .at(-1) ?? task.updated.slice(0, 10);
    if (task.status === 'complete' || task.status === 'superseded') {
      core = removeCoreReference(core, 'Active Work', reference, updated);
    } else {
      const objective = escapeCoreLabel(task.objective.replace(/\s+/g, ' ').trim());
      const nextAction = escapeCoreLabel(
        task.nextAction.replace(/\s+/g, ' ').trim() || 'continue from task status',
      );
      const entry = `- ${task.status} task ${task.id}: ${objective}; next: ${nextAction}; ${reference}`;
      core = upsertCoreReference(core, 'Active Work', entry, reference, updated);
    }
    writeValidated(
      memoryRoot,
      [
        { path: taskFile, content: taskContent },
        { path: progressFile, content: progress },
        { path: corePath, content: core },
      ],
      io,
      { rootKind: 'project' },
    );
  });
}
