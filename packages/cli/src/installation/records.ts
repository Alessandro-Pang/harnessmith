import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, resolve, sep } from 'node:path';
import { atomicWrite, digestPath, readJson, removeExact } from '../shared/files.js';
import { assertSafeOutputPath, assertSafeScopePaths, entryExists } from '../shared/safe-path.js';
import type {
  Adapter,
  Hub,
  HubPlan,
  InstallPlan,
  InstallRecord,
  InstallTargetState,
  ManagedOutput,
  ManagedScope,
  OutputAction,
  PlannedOutput,
  Snapshot,
} from '../shared/types.js';
import { errorMessage, HarnessmithError } from '../shared/types.js';
import {
  legacyOutputs,
  plannedAdapterMigrations,
  plannedHubMigrations,
} from './layout-migration.js';
import { validateRecord } from './record-validation.js';

export const managedBlockMarker = 'harnessmith managed files';

export function isAdapter(scope: ManagedScope): scope is Adapter {
  return scope.scope === 'adapter';
}

export function isHub(scope: ManagedScope): scope is Hub {
  return scope.scope === 'hub';
}

/** Look up the contract entry for a recorded path (current layout first, then pre-hub). */
export function outputSpec(scope: ManagedScope, path: string): ManagedOutput {
  const found =
    scope.outputs.find((output) => output.path === path) ??
    (isAdapter(scope) ? legacyOutputs(scope).find((output) => output.path === path) : undefined);
  if (!found) {
    throw new HarnessmithError(
      'INTEGRITY_ERROR',
      `Managed output is outside the ${scope.label} contract: ${path}`,
      3,
    );
  }
  return found;
}

/** Pre-hub host copies kept their mutable `state/` inside the Harness directory. */
export function digestManagedOutput(
  scope: ManagedScope,
  path: string,
  managedPath = path,
): string | null {
  const legacyState = isAdapter(scope) && managedPath === scope.legacyHarness;
  return digestPath(path, {
    exclude: (relativePath) => legacyState && relativePath.split(sep)[0] === 'state',
  });
}

export function assertScopeContract(scope: ManagedScope): void {
  const home = resolve(scope.home);
  const inside = (root: string, path: string): boolean => {
    const target = resolve(path);
    return target === root || target.startsWith(`${root}${sep}`);
  };
  const paths = [
    ...scope.outputs.map((output) => ({
      root: resolve(output.root || scope.home),
      path: output.path,
    })),
    ...(isAdapter(scope)
      ? legacyOutputs(scope).map((output) => ({ root: home, path: output.path }))
      : []),
    { root: home, path: scope.record },
  ];
  for (const { root, path } of paths) {
    if (!inside(root, path)) throw new Error(`${scope.label} path escapes its root: ${path}`);
  }
  assertSafeScopePaths(scope);
}

export function readInstallRecordAt(scope: ManagedScope, recordPath: string): InstallRecord | null {
  assertScopeContract(scope);
  const resolvedRecordPath = resolve(recordPath);
  const validRecordPath =
    resolvedRecordPath === scope.record ||
    (dirname(resolvedRecordPath) === dirname(scope.record) &&
      basename(resolvedRecordPath).startsWith(`${basename(scope.record)}.backup-`));
  if (!validRecordPath)
    throw new HarnessmithError(
      'INTEGRITY_ERROR',
      `Installation record path escapes its contract: ${recordPath}`,
      3,
    );
  try {
    const record = readJson(resolvedRecordPath) as InstallRecord | null;
    if (!record) return null;
    validateRecord(scope, record);
    return record;
  } catch (error) {
    if (error instanceof HarnessmithError) throw error;
    throw new HarnessmithError(
      'INTEGRITY_ERROR',
      `Invalid installation record ${resolvedRecordPath}: ${errorMessage(error)}`,
      3,
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

export function readInstallRecord(scope: ManagedScope): InstallRecord | null {
  return readInstallRecordAt(scope, scope.record);
}

export function hubOwners(record: InstallRecord | null): string[] {
  return record?.owners ?? [];
}

export function assertNonOverlappingAdapters(adapters: Adapter[]): void {
  const ownership = adapters.flatMap((adapter) =>
    [...adapter.outputs.map(({ path }) => path), adapter.record].map((path) => ({
      adapter: adapter.name,
      path: resolve(path),
    })),
  );
  for (let index = 0; index < ownership.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < ownership.length; otherIndex += 1) {
      const left = ownership[index];
      const right = ownership[otherIndex];
      if (left.adapter === right.adapter) continue;
      const overlaps =
        left.path === right.path ||
        left.path.startsWith(`${right.path}${sep}`) ||
        right.path.startsWith(`${left.path}${sep}`);
      if (overlaps) {
        throw new HarnessmithError(
          'SAFETY_CONFLICT',
          `Agent destinations overlap: ${left.adapter} ${left.path} conflicts with ${right.adapter} ${right.path}`,
          3,
        );
      }
    }
  }
}

function outputState(
  scope: ManagedScope,
  output: ManagedOutput,
  record: InstallRecord | null,
): { action: OutputAction; state: InstallTargetState } {
  assertSafeOutputPath(scope, output, output.path);
  if (!entryExists(output.path)) return { action: 'create', state: 'missing' };
  const managed = record?.outputs.find((item) => item.path === output.path);
  if (managed && managed.checksum === digestManagedOutput(scope, output.path)) {
    return { action: 'replace-managed', state: 'managed' };
  }
  return { action: 'conflict', state: managed ? 'modified' : 'unmanaged' };
}

export function plannedOutputs(scope: ManagedScope, record: InstallRecord | null): PlannedOutput[] {
  return scope.outputs.map((output) => ({
    path: output.path,
    kind: output.kind,
    ...(output.target ? { target: output.target } : {}),
    ...outputState(scope, output, record),
  }));
}

export function describeHub(hub: Hub): HubPlan {
  const record = readInstallRecord(hub);
  return {
    home: hub.home,
    agentsHome: hub.agentsHome,
    record: hub.record,
    installed: Boolean(record),
    owners: hubOwners(record),
    state: hub.state,
    rules: hub.rules,
    memory: hub.memory,
    outputs: plannedOutputs(hub, record),
    migrations: plannedHubMigrations(hub).map(({ path, action }) => ({ path, action })),
  };
}

export function describeInstall(adapter: Adapter): InstallPlan {
  const record = readInstallRecord(adapter);
  const hub = describeHub(adapter.hub);
  return {
    adapter: adapter.name,
    home: adapter.home,
    harness: adapter.harness,
    record: adapter.record,
    capabilities: adapter.capabilities,
    instructions: adapter.instructions.map(({ path }) => path),
    initializeGlobalMemory: true,
    hub,
    outputs: [...hub.outputs, ...plannedOutputs(adapter, record)],
    migrations: [
      ...hub.migrations,
      ...plannedAdapterMigrations(adapter, record).map(({ path, action }) => ({ path, action })),
    ],
  };
}

export function snapshotFiles(files: Array<{ path: string }>): Snapshot[] {
  return files.map(({ path }) => ({
    path,
    existed: existsSync(path),
    content: existsSync(path) ? readFileSync(path, 'utf8') : null,
    mode: existsSync(path) ? statSync(path).mode & 0o777 : 0o644,
  }));
}

export function restoreSnapshots(snapshots: Snapshot[]): void {
  for (const snapshot of snapshots) {
    if (snapshot.existed && snapshot.content !== null)
      atomicWrite(snapshot.path, snapshot.content, snapshot.mode);
    else removeExact(snapshot.path);
  }
}
