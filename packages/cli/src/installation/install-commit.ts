import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  atomicWrite,
  digestPath,
  removeExact,
  replaceManagedBlock,
  timestamp,
} from '../shared/files.js';
import {
  assertSafeOutputPath,
  assertSafePath,
  assertSafeScopePaths,
  entryExists,
  ignoreRoot,
  pruneEmptyDirectories,
} from '../shared/safe-path.js';
import type { InstallRecord, PreparedInstall } from '../shared/types.js';
import { packageVersion } from './install-template.js';
import { managedBlockMarker, restoreSnapshots } from './records.js';

function assertCommitPaths(prepared: PreparedInstall, stamp: string): void {
  const { scope } = prepared;
  assertSafeScopePaths(scope);
  assertSafePath(scope.home, prepared.stageRoot);
  for (const output of prepared.outputs) {
    assertSafePath(prepared.stageRoot, output.staged);
    assertSafeOutputPath(scope, output, output.destination);
    assertSafeOutputPath(scope, output, `${output.destination}.backup-${stamp}`);
  }
  for (const ignore of scope.localIgnoreFiles || []) {
    assertSafePath(ignoreRoot(scope, ignore), ignore.path);
  }
  assertSafePath(scope.home, scope.record);
  assertSafePath(scope.home, `${scope.record}.backup-${stamp}`);
}

/**
 * Move staged outputs into place and write this layer's record. Replaced content is kept
 * as a sibling `.backup-<stamp>` rename so `rollbackInstall` can restore it until the
 * overall install succeeds. Every output is a regular file, so a single rename transaction
 * covers both the backup and the publish.
 */
export function commitInstall(prepared: PreparedInstall, stamp = timestamp()): PreparedInstall {
  const { scope } = prepared;
  assertCommitPaths(prepared, stamp);
  for (const output of prepared.outputs) {
    mkdirSync(dirname(output.destination), { recursive: true });
    assertSafeOutputPath(scope, output, output.destination);
    if (entryExists(output.destination)) {
      const stagedDigest = digestPath(output.staged);
      const unchanged =
        output.managed && stagedDigest !== null && stagedDigest === digestPath(output.destination);
      if (unchanged) continue;
      const backup = `${output.destination}.backup-${stamp}`;
      renameSync(output.destination, backup);
      prepared.backups.push({ original: output.destination, backup });
    }
    renameSync(output.staged, output.destination);
    prepared.installed.push(output.destination);
  }
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
    schemaVersion: 3,
    adapter: scope.name,
    packageVersion,
    installedAt: new Date().toISOString(),
    outputs: prepared.outputs.map(({ destination }) => ({
      path: destination,
      checksum: digestPath(destination) ?? '',
      backup: prepared.backups.find(({ original }) => original === destination)?.backup || null,
    })),
    ignoreFiles: (scope.localIgnoreFiles || []).map(({ path }) => path),
    recordBackup: prepared.recordBackup,
  };
  atomicWrite(scope.record, `${JSON.stringify(record, null, 2)}\n`);
  prepared.recordWritten = true;
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
    if (output) assertSafePath(output.root, path);
    removeExact(path);
  }
  for (const { original, backup } of [...prepared.backups].reverse()) {
    const output = prepared.outputs.find(({ destination }) => destination === original);
    if (!output) continue;
    assertSafePath(output.root, original);
    assertSafePath(output.root, backup);
    if (entryExists(backup)) renameSync(backup, original);
  }
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
