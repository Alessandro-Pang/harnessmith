import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { withExclusiveDirectoryLock } from '../lib/exclusive-lock.js';
import { writeIfMissing } from '../lib/files.js';
import { withMemoryLock } from '../lib/memory-lock.js';
import { initializeProjectMemory } from '../lib/project-memory.js';
import { readTemplate, render } from '../lib/templates.js';
import { withUserDataCoordinationLocks } from '../lib/user-data-lock.js';
import { assertRuntimeCanMutate } from '../runtime.js';
import type { Io, Runtime } from '../types.js';

export function initGlobal(
  runtime: Runtime,
  io: Io = console,
  inheritedLockKeys: string[] = [],
): void {
  assertRuntimeCanMutate(runtime);
  withMemoryLock(
    runtime.memoryHome,
    () => {
      mkdirSync(runtime.memoryHome, { recursive: true });
      const created: string[] = [];
      for (const name of ['README.md', 'core.md', 'profile.md']) {
        const destination = join(runtime.memoryHome, name);
        const content = render(runtime, readTemplate(runtime, `global-agent-docs/${name}`));
        if (writeIfMissing(destination, content)) created.push(destination);
      }
      if (created.length > 0) {
        io.log(`Initialized global memory: ${runtime.memoryHome}`);
        for (const path of created) io.log(`  created ${path}`);
      } else {
        io.log(`Global memory already initialized: ${runtime.memoryHome}`);
      }
    },
    inheritedLockKeys,
  );
}

export function initPersonal(
  runtime: Runtime,
  io: Io = console,
  inheritedLockKeys: string[] = [],
): void {
  assertRuntimeCanMutate(runtime);
  const templates = [
    ['README.md', 'personal/README.md'],
    ['AGENTS.md', 'personal/AGENTS.md'],
    [join('projects', 'repository-map.md'), 'personal/projects/repository-map.md'],
  ] as const;
  withUserDataCoordinationLocks([runtime.personalHome], inheritedLockKeys, () => {
    withExclusiveDirectoryLock(runtime.personalHome, 'Personal overlay', () => {
      const created: string[] = [];
      for (const [destinationName, templateName] of templates) {
        const destination = join(runtime.personalHome, destinationName);
        const content = render(runtime, readTemplate(runtime, templateName));
        if (writeIfMissing(destination, content)) created.push(destination);
      }
      if (created.length > 0) {
        io.log(`Initialized personal Harness overlay: ${runtime.personalHome}`);
        for (const path of created) io.log(`  created ${path}`);
      } else {
        io.log(`Personal Harness overlay already initialized: ${runtime.personalHome}`);
      }
    });
  });
}

export function initProject(runtime: Runtime, input = '.', io: Io = console): void {
  assertRuntimeCanMutate(runtime);
  const { memoryRoot, created, updatedIgnores } = initializeProjectMemory(runtime, input);
  io.log(`Initialized project memory: ${memoryRoot}`);
  for (const path of created) io.log(`  created ${path}`);
  for (const path of updatedIgnores) io.log(`  updated ${path}`);
  if (created.length === 0 && updatedIgnores.length === 0) io.log('  no changes');
}
