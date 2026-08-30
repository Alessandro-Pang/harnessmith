import type { Runtime } from '../types.js';
import { readBoundedRegularFile } from './bounded-file.js';
import {
  boundedLine,
  positiveInteger,
  type SearchMode,
  type SearchOptions,
  type SearchReport,
  type SearchRetrieval,
  type SearchSource,
  searchText,
} from './search.js';
import { type SearchBackendResult, searchBackend } from './search-backend.js';
import {
  fileKey,
  type LoadedIndex,
  SearchIndexUnavailable,
  searchScopeHash,
} from './search-index-contract.js';
import { loadCurrentIndex, refreshSearchIndex } from './search-index-store.js';
import { tokenizeSearchText } from './search-tokenizer.js';
import { assertNoHighConfidenceSecret } from './secret-hygiene.js';

export { searchIndexPath } from './search-index-contract.js';

function deterministicResults(results: SearchBackendResult[]): SearchBackendResult[] {
  return results.sort(
    (left, right) =>
      right.score - left.score ||
      left.sourceIndex - right.sourceIndex ||
      left.path.localeCompare(right.path) ||
      left.lineStart - right.lineStart ||
      String(left.id).localeCompare(String(right.id)),
  );
}

export function queryLoadedIndex(
  query: string,
  sources: SearchSource[],
  loaded: LoadedIndex,
  options: SearchOptions,
): SearchReport {
  const limit = positiveInteger(options.limit, 50, 'Search limit');
  const maxLineLength = positiveInteger(options.maxLineLength, 400, 'Search line limit');
  const stats = {
    ...loaded.discovery.stats,
    skippedByReason: { ...loaded.discovery.stats.skippedByReason },
  };
  const currentByKey = new Map(loaded.currentFiles.map((file) => [fileKey(file), file]));
  const indexedByKey = new Map(loaded.snapshot.files.map((file) => [fileKey(file), file]));
  const results = deterministicResults(searchBackend(loaded.backend, query));
  const contents = new Map<string, string[]>();
  const matches = results.slice(0, limit).map((result) => {
    const key = `${result.sourceIndex}:${result.path}`;
    const current = currentByKey.get(key);
    const indexed = indexedByKey.get(key);
    if (!current || !indexed) {
      throw new SearchIndexUnavailable('stale', 'An indexed search result lost its source');
    }
    let lines = contents.get(key);
    if (!lines) {
      if (current.size > loaded.discovery.limits.maxTotalBytes - stats.bytesRead) {
        throw new SearchIndexUnavailable(
          'stale',
          'Indexed snippets exceeded the search byte budget',
        );
      }
      let read: ReturnType<typeof readBoundedRegularFile>;
      try {
        read = readBoundedRegularFile(current.absolutePath, {
          maxBytes: loaded.discovery.limits.maxFileBytes,
          subject: 'Indexed search source',
        });
      } catch {
        throw new SearchIndexUnavailable('stale', 'An indexed search source changed');
      }
      if (
        read.identity.dev !== indexed.dev ||
        read.identity.ino !== indexed.ino ||
        read.identity.size !== indexed.size ||
        read.identity.mtimeMs !== indexed.mtimeMs ||
        read.identity.ctimeMs !== indexed.ctimeMs
      ) {
        throw new SearchIndexUnavailable('stale', 'An indexed search source changed');
      }
      stats.filesRead += 1;
      stats.bytesRead += read.bytes;
      lines = read.content.split(/\r?\n/u);
      contents.set(key, lines);
    }
    const section = lines.slice(result.lineStart - 1, result.lineEnd);
    const matchedTerms = new Set(result.terms);
    const sectionLine = section.findIndex((line) =>
      tokenizeSearchText(line).some((term) => matchedTerms.has(term)),
    );
    const globalLine =
      sectionLine >= 0
        ? result.lineStart - 1 + sectionLine
        : lines.findIndex((line) =>
            tokenizeSearchText(line).some((term) => matchedTerms.has(term)),
          );
    const lineIndex = globalLine >= 0 ? globalLine : result.lineStart - 1;
    const bounded = boundedLine(lines[lineIndex] || '', maxLineLength);
    return {
      source: sources[result.sourceIndex].label,
      trust: sources[result.sourceIndex].trust,
      path: current.absolutePath,
      line: lineIndex + 1,
      text: bounded.text,
      truncated: bounded.truncated,
      score: result.score,
      matchedFields: [...new Set(Object.values(result.match).flat())].sort(),
    };
  });
  return {
    version: 1,
    query,
    limit,
    maxLineLength,
    truncated: results.length > limit,
    scanTruncated: false,
    scanLimits: loaded.discovery.limits,
    scanStats: stats,
    skipped: loaded.discovery.skipped,
    matches,
  };
}

function retrieval(
  requestedMode: SearchMode,
  usedMode: 'scan' | 'fulltext',
  indexStatus: SearchRetrieval['indexStatus'],
  scopeHash: string,
  fallbackReason?: string,
): SearchRetrieval {
  return {
    requestedMode,
    usedMode,
    indexStatus,
    scopeHash,
    ...(fallbackReason ? { fallbackReason } : {}),
  };
}

export function searchWithIndex(
  runtime: Runtime,
  query: string,
  sources: SearchSource[],
  options: SearchOptions = {},
): SearchReport {
  assertNoHighConfidenceSecret([query], 'Search query');
  const mode = options.mode || 'auto';
  const scopeHash = searchScopeHash(sources);
  if (mode === 'scan') {
    if (options.refreshIndex)
      throw new Error('--refresh-index cannot be combined with --mode scan');
    const report = searchText(query, sources, options);
    report.retrieval = retrieval(mode, 'scan', 'not-requested', scopeHash);
    return report;
  }
  if (options.refreshIndex) refreshSearchIndex(runtime, sources, options);
  try {
    const loaded = loadCurrentIndex(runtime, sources, options);
    const report = queryLoadedIndex(query, sources, loaded, options);
    report.retrieval = retrieval(
      mode,
      'fulltext',
      options.refreshIndex ? 'refreshed' : 'ready',
      scopeHash,
    );
    return report;
  } catch (error) {
    const unavailable =
      error instanceof SearchIndexUnavailable
        ? error
        : new SearchIndexUnavailable('corrupt', 'Search index query failed');
    if (mode === 'fulltext' || options.refreshIndex) {
      throw new Error(
        `Full-text search index is ${unavailable.status}; rerun with --refresh-index`,
        { cause: unavailable },
      );
    }
    const report = searchText(query, sources, options);
    report.retrieval = retrieval(mode, 'scan', unavailable.status, scopeHash, unavailable.message);
    return report;
  }
}
