import { lstatSync, realpathSync, type Stats } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export function isPathInside(root: string, target: string): boolean {
  const path = relative(resolve(root), resolve(target));
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function entryIfPresent(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export function canonicalPath(input: string): string {
  let current = resolve(input);
  const suffix: string[] = [];
  let entry = entryIfPresent(current);
  while (!entry) {
    const parent = dirname(current);
    if (parent === current) break;
    suffix.unshift(basename(current));
    current = parent;
    entry = entryIfPresent(current);
  }
  const canonical = entry ? realpathSync.native(current) : current;
  return resolve(canonical, ...suffix);
}

export function sameExistingPath(left: string, right: string): boolean {
  try {
    return Boolean(
      entryIfPresent(left) && entryIfPresent(right) && canonicalPath(left) === canonicalPath(right),
    );
  } catch {
    return false;
  }
}

export function sameCanonicalPath(left: string, right: string): boolean {
  const identity = (path: string) => {
    const canonical = canonicalPath(path).normalize('NFC');
    return process.platform === 'win32' || process.platform === 'darwin'
      ? canonical.toLocaleLowerCase('en-US')
      : canonical;
  };
  return identity(left) === identity(right);
}

export function assertSafePath(root: string, target: string): void {
  const authorizedRoot = resolve(root);
  const requested = resolve(target);
  if (!isPathInside(authorizedRoot, requested)) {
    throw new Error(`Path escapes its authorized root: ${requested}`);
  }

  let current = authorizedRoot;
  for (const component of ['', ...relative(authorizedRoot, requested).split(sep).filter(Boolean)]) {
    if (component) current = join(current, component);
    if (entryIfPresent(current)?.isSymbolicLink()) {
      throw new Error(`Path contains a symbolic link: ${current}`);
    }
  }

  if (!isPathInside(canonicalPath(authorizedRoot), canonicalPath(requested))) {
    throw new Error(`Path resolves outside its authorized root: ${requested}`);
  }
}
