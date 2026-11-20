import { basename, dirname, resolve } from 'node:path';
import { assertSafePath, ignoreRoot, outputRoot } from '../shared/safe-path.js';
import type { Adapter, InstallRecord, ManagedOutput, RecordOutput } from '../shared/types.js';

function sameSet(actual: string[], expected: string[]): boolean {
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  return (
    sortedActual.length === sortedExpected.length &&
    sortedActual.every((path, index) => path === sortedExpected[index])
  );
}

/** Backups live beside their output as `<name>.backup-<stamp>` and never escape the root. */
export function validBackupPath(
  scope: Adapter,
  output: Pick<ManagedOutput, 'root'>,
  path: string,
  backup: string,
): boolean {
  const shaped =
    resolve(backup) === backup &&
    dirname(backup) === dirname(path) &&
    basename(backup).startsWith(`${basename(path)}.backup-`);
  if (!shaped) return false;
  assertSafePath(outputRoot(scope, output), backup);
  return true;
}

function validateOutputs(scope: Adapter, outputs: RecordOutput[], contract: ManagedOutput[]): void {
  if (
    !sameSet(
      outputs.map(({ path }) => path),
      contract.map(({ path }) => path),
    )
  ) {
    throw new Error('managed output paths do not match the contract');
  }
  for (const output of outputs) {
    if (!sameSet(Object.keys(output), ['path', 'checksum', 'backup'])) {
      throw new Error(`invalid managed output shape for ${output.path}`);
    }
    const spec = contract.find(({ path }) => path === output.path);
    if (!spec) throw new Error(`unexpected managed output ${output.path}`);
    if (typeof output.checksum !== 'string' || output.checksum.length === 0) {
      throw new Error(`missing checksum for ${output.path}`);
    }
    if (output.backup !== null) {
      if (
        typeof output.backup !== 'string' ||
        !validBackupPath(scope, spec, output.path, output.backup)
      ) {
        throw new Error(`invalid backup path for ${output.path}`);
      }
    }
  }
}

function validateIdentity(scope: Adapter, record: InstallRecord): ManagedOutput[] {
  if (record.schemaVersion !== 3) throw new Error('unsupported schema');
  if (record.adapter !== scope.name) throw new Error('record belongs to another adapter');
  if (typeof record.packageVersion !== 'string' || record.packageVersion.length === 0) {
    throw new Error('invalid package version');
  }
  if (typeof record.installedAt !== 'string' || record.installedAt.length === 0) {
    throw new Error('invalid install timestamp');
  }
  if (
    !sameSet(Object.keys(record), [
      'schemaVersion',
      'adapter',
      'packageVersion',
      'installedAt',
      'outputs',
      'ignoreFiles',
      'recordBackup',
    ])
  ) {
    throw new Error('invalid installation-record shape');
  }
  return scope.outputs;
}

export function validateRecord(scope: Adapter, record: InstallRecord): void {
  if (!Array.isArray(record.outputs)) throw new Error('unsupported schema or outputs');
  const contract = validateIdentity(scope, record);
  validateOutputs(scope, record.outputs, contract);
  if (record.recordBackup !== null) {
    if (typeof record.recordBackup !== 'string') {
      throw new Error('invalid installation-record backup path');
    }
    const validRecordBackup =
      resolve(record.recordBackup) === record.recordBackup &&
      dirname(record.recordBackup) === dirname(scope.record) &&
      basename(record.recordBackup).startsWith(`${basename(scope.record)}.backup-`);
    if (!validRecordBackup) throw new Error('invalid installation-record backup path');
    assertSafePath(scope.home, record.recordBackup);
  }
  const expectedIgnores = (scope.localIgnoreFiles || []).map(({ path }) => path).sort();
  const actualIgnores = Array.isArray(record.ignoreFiles) ? [...record.ignoreFiles].sort() : [];
  if (!sameSet(actualIgnores, expectedIgnores)) {
    throw new Error('managed ignore paths do not match the contract');
  }
  for (const ignore of scope.localIgnoreFiles || []) {
    assertSafePath(ignoreRoot(scope, ignore), ignore.path);
  }
}
