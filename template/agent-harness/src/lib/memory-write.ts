import { existsSync, lstatSync, mkdirSync, rmdirSync, rmSync, statSync } from 'node:fs';
import { dirname, relative, sep } from 'node:path';
import type { Io } from '../types.js';
import { readBoundedRegularFile } from './bounded-file.js';
import { atomicWrite } from './files.js';
import type { MemoryRootKind } from './memory-autopilot-document-rules.js';
import { readMemoryDocument } from './memory-path.js';
import { validateMemoryRoot } from './memory-validation.js';
import { assertSafePath } from './safe-path.js';

export interface MemoryWriteResult {
  version: 1;
  action: 'created' | 'updated' | 'unchanged';
  kind: 'input' | 'episode' | 'profile';
  path: string;
  reference: string;
}

export interface ExactFileState {
  exists: boolean;
  content: string;
  mode: number;
}

export interface ExactDirectoryIdentity {
  path: string;
  dev: number;
  ino: number;
}

export function snapshotDirectoryIdentity(path: string): ExactDirectoryIdentity {
  const entry = lstatSync(path);
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new Error(`Created memory path must be a regular non-symlink directory: ${path}`);
  }
  return { path, dev: entry.dev, ino: entry.ino };
}

export function createTrackedDirectories(
  root: string,
  directory: string,
  created: ExactDirectoryIdentity[],
): void {
  const missing: string[] = [];
  let current = directory;
  while (current !== root && relative(root, current).split(sep)[0] !== '..') {
    if (existsSync(current)) break;
    missing.push(current);
    current = dirname(current);
  }
  for (const path of missing.reverse()) {
    try {
      mkdirSync(path);
      created.push(snapshotDirectoryIdentity(path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      assertSafePath(root, path);
      snapshotDirectoryIdentity(path);
    }
  }
}

export function cleanupTrackedDirectories(
  created: readonly ExactDirectoryIdentity[],
  subject: string,
): string[] {
  const errors: string[] = [];
  for (const expected of [...created].reverse()) {
    let entry: ReturnType<typeof lstatSync>;
    try {
      entry = lstatSync(expected.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      errors.push(
        `${expected.path}: ${subject} directory identity check failed; recovery path ${expected.path}: ${String(error)}`,
      );
      continue;
    }
    if (
      entry.isSymbolicLink() ||
      !entry.isDirectory() ||
      entry.dev !== expected.dev ||
      entry.ino !== expected.ino
    ) {
      errors.push(
        `${expected.path}: ${subject} directory was replaced; unknown replacement retained at recovery path ${expected.path}`,
      );
      continue;
    }
    try {
      rmdirSync(expected.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        errors.push(
          `${expected.path}: ${subject} directory cleanup failed; recovery path ${expected.path}: ${String(error)}`,
        );
      }
    }
  }
  return errors;
}

export function exactFileStateMatches(path: string, expected: ExactFileState): boolean {
  try {
    const entry = lstatSync(path);
    if (!expected.exists || entry.isSymbolicLink() || !entry.isFile()) return false;
    if ((entry.mode & 0o777) !== expected.mode) return false;
    const expectedBytes = Buffer.byteLength(expected.content);
    if (entry.size !== expectedBytes) return false;
    return (
      readBoundedRegularFile(path, {
        maxBytes: Math.max(1, expectedBytes),
        subject: 'Rollback candidate',
      }).content === expected.content
    );
  } catch (error) {
    return !expected.exists && (error as NodeJS.ErrnoException).code === 'ENOENT';
  }
}

export function assertExactFileState(
  path: string,
  expected: ExactFileState,
  subject: string,
): void {
  if (!exactFileStateMatches(path, expected)) {
    throw new Error(
      `${subject} conflict: target changed after snapshot; unknown content retained at recovery path ${path}`,
    );
  }
}

export function restoreExactFileState(
  root: string,
  path: string,
  before: ExactFileState,
  attempted: ExactFileState,
): string | undefined {
  if (exactFileStateMatches(path, before)) return undefined;
  if (!exactFileStateMatches(path, attempted)) {
    return `${path}: rollback skipped because the target no longer matches the attempted candidate bytes and mode; unknown content retained at recovery path ${path}`;
  }
  try {
    assertSafePath(root, path);
    if (before.exists) atomicWrite(path, before.content, before.mode);
    else rmSync(path, { force: true });
  } catch (error) {
    return `${path}: rollback restore failed; recovery path ${path}: ${String(error)}`;
  }
  if (!exactFileStateMatches(path, before)) {
    return `${path}: rollback restore was not verified against the original bytes and mode; unresolved recovery path ${path}`;
  }
  return undefined;
}

export function writeValidated(
  root: string,
  entries: Array<{ path: string; content: string }>,
  io: Io,
  { rootKind = 'auto' }: { rootKind?: MemoryRootKind } = {},
): void {
  for (const { path } of entries) assertSafePath(root, path);
  const snapshots = entries.map(({ path }) => ({
    path,
    exists: existsSync(path),
    content: existsSync(path) ? readMemoryDocument(path) : '',
    mode: existsSync(path) ? statSync(path).mode & 0o777 : 0o644,
  }));
  const attempted = new Map<string, ExactFileState>();
  const createdDirectories: ExactDirectoryIdentity[] = [];
  let operationError: unknown;
  let failed = false;
  try {
    for (const { path } of entries) {
      createTrackedDirectories(root, dirname(path), createdDirectories);
    }
    for (const [index, entry] of entries.entries()) {
      const candidate = { exists: true, content: entry.content, mode: snapshots[index].mode };
      assertExactFileState(entry.path, snapshots[index], 'Memory write');
      attempted.set(entry.path, candidate);
      atomicWrite(entry.path, candidate.content, candidate.mode);
    }
    validateMemoryRoot(root, io, { quietSuccess: true, rootKind });
  } catch (error) {
    failed = true;
    operationError = error;
  }
  if (!failed) return;
  const rollbackErrors: string[] = [];
  const restored = new Set<string>();
  for (const snapshot of snapshots.reverse()) {
    if (restored.has(snapshot.path)) continue;
    restored.add(snapshot.path);
    const candidate = attempted.get(snapshot.path);
    if (!candidate) continue;
    const rollbackError = restoreExactFileState(root, snapshot.path, snapshot, candidate);
    if (rollbackError) rollbackErrors.push(rollbackError);
  }
  rollbackErrors.push(...cleanupTrackedDirectories(createdDirectories, 'created memory'));
  if (rollbackErrors.length > 0) {
    throw new Error(
      `Memory write failed and rollback was incomplete: ${String(operationError)}; unresolved paths: ${rollbackErrors.join('; ')}`,
      { cause: operationError instanceof Error ? operationError : undefined },
    );
  }
  throw operationError;
}

export function validateUnchanged(
  root: string,
  io: Io,
  { rootKind = 'auto' }: { rootKind?: MemoryRootKind } = {},
): void {
  validateMemoryRoot(root, io, { quietSuccess: true, rootKind });
}

export function output(result: MemoryWriteResult, json: boolean, io: Io): MemoryWriteResult {
  io.log(json ? JSON.stringify(result) : `${result.action} ${result.kind}: ${result.path}`);
  return result;
}
