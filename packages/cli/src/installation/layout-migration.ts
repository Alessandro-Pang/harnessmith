import { cpSync, existsSync, renameSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { assertSafePath, entryExists } from '../shared/safe-path.js';
import type {
  Adapter,
  Hub,
  InstallRecord,
  ManagedOutput,
  ManagedScope,
  MigratedOutput,
  MigrationAction,
  PreparedInstall,
} from '../shared/types.js';

/**
 * Layout migrations, all of which move a directory beside itself as
 * `<name>.backup-<stamp>` and record the move so restore and uninstall can put it back:
 *
 * - `migrate-legacy-layout`: a pre-hub host kept its own Harness copy at
 *   `<home>/agent-harness`; the copy is retired and its `state/` seeds the hub state.
 * - `migrate-user-data`: pre-hub user data lived at `~/.agent-harness` (personal rules) and
 *   `~/.agent-docs` (global memory); both move under the hub once, then the originals are
 *   retired. User data is copied, never deleted, and the hub copies are never removed.
 */

export interface PlannedMigration {
  path: string;
  root: string;
  action: MigrationAction;
}

/** Output contract written by pre-hub installers: the Harness copy lived in the host home. */
export function legacyOutputs(adapter: Adapter): ManagedOutput[] {
  return [
    { path: adapter.legacyHarness, kind: 'tree' },
    ...adapter.instructions.map(({ path }): ManagedOutput => ({ path, kind: 'file' })),
  ];
}

export function isLegacyLayoutRecord(record: InstallRecord | null): boolean {
  return record?.schemaVersion === 1;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function besideBackup(path: string, backup: string): boolean {
  return (
    resolve(backup) === backup &&
    dirname(backup) === dirname(path) &&
    basename(backup).startsWith(`${basename(path)}.backup-`)
  );
}

function migratablePaths(scope: ManagedScope): Array<{ path: string; root: string }> {
  if (scope.scope === 'adapter') {
    const adapter = scope as Adapter;
    return [{ path: adapter.legacyHarness, root: adapter.home }];
  }
  const hub = scope as Hub;
  return [
    { path: hub.legacyRules, root: hub.userHome },
    { path: hub.legacyMemory, root: hub.userHome },
  ];
}

/** Only contract-known legacy paths may be recorded as migrated, and only to a sibling backup. */
export function validateMigratedOutputs(scope: ManagedScope, record: InstallRecord): void {
  if (record.migratedOutputs === undefined) return;
  if (!Array.isArray(record.migratedOutputs)) throw new Error('invalid migrated outputs');
  const allowed = migratablePaths(scope);
  for (const migrated of record.migratedOutputs) {
    const known = allowed.find(({ path }) => path === migrated.path);
    if (!known) throw new Error(`migrated output is not a known legacy path: ${migrated.path}`);
    if (typeof migrated.backup !== 'string' || !besideBackup(migrated.path, migrated.backup)) {
      throw new Error(`invalid migrated backup path for ${migrated.path}`);
    }
    assertSafePath(known.root, migrated.backup);
  }
}

/**
 * A recorded pre-hub Harness copy is retired by the upgrade. An unrecorded
 * `<home>/agent-harness` is user content and is neither touched nor reported.
 */
export function plannedAdapterMigrations(
  adapter: Adapter,
  record: InstallRecord | null,
): PlannedMigration[] {
  if (!isLegacyLayoutRecord(record) || !entryExists(adapter.legacyHarness)) return [];
  return [{ path: adapter.legacyHarness, root: adapter.home, action: 'migrate-legacy-layout' }];
}

/** Pre-hub user data moves under the hub only when the hub location is still empty. */
export function plannedHubMigrations(hub: Hub): PlannedMigration[] {
  return [
    { legacy: hub.legacyRules, current: hub.rules },
    { legacy: hub.legacyMemory, current: hub.memory },
  ]
    .filter(
      ({ legacy, current }) =>
        resolve(legacy) !== resolve(current) && isDirectory(legacy) && !entryExists(current),
    )
    .map(({ legacy }) => ({ path: legacy, root: hub.userHome, action: 'migrate-user-data' }));
}

/** User data the hub install copies before the sources are retired. */
export function hubSeeds(
  hub: Hub,
  migrations: PlannedMigration[],
  retiredHarnessCopies: string[],
): PreparedInstall['seeds'] {
  const seeds: PreparedInstall['seeds'] = [];
  for (const { path } of migrations) {
    if (path === hub.legacyRules) seeds.push({ source: path, destination: hub.rules });
    if (path === hub.legacyMemory) seeds.push({ source: path, destination: hub.memory });
  }
  for (const copy of retiredHarnessCopies) {
    const state = join(copy, 'state');
    if (isDirectory(state)) seeds.push({ source: state, destination: hub.state });
  }
  return seeds;
}

export function assertMigrationPaths(prepared: PreparedInstall, stamp: string): void {
  for (const { path, root } of prepared.migrations) {
    assertSafePath(root, path);
    assertSafePath(root, `${path}.backup-${stamp}`);
  }
}

/**
 * Copy seeds before the sources are retired. A missing destination is created and tracked
 * for rollback; an existing destination (shared hub state) only gains files it lacks.
 */
export function commitSeeds(prepared: PreparedInstall, hub: Hub): void {
  for (const { source, destination } of prepared.seeds) {
    if (![hub.rules, hub.memory, hub.state].includes(destination)) {
      throw new Error(`Seed destination is outside the hub user data: ${destination}`);
    }
    if (!entryExists(destination)) {
      cpSync(source, destination, { recursive: true, dereference: false });
      prepared.seeded.push(destination);
    } else {
      cpSync(source, destination, { recursive: true, dereference: false, force: false });
    }
  }
}

/** Move legacy paths aside; the moves join `prepared.backups` so rollback undoes them. */
export function commitMigrations(prepared: PreparedInstall, stamp: string): void {
  for (const { path, root } of prepared.migrations) {
    assertSafePath(root, path);
    if (!entryExists(path)) continue;
    const backup = `${path}.backup-${stamp}`;
    if (existsSync(backup)) throw new Error(`Backup path already exists: ${backup}`);
    renameSync(path, backup);
    prepared.backups.push({ original: path, backup });
  }
}

export function recordedMigrations(prepared: PreparedInstall): MigratedOutput[] {
  const migrated = new Set(prepared.migrations.map(({ path }) => path));
  return prepared.backups
    .filter(({ original }) => migrated.has(original))
    .map(({ original, backup }) => ({ path: original, backup }));
}
