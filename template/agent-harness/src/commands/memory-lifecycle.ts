import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { atomicWrite } from '../lib/files.js';
import { parseFrontmatter, updateFrontmatter } from '../lib/frontmatter.js';
import { withMemoryLock } from '../lib/memory-lock.js';
import {
  type MemoryMaintenanceReport,
  memoryMaintenanceReport,
} from '../lib/memory-maintenance.js';
import {
  isInside,
  markdownFiles,
  memoryDocumentPath,
  memoryReference,
  resolveMemoryRoot,
} from '../lib/memory-path.js';
import { contentMemoryReferences, metadataReferences } from '../lib/memory-validation.js';
import { assertSafePath } from '../lib/safe-path.js';
import { assertRuntimeCanMutate, calendarDate } from '../runtime.js';
import type { Io, Runtime } from '../types.js';

function inboundReferences(root: string, source: string): string[] {
  const reference = memoryReference(root, source);
  return markdownFiles(root).filter((path) => {
    if (path === source) return false;
    const content = readFileSync(path, 'utf8');
    const metadata = parseFrontmatter(content);
    const contentReferences = contentMemoryReferences(content);
    return (
      contentReferences.some((value) => value === reference || value === `${reference}.md`) ||
      metadataReferences(metadata).some(
        (value) => value === `memory:${reference}` || value === `memory:${reference}.md`,
      )
    );
  });
}

export function memoryMaintenance(
  runtime: Runtime,
  input = '.',
  { json = false }: { json?: boolean } = {},
  io: Io = console,
): MemoryMaintenanceReport {
  const report = memoryMaintenanceReport(resolveMemoryRoot(runtime, input), calendarDate(runtime));
  if (json) io.log(JSON.stringify(report, null, 2));
  else {
    io.log(`Memory maintenance: ${report.root}`);
    io.log(`Unindexed active memory: ${report.unindexed.length}`);
    for (const path of report.unindexed) io.log(`  ${path}`);
    io.log(`Expired working memory: ${report.expiredWorking.length}`);
    for (const path of report.expiredWorking) io.log(`  ${path}`);
    io.log(`Closed archive candidates: ${report.closed.length}`);
    for (const path of report.closed) io.log(`  ${path}`);
  }
  return report;
}

export function supersedeMemory(
  runtime: Runtime,
  input: string,
  sourceName: string,
  replacementName: string,
  io: Io = console,
): string {
  assertRuntimeCanMutate(runtime);
  const root = resolveMemoryRoot(runtime, input);
  return withMemoryLock(root, () => {
    const source = memoryDocumentPath(root, sourceName);
    const replacement = memoryDocumentPath(root, replacementName);
    if (source === replacement) throw new Error('Memory cannot supersede itself');
    const replacementReference = memoryReference(root, replacement);
    const content = updateFrontmatter(readFileSync(source, 'utf8'), {
      status: 'superseded',
      updated: calendarDate(runtime),
      'superseded-by': `memory:${replacementReference}`,
    });
    atomicWrite(source, content);
    io.log(`Superseded memory: ${source} -> memory:${replacementReference}`);
    return source;
  });
}

export function archiveMemory(
  runtime: Runtime,
  input: string,
  name: string,
  { force = false }: { force?: boolean } = {},
  io: Io = console,
): string {
  assertRuntimeCanMutate(runtime);
  const root = resolveMemoryRoot(runtime, input);
  return withMemoryLock(root, () => {
    const source = memoryDocumentPath(root, name);
    const metadata = parseFrontmatter(readFileSync(source, 'utf8'));
    const status = String(metadata.get('status') || 'unknown');
    if (!force && !['complete', 'superseded'].includes(status)) {
      throw new Error(`Archiving ${status} memory requires --force: ${source}`);
    }
    const inbound = inboundReferences(root, source);
    if (inbound.length > 0) {
      throw new Error(
        `Memory is still referenced; update memory references before archiving:\n${inbound.map((path) => `  ${path}`).join('\n')}`,
      );
    }
    const date = calendarDate(runtime);
    const destination = resolve(
      root,
      '_archive',
      date.slice(0, 4),
      date.slice(5, 7),
      relative(root, source),
    );
    if (!isInside(root, destination)) {
      throw new Error(`Archive destination escapes root: ${destination}`);
    }
    assertSafePath(root, destination);
    if (existsSync(destination)) {
      throw new Error(`Archive destination already exists: ${destination}`);
    }
    const content = updateFrontmatter(readFileSync(source, 'utf8'), {
      status: 'archived',
      updated: date,
    });
    mkdirSync(dirname(destination), { recursive: true });
    atomicWrite(destination, content);
    try {
      rmSync(source);
    } catch (error) {
      rmSync(destination, { force: true });
      throw error;
    }
    io.log(`Archived memory: ${source} -> ${destination}`);
    return destination;
  });
}
