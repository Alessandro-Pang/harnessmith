import { existsSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { execaSync } from 'execa';
import type { Hub } from '../shared/types.js';
import { restoreSnapshots, snapshotFiles } from './records.js';
import { withUserDataCoordinationLocks } from './user-data-lock.js';

/** Init must finish before the 15-minute operation lock is treated as stale. */
export const userDataInitTimeoutMs = 60_000;

/**
 * Initialize the shared personal rules (`hub.rules`) and, unless disabled, the global
 * memory (`hub.memory`) through the installed Harness CLI. Both live beside the hub but are
 * user data: they are created once and never rewritten or removed by Harnessmith.
 */
export function initializeUserData(
  hub: Hub,
  env: NodeJS.ProcessEnv,
  { global, afterInitialize }: { global: boolean; afterInitialize?: () => void },
): string {
  const memoryFiles = global
    ? ['README.md', 'core.md', 'profile.md'].map((name) => join(hub.memory, name))
    : [];
  const personalFiles = [
    join(hub.rules, 'README.md'),
    join(hub.rules, 'AGENTS.md'),
    join(hub.rules, 'projects', 'repository-map.yaml'),
    join(hub.rules, 'projects', 'repository-map.md'),
  ];
  const roots = [hub.rules, ...(global ? [hub.memory] : [])];
  const childEnv = {
    ...env,
    HARNESS_HOME: hub.home,
    HARNESS_MEMORY_HOME: hub.memory,
    HARNESS_PERSONAL_HOME: hub.rules,
  };
  const harnessCli = join(hub.harness, 'scripts', 'harness.mjs');
  return withUserDataCoordinationLocks(roots, (lockKeys) => {
    const coordination = ['--coordination-keys', lockKeys.join(',')];
    const snapshots = snapshotFiles([...memoryFiles, ...personalFiles].map((path) => ({ path })));
    const memoryRootExisted = existsSync(hub.memory);
    const personalRootExisted = existsSync(hub.rules);
    const run = (target: 'personal' | 'global'): string =>
      execaSync(process.execPath, [harnessCli, 'init', target, ...coordination], {
        encoding: 'utf8',
        env: childEnv,
        extendEnv: false,
        timeout: Number(env.HARNESS_USER_DATA_INIT_TIMEOUT_MS) || userDataInitTimeoutMs,
      }).stdout.trim();
    try {
      const output = [run('personal')];
      if (global) output.push(run('global'));
      afterInitialize?.();
      return output.filter(Boolean).join('\n');
    } catch (error) {
      restoreSnapshots(snapshots);
      if (!personalRootExisted && existsSync(hub.rules)) {
        try {
          rmdirSync(join(hub.rules, 'projects'));
          rmdirSync(hub.rules);
        } catch {
          // Preserve unexpected user content created concurrently.
        }
      }
      if (!memoryRootExisted && existsSync(hub.memory)) {
        try {
          rmdirSync(hub.memory);
        } catch {
          // Preserve unexpected user content created concurrently.
        }
      }
      throw error;
    }
  });
}
