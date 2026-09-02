import { createHash } from 'node:crypto';
import MiniSearch, { type AsPlainObject, type Options, type SearchResult } from 'minisearch';
import type { SearchChunk } from './search-chunks.js';
import {
  fuzzyDistance,
  prefixTerm,
  searchAnalyzerVersion,
  tokenizeSearchText,
  tokenizeTechnicalSearchText,
} from './search-tokenizer.js';

export const searchBackendName = 'minisearch';
export const searchBackendVersion = '7.2.0';

export interface SearchIndexDocument extends SearchChunk {
  sourceIndex: number;
}

export interface SearchBackendResult extends SearchResult {
  sourceIndex: number;
  path: string;
  lineStart: number;
  lineEnd: number;
}

export type SearchBackend = MiniSearch<SearchIndexDocument>;

const indexedFields = ['aliases', 'title', 'headings', 'path', 'body'];
const storedFields = ['sourceIndex', 'path', 'lineStart', 'lineEnd'];
const fieldBoosts = { aliases: 10, title: 8, headings: 5, path: 2, body: 1 };

function backendOptions(): Options<SearchIndexDocument> {
  return {
    fields: indexedFields,
    storeFields: storedFields,
    idField: 'id',
    tokenize: tokenizeSearchText,
    processTerm: (term) => term,
    autoVacuum: false,
  };
}

export const searchPolicyDigest = createHash('sha256')
  .update(
    JSON.stringify({
      version: 2,
      analyzer: searchAnalyzerVersion,
      queryTokenizer: 'technical-identifiers-preserve-whole-token',
      fields: indexedFields,
      storedFields,
      fieldBoosts,
      fuzzy: 'nontechnical-query-latin-alphanumeric-length>=5-distance=1',
      prefix: 'technical-query-disabled;last-term-latin>=3-han>=2',
      weights: { fuzzy: 0.35, prefix: 0.7 },
      combineWith: 'OR',
    }),
  )
  .digest('hex');

export function createSearchBackend(): SearchBackend {
  return new MiniSearch<SearchIndexDocument>(backendOptions());
}

export function loadSearchBackend(serialized: unknown): SearchBackend {
  return MiniSearch.loadJS<SearchIndexDocument>(serialized as AsPlainObject, backendOptions());
}

export function serializeSearchBackend(backend: SearchBackend): AsPlainObject {
  return backend.toJSON();
}

export function validateSearchBackendDocuments(
  backend: SearchBackend,
  documentIds: string[],
): void {
  const uniqueIds = new Set(documentIds);
  if (
    uniqueIds.size !== documentIds.length ||
    backend.documentCount !== uniqueIds.size ||
    [...uniqueIds].some((id) => !backend.has(id))
  ) {
    throw new Error('Search backend document inventory does not match its manifest');
  }
}

export function searchBackend(backend: SearchBackend, query: string): SearchBackendResult[] {
  const technicalQuery = /[_.\-/$]/u.test(query) || /\p{Ll}\p{Lu}/u.test(query);
  return backend.search(query, {
    boost: fieldBoosts,
    tokenize: technicalQuery ? tokenizeTechnicalSearchText : tokenizeSearchText,
    prefix: technicalQuery ? false : prefixTerm,
    fuzzy: technicalQuery ? false : (term) => fuzzyDistance(term),
    maxFuzzy: 1,
    weights: { fuzzy: 0.35, prefix: 0.7 },
    combineWith: 'OR',
  }) as SearchBackendResult[];
}
