import { existsSync, mkdirSync, mkdtempSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { removeExact, replaceManagedBlock } from './files.js';
import {
  assertLifecyclePaths,
  assertRestorable,
  assertUninstallable,
  installationLayers,
} from './lifecycle-plan.js';
import {
  type LifecycleTransactionContext,
  lifecycleTransaction,
  mutableLifecyclePaths,
} from './lifecycle-transaction.js';
import { withAdapterLocks } from './operation-lock.js';
import {
  assertNonOverlappingAdapters,
  digestManagedOutput,
  managedBlockMarker,
  readInstallRecord,
  restoreSnapshots,
  snapshotFiles,
} from './records.js';
import { assertSafePath, ignoreRoot } from './safe-path.js';
import type { Adapter, AdapterStatus, InstallOptions, InstallRecord } from './types.js';
import { errorMessage, HarnessmithError } from './types.js';

interface RestoreState {
  stageRoot: string;
  stagedRecord: string;
  moved: Array<{ path: string; staged: string }>;
  restored: InstallRecord['outputs'];
  ignoreSnapshots: ReturnType<typeof snapshotFiles>;
  recordMoved: boolean;
  previousRecordRestored: boolean;
  ignoreChanged: number;
}

function rollbackRestore(adapter: Adapter, record: InstallRecord, state: RestoreState): void {
  for (let index = 0; index < state.ignoreChanged; index += 1) {
    const ignore = adapter.localIgnoreFiles?.[index];
    const snapshot = state.ignoreSnapshots[index];
    if (!ignore || !snapshot) continue;
    assertSafePath(ignoreRoot(adapter, ignore), snapshot.path);
    restoreSnapshots([snapshot]);
  }
  const recordBackup = record.recordBackup;
  if (state.previousRecordRestored && recordBackup && existsSync(adapter.record)) {
    assertSafePath(adapter.home, adapter.record);
    assertSafePath(adapter.home, recordBackup);
    renameSync(adapter.record, recordBackup);
  }
  if (state.recordMoved && existsSync(state.stagedRecord)) {
    assertSafePath(adapter.home, adapter.record);
    renameSync(state.stagedRecord, adapter.record);
  }
  for (const output of [...state.restored].reverse()) {
    if (!output.backup || !existsSync(output.path)) continue;
    assertSafePath(adapter.home, output.path);
    assertSafePath(adapter.home, output.backup);
    renameSync(output.path, output.backup);
  }
  for (const item of [...state.moved].reverse()) {
    if (!existsSync(item.staged)) continue;
    assertSafePath(adapter.home, item.path);
    renameSync(item.staged, item.path);
  }
  assertSafePath(adapter.home, state.stageRoot);
  removeExact(state.stageRoot);
}

function restoreOnce(
  adapter: Adapter,
  transaction: LifecycleTransactionContext,
  { force = false }: Pick<InstallOptions, 'force'> = {},
): InstallRecord {
  assertLifecyclePaths(adapter);
  const record = readInstallRecord(adapter);
  if (!record)
    throw new HarnessmithError(
      'STATE_CONFLICT',
      `No Harnesssmith installation found for ${adapter.label}: ${adapter.record}`,
      5,
    );
  assertRestorable(adapter, record, force);
  assertLifecyclePaths(adapter, [{ path: adapter.record, record }]);
  const ignoreSnapshots = snapshotFiles(adapter.localIgnoreFiles || []);
  const stageRoot = mkdtempSync(join(adapter.home, '.harnessmith-restore-'));
  assertSafePath(adapter.home, stageRoot);
  const releaseStage = transaction.registerRecoveryPath(adapter.home, stageRoot);
  const state: RestoreState = {
    stageRoot,
    stagedRecord: join(stageRoot, 'install.json'),
    moved: [],
    restored: [],
    ignoreSnapshots,
    recordMoved: false,
    previousRecordRestored: false,
    ignoreChanged: 0,
  };
  try {
    for (const [index, output] of [...record.outputs].reverse().entries()) {
      assertSafePath(adapter.home, output.path);
      if (existsSync(output.path)) {
        const staged = join(stageRoot, 'outputs', String(index));
        mkdirSync(dirname(staged), { recursive: true });
        assertSafePath(adapter.home, output.path);
        renameSync(output.path, staged);
        state.moved.push({ path: output.path, staged });
      }
      if (output.backup) {
        assertSafePath(adapter.home, output.backup);
        mkdirSync(dirname(output.path), { recursive: true });
        assertSafePath(adapter.home, output.path);
        renameSync(output.backup, output.path);
        state.restored.push(output);
      }
    }
    assertSafePath(adapter.home, adapter.record);
    renameSync(adapter.record, state.stagedRecord);
    state.recordMoved = true;
    if (record.recordBackup) {
      const recordBackup = record.recordBackup;
      assertSafePath(adapter.home, recordBackup);
      assertSafePath(adapter.home, adapter.record);
      renameSync(recordBackup, adapter.record);
      state.previousRecordRestored = true;
    } else {
      for (const ignore of adapter.localIgnoreFiles || []) {
        assertSafePath(ignoreRoot(adapter, ignore), ignore.path);
        replaceManagedBlock(ignore.path, managedBlockMarker, [], ignore);
        state.ignoreChanged += 1;
      }
    }
    removeExact(stageRoot);
    releaseStage();
    return record;
  } catch (error) {
    try {
      rollbackRestore(adapter, record, state);
      releaseStage();
    } catch (rollbackError) {
      throw new Error(
        `Could not restore ${adapter.label}: ${errorMessage(error)}; rollback was incomplete: ${errorMessage(rollbackError)}`,
        { cause: error instanceof Error ? error : undefined },
      );
    }
    if (error instanceof HarnessmithError) {
      throw new HarnessmithError(
        error.code,
        `Could not restore ${adapter.label}: ${error.message}`,
        error.exitCode,
        { cause: error },
      );
    }
    throw new Error(`Could not restore ${adapter.label}: ${errorMessage(error)}`);
  }
}

export function statusAll(adapters: Adapter[]): AdapterStatus[] {
  assertNonOverlappingAdapters(adapters);
  return withAdapterLocks(
    adapters,
    () =>
      adapters.map((adapter) => {
        assertLifecyclePaths(adapter);
        const record = readInstallRecord(adapter);
        if (record) assertLifecyclePaths(adapter, [{ path: adapter.record, record }]);
        return {
          adapter: adapter.name,
          installed: Boolean(record),
          record: adapter.record,
          capabilities: adapter.capabilities,
          packageVersion: record?.packageVersion || null,
          installedAt: record?.installedAt || null,
          outputs:
            record?.outputs.map(({ path, checksum }) => ({
              path,
              status: !existsSync(path)
                ? 'missing'
                : digestManagedOutput(adapter, path) === checksum
                  ? 'managed'
                  : 'modified',
            })) || [],
        };
      }),
    { createHomes: false },
  );
}

export function restoreAll(adapters: Adapter[], options: Pick<InstallOptions, 'force'> = {}) {
  assertNonOverlappingAdapters(adapters);
  return withAdapterLocks(adapters, () => {
    const layers = adapters.map((adapter) => {
      const current = installationLayers(adapter)[0];
      if (!current)
        throw new HarnessmithError(
          'STATE_CONFLICT',
          `No Harnesssmith installation found for ${adapter.label}: ${adapter.record}`,
          5,
        );
      assertRestorable(adapter, current.record, options.force || false);
      return { adapter, layers: [current] };
    });
    return lifecycleTransaction(
      layers.flatMap(({ adapter, layers: records }) => mutableLifecyclePaths(adapter, records)),
      (transaction) =>
        layers.map(({ adapter }) => ({
          adapter: adapter.name,
          restored: restoreOnce(adapter, transaction, options),
        })),
    );
  });
}

export function uninstallAll(adapters: Adapter[], options: Pick<InstallOptions, 'force'> = {}) {
  assertNonOverlappingAdapters(adapters);
  return withAdapterLocks(adapters, () => {
    const plans = adapters.map((adapter) => {
      const layers = installationLayers(adapter);
      assertUninstallable(adapter, layers, options.force || false);
      return { adapter, layers };
    });
    return lifecycleTransaction(
      plans.flatMap(({ adapter, layers }) => mutableLifecyclePaths(adapter, layers)),
      (transaction) =>
        plans.map(({ adapter }) => {
          let layers = 0;
          while (readInstallRecord(adapter)) {
            restoreOnce(adapter, transaction, options);
            layers += 1;
          }
          return { adapter: adapter.name, layers };
        }),
    );
  });
}
