import type { Io } from '../../types.js';
import { isMemoryFactClass } from './memory-fact-semantics.js';
import { type FindingKind, findingDigest, findingSection } from './memory-finding.js';
import { assertSourceReferenceBoundary, normalizedInputContent } from './memory-input.js';

const findingKinds = new Set(['analysis', 'review', 'research']);

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function requiredSections(path: string, body: string, io: Io): number {
  let failures = 0;
  for (const heading of ['结论', '理由', '应用', '证据']) {
    if (!findingSection(body, heading)) {
      io.error(`Typed finding requires a non-empty ${heading} section: ${path}`);
      failures += 1;
    }
  }
  const evidence = findingSection(body, '证据');
  if (evidence && !evidence.split('\n').some((line) => line.startsWith('- '))) {
    io.error(`Typed finding evidence must contain at least one list item: ${path}`);
    failures += 1;
  }
  return failures;
}

function sourceReferenceIssues(
  path: string,
  sourceRefs: unknown,
  label: 'Finding' | 'Experience',
  io: Io,
): number {
  if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) {
    io.error(`Typed ${label.toLowerCase()} requires source references: ${path}`);
    return 1;
  }
  if (
    sourceRefs.some(
      (entry) =>
        typeof entry !== 'string' || !entry.trim() || /\r|\n/.test(entry) || entry.length > 500,
    )
  ) {
    io.error(
      `Typed ${label.toLowerCase()} source references must be bounded single lines: ${path}`,
    );
    return 1;
  }
  try {
    assertSourceReferenceBoundary(sourceRefs, label);
    return 0;
  } catch (error) {
    io.error(`Invalid typed ${label.toLowerCase()} source reference: ${path}: ${String(error)}`);
    return 1;
  }
}

export function validateFindingDocument(
  path: string,
  body: string,
  metadata: Map<string, unknown>,
  io: Io,
): number {
  if (metadata.get('type') !== 'analytical-finding' && !metadata.has('finding-digest')) return 0;
  let failures = 0;
  const kind = metadata.get('finding-kind');
  const retention = metadata.get('retention');
  const sourceRefs = metadata.get('source-refs');
  const schemaVersion = metadata.get('finding-schema-version');
  if (metadata.get('type') !== 'analytical-finding' || ![1, 2].includes(Number(schemaVersion))) {
    io.error(`Invalid typed finding identity or schema: ${path}`);
    failures += 1;
  }
  const factClass = metadata.get('fact-class');
  if (schemaVersion === 2 && !isMemoryFactClass(factClass)) {
    io.error(`Typed finding v2 requires a valid fact class: ${path}`);
    failures += 1;
  }
  if (factClass === 'formal-fact') {
    io.error(`Analytical finding cannot declare formal fact authority: ${path}`);
    failures += 1;
  }
  if (!findingKinds.has(String(kind))) {
    io.error(`Invalid finding kind: ${path}`);
    failures += 1;
  }
  failures += sourceReferenceIssues(path, sourceRefs, 'Finding', io);
  failures += requiredSections(path, body, io);
  const conclusion = findingSection(body, '结论');
  if (findingKinds.has(String(kind)) && conclusion) {
    const expected = `sha256:${findingDigest(kind as FindingKind, normalizedInputContent(conclusion))}`;
    if (metadata.get('finding-digest') !== expected) {
      io.error(`Finding digest does not match its conclusion: ${path}`);
      failures += 1;
    }
  }
  if (retention === 'workstream') {
    if (metadata.get('memory-kind') !== 'working') {
      io.error(`Workstream finding must use working memory: ${path}`);
      failures += 1;
    }
    const workstream = metadata.get('workstream');
    if (typeof workstream !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(workstream)) {
      io.error(`Workstream finding requires a stable workstream identifier: ${path}`);
      failures += 1;
    }
    if (!validDate(metadata.get('expires'))) {
      io.error(`Workstream finding requires a valid expiry: ${path}`);
      failures += 1;
    }
  } else if (retention === 'durable') {
    if (metadata.get('memory-kind') !== 'distilled') {
      io.error(`Durable finding must use distilled memory: ${path}`);
      failures += 1;
    }
    if (metadata.has('workstream') || metadata.has('expires')) {
      io.error(`Durable finding must not declare workstream or expiry: ${path}`);
      failures += 1;
    }
    if (factClass === 'current-state' || factClass === 'recovery-state') {
      io.error(`Durable finding cannot retain ${factClass}: ${path}`);
      failures += 1;
    }
  } else {
    io.error(`Invalid finding retention: ${path}`);
    failures += 1;
  }
  return failures;
}

export function validateExperienceSemantics(
  path: string,
  body: string,
  metadata: Map<string, unknown>,
  io: Io,
): number {
  if (metadata.get('type') !== 'operational-experience') return 0;
  const version = metadata.get('experience-schema-version');
  if (version === undefined) return 0;
  if (version !== 2) {
    io.error(`Unsupported experience schema: ${path}`);
    return 1;
  }
  let failures = 0;
  for (const heading of ['结论', '理由', '应用', '证据']) {
    if (!findingSection(body, heading)) {
      io.error(`Typed experience v2 requires a non-empty ${heading} section: ${path}`);
      failures += 1;
    }
  }
  failures += sourceReferenceIssues(path, metadata.get('source-refs'), 'Experience', io);
  return failures;
}
