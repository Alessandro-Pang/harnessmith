import { existsSync, lstatSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseFrontmatter } from '../../lib/documentation/frontmatter.js';
import { assertSafePath } from '../../lib/filesystem/safe-path.js';
import { memoryMaintenanceReport } from '../../lib/memory/memory-maintenance.js';
import {
  markdownFiles,
  readMemoryDocument,
  resolveMemoryRoot,
} from '../../lib/memory/memory-path.js';
import { validateMemoryRoot } from '../../lib/memory/memory-validation.js';
import { outputSearch, type SearchOptions } from '../../lib/search/search.js';
import { searchWithIndex } from '../../lib/search/search-index.js';
import { assertNoHighConfidenceSecret } from '../../lib/security/secret-hygiene.js';
import { calendarDate } from '../../runtime.js';
import type { Io, Runtime } from '../../types.js';

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
  assertNoHighConfidenceSecret([input], 'Memory list request');
  const root = resolveMemoryRoot(runtime, input);
  validateMemoryRoot(root, io, {
    quietSuccess: true,
    rootKind: root === runtime.memoryHome ? 'global' : 'project',
  });
  const documents = markdownFiles(root, { archive: false }).map((path) => {
    const metadata = parseFrontmatter(readMemoryDocument(path));
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
  assertNoHighConfidenceSecret([input, query], 'Memory search request');
  const root = resolveMemoryRoot(runtime, input);
  validateMemoryRoot(root, io, {
    quietSuccess: true,
    rootKind: root === runtime.memoryHome ? 'global' : 'project',
  });
  const report = searchWithIndex(
    runtime,
    query,
    [
      {
        root,
        label: 'memory',
        trust: 'untrusted',
        excludeDirectories: ['_archive', 'host-evals'],
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
): {
  version: 1;
  root: string;
  indexed: boolean;
  valid: true;
  totalFiles: number;
  coreBudget: ReturnType<typeof memoryMaintenanceReport>['coreBudget'];
} {
  assertNoHighConfidenceSecret([input], 'Memory check request');
  const root = resolveMemoryRoot(runtime, input);
  validateMemoryRoot(root, io, {
    quietSuccess: indexed || json,
    rootKind: root === runtime.memoryHome ? 'global' : 'project',
  });
  if (indexed) {
    const required = [
      'README.md',
      'core.md',
      ...(root === runtime.memoryHome ? ['profile.md'] : []),
    ];
    const invalid: Array<{ name: string; reason: 'missing' | 'unsafe' }> = [];
    for (const name of required) {
      const path = join(root, name);
      if (!existsSync(path)) {
        invalid.push({ name, reason: 'missing' });
        continue;
      }
      try {
        assertSafePath(root, path);
        const entry = lstatSync(path);
        if (entry.isSymbolicLink() || !entry.isFile()) invalid.push({ name, reason: 'unsafe' });
      } catch {
        invalid.push({ name, reason: 'unsafe' });
      }
    }
    for (const { name, reason } of invalid) {
      io.error(`Required memory entry is ${reason}: ${name}`);
    }
    if (invalid.length > 0) throw new Error(`Memory check failed: ${invalid.length} issue(s)`);
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
    coreBudget: report.coreBudget,
  };
  if (json) io.log(JSON.stringify(result, null, 2));
  else if (indexed) io.log(`Memory check passed: ${root}`);
  return result;
}

export { resolveMemoryRoot } from '../../lib/memory/memory-path.js';
