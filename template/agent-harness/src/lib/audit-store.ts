import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Runtime } from '../types.js';
import { type AuditEvent, validateStoredAuditEvent } from './audit-model.js';
import { readBoundedRegularFile } from './bounded-file.js';
import { withExclusiveDirectoryLock } from './exclusive-lock.js';
import { atomicWrite } from './files.js';
import { assertSafePath } from './safe-path.js';

const maximumAuditFileBytes = 4 * 1024 * 1024;
const maximumAuditAggregateBytes = 64 * 1024 * 1024;
const maximumAuditEvents = 50_000;
const auditFilePattern = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

export function auditRoot(runtime: Runtime): string {
  return join(runtime.installedHarness, 'state', 'audit');
}

function eventPath(runtime: Runtime, event: AuditEvent): string {
  return join(auditRoot(runtime), `${event.timestamp.slice(0, 10)}.jsonl`);
}

export function appendAuditEvent(runtime: Runtime, event: AuditEvent): string {
  const root = auditRoot(runtime);
  const path = eventPath(runtime, event);
  assertSafePath(runtime.installedHarness, root);
  assertSafePath(root, path);
  return withExclusiveDirectoryLock(root, 'Audit log', () => {
    assertSafePath(runtime.installedHarness, root);
    assertSafePath(root, path);
    const existing = existsSync(path)
      ? readBoundedRegularFile(path, {
          maxBytes: maximumAuditFileBytes,
          subject: 'Audit log file',
        }).content
      : '';
    const line = `${JSON.stringify(event)}\n`;
    const lineBytes = Buffer.byteLength(line);
    if (Buffer.byteLength(existing) + lineBytes > maximumAuditFileBytes) {
      throw new Error(`Audit log file exceeds ${maximumAuditFileBytes} bytes: ${path}`);
    }
    const files = auditFiles(runtime);
    const aggregateBytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
    if (aggregateBytes + lineBytes > maximumAuditAggregateBytes) {
      throw new Error(`Audit aggregate byte budget exceeds ${maximumAuditAggregateBytes}`);
    }
    if (readAuditEvents(runtime).length >= maximumAuditEvents) {
      throw new Error(`Audit event budget exceeds ${maximumAuditEvents}`);
    }
    atomicWrite(path, `${existing}${line}`, 0o600);
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

export function archiveAuditEvents(
  runtime: Runtime,
  before: string,
  apply: boolean,
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
    for (const [index, path] of files.entries()) {
      assertSafePath(root, path);
      assertSafePath(root, destinations[index]);
      renameSync(path, destinations[index]);
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
