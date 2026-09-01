import type { Io } from '../types.js';
import { type FrontmatterResult, parseFrontmatterDocument } from './frontmatter.js';
import type { MemoryRootKind } from './memory-autopilot-document-rules.js';
import { reportMemoryDiagnostic } from './memory-diagnostic.js';
import { validateMemoryDocumentRules } from './memory-document-rules.js';
import {
  type HandoffGenerationState,
  recordTypedHandoffGeneration,
  validateHandoffGenerations,
} from './memory-handoff-generation-rules.js';
import {
  isExcludedMemoryArtifact,
  type ManagedMemoryEntry,
  managedMemoryEntries,
  markdownFiles,
  maximumMemoryDocumentBytes,
  readMemoryDocument,
} from './memory-path.js';
import { validateMemoryReferences } from './memory-reference-validation.js';
import { sanitizeDiagnosticText, validatePortableMemoryPaths } from './memory-root-path-rules.js';
import { containsHighConfidenceSecret, secretTextFiles } from './secret-hygiene.js';
import { canonicalTaskLedgerId } from './task-ledger-memory.js';

const redactedSecretDiagnostic =
  'Memory validation diagnostic redacted because it contains high-confidence secret material';

function redactingIo(io: Io): Io {
  const safeMessage = (message: unknown) => {
    const text = String(message);
    return containsHighConfidenceSecret(text)
      ? redactedSecretDiagnostic
      : sanitizeDiagnosticText(text);
  };
  return {
    log: (message: unknown = '') => io.log(safeMessage(message)),
    error: (message: unknown = '', ...optional: unknown[]) =>
      io.error(safeMessage(message), ...optional),
  };
}

export function contentMemoryReferences(content: string): string[] {
  return [...content.matchAll(/memory:([A-Za-z0-9_./-]+)/g)].map((match) => match[1]);
}

export function metadataReferences(metadata: Map<string, unknown>): string[] {
  const values: string[] = [];
  for (const field of ['derived-from', 'supersedes', 'superseded-by', 'source-refs']) {
    const value = metadata.get(field);
    if (typeof value === 'string') values.push(value);
    else if (Array.isArray(value)) values.push(...value.filter((item) => typeof item === 'string'));
  }
  return values.filter((value) => value.startsWith('memory:'));
}

export function isOpaqueMemoryContent(
  metadata: Map<string, unknown>,
  location?: { root: string; path: string },
): boolean {
  return (
    metadata.get('memory-kind') === 'input' ||
    metadata.get('type') === 'user-profile' ||
    (metadata.get('type') === 'session-handoff' && metadata.get('snapshot-mode') === 'replace') ||
    (location !== undefined &&
      canonicalTaskLedgerId(location.root, location.path, metadata) !== undefined)
  );
}

