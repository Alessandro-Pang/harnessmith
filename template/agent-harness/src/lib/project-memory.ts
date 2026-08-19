import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { Runtime } from '../types.js';
import { atomicWrite, writeIfMissing } from './files.js';
import { gitRoot } from './git.js';
import { assertSafePath } from './safe-path.js';
import { readTemplate, render } from './templates.js';

export interface ProjectMemoryInitialization {
  memoryRoot: string;
  created: string[];
  updatedIgnores: string[];
}

function ensureIgnore(path: string): boolean {
  const rule = '/.agent-docs/';
  const heading = '# Local Agent working documents';
  const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
  if (current.split(/\r?\n/).includes(rule)) return false;
  const prefix = current.length === 0 ? '' : current.endsWith('\n') ? '\n' : '\n\n';
  atomicWrite(path, `${current}${prefix}${heading}\n${rule}\n`);
  return true;
}

export function initializeProjectMemory(
  runtime: Runtime,
  input = '.',
): ProjectMemoryInitialization {
  const requested = resolve(input);
  if (!existsSync(requested) || !statSync(requested).isDirectory()) {
    throw new Error(`Project path does not exist or is not a directory: ${requested}`);
  }
  const target = gitRoot(requested) || requested;
  const memoryRoot = join(target, '.agent-docs');
  assertSafePath(target, memoryRoot);
  mkdirSync(memoryRoot, { recursive: true });

  const created: string[] = [];
  for (const name of ['README.md', 'core.md']) {
    const destination = join(memoryRoot, name);
    const content = render(runtime, readTemplate(runtime, `project-agent-docs/${name}`), {
      PROJECT_KEY: basename(target),
    });
    if (writeIfMissing(destination, content)) created.push(destination);
  }

  const ignoreFiles = [join(target, '.gitignore'), join(target, '.ignore')];
  for (const path of ignoreFiles) assertSafePath(target, path);
  return {
    memoryRoot,
    created,
    updatedIgnores: ignoreFiles.filter(ensureIgnore),
  };
}
