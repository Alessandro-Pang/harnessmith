import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { atomicWrite, removeExact, replaceManagedBlock, timestamp } from '../shared/files.js';
import {
  assertSafeOutputPath,
  assertSafePath,
  assertSafeScopePaths,
  entryExists,
  ignoreRoot,
  pruneEmptyDirectories,
} from '../shared/safe-path.js';
import type {
  Adapter,
  InstallOptions,
  InstallRecord,
  InstallResult,
  PreparedInstall,
} from '../shared/types.js';
import { errorMessage } from '../shared/types.js';
import { effectiveContentFingerprint } from '../status/effective-content-fingerprint.js';
import { hubOwnerId, sharedHub } from './hub.js';
import { prepareHub, prepareInstall } from './install-stage.js';
import { packageVersion } from './install-template.js';
import {
  assertMigrationPaths,
  commitMigrations,
  commitSeeds,
  recordedMigrations,
} from './layout-migration.js';
import { withScopeLocks } from './operation-lock.js';
import {
  assertNonOverlappingAdapters,
  describeInstall,
  digestManagedOutput,
  hubOwners,
  isHub,
  managedBlockMarker,
  readInstallRecord,
  restoreSnapshots,
} from './records.js';
import { initializeUserData } from './user-data.js';

export { prepareHub, prepareInstall } from './install-stage.js';

type RecordIdentity = Pick<InstallRecord, 'adapter' | 'hub' | 'owners' | 'installed' | 'stamp'>;

function assertCommitPaths(prepared: PreparedInstall, stamp: string): void {
  const { scope } = prepared;
  assertSafeScopePaths(scope);
  assertSafePath(scope.home, prepared.stageRoot);
  for (const output of prepared.outputs) {
    assertSafePath(prepared.stageRoot, output.staged, { allowSymlinkLeaf: true });
    assertSafeOutputPath(scope, output, output.destination);
    assertSafeOutputPath(scope, output, `${output.destination}.backup-${stamp}`);
  }
  assertMigrationPaths(prepared, stamp);
  for (const ignore of scope.localIgnoreFiles || []) {
    assertSafePath(ignoreRoot(scope, ignore), ignore.path);
  }
  assertSafePath(scope.home, scope.record);
  assertSafePath(scope.home, `${scope.record}.backup-${stamp}`);
}

/**
 * Move staged outputs into place with sibling backups, retire migrated paths, update ignore
 * blocks and write this layer's record. Every step is undone by `rollbackInstall`.
 */
export function commitInstall(
  prepared: PreparedInstall,
  stamp = timestamp(),
  identity: RecordIdentity = {},
): PreparedInstall {
  const { scope } = prepared;
  assertCommitPaths(prepared, stamp);
  if (isHub(scope)) commitSeeds(prepared, scope);
  for (const output of prepared.outputs) {
    mkdirSync(dirname(output.destination), { recursive: true });
    assertSafeOutputPath(scope, output, output.destination);
    if (entryExists(output.destination)) {
      const backup = `${output.destination}.backup-${stamp}`;
      renameSync(output.destination, backup);
      prepared.backups.push({ original: output.destination, backup });
    }
    renameSync(output.staged, output.destination);
    prepared.installed.push(output.destination);
  }
  commitMigrations(prepared, stamp);
  for (const ignore of scope.localIgnoreFiles || []) {
    assertSafePath(ignoreRoot(scope, ignore), ignore.path);
    replaceManagedBlock(ignore.path, managedBlockMarker, ignore.lines, ignore);
    prepared.ignoreWritten += 1;
  }
  mkdirSync(dirname(scope.record), { recursive: true });
  assertSafePath(scope.home, scope.record);
  if (existsSync(scope.record)) {
    prepared.recordBackup = `${scope.record}.backup-${stamp}`;
    renameSync(scope.record, prepared.recordBackup);
  }
  const record: InstallRecord = {
    schemaVersion: 2,
    scope: scope.scope,
    packageVersion,
    ...identity,
    stamp,
    installedAt: new Date().toISOString(),
    ...(isHub(scope) ? { contentFingerprint: effectiveContentFingerprint(scope) } : {}),
    outputs: prepared.outputs.map(({ destination, link, linkMode }) => ({
      path: destination,
      checksum: digestManagedOutput(scope, destination) ?? '',
      backup: prepared.backups.find(({ original }) => original === destination)?.backup || null,
      ...(link ? { link, linkMode } : {}),
    })),
    ...(prepared.migrations.length > 0 ? { migratedOutputs: recordedMigrations(prepared) } : {}),
    ignoreFiles: (scope.localIgnoreFiles || []).map(({ path }) => path),
    recordBackup: prepared.recordBackup,
  };
  atomicWrite(scope.record, `${JSON.stringify(record, null, 2)}\n`);
  prepared.recordWritten = true;
  removeExact(prepared.stageRoot);
  return prepared;
}

