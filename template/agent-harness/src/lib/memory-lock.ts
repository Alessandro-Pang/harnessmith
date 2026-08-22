import { withExclusiveDirectoryLock } from './exclusive-lock.js';
import { withUserDataCoordinationLocks } from './user-data-lock.js';

export function withMemoryLock<T>(
  root: string,
  operation: () => T,
  inheritedKeys: string[] = [],
): T {
  return withUserDataCoordinationLocks([root], inheritedKeys, () =>
    withExclusiveDirectoryLock(root, 'Memory', operation),
  );
}
