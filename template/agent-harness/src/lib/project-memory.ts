import { existsSync, lstatSync, mkdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { Runtime } from '../types.js';
import { readBoundedRegularFile } from './bounded-file.js';
import { atomicWrite } from './files.js';
import { gitRoot } from './git.js';
import { withMemoryLock } from './memory-lock.js';
import { maximumMemoryDocumentBytes } from './memory-path.js';
import { validateMemoryPreflight } from './memory-preflight.js';
import {
  assertExactFileState,
  cleanupTrackedDirectories,
  type ExactDirectoryIdentity,
  type ExactFileState,
  restoreExactFileState,
  snapshotDirectoryIdentity,
} from './memory-write.js';
import { assertSafePath, sameCanonicalPath } from './safe-path.js';
import { readTemplate, render } from './templates.js';

export interface ProjectMemoryInitialization {
  memoryRoot: string;
  created: string[];
  updatedIgnores: string[];
}

interface FileSnapshot {
  path: string;
  exists: boolean;
  content: string;
  mode: number;
}

interface ProjectMemoryTransactionOptions {
  allowNonCanonicalReferences?: boolean;
  allowInputIdentityDiagnostics?: boolean;
  allowHandoffIdentityDiagnostics?: boolean;
}

function ensureIgnore(
  path: string,
  rollbackSnapshot: FileSnapshot,
  attempted: Map<string, ExactFileState>,
): boolean {
  const rule = '/.agent-docs/';
  const heading = '# Local Agent working documents';
  const before = snapshot(path);
  const current = before.content;
  if (current.split(/\r?\n/).includes(rule)) return false;
  const prefix = current.length === 0 ? '' : current.endsWith('\n') ? '\n' : '\n\n';
  const content = `${current}${prefix}${heading}\n${rule}\n`;
  const candidate = { exists: true, content, mode: before.mode };
  assertExactFileState(path, before, 'Project ignore update');
  Object.assign(rollbackSnapshot, before);
  attempted.set(path, candidate);
  atomicWrite(path, candidate.content, candidate.mode);
  return true;
}

function snapshot(path: string): FileSnapshot {
  if (!existsSync(path)) return { path, exists: false, content: '', mode: 0o644 };
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new Error(`Project memory transaction requires a regular file: ${path}`);
  }
  return {
    path,
    exists: true,
    content: readBoundedRegularFile(path, {
      maxBytes: maximumMemoryDocumentBytes,
      subject: 'Project transaction file',
    }).content,
    mode: entry.mode & 0o777,
  };
}

function restore(
  target: string,
  snapshots: FileSnapshot[],
  attempted: ReadonlyMap<string, ExactFileState>,
): string[] {
  const errors: string[] = [];
  for (const entry of [...snapshots].reverse()) {
    const candidate = attempted.get(entry.path);
    if (!candidate) continue;
    const error = restoreExactFileState(target, entry.path, entry, candidate);
    if (error) errors.push(error);
  }
  return errors;
}

function initializeUnlocked(
  runtime: Runtime,
  target: string,
  memoryRoot: string,
  ignoreFiles: string[],
  snapshots: ReadonlyMap<string, FileSnapshot>,
  attempted: Map<string, ExactFileState>,
): ProjectMemoryInitialization {
  mkdirSync(memoryRoot, { recursive: true });
  const created: string[] = [];
  for (const name of ['README.md', 'core.md']) {
    const destination = join(memoryRoot, name);
    const content = render(runtime, readTemplate(runtime, `project-agent-docs/${name}`), {
      PROJECT_KEY: basename(target),
    });
    const before = snapshots.get(destination);
    if (!before) throw new Error(`Project memory snapshot is missing: ${destination}`);
    if (!before.exists) {
      const candidate = { exists: true, content, mode: before.mode };
      assertExactFileState(destination, before, 'Project memory initialization');
      attempted.set(destination, candidate);
      atomicWrite(destination, candidate.content, candidate.mode);
      created.push(destination);
    }
  }
  return {
    memoryRoot,
    created,
    updatedIgnores: ignoreFiles.filter((path) => {
      const before = snapshots.get(path);
      if (!before) throw new Error(`Project ignore snapshot is missing: ${path}`);
      return ensureIgnore(path, before, attempted);
    }),
  };
}

export function withProjectMemoryTransaction<T>(
  runtime: Runtime,
  input: string,
  operation: (initialization: ProjectMemoryInitialization) => T,
  {
    allowNonCanonicalReferences = false,
    allowInputIdentityDiagnostics = false,
    allowHandoffIdentityDiagnostics = false,
  }: ProjectMemoryTransactionOptions = {},
): T {
  const requested = resolve(input);
  if (!existsSync(requested) || !statSync(requested).isDirectory()) {
    throw new Error(`Project path does not exist or is not a directory: ${requested}`);
  }
  const target = gitRoot(requested) || requested;
  const memoryRoot = join(target, '.agent-docs');
  if (sameCanonicalPath(memoryRoot, runtime.memoryHome)) {
    throw new Error(`Project memory root collides with global memory: ${memoryRoot}`);
  }
  const memoryFiles = ['README.md', 'core.md'].map((name) => join(memoryRoot, name));
  const ignoreFiles = [join(target, '.gitignore'), join(target, '.ignore')];
  assertSafePath(target, memoryRoot);
  for (const path of memoryFiles) assertSafePath(memoryRoot, path);
  for (const path of ignoreFiles) assertSafePath(target, path);
  return withMemoryLock(memoryRoot, ({ rootExisted }) => {
    let snapshots: FileSnapshot[] = [];
    const attempted = new Map<string, ExactFileState>();
    const createdRoot: ExactDirectoryIdentity | undefined = rootExisted
      ? undefined
      : snapshotDirectoryIdentity(memoryRoot);
    try {
      snapshots = [...memoryFiles, ...ignoreFiles].map(snapshot);
      for (const entry of snapshots) attempted.set(entry.path, entry);
      const snapshotsByPath = new Map(snapshots.map((entry) => [entry.path, entry]));
      const initialization = initializeUnlocked(
        runtime,
        target,
        memoryRoot,
        ignoreFiles,
        snapshotsByPath,
        attempted,
      );
      validateMemoryPreflight(memoryRoot, 'project', {
        allowNonCanonicalReferences,
        allowInputIdentityDiagnostics,
        allowHandoffIdentityDiagnostics,
      });
      return operation(initialization);
    } catch (error) {
      const rollbackErrors = restore(target, snapshots, attempted);
      if (createdRoot) {
        rollbackErrors.push(...cleanupTrackedDirectories([createdRoot], 'created project memory'));
      }
      if (rollbackErrors.length > 0) {
        throw new Error(
          `Project memory initialization failed and rollback was incomplete: ${String(error)}; unresolved paths: ${rollbackErrors.join('; ')}`,
          { cause: error instanceof Error ? error : undefined },
        );
      }
      throw error;
    }
  });
}

export function initializeProjectMemory(
  runtime: Runtime,
  input = '.',
): ProjectMemoryInitialization {
  return withProjectMemoryTransaction(runtime, input, (initialization) => initialization);
}
