import type { Io } from '../types.js';
import { type FindingKind, findingDigest, findingSection } from './memory-finding.js';
import { normalizedInputContent } from './memory-input.js';

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
  if (
    metadata.get('type') !== 'analytical-finding' ||
    metadata.get('finding-schema-version') !== 1
  ) {
    io.error(`Invalid typed finding identity or schema: ${path}`);
    failures += 1;
  }
  if (!findingKinds.has(String(kind))) {
    io.error(`Invalid finding kind: ${path}`);
    failures += 1;
  }
  if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) {
    io.error(`Typed finding requires source references: ${path}`);
    failures += 1;
  }
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
  return failures;
}
