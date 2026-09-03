import type { Io } from '../../types.js';
import { containsUnsafeDisplayCharacters } from './memory-root-path-rules.js';

const inputSources = new Set(['chat', 'file', 'meeting', 'link', 'other']);
const inputPurposes = new Set([
  'constraint',
  'acceptance',
  'source',
  'risk-decision',
  'explicit-retain',
]);
const inputRetentions = new Set(['workstream', 'durable']);
const inputCloseReasons = new Set(['consumed', 'workstream-complete', 'promoted', 'invalid']);

function validCalendarDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validatePolicy(path: string, metadata: Map<string, unknown>, io: Io): number {
  let failures = 0;
  if (!inputPurposes.has(String(metadata.get('input-purpose')))) {
    io.error(`Input schema v2 requires a valid input-purpose: ${path}`);
    failures += 1;
  }
  const retention = String(metadata.get('retention') || '');
  if (!inputRetentions.has(retention)) {
    io.error(`Input schema v2 requires a valid retention policy: ${path}`);
    failures += 1;
  }
  const workstream = metadata.get('workstream');
  if (
    retention === 'workstream' &&
    (typeof workstream !== 'string' ||
      !workstream.trim() ||
      containsUnsafeDisplayCharacters(workstream))
  ) {
    io.error(`Input workstream is required for workstream retention: ${path}`);
    failures += 1;
  }
  if (retention === 'durable' && workstream !== undefined) {
    io.error(`Durable input must not declare a workstream: ${path}`);
    failures += 1;
  }
  return failures;
}

function validateClosure(path: string, metadata: Map<string, unknown>, io: Io): number {
  if (metadata.get('status') !== 'complete') return 0;
  let failures = 0;
  if (!validCalendarDate(metadata.get('closed'))) {
    io.error(`Completed input schema v2 requires a closed date: ${path}`);
    failures += 1;
  }
  if (!inputCloseReasons.has(String(metadata.get('close-reason')))) {
    io.error(`Completed input schema v2 requires a valid close-reason: ${path}`);
    failures += 1;
  }
  return failures;
}

export function validateInputDocumentRules(
  path: string,
  metadata: Map<string, unknown>,
  io: Io,
): number {
  if (metadata.get('memory-kind') !== 'input') return 0;
  let failures = 0;
  if (!inputSources.has(String(metadata.get('input-source')))) {
    io.error(`Input memory requires a valid input-source: ${path}`);
    failures += 1;
  }
  if (typeof metadata.get('verbatim') !== 'boolean') {
    io.error(`Input memory requires boolean verbatim metadata: ${path}`);
    failures += 1;
  }
  const inputSchemaVersion = metadata.get('input-schema-version');
  if (inputSchemaVersion !== undefined && inputSchemaVersion !== 2) {
    io.error(`Unsupported input schema version: ${path}`);
    failures += 1;
  }
  if (inputSchemaVersion !== 2) return failures;
  failures += validatePolicy(path, metadata, io);
  failures += validateClosure(path, metadata, io);
  const consumedBy = metadata.get('consumed-by');
  if (
    consumedBy !== undefined &&
    (typeof consumedBy !== 'string' ||
      !consumedBy.trim() ||
      containsUnsafeDisplayCharacters(consumedBy))
  ) {
    io.error(`Input consumed-by must be a non-empty safe display line: ${path}`);
    failures += 1;
  }
  return failures;
}
