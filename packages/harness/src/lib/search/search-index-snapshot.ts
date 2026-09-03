import { existsSync } from 'node:fs';
import { readBoundedRegularFile } from '../filesystem/bounded-file.js';
import { searchBackendName, searchBackendVersion, searchPolicyDigest } from './search-backend.js';
import {
  type IndexedFile,
  indexFormatVersion,
  runtimeIcuVersion,
  type SearchIndexManifest,
  type SearchIndexSnapshot,
  SearchIndexUnavailable,
  sha256,
} from './search-index-contract.js';
import { searchAnalyzerVersion } from './search-tokenizer.js';

const maxSerializedIndexBytes = 128 * 1024 * 1024;

export function searchCorpusDigest(files: IndexedFile[]): string {
  return sha256(
    JSON.stringify(
      files.map((file) => [file.sourceIndex, file.relativePath, file.contentDigest, file.chunkIds]),
    ),
  );
}

function validIndexedFile(value: unknown): value is IndexedFile {
  if (!value || typeof value !== 'object') return false;
  const file = value as Partial<IndexedFile>;
  return (
    Number.isInteger(file.sourceIndex) &&
    typeof file.relativePath === 'string' &&
    ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(
      (field) => typeof file[field as keyof IndexedFile] === 'number',
    ) &&
    typeof file.contentDigest === 'string' &&
    Array.isArray(file.chunkIds) &&
    file.chunkIds.every((id) => typeof id === 'string')
  );
}

function validSnapshot(value: unknown): value is SearchIndexSnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SearchIndexSnapshot>;
  return (
    candidate.formatVersion === indexFormatVersion &&
    typeof candidate.scopeHash === 'string' &&
    typeof candidate.policyDigest === 'string' &&
    typeof candidate.builtAt === 'string' &&
    typeof candidate.updatedAt === 'string' &&
    typeof candidate.corpusDigest === 'string' &&
    typeof candidate.indexDigest === 'string' &&
    Array.isArray(candidate.files) &&
    candidate.files.every(validIndexedFile) &&
    candidate.index !== undefined &&
    Boolean(candidate.backend && typeof candidate.backend === 'object') &&
    Boolean(candidate.analyzer && typeof candidate.analyzer === 'object')
  );
}

export function readSnapshot(path: string, scopeHash: string): SearchIndexSnapshot {
  if (!existsSync(path)) throw new SearchIndexUnavailable('missing', 'Search index is missing');
  let value: unknown;
  try {
    value = JSON.parse(
      readBoundedRegularFile(path, {
        maxBytes: maxSerializedIndexBytes,
        subject: 'Search index',
      }).content,
    );
  } catch {
    throw new SearchIndexUnavailable('corrupt', 'Search index cannot be read');
  }
  if (!validSnapshot(value)) {
    throw new SearchIndexUnavailable('corrupt', 'Search index format is invalid');
  }
  if (
    value.scopeHash !== scopeHash ||
    value.backend.name !== searchBackendName ||
    value.backend.version !== searchBackendVersion ||
    value.analyzer.version !== searchAnalyzerVersion ||
    value.analyzer.icu !== runtimeIcuVersion ||
    value.policyDigest !== searchPolicyDigest
  ) {
    throw new SearchIndexUnavailable('unsupported', 'Search index policy is incompatible');
  }
  if (
    value.corpusDigest !== searchCorpusDigest(value.files) ||
    value.indexDigest !== sha256(JSON.stringify(value.index))
  ) {
    throw new SearchIndexUnavailable('corrupt', 'Search index integrity check failed');
  }
  return value;
}

export function serializeSearchIndexSnapshot(
  snapshot: SearchIndexSnapshot,
  maxBytes = maxSerializedIndexBytes,
): string {
  const serialized = `${JSON.stringify(snapshot)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw new SearchIndexUnavailable('stale', 'Search index exceeds its serialized byte budget');
  }
  return serialized;
}

export function searchIndexManifest(snapshot: SearchIndexSnapshot): SearchIndexManifest {
  const { index: _index, ...manifest } = snapshot;
  return manifest;
}
