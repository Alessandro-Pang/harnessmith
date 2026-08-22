import { resolve } from 'node:path';
import type { Io } from '../types.js';

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
const inputSources = new Set(['chat', 'file', 'meeting', 'link', 'other']);
const arrayMetadata = ['owners', 'tags', 'scope', 'source-refs'] as const;
const stringMetadata = ['title', 'description', 'type', 'project'] as const;

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
  if (metadata.get('memory-kind') === 'input') {
    if (!inputSources.has(String(metadata.get('input-source')))) {
      io.error(`Input memory requires a valid input-source: ${path}`);
      failures += 1;
    }
    if (typeof metadata.get('verbatim') !== 'boolean') {
      io.error(`Input memory requires boolean verbatim metadata: ${path}`);
      failures += 1;
    }
  }
  if (metadata.get('status') === 'superseded' && !metadata.has('superseded-by')) {
    io.error(`Superseded memory requires superseded-by: ${path}`);
    failures += 1;
  }
  if (metadata.get('memory-kind') === 'working' && !metadata.has('expires')) {
    io.log(`WARNING Working memory should declare expires: ${path}`);
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
  io: Io,
): number {
  let failures = 0;
  const canonicalProfile = resolve(root, 'profile.md');
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
  const entries = body.split(/\r?\n/).filter((line) => line.startsWith('- '));
  if (entries.length > 32) {
    io.error(`User profile permits at most 32 active entries: ${path}`);
    failures += 1;
  }
  const keys = new Set<string>();
  const entryPattern =
    /^- ([a-z0-9]+(?:[.-][a-z0-9]+)*) \| ([^|]{1,200}) \| (explicit|observed|inferred) \| (high|medium|low) \| (\d{4}-\d{2}-\d{2})$/;
  for (const entry of entries) {
    const match = entry.match(entryPattern);
    if (!match || !validCalendarDate(match[5])) {
      io.error(`Invalid user-profile entry: ${path}: ${entry}`);
      failures += 1;
      continue;
    }
    const key = match[1];
    if (keys.has(key)) {
      io.error(`Duplicate user-profile key ${key}: ${path}`);
      failures += 1;
    }
    keys.add(key);
  }
  return failures;
}

export function validateMemoryDocumentRules(
  root: string,
  path: string,
  body: string,
  metadata: Map<string, unknown>,
  io: Io,
): number {
  let failures = validateMetadata(path, metadata, io);
  failures += validateLifecycle(path, metadata, io);
  failures += validateUserProfile(root, path, body, metadata, io);
  return failures;
}
