import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Adapter, IgnoreFile } from './types.js';
import { HarnessmithError } from './types.js';

export function isPathInside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function pathEntry(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Resolve every existing prefix while retaining a not-yet-created suffix. This
 * gives callers a stable, canonical authorization root without requiring it to
 * exist before a dry-run.
 */
export function canonicalPath(input: string): string {
  let current = resolve(input);
  const suffix: string[] = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    suffix.unshift(basename(current));
    current = parent;
  }
  const canonical = existsSync(current) ? realpathSync.native(current) : current;
  return resolve(canonical, ...suffix);
}

function assertNoSymlinkSegments(root: string, target: string): void {
  const components = relative(root, target).split(sep).filter(Boolean);
  let current = root;
  for (const component of ['', ...components]) {
    if (component) current = join(current, component);
    const entry = pathEntry(current);
    if (!entry) continue;
    if (entry.isSymbolicLink()) {
      throw new HarnessmithError(
        'UNSAFE_PATH',
        `Unsafe path contains a symbolic link: ${current}`,
        3,
      );
    }
  }
}

/**
 * Validate both lexical and filesystem containment. Existing symlink/junction
 * segments below the authorized root are rejected even when they currently
 * resolve back inside the root, so a later retarget cannot widen authority.
 */
export function assertSafePath(root: string, target: string): void {
  const authorizedRoot = resolve(root);
  const requested = resolve(target);
  if (!isPathInside(authorizedRoot, requested)) {
    throw new HarnessmithError(
      'UNSAFE_PATH',
      `Unsafe path escapes its authorized root: ${requested}`,
      3,
    );
  }

  assertNoSymlinkSegments(authorizedRoot, requested);
  const currentRoot = canonicalPath(authorizedRoot);

  const canonicalTarget = canonicalPath(requested);
  if (!isPathInside(currentRoot, canonicalTarget)) {
    throw new HarnessmithError(
      'UNSAFE_PATH',
      `Unsafe path resolves outside its authorized root: ${requested}`,
      3,
    );
  }
}

export function ignoreRoot(adapter: Adapter, ignore: IgnoreFile): string {
  return ignore.root || adapter.home;
}

export function assertSafeAdapterPaths(adapter: Adapter): void {
  for (const path of [
    adapter.harness,
    ...adapter.instructions.map(({ path }) => path),
    adapter.record,
  ]) {
    assertSafePath(adapter.home, path);
  }
  for (const ignore of adapter.localIgnoreFiles || []) {
    assertSafePath(ignoreRoot(adapter, ignore), ignore.path);
  }
}
