import { withExclusiveDirectoryLock } from '../filesystem/exclusive-lock.js';
import { assertSafePath } from '../filesystem/safe-path.js';
import { withUserDataCoordinationLocks } from '../filesystem/user-data-lock.js';

export function withMemoryLock<T>(
  root: string,
  operation: (state: { rootExisted: boolean }) => T,
  inheritedKeys: string[] = [],
  options: { directoryMode?: number; requireExisting?: boolean } = {},
): T {
  assertSafePath(root, root);
  return withUserDataCoordinationLocks([root], inheritedKeys, () =>
    withExclusiveDirectoryLock(
      root,
      'Memory',
      (state) => {
        if (options.requireExisting && !state.rootExisted) {
          throw new Error(`Memory root does not exist: ${root}`);
        }
        return operation(state);
      },
      {
        directoryMode: options.directoryMode,
        cleanupEmptyRootOnFailure: Boolean(options.requireExisting),
      },
    ),
  );
}
