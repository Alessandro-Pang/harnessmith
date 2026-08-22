import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { assertSafeAdapterPaths, assertSafePath } from './safe-path.js';
import type { Adapter } from './types.js';
import { errorMessage, HarnessmithError } from './types.js';

const operationLockName = '.harnessmith-operation.lock';
const lockStaleMilliseconds = 15 * 60_000;

export function operationLockPath(adapter: Adapter): string {
  return join(adapter.home, operationLockName);
}

export function withAdapterLocks<T>(
  adapters: Adapter[],
  operation: () => T,
  { createHomes = true }: { createHomes?: boolean } = {},
): T {
  const ordered = [...adapters].sort((left, right) =>
    operationLockPath(left).localeCompare(operationLockPath(right)),
  );
  const releases: Array<() => void> = [];
  let result: T | undefined;
  let operationFailed = false;
  let operationError: unknown;
  try {
    for (const adapter of ordered) {
      assertSafeAdapterPaths(adapter);
      if (!existsSync(adapter.home) && !createHomes) continue;
      mkdirSync(adapter.home, { recursive: true });
      assertSafeAdapterPaths(adapter);
      const lockPath = operationLockPath(adapter);
      assertSafePath(adapter.home, lockPath);
      try {
        releases.push(
          lockfile.lockSync(adapter.home, {
            lockfilePath: lockPath,
            realpath: false,
            stale: lockStaleMilliseconds,
            retries: 0,
          }),
        );
      } catch (error) {
        throw new HarnessmithError(
          'OPERATION_LOCKED',
          `Another Harnesssmith process holds the operation lock for ${adapter.label}: ${errorMessage(error)}`,
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
        `Adapter operation failed and lock release was incomplete: ${errorMessage(operationError)}; releases: ${releaseErrors.map(errorMessage).join('; ')}`,
        { cause: operationError instanceof Error ? operationError : undefined },
      );
    }
    throw operationError;
  }
  if (releaseErrors.length > 0) {
    throw new Error(
      `Adapter lock release was incomplete: ${releaseErrors.map(errorMessage).join('; ')}`,
      { cause: releaseErrors[0] instanceof Error ? releaseErrors[0] : undefined },
    );
  }
  return result as T;
}
