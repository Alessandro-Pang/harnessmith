import { createHash } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import type { Runtime } from '../types.js';
import { assertSafePath, canonicalPath } from './safe-path.js';
import type { SearchOptions, SearchSource } from './search.js';
import type { SearchBackend } from './search-backend.js';
import { discoverSearchableFiles, type SearchDiscovery } from './search-budget.js';

export const indexFormatVersion = 1;
export const runtimeIcuVersion = process.versions.icu || 'unknown';

const indexRefreshDefaults = {
  maxEntries: 100_000,
  maxDirectories: 20_000,
  maxFiles: 50_000,
  maxTotalBytes: 256 * 1024 * 1024,
  maxDurationMs: 60_000,
};

export interface IndexedFile {
  sourceIndex: number;
  relativePath: string;
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  contentDigest: string;
  chunkIds: string[];
}

export interface SearchIndexSnapshot {
  formatVersion: 1;
  backend: { name: string; version: string };
  analyzer: { version: number; icu: string };
  policyDigest: string;
  scopeHash: string;
  builtAt: string;
  updatedAt: string;
  corpusDigest: string;
  indexDigest: string;
  files: IndexedFile[];
  index: unknown;
}

export type SearchIndexManifest = Omit<SearchIndexSnapshot, 'index'>;

export type IndexFailureStatus = 'missing' | 'stale' | 'corrupt' | 'unsupported';

export class SearchIndexUnavailable extends Error {
  constructor(
    readonly status: IndexFailureStatus,
    message: string,
  ) {
    super(message);
  }
}

export interface CurrentFile {
  sourceIndex: number;
  relativePath: string;
  absolutePath: string;
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}

export interface LoadedIndex {
  snapshot: SearchIndexManifest;
  backend: SearchBackend;
  discovery: SearchDiscovery;
  currentFiles: CurrentFile[];
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function searchScopeHash(sources: SearchSource[]): string {
  return sha256(
    JSON.stringify({
      version: indexFormatVersion,
      sources: sources.map((source) => ({
        root: canonicalPath(source.root),
        label: source.label,
        trust: source.trust,
        excludeDirectories: [...(source.excludeDirectories || [])].sort(),
      })),
    }),
  ).slice(0, 24);
}

export function searchIndexPath(runtime: Runtime, sources: SearchSource[]): string {
  const path = join(
    runtime.installedHarness,
    'state',
    'search',
    searchScopeHash(sources),
    'index-v1.json',
  );
  assertSafePath(runtime.installedHarness, path);
  return path;
}

function candidateRelativePath(source: SearchSource, path: string): string {
  const route = relative(resolve(source.root), resolve(path));
  return (route || basename(path)).replaceAll('\\', '/');
}

function currentFiles(sources: SearchSource[], discovery: SearchDiscovery): CurrentFile[] {
  const result: CurrentFile[] = [];
  for (const candidate of discovery.candidates) {
    let entry: ReturnType<typeof lstatSync>;
    try {
      entry = lstatSync(candidate.path);
    } catch {
      throw new SearchIndexUnavailable('stale', 'A search source changed during index check');
    }
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new SearchIndexUnavailable('stale', 'A search source is no longer a regular file');
    }
    result.push({
      sourceIndex: candidate.sourceIndex,
      relativePath: candidateRelativePath(sources[candidate.sourceIndex], candidate.path),
      absolutePath: resolve(candidate.path),
      dev: entry.dev,
      ino: entry.ino,
      size: entry.size,
      mtimeMs: entry.mtimeMs,
      ctimeMs: entry.ctimeMs,
    });
  }
  return result.sort((left, right) => fileKey(left).localeCompare(fileKey(right)));
}

export function fileKey(file: Pick<IndexedFile, 'sourceIndex' | 'relativePath'>): string {
  return `${file.sourceIndex}:${file.relativePath}`;
}

export function sameIdentity(current: CurrentFile, indexed: IndexedFile): boolean {
  return (
    current.dev === indexed.dev &&
    current.ino === indexed.ino &&
    current.size === indexed.size &&
    current.mtimeMs === indexed.mtimeMs &&
    current.ctimeMs === indexed.ctimeMs
  );
}

function discoveryOptions(options: SearchOptions, refresh: boolean): SearchOptions {
  return {
    ...options,
    maxEntries: options.maxEntries ?? indexRefreshDefaults.maxEntries,
    maxDirectories: options.maxDirectories ?? indexRefreshDefaults.maxDirectories,
    maxFiles: options.maxFiles ?? indexRefreshDefaults.maxFiles,
    maxDurationMs: options.maxDurationMs ?? indexRefreshDefaults.maxDurationMs,
    ...(refresh
      ? { maxTotalBytes: options.maxTotalBytes ?? indexRefreshDefaults.maxTotalBytes }
      : {}),
  };
}

export function discoverIndexSources(
  sources: SearchSource[],
  options: SearchOptions,
  refresh: boolean,
): { discovery: SearchDiscovery; files: CurrentFile[] } {
  const discovery = discoverSearchableFiles(sources, discoveryOptions(options, refresh));
  if (discovery.stats.skipped > 0) {
    throw new SearchIndexUnavailable(
      'stale',
      refresh
        ? 'Search index refresh exceeded its bounded source-discovery budget'
        : 'Search index freshness check was truncated',
    );
  }
  return { discovery, files: currentFiles(sources, discovery) };
}
