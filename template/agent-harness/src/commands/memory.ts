import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseFrontmatter } from '../lib/frontmatter.js';
import { memoryMaintenanceReport } from '../lib/memory-maintenance.js';
import { markdownFiles, resolveMemoryRoot } from '../lib/memory-path.js';
import { validateMemoryRoot } from '../lib/memory-validation.js';
import { outputSearch, type SearchOptions, searchText } from '../lib/search.js';
import { calendarDate } from '../runtime.js';
import type { Io, Runtime } from '../types.js';

export interface MemoryListReport {
  version: 1;
  root: string;
  documents: Array<{
    path: string;
    kind: string;
    status: string;
    updated: string;
    title: string;
  }>;
}

export function memoryList(
  runtime: Runtime,
  input = '.',
  io: Io = console,
  { json = false }: { json?: boolean } = {},
): MemoryListReport {
  const root = resolveMemoryRoot(runtime, input);
  const documents = markdownFiles(root, { archive: false }).map((path) => {
    const metadata = parseFrontmatter(readFileSync(path, 'utf8'));
    return {
      path: relative(root, path).replaceAll('\\', '/'),
      kind: String(metadata.get('memory-kind') || metadata.get('type') || 'unknown'),
      status: String(metadata.get('status') || 'unknown'),
      updated: String(metadata.get('updated') || 'unknown'),
      title: String(metadata.get('title') || 'untitled'),
    };
  });
  const report: MemoryListReport = { version: 1, root, documents };
  if (json) io.log(JSON.stringify(report, null, 2));
  else {
    for (const document of documents) {
      io.log(
        [document.path, document.kind, document.status, document.updated, document.title].join(
          ' | ',
        ),
      );
    }
  }
  return report;
}

export function memorySearch(
  runtime: Runtime,
  input: string,
  query: string,
  io: Io = console,
  { json = false, ...options }: SearchOptions & { json?: boolean } = {},
): number {
  if (!query) throw new Error('Usage: harness memory search <global|project-path> <query>');
  const report = searchText(
    query,
    [
      {
        root: resolveMemoryRoot(runtime, input),
        label: 'memory',
        trust: 'untrusted',
        excludeDirectories: ['_archive'],
      },
    ],
    options,
  );
  outputSearch(report, io, { json });
  return report.matches.length > 0 ? 0 : 1;
}

export function memoryCheck(
  runtime: Runtime,
  input = '.',
  io: Io = console,
  { indexed = false, json = false }: { indexed?: boolean; json?: boolean } = {},
): { version: 1; root: string; indexed: boolean; valid: true; totalFiles: number } {
  const root = resolveMemoryRoot(runtime, input);
  validateMemoryRoot(root, io, { quietSuccess: indexed || json });
  if (indexed) {
    const required = [
      'README.md',
      'core.md',
      ...(root === runtime.memoryHome ? ['profile.md'] : []),
    ];
    const missing = required.filter((name) => !existsSync(join(root, name)));
    for (const name of missing) io.error(`Required memory entry is missing: ${name}`);
    if (missing.length > 0) throw new Error(`Memory check failed: ${missing.length} issue(s)`);
  }
  const report = memoryMaintenanceReport(root, calendarDate(runtime));
  if (indexed) {
    for (const path of report.unindexed) {
      io.error(`Active memory is not reachable from an index: ${path}`);
    }
    if (report.unindexed.length > 0) {
      throw new Error(`Memory check failed: ${report.unindexed.length} issue(s)`);
    }
  }
  const result = {
    version: 1 as const,
    root,
    indexed,
    valid: true as const,
    totalFiles: report.totalFiles,
  };
  if (json) io.log(JSON.stringify(result, null, 2));
  else if (indexed) io.log(`Memory check passed: ${root}`);
  return result;
}

export { resolveMemoryRoot } from '../lib/memory-path.js';
