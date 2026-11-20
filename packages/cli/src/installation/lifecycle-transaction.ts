import { chmodSync, copyFileSync, lstatSync, mkdirSync, utimesSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { removeExact } from '../shared/files.js';
import { assertSafePath, entryExists, ignoreRoot, outputRoot } from '../shared/safe-path.js';
import type { Adapter, InstallRecord } from '../shared/types.js';
import { errorMessage } from '../shared/types.js';
import {
  createTemporaryWorkspace,
  disposeTemporaryWorkspace,
  type TemporaryWorkspace,
} from '../temporary-resources/temporary-resource.js';

interface PathSnapshot {
  root: string;
  path: string;
  copy: string | null;
}

interface MutablePath {
  root: string;
  path: string;
}

export class LifecycleRecoveryError extends Error {
  readonly recoveryPaths: string[];

  constructor(message: string, recoveryPaths: string[], cause?: unknown) {
    const paths = [...new Set(recoveryPaths.map((path) => resolve(path)))];
    super(
      `${message}\nRecovery data retained at:\n${paths.map((path) => `  ${path}`).join('\n')}`,
      {
        cause,
      },
    );
    this.name = 'LifecycleRecoveryError';
    this.recoveryPaths = paths;
  }
}

/** Every path one single-layer restore/uninstall may mutate, for exact snapshot rollback. */
export function mutableLifecyclePaths(scope: Adapter, record: InstallRecord): MutablePath[] {
  const paths = new Map<string, MutablePath>();
  const add = (root: string, path: string): void => {
    paths.set(path, { root, path });
  };
  add(scope.home, scope.record);
  for (const ignore of scope.localIgnoreFiles || []) add(ignoreRoot(scope, ignore), ignore.path);
  if (record.recordBackup) add(scope.home, record.recordBackup);
  for (const output of record.outputs) {
    const contract = scope.outputs.find((item) => item.path === output.path);
    const root = outputRoot(scope, contract ?? {});
    add(root, output.path);
    if (output.backup) add(root, output.backup);
  }
  return [...paths.values()];
}

/** Regular files only: lifecycle snapshots never copy directory trees or symlinks. */
function copyExact(source: string, destination: string): void {
  const stat = lstatSync(source);
  if (!stat.isFile()) throw new Error(`Unsupported lifecycle snapshot entry: ${source}`);
  copyFileSync(source, destination);
  chmodSync(destination, stat.mode);
  utimesSync(destination, stat.atime, stat.mtime);
}

function snapshotPaths(paths: MutablePath[]): {
  root: string;
  workspace: TemporaryWorkspace;
  snapshots: PathSnapshot[];
} {
  const workspace = createTemporaryWorkspace({
    owner: 'installer',
    purpose: 'lifecycle',
    lifecycle: 'retained-for-recovery',
  });
  const root = workspace.path;
  const snapshots: PathSnapshot[] = [];
  try {
    for (const [index, { root: authorizedRoot, path }] of paths.entries()) {
      assertSafePath(authorizedRoot, path);
      if (!entryExists(path)) {
        snapshots.push({ root: authorizedRoot, path, copy: null });
        continue;
      }
      const copy = join(root, String(index));
      copyExact(path, copy);
      snapshots.push({ root: authorizedRoot, path, copy });
    }
    return { root, workspace, snapshots };
  } catch (error) {
    try {
      disposeTemporaryWorkspace(workspace);
    } catch (cleanupError) {
      throw new LifecycleRecoveryError(
        `Lifecycle snapshot creation failed and cleanup was incomplete: ${errorMessage(error)}; cleanup: ${errorMessage(cleanupError)}`,
        [root],
        error,
      );
    }
    throw error;
  }
}

function restorePathSnapshots(snapshots: PathSnapshot[]): void {
  for (const snapshot of snapshots) {
    assertSafePath(snapshot.root, snapshot.path);
    removeExact(snapshot.path);
    if (!snapshot.copy) continue;
    mkdirSync(dirname(snapshot.path), { recursive: true });
    assertSafePath(snapshot.root, snapshot.path);
    copyExact(snapshot.copy, snapshot.path);
  }
}

/**
 * The single lifecycle transaction owner: snapshot every mutable path as exact regular
 * file copies, run the operation, and on any failure restore the precise snapshots.
 * When rollback or cleanup cannot complete, the retained snapshot root is reported as
 * the recovery path instead of claiming an infallible atomic transaction.
 */
export function lifecycleTransaction<T>(paths: MutablePath[], operation: () => T): T {
  const transaction = snapshotPaths(paths);
  let result: T;
  try {
    result = operation();
  } catch (error) {
    try {
      restorePathSnapshots(transaction.snapshots);
    } catch (rollbackError) {
      throw new LifecycleRecoveryError(
        `Lifecycle operation failed and rollback was incomplete: ${errorMessage(error)}; rollback: ${errorMessage(rollbackError)}`,
        [transaction.root],
        error,
      );
    }
    try {
      disposeTemporaryWorkspace(transaction.workspace);
    } catch (cleanupError) {
      throw new LifecycleRecoveryError(
        `Lifecycle operation failed; rollback completed but transaction cleanup was incomplete: ${errorMessage(error)}; cleanup: ${errorMessage(cleanupError)}`,
        [transaction.root],
        error,
      );
    }
    throw error;
  }
  try {
    disposeTemporaryWorkspace(transaction.workspace);
  } catch (cleanupError) {
    throw new LifecycleRecoveryError(
      `Lifecycle operation completed but transaction cleanup was incomplete: ${errorMessage(cleanupError)}`,
      [transaction.root],
      cleanupError,
    );
  }
  return result;
}
