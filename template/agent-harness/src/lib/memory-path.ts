import { existsSync, lstatSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Runtime } from '../types.js';
import { listFiles } from './files.js';
import { gitRoot } from './git.js';
import { assertSafePath, isPathInside } from './safe-path.js';

export const isInside = isPathInside;

export function resolveMemoryRoot(runtime: Runtime, input = '.'): string {
  if (input === 'global') return runtime.memoryHome;
  const target = resolve(input);
  return join(gitRoot(target) || target, '.agent-docs');
}

export function markdownFiles(
  root: string,
  { archive = true }: { archive?: boolean } = {},
): string[] {
  if (!existsSync(root)) throw new Error(`Memory root does not exist: ${root}`);
  return listFiles(root).filter((path) => {
    if (!path.endsWith('.md')) return false;
    return archive || !path.split(sep).includes('_archive');
  });
}

export function memoryDocumentPath(root: string, input: string): string {
  const name = input.replace(/^memory:/, '');
  if (!name || isAbsolute(name)) throw new Error(`Invalid memory document path: ${input}`);
  const path = resolve(root, name.endsWith('.md') ? name : `${name}.md`);
  if (path === root || !isInside(root, path))
    throw new Error(`Memory document escapes root: ${input}`);
  assertSafePath(root, path);
  if (!existsSync(path) || !lstatSync(path).isFile()) {
    throw new Error(`Memory document does not exist: ${input}`);
  }
  return path;
}

export function memoryReference(root: string, path: string): string {
  return relative(root, path).split(sep).join('/').replace(/\.md$/, '');
}
