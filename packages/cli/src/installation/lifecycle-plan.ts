import { digestPath } from '../shared/files.js';
import type {
  LifecycleChange,
  LifecycleCommand,
  LifecyclePlan,
} from '../shared/lifecycle-types.js';
import { assertSafePath, entryExists, ignoreRoot, outputRoot } from '../shared/safe-path.js';
import type { Adapter, InstallRecord, RecordOutput } from '../shared/types.js';
import { HarnessmithError } from '../shared/types.js';
import { outputSpec, readInstallRecord, readInstallRecordAt } from './records.js';

/**
 * Strict path gate for one adapter and, when known, its current record. Managed outputs
 * are regular files: any symlink segment (including a symlink leaf at a destination)
 * fails closed before a lifecycle operation reads or writes anything.
 */
export function assertLifecyclePaths(scope: Adapter, record?: InstallRecord | null): void {
  for (const output of scope.outputs) {
    assertSafePath(outputRoot(scope, output), output.path);
  }
  assertSafePath(scope.home, scope.record);
  for (const ignore of scope.localIgnoreFiles || []) {
    assertSafePath(ignoreRoot(scope, ignore), ignore.path);
  }
  if (!record) return;
  if (record.recordBackup) assertSafePath(scope.home, record.recordBackup);
  for (const output of record.outputs) {
    const root = outputRoot(scope, outputSpec(scope, output.path));
    assertSafePath(root, output.path);
    if (output.backup) assertSafePath(root, output.backup);
  }
}

/** The current installation record of an adapter. */
export function currentRecord(scope: Adapter): InstallRecord {
  const record = readInstallRecord(scope);
  if (!record) {
    throw new HarnessmithError(
      'STATE_CONFLICT',
      `No Harnessmith installation found for ${scope.label}: ${scope.record}`,
      5,
    );
  }
  return record;
}

/**
 * Fail-closed preflight shared by restore and uninstall. `--force` only overrides
 * modified managed content; missing backups always block. Restore additionally
 * requires the recorded `recordBackup` to exist because it becomes the active record;
 * uninstall only deletes that file, so its absence is not an integrity problem.
 */
export function assertUnwindable(
  record: InstallRecord,
  force: boolean,
  command: LifecycleCommand,
): void {
  const modified = record.outputs.filter(
    ({ path, checksum }) => entryExists(path) && digestPath(path) !== checksum,
  );
  if (modified.length > 0 && !force) {
    throw new HarnessmithError(
      'SAFETY_CONFLICT',
      `Managed files were modified; use --force to ${command} anyway:\n${modified.map(({ path }) => `  ${path}`).join('\n')}`,
      3,
    );
  }
  const missingBackups = record.outputs
    .filter(({ backup }) => backup && !entryExists(backup))
    .map(({ backup }) => backup as string);
  if (command === 'restore' && record.recordBackup && !entryExists(record.recordBackup)) {
    missingBackups.push(record.recordBackup);
  }
  if (missingBackups.length > 0) {
    throw new HarnessmithError(
      'INTEGRITY_ERROR',
      `Cannot ${command} because backup files are missing:\n${missingBackups.map((path) => `  ${path}`).join('\n')}`,
      3,
    );
  }
}

/**
 * Read and strictly validate the direct recordBackup before restore changes anything.
 * The existing schema-3 reader rejects damaged, old-schema, or foreign backups; only
 * this one previous layer is ever read, never a chain.
 */
export function previousRecord(scope: Adapter, record: InstallRecord): InstallRecord | null {
  if (!record.recordBackup) return null;
  const previous = readInstallRecordAt(scope, record.recordBackup);
  if (!previous) {
    throw new HarnessmithError(
      'INTEGRITY_ERROR',
      `Cannot restore because the record backup is missing: ${record.recordBackup}`,
      3,
    );
  }
  return previous;
}

/**
 * A managed output without its own backup survives restore only when the direct previous
 * record still owns the exact current content; modified or missing content is not kept.
 */
export function retainedByPreviousRecord(
  output: RecordOutput,
  previous: InstallRecord | null,
): boolean {
  if (output.backup || !previous) return false;
  const inherited = previous.outputs.find(({ path }) => path === output.path);
  return Boolean(
    inherited && entryExists(output.path) && digestPath(output.path) === inherited.checksum,
  );
}

/** Preview one Adapter's current record using reads and digests only. */
export function describeLifecycle(
  command: LifecycleCommand,
  adapter: Adapter,
  force = false,
): LifecyclePlan {
  const record = currentRecord(adapter);
  assertLifecyclePaths(adapter, record);
  assertUnwindable(record, force, command);
  const previous = command === 'restore' ? previousRecord(adapter, record) : null;
  const changes: LifecycleChange[] = record.outputs.map((output) => {
    if (output.backup) {
      return { path: output.path, action: 'restore-backup', source: output.backup };
    }
    if (retainedByPreviousRecord(output, previous)) return { path: output.path, action: 'keep' };
    return { path: output.path, action: 'remove' };
  });
  const restoresRecord = command === 'restore' && Boolean(record.recordBackup);
  changes.push(
    restoresRecord
      ? { path: adapter.record, action: 'restore-backup', source: record.recordBackup as string }
      : { path: adapter.record, action: 'remove' },
  );
  if (command === 'uninstall' && record.recordBackup) {
    changes.push({ path: record.recordBackup, action: 'remove' });
  }
  if (!restoresRecord) {
    changes.push(
      ...(adapter.localIgnoreFiles || []).map(({ path }) => ({
        path,
        action: 'remove-managed-block' as const,
      })),
    );
  }
  return { command, adapter: adapter.name, force, home: adapter.home, changes };
}
