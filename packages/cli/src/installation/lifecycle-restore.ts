import { mkdirSync, mkdtempSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { removeExact, replaceManagedBlock } from '../shared/files.js';
import {
  assertSafeOutputPath,
  assertSafePath,
  entryExists,
  ignoreRoot,
  outputRoot,
  pruneEmptyDirectories,
} from '../shared/safe-path.js';
import type {
  InstallOptions,
  InstallRecord,
  ManagedScope,
  MigratedOutput,
} from '../shared/types.js';
import { errorMessage, HarnessmithError } from '../shared/types.js';
import {
  assertLifecyclePaths,
  assertRestorable,
  migratedOutputs,
  migrationRoot,
} from './lifecycle-plan.js';
import type { LifecycleTransactionContext } from './lifecycle-transaction.js';
import {
  managedBlockMarker,
  outputSpec,
  readInstallRecord,
  restoreSnapshots,
  snapshotFiles,
} from './records.js';

interface RestoreState {
  stageRoot: string;
  stagedRecord: string;
  moved: Array<{ path: string; staged: string }>;
  restored: InstallRecord['outputs'];
  migratedRestored: MigratedOutput[];
  ignoreSnapshots: ReturnType<typeof snapshotFiles>;
  recordMoved: boolean;
  previousRecordRestored: boolean;
  ignoreChanged: number;
}

function rollbackRestore(scope: ManagedScope, record: InstallRecord, state: RestoreState): void {
  for (let index = 0; index < state.ignoreChanged; index += 1) {
    const ignore = scope.localIgnoreFiles?.[index];
    const snapshot = state.ignoreSnapshots[index];
    if (!ignore || !snapshot) continue;
    assertSafePath(ignoreRoot(scope, ignore), snapshot.path);
    restoreSnapshots([snapshot]);
  }
  const recordBackup = record.recordBackup;
  if (state.previousRecordRestored && recordBackup && entryExists(scope.record)) {
    assertSafePath(scope.home, scope.record);
    assertSafePath(scope.home, recordBackup);
    renameSync(scope.record, recordBackup);
  }
  if (state.recordMoved && entryExists(state.stagedRecord)) {
    assertSafePath(scope.home, scope.record);
    renameSync(state.stagedRecord, scope.record);
  }
  for (const migrated of [...state.migratedRestored].reverse()) {
    if (!entryExists(migrated.path)) continue;
    assertSafePath(migrationRoot(scope), migrated.path);
    assertSafePath(migrationRoot(scope), migrated.backup);
    renameSync(migrated.path, migrated.backup);
  }
  for (const output of [...state.restored].reverse()) {
    if (!output.backup || !entryExists(output.path)) continue;
    const spec = outputSpec(scope, output.path);
    assertSafeOutputPath(scope, spec, output.path);
    assertSafeOutputPath(scope, spec, output.backup);
    renameSync(output.path, output.backup);
  }
  for (const item of [...state.moved].reverse()) {
    if (!entryExists(item.staged)) continue;
    assertSafeOutputPath(scope, outputSpec(scope, item.path), item.path);
    mkdirSync(dirname(item.path), { recursive: true });
    renameSync(item.staged, item.path);
  }
  assertSafePath(scope.home, state.stageRoot);
  removeExact(state.stageRoot);
}

function unwindOutputs(scope: ManagedScope, record: InstallRecord, state: RestoreState): void {
  for (const [index, output] of [...record.outputs].reverse().entries()) {
    const spec = outputSpec(scope, output.path);
    assertSafeOutputPath(scope, spec, output.path);
    if (entryExists(output.path)) {
      const staged = join(state.stageRoot, 'outputs', String(index));
      mkdirSync(dirname(staged), { recursive: true });
      renameSync(output.path, staged);
      state.moved.push({ path: output.path, staged });
    }
    if (output.backup) {
      assertSafeOutputPath(scope, spec, output.backup);
      mkdirSync(dirname(output.path), { recursive: true });
      renameSync(output.backup, output.path);
      state.restored.push(output);
    }
  }
  // Put retired pre-hub paths back where the previous record expects them.
  for (const migrated of migratedOutputs(record)) {
    assertSafePath(migrationRoot(scope), migrated.backup);
    assertSafePath(migrationRoot(scope), migrated.path);
    mkdirSync(dirname(migrated.path), { recursive: true });
    renameSync(migrated.backup, migrated.path);
    state.migratedRestored.push(migrated);
  }
}

/**
 * After the last layer is gone, drop the directories Harnessmith created for its own
 * outputs (`skills/`, `.harnessmith/`) when nothing else lives in them.
 */
function pruneEmptyParents(scope: ManagedScope, record: InstallRecord): void {
  pruneEmptyDirectories([
    ...record.outputs
      .filter(({ backup }) => !backup)
      .map(({ path }) => ({
        path: dirname(path),
        root: outputRoot(scope, outputSpec(scope, path)),
      })),
    { path: dirname(scope.record), root: scope.home },
  ]);
}

/** Pop the top record layer of one scope: outputs revert to their backups, then the record. */
export function restoreOnce(
  scope: ManagedScope,
  transaction: LifecycleTransactionContext,
  { force = false }: Pick<InstallOptions, 'force'> = {},
): InstallRecord {
  assertLifecyclePaths(scope);
  const record = readInstallRecord(scope);
  if (!record)
    throw new HarnessmithError(
      'STATE_CONFLICT',
      `No Harnessmith installation found for ${scope.label}: ${scope.record}`,
      5,
    );
  assertRestorable(scope, record, force);
  assertLifecyclePaths(scope, [{ path: scope.record, record }]);
  const stageRoot = mkdtempSync(join(scope.home, '.harnessmith-restore-'));
  assertSafePath(scope.home, stageRoot);
  const releaseStage = transaction.registerRecoveryPath(scope.home, stageRoot);
  const state: RestoreState = {
    stageRoot,
    stagedRecord: join(stageRoot, 'install.json'),
    moved: [],
    restored: [],
    migratedRestored: [],
    ignoreSnapshots: snapshotFiles(scope.localIgnoreFiles || []),
    recordMoved: false,
    previousRecordRestored: false,
    ignoreChanged: 0,
  };
  try {
    unwindOutputs(scope, record, state);
    assertSafePath(scope.home, scope.record);
    renameSync(scope.record, state.stagedRecord);
    state.recordMoved = true;
    if (record.recordBackup) {
      assertSafePath(scope.home, record.recordBackup);
      renameSync(record.recordBackup, scope.record);
      state.previousRecordRestored = true;
    } else {
      for (const ignore of scope.localIgnoreFiles || []) {
        assertSafePath(ignoreRoot(scope, ignore), ignore.path);
        replaceManagedBlock(ignore.path, managedBlockMarker, [], ignore);
        state.ignoreChanged += 1;
      }
    }
    removeExact(stageRoot);
    releaseStage();
    if (!record.recordBackup) pruneEmptyParents(scope, record);
    return record;
  } catch (error) {
    try {
      rollbackRestore(scope, record, state);
      releaseStage();
    } catch (rollbackError) {
      throw new Error(
        `Could not restore ${scope.label}: ${errorMessage(error)}; rollback was incomplete: ${errorMessage(rollbackError)}`,
        { cause: error instanceof Error ? error : undefined },
      );
    }
    if (error instanceof HarnessmithError) {
      throw new HarnessmithError(
        error.code,
        `Could not restore ${scope.label}: ${error.message}`,
        error.exitCode,
        { cause: error },
      );
    }
    throw new Error(`Could not restore ${scope.label}: ${errorMessage(error)}`);
  }
}
