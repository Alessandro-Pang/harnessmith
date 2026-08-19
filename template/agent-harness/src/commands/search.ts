import { join, resolve } from 'node:path';
import { gitRoot } from '../lib/git.js';
import { textSearch } from '../lib/search.js';
import type { Io, Runtime } from '../types.js';

export function contextSearch(
  runtime: Runtime,
  query: string,
  project = process.cwd(),
  io: Io = console,
): number {
  const target = resolve(project);
  const root = gitRoot(target) || target;
  const documentMatches = textSearch(query, [runtime.docsRoot, join(root, 'docs')], io);
  const memoryMatches = textSearch(query, [runtime.memoryHome, join(root, '.agent-docs')], io, {
    excludeDirectories: ['_archive'],
  });
  return documentMatches + memoryMatches > 0 ? 0 : 1;
}
