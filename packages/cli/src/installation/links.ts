import { cpSync, lstatSync, readlinkSync, statSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { isSymlink } from '../shared/safe-path.js';
import type { StagedOutput } from '../shared/types.js';

/**
 * Stage a managed link. Symlinks are absolute so hosts resolve them from any cwd; a
 * directory target uses a junction on Windows, which needs no extra privilege. When the
 * platform refuses file symlinks the staged output becomes a copy of `source` and the
 * record marks `linkMode: 'copy'` so status and upgrades treat it as a rendered file.
 */
export function stageLink(
  staged: string,
  target: string,
  source: string,
): Pick<StagedOutput, 'link' | 'linkMode'> {
  const directory = isDirectory(source);
  try {
    symlinkSync(target, staged, directory ? 'junction' : 'file');
    return { link: target, linkMode: 'symlink' };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform !== 'win32' || (code !== 'EPERM' && code !== 'EACCES')) throw error;
    cpSync(source, staged, { recursive: true, dereference: false });
    return { link: target, linkMode: 'copy' };
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** True when `path` is a symlink whose literal target equals `target`. */
export function linksTo(path: string, target: string): boolean {
  if (!isSymlink(path)) return false;
  try {
    return resolve(readlinkSync(path)) === resolve(target);
  } catch {
    return false;
  }
}

export function isRegularFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}
