import { dirname } from 'node:path';
import { assertRuntimeCanMutate } from '../runtime.js';
import type { Runtime } from '../types.js';
import { readBoundedRegularFile } from './bounded-file.js';
import { withExclusiveDirectoryLock } from './exclusive-lock.js';
import { atomicWrite } from './files.js';
import type { SearchOptions, SearchSource } from './search.js';
import {
  createSearchBackend,
  loadSearchBackend,
  type SearchBackend,
  type SearchIndexDocument,
  searchBackendName,
  searchBackendVersion,
  searchPolicyDigest,
  serializeSearchBackend,
  validateSearchBackendDocuments,
} from './search-backend.js';
import type { SearchDiscovery } from './search-budget.js';
import { chunkSearchDocument } from './search-chunks.js';
import {
  type CurrentFile,
  discoverIndexSources,
  fileKey,
  type IndexedFile,
  indexFormatVersion,
  type LoadedIndex,
  runtimeIcuVersion,
  resolveIndexMaxChunks,
  type SearchIndexSnapshot,
  SearchIndexUnavailable,
  sameIdentity,
  searchIndexPath,
  searchScopeHash,
  sha256,
} from './search-index-contract.js';
import {
  readSnapshot,
  searchCorpusDigest,
  searchIndexManifest,
  serializeSearchIndexSnapshot,
} from './search-index-snapshot.js';
import { searchAnalyzerVersion } from './search-tokenizer.js';
import { assertNoHighConfidenceSecret } from './secret-hygiene.js';

function readAndChunk(
  current: CurrentFile,
  discovery: SearchDiscovery,
): { file: IndexedFile; documents: SearchIndexDocument[] } {
  if (Date.now() > discovery.deadline) {
    throw new SearchIndexUnavailable('stale', 'Search index refresh exceeded its time budget');
  }
  if (current.size > discovery.limits.maxFileBytes) {
    throw new SearchIndexUnavailable('stale', 'A search source exceeds the per-file byte budget');
  }
  if (current.size > discovery.limits.maxTotalBytes - discovery.stats.bytesRead) {
    throw new SearchIndexUnavailable(
      'stale',
      'Search index refresh exceeded its total byte budget',
    );
  }
  let read: ReturnType<typeof readBoundedRegularFile>;
  try {
    read = readBoundedRegularFile(current.absolutePath, {
      maxBytes: discovery.limits.maxFileBytes,
      subject: 'Search index source',
    });
  } catch {
    throw new SearchIndexUnavailable('stale', 'A search source changed during index refresh');
  }
  if (
    read.identity.dev !== current.dev ||
    read.identity.ino !== current.ino ||
    read.identity.size !== current.size ||
    read.identity.mtimeMs !== current.mtimeMs ||
    read.identity.ctimeMs !== current.ctimeMs
  ) {
    throw new SearchIndexUnavailable('stale', 'A search source changed during index refresh');
  }
  discovery.stats.filesRead += 1;
  discovery.stats.bytesRead += read.bytes;
  assertNoHighConfidenceSecret([current.relativePath, read.content], 'Search index source');
  const chunks = chunkSearchDocument({
    content: read.content,
    relativePath: current.relativePath,
    sourceIndex: current.sourceIndex,
  });
  return {
    file: {
      sourceIndex: current.sourceIndex,
      relativePath: current.relativePath,
      dev: current.dev,
      ino: current.ino,
      size: current.size,
      mtimeMs: current.mtimeMs,
      ctimeMs: current.ctimeMs,
      contentDigest: sha256(read.content),
      chunkIds: chunks.map(({ id }) => id),
    },
    documents: chunks.map((chunk) => ({ ...chunk, sourceIndex: current.sourceIndex })),
  };
}

function compatibleSnapshot(path: string, scopeHash: string): SearchIndexSnapshot | null {
  try {
    return readSnapshot(path, scopeHash);
  } catch {
    return null;
  }
}

