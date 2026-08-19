import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { atomicWrite } from '../lib/files.js';
import { parseFrontmatter, updateFrontmatter } from '../lib/frontmatter.js';
import {
  isInside,
  markdownFiles,
  memoryDocumentPath,
  memoryReference,
  resolveMemoryRoot,
} from '../lib/memory-path.js';
import { metadataReferences, validateMemoryRoot } from '../lib/memory-validation.js';
import { assertSafePath } from '../lib/safe-path.js';
import { textSearch } from '../lib/search.js';
import { calendarDate } from '../runtime.js';
import type { Io, Runtime } from '../types.js';

export interface MemoryPromotionProposal {
  version: 1;
  mode: 'proposal-only';
  memory: string;
  target: string;
  title: string;
  description: string;
  sourceRefs: string[];
  sourceOfTruth: false;
}

function inboundReferences(root: string, source: string): string[] {
  const reference = memoryReference(root, source);
  return markdownFiles(root, { archive: false }).filter((path) => {
    if (path === source) return false;
    const content = readFileSync(path, 'utf8');
    const metadata = parseFrontmatter(content);
    return (
      content.includes(`memory:${reference}`) ||
      metadataReferences(metadata).some(
        (value) => value === `memory:${reference}` || value === `memory:${reference}.md`,
      )
    );
  });
}

export function memoryList(runtime: Runtime, input = '.', io: Io = console): void {
  const root = resolveMemoryRoot(runtime, input);
  for (const path of markdownFiles(root, { archive: false })) {
    const metadata = parseFrontmatter(readFileSync(path, 'utf8'));
    const kind = metadata.get('memory-kind') || metadata.get('type') || 'unknown';
    io.log(
      [
        relative(root, path),
        String(kind),
        String(metadata.get('status') || 'unknown'),
        String(metadata.get('updated') || 'unknown'),
        String(metadata.get('title') || 'untitled'),
      ].join(' | '),
    );
  }
}

export function memorySearch(
  runtime: Runtime,
  input: string,
  query: string,
  io: Io = console,
): number {
  if (!query) throw new Error('Usage: harness memory search <global|project-path> <query>');
  return textSearch(query, [resolveMemoryRoot(runtime, input)], io, {
    excludeDirectories: ['_archive'],
  }) > 0
    ? 0
    : 1;
}

export function memoryCheck(runtime: Runtime, input = '.', io: Io = console): void {
  const root = resolveMemoryRoot(runtime, input);
  validateMemoryRoot(root, io);
}

export function supersedeMemory(
  runtime: Runtime,
  input: string,
  sourceName: string,
  replacementName: string,
  io: Io = console,
): string {
  const root = resolveMemoryRoot(runtime, input);
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
}

export function archiveMemory(
  runtime: Runtime,
  input: string,
  name: string,
  { force = false }: { force?: boolean } = {},
  io: Io = console,
): string {
  const root = resolveMemoryRoot(runtime, input);
  const source = memoryDocumentPath(root, name);
  const metadata = parseFrontmatter(readFileSync(source, 'utf8'));
  const status = String(metadata.get('status') || 'unknown');
  if (!force && !['complete', 'superseded'].includes(status)) {
    throw new Error(`Archiving ${status} memory requires --force: ${source}`);
  }
  const inbound = inboundReferences(root, source);
  if (inbound.length > 0) {
    throw new Error(
      `Memory is still referenced; update active indexes before archiving:\n${inbound.map((path) => `  ${path}`).join('\n')}`,
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
  if (!isInside(root, destination))
    throw new Error(`Archive destination escapes root: ${destination}`);
  assertSafePath(root, destination);
  if (existsSync(destination))
    throw new Error(`Archive destination already exists: ${destination}`);
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
}

export function memoryPromotionProposal(
  runtime: Runtime,
  input: string,
  name: string,
  targetName: string,
  io: Io = console,
): MemoryPromotionProposal {
  if (input === 'global') throw new Error('Promotion requires a project memory scope');
  const root = resolveMemoryRoot(runtime, input);
  const project = dirname(root);
  const source = memoryDocumentPath(root, name);
  const target = resolve(project, targetName);
  if (target === project || !isInside(project, target) || isInside(root, target)) {
    throw new Error(
      `Promotion target must be an authoritative project path outside .agent-docs: ${target}`,
    );
  }
  const metadata = parseFrontmatter(readFileSync(source, 'utf8'));
  const proposal: MemoryPromotionProposal = {
    version: 1,
    mode: 'proposal-only',
    memory: memoryReference(root, source),
    target,
    title: String(metadata.get('title') || 'untitled'),
    description: String(metadata.get('description') || ''),
    sourceRefs: Array.isArray(metadata.get('source-refs'))
      ? (metadata.get('source-refs') as unknown[]).filter(
          (value): value is string => typeof value === 'string',
        )
      : [],
    sourceOfTruth: false,
  };
  io.log(JSON.stringify(proposal, null, 2));
  return proposal;
}

export { resolveMemoryRoot } from '../lib/memory-path.js';
