import type { LifecycleCommand } from '../shared/lifecycle-types.js';
import type { Adapter, InstallOptions } from '../shared/types.js';
import {
  assertLifecyclePaths,
  assertUnwindable,
  currentRecord,
  previousRecord,
} from './lifecycle-plan.js';
import { restoreOnce, uninstallOnce } from './lifecycle-restore.js';
import { lifecycleTransaction, mutableLifecyclePaths } from './lifecycle-transaction.js';
import { type ScopeLockContext, withScopeLocks } from './operation-lock.js';
import { assertNonOverlappingAdapters } from './records.js';

/** Preflight every adapter before any mutation so a rejection never strands a partial unwind. */
function preflight(adapters: Adapter[], force: boolean, command: LifecycleCommand) {
  return adapters.map((adapter) => {
    const record = currentRecord(adapter);
    assertLifecyclePaths(adapter, record);
    assertUnwindable(record, force, command);
    // Restore reactivates the direct recordBackup: validate it before any adapter mutates.
    if (command === 'restore') previousRecord(adapter, record);
    return { adapter, record };
  });
}

/**
 * Restore the single current layer of every adapter: outputs revert to their backups
 * (identical managed content owned by the direct previous record is kept), and each
 * record reverts to its validated recordBackup (or is removed). User data is never touched.
 */
export function restoreAll(adapters: Adapter[], options: Pick<InstallOptions, 'force'> = {}) {
  assertNonOverlappingAdapters(adapters);
  const force = options.force || false;
  return withScopeLocks(adapters, () => {
    const current = preflight(adapters, force, 'restore');
    return lifecycleTransaction(
      current.flatMap(({ adapter, record }) => mutableLifecyclePaths(adapter, record)),
      () =>
        current.map(({ adapter, record }) => ({
          adapter: adapter.name,
          restored: restoreOnce(adapter, record),
        })),
    );
  });
}

/**
 * Uninstall the single current installation of every adapter: original user files are
 * restored from backups, managed content without a backup is removed, and the record
 * plus its recordBackup file are deleted. No older layer is read or unwound.
 */
export function uninstallAll(
  adapters: Adapter[],
  options: Pick<InstallOptions, 'force'> = {},
  withLocks: ScopeLockContext = (operation) => withScopeLocks(adapters, operation),
) {
  assertNonOverlappingAdapters(adapters);
  const force = options.force || false;
  return withLocks(() => {
    const current = preflight(adapters, force, 'uninstall');
    return lifecycleTransaction(
      current.flatMap(({ adapter, record }) => mutableLifecyclePaths(adapter, record)),
      () =>
        current.map(({ adapter, record }) => ({
          adapter: adapter.name,
          uninstalled: uninstallOnce(adapter, record),
        })),
    );
  });
}
