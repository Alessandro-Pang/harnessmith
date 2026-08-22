import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { Io } from '../types.js';
import { type FrontmatterResult, parseFrontmatterDocument } from './frontmatter.js';
import { validateMemoryDocumentRules } from './memory-document-rules.js';
import { markdownFiles } from './memory-path.js';
import { containsHighConfidenceSecret, secretTextFiles } from './secret-hygiene.js';

export function contentMemoryReferences(content: string): string[] {
  return [...content.matchAll(/memory:([A-Za-z0-9_./-]+)/g)].map((match) => match[1]);
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

function validateParsedMemoryDocument(
  root: string,
  path: string,
  content: string,
  frontmatter: FrontmatterResult,
  io: Io,
): number {
  let failures = validateMemoryDocumentRules(
    root,
    path,
    frontmatter.body,
    frontmatter.metadata,
    io,
  );
  if (containsHighConfidenceSecret(content)) {
    io.error(`Memory contains high-confidence secret material: ${path}`);
    failures += 1;
  }
  return failures;
}

export function validateMemoryDocument(
  root: string,
  path: string,
  content: string,
  io: Io,
): number {
  let frontmatter: FrontmatterResult;
  try {
    frontmatter = parseFrontmatterDocument(content);
  } catch (error) {
    io.error(`Invalid memory frontmatter: ${path}: ${String(error)}`);
    return 1;
  }
  return validateParsedMemoryDocument(root, path, content, frontmatter, io);
}

export function validateMemoryRoot(
  root: string,
  io: Io,
  {
    quietSuccess = false,
    contentOverrides = new Map(),
  }: { quietSuccess?: boolean; contentOverrides?: Map<string, string> } = {},
): void {
  let failures = 0;
  const references = new Set<string>();
  const sessions = new Map<string, string>();
  for (const path of markdownFiles(root)) {
    const content = contentOverrides.get(path) ?? readFileSync(path, 'utf8');
    let frontmatter: FrontmatterResult;
    try {
      frontmatter = parseFrontmatterDocument(content);
    } catch (error) {
      io.error(`Invalid memory frontmatter: ${path}: ${String(error)}`);
      failures += 1;
      continue;
    }
    failures += validateParsedMemoryDocument(root, path, content, frontmatter, io);
    const sessionId = frontmatter.metadata.get('session-id');
    if (typeof sessionId === 'string' && sessionId) {
      const existing = sessions.get(sessionId);
      if (existing) {
        io.error(`Duplicate session-id ${sessionId}: ${existing} and ${path}`);
        failures += 1;
      } else sessions.set(sessionId, path);
    }
    for (const reference of contentMemoryReferences(content)) references.add(reference);
    for (const reference of metadataReferences(frontmatter.metadata))
      references.add(reference.slice('memory:'.length));
  }
  for (const path of secretTextFiles(root, new Set(markdownFiles(root)))) {
    io.error(`Memory contains high-confidence secret material: ${path}`);
    failures += 1;
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
  if (!quietSuccess) io.log(`Memory check passed: ${root}`);
}
