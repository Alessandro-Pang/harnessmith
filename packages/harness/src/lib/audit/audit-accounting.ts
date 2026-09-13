import { existsSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Runtime } from '../../types.js';
import { readBoundedRegularFile } from '../filesystem/bounded-file.js';
import { atomicWrite } from '../filesystem/files.js';
import { assertSafePath } from '../filesystem/safe-path.js';

export const auditIndexFileName = '.index.json';
const maximumAuditIndexBytes = 1024 * 1024;
const maximumAuditFileBytes = 4 * 1024 * 1024;
const maximumAuditAggregateBytes = 64 * 1024 * 1024;
const maximumAuditEvents = 50_000;

export interface AuditIndexFile {
  bytes: number;
  eventCount: number;
}

export interface AuditIndex {
  version: 1;
  files: Record<string, AuditIndexFile>;
  totalBytes: number;
  eventCount: number;
}

type ParseAuditLine = (path: string, line: string) => unknown;
type AuditFiles = (runtime: Runtime) => string[];

function auditIndexPath(runtime: Runtime): string {
  return join(runtime.stateRoot, 'audit', auditIndexFileName);
}

function emptyAuditIndex(): AuditIndex {
  return { version: 1, files: {}, totalBytes: 0, eventCount: 0 };
}

export function buildAuditIndex(
  runtime: Runtime,
  auditFiles: AuditFiles,
  parseAuditLine: ParseAuditLine,
): AuditIndex {
  const index = emptyAuditIndex();
  for (const path of auditFiles(runtime)) {
    const remaining = maximumAuditAggregateBytes - index.totalBytes;
    if (remaining < 1) throw new Error('Audit aggregate byte budget exceeded');
    const file = readBoundedRegularFile(path, {
      maxBytes: Math.min(maximumAuditFileBytes, remaining),
      subject: 'Audit log file',
    });
    if (file.content.length > 0 && !file.content.endsWith('\n')) {
      throw new Error(`Audit log contains incomplete final record: ${path}`);
    }
    const eventCount = file.content
      .split('\n')
      .filter(Boolean)
      .map((line) => parseAuditLine(path, line)).length;
    const name = basename(path);
    index.files[name] = { bytes: file.bytes, eventCount };
    index.totalBytes += file.bytes;
    index.eventCount += eventCount;
    if (index.eventCount > maximumAuditEvents) {
      throw new Error(`Audit event budget exceeds ${maximumAuditEvents}`);
    }
  }
  return index;
}

function validAuditIndex(value: unknown, files: string[]): value is AuditIndex {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AuditIndex>;
  if (candidate.version !== 1 || !candidate.files || typeof candidate.files !== 'object')
    return false;
  if (!Number.isSafeInteger(candidate.totalBytes) || !Number.isSafeInteger(candidate.eventCount))
    return false;
  const names = files.map((path) => basename(path)).sort();
  const indexedNames = Object.keys(candidate.files).sort();
  if (
    names.length !== indexedNames.length ||
    names.some((name, index) => name !== indexedNames[index])
  ) {
    return false;
  }
  let totalBytes = 0;
  let eventCount = 0;
  for (const path of files) {
    const entry = (candidate.files as Record<string, unknown>)[basename(path)];
    if (!entry || typeof entry !== 'object') return false;
    const file = entry as Partial<AuditIndexFile>;
    if (
      typeof file.bytes !== 'number' ||
      !Number.isSafeInteger(file.bytes) ||
      typeof file.eventCount !== 'number' ||
      !Number.isSafeInteger(file.eventCount) ||
      file.bytes < 0 ||
      file.eventCount < 0
    ) {
      return false;
    }
    const bytes = file.bytes;
    const fileEventCount = file.eventCount;
    if (statSync(path).size !== bytes) return false;
    totalBytes += bytes;
    eventCount += fileEventCount;
  }
  return totalBytes === candidate.totalBytes && eventCount === candidate.eventCount;
}

export function loadAuditIndex(
  runtime: Runtime,
  files: string[],
  auditFiles: AuditFiles,
  parseAuditLine: ParseAuditLine,
): AuditIndex {
  const path = auditIndexPath(runtime);
  assertSafePath(join(runtime.stateRoot, 'audit'), path);
  if (!existsSync(path)) return buildAuditIndex(runtime, auditFiles, parseAuditLine);
  try {
    const content = readBoundedRegularFile(path, {
      maxBytes: maximumAuditIndexBytes,
      subject: 'Audit index',
    }).content;
    const value = JSON.parse(content) as unknown;
    return validAuditIndex(value, files)
      ? value
      : buildAuditIndex(runtime, auditFiles, parseAuditLine);
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (error instanceof Error && /Audit index/.test(error.message))
    ) {
      return buildAuditIndex(runtime, auditFiles, parseAuditLine);
    }
    throw error;
  }
}

export function saveAuditIndex(runtime: Runtime, index: AuditIndex): void {
  const path = auditIndexPath(runtime);
  assertSafePath(join(runtime.stateRoot, 'audit'), path);
  atomicWrite(path, `${JSON.stringify(index)}\n`, 0o600);
}
