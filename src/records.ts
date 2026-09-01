import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, resolve, sep } from 'node:path';
import { atomicWrite, digestPath, readJson, removeExact } from './files.js';
import { assertSafeAdapterPaths, assertSafePath, ignoreRoot } from './safe-path.js';
import type { Adapter, InstallPlan, InstallRecord, OutputAction, Snapshot } from './types.js';
import { errorMessage, HarnessmithError } from './types.js';

export const managedBlockMarker = 'harnessmith managed files';

export function digestManagedOutput(
  adapter: Adapter,
  path: string,
  managedPath = path,
): string | null {
  return digestPath(path, {
    exclude: (relativePath) =>
      managedPath === adapter.harness && relativePath.split(sep)[0] === 'state',
  });
}

export function plannedOutputs(adapter: Adapter): string[] {
  return [adapter.harness, ...adapter.instructions.map(({ path }) => path)];
}

export function assertAdapterContract(adapter: Adapter): void {
  const home = resolve(adapter.home);
  for (const path of [...plannedOutputs(adapter), adapter.record]) {
    const target = resolve(path);
    if (target !== home && !target.startsWith(`${home}${sep}`)) {
      throw new Error(`Adapter path escapes its home: ${path}`);
    }
  }
  assertSafeAdapterPaths(adapter);
}

export function readInstallRecordAt(adapter: Adapter, recordPath: string): InstallRecord | null {
  assertAdapterContract(adapter);
  const resolvedRecordPath = resolve(recordPath);
  const validRecordPath =
    resolvedRecordPath === adapter.record ||
    (dirname(resolvedRecordPath) === dirname(adapter.record) &&
      basename(resolvedRecordPath).startsWith(`${basename(adapter.record)}.backup-`));
  if (!validRecordPath)
    throw new HarnessmithError(
      'INTEGRITY_ERROR',
      `Installation record path escapes its contract: ${recordPath}`,
      3,
    );
  try {
    const record = readJson(resolvedRecordPath) as InstallRecord | null;
    if (!record) return null;
    if (
      record.schemaVersion !== 1 ||
      record.adapter !== adapter.name ||
      !Array.isArray(record.outputs)
    ) {
      throw new Error('unsupported schema or adapter');
    }
    const expected = [...plannedOutputs(adapter)].sort();
    const actual = record.outputs.map(({ path }) => path).sort();
    if (
      actual.length !== expected.length ||
      actual.some((path, index) => path !== expected[index])
    ) {
      throw new Error('managed output paths do not match the Adapter contract');
    }
    for (const output of record.outputs) {
      if (typeof output.checksum !== 'string' || output.checksum.length === 0) {
        throw new Error(`missing checksum for ${output.path}`);
      }
      if (output.backup) {
        const validBackup =
          resolve(output.backup) === output.backup &&
          dirname(output.backup) === dirname(output.path) &&
          basename(output.backup).startsWith(`${basename(output.path)}.backup-`);
        if (!validBackup) throw new Error(`invalid backup path for ${output.path}`);
        assertSafePath(adapter.home, output.backup);
      }
    }
    if (
      record.contentFingerprint !== undefined &&
      !/^sha256:[a-f0-9]{64}$/.test(record.contentFingerprint)
    ) {
      throw new Error('invalid content fingerprint');
    }
    if (record.recordBackup) {
      const validRecordBackup =
        resolve(record.recordBackup) === record.recordBackup &&
        dirname(record.recordBackup) === dirname(adapter.record) &&
        basename(record.recordBackup).startsWith(`${basename(adapter.record)}.backup-`);
      if (!validRecordBackup) throw new Error('invalid installation-record backup path');
      assertSafePath(adapter.home, record.recordBackup);
    }
    const expectedIgnores = (adapter.localIgnoreFiles || []).map(({ path }) => path).sort();
    const actualIgnores = Array.isArray(record.ignoreFiles) ? [...record.ignoreFiles].sort() : [];
    if (
      actualIgnores.length !== expectedIgnores.length ||
      actualIgnores.some((path, index) => path !== expectedIgnores[index])
    ) {
      throw new Error('managed ignore paths do not match the Adapter contract');
    }
    for (const ignore of adapter.localIgnoreFiles || []) {
      assertSafePath(ignoreRoot(adapter, ignore), ignore.path);
    }
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

export function readInstallRecord(adapter: Adapter): InstallRecord | null {
  return readInstallRecordAt(adapter, adapter.record);
}

export function assertNonOverlappingAdapters(adapters: Adapter[]): void {
  const ownership = adapters.flatMap((adapter) =>
    [...plannedOutputs(adapter), adapter.record].map((path) => ({
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
  adapter: Adapter,
  path: string,
  record: InstallRecord | null,
): { action: OutputAction; state: InstallPlan['outputs'][number]['state'] } {
  if (!existsSync(path)) return { action: 'create', state: 'missing' };
  const managed = record?.outputs?.find((item) => item.path === path);
  if (managed && managed.checksum === digestManagedOutput(adapter, path)) {
    return { action: 'replace-managed', state: 'managed' };
  }
  return { action: 'conflict', state: managed ? 'modified' : 'unmanaged' };
}

export function describeInstall(adapter: Adapter): InstallPlan {
  const record = readInstallRecord(adapter);
  return {
    adapter: adapter.name,
    home: adapter.home,
    harness: adapter.harness,
    record: adapter.record,
    capabilities: adapter.capabilities,
    instructions: adapter.instructions.map(({ path }) => path),
    initializeGlobalMemory: true,
    outputs: plannedOutputs(adapter).map((path) => ({
      path,
      ...outputState(adapter, path, record),
    })),
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
