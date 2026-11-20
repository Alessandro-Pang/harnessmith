import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, resolve, sep } from 'node:path';
import { atomicWrite, digestPath, readJson, removeExact } from '../shared/files.js';
import { assertSafeOutputPath, assertSafeScopePaths, entryExists } from '../shared/safe-path.js';
import type {
  Adapter,
  InstallPlan,
  InstallRecord,
  InstallTargetState,
  ManagedOutput,
  OutputAction,
  PlannedOutput,
  Snapshot,
} from '../shared/types.js';
import { errorMessage, HarnessmithError } from '../shared/types.js';
import { validateRecord } from './record-validation.js';

export const managedBlockMarker = 'harnessmith managed files';

/** Look up the contract entry for a recorded path; unknown paths fail closed. */
export function outputSpec(scope: Adapter, path: string): ManagedOutput {
  const found = scope.outputs.find((output) => output.path === path);
  if (!found) {
    throw new HarnessmithError(
      'INTEGRITY_ERROR',
      `Managed output is outside the ${scope.label} contract: ${path}`,
      3,
    );
  }
  return found;
}

export function assertScopeContract(scope: Adapter): void {
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
    { root: home, path: scope.record },
  ];
  for (const { root, path } of paths) {
    if (!inside(root, path)) throw new Error(`${scope.label} path escapes its root: ${path}`);
  }
  assertSafeScopePaths(scope);
}

export function readInstallRecordAt(scope: Adapter, recordPath: string): InstallRecord | null {
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

export function readInstallRecord(scope: Adapter): InstallRecord | null {
  return readInstallRecordAt(scope, scope.record);
}

export function assertNonOverlappingAdapters(adapters: Adapter[]): void {
  const ownership = adapters.flatMap((adapter) =>
    [...adapter.outputs.map(({ path }) => path), adapter.record].map((path) => ({
      adapter: adapter.name,
      path: resolve(path),
    })),
  );
  for (const [index, left] of ownership.entries()) {
    for (const right of ownership.slice(index + 1)) {
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
  scope: Adapter,
  output: ManagedOutput,
  record: InstallRecord | null,
): { action: OutputAction; state: InstallTargetState } {
  assertSafeOutputPath(scope, output, output.path);
  if (!entryExists(output.path)) return { action: 'create', state: 'missing' };
  const managed = record?.outputs.find((item) => item.path === output.path);
  if (!managed) return { action: 'conflict', state: 'unmanaged' };
  if (managed.checksum === digestPath(output.path)) {
    return { action: 'replace-managed', state: 'managed' };
  }
  return { action: 'conflict', state: 'modified' };
}

export function plannedOutputs(scope: Adapter, record: InstallRecord | null): PlannedOutput[] {
  return scope.outputs.map((output) => ({
    path: output.path,
    ...outputState(scope, output, record),
  }));
}

export function describeInstall(adapter: Adapter): InstallPlan {
  const record = readInstallRecord(adapter);
  return {
    adapter: adapter.name,
    home: adapter.home,
    record: adapter.record,
    capabilities: adapter.capabilities,
    instructions: adapter.instructions.map(({ path }) => path),
    initializeGlobalMemory: true,
    userData: adapter.userData,
    outputs: plannedOutputs(adapter, record),
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