function buildOrUpdateIndex(
  path: string,
  scopeHash: string,
  sources: SearchSource[],
  options: SearchOptions,
): void {
  const { discovery, files: current } = discoverIndexSources(sources, options, true);
  const maxChunks = resolveIndexMaxChunks(options);
  let chunkCount = 0;
  const accountForChunks = (count: number): void => {
    chunkCount += count;
    if (chunkCount > maxChunks) {
      throw new SearchIndexUnavailable('stale', 'Search index refresh exceeded its chunk budget');
    }
  };
  let previous = compatibleSnapshot(path, scopeHash);
  let backend: SearchBackend;
  try {
    backend = previous ? loadSearchBackend(previous.index) : createSearchBackend();
    if (previous) {
      validateSearchBackendDocuments(
        backend,
        previous.files.flatMap((file) => file.chunkIds),
      );
    }
  } catch {
    previous = null;
    backend = createSearchBackend();
  }
  if (backend.dirtFactor >= 0.2) {
    previous = null;
    backend = createSearchBackend();
  }
  const incremental = previous !== null && backend.documentCount > 0;
  const reusableFiles = incremental && previous ? previous.files : [];
  const previousFiles = new Map(reusableFiles.map((file) => [fileKey(file), file]));
  const nextFiles: IndexedFile[] = [];
  for (const file of current) {
    const old = previousFiles.get(fileKey(file));
    previousFiles.delete(fileKey(file));
    if (old && sameIdentity(file, old)) {
      accountForChunks(old.chunkIds.length);
      nextFiles.push(old);
      continue;
    }
    const indexed = readAndChunk(file, discovery);
    if (old && indexed.file.contentDigest === old.contentDigest) {
      accountForChunks(old.chunkIds.length);
      nextFiles.push({ ...old, ...indexed.file, chunkIds: old.chunkIds });
      continue;
    }
    accountForChunks(indexed.file.chunkIds.length);
    for (const id of old?.chunkIds || []) backend.discard(id);
    backend.addAll(indexed.documents);
    nextFiles.push(indexed.file);
  }
  for (const removed of previousFiles.values()) {
    for (const id of removed.chunkIds) backend.discard(id);
  }
  const now = new Date().toISOString();
  validateSearchBackendDocuments(
    backend,
    nextFiles.flatMap((file) => file.chunkIds),
  );
  const serializedBackend = serializeSearchBackend(backend);
  const snapshot: SearchIndexSnapshot = {
    formatVersion: indexFormatVersion,
    backend: { name: searchBackendName, version: searchBackendVersion },
    analyzer: { version: searchAnalyzerVersion, icu: runtimeIcuVersion },
    policyDigest: searchPolicyDigest,
    scopeHash,
    builtAt: previous?.builtAt || now,
    updatedAt: now,
    corpusDigest: searchCorpusDigest(nextFiles),
    indexDigest: sha256(JSON.stringify(serializedBackend)),
    files: nextFiles,
    index: serializedBackend,
  };
  atomicWrite(path, serializeSearchIndexSnapshot(snapshot), 0o600);
}

export function refreshSearchIndex(
  runtime: Runtime,
  sources: SearchSource[],
  options: SearchOptions,
): void {
  assertRuntimeCanMutate(runtime);
  const scopeHash = searchScopeHash(sources);
  const path = searchIndexPath(runtime, sources);
  const root = dirname(path);
  withExclusiveDirectoryLock(
    root,
    'Search index',
    () => buildOrUpdateIndex(path, scopeHash, sources, options),
    { cleanupEmptyRootOnFailure: true, directoryMode: 0o700 },
  );
}

export function loadCurrentIndex(
  runtime: Runtime,
  sources: SearchSource[],
  options: SearchOptions,
): LoadedIndex {
  const scopeHash = searchScopeHash(sources);
  const snapshot = readSnapshot(searchIndexPath(runtime, sources), scopeHash);
  const { discovery, files } = discoverIndexSources(sources, options, false);
  const indexedFiles = new Map(snapshot.files.map((file) => [fileKey(file), file]));
  if (files.length !== snapshot.files.length) {
    throw new SearchIndexUnavailable('stale', 'Search source inventory changed');
  }
  for (const file of files) {
    const indexed = indexedFiles.get(fileKey(file));
    if (!indexed || !sameIdentity(file, indexed)) {
      throw new SearchIndexUnavailable('stale', 'Search source identity changed');
    }
  }
  try {
    const backend = loadSearchBackend(snapshot.index);
    validateSearchBackendDocuments(
      backend,
      snapshot.files.flatMap((file) => file.chunkIds),
    );
    return {
      snapshot: searchIndexManifest(snapshot),
      backend,
      discovery,
      currentFiles: files,
    };
  } catch {
    throw new SearchIndexUnavailable('corrupt', 'Search backend cannot be restored');
  }
}
