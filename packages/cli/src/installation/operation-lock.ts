import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { lockStaleMilliseconds } from '../shared/lock-stale.js';
import { assertSafePath, assertSafeScopePaths } from '../shared/safe-path.js';
import type { ManagedScope } from '../shared/types.js';
import { errorMessage, HarnessmithError } from '../shared/types.js';

const operationLockName = '.harnessmith-operation.lock';

export function operationLockPath(scope: ManagedScope): string {
  return join(scope.home, operationLockName);
}

/** Hold one operation lock per scope (hub and hosts) in a stable order to avoid deadlocks. */
export function withScopeLocks<T>(
  scopes: ManagedScope[],
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
