import { existsSync, lstatSync, readdirSync, realpathSync, rmdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { IgnoreFile, ManagedOutput, ManagedScope } from './types.js';
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

export function isSymlink(path: string): boolean {
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

function assertNoSymlinkSegments(root: string, target: string, allowLeaf: boolean): void {
  const components = relative(root, target).split(sep).filter(Boolean);
  let current = root;
  for (const [index, component] of ['', ...components].entries()) {
    if (component) current = join(current, component);
    if (allowLeaf && index === components.length) return;
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

export interface SafePathOptions {
  /**
   * Permit the final path component to be a symlink. Managed link outputs (and their
   * backups) are symlinks by design; every operation on them is non-following
   * (lstat, readlink, rename, unlink), so the link target never widens authority.
   */
  allowSymlinkLeaf?: boolean;
}

/**
 * Validate both lexical and filesystem containment. Existing symlink/junction
 * segments below the authorized root are rejected even when they currently
 * resolve back inside the root, so a later retarget cannot widen authority.
 */
export function assertSafePath(
  root: string,
  target: string,
  { allowSymlinkLeaf = false }: SafePathOptions = {},
): void {
  const authorizedRoot = resolve(root);
  const requested = resolve(target);
  if (!isPathInside(authorizedRoot, requested)) {
    throw new HarnessmithError(
      'UNSAFE_PATH',
      `Unsafe path escapes its authorized root: ${requested}`,
      3,
    );
  }

  assertNoSymlinkSegments(authorizedRoot, requested, allowSymlinkLeaf);
  const currentRoot = canonicalPath(authorizedRoot);

  const canonicalTarget =
    allowSymlinkLeaf && requested !== authorizedRoot
      ? join(canonicalPath(dirname(requested)), basename(requested))
      : canonicalPath(requested);
  if (!isPathInside(currentRoot, canonicalTarget)) {
    throw new HarnessmithError(
      'UNSAFE_PATH',
      `Unsafe path resolves outside its authorized root: ${requested}`,
      3,
    );
  }
}

export function ignoreRoot(scope: ManagedScope, ignore: IgnoreFile): string {
  return ignore.root || scope.home;
}

export function outputRoot(scope: ManagedScope, output: Pick<ManagedOutput, 'root'>): string {
  return output.root || scope.home;
}

/** Validate a managed output (or its sibling backup) against the root that owns it. */
export function assertSafeOutputPath(
  scope: ManagedScope,
  output: Pick<ManagedOutput, 'kind' | 'root'>,
  path: string,
): void {
  assertSafePath(outputRoot(scope, output), path, { allowSymlinkLeaf: output.kind === 'link' });
}

export function assertSafeScopePaths(scope: ManagedScope): void {
  for (const output of scope.outputs) assertSafeOutputPath(scope, output, output.path);
  assertSafePath(scope.home, scope.record);
  for (const ignore of scope.localIgnoreFiles || []) {
    assertSafePath(ignoreRoot(scope, ignore), ignore.path);
  }
}

/**
 * Remove directories Harnessmith created only to hold managed outputs (`skills/`,
 * `.harnessmith/`, `~/.agents/skills`) once they are empty. Roots themselves are kept.
 */
export function pruneEmptyDirectories(candidates: Array<{ path: string; root: string }>): void {
  for (const { path, root } of candidates) {
    if (resolve(path) === resolve(root) || !isPathInside(resolve(root), resolve(path))) continue;
    if (!entryExists(path) || isSymlink(path) || readdirSync(path).length > 0) continue;
    assertSafePath(root, path);
    rmdirSync(path);
  }
}
