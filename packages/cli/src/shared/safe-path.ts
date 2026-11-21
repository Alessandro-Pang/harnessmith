import { existsSync, lstatSync, readdirSync, realpathSync, rmdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Adapter, IgnoreFile, ManagedOutput } from './types.js';
import { HarnessmithError } from './types.js';

export function isPathInside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function pathEntry(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
}

/** True when `path` exists as any entry, including a dangling symlink. */
export function entryExists(path: string): boolean {
  return pathEntry(path) !== null;
}

function isSymlink(path: string): boolean {
  return pathEntry(path)?.isSymbolicLink() ?? false;
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
 * Validate both lexical and filesystem containment. Every existing segment below the
 * authorized root — including the leaf — must be a real entry: no symlink is tolerated,
 * even one that currently resolves back inside the root, so a later retarget cannot widen
 * authority.
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

export function ignoreRoot(scope: Adapter, ignore: IgnoreFile): string {
  return ignore.root || scope.home;
}

export function outputRoot(scope: Adapter, output: Pick<ManagedOutput, 'root'>): string {
  return output.root || scope.home;
}

/** Validate a managed output (or its sibling backup) against the root that owns it. */
export function assertSafeOutputPath(
  scope: Adapter,
  output: Pick<ManagedOutput, 'root'>,
  path: string,
): void {
  assertSafePath(outputRoot(scope, output), path);
}

export function assertSafeScopePaths(scope: Adapter): void {
  for (const output of scope.outputs) {
    assertSafeOutputPath(scope, output, output.path);
  }
  assertSafePath(scope.home, scope.record);
  for (const ignore of scope.localIgnoreFiles || []) {
    assertSafePath(ignoreRoot(scope, ignore), ignore.path);
  }
}

/**
 * Remove directories Harnessmith created only to hold managed outputs (`.harnessmith/`)
 * once they are empty. Roots themselves are kept.
 */
export function pruneEmptyDirectories(candidates: Array<{ path: string; root: string }>): void {
  for (const { path, root } of candidates) {
    if (resolve(path) === resolve(root) || !isPathInside(resolve(root), resolve(path))) continue;
    if (!entryExists(path) || isSymlink(path) || readdirSync(path).length > 0) continue;
    assertSafePath(root, path);
    rmdirSync(path);
  }
}
