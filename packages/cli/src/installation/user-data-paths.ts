import { homedir } from 'node:os';
import { join } from 'node:path';
import { canonicalPath } from '../shared/safe-path.js';
import type { UserDataPaths } from '../shared/types.js';

/**
 * Resolve mutable user-data paths. Distribution content stays in the npm package and the
 * skills CLI owns the agent-facing skill; this directory never contains a CLI or Runtime.
 * Defaults to `~/.harnessmith`; each location can be overridden independently.
 */
export function resolveUserData(env: NodeJS.ProcessEnv = process.env): UserDataPaths {
  const userHome = canonicalPath(env.HOME || homedir());
  const home = canonicalPath(env.HARNESS_HOME || join(userHome, '.harnessmith'));
  return {
    home,
    userHome,
    state: canonicalPath(env.HARNESS_STATE_HOME || join(home, 'state')),
    rules: canonicalPath(env.HARNESS_PERSONAL_HOME || join(home, 'rules')),
    memory: canonicalPath(env.HARNESS_MEMORY_HOME || join(home, 'memory')),
  };
}
