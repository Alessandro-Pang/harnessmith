import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Runtime } from '../../types.js';
import { readBoundedRegularFile } from '../filesystem/bounded-file.js';
import { withExclusiveDirectoryLock } from '../filesystem/exclusive-lock.js';
import { assertSafePath } from '../filesystem/safe-path.js';
import { buildAuditIndex, loadAuditIndex, saveAuditIndex } from './audit-accounting.js';
import { appendAuditLine, recoverIncompleteAuditTails } from './audit-durability.js';
import { type AuditEvent, validateStoredAuditEvent } from './audit-model.js';

const maximumAuditFileBytes = 4 * 1024 * 1024;
const maximumAuditAggregateBytes = 64 * 1024 * 1024;
const maximumAuditEvents = 50_000;
const auditFilePattern = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

export function auditRoot(runtime: Runtime): string {
  return join(runtime.stateRoot, 'audit');
}

function eventPath(runtime: Runtime, event: AuditEvent): string {
  return join(auditRoot(runtime), `${event.timestamp.slice(0, 10)}.jsonl`);
}

export function appendAuditEvent(runtime: Runtime, event: AuditEvent): string {
  const root = auditRoot(runtime);
  const path = eventPath(runtime, event);
  assertSafePath(dirname(runtime.stateRoot), root);
  assertSafePath(root, path);
  return withExclusiveDirectoryLock(root, 'Audit log', () => {
    assertSafePath(dirname(runtime.stateRoot), root);
    assertSafePath(root, path);
    recoverIncompleteAuditTails(auditFiles(runtime));
    const files = auditFiles(runtime);
    const index = loadAuditIndex(runtime, files, auditFiles, parseAuditLine);
    const name = basename(path);
    const existing = index.files[name] ?? { bytes: 0, eventCount: 0 };
    const line = `${JSON.stringify(event)}\n`;
    const lineBytes = Buffer.byteLength(line);
    if (existing.bytes + lineBytes > maximumAuditFileBytes) {
      throw new Error(`Audit log file exceeds ${maximumAuditFileBytes} bytes: ${path}`);
    }
    if (index.totalBytes + lineBytes > maximumAuditAggregateBytes) {
      throw new Error(`Audit aggregate byte budget exceeds ${maximumAuditAggregateBytes}`);
    }
    if (index.eventCount >= maximumAuditEvents) {
      throw new Error(`Audit event budget exceeds ${maximumAuditEvents}`);
    }
    appendAuditLine(path, line);
    chmodSync(path, 0o600);
    saveAuditIndex(runtime, {
      version: 1,
      files: {
        ...index.files,
        [name]: { bytes: existing.bytes + lineBytes, eventCount: existing.eventCount + 1 },
      },
      totalBytes: index.totalBytes + lineBytes,
      eventCount: index.eventCount + 1,
    });
    return path;
  });
}

function auditFiles(runtime: Runtime): string[] {
  const root = auditRoot(runtime);
  if (!existsSync(root)) return [];
  const rootEntry = lstatSync(root);
  if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink())
    throw new Error(`Audit root must be a regular non-symlink directory: ${root}`);
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => auditFilePattern.test(entry.name))
    .map((entry) => {
      const path = join(root, entry.name);
      if (!entry.isFile() || entry.isSymbolicLink())
        throw new Error(`Audit entry must be a regular file: ${path}`);
      assertSafePath(root, path);
      return path;
    })
    .sort();
}

export interface AuditMaintenanceReport {
  version: 1;
  fileCount: number;
  eventCount: number;
  totalBytes: number;
  staleFiles: string[];
  withinBudget: boolean;
}

export function auditMaintenanceReport(
  runtime: Runtime,
  now: Date,
  maxAgeDays: number,
): AuditMaintenanceReport {
  if (!Number.isInteger(maxAgeDays) || maxAgeDays < 1 || maxAgeDays > 3650) {
    throw new Error(`Invalid audit max age days: ${maxAgeDays}`);
  }
  const files = auditFiles(runtime);
  const cutoff = new Date(now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const totalBytes = files.reduce((sum, path) => sum + statSync(path).size, 0);
  const eventCount = readAuditEvents(runtime).length;
  return {
    version: 1,
    fileCount: files.length,
    eventCount,
    totalBytes,
    staleFiles: files.filter((path) => path.slice(-16, -6) < cutoff).map((path) => path.slice(-16)),
    withinBudget: totalBytes <= maximumAuditAggregateBytes && eventCount <= maximumAuditEvents,
  };
}

function assertCalendarDate(value: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value
  ) {
    throw new Error('Audit archive boundary must be a calendar date');
  }
}

