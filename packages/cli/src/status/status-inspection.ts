import { assertLifecyclePaths } from '../installation/lifecycle-plan.js';
import { withScopeLocks } from '../installation/operation-lock.js';
import {
  assertNonOverlappingAdapters,
  describeInstall,
  digestManagedOutput,
  hubOwners,
  readInstallRecord,
} from '../installation/records.js';
import type { ManagedContentFingerprint } from '../shared/content-fingerprint-types.js';
import { entryExists } from '../shared/safe-path.js';
import type {
  Adapter,
  AdapterStatus,
  AdapterStatusInspection,
  Hub,
  HubStatus,
  InstallRecord,
  ManagedScope,
  ManagedStatus,
} from '../shared/types.js';
import { effectiveContentFingerprint } from './effective-content-fingerprint.js';

function recordedOutputs(
  scope: ManagedScope,
  record: InstallRecord | null,
): Array<{ path: string; status: ManagedStatus }> {
  return (
    record?.outputs.map(({ path, checksum }) => ({
      path,
      status: !entryExists(path)
        ? 'missing'
        : digestManagedOutput(scope, path) === checksum
          ? 'managed'
          : 'modified',
    })) || []
  );
}

function inspectHub(hub: Hub): { record: InstallRecord | null; status: HubStatus } {
  assertLifecyclePaths(hub);
  const record = readInstallRecord(hub);
  if (record) assertLifecyclePaths(hub, [{ path: hub.record, record }]);
  const current = effectiveContentFingerprint(hub);
  const recorded = record?.contentFingerprint ?? null;
  const contentFingerprint: ManagedContentFingerprint = {
    version: 1,
    algorithm: 'sha256',
    state: recorded === null ? 'unrecorded' : recorded === current ? 'matched' : 'drifted',
    recorded,
    current,
  };
  return {
    record,
    status: {
      home: hub.home,
      installed: Boolean(record),
      record: hub.record,
      owners: hubOwners(record),
      packageVersion: record?.packageVersion || null,
      installedAt: record?.installedAt || null,
      contentFingerprint,
      outputs: recordedOutputs(hub, record),
    },
  };
}

function inspectAdapterStatus(adapter: Adapter): AdapterStatusInspection {
  assertLifecyclePaths(adapter);
  const record = readInstallRecord(adapter);
  if (record) assertLifecyclePaths(adapter, [{ path: adapter.record, record }]);
  const hub = inspectHub(adapter.hub);
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
      contentFingerprint: hub.status.contentFingerprint,
      hub: hub.status,
      outputs: [...(record ? hub.status.outputs : []), ...recordedOutputs(adapter, record)],
    },
  };
}

export function inspectStatusAll(adapters: Adapter[]): AdapterStatusInspection[] {
  assertNonOverlappingAdapters(adapters);
  const scopes: ManagedScope[] = [...adapters, ...(adapters[0] ? [adapters[0].hub] : [])];
  return withScopeLocks(scopes, () => adapters.map(inspectAdapterStatus), {
    createHomes: false,
  });
}

export function statusAll(adapters: Adapter[]): AdapterStatus[] {
  return inspectStatusAll(adapters).map(({ status }) => status);
}