export function rollbackInstall(prepared: PreparedInstall): void {
  const { scope } = prepared;
  if (prepared.recordWritten) {
    assertSafePath(scope.home, scope.record);
    removeExact(scope.record);
  }
  if (prepared.recordBackup && existsSync(prepared.recordBackup)) {
    assertSafePath(scope.home, prepared.recordBackup);
    assertSafePath(scope.home, scope.record);
    renameSync(prepared.recordBackup, scope.record);
  }
  for (const path of [...prepared.installed].reverse()) {
    const output = prepared.outputs.find(({ destination }) => destination === path);
    if (output) assertSafeOutputPath(scope, output, path);
    removeExact(path);
  }
  for (const { original, backup } of [...prepared.backups].reverse()) {
    const output = prepared.outputs.find(({ destination }) => destination === original);
    const migration = prepared.migrations.find(({ path }) => path === original);
    const root = output ? output.root : migration?.root;
    if (!root) continue;
    assertSafePath(root, original, { allowSymlinkLeaf: true });
    assertSafePath(root, backup, { allowSymlinkLeaf: true });
    if (entryExists(backup)) renameSync(backup, original);
  }
  for (const seeded of [...prepared.seeded].reverse()) removeExact(seeded);
  for (let index = 0; index < prepared.ignoreWritten; index += 1) {
    const ignore = scope.localIgnoreFiles?.[index];
    const snapshot = prepared.ignoreSnapshots[index];
    if (!ignore || !snapshot) continue;
    assertSafePath(ignoreRoot(scope, ignore), snapshot.path);
    restoreSnapshots([snapshot]);
  }
  assertSafePath(scope.home, prepared.stageRoot);
  removeExact(prepared.stageRoot);
  if (!prepared.recordBackup) {
    pruneEmptyDirectories([
      ...prepared.outputs
        .filter(
          ({ destination }) => !prepared.backups.some(({ original }) => original === destination),
        )
        .map(({ destination, root }) => ({ path: dirname(destination), root })),
      { path: dirname(scope.record), root: scope.home },
    ]);
  }
}

function rollbackAll(prepared: PreparedInstall[], error: unknown): never {
  const rollbackErrors: string[] = [];
  for (const item of [...prepared].reverse()) {
    try {
      rollbackInstall(item);
    } catch (rollbackError) {
      rollbackErrors.push(`${item.scope.label}: ${errorMessage(rollbackError)}`);
    }
  }
  if (rollbackErrors.length > 0) {
    throw new Error(
      `Installation failed and rollback was incomplete: ${errorMessage(error)}; rollback: ${rollbackErrors.join('; ')}`,
      { cause: error instanceof Error ? error : undefined },
    );
  }
  throw error;
}

/**
 * Install or upgrade the hub and the selected hosts in one transaction: the hub layer is
 * committed first so host links always point at a complete Harness, then each host layer,
 * then user data is initialized. Any failure rolls every layer back.
 */
export function installAll(adapters: Adapter[], options: InstallOptions = {}): InstallResult[] {
  assertNonOverlappingAdapters(adapters);
  const hub = sharedHub(adapters);
  return withScopeLocks([hub, ...adapters], () => {
    const prepared: PreparedInstall[] = [];
    try {
      const hubStage = prepareHub(hub, adapters, options);
      prepared.push(hubStage);
      for (const adapter of adapters) prepared.push(prepareInstall(adapter, hubStage, options));
      const stamp = options.stamp || timestamp();
      const installed = adapters.map(hubOwnerId);
      const owners = [...new Set([...hubOwners(readInstallRecord(hub)), ...installed])];
      commitInstall(hubStage, stamp, { owners, installed });
      for (const item of prepared.slice(1)) {
        commitInstall(item, stamp, { adapter: item.scope.name as Adapter['name'], hub: hub.home });
      }
      const initialization = initializeUserData(hub, options.env || process.env, {
        global: !options.noInitGlobal,
        afterInitialize: options.afterUserDataInitialize,
      });
      return prepared.slice(1).map((item, index) => ({
        ...describeInstall(adapters[index]),
        migrations: [...hubStage.migrations, ...item.migrations].map(({ path, action }) => ({
          path,
          action,
        })),
        initializeGlobalMemory: !options.noInitGlobal,
        backups: [...hubStage.backups, ...item.backups],
        initialization,
      }));
    } catch (error) {
      return rollbackAll(prepared, error);
    }
  });
}
