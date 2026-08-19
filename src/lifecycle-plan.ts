import { existsSync } from 'node:fs';
import { digestManagedOutput, readInstallRecordAt } from './records.js';
import { assertSafeAdapterPaths, assertSafePath, ignoreRoot } from './safe-path.js';
import type { Adapter, InstallRecord } from './types.js';
import { HarnessmithError } from './types.js';

export interface RecordLayer {
  path: string;
  record: InstallRecord;
}

export function assertLifecyclePaths(adapter: Adapter, layers: RecordLayer[] = []): void {
  assertSafeAdapterPaths(adapter);
  for (const ignore of adapter.localIgnoreFiles || []) {
    assertSafePath(ignoreRoot(adapter, ignore), ignore.path);
  }
  for (const layer of layers) {
    assertSafePath(adapter.home, layer.path);
    if (layer.record.recordBackup) assertSafePath(adapter.home, layer.record.recordBackup);
    for (const output of layer.record.outputs) {
      assertSafePath(adapter.home, output.path);
      if (output.backup) assertSafePath(adapter.home, output.backup);
    }
  }
}

export function assertRestorable(adapter: Adapter, record: InstallRecord, force: boolean): void {
  const modified = record.outputs.filter(
    ({ path, checksum }) => existsSync(path) && digestManagedOutput(adapter, path) !== checksum,
  );
  if (modified.length > 0 && !force) {
    throw new HarnessmithError(
      'SAFETY_CONFLICT',
      `Managed files were modified; use --force to restore anyway:\n${modified.map(({ path }) => `  ${path}`).join('\n')}`,
      3,
    );
  }
  const missingBackups = record.outputs.filter(({ backup }) => backup && !existsSync(backup));
  if (missingBackups.length > 0) {
    throw new HarnessmithError(
      'INTEGRITY_ERROR',
      `Cannot restore because backup files are missing:\n${missingBackups.map(({ backup }) => `  ${backup}`).join('\n')}`,
      3,
    );
  }
}

export function installationLayers(adapter: Adapter): RecordLayer[] {
  assertLifecyclePaths(adapter);
  const layers: RecordLayer[] = [];
  const seen = new Set<string>();
  let path: string | null = adapter.record;
  while (path) {
    if (seen.has(path)) {
      throw new HarnessmithError(
        'INTEGRITY_ERROR',
        `Installation record cycle detected: ${path}`,
        3,
      );
    }
    seen.add(path);
    const record = readInstallRecordAt(adapter, path);
    if (!record) break;
    layers.push({ path, record });
    path = record.recordBackup;
  }
  assertLifecyclePaths(adapter, layers);
  return layers;
}

export function assertUninstallable(adapter: Adapter, layers: RecordLayer[], force: boolean): void {
  let activePaths = new Map(layers[0]?.record.outputs.map(({ path }) => [path, path]) || []);
  for (const [index, layer] of layers.entries()) {
    const modified = layer.record.outputs.filter(({ path, checksum }) => {
      const activePath = activePaths.get(path);
      return Boolean(
        activePath &&
          existsSync(activePath) &&
          digestManagedOutput(adapter, activePath, path) !== checksum,
      );
    });
    if (modified.length > 0 && !force) {
      throw new HarnessmithError(
        'SAFETY_CONFLICT',
        `Managed files were modified in installation layer ${index + 1}; use --force to uninstall anyway:\n${modified.map(({ path }) => `  ${path}`).join('\n')}`,
        3,
      );
    }
    const missingBackups = layer.record.outputs.filter(
      ({ backup }) => backup && !existsSync(backup),
    );
    if (missingBackups.length > 0) {
      throw new HarnessmithError(
        'INTEGRITY_ERROR',
        `Cannot uninstall because backup files are missing:\n${missingBackups.map(({ backup }) => `  ${backup}`).join('\n')}`,
        3,
      );
    }
    if (!layer.record.recordBackup) continue;
    const next = new Map<string, string>();
    for (const output of layer.record.outputs) {
      if (!output.backup) {
        throw new HarnessmithError(
          'INTEGRITY_ERROR',
          `Installation layer is missing its previous output: ${output.path}`,
          3,
        );
      }
      next.set(output.path, output.backup);
    }
    activePaths = next;
  }
}
