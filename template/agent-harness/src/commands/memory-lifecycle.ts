import { relative, resolve, sep } from 'node:path';
import { parseFrontmatter, updateFrontmatter } from '../lib/frontmatter.js';
import { sameMemoryReference } from '../lib/memory-core.js';
import {
  archiveMemoryAndValidate,
  assertPortableArchiveDestination,
  replaceMemoryAndValidate,
  snapshotMemoryFile,
} from '../lib/memory-lifecycle-transaction.js';
import { withMemoryLock } from '../lib/memory-lock.js';
import {
  isInside,
  markdownFiles,
  memoryDocumentPath,
  memoryReference,
  readMemoryDocument,
  resolveMemoryRoot,
} from '../lib/memory-path.js';
import {
  contentMemoryReferences,
  isOpaqueMemoryContent,
  metadataReferences,
  validateMemoryRoot,
} from '../lib/memory-validation.js';
import { assertSafePath } from '../lib/safe-path.js';
import { assertNoHighConfidenceSecret } from '../lib/secret-hygiene.js';
import { assertRuntimeCanMutate, calendarDate } from '../runtime.js';
import type { Io, Runtime } from '../types.js';

type LifecycleRootKind = 'global' | 'project';

function lifecycleRootKind(runtime: Runtime, root: string): LifecycleRootKind {
  return root === runtime.memoryHome ? 'global' : 'project';
}

function assertLifecycleSource(root: string, source: string, rootKind: LifecycleRootKind): void {
  const reference = relative(root, source).split(sep).join('/').normalize('NFC').toLowerCase();
  const reserved = new Set(
    rootKind === 'global' ? ['readme.md', 'core.md', 'profile.md'] : ['readme.md', 'core.md'],
  );
  if (reserved.has(reference)) {
    throw new Error(`Reserved memory root entry cannot be archived or superseded: ${source}`);
  }
}

function inboundReferences(root: string, source: string): string[] {
  const reference = memoryReference(root, source);
  return markdownFiles(root).filter((path) => {
    if (path === source) return false;
    const content = readMemoryDocument(path);
    const metadata = parseFrontmatter(content);
    const contentReferences = isOpaqueMemoryContent(metadata, { root, path })
      ? []
      : contentMemoryReferences(content);
    return (
      contentReferences.some((value) => sameMemoryReference(value, reference)) ||
      metadataReferences(metadata).some((value) =>
        sameMemoryReference(value.replace(/^memory:/, ''), reference),
      )
    );
  });
}

function assertSupersessionRemainsAcyclic(root: string, source: string, replacement: string): void {
  const visited = new Set<string>();
  let current = replacement;
  while (true) {
    if (current === source) {
      throw new Error('Memory supersession would create a cycle');
    }
    if (visited.has(current)) {
      throw new Error('Replacement memory already belongs to a supersession cycle');
    }
    visited.add(current);
    const metadata = parseFrontmatter(readMemoryDocument(current));
    const next = metadata.get('superseded-by');
    if (typeof next !== 'string' || !next.startsWith('memory:')) return;
    current = memoryDocumentPath(root, next.slice('memory:'.length));
  }
}

export function supersedeMemory(
  runtime: Runtime,
  input: string,
  sourceName: string,
  replacementName: string,
  io: Io = console,
): string {
  assertRuntimeCanMutate(runtime);
  assertNoHighConfidenceSecret([input, sourceName, replacementName], 'Memory supersession request');
  const root = resolveMemoryRoot(runtime, input);
  return withMemoryLock(
    root,
    () => {
      const source = memoryDocumentPath(root, sourceName);
      const replacement = memoryDocumentPath(root, replacementName);
      const rootKind = lifecycleRootKind(runtime, root);
      assertLifecycleSource(root, source, rootKind);
      validateMemoryRoot(root, io, {
        quietSuccess: true,
        rootKind,
      });
      if (source === replacement) throw new Error('Memory cannot supersede itself');
      assertSupersessionRemainsAcyclic(root, source, replacement);
      const replacementReference = memoryReference(root, replacement);
      const snapshot = snapshotMemoryFile(source);
      const content = updateFrontmatter(snapshot.content, {
        status: 'superseded',
        updated: calendarDate(runtime),
        'superseded-by': `memory:${replacementReference}`,
      });
      replaceMemoryAndValidate(root, snapshot, content, rootKind, io);
      io.log(`Superseded memory: ${source} -> memory:${replacementReference}`);
      return source;
    },
    [],
    { requireExisting: true },
  );
}

export function archiveMemory(
  runtime: Runtime,
  input: string,
  name: string,
  { force = false }: { force?: boolean } = {},
  io: Io = console,
): string {
  assertRuntimeCanMutate(runtime);
  assertNoHighConfidenceSecret([input, name], 'Memory archive request');
  const root = resolveMemoryRoot(runtime, input);
  return withMemoryLock(
    root,
    () => {
      const source = memoryDocumentPath(root, name);
      const rootKind = lifecycleRootKind(runtime, root);
      assertLifecycleSource(root, source, rootKind);
      validateMemoryRoot(root, io, {
        quietSuccess: true,
        rootKind,
      });
      const metadata = parseFrontmatter(readMemoryDocument(source));
      const status = String(metadata.get('status') || 'unknown');
      if (status === 'archived') {
        throw new Error(`Memory is already archived: ${source}`);
      }
      if (['active', 'blocked'].includes(status) && !force) {
        throw new Error(`Archiving ${status} memory requires --force: ${source}`);
      }
      if (!['complete', 'superseded', 'active', 'blocked'].includes(status)) {
        throw new Error(`Memory with status ${status} cannot be archived: ${source}`);
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
      assertPortableArchiveDestination(root, destination);
      const snapshot = snapshotMemoryFile(source);
      const content = updateFrontmatter(snapshot.content, {
        status: 'archived',
        updated: date,
      });
      archiveMemoryAndValidate(root, snapshot, destination, content, rootKind, io);
      io.log(`Archived memory: ${source} -> ${destination}`);
      return destination;
    },
    [],
    { requireExisting: true },
  );
}
