import { chmodSync, existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { calendarDate } from '../runtime.js';
import type { Runtime } from '../types.js';
import { atomicWrite } from './files.js';
import { updateFrontmatter } from './frontmatter.js';
import { matchesDirectoryIdentity, rollbackGlobalMemoryRoot } from './global-memory-rollback.js';
import { upsertCoreReference } from './memory-core.js';
import { withMemoryLock } from './memory-lock.js';
import { readMemoryDocument } from './memory-path.js';
import { validateMemoryPreflight } from './memory-preflight.js';
import {
  assertExactFileState,
  type ExactFileState,
  restoreExactFileState,
  snapshotDirectoryIdentity,
} from './memory-write.js';
import { modeMatches } from './portable-mode.js';
import { assertSafePath } from './safe-path.js';
import { readTemplate, render } from './templates.js';

export interface GlobalMemoryInitialization {
  created: string[];
  repairedProfileRoute: boolean;
}

interface GlobalMemoryTransactionOptions {
  preflightContentOverrides?: () => Map<string, string>;
}

interface FileSnapshot {
  path: string;
  exists: boolean;
  content: string;
  mode: number;
}

const profileEntry = '- 需要理解用户身份、工作方式、技术背景或当前兴趣时读取 `memory:profile`。';

function ensureGlobalProfileRoute(
  root: string,
  path: string,
  updated: string,
  attempted: Map<string, ExactFileState>,
): boolean {
  assertSafePath(root, path);
  const before = attempted.get(path);
  if (!before?.exists) throw new Error(`Global profile route target is missing: ${path}`);
  const current = before.content;
  let content: string;
  if (current.split(/\r?\n/).includes('## User Profile')) {
    content = upsertCoreReference(current, 'User Profile', profileEntry, 'memory:profile', updated);
  } else {
    const suffix = current.endsWith('\n') ? '' : '\n';
    content = updateFrontmatter(`${current}${suffix}\n## User Profile\n\n${profileEntry}\n`, {
      updated,
    });
  }
  assertExactFileState(path, before, 'Global profile route repair');
  if (content === current) return false;
  const candidate = { exists: true, content, mode: before.mode } as const;
  attempted.set(path, candidate);
  atomicWrite(path, candidate.content, candidate.mode);
  assertExactFileState(path, candidate, 'Global profile route repair result');
  return true;
}

function snapshot(path: string): FileSnapshot {
  if (!existsSync(path)) return { path, exists: false, content: '', mode: 0o600 };
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new Error(`Global memory entry must be a regular non-symlink file: ${path}`);
  }
  return {
    path,
    exists: true,
    content: readMemoryDocument(path),
    mode: entry.mode & 0o777,
  };
}

function restore(
  root: string,
  snapshots: FileSnapshot[],
  attempted: ReadonlyMap<string, ExactFileState>,
): string[] {
  const errors: string[] = [];
  for (const entry of [...snapshots].reverse()) {
    const candidate = attempted.get(entry.path);
    if (!candidate) continue;
    const error = restoreExactFileState(root, entry.path, entry, candidate);
    if (error) errors.push(error);
  }
  return errors;
}

function initializeUnlocked(
  runtime: Runtime,
  paths: string[],
  attempted: Map<string, ExactFileState>,
): GlobalMemoryInitialization {
  const created: string[] = [];
  for (const destination of paths) {
    const before = attempted.get(destination);
    if (!before) throw new Error(`Global memory snapshot is missing: ${destination}`);
    const name = destination.slice(runtime.memoryHome.length + 1);
    const template = render(runtime, readTemplate(runtime, `global-agent-docs/${name}`));
    const candidate = {
      exists: true,
      content: before.exists ? before.content : template,
      mode: 0o600,
    } as const;
    assertExactFileState(destination, before, 'Global memory initialization');
    if (!before.exists || !modeMatches(before.mode, candidate.mode)) {
      attempted.set(destination, candidate);
      atomicWrite(destination, candidate.content, candidate.mode);
      assertExactFileState(destination, candidate, 'Global memory initialization result');
      if (!before.exists) created.push(destination);
    }
  }
  return {
    created,
    repairedProfileRoute: ensureGlobalProfileRoute(
      runtime.memoryHome,
      join(runtime.memoryHome, 'core.md'),
      calendarDate(runtime),
      attempted,
    ),
  };
}

export function withGlobalMemoryTransaction<T>(
  runtime: Runtime,
  operation: (initialization: GlobalMemoryInitialization) => T,
  inheritedLockKeys: string[] = [],
  options: GlobalMemoryTransactionOptions = {},
): T {
  assertSafePath(runtime.memoryHome, runtime.memoryHome);
  if (existsSync(runtime.memoryHome) && !lstatSync(runtime.memoryHome).isDirectory()) {
    throw new Error(`Global memory root must be a directory: ${runtime.memoryHome}`);
  }
  const paths = ['README.md', 'core.md', 'profile.md'].map((name) =>
    join(runtime.memoryHome, name),
  );
  for (const path of paths) assertSafePath(runtime.memoryHome, path);
  return withMemoryLock(
    runtime.memoryHome,
    ({ rootExisted }) => {
      let snapshots: FileSnapshot[] = [];
      const rootIdentity = snapshotDirectoryIdentity(runtime.memoryHome);
      const rootMode = lstatSync(runtime.memoryHome).mode & 0o777;
      const attempted = new Map<string, ExactFileState>();
      try {
        snapshots = paths.map(snapshot);
        for (const entry of snapshots) attempted.set(entry.path, entry);
        const rootEntry = lstatSync(runtime.memoryHome);
        if (!matchesDirectoryIdentity(rootEntry, rootIdentity)) {
          throw new Error(`Global memory root changed after snapshot: ${runtime.memoryHome}`);
        }
        if (!modeMatches(rootEntry.mode, 0o700)) {
          chmodSync(runtime.memoryHome, 0o700);
        }
        const initialization = initializeUnlocked(runtime, paths, attempted);
        validateMemoryPreflight(runtime.memoryHome, 'global', {
          contentOverrides: options.preflightContentOverrides?.(),
        });
        return operation(initialization);
      } catch (error) {
        const rollbackErrors = rollbackGlobalMemoryRoot({
          root: runtime.memoryHome,
          rootExisted,
          rootIdentity,
          rootMode,
          restoreFiles: () => restore(runtime.memoryHome, snapshots, attempted),
        });
        if (rollbackErrors.length > 0) {
          throw new Error(
            `Global memory initialization failed and rollback was incomplete: ${String(error)}; unresolved paths: ${rollbackErrors.join('; ')}`,
            { cause: error instanceof Error ? error : undefined },
          );
        }
        throw error;
      }
    },
    inheritedLockKeys,
    { directoryMode: 0o700 },
  );
}

export function initializeGlobalMemory(
  runtime: Runtime,
  inheritedLockKeys: string[] = [],
): GlobalMemoryInitialization {
  return withGlobalMemoryTransaction(
    runtime,
    (initialization) => initialization,
    inheritedLockKeys,
  );
}