function archiveCandidates(runtime: Runtime, before: string): string[] {
  return auditFiles(runtime).filter((path) => path.slice(-16, -6) < before);
}

interface AuditArchiveOperations {
  rename: typeof renameSync;
  saveIndex: typeof saveAuditIndex;
}

export function archiveAuditEvents(
  runtime: Runtime,
  before: string,
  apply: boolean,
  operations: AuditArchiveOperations = { rename: renameSync, saveIndex: saveAuditIndex },
): { version: 1; action: 'archived' | 'proposed'; archivedFiles: string[] } {
  assertCalendarDate(before);
  const initial = archiveCandidates(runtime, before);
  const names = initial.map((path) => path.slice(-16));
  if (!apply || names.length === 0) {
    return { version: 1, action: apply ? 'archived' : 'proposed', archivedFiles: names };
  }
  const root = auditRoot(runtime);
  return withExclusiveDirectoryLock(root, 'Audit log', () => {
    const files = archiveCandidates(runtime, before);
    const archiveRoot = join(root, 'archive');
    assertSafePath(root, archiveRoot);
    if (existsSync(archiveRoot)) {
      const entry = lstatSync(archiveRoot);
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new Error(`Audit archive must be a regular non-symlink directory: ${archiveRoot}`);
      }
    } else {
      mkdirSync(archiveRoot, { mode: 0o700 });
    }
    const destinations = files.map((path) => join(archiveRoot, path.slice(-16)));
    for (const destination of destinations) {
      assertSafePath(root, destination);
      if (existsSync(destination))
        throw new Error(`Audit archive destination exists: ${destination}`);
    }
    const moved: Array<{ source: string; destination: string }> = [];
    try {
      for (const [index, path] of files.entries()) {
        const destination = destinations[index];
        if (!destination) throw new Error(`Audit archive destination is missing: ${path}`);
        assertSafePath(root, path);
        assertSafePath(root, destination);
        operations.rename(path, destination);
        moved.push({ source: path, destination });
      }
      operations.saveIndex(runtime, buildAuditIndex(runtime, auditFiles, parseAuditLine));
    } catch (error) {
      const recoveryPaths: string[] = [];
      for (const { source, destination } of moved.reverse()) {
        try {
          operations.rename(destination, source);
        } catch {
          recoveryPaths.push(destination);
        }
      }
      if (recoveryPaths.length > 0) {
        const failure = new Error(
          `Audit archive failed and rollback was incomplete: ${String(error)}; recovery paths: ${recoveryPaths.join(', ')}`,
          { cause: error instanceof Error ? error : undefined },
        ) as Error & { moved: string[]; remaining: string[]; recoveryPaths: string[] };
        failure.moved = recoveryPaths;
        failure.remaining = files;
        failure.recoveryPaths = recoveryPaths;
        throw failure;
      }
      throw error;
    }
    return {
      version: 1,
      action: 'archived',
      archivedFiles: files.map((path) => path.slice(-16)),
    };
  });
}

function parseAuditLine(path: string, line: string): AuditEvent {
  try {
    return validateStoredAuditEvent(JSON.parse(line));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid audit event in ${path}: ${reason}`, { cause: error });
  }
}

export function readAuditEvents(runtime: Runtime): AuditEvent[] {
  let aggregateBytes = 0;
  const events: AuditEvent[] = [];
  for (const path of auditFiles(runtime)) {
    const remaining = maximumAuditAggregateBytes - aggregateBytes;
    if (remaining < 1) throw new Error('Audit aggregate byte budget exceeded');
    const file = readBoundedRegularFile(path, {
      maxBytes: Math.min(maximumAuditFileBytes, remaining),
      subject: 'Audit log file',
    });
    aggregateBytes += file.bytes;
    if (file.content.length > 0 && !file.content.endsWith('\n')) {
      throw new Error(`Audit log contains incomplete final record: ${path}`);
    }
    for (const line of file.content.split('\n').filter(Boolean)) {
      events.push(parseAuditLine(path, line));
      if (events.length > maximumAuditEvents)
        throw new Error(`Audit event budget exceeds ${maximumAuditEvents}`);
    }
  }
  return events.sort(
    (left, right) =>
      left.timestamp.localeCompare(right.timestamp) || left.traceId.localeCompare(right.traceId),
  );
}
