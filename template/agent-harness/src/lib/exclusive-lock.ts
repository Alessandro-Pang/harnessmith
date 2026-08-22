import { mkdirSync, realpathSync } from 'node:fs';
import lockfile from 'proper-lockfile';

const lockStaleMilliseconds = 15 * 60_000;

export function withExclusiveDirectoryLock<T>(
  root: string,
  subject: string,
  operation: () => T,
): T {
  mkdirSync(root, { recursive: true });
  const canonicalRoot = realpathSync.native(root);
  let release: (() => void) | undefined;
  try {
    release = lockfile.lockSync(canonicalRoot, {
      realpath: false,
      stale: lockStaleMilliseconds,
      retries: 0,
    });
  } catch (error) {
    throw new Error(`${subject} is being updated by another process: ${canonicalRoot}`, {
      cause: error,
    });
  }
  let result: T | undefined;
  let operationError: unknown;
  try {
    result = operation();
  } catch (error) {
    operationError = error;
  }
  let releaseError: unknown;
  try {
    release();
  } catch (error) {
    releaseError = error;
  }
  if (operationError) {
    if (releaseError) {
      throw new Error(
        `Locked ${subject} operation failed and lock release was incomplete: ${String(operationError)}; release: ${String(releaseError)}`,
        { cause: operationError instanceof Error ? operationError : undefined },
      );
    }
    throw operationError;
  }
  if (releaseError) throw releaseError;
  return result as T;
}
