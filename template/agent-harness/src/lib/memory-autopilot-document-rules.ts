import { relative, resolve, sep } from 'node:path';
import type { Io } from '../types.js';
import { isAtxHeading } from './markdown-heading.js';
import { validateTypedHandoff } from './memory-handoff-document-rules.js';
import { type InputSource, inputContentDigest, parseInputBody } from './memory-input.js';

export type MemoryRootKind = 'auto' | 'global' | 'project';

const inputSources = new Set(['chat', 'file', 'meeting', 'link', 'other']);

function validateInputDigest(
  path: string,
  body: string,
  metadata: Map<string, unknown>,
  io: Io,
): number {
  const stored = metadata.get('content-digest');
  const tags = metadata.get('tags');
  const typed = Array.isArray(tags) && tags.includes('autopilot');
  const parsed = parseInputBody(body);
  if (stored === undefined) {
    let failures = 0;
    if (typed) {
      io.error(`Typed input requires content-digest metadata: ${path}`);
      failures += 1;
      if (!parsed) {
        io.error(`Typed input requires a parseable capture body: ${path}`);
        failures += 1;
      }
    }
    return failures;
  }
  const source = metadata.get('input-source');
  const verbatim = metadata.get('verbatim');
  if (
    typeof stored !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(stored) ||
    !inputSources.has(String(source)) ||
    typeof verbatim !== 'boolean' ||
    !parsed ||
    parsed.verbatim !== verbatim ||
    stored !== `sha256:${inputContentDigest(parsed.content, source as InputSource, verbatim)}`
  ) {
    io.error(`Input content digest does not match its payload semantics: ${path}`);
    return 1;
  }
  return 0;
}

function validateReservedDocumentIdentity(
  root: string,
  path: string,
  metadata: Map<string, unknown>,
  rootKind: MemoryRootKind,
  io: Io,
): number {
  const name = relative(root, path).split(sep).join('/');
  const expected =
    name === 'README.md' || name === 'core.md'
      ? { type: 'agent-memory-index', kind: 'index', status: 'active' }
      : name === 'profile.md' && rootKind !== 'project'
        ? { type: 'user-profile', kind: 'distilled', status: 'active' }
        : undefined;
  if (!expected) return 0;
  if (
    metadata.get('type') === expected.type &&
    metadata.get('memory-kind') === expected.kind &&
    metadata.get('status') === expected.status
  ) {
    return 0;
  }
  io.error(`Reserved memory document has an invalid identity or lifecycle state: ${path}`);
  return 1;
}

function validateArchiveLocation(
  root: string,
  path: string,
  metadata: Map<string, unknown>,
  io: Io,
): number {
  const components = relative(root, path).split(sep);
  const archiveIndexes = components.flatMap((component, index) =>
    component.normalize('NFC').toLowerCase() === '_archive' ? [index] : [],
  );
  let failures = 0;
  const inCanonicalArchive =
    archiveIndexes.length === 1 && archiveIndexes[0] === 0 && components[0] === '_archive';
  if (inCanonicalArchive && metadata.get('status') !== 'archived') {
    io.error(`Memory stored under _archive must have archived status: ${path}`);
    failures += 1;
  }
  if (!inCanonicalArchive && metadata.get('status') === 'archived') {
    io.error(`Memory with archived status must be stored under _archive: ${path}`);
    failures += 1;
  }
  return failures;
}

function validateCoreStructure(
  root: string,
  path: string,
  body: string,
  rootKind: MemoryRootKind,
  io: Io,
): number {
  if (path !== resolve(root, 'core.md')) return 0;
  let failures = 0;
  const lines = body.split(/\r?\n/);
  const sections = [
    'Active Work',
    'Important Inputs',
    'Distilled Memory',
    'Recent Handoffs',
    'User Profile',
  ] as const;
  const counts = new Map(
    sections.map((section) => [
      section,
      lines.filter((line) => isAtxHeading(line, 2, section)).length,
    ]),
  );
  for (const section of sections) {
    for (const line of lines.filter((line) => isAtxHeading(line, 2, section))) {
      if (line !== `## ${section}`) {
        io.error(`Memory core section must use its canonical heading: ${section}: ${path}`);
        failures += 1;
      }
    }
    if ((counts.get(section) || 0) > 1) {
      io.error(`Memory core section must appear exactly once: ${section}: ${path}`);
      failures += 1;
    }
  }
  const active = counts.get('Active Work') || 0;
  const important = counts.get('Important Inputs') || 0;
  const distilled = counts.get('Distilled Memory') || 0;
  const recent = counts.get('Recent Handoffs') || 0;
  const profile = counts.get('User Profile') || 0;
  const projectShape =
    active === 1 && important === 1 && distilled === 1 && recent === 1 && profile === 0;
  const globalShape =
    profile === 1 && active === 0 && important === 0 && distilled === 0 && recent === 0;
  const validShape =
    rootKind === 'project'
      ? projectShape
      : rootKind === 'global'
        ? globalShape
        : projectShape !== globalShape;
  if (!validShape) {
    io.error(`Memory core does not match the ${rootKind} managed section layout: ${path}`);
    failures += 1;
  }
  return failures;
}

export function validateAutopilotDocumentRules(
  root: string,
  path: string,
  body: string,
  metadata: Map<string, unknown>,
  rootKind: MemoryRootKind,
  io: Io,
): number {
  let failures = 0;
  if (metadata.get('memory-kind') === 'input') {
    failures += validateInputDigest(path, body, metadata, io);
  }
  failures += validateTypedHandoff(root, path, body, metadata, io);
  failures += validateReservedDocumentIdentity(root, path, metadata, rootKind, io);
  failures += validateArchiveLocation(root, path, metadata, io);
  failures += validateCoreStructure(root, path, body, rootKind, io);
  return failures;
}
