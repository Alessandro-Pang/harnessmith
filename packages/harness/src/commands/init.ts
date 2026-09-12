import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withExclusiveDirectoryLock } from '../lib/filesystem/exclusive-lock.js';
import { atomicWrite, writeIfMissing } from '../lib/filesystem/files.js';
import { readTemplate, render } from '../lib/filesystem/templates.js';
import { withUserDataCoordinationLocks } from '../lib/filesystem/user-data-lock.js';
import { initializeGlobalMemory } from '../lib/memory/global-memory.js';
import { initializeProjectMemory } from '../lib/project/project-memory.js';
import { assertRuntimeCanMutate } from '../runtime.js';
import type { Io, Runtime } from '../types.js';

export function initGlobal(
  runtime: Runtime,
  io: Io = console,
  inheritedLockKeys: string[] = [],
): void {
  assertRuntimeCanMutate(runtime);
  const { created, repairedProfileRoute } = initializeGlobalMemory(runtime, inheritedLockKeys);
  if (created.length > 0) {
    io.log(`Initialized global memory: ${runtime.memoryHome}`);
    for (const path of created) io.log(`  created ${path}`);
  } else if (repairedProfileRoute) {
    io.log(`Updated global memory profile route: ${runtime.memoryHome}`);
  } else {
    io.log(`Global memory already initialized: ${runtime.memoryHome}`);
  }
}

const stalePersonalMapPointer = /(?:~|\$HOME)\/\.agent-harness\/projects\/repository-map\.md/g;

function migrateStalePersonalOverlay(destination: string, rendered: string): boolean {
  if (!existsSync(destination)) return false;
  const current = readFileSync(destination, 'utf8');
  if (!current.includes('.agent-harness/projects/repository-map.md')) return false;
  const nextPointer = rendered.match(/`([^`]+\/projects\/repository-map\.md)`/)?.[1];
  if (!nextPointer) return false;
  const migrated = current.replace(stalePersonalMapPointer, nextPointer);
  if (migrated === current) return false;
  atomicWrite(destination, migrated);
  return true;
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
    [join('projects', 'repository-map.yaml'), 'personal/projects/repository-map.yaml'],
    [join('projects', 'repository-map.md'), 'personal/projects/repository-map.md'],
  ] as const;
  withUserDataCoordinationLocks([runtime.personalHome], inheritedLockKeys, () => {
    withExclusiveDirectoryLock(runtime.personalHome, 'Personal overlay', () => {
      const created: string[] = [];
      const migrated: string[] = [];
      for (const [destinationName, templateName] of templates) {
        const destination = join(runtime.personalHome, destinationName);
        const content = render(runtime, readTemplate(runtime, templateName));
        if (writeIfMissing(destination, content)) created.push(destination);
        else if (migrateStalePersonalOverlay(destination, content)) migrated.push(destination);
      }
      if (created.length > 0) {
        io.log(`Initialized personal Harness overlay: ${runtime.personalHome}`);
        for (const path of created) io.log(`  created ${path}`);
      } else if (migrated.length > 0) {
        io.log(`Migrated stale personal Harness overlay pointers: ${runtime.personalHome}`);
        for (const path of migrated) io.log(`  migrated ${path}`);
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