function validateParsedMemoryDocument(
  root: string,
  path: string,
  content: string,
  frontmatter: FrontmatterResult,
  io: Io,
  rootKind: MemoryRootKind,
): number {
  let failures = validateMemoryDocumentRules(
    root,
    path,
    content,
    frontmatter.body,
    frontmatter.metadata,
    io,
    rootKind,
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
  { rootKind = 'auto' }: { rootKind?: MemoryRootKind } = {},
): number {
  const safeIo = redactingIo(io);
  let frontmatter: FrontmatterResult;
  try {
    frontmatter = parseFrontmatterDocument(content);
  } catch (error) {
    safeIo.error(`Invalid memory frontmatter: ${path}: ${String(error)}`);
    return 1;
  }
  return validateParsedMemoryDocument(root, path, content, frontmatter, safeIo, rootKind);
}

function discoveredMemoryFiles(
  root: string,
  io: Io,
): { entries: ManagedMemoryEntry[]; files: string[] } {
  try {
    const entries = managedMemoryEntries(root);
    return { entries, files: markdownFiles(root, { entries }) };
  } catch (error) {
    const message = String(error);
    io.error(
      message.toLowerCase().includes('symbolic link')
        ? `Invalid memory reference or managed memory entry: ${message}`
        : `Invalid managed memory tree: ${message}`,
    );
    throw new Error('Memory check failed: 1 issue(s)', {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

interface RootValidationState {
  references: Set<string>;
  sessions: Map<string, string>;
  inputIdentities: Map<string, string>;
  handoffGenerations: HandoffGenerationState;
}

function validateRootDocument(
  root: string,
  path: string,
  content: string,
  io: Io,
  state: RootValidationState,
  rootKind: MemoryRootKind,
): number {
  let frontmatter: FrontmatterResult;
  try {
    frontmatter = parseFrontmatterDocument(content);
  } catch (error) {
    io.error(`Invalid memory frontmatter: ${path}: ${String(error)}`);
    return 1;
  }
  let failures = validateParsedMemoryDocument(root, path, content, frontmatter, io, rootKind);
  const sessionId = frontmatter.metadata.get('session-id');
  if (typeof sessionId === 'string' && sessionId) {
    const identity = sessionId.normalize('NFC').toLowerCase();
    const existing = state.sessions.get(identity);
    if (existing) {
      io.error(`Duplicate session-id identity: ${existing} and ${path}`);
      failures += 1;
    } else state.sessions.set(identity, path);
  }
  recordTypedHandoffGeneration(frontmatter.metadata, path, state.handoffGenerations);
  if (frontmatter.metadata.get('memory-kind') === 'input') {
    const digest = frontmatter.metadata.get('content-digest');
    if (typeof digest === 'string' && digest) {
      const existing = state.inputIdentities.get(digest);
      if (existing) {
        reportMemoryDiagnostic(
          io,
          'input-identity',
          `Duplicate input identity ${digest}: ${existing} and ${path}`,
        );
        failures += 1;
      } else state.inputIdentities.set(digest, path);
    }
  }
  if (!isOpaqueMemoryContent(frontmatter.metadata, { root, path })) {
    for (const reference of contentMemoryReferences(content)) state.references.add(reference);
  }
  for (const reference of metadataReferences(frontmatter.metadata)) {
    state.references.add(reference.slice('memory:'.length));
  }
  return failures;
}

export function validateMemoryRoot(
  root: string,
  io: Io,
  {
    quietSuccess = false,
    contentOverrides = new Map(),
    rootKind = 'auto',
  }: {
    quietSuccess?: boolean;
    contentOverrides?: Map<string, string>;
    rootKind?: MemoryRootKind;
  } = {},
): void {
  const safeIo = redactingIo(io);
  const { entries, files } = discoveredMemoryFiles(root, safeIo);
  let failures = validatePortableMemoryPaths(root, entries, safeIo);
  const state: RootValidationState = {
    references: new Set(),
    sessions: new Map(),
    inputIdentities: new Map(),
    handoffGenerations: new Map(),
  };
  for (const path of files) {
    const override = contentOverrides.get(path);
    if (override !== undefined && Buffer.byteLength(override) > maximumMemoryDocumentBytes) {
      io.error(`Memory document byte budget exceeded: ${path}`);
      failures += 1;
      continue;
    }
    const content = override ?? readMemoryDocument(path);
    failures += validateRootDocument(root, path, content, safeIo, state, rootKind);
  }
  failures += validateHandoffGenerations(state.handoffGenerations, safeIo);
  let secretFiles: string[];
  try {
    secretFiles = secretTextFiles(root, new Set(files), {
      exclude: (path) => isExcludedMemoryArtifact(root, path),
      excludeDirectory: (path) => isExcludedMemoryArtifact(root, path),
    });
  } catch (error) {
    safeIo.error(`Memory secret scan failed: ${String(error)}`);
    throw new Error(`Memory check failed: ${failures + 1} issue(s)`);
  }
  for (const path of secretFiles) {
    safeIo.error(`Memory contains high-confidence secret material: ${path}`);
    failures += 1;
  }
  failures += validateMemoryReferences(root, state.references, entries, safeIo);
  if (failures > 0) throw new Error(`Memory check failed: ${failures} issue(s)`);
  if (!quietSuccess) safeIo.log(`Memory check passed: ${root}`);
}
