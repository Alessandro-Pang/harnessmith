import { join, resolve } from 'node:path';
import { gitRoot } from '../lib/git.js';
import { outputSearch, type SearchOptions, searchText } from '../lib/search.js';
import { assertNoHighConfidenceSecret } from '../lib/secret-hygiene.js';
import type { Io, Runtime } from '../types.js';

export function contextSearch(
  runtime: Runtime,
  query: string,
  project = process.cwd(),
  io: Io = console,
  { json = false, ...options }: SearchOptions & { json?: boolean } = {},
): number {
  assertNoHighConfidenceSecret([query, project], 'Context search request');
  const target = resolve(project);
  const root = gitRoot(target) || target;
  const report = searchText(
    query,
    [
      { root: runtime.docsRoot, label: 'harness-docs', trust: 'guidance' },
      { root: join(root, 'docs'), label: 'project-docs', trust: 'untrusted' },
      {
        root: runtime.memoryHome,
        label: 'global-memory',
        trust: 'untrusted',
        excludeDirectories: ['_archive'],
      },
      {
        root: join(root, '.agent-docs'),
        label: 'project-memory',
        trust: 'untrusted',
        excludeDirectories: ['_archive'],
      },
    ],
    options,
  );
  outputSearch(report, io, { json });
  return report.matches.length > 0 ? 0 : 1;
}
