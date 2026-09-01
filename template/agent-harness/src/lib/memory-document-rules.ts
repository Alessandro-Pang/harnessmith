import { resolve } from 'node:path';
import type { Io } from '../types.js';
import {
  type MemoryRootKind,
  validateAutopilotDocumentRules,
} from './memory-autopilot-document-rules.js';
import { validateDocumentPurpose } from './memory-document-purpose.js';
import { validateInputDocumentRules } from './memory-input-document-rules.js';
import { containsUnsafeDisplayCharacters } from './memory-root-path-rules.js';
import { validateTaskLedgerMemory } from './task-ledger-memory.js';
import {
  isCanonicalUserProfileRecord,
  maximumUserProfileRecords,
  parseUserProfileRecords,
} from './user-profile-record.js';

const requiredMetadata = [
  'title',
  'description',
  'type',
  'memory-kind',
  'status',
  'owners',
  'created',
  'updated',
  'project',
  'tags',
  'scope',
  'source-refs',
  'source-of-truth',
  'schema-version',
] as const;
const memoryKinds = new Set(['input', 'episode', 'working', 'distilled', 'evidence', 'index']);
const memoryStatuses = new Set(['active', 'blocked', 'complete', 'superseded', 'archived']);
const arrayMetadata = ['owners', 'tags', 'scope', 'source-refs'] as const;
const stringMetadata = ['title', 'description', 'type', 'project'] as const;

function isMemoryReference(value: unknown): value is string {
  return (
    typeof value === 'string' && value.startsWith('memory:') && value.length > 'memory:'.length
  );
}

function validateLifecycleReference(
  path: string,
  field: 'derived-from' | 'supersedes' | 'superseded-by',
  value: unknown,
  io: Io,
): number {
  const valid =
    field === 'superseded-by'
      ? isMemoryReference(value)
      : isMemoryReference(value) ||
        (Array.isArray(value) && value.length > 0 && value.every(isMemoryReference));
  if (valid) return 0;
  io.error(
    `Memory metadata ${field} must be ${
      field === 'superseded-by' ? 'a single ' : ''
    }canonical memory reference${field === 'superseded-by' ? '' : ' string or string array'}: ${path}`,
  );
  return 1;
}

function validCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateMetadata(path: string, metadata: Map<string, unknown>, io: Io): number {
  let failures = 0;
  for (const field of requiredMetadata) {
    if (!metadata.has(field)) {
      io.error(`Missing memory metadata ${field}: ${path}`);
      failures += 1;
    }
  }
  for (const field of stringMetadata) {
    const value = metadata.get(field);
    if (metadata.has(field) && (typeof value !== 'string' || !value.trim())) {
      io.error(`Memory metadata ${field} must be a non-empty string: ${path}`);
      failures += 1;
    }
  }
  const title = metadata.get('title');
  if (typeof title === 'string' && containsUnsafeDisplayCharacters(title)) {
    io.error(`Memory metadata title must be a single safe display line: ${path}`);
    failures += 1;
  }
  for (const field of arrayMetadata) {
    const value = metadata.get(field);
    if (
      metadata.has(field) &&
      (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    ) {
      io.error(`Memory metadata ${field} must be an array of strings: ${path}`);
      failures += 1;
    }
  }
  if (metadata.has('memory-kind') && !memoryKinds.has(String(metadata.get('memory-kind')))) {
    io.error(`Invalid memory kind: ${path}`);
    failures += 1;
  }
  if (metadata.has('status') && !memoryStatuses.has(String(metadata.get('status')))) {
    io.error(`Invalid memory status: ${path}`);
    failures += 1;
  }
  if (metadata.get('source-of-truth') !== false) {
    io.error(`Memory must declare source-of-truth: false: ${path}`);
    failures += 1;
  }
  if (metadata.get('schema-version') !== 1) {
    io.error(`Unsupported memory schema: ${path}`);
    failures += 1;
  }
  return failures;
}

function validateLifecycle(path: string, metadata: Map<string, unknown>, io: Io): number {
  let failures = 0;
  for (const field of ['created', 'updated'] as const) {
    if (!validCalendarDate(metadata.get(field))) {
      io.error(`Invalid ${field} date: ${path}`);
      failures += 1;
    }
  }
  const created = metadata.get('created');
  const updated = metadata.get('updated');
  if (validCalendarDate(created) && validCalendarDate(updated) && updated < created) {
    io.error(`Memory updated date precedes created date: ${path}`);
    failures += 1;
  }
  failures += validateInputDocumentRules(path, metadata, io);
  if (metadata.get('status') === 'superseded' && !metadata.has('superseded-by')) {
    io.error(`Superseded memory requires superseded-by: ${path}`);
    failures += 1;
  }
  for (const field of ['derived-from', 'supersedes', 'superseded-by'] as const) {
    if (metadata.has(field)) {
      failures += validateLifecycleReference(path, field, metadata.get(field), io);
    }
  }
  if (metadata.get('memory-kind') === 'working' && !metadata.has('expires')) {
    io.error(`WARNING Working memory should declare expires: ${path}`);
  }
  if (metadata.has('expires') && !validCalendarDate(metadata.get('expires'))) {
    io.error(`Invalid expires date: ${path}`);
    failures += 1;
  }
  return failures;
}

function validateUserProfile(
  root: string,
  path: string,
  body: string,
  metadata: Map<string, unknown>,
  rootKind: MemoryRootKind,
  io: Io,
): number {
  let failures = 0;
  const canonicalProfile = resolve(root, 'profile.md');
  if (rootKind === 'project') {
    if (path === canonicalProfile || metadata.get('type') === 'user-profile') {
      io.error(`User profile is permitted only in global memory: ${path}`);
      failures += 1;
    }
    return failures;
  }
  if (path === canonicalProfile && metadata.get('type') !== 'user-profile') {
    io.error(`profile.md must declare type user-profile: ${path}`);
    failures += 1;
  }
  if (metadata.get('type') !== 'user-profile') return failures;
  if (path !== canonicalProfile) {
    io.error(`User profile must be stored at profile.md: ${path}`);
    failures += 1;
  }
  if (metadata.get('memory-kind') !== 'distilled' || metadata.get('project') !== 'global') {
    io.error(`User profile must be global distilled memory: ${path}`);
    failures += 1;
  }
  const autopilot = metadata.get('profile-autopilot');
  if (autopilot !== undefined && autopilot !== 'enabled' && autopilot !== 'paused') {
    io.error(`Invalid user-profile autopilot state: ${path}`);
    failures += 1;
  }
  const records = parseUserProfileRecords(body);
  if (records.length > maximumUserProfileRecords) {
    io.error(`User profile permits at most 32 active entries: ${path}`);
    failures += 1;
  }
  const keys = new Set<string>();
  for (const record of records) {
    if (!record.canonicalMarker) {
      io.error(`Non-canonical user-profile entry: ${path}: ${record.line}`);
      failures += 1;
    } else if (!isCanonicalUserProfileRecord(record)) {
      io.error(`Invalid user-profile entry: ${path}: ${record.line}`);
      failures += 1;
    }
    if (record.key) {
      if (keys.has(record.key)) {
        io.error(`Duplicate user-profile key ${record.key}: ${path}`);
        failures += 1;
      }
      keys.add(record.key);
    }
  }
  return failures;
}

export function validateMemoryDocumentRules(
  root: string,
  path: string,
  content: string,
  body: string,
  metadata: Map<string, unknown>,
  io: Io,
  rootKind: MemoryRootKind = 'auto',
): number {
  let failures = validateMetadata(path, metadata, io);
  failures += validateLifecycle(path, metadata, io);
  failures += validateUserProfile(root, path, body, metadata, rootKind, io);
  failures += validateTaskLedgerMemory(root, path, metadata, io);
  failures += validateAutopilotDocumentRules(root, path, content, body, metadata, rootKind, io);
  for (const diagnostic of validateDocumentPurpose(metadata)) {
    io.error(
      `${diagnostic.severity === 'warning' ? 'WARNING ' : ''}Memory document purpose ${diagnostic.code}: ${path}`,
    );
    if (diagnostic.severity === 'error') failures += 1;
  }
  return failures;
}
