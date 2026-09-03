import { join } from 'node:path';
import { parseFrontmatterDocument } from '../../lib/documentation/frontmatter.js';
import { assertSafePath } from '../../lib/filesystem/safe-path.js';
import { escapeCoreLabel, upsertCoreReference } from '../../lib/memory/memory-core.js';
import {
  type InputSource,
  inputContentDigest,
  parseInputBody,
} from '../../lib/memory/memory-input.js';
import {
  markdownFiles,
  memoryReference,
  readMemoryDocument,
} from '../../lib/memory/memory-path.js';
import {
  type MemoryWriteCandidate,
  validateUnchanged,
  writeValidated,
} from '../../lib/memory/memory-write.js';
import type { Io } from '../../types.js';

export interface ExistingInput {
  path: string;
  status: string;
}

export function findExistingInput(memoryRoot: string, digest: string): ExistingInput | undefined {
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
      if (actual === digest)
        matches.push({ path, status: String(parsed.metadata.get('status') || 'unknown') });
    }
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous input identity ${digest}: ${matches.map((match) => match.path).join(', ')}`,
    );
  }
  return matches[0];
}

export function repairExistingInput(
  memoryRoot: string,
  existing: ExistingInput,
  date: string,
  io: Io,
): MemoryWriteCandidate {
  const { path, status } = existing;
  const reference = `memory:${memoryReference(memoryRoot, path)}`;
  if (!['active', 'blocked'].includes(status)) {
    validateUnchanged(memoryRoot, io, { rootKind: 'project' });
    return { version: 1, action: 'unchanged', kind: 'input', path, reference };
  }
  const title = parseFrontmatterDocument(readMemoryDocument(path)).metadata.get('title');
  if (typeof title !== 'string' || !title.trim())
    throw new Error(`Existing input is missing a title: ${path}`);
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
  if (action === 'updated')
    writeValidated(memoryRoot, [{ path: corePath, content: core }], io, { rootKind: 'project' });
  else validateUnchanged(memoryRoot, io, { rootKind: 'project' });
  return { version: 1, action, kind: 'input', path, reference };
}
