import { mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { removeExact, replaceManagedBlock } from '../shared/files.js';
import {
  assertSafePath,
  entryExists,
  ignoreRoot,
  outputRoot,
  pruneEmptyDirectories,
} from '../shared/safe-path.js';
import type { Adapter, InstallRecord } from '../shared/types.js';
import {
  assertLifecyclePaths,
  previousRecord,
  retainedByPreviousRecord,
} from './lifecycle-plan.js';
import { managedBlockMarker, outputSpec } from './records.js';

function rootFor(scope: Adapter, path: string): string {
  return outputRoot(scope, outputSpec(scope, path));
}

/**
 * Revert the current layer's outputs: content with a backup gets the original user file
 * back; content without a backup is removed only because the current record owns it,
 * unless the direct previous record still owns the exact same content (identical repeated
 * installs keep no output backup). Path checks run again immediately before each mutation.
 */
function unwindOutputs(
  scope: Adapter,
  record: InstallRecord,
  previous: InstallRecord | null,
): void {
  for (const output of [...record.outputs].reverse()) {
    const root = rootFor(scope, output.path);
    assertSafePath(root, output.path);
    if (!retainedByPreviousRecord(output, previous) && entryExists(output.path)) {
      removeExact(output.path);
    }
    if (output.backup) {
      assertSafePath(root, output.backup);
      mkdirSync(dirname(output.path), { recursive: true });
      renameSync(output.backup, output.path);
    }
  }
}

function removeIgnoreBlocks(scope: Adapter): void {
  for (const ignore of scope.localIgnoreFiles || []) {
    assertSafePath(ignoreRoot(scope, ignore), ignore.path);
    replaceManagedBlock(ignore.path, managedBlockMarker, [], ignore);
  }
}

/** Drop directories Harnessmith created for its own outputs once nothing else lives in them. */
function pruneEmptyParents(scope: Adapter, record: InstallRecord): void {
  pruneEmptyDirectories([
    ...record.outputs
      .filter(({ backup }) => !backup)
      .map(({ path }) => ({ path: dirname(path), root: rootFor(scope, path) })),
    { path: dirname(scope.record), root: scope.home },
  ]);
}

/**
 * Basic single-layer restore mutation: the direct recordBackup is read and strictly
 * validated before any output changes, outputs revert to their backups (or survive when
 * the previous record still owns identical content), then the recordBackup becomes the
 * active record; otherwise the record is removed and the managed ignore blocks are
 * dropped. Rollback is owned by lifecycleTransaction, so this function keeps no staging
 * or journal of its own.
 */
export function restoreOnce(scope: Adapter, record: InstallRecord): InstallRecord {
  assertLifecyclePaths(scope, record);
  const previous = previousRecord(scope, record);
  unwindOutputs(scope, record, previous);
  assertSafePath(scope.home, scope.record);
  removeExact(scope.record);
  if (record.recordBackup) {
    assertSafePath(scope.home, record.recordBackup);
    renameSync(record.recordBackup, scope.record);
  } else {
    removeIgnoreBlocks(scope);
    pruneEmptyParents(scope, record);
  }
  return record;
}

/**
 * Basic single-layer uninstall mutation: outputs revert to their backups, then the
 * record and its recordBackup file are removed without ever reading the older record.
 * No chain is unwound; user data is never touched.
 */
export function uninstallOnce(scope: Adapter, record: InstallRecord): InstallRecord {
  assertLifecyclePaths(scope, record);
  unwindOutputs(scope, record, null);
  assertSafePath(scope.home, scope.record);
  removeExact(scope.record);
  if (record.recordBackup) {
    assertSafePath(scope.home, record.recordBackup);
    removeExact(record.recordBackup);
  }
  removeIgnoreBlocks(scope);
  pruneEmptyParents(scope, record);
  return record;
}
