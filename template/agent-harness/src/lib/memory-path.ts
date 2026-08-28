import { existsSync, lstatSync, opendirSync, realpathSync } from 'node:fs';
import { extname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import type { Runtime } from '../types.js';
import { readBoundedRegularFile } from './bounded-file.js';
import { gitRoot } from './git.js';
import { assertSafePath, isPathInside } from './safe-path.js';

export const isInside = isPathInside;
export const maximumMemoryDocumentBytes = 2 * 1024 * 1024;
const maximumMemoryRootBytes = 64 * 1024 * 1024;

export class MemoryPathError extends Error {
  constructor(
    message: string,
    readonly code: 'non-canonical-reference',
  ) {
    super(message);
  }
}

const managedTreeLimits = {
  maxDepth: 64,
  maxEntries: 100_000,
  maxDurationMs: 30_000,
};

export function isExcludedMemoryArtifact(root: string, path: string): boolean {
  return relative(root, path).split(sep)[0]?.toLowerCase() === 'host-evals';
}

export function resolveMemoryRoot(runtime: Runtime, input = '.'): string {
  const root =
    input === 'global'
      ? runtime.memoryHome
      : join(gitRoot(resolve(input)) || resolve(input), '.agent-docs');
  assertSafePath(root, root);
  return root;
}

export interface ManagedMemoryEntry {
  path: string;
  kind: 'directory' | 'file';
}

export function managedMemoryEntries(root: string): ManagedMemoryEntry[] {
  if (!existsSync(root)) throw new Error(`Memory root does not exist: ${root}`);
  assertSafePath(root, root);
  const deadline = Date.now() + managedTreeLimits.maxDurationMs;
  const pending = [{ path: root, depth: 0 }];
  const managed: ManagedMemoryEntry[] = [];
  let entries = 0;
  while (pending.length > 0) {
    const item = pending.pop();
    if (!item) continue;
    if (Date.now() > deadline) {
      throw new Error(`Memory tree validation time budget exceeded: ${item.path}`);
    }
    if (item.depth > managedTreeLimits.maxDepth) {
      throw new Error(`Memory tree validation depth budget exceeded: ${item.path}`);
    }
    assertSafePath(root, item.path);
    const directory = opendirSync(item.path);
    try {
      let entry = directory.readSync();
      while (entry) {
        const path = join(item.path, entry.name);
        if (isExcludedMemoryArtifact(root, path)) {
          entry = directory.readSync();
          continue;
        }
        entries += 1;
        if (entries > managedTreeLimits.maxEntries) {
          throw new Error(`Memory tree validation entry budget exceeded: ${path}`);
        }
        const stat = lstatSync(path);
        if (stat.isSymbolicLink()) {
          throw new Error(`Managed memory tree contains a symbolic link: ${path}`);
        }
        if (stat.isDirectory()) {
          managed.push({ path, kind: 'directory' });
          pending.push({ path, depth: item.depth + 1 });
        } else if (stat.isFile()) managed.push({ path, kind: 'file' });
        else {
          throw new Error(`Managed memory tree contains a special file: ${path}`);
        }
        entry = directory.readSync();
      }
    } finally {
      directory.closeSync();
    }
  }
  return managed.sort((left, right) => left.path.localeCompare(right.path));
}

export function markdownFiles(
  root: string,
  {
    archive = true,
    entries = managedMemoryEntries(root),
  }: { archive?: boolean; entries?: readonly ManagedMemoryEntry[] } = {},
): string[] {
  const files: string[] = [];
  for (const { path, kind } of entries) {
    if (kind !== 'file') continue;
    if (isExcludedMemoryArtifact(root, path)) continue;
    const extension = extname(path);
    if (extension.toLowerCase() !== '.md') continue;
    if (extension !== '.md') {
      throw new Error(`Memory Markdown extension is not canonical: ${path}`);
    }
    const archived = path
      .split(sep)
      .some((component) => component.normalize('NFC').toLowerCase() === '_archive');
    if (archive || !archived) files.push(path);
  }
  let totalBytes = 0;
  for (const path of files) {
    assertSafePath(root, path);
    const entry = lstatSync(path);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`Memory document must be a regular non-symlink file: ${path}`);
    }
    if (entry.size > maximumMemoryDocumentBytes) {
      throw new Error(`Memory document byte budget exceeded: ${path}`);
    }
    totalBytes += entry.size;
    if (totalBytes > maximumMemoryRootBytes) {
      throw new Error(`Memory root byte budget exceeded: ${root}`);
    }
  }
  return files;
}

export function readMemoryDocument(path: string): string {
  return readBoundedRegularFile(path, {
    maxBytes: maximumMemoryDocumentBytes,
    subject: 'Memory document',
  }).content;
}

export function memoryDocumentPath(
  root: string,
  input: string,
  entries: readonly ManagedMemoryEntry[] = managedMemoryEntries(root),
): string {
  const name = input.replace(/^memory:/, '');
  if (!name || isAbsolute(name)) throw new Error(`Invalid memory document path: ${input}`);
  const requestedPath = resolve(root, name.endsWith('.md') ? name : `${name}.md`);
  if (requestedPath === root || !isInside(root, requestedPath))
    throw new Error(`Memory document escapes root: ${input}`);
  if (isExcludedMemoryArtifact(root, requestedPath)) {
    throw new Error(`Memory document is inside an excluded artifact subtree: ${input}`);
  }
  assertSafePath(root, requestedPath);
  const referenceName = name.endsWith('.md') ? name.slice(0, -3) : name;
  const requestedIdentity = posix
    .normalize(referenceName)
    .replace(/^\.\//, '')
    .normalize('NFC')
    .toLowerCase();
  const matches = entries.filter(
    (entry) =>
      entry.kind === 'file' &&
      extname(entry.path) === '.md' &&
      memoryReference(root, entry.path).normalize('NFC').toLowerCase() === requestedIdentity,
  );
  if (matches.length === 0) {
    throw new Error(`Memory document does not exist: ${input}`);
  }
  const exactMatches = matches.filter(
    (entry) => memoryReference(root, entry.path) === referenceName,
  );
  if (matches.length > 1 && exactMatches.length !== 1) {
    throw new Error(`Memory document reference is ambiguous: ${input}`);
  }
  const path = (exactMatches[0] ?? matches[0]).path;
  assertSafePath(root, path);
  const canonicalRoot = realpathSync.native(root);
  const canonicalReference = memoryReference(canonicalRoot, realpathSync.native(path));
  if (name !== canonicalReference && name !== `${canonicalReference}.md`) {
    throw new MemoryPathError(
      `Memory document reference is not canonical: ${input}`,
      'non-canonical-reference',
    );
  }
  return path;
}

export function memoryReference(root: string, path: string): string {
  return relative(root, path).split(sep).join('/').replace(/\.md$/, '');
}
