import { lstatSync, rmSync } from 'node:fs';
import { dirname, relative, sep } from 'node:path';
import type { Io } from '../types.js';
import { atomicWrite } from './files.js';
import type { MemoryRootKind } from './memory-autopilot-document-rules.js';
import {
  isInside,
  type ManagedMemoryEntry,
  managedMemoryEntries,
  readMemoryDocument,
} from './memory-path.js';
import { validateMemoryRoot } from './memory-validation.js';
import {
  assertExactFileState,
  cleanupTrackedDirectories,
  createTrackedDirectories,
  type ExactDirectoryIdentity,
  type ExactFileState,
  exactFileStateMatches,
  restoreExactFileState,
} from './memory-write.js';

export interface MemoryFileSnapshot extends ExactFileState {
  path: string;
}

function portableIdentity(root: string, path: string): string {
  return relative(root, path).split(sep).join('/').normalize('NFC').toLowerCase();
}

function plannedArchiveEntries(root: string, destination: string): ManagedMemoryEntry[] {
  const entries: ManagedMemoryEntry[] = [{ path: destination, kind: 'file' }];
  let current = dirname(destination);
  while (current !== root && isInside(root, current)) {
    entries.push({ path: current, kind: 'directory' });
    current = dirname(current);
  }
  return entries.reverse();
}

export function assertPortableArchiveDestination(root: string, destination: string): void {
  const existing = new Map<string, ManagedMemoryEntry[]>();
  for (const entry of managedMemoryEntries(root)) {
    const identity = portableIdentity(root, entry.path);
    const matches = existing.get(identity);
    if (matches) matches.push(entry);
    else existing.set(identity, [entry]);
  }
  for (const planned of plannedArchiveEntries(root, destination)) {
    const identity = portableIdentity(root, planned.path);
    const collision = existing
      .get(identity)
      ?.find(
        (entry) =>
          entry.path !== planned.path || entry.kind !== planned.kind || planned.kind === 'file',
      );
    if (collision) {
      throw new Error(
        `Portable archive destination collision: ${collision.path} (${collision.kind}) and ${planned.path} (${planned.kind})`,
      );
    }
  }
}

export function snapshotMemoryFile(path: string): MemoryFileSnapshot {
  const content = readMemoryDocument(path);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Memory lifecycle source must be a regular non-symlink file: ${path}`);
  }
  return { path, exists: true, content, mode: stat.mode & 0o777 };
}

function throwAfterRollback(label: string, operationError: unknown, errors: string[]): never {
  if (errors.length > 0) {
    throw new Error(
      `${label} failed and rollback was incomplete: ${String(operationError)}; unresolved paths: ${errors.join('; ')}`,
      { cause: operationError instanceof Error ? operationError : undefined },
    );
  }
  throw operationError;
}

export function replaceMemoryAndValidate(
  root: string,
  snapshot: MemoryFileSnapshot,
  content: string,
  rootKind: MemoryRootKind,
  io: Io,
): void {
  const attempted = { exists: true, content, mode: snapshot.mode } as const;
  assertExactFileState(snapshot.path, snapshot, 'Memory supersede');
  try {
    atomicWrite(snapshot.path, content, snapshot.mode);
    validateMemoryRoot(root, io, { quietSuccess: true, rootKind });
  } catch (operationError) {
    const errors: string[] = [];
    const error = restoreExactFileState(root, snapshot.path, snapshot, attempted);
    if (error) errors.push(error);
    throwAfterRollback('Memory supersede', operationError, errors);
  }
}

export function archiveMemoryAndValidate(
  root: string,
  snapshot: MemoryFileSnapshot,
  destination: string,
  content: string,
  rootKind: MemoryRootKind,
  io: Io,
): void {
  const createdDirectories: ExactDirectoryIdentity[] = [];
  const missingDestination = { exists: false, content: '', mode: snapshot.mode } as const;
  const attemptedDestination = { exists: true, content, mode: snapshot.mode } as const;
  const removedSource = { exists: false, content: '', mode: snapshot.mode } as const;
  assertExactFileState(snapshot.path, snapshot, 'Memory archive source');
  assertExactFileState(destination, missingDestination, 'Memory archive destination');
  try {
    createTrackedDirectories(root, dirname(destination), createdDirectories);
    assertExactFileState(snapshot.path, snapshot, 'Memory archive source');
    assertExactFileState(destination, missingDestination, 'Memory archive destination');
    atomicWrite(destination, content, snapshot.mode);
    assertExactFileState(snapshot.path, snapshot, 'Memory archive source');
    rmSync(snapshot.path);
    validateMemoryRoot(root, io, { quietSuccess: true, rootKind });
  } catch (operationError) {
    const errors: string[] = [];
    const sourceError = restoreExactFileState(root, snapshot.path, snapshot, removedSource);
    if (sourceError) errors.push(sourceError);
    const sourceRecovered = exactFileStateMatches(snapshot.path, snapshot);
    let destinationCleared = false;
    if (!sourceRecovered) {
      const retained = exactFileStateMatches(destination, attemptedDestination);
      errors.push(
        `${snapshot.path}: source restoration was not verified; recovery path ${destination} is ${retained ? 'retained' : 'not a verified archive copy and must be inspected without overwriting it'}`,
      );
    } else {
      const destinationError = restoreExactFileState(
        root,
        destination,
        missingDestination,
        attemptedDestination,
      );
      if (destinationError) errors.push(destinationError);
      destinationCleared = exactFileStateMatches(destination, missingDestination);
    }
    if (sourceRecovered && destinationCleared) {
      errors.push(...cleanupTrackedDirectories(createdDirectories, 'created archive'));
    }
    throwAfterRollback('Memory archive', operationError, errors);
  }
}
