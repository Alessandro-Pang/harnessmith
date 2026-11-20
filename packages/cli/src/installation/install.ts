import { removeExact, timestamp } from '../shared/files.js';
import { entryExists } from '../shared/safe-path.js';
import type { Adapter, InstallOptions, InstallResult, PreparedInstall } from '../shared/types.js';
import { errorMessage } from '../shared/types.js';
import { commitInstall, rollbackInstall } from './install-commit.js';
import { prepareInstall } from './install-stage.js';
import { type ScopeLockContext, withScopeLocks } from './operation-lock.js';
import { assertNonOverlappingAdapters, describeInstall } from './records.js';
import { initializeUserData } from './user-data.js';

export { commitInstall, rollbackInstall } from './install-commit.js';
export { prepareInstall } from './install-stage.js';

function rollbackAll(prepared: PreparedInstall[], error: unknown): never {
  const rollbackErrors: string[] = [];
  for (const item of [...prepared].reverse()) {
    try {
      rollbackInstall(item);
    } catch (rollbackError) {
      rollbackErrors.push(`${item.scope.label}: ${errorMessage(rollbackError)}`);
    }
  }
  if (rollbackErrors.length > 0) {
    throw new Error(
      `Installation failed and rollback was incomplete: ${errorMessage(error)}; rollback: ${rollbackErrors.join('; ')}`,
      { cause: error instanceof Error ? error : undefined },
    );
  }
  throw error;
}

/** Commit all adapter layers and initialize user data before post-commit stage cleanup. */
export function installAll(
  adapters: Adapter[],
  options: InstallOptions = {},
  withLocks: ScopeLockContext = (operation) => withScopeLocks(adapters, operation),
): InstallResult[] {
  assertNonOverlappingAdapters(adapters);
  const [first] = adapters;
  if (!first) return [];
  return withLocks(() => {
    const prepared: PreparedInstall[] = [];
    let postCommit = false;
    try {
      for (const adapter of adapters) prepared.push(prepareInstall(adapter, options));
      const stamp = options.stamp || timestamp();
      for (const item of prepared) commitInstall(item, stamp);
      const initialization = initializeUserData(first.userData, options.env || process.env, {
        global: !options.noInitGlobal,
        ...(options.afterUserDataInitialize === undefined
          ? {}
          : { afterInitialize: options.afterUserDataInitialize }),
      });
      postCommit = true;
      for (const item of prepared) removeExact(item.stageRoot);
      return prepared.map((item, index) => {
        const adapter = adapters[index];
        if (!adapter) throw new Error(`Missing installation adapter at index ${index}`);
        return {
          ...describeInstall(adapter),
          initializeGlobalMemory: !options.noInitGlobal,
          backups: item.backups,
          initialization,
        };
      });
    } catch (error) {
      if (postCommit) {
        const paths = prepared
          .filter((item) => entryExists(item.stageRoot))
          .map((item) => item.stageRoot);
        throw new Error(
          `Installation completed but post-commit cleanup failed: ${errorMessage(error)}; recovery data retained at: ${paths.join(', ')}`,
          { cause: error instanceof Error ? error : undefined },
        );
      }
      return rollbackAll(prepared, error);
    }
  });
}
