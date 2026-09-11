import { basename, dirname, resolve } from 'node:path';
import { isRegisteredAgentName } from '../adapters/adapter-registry.js';
import { assertSafeOutputPath, assertSafePath, ignoreRoot } from '../shared/safe-path.js';
import type {
  Adapter,
  InstallRecord,
  ManagedOutput,
  ManagedScope,
  RecordOutput,
} from '../shared/types.js';
import { ownerAgentName } from './hub.js';
import { legacyOutputs, validateMigratedOutputs } from './layout-migration.js';

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
  scope: ManagedScope,
  output: Pick<ManagedOutput, 'kind' | 'root'>,
  path: string,
  backup: string,
): boolean {
  const shaped =
    resolve(backup) === backup &&
    dirname(backup) === dirname(path) &&
    basename(backup).startsWith(`${basename(path)}.backup-`);
  if (!shaped) return false;
  assertSafeOutputPath(scope, output, backup);
  return true;
}

function validateOutputs(
  scope: ManagedScope,
  outputs: RecordOutput[],
  contract: ManagedOutput[],
): void {
  if (
    !sameSet(
      outputs.map(({ path }) => path),
      contract.map(({ path }) => path),
    )
  ) {
    throw new Error('managed output paths do not match the contract');
  }
  for (const output of outputs) {
    const spec = contract.find(({ path }) => path === output.path);
    if (!spec) throw new Error(`unexpected managed output ${output.path}`);
    if (typeof output.checksum !== 'string' || output.checksum.length === 0) {
      throw new Error(`missing checksum for ${output.path}`);
    }
    if (output.backup && !validBackupPath(scope, spec, output.path, output.backup)) {
      throw new Error(`invalid backup path for ${output.path}`);
    }
    if (output.link !== undefined && output.link !== spec.target) {
      throw new Error(`recorded link target does not match the contract for ${output.path}`);
    }
    if (output.linkMode !== undefined && !['symlink', 'copy'].includes(output.linkMode)) {
      throw new Error(`invalid link mode for ${output.path}`);
    }
  }
}

function validateIdentity(scope: ManagedScope, record: InstallRecord): ManagedOutput[] {
  if (record.schemaVersion === 1) {
    if (scope.scope !== 'adapter' || record.adapter !== scope.name) {
      throw new Error('unsupported schema or adapter');
    }
    return legacyOutputs(scope as Adapter);
  }
  if (record.schemaVersion !== 2 || record.scope !== scope.scope) {
    throw new Error('unsupported schema or scope');
  }
  if (scope.scope === 'adapter') {
    const adapter = scope as Adapter;
    if (record.adapter !== scope.name) throw new Error('record belongs to another adapter');
    if (typeof record.hub !== 'string' || resolve(record.hub) !== resolve(adapter.hub.home)) {
      throw new Error('record links into another hub');
    }
  } else {
    for (const field of ['owners', 'installed'] as const) {
      const owners = record[field];
      if (
        !Array.isArray(owners) ||
        owners.some(
          (owner) => typeof owner !== 'string' || !isRegisteredAgentName(ownerAgentName(owner)),
        )
      ) {
        throw new Error(`invalid hub ${field}`);
      }
    }
  }
  if (record.stamp !== undefined && typeof record.stamp !== 'string') {
    throw new Error('invalid install stamp');
  }
  return scope.outputs;
}

export function validateRecord(scope: ManagedScope, record: InstallRecord): void {
  if (!Array.isArray(record.outputs)) throw new Error('unsupported schema or outputs');
  const contract = validateIdentity(scope, record);
  validateOutputs(scope, record.outputs, contract);
  validateMigratedOutputs(scope, record);
  if (
    record.contentFingerprint !== undefined &&
    !/^sha256:[a-f0-9]{64}$/.test(record.contentFingerprint)
  ) {
    throw new Error('invalid content fingerprint');
  }
  if (record.recordBackup) {
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
