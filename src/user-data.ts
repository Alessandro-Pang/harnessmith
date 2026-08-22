import { existsSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { installationValues } from './install-template.js';
import { restoreSnapshots, snapshotFiles } from './records.js';
import type { PreparedInstall } from './types.js';
import { withUserDataCoordinationLocks } from './user-data-lock.js';

export function initializeUserData(
  prepared: PreparedInstall,
  env: NodeJS.ProcessEnv,
  { global }: { global: boolean },
): string {
  const values = installationValues(prepared.adapter, env);
  const memoryFiles = global
    ? ['README.md', 'core.md', 'profile.md'].map((name) => join(values.memoryHome, name))
    : [];
  const personalFiles = [
    join(values.personalHome, 'README.md'),
    join(values.personalHome, 'AGENTS.md'),
    join(values.personalHome, 'projects', 'repository-map.md'),
  ];
  const roots = [values.personalHome, ...(global ? [values.memoryHome] : [])];
  return withUserDataCoordinationLocks(roots, (lockKeys) => {
    const coordination = ['--coordination-keys', lockKeys.join(',')];
    const snapshots = snapshotFiles([...memoryFiles, ...personalFiles].map((path) => ({ path })));
    const memoryRootExisted = existsSync(values.memoryHome);
    const personalRootExisted = existsSync(values.personalHome);
    try {
      const output = [
        execaSync(
          process.execPath,
          [
            join(prepared.adapter.harness, 'bin', 'harness.mjs'),
            'init',
            'personal',
            ...coordination,
          ],
          { encoding: 'utf8', env, extendEnv: false },
        ).stdout.trim(),
      ];
      if (global) {
        output.push(
          execaSync(
            process.execPath,
            [
              join(prepared.adapter.harness, 'bin', 'harness.mjs'),
              'init',
              'global',
              ...coordination,
            ],
            { encoding: 'utf8', env, extendEnv: false },
          ).stdout.trim(),
        );
      }
      return output.filter(Boolean).join('\n');
    } catch (error) {
      restoreSnapshots(snapshots);
      if (!personalRootExisted && existsSync(values.personalHome)) {
        try {
          rmdirSync(join(values.personalHome, 'projects'));
          rmdirSync(values.personalHome);
        } catch {
          // Preserve unexpected user content created concurrently.
        }
      }
      if (!memoryRootExisted && existsSync(values.memoryHome)) {
        try {
          rmdirSync(values.memoryHome);
        } catch {
          // Preserve unexpected user content created concurrently.
        }
      }
      throw error;
    }
  });
}
