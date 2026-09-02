import type { AuditEventInput } from '../../lib/audit/audit-model.js';
import {
  summarizeAuditEvents,
  validateAuditEvent,
  validateAuditTraceId,
} from '../../lib/audit/audit-model.js';
import {
  appendAuditEvent,
  archiveAuditEvents,
  auditMaintenanceReport,
  readAuditEvents,
} from '../../lib/audit/audit-store.js';
import { assertRuntimeCanMutate } from '../../runtime.js';
import type { Io, Runtime } from '../../types.js';

interface AuditQueryOptions {
  traceId?: string;
  since?: string;
  limit?: number;
  json?: boolean;
}

function canonicalTimestamp(value: string, subject: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error(`${subject} must be canonical ISO-8601 UTC`);
  }
  return value;
}

function filteredEvents(runtime: Runtime, options: AuditQueryOptions) {
  if (
    options.limit !== undefined &&
    (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 500)
  ) {
    throw new Error('Audit limit must be an integer between 1 and 500');
  }
  if (options.traceId !== undefined) validateAuditTraceId(options.traceId);
  const since =
    options.since === undefined ? undefined : canonicalTimestamp(options.since, 'Audit since');
  const events = readAuditEvents(runtime).filter(
    (event) =>
      (options.traceId === undefined || event.traceId === options.traceId) &&
      (since === undefined || event.timestamp >= since),
  );
  return options.limit === undefined ? events : events.slice(-options.limit);
}

export function recordAuditEvent(
  runtime: Runtime,
  input: AuditEventInput & { json?: boolean },
  io: Io = console,
): number {
  assertRuntimeCanMutate(runtime);
  const { json, ...eventInput } = input;
  const event = validateAuditEvent(eventInput, runtime.hostAdapter);
  const path = appendAuditEvent(runtime, event);
  if (json)
    io.log(JSON.stringify({ version: 1, action: 'recorded', path, traceId: event.traceId }));
  else io.log(`Recorded audit event: ${event.traceId}`);
  return 0;
}

export function listAuditEvents(
  runtime: Runtime,
  options: AuditQueryOptions = {},
  io: Io = console,
): number {
  const events = filteredEvents(runtime, options);
  if (options.json) io.log(JSON.stringify({ version: 1, events }));
  else for (const event of events) io.log(JSON.stringify(event));
  return 0;
}

export function summarizeAudit(
  runtime: Runtime,
  options: AuditQueryOptions = {},
  io: Io = console,
): number {
  const summary = summarizeAuditEvents(filteredEvents(runtime, options));
  if (options.json) io.log(JSON.stringify(summary));
  else {
    io.log(`Audit events: ${summary.eventCount}`);
    io.log(`Audit traces: ${summary.traceCount}`);
  }
  return 0;
}

export function maintainAudit(
  runtime: Runtime,
  { maxAgeDays, json = false }: { maxAgeDays: number; json?: boolean },
  io: Io = console,
): number {
  const report = auditMaintenanceReport(runtime, new Date(), maxAgeDays);
  if (json) io.log(JSON.stringify(report));
  else {
    io.log(`Audit files: ${report.fileCount}`);
    io.log(`Stale audit files: ${report.staleFiles.length}`);
    for (const file of report.staleFiles) io.log(`  ${file}`);
  }
  return report.staleFiles.length === 0 && report.withinBudget ? 0 : 1;
}

export function archiveAudit(
  runtime: Runtime,
  { before, apply = false, json = false }: { before: string; apply?: boolean; json?: boolean },
  io: Io = console,
): number {
  if (apply) assertRuntimeCanMutate(runtime);
  const report = archiveAuditEvents(runtime, before, apply);
  if (json) io.log(JSON.stringify(report));
  else
    io.log(`${apply ? 'Archived' : 'Would archive'} ${report.archivedFiles.length} audit file(s)`);
  return 0;
}
