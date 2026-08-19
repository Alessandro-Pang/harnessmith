import { cpSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { removeExact } from './files.js';
import type { RecordLayer } from './lifecycle-plan.js';
import { assertSafePath, ignoreRoot } from './safe-path.js';
import type { Adapter } from './types.js';
import { errorMessage } from './types.js';

interface PathSnapshot {
  root: string;
  path: string;
  copy: string | null;
}

interface MutablePath {
  root: string;
  path: string;
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

function snapshotPaths(paths: MutablePath[]): { root: string; snapshots: PathSnapshot[] } {
  const root = mkdtempSync(join(tmpdir(), 'harnesssmith-lifecycle-'));
  const snapshots = paths.map(({ root: authorizedRoot, path }, index): PathSnapshot => {
    assertSafePath(authorizedRoot, path);
    if (!existsSync(path)) return { root: authorizedRoot, path, copy: null };
    const copy = join(root, String(index));
    cpSync(path, copy, { recursive: true, dereference: false, preserveTimestamps: true });
    return { root: authorizedRoot, path, copy };
  });
  return { root, snapshots };
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

export function lifecycleTransaction<T>(paths: MutablePath[], operation: () => T): T {
  const transaction = snapshotPaths(paths);
  try {
    const result = operation();
    removeExact(transaction.root);
    return result;
  } catch (error) {
    try {
      restorePathSnapshots(transaction.snapshots);
    } catch (rollbackError) {
      throw new Error(
        `Lifecycle operation failed and rollback was incomplete: ${errorMessage(error)}; rollback: ${errorMessage(rollbackError)}`,
      );
    } finally {
      removeExact(transaction.root);
    }
    throw error;
  }
}
