import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { stringify } from 'yaml';
import { readBoundedRegularFile } from '../lib/bounded-file.js';
import { parseFrontmatterDocument } from '../lib/frontmatter.js';
import { escapeCoreLabel, upsertCoreReference } from '../lib/memory-core.js';
import {
  type InputSource,
  inputContentDigest,
  normalizedInputContent,
  parseInputBody,
} from '../lib/memory-input.js';
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

export interface InputOptions {
  title: string;
  content?: string;
  contentFile?: string;
  source: InputSource;
  summary?: boolean;
  json?: boolean;
}

export const maximumInputContentBytes = 1024 * 1024;

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

function inputPayload(options: InputOptions): string {
  const hasContent = options.content !== undefined;
  const hasContentFile = options.contentFile !== undefined;
  if (hasContent === hasContentFile) {
    throw new Error('Input capture requires exactly one of content or contentFile');
  }
  if (hasContent) return options.content as string;
  if (!options.contentFile?.trim()) {
    throw new Error('Input capture requires a non-empty contentFile path');
  }
  return readBoundedRegularFile(options.contentFile, {
    maxBytes: maximumInputContentBytes,
    subject: 'Input contentFile',
  }).content;
}

interface ExistingInput {
  path: string;
  status: string;
}

function existingInput(memoryRoot: string, digest: string): ExistingInput | undefined {
  const matches: ExistingInput[] = [];
  for (const path of markdownFiles(memoryRoot)) {
    assertSafePath(memoryRoot, path);
    const parsed = parseFrontmatterDocument(readMemoryDocument(path));
    if (parsed.metadata.get('memory-kind') !== 'input') continue;
    const parsedBody = parseInputBody(parsed.body);
    const source = parsed.metadata.get('input-source');
    const verbatim = parsed.metadata.get('verbatim');
    if (
      parsedBody !== undefined &&
      typeof source === 'string' &&
      ['chat', 'file', 'meeting', 'link', 'other'].includes(source) &&
      typeof verbatim === 'boolean' &&
      parsedBody.verbatim === verbatim
    ) {
      const actual = inputContentDigest(parsedBody.content, source as InputSource, verbatim);
      const stored = parsed.metadata.get('content-digest');
      if (stored !== undefined && stored !== `sha256:${actual}`) {
        throw new Error(`Input content digest mismatch: ${path}`);
      }
      if (actual === digest) {
        matches.push({ path, status: String(parsed.metadata.get('status') || 'unknown') });
      }
    }
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous input identity ${digest}: ${matches.map((match) => match.path).join(', ')}`,
    );
  }
  return matches[0];
}

function repairExistingInputIndex(
  memoryRoot: string,
  existing: ExistingInput,
  date: string,
  io: Io,
): MemoryWriteResult {
  const { path, status } = existing;
  const reference = `memory:${memoryReference(memoryRoot, path)}`;
  if (!['active', 'blocked'].includes(status)) {
    validateUnchanged(memoryRoot, io, { rootKind: 'project' });
    return { version: 1, action: 'unchanged', kind: 'input', path, reference };
  }
  const title = parseFrontmatterDocument(readMemoryDocument(path)).metadata.get('title');
  if (typeof title !== 'string' || !title.trim()) {
    throw new Error(`Existing input is missing a title: ${path}`);
  }
  const corePath = join(memoryRoot, 'core.md');
  assertSafePath(memoryRoot, corePath);
  const currentCore = readMemoryDocument(corePath);
  const core = upsertCoreReference(
    currentCore,
    'Important Inputs',
    `- ${escapeCoreLabel(title.trim())}；${reference}`,
    reference,
    date,
  );
  const action = core === currentCore ? 'unchanged' : 'updated';
  if (action === 'updated') {
    writeValidated(memoryRoot, [{ path: corePath, content: core }], io, {
      rootKind: 'project',
    });
  } else validateUnchanged(memoryRoot, io, { rootKind: 'project' });
  return { version: 1, action, kind: 'input', path, reference };
}

export function captureInput(
  runtime: Runtime,
  project: string,
  options: InputOptions,
  io: Io = console,
): MemoryWriteResult {
  assertRuntimeCanMutate(runtime);
  assertNoHighConfidenceSecret(
    [project, options.title, options.content, options.contentFile, options.source],
    'Memory input request',
  );
  const payload = inputPayload(options);
  if (Buffer.byteLength(payload) > maximumInputContentBytes) {
    throw new Error(
      `Input content exceeds ${maximumInputContentBytes} bytes; capture a bounded reliable summary instead`,
    );
  }
  assertNoHighConfidenceSecret([payload], 'Memory input');
  const title = options.title.trim();
  if (!title || title.length > 200 || /[\r\n]/.test(title) || !payload.trim()) {
    if (/[\r\n]/.test(title)) throw new Error('Input title must be a single line');
    throw new Error('Input title and content are required');
  }
  if (!['chat', 'file', 'meeting', 'link', 'other'].includes(options.source)) {
    throw new Error(`Invalid input source: ${options.source}`);
  }
  const storedPayload = options.summary ? normalizedInputContent(payload) : payload;
  const date = calendarDate(runtime);
  const digest = inputContentDigest(storedPayload, options.source, !options.summary);
  const result = withProjectMemoryTransaction(
    runtime,
    project,
    ({ memoryRoot }) => {
      const existing = existingInput(memoryRoot, digest);
      if (existing) {
        return repairExistingInputIndex(memoryRoot, existing, date, io);
      }
      const path = join(memoryRoot, 'inputs', ...date.split('-'), `${slug(title)}-${digest}.md`);
      assertSafePath(memoryRoot, path);
      const reference = `memory:${memoryReference(memoryRoot, path)}`;
      const heading = options.summary ? '可靠摘要' : '原始输入';
      const content = `${frontmatter({
        title,
        description: `${options.summary ? '用户输入可靠摘要' : '用户输入'}：${title}`,
        type: 'user-input',
        'memory-kind': 'input',
        status: 'active',
        owners: [runtime.owner],
        created: date,
        updated: date,
        project: basename(dirname(memoryRoot)),
        tags: ['user-input', 'autopilot'],
        scope: [],
        'source-refs': [],
        'source-of-truth': false,
        'schema-version': 1,
        'input-source': options.source,
        'content-digest': `sha256:${digest}`,
        verbatim: !options.summary,
      })}# ${heading}\n\n${storedPayload}`;
      if (existsSync(path)) {
        throw new Error(`Input identity path already exists with different content: ${path}`);
      }
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
