import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { stringify } from 'yaml';
import { documentPurposeMetadata } from '../../lib/memory/memory-document-purpose.js';
import { escapeCoreLabel, upsertCoreReference } from '../../lib/memory/memory-core.js';
import { inputContentDigest } from '../../lib/memory/memory-input.js';
import type { InputOptions } from '../../lib/memory/memory-input-policy.js';
import { memoryReference, readMemoryDocument } from '../../lib/memory/memory-path.js';
import {
  type MemoryWriteCandidate,
  type MemoryWriteResult,
  output,
  writeValidated,
} from '../../lib/memory/memory-write.js';
import { withProjectMemoryTransaction } from '../../lib/project/project-memory.js';
import { assertSafePath } from '../../lib/filesystem/safe-path.js';
import { assertRuntimeCanMutate, calendarDate } from '../../runtime.js';
import type { Io, Runtime } from '../../types.js';
import { findExistingInput, repairExistingInput } from '../../lib/memory/memory-input-identity.js';
import { prepareInput } from '../../lib/memory/memory-input-preparation.js';

export {
  type InputOptions,
  maximumInputContentBytes,
} from '../../lib/memory/memory-input-policy.js';

function frontmatter(metadata: Record<string, unknown>): string {
  return `---\n${stringify(metadata, { lineWidth: 0 })}---\n\n`;
}

function slug(value: string): string {
  const normalized = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return normalized || 'memory';
}

export function captureInput(
  runtime: Runtime,
  project: string,
  options: InputOptions,
  io: Io = console,
): MemoryWriteResult {
  assertRuntimeCanMutate(runtime);
  const { policy, title, storedPayload, summary } = prepareInput(project, options);
  const date = calendarDate(runtime);
  const digest = inputContentDigest(storedPayload, options.source, !summary);
  const result = withProjectMemoryTransaction<MemoryWriteCandidate>(
    runtime,
    project,
    ({ memoryRoot }) => {
      const existing = findExistingInput(memoryRoot, digest);
      if (existing) return repairExistingInput(memoryRoot, existing, date, io);
      const path = join(memoryRoot, 'inputs', ...date.split('-'), `${slug(title)}-${digest}.md`);
      assertSafePath(memoryRoot, path);
      const reference = `memory:${memoryReference(memoryRoot, path)}`;
      const heading = summary ? '可靠摘要' : '原始输入';
      const content = `${frontmatter({
        title,
        description: `${summary ? '用户输入可靠摘要' : '用户输入'}：${title}`,
        ...documentPurposeMetadata(title),
        type: 'user-input',
        'memory-kind': 'input',
        status: 'active',
        owners: [runtime.owner],
        created: date,
        updated: date,
        project: basename(dirname(memoryRoot)),
        tags: ['user-input', 'autopilot'],
        scope: options.scope || [],
        'source-refs': options.sourceRefs || [],
        'source-of-truth': false,
        'schema-version': 1,
        'input-schema-version': 2,
        'input-source': options.source,
        'input-purpose': policy.purpose,
        retention: policy.retention,
        ...(policy.workstream ? { workstream: policy.workstream } : {}),
        'content-digest': `sha256:${digest}`,
        verbatim: !summary,
      })}# ${heading}\n\n${storedPayload}`;
      if (existsSync(path))
        throw new Error(`Input identity path already exists with different content: ${path}`);
      const corePath = join(memoryRoot, 'core.md');
      assertSafePath(memoryRoot, corePath);
      const core = upsertCoreReference(
        readMemoryDocument(corePath),
        'Important Inputs',
        `- ${escapeCoreLabel(title)}；${reference}`,
        reference,
        date,
      );
      writeValidated(
        memoryRoot,
        [
          { path, content },
          { path: corePath, content: core },
        ],
        io,
        { rootKind: 'project' },
      );
      return { version: 1, action: 'created', kind: 'input', path, reference } as const;
    },
    { allowNonCanonicalReferences: true, allowInputIdentityDiagnostics: true },
  );
  return output(result, Boolean(options.json), io);
}
