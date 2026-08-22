import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Parser, type ReadEntry } from 'tar';

const limits = {
  compressedBytes: 256 * 1024 * 1024,
  expandedBytes: 512 * 1024 * 1024,
  fileBytes: 128 * 1024 * 1024,
  totalFileBytes: 384 * 1024 * 1024,
  entries: 20_000,
};

export interface NpmPackageTarball {
  path: string;
  sha256: string;
  files: ReadonlyMap<string, Buffer>;
}

export function releaseArtifactPath(configured?: string, base = process.cwd()): string {
  const candidate = configured ?? process.env.HARNESS_RELEASE_ARTIFACT;
  if (!candidate) {
    throw new Error(
      'Set HARNESS_RELEASE_ARTIFACT or pass --package-artifact with the exact candidate tarball',
    );
  }
  const path = resolve(base, candidate);
  if (!existsSync(path) || !lstatSync(path).isFile()) {
    throw new Error(`Candidate package artifact is not a file: ${path}`);
  }
  return path;
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function safePackagePath(raw: string): string {
  if (!raw || raw.includes('\\') || hasControlCharacters(raw)) {
    throw new Error(`Unsafe npm tarball path: ${raw || '<empty>'}`);
  }
  const parts = raw.replace(/\/+$/, '').split('/');
  if (
    parts[0] !== 'package' ||
    parts.length < 2 ||
    parts.some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`Unsafe npm tarball path: ${raw}`);
  }
  return parts.slice(1).join('/');
}

function parseTar(expanded: Buffer): ReadonlyMap<string, Buffer> {
  const files = new Map<string, Buffer>();
  const entries = new Set<string>();
  let entryCount = 0;
  let totalFileBytes = 0;
  let pendingFiles = 0;

  const countEntry = (): void => {
    entryCount += 1;
    if (entryCount > limits.entries) throw new Error('Npm tarball entry limit exceeded');
  };

  const validateEntry = (entry: ReadEntry): string => {
    countEntry();
    const path = safePackagePath(entry.path);
    if (entries.has(path)) throw new Error(`Duplicate npm tarball entry: ${path}`);
    entries.add(path);
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new Error(`Invalid npm tarball entry size: ${path}`);
    }
    if (entry.size > limits.fileBytes) {
      throw new Error(`Npm tarball file size limit exceeded: ${path}`);
    }
    return path;
  };

  const parser = new Parser({
    strict: true,
    maxMetaEntrySize: limits.fileBytes,
    onReadEntry(entry) {
      const path = validateEntry(entry);
      if (entry.type === 'File' || entry.type === 'OldFile') {
        totalFileBytes += entry.size;
        if (totalFileBytes > limits.totalFileBytes) {
          throw new Error('Npm tarball total file size limit exceeded');
        }
        if (entry.size === 0) {
          files.set(path, Buffer.alloc(0));
          entry.resume();
          return;
        }

        const chunks: Buffer[] = [];
        let contentBytes = 0;
        pendingFiles += 1;
        entry.on('data', (chunk) => {
          const content = Buffer.from(chunk);
          contentBytes += content.length;
          if (contentBytes > entry.size) {
            throw new Error(`Invalid npm tarball entry size: ${path}`);
          }
          chunks.push(content);
        });
        entry.on('end', () => {
          if (contentBytes !== entry.size) {
            throw new Error(`Invalid npm tarball truncated entry: ${path}`);
          }
          files.set(path, Buffer.concat(chunks, contentBytes));
          pendingFiles -= 1;
        });
        return;
      }

      if (entry.type !== 'Directory' || entry.size !== 0) {
        throw new Error(`Unsupported npm tarball entry type ${entry.type}: ${path}`);
      }
      entry.resume();
    },
  });
  parser.on('meta', countEntry);
  parser.on('ignoredEntry', (entry: ReadEntry) => {
    const path = validateEntry(entry);
    throw new Error(`Unsupported npm tarball entry type ${entry.type}: ${path}`);
  });
  parser.end(expanded);
  if (pendingFiles !== 0) throw new Error('Invalid npm tarball unfinished file entries');
  return files;
}

export function readNpmPackageTarball(input: string): NpmPackageTarball {
  const path = resolve(input);
  if (!basename(path).toLowerCase().endsWith('.tgz')) {
    throw new Error(`Candidate package artifact must be an npm .tgz: ${path}`);
  }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Candidate package artifact must be a regular npm .tgz: ${path}`);
  }
  if (stat.size < 1 || stat.size > limits.compressedBytes) {
    throw new Error(`Candidate npm .tgz exceeds the compressed size limit: ${path}`);
  }
  const compressed = readFileSync(path);
  let expanded: Buffer;
  try {
    expanded = gunzipSync(compressed, { maxOutputLength: limits.expandedBytes });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Candidate package artifact is not a valid npm .tgz: ${message}`);
  }
  return {
    path,
    sha256: createHash('sha256').update(compressed).digest('hex'),
    files: parseTar(expanded),
  };
}
