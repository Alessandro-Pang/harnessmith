import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { lockStaleMilliseconds } from '../shared/lock-stale.js';
import { assertSafePath, assertSafeScopePaths } from '../shared/safe-path.js';
import type { Adapter } from '../shared/types.js';
import { errorMessage, HarnessmithError } from '../shared/types.js';

const operationLockName = '.harnessmith-operation.lock';

export function operationLockPath(scope: Adapter): string {
  return join(scope.home, operationLockName);
}

/**
 * Lock runner for one composite operation. Workflows that already hold the scope locks
 * pass an identity runner so nested install/uninstall steps reuse the held locks instead
 * of deadlocking on a second acquisition; standalone calls keep the default locking.
 */
export type ScopeLockContext = <T>(operation: () => T) => T;

/** Hold one operation lock per adapter scope in a stable order to avoid deadlocks. */
export function withScopeLocks<T>(
  scopes: Adapter[],
  operation: () => T,
  { createHomes = true }: { createHomes?: boolean } = {},
): T {
  const ordered = [...scopes].sort((left, right) =>
    operationLockPath(left).localeCompare(operationLockPath(right)),
  );
  const releases: Array<() => void> = [];
  let result: T | undefined;
  let operationFailed = false;
  let operationError: unknown;
  try {
    for (const scope of ordered) {
      // Managed outputs are regular files; any symlink at a destination fails closed.
      assertSafeScopePaths(scope);
      if (!existsSync(scope.home) && !createHomes) continue;
      mkdirSync(scope.home, { recursive: true });
      assertSafeScopePaths(scope);
      const lockPath = operationLockPath(scope);
      assertSafePath(scope.home, lockPath);
      try {
        releases.push(
          lockfile.lockSync(scope.home, {
            lockfilePath: lockPath,
            realpath: false,
            stale: lockStaleMilliseconds,
            retries: 0,
          }),
        );
      } catch (error) {
        throw new HarnessmithError(
          'OPERATION_LOCKED',
          `Another Harnessmith process holds the operation lock for ${scope.label}: ${errorMessage(error)}`,
          4,
          { cause: error },
        );
      }
    }
    result = operation();
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }
  const releaseErrors: unknown[] = [];
  for (const release of releases.reverse()) {
    try {
      release();
    } catch (error) {
      releaseErrors.push(error);
    }
  }
  if (operationFailed) {
    if (releaseErrors.length > 0) {
      throw new Error(
        `Scope operation failed and lock release was incomplete: ${errorMessage(operationError)}; releases: ${releaseErrors.map(errorMessage).join('; ')}`,
        { cause: operationError instanceof Error ? operationError : undefined },
      );
    }
    throw operationError;
  }
  if (releaseErrors.length > 0) {
    throw new Error(
      `Scope lock release was incomplete: ${releaseErrors.map(errorMessage).join('; ')}`,
      { cause: releaseErrors[0] instanceof Error ? releaseErrors[0] : undefined },
    );
  }
  return result as T;
}
