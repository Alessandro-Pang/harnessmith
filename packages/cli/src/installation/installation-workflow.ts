import type { Adapter, InstallOptions } from '../shared/types.js';
import { errorMessage, HarnessmithError } from '../shared/types.js';
import { installAll } from './install.js';
import { uninstallAll } from './lifecycle.js';
import { type ScopeLockContext, withScopeLocks } from './operation-lock.js';
import { installSkills, uninstallSkills } from './skills.js';

/** The composite workflow already holds every scope lock; nested steps must reuse them. */
const heldScopeLocks: ScopeLockContext = (operation) => operation();

/**
 * Host files and the skills-managed skill have different owners. Keep their result messages
 * truthful instead of claiming that two independent transactions rolled back together.
 * One scope-lock window covers the whole Host+skills sequence so concurrent processes
 * cannot interleave the two steps into opposite states.
 */
export function installWithSkills(adapters: Adapter[], options: InstallOptions) {
  return withScopeLocks(adapters, () => {
    const results = installAll(adapters, options, heldScopeLocks);
    try {
      installSkills(adapters, options.env || process.env);
    } catch (error) {
      throw new HarnessmithError(
        'INTERNAL_ERROR',
        `Host instructions and user data were installed, but skill installation failed: ${errorMessage(error)}. The Host files remain installed; retry install to complete the skill, or uninstall to remove the Host files.`,
        1,
        { cause: error instanceof Error ? error : undefined, reason: 'skill-install-failed' },
      );
    }
    return results;
  });
}

export function uninstallWithSkills(
  adapters: Adapter[],
  options: Pick<InstallOptions, 'force'>,
  env: NodeJS.ProcessEnv,
) {
  return withScopeLocks(adapters, () => {
    const results = uninstallAll(adapters, options, heldScopeLocks);
    try {
      uninstallSkills(adapters, env);
    } catch (error) {
      throw new HarnessmithError(
        'INTERNAL_ERROR',
        `Host instructions were uninstalled, but skill removal failed: ${errorMessage(error)}. The Host changes remain committed and the skill may remain installed; inspect or remove it with the skills CLI.`,
        1,
        { cause: error instanceof Error ? error : undefined, reason: 'skill-uninstall-failed' },
      );
    }
    return results;
  });
}
