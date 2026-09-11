import {
  assertSafeOutputPath,
  assertSafePath,
  entryExists,
  ignoreRoot,
} from '../shared/safe-path.js';
import type {
  InstallRecord,
  LifecycleChange,
  LifecycleLayerPlan,
  ManagedScope,
  MigratedOutput,
} from '../shared/types.js';
import { HarnessmithError } from '../shared/types.js';
import { digestManagedOutput, isHub, outputSpec, readInstallRecordAt } from './records.js';

export interface RecordLayer {
  path: string;
  record: InstallRecord;
}

/** Hub migrations retire pre-hub user data under the user home; host ones stay in the host home. */
export function migrationRoot(scope: ManagedScope): string {
  return isHub(scope) ? scope.userHome : scope.home;
}

export function assertLifecyclePaths(scope: ManagedScope, layers: RecordLayer[] = []): void {
  for (const output of scope.outputs) assertSafeOutputPath(scope, output, output.path);
  assertSafePath(scope.home, scope.record);
  for (const ignore of scope.localIgnoreFiles || []) {
    assertSafePath(ignoreRoot(scope, ignore), ignore.path);
  }
  for (const layer of layers) {
    assertSafePath(scope.home, layer.path);
    if (layer.record.recordBackup) assertSafePath(scope.home, layer.record.recordBackup);
    for (const output of layer.record.outputs) {
      const spec = outputSpec(scope, output.path);
      assertSafeOutputPath(scope, spec, output.path);
      if (output.backup) assertSafeOutputPath(scope, spec, output.backup);
    }
    for (const migrated of migratedOutputs(layer.record)) {
      assertSafePath(migrationRoot(scope), migrated.path);
      assertSafePath(migrationRoot(scope), migrated.backup);
    }
  }
}

export function migratedOutputs(record: InstallRecord): MigratedOutput[] {
  return record.migratedOutputs ?? [];
}

export function assertRestorable(scope: ManagedScope, record: InstallRecord, force: boolean): void {
  const modified = record.outputs.filter(
    ({ path, checksum }) => entryExists(path) && digestManagedOutput(scope, path) !== checksum,
  );
  if (modified.length > 0 && !force) {
    throw new HarnessmithError(
      'SAFETY_CONFLICT',
      `Managed files were modified; use --force to restore anyway:\n${modified.map(({ path }) => `  ${path}`).join('\n')}`,
      3,
    );
  }
  const missingBackups = [...record.outputs, ...migratedOutputs(record)].filter(
    ({ backup }) => backup && !entryExists(backup),
  );
  if (missingBackups.length > 0) {
    throw new HarnessmithError(
      'INTEGRITY_ERROR',
      `Cannot restore because backup files are missing:\n${missingBackups.map(({ backup }) => `  ${backup}`).join('\n')}`,
      3,
    );
  }
}

export function installationLayers(scope: ManagedScope): RecordLayer[] {
  assertLifecyclePaths(scope);
  const layers: RecordLayer[] = [];
  const seen = new Set<string>();
  let path: string | null = scope.record;
  while (path) {
    if (seen.has(path)) {
      throw new HarnessmithError(
        'INTEGRITY_ERROR',
        `Installation record cycle detected: ${path}`,
        3,
      );
    }
    seen.add(path);
    const record = readInstallRecordAt(scope, path);
    if (!record) {
      if (layers.length === 0) break;
      throw new HarnessmithError(
        'INTEGRITY_ERROR',
        `Installation record backup is missing: ${path}`,
        3,
      );
    }
    layers.push({ path, record });
    path = record.recordBackup;
  }
  assertLifecyclePaths(scope, layers);
  return layers;
}

export function assertUninstallable(
  scope: ManagedScope,
  layers: RecordLayer[],
  force: boolean,
): void {
  let activePaths = new Map(layers[0]?.record.outputs.map(({ path }) => [path, path]) || []);
  for (const [index, layer] of layers.entries()) {
    const modified = layer.record.outputs.filter(({ path, checksum }) => {
      const activePath = activePaths.get(path);
      return Boolean(
        activePath &&
          entryExists(activePath) &&
          digestManagedOutput(scope, activePath, path) !== checksum,
      );
    });
    if (modified.length > 0 && !force) {
      throw new HarnessmithError(
        'SAFETY_CONFLICT',
        `Managed files were modified in installation layer ${index + 1}; use --force to uninstall anyway:\n${modified.map(({ path }) => `  ${path}`).join('\n')}`,
        3,
      );
    }
    const missingBackups = [...layer.record.outputs, ...migratedOutputs(layer.record)].filter(
      ({ backup }) => backup && !entryExists(backup),
    );
    if (missingBackups.length > 0) {
      throw new HarnessmithError(
        'INTEGRITY_ERROR',
        `Cannot uninstall because backup files are missing:\n${missingBackups.map(({ backup }) => `  ${backup}`).join('\n')}`,
        3,
      );
    }
    const previous = layers[index + 1];
    if (!layer.record.recordBackup || !previous) continue;
    const next = new Map<string, string>();
    for (const migrated of migratedOutputs(layer.record)) next.set(migrated.path, migrated.backup);
    for (const output of layer.record.outputs) {
      if (output.backup) {
        next.set(output.path, output.backup);
        continue;
      }
      // A path the previous layer did not own has nothing to restore; a path it did own
      // must either carry a backup or have been retired through migratedOutputs.
      if (previous.record.outputs.some(({ path }) => path === output.path)) {
        throw new HarnessmithError(
          'INTEGRITY_ERROR',
          `Installation layer is missing its previous output: ${output.path}`,
          3,
        );
      }
    }
    activePaths = next;
  }
}

export function describeLayer(scope: ManagedScope, layer: RecordLayer): LifecycleLayerPlan {
  const changes: LifecycleChange[] = layer.record.outputs.map(({ path, backup }) =>
    backup ? { path, action: 'restore-backup', source: backup } : { path, action: 'remove' },
  );
  changes.push(
    ...migratedOutputs(layer.record).map(
      ({ path, backup }): LifecycleChange => ({ path, action: 'restore-migrated', source: backup }),
    ),
  );
  changes.push(
    layer.record.recordBackup
      ? { path: scope.record, action: 'restore-backup', source: layer.record.recordBackup }
      : { path: scope.record, action: 'remove' },
  );
  if (!layer.record.recordBackup) {
    changes.push(
      ...(scope.localIgnoreFiles || []).map(({ path }) => ({
        path,
        action: 'remove-managed-block' as const,
      })),
    );
  }
  return { sourceRecord: layer.path, changes };
}
