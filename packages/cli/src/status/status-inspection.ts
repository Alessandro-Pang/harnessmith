import { assertLifecyclePaths } from '../installation/lifecycle-plan.js';
import { assertNonOverlappingAdapters, readInstallRecord } from '../installation/records.js';
import { digestPath } from '../shared/files.js';
import { entryExists } from '../shared/safe-path.js';
import type {
  Adapter,
  AdapterStatus,
  AdapterStatusInspection,
  InstallRecord,
  ManagedStatus,
} from '../shared/types.js';

function recordedOutputs(
  record: InstallRecord | null,
): Array<{ path: string; status: ManagedStatus }> {
  return (
    record?.outputs.map(({ path, checksum }) => ({
      path,
      status: !entryExists(path)
        ? 'missing'
        : digestPath(path) === checksum
          ? 'managed'
          : 'modified',
    })) || []
  );
}

/**
 * Read-only inspection of the current adapter record and its output digests. No install
 * plan is constructed, no fingerprint is computed, and no user data is read or locked.
 */
function inspectAdapterStatus(adapter: Adapter): AdapterStatusInspection {
  assertLifecyclePaths(adapter);
  const record = readInstallRecord(adapter);
  if (record) assertLifecyclePaths(adapter, record);
  return {
    adapter,
    record,
    status: {
      adapter: adapter.name,
      installed: Boolean(record),
      record: adapter.record,
      capabilities: adapter.capabilities,
      packageVersion: record?.packageVersion || null,
      installedAt: record?.installedAt || null,
      outputs: recordedOutputs(record),
    },
  };
}

export function inspectStatusAll(adapters: Adapter[]): AdapterStatusInspection[] {
  assertNonOverlappingAdapters(adapters);
  return adapters.map(inspectAdapterStatus);
}

export function statusAll(adapters: Adapter[]): AdapterStatus[] {
  return inspectStatusAll(adapters).map(({ status }) => status);
}
