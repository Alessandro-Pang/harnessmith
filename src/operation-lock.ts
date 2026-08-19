import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { assertSafeAdapterPaths, assertSafePath } from './safe-path.js';
import type { Adapter } from './types.js';
import { errorMessage, HarnessmithError } from './types.js';

const operationLockName = '.harnessmith-operation.lock';

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
            stale: 30_000,
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
    return operation();
  } finally {
    for (const release of releases.reverse()) release();
  }
}
