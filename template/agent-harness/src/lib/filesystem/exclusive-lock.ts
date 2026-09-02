import { existsSync, lstatSync, mkdirSync, realpathSync, rmdirSync } from 'node:fs';
import lockfile from 'proper-lockfile';

const lockStaleMilliseconds = 15 * 60_000;

interface DirectoryIdentity {
  dev: number;
  ino: number;
  canonicalPath: string;
}

function directoryIdentity(root: string): DirectoryIdentity {
  const entry = lstatSync(root);
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new Error(`Lock root must be a regular non-symlink directory: ${root}`);
  }
  return {
    dev: entry.dev,
    ino: entry.ino,
    canonicalPath: realpathSync.native(root),
  };
}

function sameDirectoryIdentity(root: string, expected: DirectoryIdentity): boolean {
  try {
    const current = directoryIdentity(root);
    return (
      current.dev === expected.dev &&
      current.ino === expected.ino &&
      current.canonicalPath === expected.canonicalPath
    );
  } catch {
    return false;
  }
}

function cleanupCreatedLockRoot(root: string, identity: DirectoryIdentity): void {
  if (sameDirectoryIdentity(root, identity)) rmdirSync(root);
}

export function withExclusiveDirectoryLock<T>(
  root: string,
  subject: string,
  operation: (state: { rootExisted: boolean }) => T,
  {
    cleanupEmptyRootOnFailure = false,
    directoryMode = 0o755,
  }: { cleanupEmptyRootOnFailure?: boolean; directoryMode?: number } = {},
): T {
  const rootExisted = existsSync(root);
  mkdirSync(root, { recursive: true, mode: directoryMode });
  const identity = directoryIdentity(root);
  const canonicalRoot = identity.canonicalPath;
  let release: (() => void) | undefined;
  try {
    release = lockfile.lockSync(canonicalRoot, {
      realpath: false,
      stale: lockStaleMilliseconds,
      retries: 0,
    });
  } catch (error) {
    if (!rootExisted) {
      try {
        cleanupCreatedLockRoot(root, identity);
      } catch {}
    }
    throw new Error(`${subject} is being updated by another process: ${canonicalRoot}`, {
      cause: error,
    });
  }
  if (!sameDirectoryIdentity(root, identity)) {
    let releaseError: unknown;
    try {
      release();
    } catch (error) {
      releaseError = error;
    }
    throw new Error(
      `${subject} root changed while acquiring its lock: ${root}${releaseError ? `; release: ${String(releaseError)}` : ''}`,
      { cause: releaseError instanceof Error ? releaseError : undefined },
    );
  }
  let result: T | undefined;
  let operationError: unknown;
  try {
    result = operation({ rootExisted });
  } catch (error) {
    operationError = error;
  }
  let releaseError: unknown;
  try {
    release();
  } catch (error) {
    releaseError = error;
  }
  let cleanupError: unknown;
  if (operationError && cleanupEmptyRootOnFailure && !rootExisted) {
    try {
      cleanupCreatedLockRoot(root, identity);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') cleanupError = error;
    }
  }
  if (operationError) {
    if (releaseError || cleanupError) {
      throw new Error(
        `Locked ${subject} operation failed and cleanup was incomplete: ${String(operationError)}${releaseError ? `; release: ${String(releaseError)}` : ''}${cleanupError ? `; root cleanup: ${String(cleanupError)}` : ''}`,
        { cause: operationError instanceof Error ? operationError : undefined },
      );
    }
    throw operationError;
  }
  if (releaseError) throw releaseError;
  return result as T;
}
