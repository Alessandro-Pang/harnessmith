import { existsSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { execaSync } from 'execa';
import type { UserDataPaths } from '../shared/types.js';
import { templateRoot } from './install-template.js';
import { restoreSnapshots, snapshotFiles } from './records.js';
import { withUserDataCoordinationLocks } from './user-data-lock.js';

/** Init must finish before the 15-minute operation lock is treated as stale. */
export const userDataInitTimeoutMs = 60_000;

/**
 * Initialize personal rules and, unless disabled, global memory through the global CLI.
 * They are user data: created once and never rewritten or removed by Harnessmith.
 */
export function initializeUserData(
  userData: UserDataPaths,
  env: NodeJS.ProcessEnv,
  {
    global,
    afterInitialize,
    runtimeEntry = join(templateRoot, 'bin', 'harnessmith.mjs'),
  }: { global: boolean; afterInitialize?: () => void; runtimeEntry?: string },
): string {
  const memoryFiles = global
    ? ['README.md', 'core.md', 'profile.md'].map((name) => join(userData.memory, name))
    : [];
  const personalFiles = [
    join(userData.rules, 'README.md'),
    join(userData.rules, 'AGENTS.md'),
    join(userData.rules, 'projects', 'repository-map.yaml'),
    join(userData.rules, 'projects', 'repository-map.md'),
  ];
  const roots = [userData.rules, ...(global ? [userData.memory] : [])];
  const childEnv = {
    ...env,
    HARNESS_HOME: userData.home,
    HARNESS_STATE_HOME: userData.state,
    HARNESS_MEMORY_HOME: userData.memory,
    HARNESS_PERSONAL_HOME: userData.rules,
  };
  return withUserDataCoordinationLocks(roots, (lockKeys) => {
    const coordination = ['--coordination-keys', lockKeys.join(',')];
    const snapshots = snapshotFiles([...memoryFiles, ...personalFiles].map((path) => ({ path })));
    const memoryRootExisted = existsSync(userData.memory);
    const personalRootExisted = existsSync(userData.rules);
    const run = (target: 'personal' | 'global'): string =>
      execaSync(process.execPath, [runtimeEntry, 'init', target, ...coordination], {
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
      if (!personalRootExisted && existsSync(userData.rules)) {
        try {
          rmdirSync(join(userData.rules, 'projects'));
          rmdirSync(userData.rules);
        } catch {
          // Preserve unexpected user content created concurrently.
        }
      }
      if (!memoryRootExisted && existsSync(userData.memory)) {
        try {
          rmdirSync(userData.memory);
        } catch {
          // Preserve unexpected user content created concurrently.
        }
      }
      throw error;
    }
  });
}
