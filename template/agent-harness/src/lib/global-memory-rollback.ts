import { chmodSync, lstatSync, type Stats } from 'node:fs';
import { cleanupTrackedDirectories, type ExactDirectoryIdentity } from './memory-write.js';
import { modeMatches } from './portable-mode.js';

type DirectoryEntry = Stats;

export function matchesDirectoryIdentity(
  entry: DirectoryEntry,
  expected: ExactDirectoryIdentity,
): boolean {
  return (
    !entry.isSymbolicLink() &&
    entry.isDirectory() &&
    entry.dev === expected.dev &&
    entry.ino === expected.ino &&
    entry.birthtimeMs === expected.birthtimeMs
  );
}

function currentRoot(
  root: string,
  expected: ExactDirectoryIdentity,
  rootExisted: boolean,
  errors: string[],
): DirectoryEntry | undefined {
  try {
    const entry = lstatSync(root);
    if (matchesDirectoryIdentity(entry, expected)) return entry;
    errors.push(
      `${root}: rollback skipped because the memory root was replaced; unknown replacement retained at recovery path ${root}`,
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' || rootExisted) {
      errors.push(
        `${root}: memory root identity check failed; recovery path ${root}: ${String(error)}`,
      );
    }
  }
  return undefined;
}

function restoreExistingRootMode(
  root: string,
  rootMode: number,
  rootIdentity: ExactDirectoryIdentity,
  entry: DirectoryEntry,
  errors: string[],
): void {
  const currentMode = entry.mode & 0o777;
  if (modeMatches(currentMode, rootMode)) return;
  if (!modeMatches(currentMode, 0o700)) {
    errors.push(
      `${root}: rollback skipped because the memory root no longer matches the attempted directory mode; unknown mode retained at recovery path ${root}`,
    );
    return;
  }
  try {
    chmodSync(root, rootMode);
    const restored = lstatSync(root);
    if (
      !matchesDirectoryIdentity(restored, rootIdentity) ||
      !modeMatches(restored.mode, rootMode)
    ) {
      errors.push(
        `${root}: rollback directory mode restore was not verified; unresolved recovery path ${root}`,
      );
    }
  } catch (error) {
    errors.push(
      `${root}: rollback directory mode restore failed; recovery path ${root}: ${String(error)}`,
    );
  }
}

export function rollbackGlobalMemoryRoot({
  root,
  rootExisted,
  rootIdentity,
  rootMode,
  restoreFiles,
}: {
  root: string;
  rootExisted: boolean;
  rootIdentity: ExactDirectoryIdentity;
  rootMode: number;
  restoreFiles: () => string[];
}): string[] {
  const errors: string[] = [];
  if (!currentRoot(root, rootIdentity, rootExisted, errors)) return errors;
  errors.push(...restoreFiles());
  const entry = currentRoot(root, rootIdentity, rootExisted, errors);
  if (!entry) return errors;
  if (rootExisted) restoreExistingRootMode(root, rootMode, rootIdentity, entry, errors);
  else if (!modeMatches(entry.mode, 0o700)) {
    errors.push(
      `${root}: rollback skipped because the new memory root no longer matches the attempted directory mode; unknown mode retained at recovery path ${root}`,
    );
  } else {
    errors.push(...cleanupTrackedDirectories([rootIdentity], 'created global memory root'));
  }
  return errors;
}
