import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { Io } from '../types.js';
import { parseFrontmatter } from './frontmatter.js';
import { markdownFiles } from './memory-path.js';

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
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:AKIA[0-9A-Z]{16}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/i,
];

function validCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function metadataReferences(metadata: Map<string, unknown>): string[] {
  const values: string[] = [];
  for (const field of ['derived-from', 'supersedes', 'superseded-by']) {
    const value = metadata.get(field);
    if (typeof value === 'string') values.push(value);
    else if (Array.isArray(value)) values.push(...value.filter((item) => typeof item === 'string'));
  }
  return values.filter((value) => value.startsWith('memory:'));
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

export function validateMemoryRoot(root: string, io: Io): void {
  let failures = 0;
  const references = new Set<string>();
  const sessions = new Map<string, string>();
  for (const path of markdownFiles(root)) {
    const content = readFileSync(path, 'utf8');
    let metadata: Map<string, unknown>;
    try {
      metadata = parseFrontmatter(content);
    } catch (error) {
      io.error(`Invalid memory frontmatter: ${path}: ${String(error)}`);
      failures += 1;
      continue;
    }
    failures += validateMetadata(path, metadata, io);
    failures += validateLifecycle(path, metadata, io);
    const sessionId = metadata.get('session-id');
    if (typeof sessionId === 'string' && sessionId) {
      const existing = sessions.get(sessionId);
      if (existing) {
        io.error(`Duplicate session-id ${sessionId}: ${existing} and ${path}`);
        failures += 1;
      } else sessions.set(sessionId, path);
    }
    if (secretPatterns.some((pattern) => pattern.test(content))) {
      io.error(`Memory contains high-confidence secret material: ${path}`);
      failures += 1;
    }
    for (const match of content.matchAll(/memory:([A-Za-z0-9_./-]+)/g)) references.add(match[1]);
    for (const reference of metadataReferences(metadata))
      references.add(reference.slice('memory:'.length));
  }
  for (const name of references) {
    const direct = resolve(root, name);
    if (direct !== root && !direct.startsWith(`${root}${sep}`)) {
      io.error(`Memory reference escapes root: memory:${name}`);
      failures += 1;
    } else if (!existsSync(direct) && !existsSync(`${direct}.md`)) {
      io.error(`Broken memory reference: memory:${name}`);
      failures += 1;
    }
  }
  if (failures > 0) throw new Error(`Memory check failed: ${failures} issue(s)`);
  io.log(`Memory check passed: ${root}`);
}
