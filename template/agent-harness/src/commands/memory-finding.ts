import { basename, dirname, join } from 'node:path';
import { stringify } from 'yaml';
import { parseFrontmatterDocument } from '../lib/frontmatter.js';
import { escapeCoreLabel, upsertCoreReference } from '../lib/memory-core.js';
import { documentPurposeMetadata } from '../lib/memory-document-purpose.js';
import {
  assertFindingFactSemantics,
  type MemoryFactClass,
  validFactExpiry,
} from '../lib/memory-fact-semantics.js';
import {
  type FindingKind,
  type FindingRetention,
  findingDigest,
  findingListSection,
  findingSlug,
} from '../lib/memory-finding.js';
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

export interface FindingOptions {
  kind: FindingKind;
  retention: FindingRetention;
  factClass: MemoryFactClass;
  title: string;
  conclusion: string;
  rationale: string;
  application: string;
  evidence: string[];
  sourceRefs: string[];
  workstream?: string;
  expires?: string;
  json?: boolean;
}

function assertOptions(options: FindingOptions): void {
  assertNoHighConfidenceSecret(
    [
      options.kind,
      options.retention,
      options.factClass,
      options.title,
      options.conclusion,
      options.rationale,
      options.application,
      options.workstream ?? '',
      options.expires ?? '',
      ...(options.evidence ?? []),
      ...(options.sourceRefs ?? []),
    ],
    'Memory finding',
  );
  if (!['analysis', 'review', 'research'].includes(options.kind)) {
    throw new Error(`Invalid finding kind: ${String(options.kind)}`);
  }
  if (!['workstream', 'durable'].includes(options.retention)) {
    throw new Error(`Invalid finding retention: ${String(options.retention)}`);
  }
  assertFindingFactSemantics(options.retention, options.factClass);
  for (const [name, value] of [
    ['title', options.title],
    ['conclusion', options.conclusion],
    ['rationale', options.rationale],
    ['application', options.application],
  ] as const) {
    if (!value?.trim()) throw new Error(`Finding ${name} is required`);
    if (/\r|\n/.test(value) && name === 'title') {
      throw new Error('Finding title must be one bounded line');
    }
  }
  if (options.title.length > 200) throw new Error('Finding title must be one bounded line');
  if (!Array.isArray(options.evidence) || options.evidence.length === 0) {
    throw new Error('Finding evidence is required');
  }
  if (!Array.isArray(options.sourceRefs) || options.sourceRefs.length === 0) {
    throw new Error('Finding source references are required');
  }
  if (
    [...options.evidence, ...options.sourceRefs].some(
      (entry) => !entry?.trim() || /\r|\n/.test(entry) || entry.length > 500,
    )
  ) {
    throw new Error('Finding evidence and source references must be bounded single lines');
  }
  if (options.retention === 'workstream') {
    if (!options.workstream || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(options.workstream)) {
      throw new Error('Finding workstream is required and must be a stable identifier');
    }
    if (!validFactExpiry(options.expires)) {
      throw new Error('Finding expires is required and must be a calendar date');
    }
  } else if (options.workstream !== undefined || options.expires !== undefined) {
    throw new Error('Durable finding must not declare workstream or expires');
  }
}

