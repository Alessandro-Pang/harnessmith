import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { stringify } from 'yaml';
import { parseFrontmatterDocument } from '../lib/frontmatter.js';
import { escapeCoreLabel, upsertCoreReference } from '../lib/memory-core.js';
import { normalizedInputContent } from '../lib/memory-input.js';
import { markdownFiles, memoryReference, readMemoryDocument } from '../lib/memory-path.js';
import {
  type MemoryWriteResult,
  output,
  validateUnchanged,
  writeValidated,
} from '../lib/memory-write.js';
import { withProjectMemoryTransaction } from '../lib/project-memory.js';
import { assertSafePath } from '../lib/safe-path.js';
import { assertNoHighConfidenceSecret } from '../lib/secret-hygiene.js';
import { assertRuntimeCanMutate, calendarDate } from '../runtime.js';
import type { Io, Runtime } from '../types.js';

export interface ExperienceOptions {
  kind: 'lesson' | 'failure';
  title: string;
  conclusion: string;
  evidence: string[];
  sourceRefs: string[];
  json?: boolean;
}

function digest(kind: ExperienceOptions['kind'], conclusion: string): string {
  return createHash('sha256')
    .update(`${kind}\0${normalizedInputContent(conclusion)}`)
    .digest('hex');
}

function slug(value: string): string {
  return (
    value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'experience'
  );
}

function assertOptions(options: ExperienceOptions): void {
  assertNoHighConfidenceSecret(
    [
      options.kind,
      options.title,
      options.conclusion,
      ...(options.evidence ?? []),
      ...(options.sourceRefs ?? []),
    ],
    'Memory experience',
  );
  if (!['lesson', 'failure'].includes(options.kind)) {
    throw new Error(`Invalid experience kind: ${String(options.kind)}`);
  }
  if (!options.title?.trim() || !options.conclusion?.trim()) {
    throw new Error('Experience title and conclusion are required');
  }
  if (/\r|\n/.test(options.title) || options.title.length > 200) {
    throw new Error('Experience title must be one bounded line');
  }
  if (!Array.isArray(options.evidence) || !Array.isArray(options.sourceRefs)) {
    throw new Error('Experience evidence and source references are required');
  }
  if (options.evidence.length === 0 || options.sourceRefs.length === 0) {
    throw new Error('Experience evidence and source references are required');
  }
  if (
    [...options.evidence, ...options.sourceRefs].some(
      (entry) => !entry?.trim() || /\r|\n/.test(entry) || entry.length > 500,
    )
  ) {
    throw new Error('Experience evidence and source references must be bounded single lines');
  }
}

function existingEvidence(body: string): string[] {
  const match = body.match(/(?:^|\n)# 证据\n\n([\s\S]*?)(?=\n# |$)/u);
  if (!match) return [];
  return match[1]
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2));
}

function render(
  runtime: Runtime,
  projectName: string,
  options: ExperienceOptions,
  experienceDigest: string,
  created: string,
  updated: string,
  evidence: string[],
  sourceRefs: string[],
): string {
  const derivedFrom = sourceRefs.filter((reference) => reference.startsWith('memory:'));
  return `---\n${stringify(
    {
      title: options.title.trim(),
      description: `${options.kind === 'failure' ? '失败经验' : '可复用经验'}：${options.title.trim()}`,
      type: 'operational-experience',
      'memory-kind': 'distilled',
      status: 'active',
      owners: [runtime.owner],
      created,
      updated,
      project: projectName,
      tags: ['experience', options.kind, 'autopilot'],
      scope: [],
      'source-refs': sourceRefs,
      'source-of-truth': false,
      'schema-version': 1,
      'experience-kind': options.kind,
      'experience-digest': `sha256:${experienceDigest}`,
      ...(derivedFrom.length > 0 ? { 'derived-from': derivedFrom } : {}),
    },
    { lineWidth: 0 },
  )}---\n\n# 结论\n\n${options.conclusion.trim()}\n\n# 证据\n\n${evidence.map((item) => `- ${item}`).join('\n')}\n`;
}

export function captureExperience(
  runtime: Runtime,
  project: string,
  options: ExperienceOptions,
  io: Io = console,
): MemoryWriteResult {
  assertRuntimeCanMutate(runtime);
  assertOptions(options);
  const conclusion = normalizedInputContent(options.conclusion);
  const experienceDigest = digest(options.kind, conclusion);
  const date = calendarDate(runtime);
  const result = withProjectMemoryTransaction(runtime, project, ({ memoryRoot }) => {
    const matches = markdownFiles(memoryRoot).filter((path) => {
      const metadata = parseFrontmatterDocument(readMemoryDocument(path)).metadata;
      return metadata.get('experience-digest') === `sha256:${experienceDigest}`;
    });
    if (matches.length > 1) {
      throw new Error(`Ambiguous experience identity sha256:${experienceDigest}`);
    }
    const path =
      matches[0] ??
      join(
        memoryRoot,
        'distilled',
        `${date}-${slug(options.title)}-${experienceDigest.slice(0, 16)}.md`,
      );
    assertSafePath(memoryRoot, path);
    const existing = existsSync(path) ? readMemoryDocument(path) : '';
    const parsed = parseFrontmatterDocument(existing);
    const created = String(parsed.metadata.get('created') || date);
    const evidence = [
      ...new Set([
        ...existingEvidence(parsed.body),
        ...options.evidence.map((item) => item.trim()),
      ]),
    ];
    const priorRefs = parsed.metadata.get('source-refs');
    const sourceRefs = [
      ...new Set([
        ...(Array.isArray(priorRefs)
          ? priorRefs.filter((item): item is string => typeof item === 'string')
          : []),
        ...options.sourceRefs.map((item) => item.trim()),
      ]),
    ];
    const candidate = render(
      runtime,
      basename(dirname(memoryRoot)),
      { ...options, conclusion },
      experienceDigest,
      created,
      existing ? date : created,
      evidence,
      sourceRefs,
    );
    const reference = `memory:${memoryReference(memoryRoot, path)}`;
    const corePath = join(memoryRoot, 'core.md');
    const currentCore = readMemoryDocument(corePath);
    const core = upsertCoreReference(
      currentCore,
      'Distilled Memory',
      `- ${escapeCoreLabel(options.title.trim())}；${reference}`,
      reference,
      date,
    );
    const action = !existing
      ? 'created'
      : existing === candidate && currentCore === core
        ? 'unchanged'
        : 'updated';
    if (action === 'unchanged') validateUnchanged(memoryRoot, io, { rootKind: 'project' });
    else {
      writeValidated(
        memoryRoot,
        [
          ...(existing === candidate ? [] : [{ path, content: candidate }]),
          ...(currentCore === core ? [] : [{ path: corePath, content: core }]),
        ],
        io,
        { rootKind: 'project' },
      );
    }
    return { version: 1, action, kind: 'distilled', path, reference } as const;
  });
  return output(result, Boolean(options.json), io);
}
