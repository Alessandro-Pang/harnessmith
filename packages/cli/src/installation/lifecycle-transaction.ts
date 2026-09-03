import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { removeExact } from '../shared/files.js';
import { assertSafePath, ignoreRoot } from '../shared/safe-path.js';
import type { Adapter } from '../shared/types.js';
import { errorMessage } from '../shared/types.js';
import {
  createTemporaryWorkspace,
  disposeTemporaryWorkspace,
  type TemporaryWorkspace,
} from '../temporary-resources/temporary-resource.js';
import type { RecordLayer } from './lifecycle-plan.js';

interface PathSnapshot {
  root: string;
  path: string;
  copy: string | null;
}

interface MutablePath {
  root: string;
  path: string;
}

export interface LifecycleTransactionContext {
  registerRecoveryPath(root: string, path: string): () => void;
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

export function mutableLifecyclePaths(adapter: Adapter, layers: RecordLayer[]): MutablePath[] {
  const paths = new Map<string, MutablePath>();
  const add = (root: string, path: string): void => {
    paths.set(path, { root, path });
  };
  add(adapter.home, adapter.record);
  for (const ignore of adapter.localIgnoreFiles || [])
    add(ignoreRoot(adapter, ignore), ignore.path);
  for (const layer of layers) {
    add(adapter.home, layer.path);
    if (layer.record.recordBackup) add(adapter.home, layer.record.recordBackup);
    for (const output of layer.record.outputs) {
      add(adapter.home, output.path);
      if (output.backup) add(adapter.home, output.backup);
    }
  }
  return [...paths.values()];
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
      if (!existsSync(path)) {
        snapshots.push({ root: authorizedRoot, path, copy: null });
        continue;
      }
      const copy = join(root, String(index));
      cpSync(path, copy, { recursive: true, dereference: false, preserveTimestamps: true });
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
    cpSync(snapshot.copy, snapshot.path, {
      recursive: true,
      dereference: false,
      preserveTimestamps: true,
    });
  }
}

function recoveryContext(
  paths: MutablePath[],
  registered: Map<string, MutablePath>,
): LifecycleTransactionContext {
  const authorizedRoots = new Set(paths.map(({ root }) => resolve(root)));
  return {
    registerRecoveryPath(root: string, path: string): () => void {
      const authorizedRoot = resolve(root);
      const recoveryPath = resolve(path);
      if (!authorizedRoots.has(authorizedRoot)) {
        throw new Error(`Recovery path root is not part of the lifecycle transaction: ${root}`);
      }
      assertSafePath(authorizedRoot, recoveryPath);
      registered.set(recoveryPath, { root: authorizedRoot, path: recoveryPath });
      return () => {
        registered.delete(recoveryPath);
      };
    },
  };
}

function cleanupRecoveryPaths(registered: Map<string, MutablePath>): string[] {
  const failures: string[] = [];
  for (const [key, recovery] of registered) {
    try {
      assertSafePath(recovery.root, recovery.path);
      removeExact(recovery.path);
      registered.delete(key);
    } catch (error) {
      failures.push(`${recovery.path}: ${errorMessage(error)}`);
    }
  }
  return failures;
}

function retainedPaths(transactionRoot: string, registered: Map<string, MutablePath>): string[] {
  return [transactionRoot, ...registered.keys()];
}

export function lifecycleTransaction<T>(
  paths: MutablePath[],
  operation: (context: LifecycleTransactionContext) => T,
): T {
  const transaction = snapshotPaths(paths);
  const registered = new Map<string, MutablePath>();
  const context = recoveryContext(paths, registered);
  let result: T;
  try {
    result = operation(context);
  } catch (error) {
    try {
      restorePathSnapshots(transaction.snapshots);
    } catch (rollbackError) {
      throw new LifecycleRecoveryError(
        `Lifecycle operation failed and rollback was incomplete: ${errorMessage(error)}; rollback: ${errorMessage(rollbackError)}`,
        retainedPaths(transaction.root, registered),
        error,
      );
    }
    const cleanupFailures = cleanupRecoveryPaths(registered);
    if (cleanupFailures.length > 0) {
      throw new LifecycleRecoveryError(
        `Lifecycle operation failed; rollback completed but recovery cleanup was incomplete: ${errorMessage(error)}; cleanup: ${cleanupFailures.join('; ')}`,
        retainedPaths(transaction.root, registered),
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
  const cleanupFailures = cleanupRecoveryPaths(registered);
  if (cleanupFailures.length > 0) {
    throw new LifecycleRecoveryError(
      `Lifecycle operation completed but recovery cleanup was incomplete: ${cleanupFailures.join('; ')}`,
      retainedPaths(transaction.root, registered),
    );
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