function render(
  runtime: Runtime,
  projectName: string,
  options: FindingOptions,
  digest: string,
  created: string,
  updated: string,
  evidence: string[],
  sourceRefs: string[],
): string {
  const memoryKind = options.retention === 'durable' ? 'distilled' : 'working';
  const derivedFrom = sourceRefs.filter((reference) => reference.startsWith('memory:'));
  return `---\n${stringify(
    {
      title: options.title.trim(),
      description: `分析发现：${options.title.trim()}`,
      ...documentPurposeMetadata(options.title),
      type: 'analytical-finding',
      'memory-kind': memoryKind,
      status: 'active',
      owners: [runtime.owner],
      created,
      updated,
      project: projectName,
      tags: ['finding', options.kind, 'autopilot'],
      scope: [],
      'source-refs': sourceRefs,
      'source-of-truth': false,
      'schema-version': 1,
      'finding-schema-version': 2,
      'finding-kind': options.kind,
      'fact-class': options.factClass,
      'finding-digest': `sha256:${digest}`,
      retention: options.retention,
      ...(options.workstream ? { workstream: options.workstream } : {}),
      ...(options.expires ? { expires: options.expires } : {}),
      ...(derivedFrom.length > 0 ? { 'derived-from': derivedFrom } : {}),
    },
    { lineWidth: 0 },
  )}---\n\n# 结论\n\n${options.conclusion.trim()}\n\n# 理由\n\n${options.rationale.trim()}\n\n# 应用\n\n${options.application.trim()}\n\n# 证据\n\n${evidence.map((item) => `- ${item}`).join('\n')}\n`;
}

export function captureFinding(
  runtime: Runtime,
  project: string,
  options: FindingOptions,
  io: Io = console,
): MemoryWriteResult {
  assertRuntimeCanMutate(runtime);
  assertOptions(options);
  const conclusion = normalizedInputContent(options.conclusion);
  const digest = findingDigest(options.kind, conclusion);
  const date = calendarDate(runtime);
  const result = withProjectMemoryTransaction(runtime, project, ({ memoryRoot }) => {
    const matches = markdownFiles(memoryRoot).filter((path) => {
      const metadata = parseFrontmatterDocument(readMemoryDocument(path)).metadata;
      return metadata.get('finding-digest') === `sha256:${digest}`;
    });
    if (matches.length > 1) throw new Error(`Ambiguous finding identity sha256:${digest}`);
    const existing = matches[0];
    const existingDocument = existing ? readMemoryDocument(existing) : '';
    const parsed = parseFrontmatterDocument(existingDocument);
    if (existing && parsed.metadata.get('retention') !== options.retention) {
      throw new Error('Finding retention cannot change for an existing identity');
    }
    if (existing && parsed.metadata.get('workstream') !== options.workstream) {
      throw new Error('Finding workstream cannot change for an existing identity');
    }
    if (existing && parsed.metadata.get('fact-class') !== options.factClass) {
      throw new Error('Finding fact class cannot change for an existing identity');
    }
    const memoryKind = options.retention === 'durable' ? 'distilled' : 'working';
    const path =
      existing ??
      join(
        memoryRoot,
        memoryKind,
        `${date}-${findingSlug(options.title)}-${digest.slice(0, 16)}.md`,
      );
    assertSafePath(memoryRoot, path);
    const created = String(parsed.metadata.get('created') || date);
    const evidence = [
      ...new Set([
        ...findingListSection(parsed.body, '证据'),
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
      digest,
      created,
      existingDocument ? date : created,
      evidence,
      sourceRefs,
    );
    const reference = `memory:${memoryReference(memoryRoot, path)}`;
    const corePath = join(memoryRoot, 'core.md');
    const currentCore = readMemoryDocument(corePath);
    const core = upsertCoreReference(
      currentCore,
      options.retention === 'durable' ? 'Distilled Memory' : 'Active Work',
      `- ${escapeCoreLabel(options.title.trim())}；${reference}`,
      reference,
      date,
    );
    const action = !existingDocument
      ? 'created'
      : existingDocument === candidate && currentCore === core
        ? 'unchanged'
        : 'updated';
    if (action === 'unchanged') validateUnchanged(memoryRoot, io, { rootKind: 'project' });
    else {
      writeValidated(
        memoryRoot,
        [
          ...(existingDocument === candidate ? [] : [{ path, content: candidate }]),
          ...(currentCore === core ? [] : [{ path: corePath, content: core }]),
        ],
        io,
        { rootKind: 'project' },
      );
    }
    return { version: 1, action, kind: memoryKind, path, reference } as const;
  });
  return output(result, Boolean(options.json), io);
}
