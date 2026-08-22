import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export function isPathInside(root: string, target: string): boolean {
  const path = relative(resolve(root), resolve(target));
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function canonicalPath(input: string): string {
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

export function assertSafePath(root: string, target: string): void {
  const authorizedRoot = resolve(root);
  const requested = resolve(target);
  if (!isPathInside(authorizedRoot, requested)) {
    throw new Error(`Path escapes its authorized root: ${requested}`);
  }

  let current = authorizedRoot;
  for (const component of ['', ...relative(authorizedRoot, requested).split(sep).filter(Boolean)]) {
    if (component) current = join(current, component);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`Path contains a symbolic link: ${current}`);
    }
  }

  if (!isPathInside(canonicalPath(authorizedRoot), canonicalPath(requested))) {
    throw new Error(`Path resolves outside its authorized root: ${requested}`);
  }
}
