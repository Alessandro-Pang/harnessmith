import { existsSync } from 'node:fs';
import { effectiveContentFingerprint } from './effective-content-fingerprint.js';
import { assertLifecyclePaths } from './lifecycle-plan.js';
import { withAdapterLocks } from './operation-lock.js';
import {
  assertNonOverlappingAdapters,
  describeInstall,
  digestManagedOutput,
  readInstallRecord,
} from './records.js';
import type { Adapter, AdapterStatus, AdapterStatusInspection } from './types.js';

function inspectAdapterStatus(adapter: Adapter): AdapterStatusInspection {
  assertLifecyclePaths(adapter);
  const record = readInstallRecord(adapter);
  const currentFingerprint = effectiveContentFingerprint(adapter);
  const recordedFingerprint = record?.contentFingerprint ?? null;
  if (record) assertLifecyclePaths(adapter, [{ path: adapter.record, record }]);
  return {
    adapter,
    record,
    plan: describeInstall(adapter),
    status: {
      adapter: adapter.name,
      installed: Boolean(record),
      record: adapter.record,
      capabilities: adapter.capabilities,
      packageVersion: record?.packageVersion || null,
      installedAt: record?.installedAt || null,
      contentFingerprint: {
        version: 1,
        algorithm: 'sha256',
        state:
          recordedFingerprint === null
            ? 'unrecorded'
            : recordedFingerprint === currentFingerprint
              ? 'matched'
              : 'drifted',
        recorded: recordedFingerprint,
        current: currentFingerprint,
      },
      outputs:
        record?.outputs.map(({ path, checksum }) => ({
          path,
          status: !existsSync(path)
            ? 'missing'
            : digestManagedOutput(adapter, path) === checksum
              ? 'managed'
              : 'modified',
        })) || [],
    },
  };
}

export function inspectStatusAll(adapters: Adapter[]): AdapterStatusInspection[] {
  assertNonOverlappingAdapters(adapters);
  return withAdapterLocks(adapters, () => adapters.map(inspectAdapterStatus), {
    createHomes: false,
  });
}

export function statusAll(adapters: Adapter[]): AdapterStatus[] {
  return inspectStatusAll(adapters).map(({ status }) => status);
}
